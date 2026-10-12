import { cardPath, compileRoutes, matchRoute, normalizePath, type CompiledRoute } from "./routes.js";
import type { OgeeConfig, Page, ResolvedPage } from "./types.js";
import { esc, hashHex, trimSlash } from "./util.js";

export interface Site {
  config: OgeeConfig;
  routes: CompiledRoute[];
  site: string;
}

const cache = new WeakMap<OgeeConfig, Site>();

export function prepare(config: OgeeConfig): Site {
  let s = cache.get(config);
  if (!s) {
    if (!/^https?:\/\//.test(config.site ?? "")) throw new Error(`ogee: "site" must be a full URL like "https://myapp.com", got "${config.site}"`);
    s = { config, routes: compileRoutes(config.routes), site: trimSlash(config.site) };
    cache.set(config, s);
  }
  return s;
}

export interface ResolveOptions {
  url?: URL;
  fetch?: typeof fetch;
  env?: Record<string, unknown>;
  /** Where card URLs point. Defaults to the site; the Worker passes the request's origin so previews work on preview hosts. */
  publicOrigin?: string;
}

/**
 * Works out everything about one page: runs its route, then fills the gaps from the site defaults.
 * Returns null when the page should be left alone (no route matched and `unmatched` is "passthrough",
 * or a route function returned null).
 */
export async function resolvePage(site: Site, rawPath: string, opts: ResolveOptions = {}): Promise<ResolvedPage | null> {
  const { config } = site;
  const path = normalizePath(rawPath);
  const url = opts.url ?? new URL(path, site.site);
  const match = matchRoute(site.routes, path);

  let page: Page | null;
  if (match) {
    const r = match.route.route;
    page =
      typeof r === "function"
        ? await r({ params: match.params, url, path, fetch: opts.fetch ?? fetch, env: opts.env ?? {} })
        : r;
    if (!page) return null;
  } else {
    if (config.unmatched === "passthrough") return null;
    page = {};
  }
  return finish(site, path, page, opts.publicOrigin);
}

export function finish(site: Site, path: string, page: Page, publicOrigin?: string): ResolvedPage {
  const { config } = site;
  const isHome = path === "/";
  const baseTitle = page.title ?? (isHome ? config.name : titleFromPath(path) || config.name);
  const title = !isHome && config.titleTemplate && baseTitle !== config.name ? config.titleTemplate.replace("%s", baseTitle) : baseTitle;
  const ogTitle = page.ogTitle ?? baseTitle;
  const description = page.description ?? config.description ?? "";
  const template = page.template ?? config.card?.template ?? "minimal";

  const generated = !page.ogImage;
  // The version changes whenever what the card shows changes, so social caches pick up new cards.
  const version = hashHex(JSON.stringify([ogTitle, description, page.eyebrow, page.image, template, page.data, config.brand, config.card]));
  const ogImage = page.ogImage ?? `${trimSlash(publicOrigin ?? site.site)}${cardPath(path, config.card?.format === "jpeg" ? "jpg" : "png")}?v=${version}`;

  const canonical = page.canonical ?? site.site + (isHome ? "/" : path + (config.trailingSlash ? "/" : ""));
  const status = page.status ?? 200;

  return {
    path,
    title,
    ogTitle,
    description,
    eyebrow: page.eyebrow ?? "",
    image: page.image,
    ogImage,
    imageAlt: page.imageAlt ?? ogTitle,
    generated,
    type: page.type ?? "website",
    canonical,
    noindex: page.noindex ?? status !== 200,
    status,
    jsonLd: page.jsonLd ?? defaultJsonLd(site, isHome, ogTitle, description, canonical),
    html: page.html,
    template,
    data: page.data ?? {},
    hidden: page.hidden ?? false,
  };
}

/** "/blog/my-first-post" → "My first post". Better than nothing for pages nobody described. */
export function titleFromPath(path: string): string {
  const last = path.split("/").filter(Boolean).pop();
  if (!last) return "";
  let s: string;
  try {
    s = decodeURIComponent(last);
  } catch {
    s = last;
  }
  s = s.replace(/[-_]+/g, " ").trim();
  return s ? s[0]!.toUpperCase() + s.slice(1) : "";
}

function defaultJsonLd(site: Site, isHome: boolean, title: string, description: string, url: string): object[] {
  const { config } = site;
  if (isHome) {
    return [
      { "@context": "https://schema.org", "@type": "WebSite", name: config.name, url: site.site + "/", ...(description && { description }) },
      {
        "@context": "https://schema.org",
        "@type": "Organization",
        name: config.name,
        url: site.site + "/",
        ...(config.brand.logo && /^https?:/.test(config.brand.logo) && { logo: config.brand.logo }),
      },
    ];
  }
  return [{ "@context": "https://schema.org", "@type": "WebPage", name: title, url, ...(description && { description }), isPartOf: { "@type": "WebSite", name: config.name, url: site.site + "/" } }];
}

/** The tags ogee writes into <head>. */
export function headTags(site: Site, p: ResolvedPage): string {
  const { config } = site;
  const og = esc(p.ogTitle);
  const d = esc(p.description);
  const img = esc(p.ogImage);
  const alt = esc(p.imageAlt);
  const tags = [
    d && `<meta name="description" content="${d}">`,
    p.noindex && `<meta name="robots" content="noindex">`,
    `<link rel="canonical" href="${esc(p.canonical)}">`,
    `<meta property="og:site_name" content="${esc(config.name)}">`,
    config.locale && `<meta property="og:locale" content="${esc(config.locale)}">`,
    `<meta property="og:type" content="${esc(p.type)}">`,
    `<meta property="og:url" content="${esc(p.canonical)}">`,
    `<meta property="og:title" content="${og}">`,
    d && `<meta property="og:description" content="${d}">`,
    `<meta property="og:image" content="${img}">`,
    img.startsWith("https:") && `<meta property="og:image:secure_url" content="${img}">`,
    p.generated && `<meta property="og:image:type" content="image/${config.card?.format === "jpeg" ? "jpeg" : "png"}">`,
    p.generated && `<meta property="og:image:width" content="${config.card?.width ?? 1200}">`,
    p.generated && `<meta property="og:image:height" content="${config.card?.height ?? 630}">`,
    `<meta property="og:image:alt" content="${alt}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    config.twitter && `<meta name="twitter:site" content="${esc(config.twitter)}">`,
    `<meta name="twitter:title" content="${og}">`,
    d && `<meta name="twitter:description" content="${d}">`,
    `<meta name="twitter:image" content="${img}">`,
    `<meta name="twitter:image:alt" content="${alt}">`,
    ...p.jsonLd.map((j) => `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, "\\u003c")}</script>`),
  ];
  return "\n" + tags.filter(Boolean).join("\n") + "\n";
}
