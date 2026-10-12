import { describe, expect, it } from "vitest";
import { createCardRenderer, imageSize } from "../src/card.js";
import { listPages, llmsTxt, sitemapXml } from "../src/feeds.js";
import { defineConfig } from "../src/index.js";
import { headTags, prepare, resolvePage, titleFromPath } from "../src/page.js";
import { cardPath, compileRoutes, matchRoute, normalizePath, pathFromCard } from "../src/routes.js";
import { clip, fitTitle, isIdSegment, readablePath } from "../src/templates.js";
import { contrast, parseColor, readableOn } from "../src/util.js";
import { readHead } from "../src/node/check.js";
import { zoneOf } from "../src/node/init.js";

const base = {
  site: "https://acme.dev",
  name: "Acme",
  description: "Tools for people who ship",
  titleTemplate: "%s · Acme",
  brand: { colors: { background: "#ffffff", foreground: "#111111", accent: "#e8590c" } },
};

describe("routes", () => {
  it("normalizes paths", () => {
    expect(normalizePath("")).toBe("/");
    expect(normalizePath("//blog///post/")).toBe("/blog/post");
  });

  it("prefers fixed segments over params over wildcards", () => {
    const routes = compileRoutes({ "/docs/*": {}, "/blog/:slug": {}, "/blog/new": {}, "/": {} });
    expect(matchRoute(routes, "/blog/new")!.route.pattern).toBe("/blog/new");
    expect(matchRoute(routes, "/blog/hello")).toMatchObject({ route: { pattern: "/blog/:slug" }, params: { slug: "hello" } });
    expect(matchRoute(routes, "/docs/a/b")!.params).toEqual({ wild: "a/b" });
    expect(matchRoute(routes, "/")!.route.pattern).toBe("/");
    expect(matchRoute(routes, "/nope")).toBeNull();
  });

  it("decodes params", () => {
    const routes = compileRoutes({ "/t/:tag": {} });
    expect(matchRoute(routes, "/t/caf%C3%A9")!.params.tag).toBe("café");
  });

  it("maps pages to card URLs and back", () => {
    for (const p of ["/", "/pricing", "/blog/hello-world"]) {
      expect(pathFromCard(cardPath(p))).toBe(p);
      expect(pathFromCard(cardPath(p, "jpg"))).toBe(p);
    }
    expect(cardPath("/")).toBe("/__ogee/card/index.png");
    expect(pathFromCard("/__ogee/card/x.gif")).toBeNull();
  });

  it("rejects a wildcard in the middle", () => {
    expect(() => compileRoutes({ "/a/*/b": {} })).toThrow(/last segment/);
  });
});

describe("pages", () => {
  it("fills defaults and applies the title template, except on the home page", async () => {
    const site = prepare(defineConfig({ ...base, routes: { "/": { title: "Acme — ship faster" }, "/pricing": { title: "Pricing" } } }));
    const home = (await resolvePage(site, "/"))!;
    expect(home.title).toBe("Acme — ship faster");
    expect(home.canonical).toBe("https://acme.dev/");
    const pricing = (await resolvePage(site, "/pricing"))!;
    expect(pricing.title).toBe("Pricing · Acme");
    expect(pricing.ogTitle).toBe("Pricing");
    expect(pricing.description).toBe("Tools for people who ship");
    expect(pricing.ogImage).toMatch(/^https:\/\/acme\.dev\/__ogee\/card\/pricing\.png\?v=\w+$/);
  });

  it("gives unmatched paths a title from the URL, or leaves them alone", async () => {
    const site = prepare(defineConfig({ ...base }));
    expect((await resolvePage(site, "/getting-started"))!.title).toBe("Getting started · Acme");
    const pass = prepare(defineConfig({ ...base, unmatched: "passthrough" }));
    expect(await resolvePage(pass, "/getting-started")).toBeNull();
  });

  it("runs route functions with params", async () => {
    const site = prepare(
      defineConfig({
        ...base,
        routes: { "/blog/:slug": ({ params }) => (params.slug === "missing" ? null : { title: `Post ${params.slug}`, eyebrow: "Blog" }) },
      }),
    );
    expect((await resolvePage(site, "/blog/one"))!).toMatchObject({ ogTitle: "Post one", eyebrow: "Blog" });
    expect(await resolvePage(site, "/blog/missing")).toBeNull();
  });

  it("marks missing pages noindex and keeps their status", async () => {
    const site = prepare(defineConfig({ ...base, routes: { "/gone": { status: 410 } } }));
    expect(await resolvePage(site, "/gone")).toMatchObject({ status: 410, noindex: true });
  });

  it("adds a trailing slash to canonical URLs when the site uses them", async () => {
    const site = prepare(defineConfig({ ...base, trailingSlash: true }));
    expect((await resolvePage(site, "/about"))!.canonical).toBe("https://acme.dev/about/");
    expect((await resolvePage(site, "/"))!.canonical).toBe("https://acme.dev/");
  });

  it("changes the card version when the card's content changes", async () => {
    const a = (await resolvePage(prepare(defineConfig({ ...base, routes: { "/x": { title: "One" } } })), "/x"))!;
    const b = (await resolvePage(prepare(defineConfig({ ...base, routes: { "/x": { title: "Two" } } })), "/x"))!;
    expect(a.ogImage).not.toBe(b.ogImage);
  });

  it("uses a page's own og image instead of drawing one", async () => {
    const site = prepare(defineConfig({ ...base, routes: { "/x": { ogImage: "https://cdn.acme.dev/x.jpg" } } }));
    expect(await resolvePage(site, "/x")).toMatchObject({ ogImage: "https://cdn.acme.dev/x.jpg", generated: false });
  });

  it("escapes everything it writes into the head", async () => {
    const site = prepare(defineConfig({ ...base, routes: { "/x": { title: `"><script>alert(1)</script>`, jsonLd: [{ x: "</script><b>" }] } } }));
    const tags = headTags(site, (await resolvePage(site, "/x"))!);
    expect(tags).not.toContain("<script>alert");
    expect(tags).not.toContain("</script><b>");
    expect(tags).toContain("&quot;&gt;&lt;script&gt;");
  });

  it("makes titles from paths", () => {
    expect(titleFromPath("/blog/my-first_post")).toBe("My first post");
    expect(titleFromPath("/")).toBe("");
  });

  it("requires a full site URL", () => {
    expect(() => prepare(defineConfig({ ...base, site: "acme.dev" }))).toThrow(/full URL/);
  });
});

describe("sitemap and llms.txt", () => {
  it("lists fixed routes and extra paths, skipping hidden and missing pages", async () => {
    const site = prepare(
      defineConfig({
        ...base,
        routes: { "/": {}, "/about": { title: "About us" }, "/secret": { hidden: true }, "/blog/:slug": ({ params }) => ({ title: params.slug! }) },
        sitemap: { paths: () => ["/blog/hello"] },
      }),
    );
    const pages = await listPages(site);
    expect(pages.map((p) => p.path)).toEqual(["/", "/about", "/blog/hello"]);
    expect(sitemapXml(pages)).toContain("<loc>https://acme.dev/about</loc>");
    expect(llmsTxt(site, pages)).toContain("- [About us](https://acme.dev/about)");
  });
});

describe("text and colors", () => {
  it("clips at a word boundary", () => {
    expect(clip("short", 20)).toBe("short");
    expect(clip("The quick brown fox jumps over the lazy dog", 20)).toBe("The quick brown fox…");
  });

  it("shrinks long titles", () => {
    expect(fitTitle("Short")).toBeGreaterThan(fitTitle("A much, much longer title that goes on for a while and then some"));
  });

  it("spots ID-like path segments", () => {
    expect(isIdSegment("c147eaa3-de76-4d5b-9e1e-b3c122569d30")).toBe(true);
    expect(isIdSegment("12345")).toBe(true);
    expect(isIdSegment("hello-world")).toBe(false);
    expect(readablePath("/work/12345")).toBe(false);
    expect(readablePath("/pricing")).toBe(true);
  });

  it("parses colors and picks readable text", () => {
    expect(parseColor("#fff")).toEqual([255, 255, 255]);
    expect(parseColor("rgb(124 58 237)")).toEqual([124, 58, 237]);
    expect(parseColor("rgba(0, 0, 0, 0)")).toBeNull();
    expect(readableOn("#0b0b12")).toBe("#fafafa");
    expect(readableOn("#ffe066")).toBe("#0a0a0a");
    expect(contrast([0, 0, 0], [255, 255, 255])).toBeCloseTo(21);
  });
});

describe("cards", () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40"><rect width="120" height="40" fill="#e8590c"/></svg>`;

  it("reads image sizes", () => {
    expect(imageSize(new TextEncoder().encode(svg))).toEqual({ width: 120, height: 40 });
  });

  it("renders every built-in template, as PNG and JPEG", async () => {
    for (const format of ["png", "jpeg"] as const) {
      for (const template of ["minimal", "glow", "split", "bold"]) {
        const site = prepare(defineConfig({ ...base, brand: { ...base.brand, logo: "logo.svg" }, card: { template, format }, routes: { "/x": { title: "Hello ₵ world", eyebrow: "Test" } } }));
        const r = createCardRenderer(site, async (p) => (p === "logo.svg" ? new TextEncoder().encode(svg) : null));
        const img = await r.render((await resolvePage(site, "/x"))!);
        expect(imageSize(img)).toEqual({ width: 1200, height: 630 });
        expect(r.type).toBe(format === "png" ? "image/png" : "image/jpeg");
      }
    }
  });

  it("tells you about a template that doesn't exist", async () => {
    const site = prepare(defineConfig({ ...base, card: { template: "nope" } }));
    const r = createCardRenderer(site, async () => null);
    await expect(r.render((await resolvePage(site, "/"))!)).rejects.toThrow(/no card template called "nope"/);
  });

  it("gives templates a stable seed per page", async () => {
    const site = prepare(defineConfig(base));
    const r = createCardRenderer(site, async () => null);
    const a = await r.data((await resolvePage(site, "/a"))!);
    const a2 = await r.data((await resolvePage(site, "/a"))!);
    const b = await r.data((await resolvePage(site, "/b"))!);
    expect(a.seed).toBe(a2.seed);
    expect(a.rand(3)).toBe(a2.rand(3));
    expect(a.seed).not.toBe(b.seed);
  });
});

describe("check", () => {
  it("reads a page's head", () => {
    const h = readHead(`<html><head><title>T</title><meta name="description" content="D"><meta property="og:image" content="/i.png"><meta name="twitter:card" content="summary_large_image"><script type="application/ld+json">{}</script></head><body><div id="root"></div><script>var x = "lots of text that should not count"</script></body></html>`);
    expect(h).toMatchObject({ title: "T", description: "D", og: { image: "/i.png" }, twitter: { card: "summary_large_image" }, jsonLd: 1, bodyText: 0 });
  });
});

describe("init helpers", () => {
  it("finds the zone of a hostname", () => {
    expect(zoneOf("www.acme.dev")).toBe("acme.dev");
    expect(zoneOf("studio.cleforyx.com")).toBe("cleforyx.com");
    expect(zoneOf("shop.example.com.gh")).toBe("example.com.gh");
    expect(zoneOf("example.co.uk")).toBe("example.co.uk");
  });
});
