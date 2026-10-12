import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { createCardRenderer } from "../card.js";
import { listPaths } from "../feeds.js";
import { resolvePage } from "../page.js";
import type { ResolvedPage } from "../types.js";
import { esc } from "../util.js";
import type { Project } from "./config.js";
import { kb, pc, ui } from "./ui.js";

export interface RenderedCard {
  path: string;
  file?: string;
  bytes?: number;
  ms?: number;
  title: string;
  description: string;
  template: string;
  /** Set when the card is too heavy for some apps. */
  warning?: string;
  /** Set when the page uses its own og:image instead of a card. */
  ogImage?: string;
  error?: string;
}

export const cardFileName = (path: string, ext = "png") => (path === "/" ? "home" : path.slice(1).replace(/[^a-z0-9]+/gi, "-").toLowerCase()) + "." + ext;

/** Renders cards for the given paths (or every known page) into `out`, plus an index.html to look at them. */
export async function renderCards(project: Project, opts: { paths?: string[]; out?: string; template?: string; clean?: boolean } = {}): Promise<{ out: string; cards: RenderedCard[] }> {
  const out = opts.out ?? join(project.dir, ".ogee", "cards");
  if (opts.clean !== false) await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  const { site } = project;
  const renderer = createCardRenderer(site, project.load);
  const paths = opts.paths?.length ? opts.paths : await listPaths(site);
  const patterns = site.routes.filter((r) => !r.fixed).map((r) => r.pattern);
  if (!opts.paths?.length && patterns.length) ui.log(pc.dim(`  Routes with parameters (${patterns.join(", ")}) need an example path: ogee render ${patterns[0]!.replace(/:(\w+)/g, "example-$1").replace("*", "example")}`));

  const ext = site.config.card?.format === "jpeg" ? "jpg" : "png";
  let heavy = 0;
  const cards: RenderedCard[] = [];
  for (const path of paths) {
    let page: ResolvedPage | null;
    try {
      page = await resolvePage(site, path);
    } catch (e) {
      cards.push({ path, title: "", description: "", template: "", error: `route failed: ${(e as Error).message}` });
      ui.warn(`${path}: the route threw: ${(e as Error).message}`);
      continue;
    }
    if (!page) {
      ui.log(`  ${pc.dim("–")} ${path} ${pc.dim("(no page: the route returned null)")}`);
      continue;
    }
    if (opts.template) page = { ...page, template: opts.template };
    const base = { path, title: page.ogTitle, description: page.description, template: page.template };
    if (!page.generated) {
      cards.push({ ...base, ogImage: page.ogImage });
      ui.log(`  ${pc.dim("→")} ${path.padEnd(28)} ${pc.dim("uses its own image " + page.ogImage)}`);
      continue;
    }
    const t = performance.now();
    try {
      const img = await renderer.render(page);
      const file = join(out, cardFileName(path, ext));
      await writeFile(file, img);
      const ms = Math.round(performance.now() - t);
      cards.push({ ...base, file, bytes: img.length, ms, ...(img.length > HEAVY && { warning: heavyWarning(img.length, ext) }) });
      ui.log(`  ${pc.green("✓")} ${path.padEnd(28)} ${pc.dim(`${page.template.padEnd(8)} ${kb(img.length).padStart(7)}  ${ms}ms`)}  ${pc.dim(relative(process.cwd(), file))}`);
      if (img.length > HEAVY) heavy++;
    } catch (e) {
      cards.push({ ...base, error: (e as Error).message });
      ui.warn(`${path}: ${(e as Error).message}`);
    }
  }
  if (heavy) ui.warn(heavyWarning(Math.max(...cards.map((c) => c.bytes ?? 0)), ext) + ` (${heavy} card${heavy > 1 ? "s" : ""})`);
  await writeFile(join(out, "index.html"), gallery(project, cards, ext));
  return { out, cards };
}

/** WhatsApp often drops preview images heavier than this. */
const HEAVY = 600 * 1024;
const heavyWarning = (bytes: number, ext: string) =>
  ext === "png"
    ? `Cards up to ${kb(bytes)}: too heavy for WhatsApp previews (aim for under 600 KB). Set card: { format: "jpeg" } in ogee.config.ts.`
    : `Cards up to ${kb(bytes)}: too heavy for WhatsApp previews (aim for under 600 KB). Lower card.quality or simplify the background.`;

function gallery(project: Project, cards: RenderedCard[], ext: string) {
  const host = new URL(project.site.site).host.replace(/^www\./, "");
  const items = cards
    .filter((c) => c.file || c.ogImage)
    .map((c) => {
      const src = c.file ? cardFileName(c.path, ext) : c.ogImage!;
      return `<section>
  <h2><code>${esc(c.path)}</code> <span>${esc(c.template)}${c.bytes ? ` · ${kb(c.bytes)}` : ""}</span></h2>
  <div class="row">
    <img class="card" src="${esc(src)}" alt="">
    <div class="mocks">
      <div class="wa"><div class="bubble"><img src="${esc(src)}" alt=""><div class="meta"><b>${esc(c.title)}</b><p>${esc(c.description)}</p><small>${esc(host)}</small></div><div class="link">https://${esc(host)}${c.path === "/" ? "" : esc(c.path)}</div></div></div>
      <div class="x"><img src="${esc(src)}" alt=""><div class="xmeta">${esc(host)}</div></div>
    </div>
  </div>
</section>`;
    })
    .join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Cards · ${esc(project.config.name)}</title>
<style>
  :root { color-scheme: light dark; --bg:#f6f6f4; --fg:#151515; --muted:#6b6b6b; --line:#e2e2de; }
  @media (prefers-color-scheme: dark) { :root { --bg:#111113; --fg:#ededed; --muted:#9a9a9a; --line:#2a2a2e; } }
  body { margin:0; background:var(--bg); color:var(--fg); font:15px/1.5 system-ui, sans-serif; }
  header { padding:28px 32px 8px; } header h1 { margin:0; font-size:20px; } header p { margin:4px 0 0; color:var(--muted); }
  section { padding:24px 32px; border-bottom:1px solid var(--line); }
  h2 { font-size:15px; margin:0 0 12px; } h2 span { color:var(--muted); font-weight:400; margin-left:8px; }
  .row { display:flex; gap:28px; flex-wrap:wrap; align-items:flex-start; }
  .card { width:min(600px,100%); border-radius:10px; box-shadow:0 1px 3px rgb(0 0 0/.15); }
  .mocks { display:flex; flex-direction:column; gap:18px; }
  .wa { background:#0b141a; padding:14px; border-radius:12px; width:300px; }
  .bubble { background:#005c4b; border-radius:8px; padding:4px; color:#e9edef; font-size:13px; }
  .bubble img { width:100%; border-radius:6px 6px 0 0; display:block; }
  .meta { background:#025144; padding:8px 10px; } .meta b { display:block; } .meta p { margin:2px 0; color:#aebac1; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; } .meta small { color:#8696a0; }
  .link { padding:6px 8px; color:#53bdeb; word-break:break-all; }
  .x { width:300px; border:1px solid var(--line); border-radius:16px; overflow:hidden; position:relative; }
  .x img { width:100%; display:block; } .xmeta { position:absolute; left:10px; bottom:10px; background:rgb(0 0 0/.75); color:#fff; font-size:12px; padding:1px 6px; border-radius:4px; }
</style></head><body>
<header><h1>${esc(project.config.name)}: link previews</h1><p>${cards.length} pages · made by ogee</p></header>
${items}
</body></html>`;
}
