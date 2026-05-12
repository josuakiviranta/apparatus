import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPT = resolve(
  __dirname,
  "../../../.apparat/pipelines/parallel-illumination-to-implementation/plan-writer.md",
);

describe("plan-writer.md prompt contents", () => {
  it("file exists at the expected path", () => {
    expect(existsSync(PROMPT)).toBe(true);
  });

  it("frontmatter tools: block lists Grep", () => {
    const text = readFileSync(PROMPT, "utf8");
    const fmMatch = text.match(/^---\n([\s\S]*?)\n---/);
    expect(fmMatch).not.toBeNull();
    const frontmatter = fmMatch![1];
    expect(frontmatter).toMatch(/^\s*-\s+Grep\s*$/m);
  });

  it("Procedure section retains the existing Glob mandate", () => {
    const text = readFileSync(PROMPT, "utf8");
    expect(text).toMatch(
      /Ground file-path claims by Globbing `\$project\/src`/,
    );
  });

  it("Procedure section adds a symbol-consumer Grep step with the propagation line shape", () => {
    const text = readFileSync(PROMPT, "utf8");
    expect(text).toMatch(/Grep `\$project` for importers/);
    expect(text).toMatch(
      /plan_writer\.under_declared_shape_consumer_suspected: c<n> -> <path>/,
    );
    expect(text).toMatch(/behavior-only/);
    expect(text).toMatch(/cross-language/);
    expect(text).toMatch(/dynamic-import/);
    expect(text).toMatch(/runtime-ordering/);
    expect(text).toMatch(/test-state/);
    expect(text).toMatch(/codegen/);
  });

  it("the new step lands AFTER the Glob mandate (positional contract)", () => {
    const text = readFileSync(PROMPT, "utf8");
    const globIdx = text.indexOf(
      "Ground file-path claims by Globbing `$project/src`",
    );
    const grepIdx = text.indexOf("Grep `$project` for importers");
    expect(globIdx).toBeGreaterThan(-1);
    expect(grepIdx).toBeGreaterThan(-1);
    expect(grepIdx).toBeGreaterThan(globIdx);
  });
});
