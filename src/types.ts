/** A color as a CSS string, e.g. "#7c3aed" or "rgb(124 58 237)". */
export type Color = string;

export interface BrandColors {
  /** Card background. */
  background: Color;
  /** Main text. */
  foreground: Color;
  /** Brand accent: buttons, highlights, blobs. */
  accent: Color;
  /** Secondary accent, used by templates that want two brand colors. Defaults to `accent`. */
  accent2?: Color;
  /** Quiet text: the description, the URL line. Derived from the other colors if left out. */
  muted?: Color;
}

export interface BrandFont {
  /** The family name templates use in `font-family`. */
  family: string;
  /** A font file in the assets folder (ttf, otf, woff or woff2), or an https URL. */
  src: string;
  weight?: number;
  style?: "normal" | "italic";
}

export interface Brand {
  /** A logo in the assets folder ("logo.png"), or an https URL. SVG, PNG, JPEG and WebP work. */
  logo?: string;
  colors: BrandColors;
  /** Font files to load. Leave empty to use the built-in Geist. */
  fonts?: BrandFont[];
  /** The family used for titles. Defaults to the first font. */
  headingFont?: string;
  /** The family used for everything else. Defaults to `headingFont`. */
  bodyFont?: string;
  /** How heavy titles are, like the site's own headlines. Defaults to 700. */
  headingWeight?: number;
  /**
   * A finished background image (1200×630) in the assets folder. Templates draw it behind the
   * text. Make one from any HTML with `ogee plate`, for art the card renderer can't draw.
   */
  plate?: string;
}

/** What one page says about itself. Every field is optional; the site defaults fill the rest. */
export interface Page {
  /** The page title, before `titleTemplate` is applied. */
  title?: string;
  /** Title for link previews when it should differ from the browser tab title. */
  ogTitle?: string;
  description?: string;
  /** A small label above the title on the card ("Blog", "Pricing", "₵120"). */
  eyebrow?: string;
  /** A photo or cover for this page. Templates that show an image use it. */
  image?: string;
  /** A ready-made preview image URL. Skips card rendering for this page. */
  ogImage?: string;
  /** Alt text for the preview image. Defaults to the title. */
  imageAlt?: string;
  /** Open Graph type. Defaults to "website". */
  type?: string;
  /** Canonical URL. Defaults to the site URL plus the path. */
  canonical?: string;
  /** Keep the page out of search results. */
  noindex?: boolean;
  /** Answer with this status instead of 200 (404 for missing records, 410 for removed ones). */
  status?: 200 | 404 | 410;
  /** Extra JSON-LD objects for this page. */
  jsonLd?: object[];
  /**
   * HTML written into the app's mount element (see `mount`) for crawlers that don't run
   * JavaScript. The app replaces it when it starts.
   */
  html?: string;
  /** Use a different card template for this page. */
  template?: string;
  /** Anything else your own template wants to read, as `card.data`. */
  data?: Record<string, unknown>;
  /** Leave this page out of the sitemap and llms.txt. */
  hidden?: boolean;
}

export interface RouteContext {
  /** Values for `:params` and `*` (as `params.wild`) in the route pattern. */
  params: Record<string, string>;
  /** The full URL being asked for. */
  url: URL;
  /** The page's path, e.g. "/blog/hello". */
  path: string;
  /** `fetch`, cached at the edge for `cacheTtl` seconds. */
  fetch: typeof fetch;
  /** Variables from the Worker environment (empty when rendering locally). */
  env: Record<string, unknown>;
}

/** A route: a fixed page, or a function that looks the page up. Return null for "no such page". */
export type Route = Page | ((ctx: RouteContext) => Page | null | Promise<Page | null>);

/** Everything a card template gets. */
export interface CardData {
  title: string;
  description: string;
  eyebrow: string;
  siteName: string;
  /** "cleforyx.com" */
  host: string;
  /** "/pricing" */
  path: string;
  url: string;
  /** The page's own image, if it has one, ready to use in `<img src>`. */
  image?: string;
  /** The page image's width divided by its height (1 when unknown). Below 1 it's portrait, like a flyer. */
  imageAspect: number;
  /** Image source for the brand logo, ready to use in `<img src>`. */
  logo?: string;
  /** The logo's width divided by its height (1 when unknown). Above ~2 it's a wordmark. */
  logoAspect: number;
  /** Image source for the background plate, ready to use in `<img src>`. */
  plate?: string;
  colors: Required<BrandColors>;
  headingFont: string;
  bodyFont: string;
  /** Font weight for titles (the site's own headline weight). */
  headingWeight: number;
  width: number;
  height: number;
  /** A number from 0 to 1 that's stable for this page: use it for variety between cards. */
  seed: number;
  /** More stable random numbers in [0, 1): `rand(0)`, `rand(1)`, … */
  rand: (i: number) => number;
  /** The page's own `data`. */
  data: Record<string, unknown>;
}

/** A card template returns HTML. Inline styles and flexbox are the safe bet. */
export type Template = (card: CardData) => string;

export interface SitemapOptions {
  /** More paths for the sitemap and llms.txt, e.g. every blog post from your API. */
  paths?: (ctx: { fetch: typeof fetch; env: Record<string, unknown> }) => string[] | Promise<string[]>;
}

export interface OgeeConfig {
  /** The public address of the site, e.g. "https://myapp.com". */
  site: string;
  /**
   * Where the site really lives, when it isn't behind this Worker on the same hostname,
   * e.g. "https://myapp.pages.dev" or "https://myapp.lovable.app".
   * Leave it out when the Worker runs on a route in front of the site.
   */
  origin?: string;
  /** The site's name, for og:site_name, cards and llms.txt. */
  name: string;
  /** Used for pages without their own description. */
  description?: string;
  /** "%s · MyApp". Applied to every title except the home page's. */
  titleTemplate?: string;
  /** og:locale, e.g. "en_US". */
  locale?: string;
  /** The site's X account, e.g. "@myapp". */
  twitter?: string;
  brand: Brand;
  card?: {
    /** A built-in template name or one from `templates`. Defaults to "minimal". */
    template?: string;
    width?: number;
    height?: number;
    /**
     * "png" (the default) is crisp and small for flat designs. "jpeg" is far smaller for photos,
     * grain and heavy gradients: WhatsApp skips preview images much over 600 KB.
     */
    format?: "png" | "jpeg";
    /** JPEG quality, 1 to 100. Defaults to 88. */
    quality?: number;
  };
  /** Your own templates, by name. */
  templates?: Record<string, Template>;
  /**
   * Pages by path pattern: "/pricing", "/blog/:slug", "/docs/*".
   * Paths that match nothing get the site defaults.
   */
  routes?: Record<string, Route>;
  /** Set when your site's page URLs end in a slash ("/about/"), so canonical URLs and the sitemap match. */
  trailingSlash?: boolean;
  /** What to do with paths no route matches: give them the site defaults, or leave them alone. */
  unmatched?: "defaults" | "passthrough";
  /** The element the app mounts into, for `page.html`. Defaults to "#root, #app". */
  mount?: string;
  /** Serve /sitemap.xml. On by default. */
  sitemap?: boolean | SitemapOptions;
  /** Serve /llms.txt. On by default. */
  llms?: boolean;
  /** Seconds to cache route lookups and cards at the edge. Defaults to 300. */
  cacheTtl?: number;
}

/** A page with every default applied: what the head tags and the card are made from. */
export interface ResolvedPage {
  path: string;
  title: string;
  ogTitle: string;
  description: string;
  eyebrow: string;
  image?: string;
  ogImage: string;
  imageAlt: string;
  /** True when ogImage is a card this Worker draws. */
  generated: boolean;
  type: string;
  canonical: string;
  noindex: boolean;
  status: 200 | 404 | 410;
  jsonLd: object[];
  html?: string;
  template: string;
  data: Record<string, unknown>;
  hidden: boolean;
}

/** Reads a file from the assets folder. Returns null when it's missing. */
export type AssetLoader = (path: string) => Promise<Uint8Array | null>;
