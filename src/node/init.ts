import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { imageSize } from "../card.js";
import { titleFromPath } from "../page.js";
import { clip, isIdSegment } from "../templates.js";
import type { BrandFont } from "../types.js";
import { fetchFonts, fetchLogo } from "./assets.js";
import { launchBrowser } from "./browser.js";
import { scanSite, type PageScan, type SiteScan } from "./scan.js";
import { fail, pc, ui } from "./ui.js";

export interface InitOptions {
  dir: string;
  origin?: string;
  pages: number;
  install: boolean;
  force: boolean;
}

/** The ogee package's own folder, for linking a local checkout during development. */
export const packageRoot = () => resolve(dirname(fileURLToPath(import.meta.url)), "..");

export async function ogeeVersion(): Promise<string> {
  const root = packageRoot();
  // Running from a checkout (not from node_modules): link it, so `init` works before a release exists.
  if (!root.includes("node_modules")) return `file:${root}`;
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as { version: string };
  return `^${pkg.version}`;
}

export async function init(siteUrl: string, opts: InitOptions) {
  const dir = resolve(opts.dir);
  if (existsSync(join(dir, "ogee.config.ts")) && !opts.force) fail(`${relative(process.cwd(), dir) || "."}/ogee.config.ts already exists. Use --force to start over.`);
  const assetsDir = join(dir, "assets");
  await mkdir(assetsDir, { recursive: true });

  const browser = await launchBrowser();
  let scan: SiteScan;
  try {
    scan = await scanSite(opts.origin ?? siteUrl, { browser, pages: opts.pages });
  } finally {
    await browser.close();
  }
  // When the site is read from its origin, the public address is still the one the user gave.
  const site = new URL(/^https?:\/\//.test(siteUrl) ? siteUrl : `https://${siteUrl}`).origin;

  const trailingSlash = await usesTrailingSlash(scan);
  ui.step("Looking at each page's pictures");
  const pictures = await pagePictures(scan);
  ui.step("Getting the logo and fonts");
  const [logo, fonts] = await Promise.all([fetchLogo(scan, assetsDir), fetchFonts(scan, assetsDir)]);

  await writeFile(join(dir, "ogee.config.ts"), configSource(scan, site, { logo, ...fonts, origin: opts.origin, trailingSlash, pictures }));
  await writeFile(join(dir, "worker.ts"), WORKER);
  await writeFile(join(dir, "wrangler.toml"), wranglerToml(site, !!opts.origin));
  await writeFile(join(dir, ".gitignore"), "node_modules/\n.ogee/\n.wrangler/\n");
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify(
      {
        name: `ogee-${new URL(site).hostname.replace(/[^a-z0-9]+/g, "-")}`,
        private: true,
        type: "module",
        scripts: { dev: "ogee dev", render: "ogee render", deploy: "ogee deploy", check: `ogee check ${site}` },
        devDependencies: { ogee: await ogeeVersion(), wrangler: "^4.149.0" },
      },
      null,
      2,
    ) + "\n",
  );

  if (opts.install) {
    ui.step("Installing ogee and wrangler (npm install)");
    const r = spawnSync("npm", ["install", "--no-fund", "--no-audit", "--loglevel=error"], { cwd: dir, stdio: ui.json ? "ignore" : "inherit", shell: process.platform === "win32" });
    if (r.status !== 0) ui.warn("npm install failed; run it yourself in " + dir);
  }

  const rel = relative(process.cwd(), dir) || ".";
  if (ui.json) {
    console.log(JSON.stringify({ dir, site, name: scan.name, colors: scan.colors, logo, fonts: fonts.fonts, pages: scan.pages.map((p) => p.path) }, null, 2));
    return;
  }
  ui.ok(`Made ${pc.bold(rel + "/")} for ${pc.bold(scan.name)}`);
  ui.log(`
  ${pc.dim("brand")}    ${swatch(scan.colors.background)} ${swatch(scan.colors.foreground)} ${swatch(scan.colors.accent)}${scan.colors.accent2 ? " " + swatch(scan.colors.accent2) : ""}  ${pc.dim(fonts.heading ?? "Geist")}${fonts.body && fonts.body !== fonts.heading ? pc.dim(" / " + fonts.body) : ""}  ${pc.dim(logo ? "logo ✓" : "no logo")}
  ${pc.dim("pages")}    ${scan.pages.length} found  ${pc.dim(scan.pages.map((p) => p.path).slice(0, 6).join("  "))}

  Next:
    ${pc.cyan(`cd ${rel} && npx ogee render`)}   see every card in .ogee/cards/
    ${pc.cyan("npx ogee dev")}                     run the Worker locally against your site
    ${pc.cyan("npx ogee deploy")}                  put it live (needs your domain on Cloudflare)

  Using a coding agent? Tell it: ${pc.bold('"run npx ogee inspect --for-agent and make the cards look great"')}
`);
}

function swatch(hex: string) {
  const m = hex.match(/^#(..)(..)(..)$/);
  if (!m) return hex;
  const [r, g, b] = m.slice(1).map((h) => parseInt(h, 16));
  return `\x1b[48;2;${r};${g};${b}m    \x1b[0m ${pc.dim(hex)}`;
}

/* --------------------------------------------------------------- the files */

const WORKER = `// The ogee Worker. Everything about your pages lives in ogee.config.ts.
import { createWorker } from "ogee/worker";
import config from "./ogee.config";

export default createWorker(config);
`;

/** The zone (root domain) for a hostname. Knows the common two-part endings. */
export function zoneOf(host: string): string {
  const parts = host.replace(/^www\./, "").split(".");
  const twoPart = /^(co|com|org|net|gov|edu|ac)\.[a-z]{2}$/.test(parts.slice(-2).join("."));
  return parts.slice(twoPart ? -3 : -2).join(".");
}

function wranglerToml(site: string, separateOrigin: boolean) {
  const host = new URL(site).hostname;
  const route = separateOrigin
    ? `# The Worker answers on your domain itself and fetches pages from "origin" in ogee.config.ts.
routes = [{ pattern = "${host}", custom_domain = true }]`
    : `# The Worker runs in front of your site. ${host} must be a proxied (orange cloud) DNS record
# in your Cloudflare account. zone_name is your root domain.
routes = [{ pattern = "${host}/*", zone_name = "${zoneOf(host)}" }]`;
  return `name = "ogee-${host.replace(/[^a-z0-9]+/g, "-")}"
main = "worker.ts"
compatibility_date = "2026-10-01"
compatibility_flags = ["nodejs_compat"]
workers_dev = false

${route}

# Your logo, fonts and plates. The Worker reads them; it never serves them as pages.
[assets]
directory = "./assets"
binding = "ASSETS"
run_worker_first = true

[observability]
enabled = true
`;
}

const q = (s: string) => JSON.stringify(s);

function pageTitle(p: PageScan, home: PageScan, name: string): string {
  if (p.title && p.title !== home.title) {
    // "Pricing | Acme" → "Pricing"
    const parts = p.title.split(/\s+[|·•—–-]\s+/);
    const own = parts.filter((x) => x.trim().toLowerCase() !== name.toLowerCase());
    return (own[0] ?? p.title).trim();
  }
  if (p.h1 && p.h1.length <= 90) return p.h1;
  return titleFromPath(p.path);
}

function titleTemplate(scan: SiteScan): string {
  const others = scan.pages.filter((p) => p.path !== "/" && p.title && p.title !== scan.title);
  for (const sep of [" | ", " · ", " — ", " – ", " - "]) {
    if (others.some((p) => p.title.endsWith(sep + scan.name))) return `%s${sep}${scan.name}`;
  }
  return `%s · ${scan.name}`;
}

type Pictures = Map<string, { ogImage?: string; image?: string }>;

/**
 * Decides, per page, between a preview the page already has and a picture to draw into a card.
 * A page that sets its own card-shaped og:image (about 1.91:1) already has a designed preview: ogee
 * uses it as it is and makes sure bots see it. Any other picture goes inside ogee's card.
 */
async function pagePictures(scan: SiteScan): Promise<Pictures> {
  const out: Pictures = new Map();
  await Promise.all(
    scan.pages.map(async (p) => {
      if (p.ownOgImage) {
        const size = await remoteSize(p.ownOgImage);
        // Card-shaped and named like one: a designed preview. A card-shaped screenshot or upload is
        // just a picture, and looks better inside a card with the brand and the title.
        const looksLikeCard = /\/(og|og-?images?|opengraph|social|share|cards?|previews?)\/|og[-_]?image|opengraph|social[-_]?card/i.test(p.ownOgImage);
        if (size && looksLikeCard && Math.abs(size.width / size.height - 1.91) < 0.2) return void out.set(p.path, { ogImage: p.ownOgImage });
        if (size && !p.image) return void out.set(p.path, { image: p.ownOgImage });
      }
      if (p.image && p.path !== "/") out.set(p.path, { image: p.image });
    }),
  );
  return out;
}

async function remoteSize(url: string) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
    return r.ok ? imageSize(new Uint8Array(await r.arrayBuffer())) : null;
  } catch {
    return null;
  }
}

/** Does the site redirect /about to /about/? Then its canonical URLs need the slash. */
async function usesTrailingSlash(scan: SiteScan): Promise<boolean> {
  const path = scan.pages.find((p) => p.path !== "/")?.path;
  if (!path) return false;
  try {
    const r = await fetch(scan.origin + path, { redirect: "manual", signal: AbortSignal.timeout(8000) });
    const loc = r.headers.get("location") ?? "";
    return r.status >= 300 && r.status < 400 && new URL(loc, scan.origin).pathname === path + "/";
  } catch {
    return false;
  }
}

function configSource(scan: SiteScan, site: string, b: { logo?: string; fonts: BrandFont[]; heading?: string; body?: string; headingWeight?: number; origin?: string; trailingSlash: boolean; pictures: Pictures }) {
  const home = scan.pages.find((p) => p.path === "/") ?? scan.pages[0]!;
  const isData = (p: PageScan) => p.path.split("/").some(isIdSegment);
  const ordered = [...scan.pages.filter((p) => !isData(p)), ...scan.pages.filter(isData)];
  const firstData = ordered.findIndex(isData);
  const routes = ordered.map((p, i) => {
    const isHome = p.path === "/";
    const title = isHome ? home.title || scan.name : pageTitle(p, home, scan.name);
    const ownDescription = isHome ? home.description : p.description && p.description !== home.description ? p.description : p.lead;
    const desc = ownDescription ? clip(ownDescription, 180) : "";
    // A page's headline usually sells it better than its name: "Services" becomes the eyebrow,
    // "One team, from sketch to server." the card title.
    const headline = p.h1 && p.h1.length >= 12 && p.h1.length <= 90 && p.h1 !== title && !title.includes(p.h1) ? p.h1 : "";
    const short = !isHome && title.split(/\s+/).length <= 3;
    const extra = headline && (isHome || short) ? `, ogTitle: ${q(headline)}${short ? `, eyebrow: ${q(title)}` : ""}` : "";
    const pic = b.pictures.get(p.path);
    const image = pic?.ogImage ? `, ogImage: ${q(pic.ogImage)}` : pic?.image ? `, image: ${q(pic.image)}` : "";
    const line = `    ${q(p.path)}: { title: ${q(clip(title, 90))}${extra}${desc ? `, description: ${q(desc)}` : ""}${image} },`;
    if (i !== firstData) return line;
    const pattern = p.path.split("/").map((seg) => (isIdSegment(seg) ? ":id" : seg)).join("/");
    return `\n    // These look like pages from your data. A route function for "${pattern}" would cover new ones too.\n${line}`;
  });
  const template = scan.dark ? "glow" : "minimal";
  const brandLines = [
    b.logo && `logo: ${q(b.logo)},`,
    `colors: {`,
    `  background: ${q(scan.colors.background)},`,
    `  foreground: ${q(scan.colors.foreground)},`,
    `  accent: ${q(scan.colors.accent)},`,
    scan.colors.accent2 && `  accent2: ${q(scan.colors.accent2)},`,
    `},`,
    ...(b.fonts.length ? [`fonts: [`, ...b.fonts.map((f) => `  { family: ${q(f.family)}, src: ${q(f.src)}${f.weight ? `, weight: ${f.weight}` : ""} },`), `],`] : []),
    b.heading && `headingFont: ${q(b.heading)},`,
    b.body && b.body !== b.heading && `bodyFont: ${q(b.body)},`,
    b.headingWeight && b.headingWeight !== 700 && `headingWeight: ${b.headingWeight},`,
  ].filter(Boolean);
  return `import { defineConfig } from "ogee";

// Made by \`ogee init\` from ${scan.url}. Edit anything; \`npx ogee render\` shows the result.
export default defineConfig({
  site: ${q(site)},${b.origin ? `\n  // Where the pages really come from. The Worker fetches them from here.\n  origin: ${q(b.origin)},` : ""}
  name: ${q(scan.name)},
  description: ${q(clip(scan.description || "", 200))},
  titleTemplate: ${q(titleTemplate(scan))},${b.trailingSlash ? `\n  // Your pages live at /about/ (with the slash): canonical URLs and the sitemap follow.\n  trailingSlash: true,` : ""}${/^[a-z]{2}[-_][a-z]{2}$/i.test(scan.lang) ? `\n  locale: ${q(scan.lang.slice(0, 2).toLowerCase() + "_" + scan.lang.slice(3).toUpperCase())},` : ""}

  brand: {
${brandLines.map((l) => "    " + l).join("\n")}
  },

  // Built in: "minimal", "glow", "split", "bold". Or write your own in \`templates\`.
  card: { template: ${q(template)} },

  routes: {${[...b.pictures.values()].some((x) => x.ogImage) ? "\n    // ogImage: the page already has its own preview card, and ogee makes sure bots finally see it.\n    // Remove it to have ogee draw one instead. image: the page's picture, drawn into ogee's card." : ""}
${routes.join("\n")}

    // Pages that come from your data. Return null for ones that don't exist:
    // "/blog/:slug": async ({ params, fetch }) => {
    //   const post = await fetch(\`https://api.example.com/posts/\${params.slug}\`).then((r) => r.json());
    //   return { title: post.title, description: post.excerpt, image: post.cover, eyebrow: "Blog" };
    // },
  },
});
`;
}
