import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "../../..");
const IMPLEMENT_MD = join(
  REPO_ROOT,
  ".apparat",
  "pipelines",
  "illumination-to-implementation",
  "implement.md",
);

describe(".apparat/pipelines/illumination-to-implementation/implement.md — diff guard", () => {
  const md = readFileSync(IMPLEMENT_MD, "utf-8");

  it("declares pre_sha as a string output in frontmatter", () => {
    expect(md).toMatch(/outputs:[\s\S]*?pre_sha:\s*string/);
  });

  it("declares reason as an enum output covering no_diff_produced and empty", () => {
    expect(md).toMatch(/outputs:[\s\S]*?reason:\s*\{enum:\s*\[no_diff_produced,\s*""\]\}/);
  });

  it("body captures pre_sha via `git rev-parse HEAD` BEFORE any work (Step 0c)", () => {
    expect(md).toMatch(/Step 0c/);
    expect(md).toMatch(/pre_sha=\$\(cd \$project && git rev-parse HEAD\)/);
  });

  it("body runs a diff guard with `git diff --stat $pre_sha HEAD` and `git status --porcelain` before declaring done", () => {
    expect(md).toMatch(/git diff --stat \$pre_sha HEAD/);
    expect(md).toMatch(/git status --porcelain/);
  });

  it("body documents emitting done=false reason=no_diff_produced when both diff and porcelain are empty", () => {
    expect(md).toContain("no_diff_produced");
    expect(md).toMatch(/"done":\s*false/);
  });

  it("body documents emitting done=<self-attested> reason=\"\" pre_sha=<sha> on the happy path", () => {
    expect(md).toMatch(/"reason":\s*""/);
    expect(md).toMatch(/"pre_sha":\s*"<sha>"/);
  });
});
