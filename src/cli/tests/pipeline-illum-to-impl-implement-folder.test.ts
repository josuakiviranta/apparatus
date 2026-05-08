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

  it("consumes capture_pre_sha.pre_sha as a declared input (not self-emitted)", () => {
    expect(md).toMatch(/inputs:[\s\S]*?-\s*capture_pre_sha\.pre_sha/);
  });

  it("does NOT declare pre_sha as an output (owned by upstream capture_pre_sha tool node)", () => {
    expect(md).not.toMatch(/outputs:[\s\S]*?pre_sha:\s*string/);
  });

  it("declares reason as an enum output covering no_diff_produced and empty", () => {
    expect(md).toMatch(/outputs:[\s\S]*?reason:\s*\{enum:\s*\[no_diff_produced,\s*""\]\}/);
  });

  it("Step 0c references the upstream-captured $capture_pre_sha_pre_sha and forbids re-running git rev-parse", () => {
    expect(md).toMatch(/Step 0c/);
    expect(md).toMatch(/\$capture_pre_sha_pre_sha/);
    expect(md).not.toMatch(/pre_sha=\$\(cd \$project && git rev-parse HEAD\)/);
  });

  it("Step 5 diff guard runs git diff --stat $capture_pre_sha_pre_sha HEAD + git status --porcelain", () => {
    expect(md).toMatch(/git diff --stat \$capture_pre_sha_pre_sha HEAD/);
    expect(md).toMatch(/git status --porcelain/);
  });

  it("body documents the no-op refusal emit shape — done=false, reason=no_diff_produced, no pre_sha", () => {
    expect(md).toContain("no_diff_produced");
    expect(md).toMatch(/"done":\s*false,\s*"reason":\s*"no_diff_produced"\s*\}/);
  });

  it("body documents the happy-path emit shape — done=<self-attested>, reason=\"\", no pre_sha echo", () => {
    expect(md).toMatch(/"done":\s*<self-attested>,\s*"reason":\s*""\s*\}/);
  });
});
