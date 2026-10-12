import { render } from "takumi-js";
import type { Site } from "./page.js";
import { builtinTemplates } from "./templates.js";
import type { AssetLoader, BrandColors, CardData, ResolvedPage, Template } from "./types.js";
import { hash, mix, parseColor, rand, toHex, withTimeout } from "./util.js";

const BUILTIN_FONT = "Geist";
const isUrl = (s: string) => /^https?:\/\//.test(s);

export function resolveColors(c: BrandColors): Required<BrandColors> {
  const bg = parseColor(c.background);
  const fg = parseColor(c.foreground);
  return {
    background: c.background,
    foreground: c.foreground,
    accent: c.accent,
    accent2: c.accent2 ?? c.accent,
    muted: c.muted ?? (bg && fg ? toHex(mix(fg, bg, 0.38)) : c.foreground),
  };
}

export function findTemplate(site: Site, name: string): Template {
  const t = site.config.templates?.[name] ?? builtinTemplates[name];
  if (!t) {
    const known = [...Object.keys(site.config.templates ?? {}), ...Object.keys(builtinTemplates)];
    throw new Error(`ogee: there's no card template called "${name}". Known templates: ${known.join(", ")}`);
  }
  return t;
}

/** An image's pixel size from its header: PNG, JPEG, GIF, WebP and SVG. Null when we can't tell. */
export function imageSize(b: Uint8Array): { width: number; height: number } | null {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const size = (width: number, height: number) => (width > 0 && height > 0 ? { width, height } : null);
  try {
    if (b[0] === 0x89 && b[1] === 0x50) return size(dv.getUint32(16), dv.getUint32(20));
    if (b[0] === 0x47 && b[1] === 0x49) return size(dv.getUint16(6, true), dv.getUint16(8, true));
    if (b[0] === 0xff && b[1] === 0xd8) {
      let i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) return null;
        const marker = b[i + 1]!;
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return size(dv.getUint16(i + 7), dv.getUint16(i + 5));
        i += 2 + dv.getUint16(i + 2);
      }
      return null;
    }
    if (b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
      const kind = String.fromCharCode(b[12]!, b[13]!, b[14]!, b[15]!);
      if (kind === "VP8X") return size(1 + (b[24]! | (b[25]! << 8) | (b[26]! << 16)), 1 + (b[27]! | (b[28]! << 8) | (b[29]! << 16)));
      if (kind === "VP8 ") return size(dv.getUint16(26, true) & 0x3fff, dv.getUint16(28, true) & 0x3fff);
      if (kind === "VP8L") {
        const n = dv.getUint32(21, true);
        return size((n & 0x3fff) + 1, ((n >> 14) & 0x3fff) + 1);
      }
    }
    const head = new TextDecoder().decode(b.subarray(0, 4096));
    if (head.includes("<svg")) {
      const w = head.match(/<svg[^>]*\swidth=["']([\d.]+)(?:px)?["']/);
      const h = head.match(/<svg[^>]*\sheight=["']([\d.]+)(?:px)?["']/);
      if (w && h) return size(+w[1]!, +h[1]!);
      const vb = head.match(/viewBox=["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/);
      if (vb) return size(+vb[1]!, +vb[2]!);
    }
  } catch {
    /* a truncated or odd file: we just don't know */
  }
  return null;
}

/** Width ÷ height, 1 when unknown. */
export function imageAspect(b: Uint8Array): number {
  const s = imageSize(b);
  return s ? s.width / s.height : 1;
}

export interface CardRenderer {
  /** The image type cards come out as. */
  type: "image/png" | "image/jpeg";
  /** Renders a page's card as image bytes (PNG or JPEG, per `card.format`). */
  render(page: ResolvedPage): Promise<Uint8Array>;
  /** The data a template receives for a page, for debugging and for agents. */
  data(page: ResolvedPage): Promise<CardData>;
}

/**
 * Makes a renderer for a site. Fonts and brand images are loaded once and reused for every card.
 * `load` reads files from the assets folder; `fetcher` fetches https URLs.
 */
export function createCardRenderer(site: Site, load: AssetLoader, fetcher: typeof fetch = fetch): CardRenderer {
  const { config } = site;
  const brand = config.brand;
  const width = config.card?.width ?? 1200;
  const height = config.card?.height ?? 630;
  const colors = resolveColors(brand.colors);
  const fonts = brand.fonts ?? [];
  const headingFont = brand.headingFont ?? fonts[0]?.family ?? BUILTIN_FONT;
  const bodyFont = brand.bodyFont ?? headingFont;

  // Brand files are kept for good; page images for a minute, since they can change. Expiry is
  // checked on lookup rather than with timers, which would keep a CLI process alive.
  const bytes = new Map<string, { p: Promise<Uint8Array | null>; until: number }>();
  async function get(src: string, timeout = 6000): Promise<Uint8Array | null> {
    const hit = bytes.get(src);
    if (hit && hit.until > Date.now()) return hit.p;
    const p = (async () => {
      if (isUrl(src)) {
        const r = await withTimeout(fetcher(src), timeout);
        if (!r.ok) return null;
        return new Uint8Array(await r.arrayBuffer());
      }
      return load(src.replace(/^\/+/, ""));
    })().catch(() => null);
    const keep = !isUrl(src) || src === brand.logo || src === brand.plate || fonts.some((f) => f.src === src);
    bytes.set(src, { p, until: keep ? Infinity : Date.now() + 60_000 });
    return p;
  }

  let brandFiles: Promise<{ fonts: { name: string; data: Uint8Array; weight?: number; style?: string }[]; logo: Uint8Array | null; plate: Uint8Array | null }> | null = null;
  const loadBrand = () =>
    (brandFiles ??= (async () => {
      const loaded = await Promise.all(
        fonts.map(async (f) => {
          const data = await get(f.src, 10000);
          if (!data) console.warn(`ogee: couldn't load font "${f.src}"; using the built-in font for ${f.family}`);
          return data ? { name: f.family, data, weight: f.weight, style: f.style } : null;
        }),
      );
      const [logo, plate] = await Promise.all([brand.logo ? get(brand.logo) : null, brand.plate ? get(brand.plate) : null]);
      if (brand.logo && !logo) console.warn(`ogee: couldn't load the logo "${brand.logo}"`);
      if (brand.plate && !plate) console.warn(`ogee: couldn't load the plate "${brand.plate}"`);
      return { fonts: loaded.filter((f) => f !== null), logo, plate };
    })());

  async function data(page: ResolvedPage): Promise<CardData> {
    const files = await loadBrand();
    const seed = hash(page.path);
    const imageBytes = page.image ? await get(page.image) : null;
    const image = imageBytes ? page.image : undefined;
    return {
      title: page.ogTitle,
      description: page.description,
      eyebrow: page.eyebrow,
      siteName: config.name,
      host: new URL(site.site).host.replace(/^www\./, ""),
      path: page.path,
      url: page.canonical,
      image: image && "ogee-image:" + image,
      imageAspect: imageBytes ? imageAspect(imageBytes) : 1,
      logo: files.logo ? "ogee-logo" : undefined,
      logoAspect: files.logo ? imageAspect(files.logo) : 1,
      plate: files.plate ? "ogee-plate" : undefined,
      colors,
      headingFont,
      bodyFont,
      headingWeight: brand.headingWeight ?? 700,
      width,
      height,
      seed: seed / 4294967296,
      rand: (i) => rand(seed, i),
      data: page.data,
    };
  }

  const jpeg = config.card?.format === "jpeg";
  return {
    data,
    type: jpeg ? "image/jpeg" : "image/png",
    async render(page) {
      const files = await loadBrand();
      const card = await data(page);
      const html = findTemplate(site, page.template)(card);
      const images: { src: string; data: Uint8Array }[] = [];
      if (files.logo) images.push({ src: "ogee-logo", data: files.logo });
      if (files.plate) images.push({ src: "ogee-plate", data: files.plate });
      if (card.image && page.image) {
        const img = await get(page.image);
        if (img) images.push({ src: card.image, data: img });
      }
      const out = await render(html, jpeg ? { width, height, format: "jpeg", quality: config.card?.quality ?? 88, fonts: files.fonts, images } : { width, height, format: "png", fonts: files.fonts, images });
      return out instanceof Uint8Array ? out : new Uint8Array(out);
    },
  };
}
