import { writeFileSync, readFileSync } from "node:fs";
import { createCardRenderer } from "../src/card.js";
import { prepare, resolvePage } from "../src/page.js";
import { defineConfig } from "../src/index.js";

const out = process.argv[2] ?? ".";
const logo = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#7c3aed"/><path d="M18 40 L32 18 L46 40 Z" fill="#fff"/></svg>`;
const brands = {
  dark: { logo: "logo.svg", colors: { background: "#0b0b12", foreground: "#f5f5f7", accent: "#7c3aed", accent2: "#ec4899" } },
  light: { logo: "logo.svg", colors: { background: "#fbfaf7", foreground: "#141414", accent: "#e8590c" } },
};
for (const [bn, brand] of Object.entries(brands)) {
  for (const t of ["minimal", "glow", "split", "bold"]) {
    const site = prepare(defineConfig({ site: "https://acme.dev", name: "Acme", description: "Tools for people who ship", brand, card: { template: t },
      routes: { "/blog/:slug": { title: "How we cut our cold starts from 900ms to 40ms without rewriting anything", description: "A story about bundles, lazy imports and one very annoying regex.", eyebrow: "Engineering blog" } } }));
    const r = createCardRenderer(site, async (p) => (p === "logo.svg" ? new TextEncoder().encode(logo) : null));
    const page = (await resolvePage(site, "/blog/cold-starts"))!;
    const t0 = Date.now();
    const png = await r.render(page);
    writeFileSync(`${out}/${bn}-${t}.png`, png);
    console.log(bn, t, png.length, Date.now() - t0 + "ms");
  }
}
