import { defineConfig } from "tsup";
import { copyFileSync, mkdirSync, readdirSync } from "fs";

export default defineConfig({
  entry: ["src/cli/index.ts"],
  format: ["cjs"],
  outDir: "dist",
  clean: true,
  banner: {
    js: "#!/usr/bin/env node",
  },
  async onSuccess() {
    // Copy bundled assets to dist/
    mkdirSync("dist/prompts", { recursive: true });
    for (const file of readdirSync("src/cli/prompts")) {
      copyFileSync(`src/cli/prompts/${file}`, `dist/prompts/${file}`);
    }
    copyFileSync("loop.sh", "dist/loop.sh");
    // Make loop.sh executable
    const { chmodSync } = await import("fs");
    chmodSync("dist/loop.sh", 0o755);
    console.log("Assets copied to dist/");
  },
});
