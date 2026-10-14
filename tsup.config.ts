import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: { index: "src/index.ts", worker: "src/worker.ts", handler: "src/handler.ts" },
    format: "esm",
    dts: true,
    clean: false,
    target: "es2022",
    platform: "neutral",
  },
  {
    entry: { cli: "src/cli.ts" },
    format: "esm",
    target: "node20",
    platform: "node",
    // An optional dependency: tsup only leaves regular dependencies out of the bundle by itself.
    external: ["playwright-core"],
    banner: { js: "#!/usr/bin/env node" },
  },
]);
