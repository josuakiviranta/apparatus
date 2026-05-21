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
    cpSync("src/cli/commands-bundle", "dist/commands-bundle", { recursive: true });
    console.log("Assets copied to dist/");

    const bundle = readFileSync("dist/cli/index.js", "utf8");
    const devMarkers = ["react-dom.development", "react-reconciler.development"];
    const found = devMarkers.filter((m) => bundle.includes(m));
    if (found.length > 0) {
      console.error(`Build failed: dev React markers in bundle: ${found.join(", ")}`);
      console.error("Check that define['process.env.NODE_ENV'] is pinned to '\"production\"'.");
      process.exit(1);
    }
  },
});
