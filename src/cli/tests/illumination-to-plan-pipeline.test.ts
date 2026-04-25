import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const PIPELINE_PATH = join(
  process.cwd(),
  "pipelines",
  "illumination-to-plan.dot",
);

describe("illumination-to-plan.dot — verifier prompt", () => {
  it("step 1 calls mcp__illumination__list_illuminations with status: open", () => {
    const dot = readFileSync(PIPELINE_PATH, "utf-8");
    expect(dot).toContain(
      "1. Call mcp__illumination__list_illuminations with status: open",
    );
  });

  it("step 1 does NOT use a raw glob over illumination filenames", () => {
    const dot = readFileSync(PIPELINE_PATH, "utf-8");
    expect(dot).not.toContain(
      "Run glob on $meditations_dir/illuminations/*.md",
    );
  });
});
