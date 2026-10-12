import { writeFileSync, readFileSync } from "node:fs";
import { createCardRenderer } from "../src/card.js";
import { prepare, resolvePage } from "../src/page.js";
import { defineConfig } from "../src/index.js";

const out = process.argv[2] ?? ".";
const logo = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#7c3aed"/><path d="M18 40 L32 18 L46 40 Z" fill="#fff"/></svg>`;
// A portrait "flyer" and a wide "screenshot", to check how templates frame a page's picture.
const flyer = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1100"><rect width="800" height="1100" fill="#1a1a1f"/><circle cx="400" cy="420" r="260" fill="#f59e0b"/><text x="400" y="860" font-size="150" text-anchor="middle" fill="#fff" font-family="sans-serif" font-weight="800">SOUND</text></svg>`;
const shot = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="1600" height="900" fill="#2563eb"/><rect x="80" y="80" width="700" height="80" rx="12" fill="#fff" opacity=".9"/><rect x="80" y="220" width="1440" height="600" rx="24" fill="#1e40af"/></svg>`;
const brands = {
  dark: { logo: "logo.svg", colors: { background: "#0b0b12", foreground: "#f5f5f7", accent: "#7c3aed", accent2: "#ec4899" } },
  light: { logo: "logo.svg", colors: { background: "#fbfaf7", foreground: "#141414", accent: "#e8590c" } },
};
for (const [bn, brand] of Object.entries(brands)) {
  for (const t of ["minimal", "glow", "split", "bold"]) {
    const site = prepare(defineConfig({ site: "https://acme.dev", name: "Acme", description: "Tools for people who ship", brand, card: { template: t },
      routes: { "/blog/:slug": { title: "How we cut our cold starts from 900ms to 40ms without rewriting anything", description: "A story about bundles, lazy imports and one very annoying regex.", eyebrow: "Engineering blog" } } }));
    const files: Record<string, string> = { "logo.svg": logo, "flyer.svg": flyer, "shot.svg": shot };
    const r = createCardRenderer(site, async (p) => (files[p] ? new TextEncoder().encode(files[p]) : null));
    const page = (await resolvePage(site, "/blog/cold-starts"))!;
    for (const [suffix, image] of [["", undefined], ["-flyer", "flyer.svg"], ["-shot", "shot.svg"]] as const) {
      const t0 = Date.now();
      const png = await r.render({ ...page, image });
      writeFileSync(`${out}/${bn}-${t}${suffix}.png`, png);
      console.log(bn, t + suffix, png.length, Date.now() - t0 + "ms");
    }
  }
}
