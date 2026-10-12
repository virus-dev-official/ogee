// Makes the README images with ogee's own renderer. Run: npx jiti docs/make-images.ts
// Needs real cards in .scratch/ (home.png, services.png, work.png, products.png, before.png).
import { readFileSync, writeFileSync } from "node:fs";
import { render } from "takumi-js";
import { createCardRenderer } from "../src/card.js";
import { defineConfig } from "../src/index.js";
import { prepare, resolvePage } from "../src/page.js";

const img = (f: string) => ({ src: f, data: readFileSync(f) });

/* ------------------------------------------------ hero: before / after */
const chat = (src: string, title: string, desc: string, url: string) => `
<div style="display:flex;flex-direction:column;width:440px;background:#005c4b;border-radius:14px;padding:5px;color:#e9edef">
  <img src="${src}" style="width:430px;height:226px;border-radius:10px 10px 0 0">
  <div style="display:flex;flex-direction:column;background:#025144;padding:10px 12px;gap:3px">
    <div style="font-size:19px;font-weight:600">${title}</div>
    <div style="font-size:16px;color:#aebac1">${desc}</div>
  </div>
  <div style="display:flex;padding:8px 10px 6px;font-size:17px;color:#53bdeb">${url}</div>
</div>`;

const column = (label: string, sub: string, color: string, items: string) => `
<div style="display:flex;flex-direction:column;gap:18px;width:480px;align-items:center">
  <div style="display:flex;flex-direction:column;align-items:center;gap:4px">
    <div style="font-size:30px;font-weight:700;color:${color}">${label}</div>
    <div style="font-size:19px;color:#8696a0">${sub}</div>
  </div>
  ${items}
</div>`;

const before = ".scratch/before.png";
const hero = `<div style="display:flex;flex-direction:column;align-items:center;gap:30px;width:100%;height:100%;padding:44px 40px;background:#0b141a;font-family:Geist">
  <div style="display:flex;gap:70px">
    ${column("Before", "a single-page app: every link looks the same", "#f87171", [
      chat(before, "Cleforyx — Websites, apps and backends…", "Cleforyx Tech Solutions is an independent…", "cleforyx.com/services"),
      chat(before, "Cleforyx — Websites, apps and backends…", "Cleforyx Tech Solutions is an independent…", "cleforyx.com/work"),
    ].join(""))}
    ${column("After ogee", "every page gets its own card, in the brand", "#4ade80", [
      chat(".scratch/services.png", "Services", "Websites, mobile apps, backends and APIs…", "cleforyx.com/services"),
      chat(".scratch/work.png", "Work", "Websites, apps and platforms Cleforyx has…", "cleforyx.com/work"),
    ].join(""))}
  </div>
</div>`;
writeFileSync(
  "docs/hero.png",
  await render(hero, {
    width: 1100,
    height: 900,
    format: "png",
    images: [before, ".scratch/services.png", ".scratch/work.png"].map(img),
  }),
);

/* ------------------------------------------ the four built-in templates */
const logo = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="#111"/><path d="M18 42 L32 18 L46 42 Z" fill="#fff"/></svg>`;
const brands = {
  minimal: { colors: { background: "#fbfaf7", foreground: "#141414", accent: "#e8590c" } },
  glow: { colors: { background: "#0b0b12", foreground: "#f5f5f7", accent: "#7c3aed", accent2: "#ec4899" } },
  split: { colors: { background: "#f4f7f5", foreground: "#0f1f17", accent: "#16a34a" } },
  bold: { colors: { background: "#ffffff", foreground: "#111111", accent: "#2563eb" } },
};
const tiles: string[] = [];
const images: { src: string; data: Uint8Array }[] = [];
for (const [template, brand] of Object.entries(brands)) {
  const site = prepare(
    defineConfig({
      site: "https://acme.dev",
      name: "Acme",
      brand: { ...brand, logo: "logo.svg" },
      card: { template },
      routes: { "/blog/cold-starts": { title: "How we cut cold starts from 900ms to 40ms", description: "Bundles, lazy imports and one very annoying regex.", eyebrow: "Engineering" } },
    }),
  );
  const r = createCardRenderer(site, async (p) => (p === "logo.svg" ? new TextEncoder().encode(logo) : null));
  const png = await r.render((await resolvePage(site, "/blog/cold-starts"))!);
  images.push({ src: template, data: png });
  tiles.push(`<div style="display:flex;flex-direction:column;gap:10px"><img src="${template}" style="width:600px;height:315px;border-radius:10px"><div style="display:flex;font-size:22px;color:#555"><span style="font-family:Geist;font-weight:600;color:#111;margin-right:10px">${template}</span></div></div>`);
}
writeFileSync(
  "docs/templates.png",
  await render(`<div style="display:flex;flex-wrap:wrap;gap:28px 24px;padding:28px;background:#ececea;width:100%;height:100%">${tiles.join("")}</div>`, { width: 1280, height: 790, format: "png", images }),
);
console.log("docs/hero.png, docs/templates.png");
