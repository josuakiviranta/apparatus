import { describe, it, expect } from "vitest";
import { existsSync } from "fs";
import { join } from "path";

// Sanity that the source directory ships its meta-template.
// Prod-bundle copy is verified by the smoke test (npm run build && cli runs).
describe("templates source layout", () => {
  const root = process.cwd();
  it("ships pipeline-create as a folder template", () => {
    expect(existsSync(join(root, "src/cli/templates/pipeline-create/pipeline.dot"))).toBe(true);
  });
  it("ships blank as a folder template", () => {
    expect(existsSync(join(root, "src/cli/templates/blank/pipeline.dot"))).toBe(true);
  });
});
