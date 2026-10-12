// End-to-end: the real Worker, in the real Workers runtime (wrangler dev), in front of a tiny
// single-page app. Run `npm run build` first. Usage: node test/e2e/run.mjs
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const dir = join(root, ".scratch", "e2e");
const ORIGIN_PORT = 18431;
const PORT = 18432;
const W = `http://localhost:${PORT}`;

/* ---------------------------------------------------------- the "app" */
const SHELL = `<!doctype html><html><head><meta charset="utf-8"><title>Fixture App</title>
<meta name="description" content="Fixture description"><meta property="og:title" content="Fixture"><meta name="twitter:card" content="summary">
</head><body><div id="root"></div><script src="/assets/app.js"></script></body></html>`;
const origin = createServer((req, res) => {
  if (req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => res.writeHead(200, { "content-type": "text/plain" }).end(`echo:${body}`));
    return;
  }
  if (req.url === "/old") return res.writeHead(301, { location: `http://localhost:${ORIGIN_PORT}/pricing` }).end();
  if (req.url.startsWith("/assets/")) return res.writeHead(200, { "content-type": "text/javascript" }).end("console.log('app')");
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(SHELL);
});
await new Promise((r) => origin.listen(ORIGIN_PORT, r));

/* --------------------------------------------------------- the project */
rmSync(dir, { recursive: true, force: true });
mkdirSync(join(dir, "assets"), { recursive: true });
writeFileSync(join(dir, "assets", "logo.svg"), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#e8590c"/></svg>`);
writeFileSync(
  join(dir, "ogee.config.ts"),
  `import { defineConfig } from "ogee-cli";
export default defineConfig({
  site: "https://fixture.test",
  name: "Fixture",
  description: "A test site",
  titleTemplate: "%s · Fixture",
  brand: { logo: "logo.svg", colors: { background: "#ffffff", foreground: "#111111", accent: "#e8590c" } },
  routes: {
    "/": { title: "Fixture — home" },
    "/pricing": { title: "Pricing", description: "Cheap", html: "<h1>Pricing</h1><p>Cheap</p>" },
    "/blog/:slug": ({ params }) => params.slug === "missing" ? null : params.slug === "gone" ? { status: 404 } : { title: "Post " + params.slug },
  },
  sitemap: { paths: () => ["/blog/hello"] },
});
`,
);
writeFileSync(join(dir, "worker.ts"), `import { createWorker } from "ogee-cli/worker";\nimport config from "./ogee.config";\nexport default createWorker(config);\n`);
writeFileSync(
  join(dir, "wrangler.toml"),
  `name = "ogee-e2e"
main = "worker.ts"
compatibility_date = "2026-10-01"
compatibility_flags = ["nodejs_compat"]

[alias]
"ogee-cli/worker" = "${join(root, "dist", "worker.js")}"
"ogee-cli" = "${join(root, "dist", "index.js")}"

[assets]
directory = "./assets"
binding = "ASSETS"
run_worker_first = true
`,
);

const dev = spawn("npx", ["wrangler", "dev", "--config", join(dir, "wrangler.toml"), "--port", String(PORT), "--local-upstream", `localhost:${PORT}`, "--var", `OGEE_ORIGIN:http://localhost:${ORIGIN_PORT}`], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
let log = "";
dev.stdout.on("data", (d) => (log += d));
dev.stderr.on("data", (d) => (log += d));

let failed = 0;
const ok = (cond, name, extra = "") => {
  console.log(`${cond ? "✓" : "✗"} ${name}${!cond && extra ? `\n    ${extra}` : ""}`);
  if (!cond) failed++;
};

try {
  for (let i = 0; ; i++) {
    try {
      await fetch(`${W}/__ogee/card/index.png`);
      break;
    } catch {
      if (i > 60) throw new Error("wrangler dev didn't start:\n" + log);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  const r = await fetch(`${W}/pricing`, { headers: { "user-agent": "WhatsApp/2.24 A" } });
  const html = await r.text();
  ok(r.status === 200 && r.headers.get("x-ogee") === "1", "rewrites pages");
  ok(html.includes("<title>Pricing · Fixture</title>") && !html.includes("Fixture App"), "sets the title and drops the old one");
  ok(html.includes('<meta property="og:title" content="Pricing">') && !html.includes('<meta property="og:title" content="Fixture">'), "replaces Open Graph tags");
  ok(html.includes('<meta name="twitter:card" content="summary_large_image">') && !html.includes('content="summary"'), "replaces Twitter tags");
  ok(html.includes('<link rel="canonical" href="https://fixture.test/pricing">'), "adds the canonical URL");
  ok(html.includes('<div id="root"><h1>Pricing</h1><p>Cheap</p></div>'), "writes crawler HTML into the mount element");
  ok(html.includes("application/ld+json"), "adds JSON-LD");

  const img = html.match(/og:image" content="([^"]+)"/)?.[1]?.replace(/&amp;/g, "&");
  ok(img?.startsWith(`${W}/__ogee/card/pricing.png?v=`), "points og:image at this host's card", img);
  const card = await fetch(img);
  const bytes = new Uint8Array(await card.arrayBuffer());
  const dv = new DataView(bytes.buffer);
  ok(card.status === 200 && card.headers.get("content-type") === "image/png" && dv.getUint32(16) === 1200 && dv.getUint32(20) === 630, "draws a 1200×630 card at the edge");
  ok(/max-age=604800/.test(card.headers.get("cache-control") ?? ""), "caches versioned cards for a week");

  const post = await (await fetch(`${W}/blog/hello`)).text();
  ok(post.includes("<title>Post hello · Fixture</title>"), "runs route functions");
  const gone = await fetch(`${W}/blog/gone`);
  ok(gone.status === 404 && gone.headers.get("x-robots-tag") === "noindex", "passes a route's 404 on, with noindex");
  const missing = await (await fetch(`${W}/blog/missing`)).text();
  ok(missing.includes("<title>Fixture App</title>"), "leaves pages alone when a route returns null");
  ok((await fetch(`${W}/__ogee/card/blog/missing.png`)).status === 404, "has no card for pages that don't exist");

  const js = await fetch(`${W}/assets/app.js`);
  ok((await js.text()) === "console.log('app')" && !js.headers.get("x-ogee"), "passes assets through untouched");
  ok((await (await fetch(`${W}/api`, { method: "POST", body: "hi" })).text()) === "echo:hi", "passes POST requests through");

  const redirect = await fetch(`${W}/old`, { redirect: "manual" });
  ok(redirect.status === 301 && redirect.headers.get("location") === `${W}/pricing`, "rewrites origin redirects to the public host", redirect.headers.get("location"));

  const head = await fetch(`${W}/pricing`, { method: "HEAD" });
  ok(head.status === 200 && (await head.text()) === "", "answers HEAD without a body");

  const sitemap = await (await fetch(`${W}/sitemap.xml`)).text();
  ok(["/", "/pricing", "/blog/hello"].every((p) => sitemap.includes(`<loc>https://fixture.test${p}</loc>`)), "serves the sitemap with route and extra paths");
  const llms = await (await fetch(`${W}/llms.txt`)).text();
  ok(llms.startsWith("# Fixture") && llms.includes("[Pricing](https://fixture.test/pricing): Cheap"), "serves llms.txt");

  const home = await (await fetch(`${W}/`)).text();
  ok(home.includes("<title>Fixture — home</title>"), "doesn't apply the title template to the home page");
} catch (e) {
  failed++;
  console.error(e);
} finally {
  dev.kill();
  origin.close();
}

if (failed) {
  console.log(`\n${failed} failed. wrangler output:\n${log.slice(-3000)}`);
  process.exit(1);
}
console.log("\nAll end-to-end checks passed.");
process.exit(0);
