// Usage: jiti test/sheet.ts out.png a.png b.png … — tiles cards two per row at half size, for review.
import { readFileSync, writeFileSync } from "node:fs";
import { render } from "takumi-js";
const [out, ...files] = process.argv.slice(2);
const w = 600, h = 315, gap = 12, cols = 2, rows = Math.ceil(files.length / cols);
const html = `<div style="display:flex;flex-wrap:wrap;gap:${gap}px;padding:${gap}px;background:#888;width:100%;height:100%">${files.map((_, i) => `<img src="f${i}" style="width:${w}px;height:${h}px">`).join("")}</div>`;
const png = await render(html, { width: cols * w + (cols + 1) * gap, height: rows * h + (rows + 1) * gap, format: "png", images: files.map((f, i) => ({ src: `f${i}`, data: readFileSync(f!) })) });
writeFileSync(out!, png);
