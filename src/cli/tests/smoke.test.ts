import { spawnSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { describe, it, expect } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distBin = join(__dirname, "../../../dist/cli/index.js");

describe("production smoke", () => {
  it("compiled binary exits 0 for --version (skips if dist not built)", () => {
    if (!existsSync(distBin)) {
      console.warn("Skipping smoke test: dist/cli/index.js not found. Run npm run build first.");
      return;
    }
    const result = spawnSync(process.execPath, [distBin, "--version"], {
      encoding: "utf8",
      timeout: 5000,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/\d+\.\d+\.\d+/);
  });

  it("compiled binary has __APPARAT_PROD__ inlined (skips if dist not built)", () => {
    if (!existsSync(distBin)) {
      console.warn("Skipping smoke test: dist/cli/index.js not found.");
      return;
    }
    const content = readFileSync(distBin, "utf8");
    // tsup define replaces __APPARAT_PROD__ with "true" at build time,
    // so the literal string __APPARAT_PROD__ should NOT appear in output
    expect(content).not.toContain("__APPARAT_PROD__");
  });
});
