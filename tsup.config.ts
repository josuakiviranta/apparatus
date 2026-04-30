import { defineConfig } from "tsup";
import { copyFileSync, cpSync, mkdirSync, readdirSync } from "fs";

export default defineConfig({
  entry: [
    "src/cli/index.ts",
    "src/cli/mcp/illumination-server.ts",
    "src/cli/lib/stream-formatter.ts",
    "src/daemon/index.ts",
  ],
  format: ["esm"],
  outDir: "dist",
  clean: true,
  define: { __RALPH_PROD__: "true" },
  banner: {
    js: "#!/usr/bin/env node",
  },
  async onSuccess() {
    // Copy bundled pipelines
    mkdirSync("dist/pipelines", { recursive: true });
    for (const file of readdirSync("src/cli/pipelines")) {
      copyFileSync(`src/cli/pipelines/${file}`, `dist/pipelines/${file}`);
    }
    // Copy bundled templates (per-folder layout, recurse into subdirs).
    cpSync("src/cli/templates", "dist/templates", { recursive: true });
    console.log("Assets copied to dist/");
  },
});
