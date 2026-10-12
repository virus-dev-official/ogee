import { resolvePage, type ResolveOptions, type Site } from "./page.js";
import type { ResolvedPage } from "./types.js";
import { esc } from "./util.js";

/** Every path the site knows about: fixed routes plus whatever `sitemap.paths` returns. */
export async function listPaths(site: Site, opts: ResolveOptions = {}): Promise<string[]> {
  // In the order the config lists them, which is the order people expect.
  const fixed = site.routes.filter((r) => r.fixed).map((r) => r.pattern);
  const order = Object.keys(site.config.routes ?? {});
  fixed.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const sm = site.config.sitemap;
  let extra: string[] = [];
  if (sm && typeof sm === "object" && sm.paths) {
    try {
      extra = await sm.paths({ fetch: opts.fetch ?? fetch, env: opts.env ?? {} });
    } catch (e) {
      console.warn(`ogee: sitemap.paths failed: ${(e as Error).message}`);
    }
  }
  const all = new Set(["/", ...fixed, ...extra].map((p) => (p.length > 1 ? p.replace(/\/+$/, "") : p)));
  return [...all];
}

/** Resolves every listed page, skipping hidden, noindex and failing ones. Runs a few at a time. */
export async function listPages(site: Site, opts: ResolveOptions = {}): Promise<ResolvedPage[]> {
  const paths = await listPaths(site, opts);
  const out: (ResolvedPage | null)[] = new Array(paths.length).fill(null);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(6, paths.length) }, async () => {
      while (next < paths.length) {
        const i = next++;
        try {
          out[i] = await resolvePage(site, paths[i]!, opts);
        } catch {
          out[i] = null;
        }
      }
    }),
  );
  return out.filter((p): p is ResolvedPage => !!p && !p.hidden && !p.noindex && p.status === 200);
}

export function sitemapXml(pages: ResolvedPage[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.map((p) => `  <url><loc>${esc(p.canonical)}</loc></url>`).join("\n")}
</urlset>
`;
}

/** llms.txt (https://llmstxt.org): what the site is and its pages, for AI tools that don't run JavaScript. */
export function llmsTxt(site: Site, pages: ResolvedPage[]): string {
  const { config } = site;
  const lines = [`# ${config.name}`, ""];
  if (config.description) lines.push(`> ${config.description}`, "");
  lines.push("## Pages", "");
  for (const p of pages) lines.push(`- [${p.ogTitle}](${p.canonical})${p.description ? `: ${p.description}` : ""}`);
  return lines.join("\n") + "\n";
}
