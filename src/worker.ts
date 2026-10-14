/**
 * The ogee Worker: sits in front of a single-page app and gives every page its own <head>.
 *
 * Link previews (WhatsApp, X, LinkedIn, iMessage, Slack, Discord), search engines and AI crawlers
 * read a page's HTML without running JavaScript. A single-page app sends the same index.html for
 * every URL, so every link looks like the home page. This Worker rewrites that HTML on the way
 * out: title, description, canonical, Open Graph and Twitter tags, JSON-LD, and a preview card
 * drawn for that page. It also serves /sitemap.xml and /llms.txt.
 *
 * The request handling itself lives in core.ts; this file plugs in Cloudflare's pieces: HTMLRewriter,
 * the edge cache, `cf` fetch options and the static assets binding.
 */
import { createCore, escText, pageHeaders, type OgeeEnv as CoreEnv } from "./core.js";
import { headTags, type Site } from "./page.js";
import type { OgeeConfig, ResolvedPage } from "./types.js";

export type { ExecutionContext } from "./core.js";

/* Just the bits of the Workers runtime we use, so this file doesn't need the full Workers types. */
interface RewriterElement {
  remove(): void;
  append(content: string, opts?: { html: boolean }): void;
  setInnerContent(content: string, opts?: { html: boolean }): void;
}
declare class HTMLRewriter {
  on(selector: string, handlers: { element(el: RewriterElement): void }): HTMLRewriter;
  transform(r: Response): Response;
}
declare const caches: { default: { match(r: Request): Promise<Response | undefined>; put(r: Request, res: Response): Promise<void> } };
interface Fetcher {
  fetch(input: Request | string | URL): Promise<Response>;
}

export interface OgeeEnv extends CoreEnv {
  /** The Workers static assets binding holding your ogee/assets folder (logo, fonts, plates). */
  ASSETS?: Fetcher;
}

export interface WorkerOptions {
  /**
   * Where pages come from, when it isn't a server behind the Worker: for a site the same Worker
   * serves from static assets, pass `(req, env) => env.ASSETS.fetch(req)`. Takes precedence over
   * `origin` and OGEE_ORIGIN.
   */
  fetchOrigin?: (req: Request, env: OgeeEnv) => Promise<Response>;
}

export function createWorker(config: OgeeConfig, options: WorkerOptions = {}) {
  const ttl = config.cacheTtl ?? 300;
  const cachedFetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    fetch(input, { ...init, cf: { cacheTtl: ttl, cacheEverything: true } } as RequestInit)) as typeof fetch;

  return createCore<OgeeEnv>(config, {
    rewrite,
    fetchOrigin: options.fetchOrigin,
    fetch: cachedFetch,
    cache: typeof caches !== "undefined" ? caches.default : null,
    async loadAsset(path, env) {
      if (!env.ASSETS) return null;
      const r = await env.ASSETS.fetch(new Request(`https://assets.local/${path}`));
      return r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
    },
  });
}

const drop = { element: (el: RewriterElement) => el.remove() };

export function rewrite(req: Request, site: Site, m: ResolvedPage, origin: Response): Response {
  let mounted = false;
  let rw = new HTMLRewriter()
    .on("head title", drop)
    .on('head meta[name="description"]', drop)
    .on('head meta[name="robots"]', drop)
    .on('head link[rel="canonical"]', drop)
    .on('head meta[property^="og:"]', drop)
    .on('head meta[name^="twitter:"]', drop)
    .on('head script[type="application/ld+json"]', drop)
    .on("head", { element: (el) => el.append(`<title>${escText(m.title)}</title>` + headTags(site, m), { html: true }) });

  if (m.html) {
    for (const sel of (site.config.mount ?? "#root, #app").split(",").map((s) => s.trim()).filter(Boolean)) {
      rw = rw.on(sel, {
        element: (el) => {
          if (mounted) return;
          mounted = true;
          el.setInnerContent(m.html!, { html: true });
        },
      });
    }
  }

  const out = rw.transform(origin);
  return new Response(req.method === "HEAD" ? null : out.body, { status: m.status, headers: pageHeaders(out.headers, m) });
}
