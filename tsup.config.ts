import { defineConfig } from "tsup";
import { copyFileSync, mkdirSync, readdirSync, statSync } from "fs";
import { join } from "path";

function copyDirRecursive(src: string, dst: string) {
  mkdirSync(dst, { recursive: true });
  for (const entry of readdirSync(src)) {
    const s = join(src, entry);
    const d = join(dst, entry);
    if (statSync(s).isDirectory()) copyDirRecursive(s, d);
    else copyFileSync(s, d);
  }
}

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
    // Copy bundled assets to dist/
    mkdirSync("dist/prompts", { recursive: true });
    for (const file of readdirSync("src/cli/prompts")) {
      copyFileSync(`src/cli/prompts/${file}`, `dist/prompts/${file}`);
    }
    // Copy agent definition files
    mkdirSync("dist/agents", { recursive: true });
    for (const file of readdirSync("src/cli/agents")) {
      copyFileSync(`src/cli/agents/${file}`, `dist/agents/${file}`);
    }
    // Copy bundled pipelines
    mkdirSync("dist/pipelines", { recursive: true });
    for (const file of readdirSync("src/cli/pipelines")) {
      copyFileSync(`src/cli/pipelines/${file}`, `dist/pipelines/${file}`);
    }
    // Copy bundled templates (per-folder layout, recurse into subdirs).
    copyDirRecursive("src/cli/templates", "dist/templates");
    console.log("Assets copied to dist/");
  },
});
