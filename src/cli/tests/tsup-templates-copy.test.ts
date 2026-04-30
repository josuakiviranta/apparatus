import { describe, it, expect } from "vitest";
import { existsSync } from "fs";
import { join } from "path";

describe("bundled pipelines source layout", () => {
  const root = process.cwd();
  it("ships meditate as a folder pipeline under src/cli/pipelines/", () => {
    expect(existsSync(join(root, "src/cli/pipelines/meditate/pipeline.dot"))).toBe(true);
    expect(existsSync(join(root, "src/cli/pipelines/meditate/meditate.md"))).toBe(true);
  });
  it("ships implement as a folder pipeline under src/cli/pipelines/", () => {
    expect(existsSync(join(root, "src/cli/pipelines/implement/pipeline.dot"))).toBe(true);
    expect(existsSync(join(root, "src/cli/pipelines/implement/implement.md"))).toBe(true);
  });
  it("ships janitor as a folder pipeline under src/cli/pipelines/", () => {
    expect(existsSync(join(root, "src/cli/pipelines/janitor/pipeline.dot"))).toBe(true);
    expect(existsSync(join(root, "src/cli/pipelines/janitor/janitor.md"))).toBe(true);
    expect(existsSync(join(root, "src/cli/pipelines/janitor/read-vision.mjs"))).toBe(true);
  });
});
