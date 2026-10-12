import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { launchBrowser } from "./browser.js";
import { findConfig, loadProject, type Project } from "./config.js";
import { agentGuide } from "./guide.js";
import { renderCards } from "./render.js";
import { scanSite } from "./scan.js";
import { fail, pc, ui } from "./ui.js";

/**
 * Collects what an agent needs to design the cards: screenshots of the site, the brand values the
 * scanner found, the cards as they look now, and instructions. The agent does the deciding.
 */
export async function inspect(url: string | undefined, opts: { pages: number; out?: string }) {
  const configFile = findConfig();
  const project: Project | null = configFile ? await loadProject() : null;
  const target = url ?? project?.config.origin ?? project?.config.site;
  if (!target) fail("Give a URL to inspect, or run this inside a folder made by `ogee init`.");
  const base = project?.dir ?? process.cwd();
  const out = opts.out ?? join(base, ".ogee", "inspect");
  await rm(out, { recursive: true, force: true });
  await mkdir(join(out, "site"), { recursive: true });

  const browser = await launchBrowser();
  let scan;
  try {
    scan = await scanSite(target, { browser, pages: opts.pages, screenshots: join(out, "site") });
  } finally {
    await browser.close();
  }

  const { logos: _logos, fontFaces, ...brand } = scan;
  await writeFile(join(out, "brand.json"), JSON.stringify({ ...brand, fontFaces: fontFaces.slice(0, 20) }, null, 2) + "\n");

  const files: string[] = [];
  const rel = (f: string) => relative(process.cwd(), f);
  for (const p of scan.pages) if (p.screenshot) files.push(`${rel(p.screenshot)}  (screenshot of ${p.path})`);
  if (existsSync(join(out, "site", "home-mobile.png"))) files.push(`${rel(join(out, "site", "home-mobile.png"))}  (home page on a phone)`);
  files.push(`${rel(join(out, "brand.json"))}  (colors, fonts and pages the scanner found)`);

  let cards: { path: string; file?: string }[] = [];
  if (project) {
    ui.step("Rendering the cards as they are now");
    const r = await renderCards(project, { out: join(out, "cards") });
    cards = r.cards;
    for (const c of cards) if (c.file) files.push(`${rel(c.file)}  (current card for ${c.path})`);
    files.push(`${rel(project.configFile)}  (the config to edit)`);
  } else {
    files.push("(no ogee.config.ts yet: run `npx ogee init " + target + "` first, then inspect again)");
  }

  const guide = join(out, "AGENT.md");
  await writeFile(guide, agentGuide({ site: project?.config.site ?? target, dir: project ? rel(project.dir) || "." : "(not set up yet)", files }));

  if (ui.json) {
    console.log(
      JSON.stringify(
        {
          guide,
          screenshots: scan.pages.filter((p) => p.screenshot).map((p) => ({ path: p.path, file: p.screenshot })),
          mobile: join(out, "site", "home-mobile.png"),
          brand: join(out, "brand.json"),
          cards: cards.filter((c) => c.file),
          config: project?.configFile ?? null,
          scanned: { name: scan.name, colors: scan.colors, fonts: scan.fonts, dark: scan.dark },
        },
        null,
        2,
      ),
    );
    return;
  }
  ui.ok(`Inspection saved to ${pc.bold(rel(out) + "/")}`);
  ui.log(`\n  ${pc.bold("For your coding agent:")} read ${pc.cyan(rel(guide))} and follow it.\n`);
}
