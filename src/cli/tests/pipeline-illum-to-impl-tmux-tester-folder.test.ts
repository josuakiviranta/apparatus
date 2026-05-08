import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "../../..");
const TMUX_TESTER_MD = join(
  REPO_ROOT,
  ".apparat",
  "pipelines",
  "illumination-to-implementation",
  "tmux-tester.md",
);

describe(".apparat/pipelines/illumination-to-implementation/tmux-tester.md — plan-coverage signal", () => {
  const md = readFileSync(TMUX_TESTER_MD, "utf-8");

  it("inputs include plan_writer.plan_path and implement.pre_sha", () => {
    expect(md).toMatch(/inputs:[\s\S]*?-\s*plan_writer\.plan_path/);
    expect(md).toMatch(/inputs:[\s\S]*?-\s*implement\.pre_sha/);
  });

  it("outputs include plan_files_touched as a number", () => {
    expect(md).toMatch(/outputs:[\s\S]*?plan_files_touched:\s*number/);
  });

  it("body has a Phase 0a — Plan-coverage candidate extraction step that reads plan_writer.plan_path", () => {
    expect(md).toMatch(/Phase 0a/);
    expect(md).toMatch(/\$plan_writer\.plan_path/);
    expect(md).toMatch(/\\\.\(ts\|md\|dot\|js\|json\)/);
  });

  it("body has a Phase 1c — Diff cross-reference step using implement.pre_sha", () => {
    expect(md).toMatch(/Phase 1c/);
    expect(md).toMatch(/git diff --name-only \$implement\.pre_sha HEAD/);
  });

  it("body emits plan_files_touched in the JSON and a Plan coverage line in test_render", () => {
    expect(md).toContain("plan_files_touched");
    expect(md).toMatch(/Plan coverage/);
  });

  it("test_result remains orthogonal — coverage zero does not flip pass to fail", () => {
    expect(md).toMatch(/orthogonal/);
  });
});
