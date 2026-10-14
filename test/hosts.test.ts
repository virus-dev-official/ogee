import { mkdtempSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createHandler, rewriteHtml } from "../src/handler.js";
import { prepare, resolvePage } from "../src/page.js";
import { buildStatic, htmlFiles } from "../src/node/build.js";
import type { Project } from "../src/node/config.js";
import type { OgeeConfig } from "../src/types.js";

const SHELL = `<!doctype html><html><head><meta charset="utf-8"><title>Fixture App</title>
<meta name="description" content="Fixture description"><meta property="og:title" content="Fixture"><meta name="twitter:card" content="summary">
<script type="module">if (a < b && "</head>") {}</script>
</head><body><div id="root"><!-- app --></div><script src="/assets/app.js"></script></body></html>`;

const config: OgeeConfig = {
  site: "https://fixture.test",
  origin: "https://origin.test",
  name: "Fixture",
  description: "A test site",
  titleTemplate: "%s · Fixture",
  brand: { colors: { background: "#ffffff", foreground: "#111111", accent: "#e8590c" } },
  routes: {
    "/": { title: "Fixture home" },
    "/pricing": { title: "Pricing", description: "Cheap", html: "<h1>Pricing</h1>" },
    "/blog/:slug": ({ params }) => (params.slug === "missing" ? null : params.slug === "gone" ? { status: 404 } : { title: "Post " + params.slug }),
    "/press": { ogImage: "https://cdn.test/press.png" },
  },
  sitemap: { paths: () => ["/blog/hello", "/blog/gone"] },
};
const site = prepare(config);

describe("rewriteHtml", () => {
  it("replaces the head tags and leaves everything else byte for byte", async () => {
    const page = (await resolvePage(site, "/pricing"))!;
    const out = rewriteHtml(SHELL, site, page);
    expect(out).toContain("<title>Pricing · Fixture</title>");
    expect(out).toContain('<meta property="og:title" content="Pricing">');
    expect(out).not.toContain("Fixture App");
    expect(out).not.toContain("Fixture description");
    expect(out).not.toContain('content="summary"');
    expect(out.match(/<title>/g)).toHaveLength(1);
    expect(out).toContain('<script type="module">if (a < b && "</head>") {}</script>');
    expect(out).toContain('<div id="root"><h1>Pricing</h1></div>');
    expect(out).toContain('<meta charset="utf-8">');
    expect(out.indexOf("og:title")).toBeLessThan(out.lastIndexOf("</head>"));
    expect(out.indexOf("og:title")).toBeGreaterThan(out.indexOf("</script>"));
  });

  it("leaves the mount element alone for pages without html", async () => {
    const out = rewriteHtml(SHELL, site, (await resolvePage(site, "/"))!);
    expect(out).toContain('<div id="root"><!-- app --></div>');
  });

  it("returns HTML without a head unchanged", async () => {
    const html = "<p>hi</p>";
    expect(rewriteHtml(html, site, (await resolvePage(site, "/"))!)).toBe(html);
  });
});

describe("handler", () => {
  const origin = async (req: Request) => {
    const p = new URL(req.url).pathname;
    if (req.method === "POST") return new Response("echo:" + (await req.text()));
    if (p.startsWith("/assets/")) return new Response("console.log(1)", { headers: { "content-type": "text/javascript" } });
    return new Response(SHELL, { headers: { "content-type": "text/html; charset=utf-8", etag: '"x"' } });
  };
  const ogee = createHandler(config, { fetchOrigin: origin });
  const get = (path: string, init?: RequestInit) => ogee.fetch(new Request("https://fixture.test" + path, init));

  it("rewrites pages", async () => {
    const r = await get("/pricing");
    expect(r.headers.get("x-ogee")).toBe("1");
    expect(r.headers.get("etag")).toBeNull();
    expect(await r.text()).toContain("<title>Pricing · Fixture</title>");
  });

  it("sends 404s for missing pages and leaves passthrough pages alone", async () => {
    const gone = await get("/blog/gone");
    expect(gone.status).toBe(404);
    expect(gone.headers.get("x-robots-tag")).toBe("noindex");
    const missing = await get("/blog/missing");
    expect(missing.headers.get("x-ogee")).toBeNull();
  });

  it("passes assets and POSTs through", async () => {
    expect(await (await get("/assets/app.js")).text()).toBe("console.log(1)");
    expect(await (await get("/form", { method: "POST", body: "hi" })).text()).toBe("echo:hi");
  });

  it("serves the sitemap, llms.txt and cards", async () => {
    expect(await (await get("/sitemap.xml")).text()).toContain("<loc>https://fixture.test/blog/hello</loc>");
    expect(await (await get("/llms.txt")).text()).toContain("[Pricing](https://fixture.test/pricing)");
    const card = await get("/__ogee/card/pricing.png");
    expect(card.headers.get("content-type")).toBe("image/png");
    expect((await card.arrayBuffer()).byteLength).toBeGreaterThan(1000);
    expect((await get("/__ogee/card/blog/gone.png")).status).toBe(404);
  }, 30_000);

  it("needs to know where pages come from", () => {
    expect(() => createHandler({ ...config, origin: undefined })).toThrow(/origin/);
  });
});

describe("static build", () => {
  it("writes files every host can find", () => {
    expect(htmlFiles("/", false)).toEqual(["index.html"]);
    expect(htmlFiles("/blog/a", false)).toEqual(["blog/a.html", "blog/a/index.html"]);
    expect(htmlFiles("/blog/a", true)).toEqual(["blog/a/index.html"]);
  });

  it("writes every known page, its card, the sitemap and llms.txt", async () => {
    const dist = mkdtempSync(join(tmpdir(), "ogee-build-"));
    writeFileSync(join(dist, "index.html"), SHELL);
    const project = { dir: dist, configFile: "", config, site, assetsDir: dist, load: async () => null } as Project;
    const { pages } = await buildStatic(project, dist);

    const read = (f: string) => readFileSync(join(dist, f), "utf8");
    expect(read("index.html")).toContain("<title>Fixture home</title>");
    expect(read("pricing.html")).toContain("<title>Pricing · Fixture</title>");
    expect(read("pricing/index.html")).toContain('<div id="root"><h1>Pricing</h1></div>');
    expect(read("blog/hello.html")).toContain("<title>Post hello · Fixture</title>");
    // Every page starts from the original shell, not from the rewritten home page.
    expect(read("pricing.html")).not.toContain("Fixture home");
    expect(existsSync(join(dist, "__ogee/card/pricing.png"))).toBe(true);
    expect(existsSync(join(dist, "__ogee/card/press.png"))).toBe(false);
    expect(existsSync(join(dist, "blog/gone.html"))).toBe(false);
    expect(pages.find((p) => p.path === "/blog/gone")!.skipped).toMatch(/404/);
    expect(read("sitemap.xml")).toContain("<loc>https://fixture.test/blog/hello</loc>");
    expect(read("sitemap.xml")).not.toContain("gone");
    expect(read("llms.txt")).toContain("[Pricing](https://fixture.test/pricing)");
  }, 60_000);
});
