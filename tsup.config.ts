import { defineConfig } from "tsup";
import { copyFileSync, mkdirSync } from "fs";

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
    copyFileSync(
      "src/cli/prompts/PROMPT_plan.md",
      "dist/prompts/PROMPT_plan.md"
    );
    copyFileSync(
      "src/cli/prompts/PROMPT_build.md",
      "dist/prompts/PROMPT_build.md"
    );
    copyFileSync(
      "src/cli/prompts/PROMPT_kickoff.md",
      "dist/prompts/PROMPT_kickoff.md"
    );
    copyFileSync("loop.sh", "dist/loop.sh");
    // Make loop.sh executable
    const { chmodSync } = await import("fs");
    chmodSync("dist/loop.sh", 0o755);
    console.log("Assets copied to dist/");
  },
});
