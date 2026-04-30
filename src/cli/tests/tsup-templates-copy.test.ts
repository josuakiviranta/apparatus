import { describe, it, expect } from "vitest";
import { existsSync } from "fs";
import { join } from "path";

describe("bundled pipelines source layout", () => {
  const root = process.cwd();
  it("ships meditate as a folder pipeline under src/cli/pipelines/", () => {
    expect(existsSync(join(root, "src/cli/pipelines/meditate/pipeline.dot"))).toBe(true);
    expect(existsSync(join(root, "src/cli/pipelines/meditate/meditate.md"))).toBe(true);
  });
  it.skip("ships implement as a folder pipeline under src/cli/pipelines/ (unskipped in Chunk 2)", () => {
    expect(existsSync(join(root, "src/cli/pipelines/implement/pipeline.dot"))).toBe(true);
    expect(existsSync(join(root, "src/cli/pipelines/implement/implement.md"))).toBe(true);
  });
});
