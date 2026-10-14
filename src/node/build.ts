import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { createCardRenderer } from "../card.js";
import { listPaths, llmsTxt, sitemapXml } from "../feeds.js";
import { rewriteHtml } from "../html.js";
import { resolvePage } from "../page.js";
import { cardPath } from "../routes.js";
import type { ResolvedPage } from "../types.js";
import { isAssetPath } from "../util.js";
import type { Project } from "./config.js";
import { fail, kb, pc, ui } from "./ui.js";

export interface BuiltPage {
  path: string;
  /** The HTML files written for it, relative to the build folder. */
  files: string[];
  card?: string;
  skipped?: string;
}

/**
 * The static version of the Worker: writes every known page's HTML, its card, sitemap.xml and llms.txt
 * into a built site, so it works on any static host with nothing running.
 *
 * Only pages ogee knows about at build time get their own HTML: fixed routes and `sitemap.paths`.
 * Anything else falls back to the host's own single-page-app handling, as before.
 */
export async function buildStatic(project: Project, dist: string): Promise<{ pages: BuiltPage[]; feeds: string[] }> {
  const shellFile = join(dist, "index.html");
  if (!existsSync(shellFile)) fail(`No index.html in ${dist}. Build your app first, then point ogee at its output folder (e.g. \`ogee build dist\`).`);
  // Read once, before the home page is rewritten in place: every page starts from the untouched shell.
  const shell = await readFile(shellFile, "utf8");
  const { site, config } = project;
  const renderer = createCardRenderer(site, project.load);
  const ext = config.card?.format === "jpeg" ? "jpg" : "png";

  const pages: BuiltPage[] = [];
  const listed: ResolvedPage[] = [];
  for (const path of await listPaths(site)) {
    if (isAssetPath(path)) {
      pages.push({ path, files: [], skipped: "looks like a file, not a page" });
      continue;
    }
    let page: ResolvedPage | null;
    try {
      page = await resolvePage(site, path);
    } catch (e) {
      ui.warn(`${path}: the route threw: ${(e as Error).message}`);
      pages.push({ path, files: [], skipped: `route failed: ${(e as Error).message}` });
      continue;
    }
    if (!page || page.status !== 200) {
      const why = !page ? "the route returned null" : `status ${page.status}: a static host can't send it`;
      ui.log(`  ${pc.dim("–")} ${path} ${pc.dim(`(${why})`)}`);
      pages.push({ path, files: [], skipped: why });
      continue;
    }

    const html = rewriteHtml(shell, site, page);
    const files = htmlFiles(path, !!config.trailingSlash);
    for (const f of files) {
      await mkdir(dirname(join(dist, f)), { recursive: true });
      await writeFile(join(dist, f), html);
    }

    let card: string | undefined;
    let size = 0;
    if (page.generated) {
      const img = await renderer.render(page);
      card = cardPath(path, ext).slice(1);
      await mkdir(dirname(join(dist, card)), { recursive: true });
      await writeFile(join(dist, card), img);
      size = img.length;
    }
    ui.log(`  ${pc.green("✓")} ${path.padEnd(28)} ${pc.dim(files.join(", "))}${card ? pc.dim(`  card ${kb(size)}`) : ""}`);
    pages.push({ path, files, card });
    if (!page.hidden && !page.noindex) listed.push(page);
  }

  const feeds: string[] = [];
  if (config.sitemap !== false) {
    await writeFile(join(dist, "sitemap.xml"), sitemapXml(listed));
    feeds.push("sitemap.xml");
  }
  if (config.llms !== false) {
    await writeFile(join(dist, "llms.txt"), llmsTxt(site, listed));
    feeds.push("llms.txt");
  }

  const patterns = site.routes.filter((r) => !r.fixed).map((r) => r.pattern);
  if (patterns.length) ui.log(pc.dim(`  Routes with parameters (${patterns.join(", ")}) only get pages for the paths \`sitemap.paths\` lists.`));
  ui.ok(`${pages.filter((p) => p.files.length).length} pages written into ${pc.cyan(relative(process.cwd(), dist) || ".")}${feeds.length ? ` with ${feeds.join(" and ")}` : ""}`);
  return { pages, feeds };
}

/**
 * Where a page's HTML goes. Hosts disagree on how "/about" finds its file: Netlify, Cloudflare Pages and
 * GitHub Pages look for about.html, Vercel and plain servers for about/index.html. Writing both works
 * everywhere; with trailing slashes, only the folder form is needed.
 */
export function htmlFiles(path: string, trailingSlash: boolean): string[] {
  if (path === "/") return ["index.html"];
  const p = path.slice(1);
  return trailingSlash ? [`${p}/index.html`] : [`${p}.html`, `${p}/index.html`];
}
