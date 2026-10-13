import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
import { prepare, type Site } from "../page.js";
import type { AssetLoader, OgeeConfig } from "../types.js";
import { fail } from "./ui.js";

export interface Project {
  /** The folder holding ogee.config.ts. */
  dir: string;
  configFile: string;
  config: OgeeConfig;
  site: Site;
  assetsDir: string;
  load: AssetLoader;
}

const NAMES = ["ogee.config.ts", "ogee.config.mts", "ogee.config.js", "ogee.config.mjs"];

/** Finds ogee.config.* in `dir`, in `dir/ogee`, or in a parent folder. */
export function findConfig(start = process.cwd()): string | null {
  let dir = resolve(start);
  for (;;) {
    for (const base of [dir, join(dir, "ogee")]) {
      for (const n of NAMES) {
        const f = join(base, n);
        if (existsSync(f)) return f;
      }
    }
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

export async function loadProject(cwd?: string): Promise<Project> {
  const configFile = findConfig(cwd);
  if (!configFile) fail(`No ogee.config.ts here. Run ${"`npx @virusdev/ogee init <your site's URL>`"} first.`);
  // Configs import "@virusdev/ogee"; resolve it to this very CLI so they load before (or without) npm install.
  const self = join(dirname(fileURLToPath(import.meta.url)), "index.js");
  const jiti = createJiti(import.meta.url, { moduleCache: false, fsCache: false, alias: existsSync(self) ? { "@virusdev/ogee": self } : {} });
  let mod: { default?: OgeeConfig };
  try {
    mod = (await jiti.import(configFile)) as { default?: OgeeConfig };
  } catch (e) {
    fail(`Couldn't load ${configFile}:\n${(e as Error).message}`);
  }
  const config = mod.default ?? (mod as OgeeConfig);
  if (!config?.site || !config.brand) fail(`${configFile} must export a config with at least "site", "name" and "brand".`);
  const dir = dirname(configFile);
  const assetsDir = join(dir, config.assetsDir ?? "assets");
  const load: AssetLoader = async (p) => {
    try {
      return new Uint8Array(await readFile(join(assetsDir, p)));
    } catch {
      return null;
    }
  };
  return { dir, configFile, config, site: prepare(config), assetsDir, load };
}
