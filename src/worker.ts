/**
 * The ogee Worker: sits in front of a single-page app and gives every page its own <head>.
 *
 * Link previews (WhatsApp, X, LinkedIn, iMessage, Slack, Discord), search engines and AI crawlers
 * read a page's HTML without running JavaScript. A single-page app sends the same index.html for
 * every URL, so every link looks like the home page. This Worker rewrites that HTML on the way
 * out: title, description, canonical, Open Graph and Twitter tags, JSON-LD, and a preview card
 * drawn for that page. It also serves /sitemap.xml and /llms.txt.
 *
 * If anything goes wrong, the page is served exactly as the origin sent it: the site never breaks.
 */
import { createCardRenderer, type CardRenderer } from "./card.js";
import { listPages, llmsTxt, sitemapXml } from "./feeds.js";
import { headTags, prepare, resolvePage, type Site } from "./page.js";
import { normalizePath, pathFromCard } from "./routes.js";
import type { OgeeConfig, ResolvedPage } from "./types.js";
import { isAssetPath, trimSlash, withTimeout } from "./util.js";

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
export interface ExecutionContext {
  waitUntil(p: Promise<unknown>): void;
}

export interface OgeeEnv {
  /** The Workers static assets binding holding your ogee/assets folder (logo, fonts, plates). */
  ASSETS?: Fetcher;
  /** Overrides `origin` from the config; `ogee dev` sets it. */
  OGEE_ORIGIN?: string;
  [key: string]: unknown;
}

const PAGE_TIMEOUT_MS = 3000;

export interface WorkerOptions {
  /**
   * Where pages come from, when it isn't a server behind the Worker: for a site the same Worker
   * serves from static assets, pass `(req, env) => env.ASSETS.fetch(req)`. Takes precedence over
   * `origin` and OGEE_ORIGIN.
   */
  fetchOrigin?: (req: Request, env: OgeeEnv) => Promise<Response>
}

export function createWorker(config: OgeeConfig, options: WorkerOptions = {}) {
  const site = prepare(config);
  const ttl = config.cacheTtl ?? 300;
  let renderer: CardRenderer | null = null;

  const cachedFetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    fetch(input, { ...init, cf: { cacheTtl: ttl, cacheEverything: true } } as RequestInit)) as typeof fetch;

  function getRenderer(env: OgeeEnv): CardRenderer {
    return (renderer ??= createCardRenderer(
      site,
      async (path) => {
        if (!env.ASSETS) return null;
        const r = await env.ASSETS.fetch(new Request(`https://assets.local/${path}`));
        return r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
      },
      cachedFetch,
    ));
  }

  return {
    async fetch(req: Request, env: OgeeEnv = {}, ctx?: ExecutionContext): Promise<Response> {
      const originBase = env.OGEE_ORIGIN || config.origin;
      const url = new URL(req.url);
      const toOrigin = (r: Request = req) => (options.fetchOrigin ? options.fetchOrigin(r, env) : fromOrigin(r, url, originBase));

      if (req.method !== "GET" && req.method !== "HEAD") return toOrigin();
      const path = normalizePath(url.pathname);
      // Cards point at whatever host the page was served from, so previews work on preview deployments too.
      const publicOrigin = url.host === new URL(site.site).host ? site.site : url.origin;
      const opts = { url, fetch: cachedFetch, env, publicOrigin };

      try {
        const cardFor = pathFromCard(path);
        if (cardFor !== null) return await card(req, site, cardFor, getRenderer(env), { ...opts, url: new URL(cardFor, url) }, ttl, ctx);

        if (path === "/sitemap.xml" && config.sitemap !== false) {
          return text(sitemapXml(await listPages(site, opts)), "application/xml; charset=utf-8", ttl);
        }
        if (path === "/llms.txt" && config.llms !== false) {
          return text(llmsTxt(site, await listPages(site, opts)), "text/plain; charset=utf-8", ttl);
        }
      } catch (e) {
        console.error(`ogee: ${path}: ${(e as Error).stack ?? e}`);
        return new Response("ogee: something went wrong making this file", { status: 500 });
      }

      if (isAssetPath(path) || path.startsWith("/__ogee/")) return toOrigin();
      return page(req, site, path, opts, toOrigin);
    },
  };
}

async function fromOrigin(req: Request, url: URL, originBase: string | undefined): Promise<Response> {
  if (!originBase) return fetch(req);
  const target = new URL(url.pathname + url.search, trimSlash(originBase) + "/");
  const res = await fetch(new Request(target, req as RequestInit & Request), { redirect: "manual" } as RequestInit);
  const loc = res.headers.get("location");
  if (!loc) return res;
  // Redirects that point at the origin should point at the public site instead.
  const originHost = new URL(originBase).origin;
  if (!loc.startsWith(originHost) && !loc.startsWith("/")) return res;
  const out = new Response(res.body, res);
  out.headers.set("location", loc.startsWith("/") ? loc : url.origin + loc.slice(originHost.length));
  return out;
}

const text = (body: string, type: string, ttl: number) =>
  new Response(body, { headers: { "content-type": type, "cache-control": `public, max-age=${ttl}`, "access-control-allow-origin": "*" } });

async function card(req: Request, site: Site, path: string, renderer: CardRenderer, opts: Parameters<typeof resolvePage>[2], ttl: number, ctx?: ExecutionContext) {
  const cache = typeof caches !== "undefined" ? caches.default : null;
  const hit = cache && (await cache.match(req));
  if (hit) return hit;

  const p = await withTimeout(resolvePage(site, path, opts), PAGE_TIMEOUT_MS);
  if (!p || p.status !== 200) return new Response("No card for this page", { status: 404 });
  if (!p.generated) return Response.redirect(p.ogImage, 302);

  const img = await renderer.render(p);
  // A versioned URL never changes, so it can be cached for a long time.
  const maxAge = new URL(req.url).searchParams.has("v") ? 86400 * 7 : ttl;
  const res = new Response(img as Uint8Array<ArrayBuffer>, { headers: { "content-type": renderer.type, "cache-control": `public, max-age=${maxAge}`, "access-control-allow-origin": "*" } });
  if (cache) {
    const put = cache.put(req, res.clone()).catch(() => {});
    if (ctx) ctx.waitUntil(put);
    else await put;
  }
  return res;
}

async function page(req: Request, site: Site, path: string, opts: Parameters<typeof resolvePage>[2], toOrigin: (r: Request) => Promise<Response>): Promise<Response> {
  // Ask without validators: the HTML we send depends on the page, not just on index.html.
  const originReq = new Request(req);
  originReq.headers.delete("if-none-match");
  originReq.headers.delete("if-modified-since");

  const [origin, m] = await Promise.all([
    toOrigin(originReq),
    withTimeout(resolvePage(site, path, opts), PAGE_TIMEOUT_MS).catch((e) => {
      console.error(`ogee: couldn't work out ${path}: ${(e as Error).message}`);
      return null;
    }),
  ]);
  if (!m || !origin.ok || !(origin.headers.get("content-type") ?? "").includes("text/html")) return origin;
  return rewrite(req, site, m, origin);
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
  const headers = new Headers(out.headers);
  headers.delete("etag");
  headers.delete("last-modified");
  headers.delete("content-length");
  headers.set("cache-control", "public, max-age=0, must-revalidate");
  headers.set("x-ogee", "1");
  if (m.noindex) headers.set("x-robots-tag", "noindex");
  return new Response(req.method === "HEAD" ? null : out.body, { status: m.status, headers });
}

const escText = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
