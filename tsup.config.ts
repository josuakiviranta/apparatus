import { defineConfig } from "tsup";
import { cpSync, readFileSync } from "fs";

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
  define: {
    __APPARAT_PROD__: "true",
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  banner: {
    js: "#!/usr/bin/env node",
  },
  async onSuccess() {
    // Copy entire src/cli/pipelines/ tree to dist/pipelines/.
    // After Chunk 2, every bundled pipeline is folder-form there.
    cpSync("src/cli/pipelines", "dist/pipelines", { recursive: true });
    cpSync("src/cli/skills", "dist/skills", { recursive: true });
    console.log("Assets copied to dist/");
  },
});
