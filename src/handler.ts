/**
 * ogee as a plain fetch handler, `(Request) => Promise<Response>`, for any runtime that has the web
 * `Request` and `Response`: Node 20+, Bun, Deno, Vercel and Netlify edge functions, Hono, and so on.
 *
 *   import { createHandler } from "@virusdev/ogee/handler";
 *   import config from "./ogee.config";
 *   const ogee = createHandler(config, { origin: "http://localhost:4173" });
 *   Bun.serve({ fetch: (req) => ogee.fetch(req) });
 *
 * On Cloudflare, use `@virusdev/ogee/worker` instead: it streams the HTML and uses the edge cache.
 */
import { createCore, pageHeaders, type CardCache, type ExecutionContext, type OgeeEnv } from "./core.js";
import { rewriteHtml } from "./html.js";
import type { Site } from "./page.js";
import type { OgeeConfig, ResolvedPage } from "./types.js";

export type { CardCache, ExecutionContext, OgeeEnv } from "./core.js";
export { rewriteHtml } from "./html.js";

export interface HandlerOptions {
  /** Where pages come from. Overrides `origin` in the config. */
  origin?: string;
  /** Or fetch pages yourself, e.g. from a static folder. Takes precedence over `origin`. */
  fetchOrigin?: (req: Request, env: OgeeEnv) => Promise<Response>;
  /**
   * Reads the logo, fonts and plates (paths relative to the assets folder). In Node:
   * `(p) => readFile(join("ogee/assets", p)).then((b) => new Uint8Array(b), () => null)`.
   */
  loadAsset?: (path: string) => Promise<Uint8Array | null>;
  /** Where drawn cards are kept. Defaults to an in-memory cache of the last 200; null turns it off. */
  cache?: CardCache | null;
  fetch?: typeof fetch;
}

export function createHandler(config: OgeeConfig, options: HandlerOptions = {}) {
  // Without one, pages would be fetched from this very server, forever.
  if (!options.fetchOrigin && !options.origin && !config.origin) throw new Error(`ogee: createHandler needs an \`origin\` (where the pages come from) or a \`fetchOrigin\` function`);
  const core = createCore(options.origin ? { ...config, origin: options.origin } : config, {
    rewrite,
    fetchOrigin: options.fetchOrigin,
    loadAsset: options.loadAsset && ((path) => options.loadAsset!(path)),
    cache: options.cache === undefined ? memoryCache(200) : options.cache,
    fetch: options.fetch,
    originFetch: decodedFetch,
  });
  return {
    fetch: (req: Request, env?: OgeeEnv, ctx?: ExecutionContext) => core.fetch(req, env, ctx),
  };
}

async function rewrite(req: Request, site: Site, m: ResolvedPage, origin: Response): Promise<Response> {
  const html = await origin.text();
  let out: string;
  try {
    out = rewriteHtml(html, site, m);
  } catch (e) {
    console.error(`ogee: couldn't rewrite ${m.path}: ${(e as Error).message}`);
    return new Response(req.method === "HEAD" ? null : html, origin);
  }
  return new Response(req.method === "HEAD" ? null : out, { status: m.status, headers: pageHeaders(origin.headers, m) });
}

/**
 * Outside Cloudflare, fetch unzips the body but keeps the content-encoding header. Passed on as is,
 * browsers would try to unzip it again, so the header goes.
 */
const decodedFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const res = await fetch(input, init);
  if (!res.headers.has("content-encoding")) return res;
  const headers = new Headers(res.headers);
  headers.delete("content-encoding");
  headers.delete("content-length");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}) as typeof fetch;

/** Keeps the most recently drawn cards in memory, by URL. */
export function memoryCache(max: number): CardCache {
  const items = new Map<string, { body: ArrayBuffer; status: number; headers: [string, string][] }>();
  return {
    async match(req) {
      const hit = items.get(req.url);
      if (!hit) return undefined;
      items.delete(req.url);
      items.set(req.url, hit);
      return new Response(hit.body.slice(0), { status: hit.status, headers: hit.headers });
    },
    async put(req, res) {
      items.set(req.url, { body: await res.arrayBuffer(), status: res.status, headers: [...res.headers] });
      while (items.size > max) items.delete(items.keys().next().value!);
    },
  };
}
