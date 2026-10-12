import { mkdir } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { launchBrowser } from "./browser.js";
import type { Project } from "./config.js";
import { pc, ui } from "./ui.js";

/**
 * Renders an HTML file to a PNG in assets/ with a real browser, so a card can use art the card
 * renderer can't draw (WebGL, complex CSS, layered photos). Only the background: the text is
 * drawn per page by the template.
 */
export async function plate(project: Project, input: string, opts: { name?: string }) {
  const width = project.config.card?.width ?? 1200;
  const height = project.config.card?.height ?? 630;
  const name = opts.name ?? basename(input).replace(/\.html?$/i, "") + ".png";
  await mkdir(project.assetsDir, { recursive: true });
  const file = join(project.assetsDir, name);

  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(resolve(input)).href, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts?.ready).catch(() => {});
    await page.waitForTimeout(500);
    await page.screenshot({ path: file, clip: { x: 0, y: 0, width, height } });
  } finally {
    await browser.close();
  }
  if (ui.json) return console.log(JSON.stringify({ file, name }));
  ui.ok(`Saved ${pc.bold(relative(process.cwd(), file))} (${width}×${height})`);
  if (project.config.brand.plate !== name) ui.log(`  Now set ${pc.cyan(`brand.plate: "${name}"`)} in ogee.config.ts and run ${pc.cyan("npx @virusdev/ogee render")}.`);
}
