import type { Browser, Page as PwPage } from "playwright-core";
import { contrast, luminance, parseColor, saturation, toHex, type RGB } from "../util.js";
import { ui } from "./ui.js";

export interface FontFace {
  family: string;
  weight: number;
  style: string;
  url: string;
}

export interface LogoCandidate {
  kind: "header-img" | "header-svg" | "apple-touch-icon" | "icon" | "manifest-icon" | "og-image";
  url?: string;
  svg?: string;
  width: number;
  height: number;
}

export interface PageScan {
  /** The page's main picture (product photo, cover, work sample), if it has one. */
  image: string;
  /** An og:image this page sets for itself (after JavaScript runs), different from the home page's. */
  ownOgImage: string;
  path: string;
  title: string;
  description: string;
  h1: string;
  lead: string;
  ogImage: string;
  screenshot?: string;
}

export interface SiteScan {
  url: string;
  origin: string;
  name: string;
  title: string;
  description: string;
  lang: string;
  colors: { background: string; foreground: string; accent: string; accent2?: string };
  dark: boolean;
  fonts: { heading: { family: string; weight: number }; body: { family: string; weight: number } };
  fontFaces: FontFace[];
  googleFamilies: string[];
  logos: LogoCandidate[];
  pages: PageScan[];
  /** Paths found in links and the sitemap, including ones we didn't open. */
  paths: string[];
}

/** Everything we read from the page in the browser in one go. */
interface Raw {
  title: string;
  description: string;
  ogSiteName: string;
  ogImage: string;
  lang: string;
  manifest: string;
  themeColor: string;
  backgrounds: { color: string; area: number }[];
  h1: { color: string; family: string; weight: string; text: string } | null;
  body: { color: string; family: string; weight: string };
  accents: { color: string; weight: number; source: string }[];
  fontFaces: FontFace[];
  googleLinks: string[];
  logos: LogoCandidate[];
  links: string[];
  lead: string;
}

/* This function runs inside the page. It must not use anything from outside its own body. */
function readPage(): Raw {
  const px = (el: Element) => el.getBoundingClientRect();
  const cs = (el: Element) => getComputedStyle(el);
  const meta = (sel: string) => document.querySelector(sel)?.getAttribute("content")?.trim() ?? "";
  const vw = innerWidth;
  const vh = innerHeight;

  // Turns any CSS color (oklch, hsl, color-mix…) into rgb() by letting the browser resolve it.
  const probe = document.createElement("div");
  probe.style.display = "none";
  document.body.appendChild(probe);
  const resolve = (value: string) => {
    probe.style.color = "";
    probe.style.color = value;
    if (!probe.style.color) return "";
    return getComputedStyle(probe).color;
  };
  const solid = (c: string) => !!c && c !== "transparent" && !/rgba\([^)]*,\s*0\)$/.test(c) && !/\/\s*0\)$/.test(c);

  // Backgrounds of big elements in the first screen, weighted by how much of it they cover.
  const backgrounds: Raw["backgrounds"] = [];
  const all = Array.from(document.querySelectorAll("body, body *")).slice(0, 4000);
  for (const el of [document.documentElement, ...all]) {
    const r = px(el);
    const visW = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0));
    const visH = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
    const area = (visW * visH) / (vw * vh);
    if (area < 0.25) continue;
    const bg = cs(el).backgroundColor;
    if (solid(bg)) backgrounds.push({ color: bg, area });
  }

  const accents: Raw["accents"] = [];
  // Design tokens: shadcn-style "--primary: 262 83% 58%" and plain "--brand: #7c3aed".
  const rootStyle = getComputedStyle(document.documentElement);
  const tokenNames = ["--primary", "--accent", "--brand", "--color-primary", "--color-accent", "--color-brand", "--brand-color", "--primary-color", "--theme-color", "--main-color"];
  for (const name of tokenNames) {
    const v = rootStyle.getPropertyValue(name).trim();
    if (!v) continue;
    const c = resolve(v) || resolve(`hsl(${v})`) || resolve(`oklch(${v})`);
    if (c) accents.push({ color: c, weight: 6, source: name });
  }
  // Buttons and call-to-action links.
  const buttons = Array.from(document.querySelectorAll('button, [role="button"], a[class*="btn" i], a[class*="button" i], input[type="submit"]')).slice(0, 60);
  for (const b of buttons) {
    const r = px(b);
    if (r.width < 40 || r.height < 20) continue;
    const s = cs(b);
    if (solid(s.backgroundColor)) accents.push({ color: s.backgroundColor, weight: r.top < vh ? 4 : 2, source: "button" });
    const g = s.backgroundImage.match(/(?:rgba?|hsla?|oklch|oklab|lab|lch|color)\([^)]*\)|#[0-9a-f]{3,8}/gi);
    g?.forEach((c) => accents.push({ color: resolve(c), weight: 3, source: "button-gradient" }));
  }
  // Decorative color: gradients and blurred blobs in the first screen.
  for (const el of all) {
    const r = px(el);
    if (r.top > vh || r.width < 120 || r.height < 120) continue;
    const s = cs(el);
    const g = s.backgroundImage !== "none" ? s.backgroundImage.match(/(?:rgba?|hsla?|oklch|oklab|lab|lch|color)\([^)]*\)|#[0-9a-f]{3,8}/gi) : null;
    g?.forEach((c) => accents.push({ color: resolve(c), weight: 2, source: "gradient" }));
    if (s.filter.includes("blur") && solid(s.backgroundColor)) accents.push({ color: s.backgroundColor, weight: 3, source: "blob" });
  }
  // Link colors, lightly.
  for (const a of Array.from(document.querySelectorAll("main a, article a, p a")).slice(0, 30)) accents.push({ color: cs(a).color, weight: 1, source: "link" });
  const theme = meta('meta[name="theme-color"]');
  if (theme) accents.push({ color: resolve(theme), weight: 2, source: "theme-color" });

  const h1El = document.querySelector("h1");
  const h1 = h1El ? { color: cs(h1El).color, family: cs(h1El).fontFamily, weight: cs(h1El).fontWeight, text: (((h1El as HTMLElement).innerText || h1El.textContent) ?? "").replace(/\s+/g, " ").trim() } : null;
  const bodyEl = document.querySelector("main p, p") ?? document.body;
  const body = { color: cs(bodyEl).color, family: cs(bodyEl).fontFamily, weight: cs(bodyEl).fontWeight };

  // @font-face rules we can read (same-origin stylesheets).
  const fontFaces: FontFace[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    const walk = (list: CSSRuleList) => {
      for (const rule of Array.from(list)) {
        if (rule instanceof CSSFontFaceRule) {
          const st = rule.style;
          const src = st.getPropertyValue("src");
          const urls = Array.from(src.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)).map((m) => m[1]!);
          const url = urls.find((u) => /\.(ttf|otf|woff)(\?|$)/i.test(u)) ?? urls.find((u) => /\.woff2(\?|$)/i.test(u)) ?? urls[0];
          if (!url || url.startsWith("data:")) continue;
          const weight = st.getPropertyValue("font-weight").trim() || "400";
          fontFaces.push({
            family: st.getPropertyValue("font-family").replace(/["']/g, "").trim(),
            // "100 900" is a variable font: 0 means "every weight is in this file".
            weight: /\s/.test(weight) ? 0 : parseInt(weight, 10) || (weight === "bold" ? 700 : 400),
            style: st.getPropertyValue("font-style").trim() || "normal",
            url: new URL(url, sheet.href ?? location.href).href,
          });
        } else if ("cssRules" in rule && (rule as CSSGroupingRule).cssRules) walk((rule as CSSGroupingRule).cssRules);
      }
    };
    walk(rules);
  }
  const googleLinks = Array.from(document.querySelectorAll('link[href*="fonts.googleapis.com"]')).map((l) => (l as HTMLLinkElement).href);
  // @import of Google Fonts inside readable sheets.
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      for (const rule of Array.from(sheet.cssRules)) if (rule instanceof CSSImportRule && rule.href.includes("fonts.googleapis.com")) googleLinks.push(rule.href);
    } catch {
      /* cross-origin */
    }
  }

  // Logos: images and inline SVGs in links to the home page, then icons.
  const logos: LogoCandidate[] = [];
  const homeLinks = Array.from(document.querySelectorAll("a[href]")).filter((a) => {
    try {
      const u = new URL((a as HTMLAnchorElement).href);
      return u.origin === location.origin && (u.pathname === "/" || u.pathname === "") && px(a).top < 200;
    } catch {
      return false;
    }
  });
  const logoSpots = [...homeLinks, ...Array.from(document.querySelectorAll('header [class*="logo" i], nav [class*="logo" i], [class*="logo" i]')).slice(0, 4)];
  for (const spot of logoSpots) {
    const img = (spot.matches("img") ? spot : spot.querySelector("img")) as HTMLImageElement | null;
    if (img && img.currentSrc && px(img).width > 8) {
      logos.push({ kind: "header-img", url: img.currentSrc, width: img.naturalWidth || px(img).width, height: img.naturalHeight || px(img).height });
      continue;
    }
    const svg = (spot.matches("svg") ? spot : spot.querySelector("svg")) as SVGSVGElement | null;
    if (svg && px(svg).width > 8) {
      const r = px(svg);
      const clone = svg.cloneNode(true) as SVGSVGElement;
      const color = cs(svg).color;
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      if (!clone.getAttribute("viewBox")) clone.setAttribute("viewBox", `0 0 ${r.width} ${r.height}`);
      clone.setAttribute("width", String(Math.round(r.width)));
      clone.setAttribute("height", String(Math.round(r.height)));
      // Fill in what CSS gave the SVG, so it looks the same as a standalone file.
      const src = [svg, ...Array.from(svg.querySelectorAll("*"))];
      const dst = [clone, ...Array.from(clone.querySelectorAll("*"))];
      src.forEach((el, i) => {
        const s = cs(el);
        const d = dst[i] as SVGElement;
        if (!d) return;
        if (s.fill && s.fill !== "none" && !d.getAttribute("fill")) d.setAttribute("fill", s.fill);
        if (s.stroke && s.stroke !== "none" && !d.getAttribute("stroke")) d.setAttribute("stroke", s.stroke);
      });
      logos.push({ kind: "header-svg", svg: clone.outerHTML.replace(/currentColor/g, color), width: r.width, height: r.height });
    }
  }
  for (const l of Array.from(document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"], link[rel="apple-touch-icon-precomposed"], link[rel="shortcut icon"]'))) {
    const link = l as HTMLLinkElement;
    const size = parseInt((link.getAttribute("sizes") ?? "").split("x")[0] ?? "", 10) || (link.rel.includes("apple") ? 180 : link.href.endsWith(".svg") ? 512 : 32);
    logos.push({ kind: link.rel.includes("apple") ? "apple-touch-icon" : "icon", url: link.href, width: size, height: size });
  }

  const links = Array.from(document.querySelectorAll("a[href]"))
    .map((a) => {
      try {
        const u = new URL((a as HTMLAnchorElement).href);
        return u.origin === location.origin ? u.pathname : "";
      } catch {
        return "";
      }
    })
    .filter(Boolean);

  const lead = Array.from(document.querySelectorAll("main p, header p, section p, p"))
    .map((p) => (((p as HTMLElement).innerText || p.textContent) ?? "").replace(/\s+/g, " ").trim())
    .find((t) => t.length >= 50 && t.length <= 400) ?? "";

  probe.remove();
  return {
    title: document.title.trim(),
    description: meta('meta[name="description"]') || meta('meta[property="og:description"]'),
    ogSiteName: meta('meta[property="og:site_name"]'),
    ogImage: meta('meta[property="og:image"]'),
    lang: document.documentElement.lang,
    manifest: (document.querySelector('link[rel="manifest"]') as HTMLLinkElement | null)?.href ?? "",
    themeColor: theme,
    backgrounds,
    h1,
    body,
    accents,
    fontFaces,
    googleLinks,
    logos,
    links,
    lead,
  };
}

/**
 * The picture a page is about: the biggest image near the top that isn't the logo, an icon or a
 * decoration. Runs inside the page, so it must not use anything from outside its own body.
 */
function mainImage(): string {
  const vw = innerWidth;
  const vh = innerHeight;
  const found: { src: string; area: number }[] = [];
  for (const img of Array.from(document.images)) {
    const r = img.getBoundingClientRect();
    if (r.top > vh * 1.3 || r.bottom < 0 || r.width < 160 || r.height < 120) continue;
    if (img.closest("header, nav, footer, [class*='logo' i], [aria-hidden='true']")) continue;
    if ((img.naturalWidth || 0) < 300 || !img.currentSrc || img.currentSrc.startsWith("data:")) continue;
    if (/\.svg(\?|$)/i.test(img.currentSrc) || /avatar|logo|icon|sprite/i.test(img.currentSrc + " " + img.alt)) continue;
    const s = getComputedStyle(img);
    if (s.visibility === "hidden" || parseFloat(s.opacity) < 0.3) continue;
    const area = Math.min(r.width, vw) * Math.min(r.height, vh);
    if (area > vw * vh * 0.05) found.push({ src: img.currentSrc, area });
  }
  found.sort((a, b) => b.area - a.area);
  const best = found[0];
  if (!best) return "";
  // Three or more pictures about as big as the biggest: a grid of things, not one page's picture.
  if (found.filter((f) => f.area >= best.area * 0.6).length >= 3) return "";
  return best.src;
}

async function open(page: PwPage, url: string) {
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
  } catch {
    // Sites with long-polling never go idle; whatever has loaded by now will do.
  }
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  await page.waitForTimeout(900);
}

const firstFamily = (stack: string) => stack.split(",")[0]!.replace(/["']/g, "").trim();
const GENERIC = new Set(["serif", "sans-serif", "monospace", "system-ui", "ui-sans-serif", "ui-serif", "ui-monospace", "-apple-system", "blinkmacsystemfont", "cursive", "fantasy", "segoe ui", "helvetica", "arial", "helvetica neue", "roboto"]);

function pickColors(raw: Raw): SiteScan["colors"] {
  const bgVotes = new Map<string, number>();
  for (const b of raw.backgrounds) {
    const c = parseColor(b.color);
    if (c) bgVotes.set(toHex(c), (bgVotes.get(toHex(c)) ?? 0) + b.area);
  }
  // The last big element covering the screen is the one you actually see.
  const top = raw.backgrounds.length ? parseColor(raw.backgrounds[raw.backgrounds.length - 1]!.color) : null;
  const bg: RGB = top ?? ([...bgVotes.entries()].sort((a, b) => b[1] - a[1]).map(([h]) => parseColor(h))[0] ?? [255, 255, 255]);

  let fg = parseColor(raw.h1?.color ?? "") ?? parseColor(raw.body.color) ?? [17, 17, 17];
  if (contrast(fg, bg) < 3) fg = contrast([255, 255, 255], bg) > contrast([10, 10, 10], bg) ? [250, 250, 250] : [17, 17, 17];

  const scores = new Map<string, number>();
  for (const a of raw.accents) {
    const c = parseColor(a.color);
    if (!c) continue;
    const sat = saturation(c);
    if (sat < 0.22 || contrast(c, bg) < 1.25 || contrast(c, fg) < 1.25) continue;
    const key = toHex(c);
    scores.set(key, (scores.get(key) ?? 0) + a.weight * (0.5 + sat));
  }
  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([h]) => h);
  const accent = ranked[0] ?? toHex(fg);
  // A second accent only if it's clearly a different color.
  const ac = parseColor(accent)!;
  const accent2 = ranked.slice(1).find((h) => {
    const c = parseColor(h)!;
    return Math.abs(hue(c) - hue(ac)) > 25 && Math.abs(hue(c) - hue(ac)) < 335;
  });
  return { background: toHex(bg), foreground: toHex(fg), accent, ...(accent2 && { accent2 }) };
}

function hue([r, g, b]: RGB): number {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const d = max - Math.min(R, G, B);
  if (!d) return 0;
  const h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return (h * 60 + 360) % 360;
}

function siteName(raw: Raw, manifestName: string, host: string): string {
  if (raw.ogSiteName) return raw.ogSiteName;
  if (manifestName) return manifestName;
  const parts = raw.title.split(/\s+[|·•—–-]\s+/).map((s) => s.trim()).filter(Boolean);
  if (parts.length > 1) return parts.sort((a, b) => a.length - b.length)[0]!;
  if (raw.title && raw.title.length <= 30) return raw.title;
  const base = host.replace(/^www\./, "").split(".")[0] ?? host;
  return base[0]!.toUpperCase() + base.slice(1);
}

export interface ScanOptions {
  /** How many pages to open besides the home page. */
  pages?: number;
  /** Save screenshots of every page into this folder. */
  screenshots?: string;
  browser: Browser;
}

export async function scanSite(input: string, opts: ScanOptions): Promise<SiteScan> {
  const url = new URL(/^https?:\/\//.test(input) ? input : `https://${input}`);
  const ctx = await opts.browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: "light", userAgent: undefined });
  const page = await ctx.newPage();
  ui.step(`Opening ${url.href}`);
  await open(page, url.href);
  const origin = new URL(page.url()).origin;
  const raw = await page.evaluate(readPage);

  let manifestName = "";
  if (raw.manifest) {
    try {
      const m = (await (await fetch(raw.manifest, { signal: AbortSignal.timeout(8000) })).json()) as { name?: string; short_name?: string; icons?: { src: string; sizes?: string }[] };
      manifestName = m.short_name || m.name || "";
      for (const icon of m.icons ?? []) {
        const s = parseInt((icon.sizes ?? "").split("x")[0] ?? "", 10) || 192;
        raw.logos.push({ kind: "manifest-icon", url: new URL(icon.src, raw.manifest).href, width: s, height: s });
      }
    } catch {
      /* no manifest, no problem */
    }
  }

  // Pages: links on the home page, plus the sitemap if there is one.
  const paths = new Set<string>(["/"]);
  const keep = (p: string) => p && !/\.[a-z0-9]{2,5}$/i.test(p) && !p.startsWith("/cdn-cgi") && !/\/(login|signin|sign-in|signup|sign-up|register|logout|auth|admin|dashboard|account|settings|cart|checkout)(\/|$)/i.test(p);
  for (const l of raw.links) {
    const p = l.length > 1 ? l.replace(/\/+$/, "") : l;
    if (keep(p)) paths.add(p);
  }
  try {
    const r = await fetch(new URL("/sitemap.xml", origin), { signal: AbortSignal.timeout(8000) });
    if (r.ok && (r.headers.get("content-type") ?? "").includes("xml")) {
      for (const m of (await r.text()).matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
        try {
          const u = new URL(m[1]!);
          if (u.origin === origin && keep(u.pathname)) paths.add(u.pathname.length > 1 ? u.pathname.replace(/\/+$/, "") : "/");
        } catch {
          /* skip */
        }
      }
    }
  } catch {
    /* no sitemap */
  }

  const pages: PageScan[] = [];
  const shoot = async (path: string) => {
    if (!opts.screenshots) return undefined;
    const name = path === "/" ? "home" : path.slice(1).replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    const file = `${opts.screenshots}/${name}.png`;
    await page.screenshot({ path: file });
    return file;
  };
  pages.push({ path: "/", title: raw.title, description: raw.description, h1: raw.h1?.text ?? "", lead: raw.lead, ogImage: raw.ogImage, ownOgImage: "", image: await page.evaluate(mainImage), screenshot: await shoot("/") });

  // Mobile screenshot of the home page: agents use it to see how the brand holds up small.
  if (opts.screenshots) {
    const m = await opts.browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true });
    const mp = await m.newPage();
    await open(mp, url.href);
    await mp.screenshot({ path: `${opts.screenshots}/home-mobile.png` });
    await m.close();
  }

  const toVisit = [...paths].filter((p) => p !== "/").slice(0, opts.pages ?? 12);
  for (const path of toVisit) {
    ui.step(`Reading ${path}`);
    try {
      await open(page, origin + path);
      if (new URL(page.url()).pathname.replace(/\/+$/, "") !== path && page.url() !== origin + path) {
        // It redirected (often to a login page): not a public page.
        continue;
      }
      const r = await page.evaluate(() => {
        const meta = (sel: string) => document.querySelector(sel)?.getAttribute("content")?.trim() ?? "";
        const h1El = document.querySelector("h1") as HTMLElement | null;
        const h1 = ((h1El?.innerText || h1El?.textContent) ?? "").replace(/\s+/g, " ").trim();
        const lead = Array.from(document.querySelectorAll("main p, header p, section p, p"))
          .map((p) => (((p as HTMLElement).innerText || p.textContent) ?? "").replace(/\s+/g, " ").trim())
          .find((t) => t.length >= 50 && t.length <= 400) ?? "";
        return { title: document.title.trim(), description: meta('meta[name="description"]') || meta('meta[property="og:description"]'), h1, lead, ogImage: meta('meta[property="og:image"]') };
      });
      const ownOgImage = r.ogImage && r.ogImage !== raw.ogImage ? new URL(r.ogImage, origin + path).href : "";
      pages.push({ path, ...r, ownOgImage, image: await page.evaluate(mainImage), screenshot: await shoot(path) });
    } catch (e) {
      ui.warn(`Couldn't read ${path}: ${(e as Error).message.split("\n")[0]}`);
    }
  }
  await ctx.close();

  const colors = pickColors(raw);
  const headingFamily = firstFamily(raw.h1?.family ?? raw.body.family);
  const bodyFamily = firstFamily(raw.body.family);
  const googleFamilies = [...new Set(raw.googleLinks.flatMap((l) => [...new URL(l).searchParams.getAll("family")].map((f) => f.split(":")[0]!.replace(/\+/g, " "))))];

  return {
    url: url.href,
    origin,
    name: siteName(raw, manifestName, url.host),
    title: raw.title,
    description: raw.description || raw.lead.slice(0, 200),
    lang: raw.lang,
    colors,
    dark: luminance(parseColor(colors.background) ?? [255, 255, 255]) < 0.4,
    fonts: {
      heading: { family: GENERIC.has(headingFamily.toLowerCase()) ? "" : headingFamily, weight: parseInt(raw.h1?.weight ?? "700", 10) || 700 },
      body: { family: GENERIC.has(bodyFamily.toLowerCase()) ? "" : bodyFamily, weight: parseInt(raw.body.weight, 10) || 400 },
    },
    fontFaces: raw.fontFaces,
    googleFamilies,
    logos: raw.logos,
    pages,
    paths: [...paths],
  };
}
