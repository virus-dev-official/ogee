import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { render } from "takumi-js";
import { imageSize } from "../card.js";
import type { BrandFont } from "../types.js";
import type { LogoCandidate, SiteScan } from "./scan.js";
import { ui } from "./ui.js";

async function download(url: string): Promise<{ data: Uint8Array; type: string } | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { "user-agent": "ogee (+https://github.com/virus-dev-official/ogee)" } });
    if (!r.ok) return null;
    return { data: new Uint8Array(await r.arrayBuffer()), type: r.headers.get("content-type") ?? "" };
  } catch {
    return null;
  }
}

const slug = (s: string) => s.replace(/[^a-z0-9]+/gi, "");

/* ------------------------------------------------------------------ fonts */

/**
 * A font file from Google Fonts. Asking without a browser user agent gets TTF, which every renderer
 * reads. Families that don't come in the weight asked for (many display fonts are 400 only) get
 * their regular weight instead; `weight` in the result says which one it is.
 */
async function googleFont(family: string, weight: number): Promise<{ data: Uint8Array; ext: string; weight: number } | null> {
  const fam = encodeURIComponent(family).replace(/%20/g, "+");
  const r = (await download(`https://fonts.googleapis.com/css2?family=${fam}:wght@${weight}`)) ?? (await download(`https://fonts.googleapis.com/css2?family=${fam}`));
  if (!r) return null;
  const css = new TextDecoder().decode(r.data);
  const face = css.split("@font-face").find((f) => /font-style:\s*normal/.test(f) && /src:\s*url/.test(f));
  const url = face?.match(/src:\s*url\(([^)]+)\)/)?.[1];
  if (!url) return null;
  const f = await download(url);
  const got = parseInt(face!.match(/font-weight:\s*(\d+)/)?.[1] ?? String(weight), 10);
  return f ? { data: f.data, ext: url.split(".").pop()!.split("?")[0]!, weight: got } : null;
}

const nearest = (want: number) => (w: number) => (w === 0 ? 0 : Math.abs(w - want));

/**
 * Gets font files for the site's heading and body fonts into assets/fonts: from the site's own
 * @font-face rules first, then Google Fonts. Returns what to put in `brand.fonts`.
 */
export async function fetchFonts(scan: SiteScan, assetsDir: string): Promise<{ fonts: BrandFont[]; heading?: string; body?: string; headingWeight?: number }> {
  const want = new Map<string, Set<number>>();
  const add = (family: string, ...weights: number[]) => {
    if (!family) return;
    const s = want.get(family) ?? new Set();
    weights.forEach((w) => s.add(Math.min(900, Math.max(100, Math.round(w / 100) * 100))));
    want.set(family, s);
  };
  add(scan.fonts.heading.family, scan.fonts.heading.weight);
  add(scan.fonts.body.family, 400, 600);

  const fonts: BrandFont[] = [];
  const got = new Set<string>();
  await mkdir(join(assetsDir, "fonts"), { recursive: true });

  for (const [family, weights] of want) {
    const faces = scan.fontFaces.filter((f) => f.family.toLowerCase() === family.toLowerCase() && f.style === "normal");
    for (const weight of weights) {
      let file: { data: Uint8Array; ext: string } | null = null;
      let registeredWeight: number | undefined = weight;
      const face = [...faces].sort((a, b) => nearest(weight)(a.weight) - nearest(weight)(b.weight))[0];
      if (face) {
        const d = await download(face.url);
        if (d) {
          file = { data: d.data, ext: face.url.split("?")[0]!.split(".").pop()! };
          if (face.weight === 0) registeredWeight = undefined;
          else if (face.weight !== weight) registeredWeight = face.weight;
        }
      }
      if (!file) {
        const g = await googleFont(family, weight);
        if (g) {
          file = g;
          registeredWeight = g.weight;
        }
      }
      if (!file) continue;
      const name = `fonts/${slug(family)}-${registeredWeight ?? "variable"}.${file.ext}`;
      if (got.has(name)) continue;
      got.add(name);
      await writeFile(join(assetsDir, name), file.data);
      fonts.push({ family, src: name, ...(registeredWeight && { weight: registeredWeight }) });
    }
    if (!fonts.some((f) => f.family === family)) ui.warn(`Couldn't get the font files for "${family}". Cards will use the built-in font (Geist) instead.`);
  }

  const fallback = await fallbackFont(scan, assetsDir);
  if (fallback) fonts.push(fallback);

  const has = (f: string) => fonts.some((x) => x.family === f);
  return {
    fonts,
    heading: has(scan.fonts.heading.family) ? scan.fonts.heading.family : undefined,
    body: has(scan.fonts.body.family) ? scan.fonts.body.family : undefined,
    // The weight titles are drawn at: the site's own, or the nearest one we have a file for.
    headingWeight: closestWeight(fonts.filter((f) => f.family === scan.fonts.heading.family), scan.fonts.heading.weight),
  };
}

/**
 * Characters a brand font may not have but a card may well need: currency signs (₵ ₦ € …), letters
 * of Ghanaian and other African languages (ɛ ɔ ŋ), typographic punctuation, plus everything outside
 * plain Latin that the scanner saw on the site.
 */
const ALWAYS = "₵₦€£¥₹₩₺₽¢₱₴₸฿ɛɔŋƐƆŊɖƉƒʋƲɣƔ’‘“”–—…•·×÷±°™©®→←↑↓✓★";

/**
 * A small Noto Sans with just those characters, so a missing glyph never shows as a box. The card
 * renderer falls back to it by itself for any character the brand fonts lack.
 */
async function fallbackFont(scan: SiteScan, assetsDir: string): Promise<BrandFont | null> {
  const seen = [scan.name, scan.description, ...scan.pages.flatMap((p) => [p.title, p.description, p.h1, p.lead])].join("");
  const chars = new Set([...ALWAYS, ...[...seen].filter((c) => c.codePointAt(0)! > 0x7e)]);
  const r = await download(`https://fonts.googleapis.com/css2?family=Noto+Sans&text=${encodeURIComponent([...chars].join(""))}`);
  const url = r && new TextDecoder().decode(r.data).match(/src:\s*url\(([^)]+)\)/)?.[1];
  const f = url && (await download(url));
  if (!f) return null;
  await writeFile(join(assetsDir, "fonts/fallback.ttf"), f.data);
  return { family: "Noto Sans", src: "fonts/fallback.ttf" };
}

function closestWeight(faces: BrandFont[], want: number): number | undefined {
  if (!faces.length) return undefined;
  if (faces.some((f) => !f.weight)) return want;
  return faces.map((f) => f.weight!).sort((a, b) => Math.abs(a - want) - Math.abs(b - want))[0];
}

/* ------------------------------------------------------------------- logo */

const rank: Record<LogoCandidate["kind"], number> = { "header-svg": 0, "header-img": 1, "apple-touch-icon": 2, "manifest-icon": 3, icon: 4, "og-image": 9 };

function extFor(data: Uint8Array, type: string): string | null {
  if (data[0] === 0x89 && data[1] === 0x50) return "png";
  if (data[0] === 0xff && data[1] === 0xd8) return "jpg";
  if (data[8] === 0x57 && data[9] === 0x45) return "webp";
  if (type.includes("svg") || new TextDecoder().decode(data.subarray(0, 512)).includes("<svg")) return "svg";
  return null;
}

/** Can the card renderer actually draw this image? Some SVGs (sprites, CSS-driven ones) can't. */
async function drawable(src: string, data: Uint8Array): Promise<boolean> {
  try {
    await render(`<div style="display:flex;width:100%;height:100%"><img src="${src}" style="width:64px;height:64px"></div>`, { width: 64, height: 64, format: "png", images: [{ src, data }] });
    return true;
  } catch {
    return false;
  }
}

/** Picks the best logo the site has and saves it to assets/. Returns its file name. */
export async function fetchLogo(scan: SiteScan, assetsDir: string): Promise<string | undefined> {
  const candidates = [...scan.logos]
    .filter((l) => !(l.url ?? "").endsWith(".ico"))
    .sort((a, b) => rank[a.kind] - rank[b.kind] || b.width * b.height - a.width * a.height);
  for (const c of candidates) {
    let data: Uint8Array;
    let type = "";
    if (c.svg) data = new TextEncoder().encode(c.svg);
    else {
      const d = await download(c.url!);
      if (!d) continue;
      ({ data, type } = d);
    }
    const ext = extFor(data, type);
    if (!ext) continue;
    // Tiny raster header images look blurry on a card; an app icon is better.
    const size = imageSize(data);
    if (ext !== "svg" && size && Math.min(size.width, size.height) < 48) continue;
    if (!(await drawable(`logo.${ext}`, data))) continue;
    await writeFile(join(assetsDir, `logo.${ext}`), data);
    return `logo.${ext}`;
  }
  ui.warn("Couldn't find a logo the card renderer can draw. Put one in assets/ and set brand.logo.");
  return undefined;
}
