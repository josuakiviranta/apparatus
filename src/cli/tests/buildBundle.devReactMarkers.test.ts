import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUNDLE = resolve(__dirname, "../../../dist/cli/index.js");

describe("dist/cli/index.js (post-build invariants)", () => {
  it("does not ship the React dev reconciler", () => {
    if (!existsSync(BUNDLE)) {
      console.log(`[skip] no bundle at ${BUNDLE} — run 'npm run build' first`);
      return;
    }
    const bundle = readFileSync(BUNDLE, "utf8");
    const devMarkers = ["react-dom.development", "react-reconciler.development"];
    const found = devMarkers.filter((m) => bundle.includes(m));
    expect(found).toEqual([]);
  });
});
