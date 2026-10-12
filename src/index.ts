import type { OgeeConfig } from "./types.js";

/** Gives your config editor autocomplete and type checks. Returns it unchanged. */
export const defineConfig = (config: OgeeConfig): OgeeConfig => config;

export type * from "./types.js";
export { builtinTemplates, clip, fitTitle } from "./templates.js";
export { alpha, esc, isDark, readableOn } from "./util.js";
export { createCardRenderer, resolveColors } from "./card.js";
export { headTags, prepare, resolvePage } from "./page.js";
export { listPages, listPaths, llmsTxt, sitemapXml } from "./feeds.js";
export { cardPath } from "./routes.js";
