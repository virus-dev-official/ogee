/**
 * What ogee does with a request, on any runtime that speaks `Request` and `Response`.
 *
 * The Cloudflare Worker (`worker.ts`) and the plain handler (`handler.ts`) are both this, with the
 * runtime's own pieces plugged in: how the HTML gets rewritten, where cards are cached, and where the
 * logo and fonts come from.
 *
 * If anything goes wrong, the page is served exactly as the origin sent it: the site never breaks.
 */
import { createCardRenderer, type CardRenderer } from "./card.js";
import { listPages, llmsTxt, sitemapXml } from "./feeds.js";
import { prepare, resolvePage, type ResolveOptions, type Site } from "./page.js";
import { normalizePath, pathFromCard } from "./routes.js";
import type { OgeeConfig, ResolvedPage } from "./types.js";
import { isAssetPath, trimSlash, withTimeout } from "./util.js";

export interface ExecutionContext {
  waitUntil(p: Promise<unknown>): void;
}

export interface OgeeEnv {
  /** Overrides `origin` from the config; `ogee dev` sets it. */
  OGEE_ORIGIN?: string;
  [key: string]: unknown;
}

/** Where drawn cards are kept between requests. */
export interface CardCache {
  match(req: Request): Promise<Response | undefined>;
  put(req: Request, res: Response): Promise<void>;
}

/** Writes a page's tags into the origin's HTML response. */
export type Rewrite = (req: Request, site: Site, page: ResolvedPage, origin: Response) => Response | Promise<Response>;

export interface CoreOptions<E extends OgeeEnv = OgeeEnv> {
  rewrite: Rewrite;
  /** Where pages come from, when it isn't `origin`. Takes precedence over `origin` and OGEE_ORIGIN. */
  fetchOrigin?: (req: Request, env: E) => Promise<Response>;
  /** Reads the logo, fonts and plates from the assets folder. */
  loadAsset?: (path: string, env: E) => Promise<Uint8Array | null>;
  cache?: CardCache | null;
  /** The fetch routes and cards use for https URLs. Defaults to the global fetch. */
  fetch?: typeof fetch;
  /** The fetch that gets pages from `origin`. Defaults to the global fetch. */
  originFetch?: typeof fetch;
}

const PAGE_TIMEOUT_MS = 3000;

export function createCore<E extends OgeeEnv = OgeeEnv>(config: OgeeConfig, options: CoreOptions<E>) {
  const site = prepare(config);
  const ttl = config.cacheTtl ?? 300;
  const fetcher = options.fetch ?? fetch;
  let renderer: CardRenderer | null = null;

  function getRenderer(env: E): CardRenderer {
    const load = options.loadAsset;
    return (renderer ??= createCardRenderer(site, async (path) => (load ? load(path, env) : null), fetcher));
  }

  return {
    async fetch(req: Request, env: E = {} as E, ctx?: ExecutionContext): Promise<Response> {
      const originBase = env.OGEE_ORIGIN || config.origin;
      const url = new URL(req.url);
      const toOrigin = (r: Request = req) => (options.fetchOrigin ? options.fetchOrigin(r, env) : fromOrigin(r, url, originBase, options.originFetch ?? fetch));

      if (req.method !== "GET" && req.method !== "HEAD") return toOrigin();
      const path = normalizePath(url.pathname);
      // Cards point at whatever host the page was served from, so previews work on preview deployments too.
      const publicOrigin = url.host === new URL(site.site).host ? site.site : url.origin;
      const opts: ResolveOptions = { url, fetch: fetcher, env, publicOrigin };

      try {
        const cardFor = pathFromCard(path);
        if (cardFor !== null) return await card(req, site, cardFor, getRenderer(env), { ...opts, url: new URL(cardFor, url) }, ttl, options.cache ?? null, ctx);

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
      return page(req, site, path, opts, toOrigin, options.rewrite);
    },
  };
}

async function fromOrigin(req: Request, url: URL, originBase: string | undefined, fetch: typeof globalThis.fetch): Promise<Response> {
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

async function card(req: Request, site: Site, path: string, renderer: CardRenderer, opts: ResolveOptions, ttl: number, cache: CardCache | null, ctx?: ExecutionContext) {
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

async function page(req: Request, site: Site, path: string, opts: ResolveOptions, toOrigin: (r: Request) => Promise<Response>, rewrite: Rewrite): Promise<Response> {
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

/** The response headers for a rewritten page. */
export function pageHeaders(from: Headers, m: ResolvedPage): Headers {
  const headers = new Headers(from);
  headers.delete("etag");
  headers.delete("last-modified");
  headers.delete("content-length");
  headers.set("cache-control", "public, max-age=0, must-revalidate");
  headers.set("x-ogee", "1");
  if (m.noindex) headers.set("x-robots-tag", "noindex");
  return headers;
}

export const escText = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
