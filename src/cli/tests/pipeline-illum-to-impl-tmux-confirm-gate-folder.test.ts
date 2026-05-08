import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "../../..");
const GATE_MD = join(
  REPO_ROOT,
  ".apparat",
  "pipelines",
  "illumination-to-implementation",
  "tmux_confirm_gate.md",
);

describe(".apparat/pipelines/illumination-to-implementation/tmux_confirm_gate.md — three-signal render", () => {
  const md = readFileSync(GATE_MD, "utf-8");

  it("frontmatter inputs include implement.done, implement.reason, tmux_tester.test_result, tmux_tester.plan_files_touched", () => {
    expect(md).toMatch(/inputs:[\s\S]*?-\s*implement\.done/);
    expect(md).toMatch(/inputs:[\s\S]*?-\s*implement\.reason/);
    expect(md).toMatch(/inputs:[\s\S]*?-\s*tmux_tester\.test_result/);
    expect(md).toMatch(/inputs:[\s\S]*?-\s*tmux_tester\.plan_files_touched/);
  });

  it("frontmatter inputs still include run_id and tmux_tester.test_render", () => {
    expect(md).toMatch(/inputs:[\s\S]*?-\s*run_id/);
    expect(md).toMatch(/inputs:[\s\S]*?-\s*tmux_tester\.test_render/);
  });

  it("body interpolates all three signals in a Signals block", () => {
    expect(md).toMatch(/### Signals/);
    expect(md).toMatch(/\$implement\.done/);
    expect(md).toMatch(/\$implement\.reason/);
    expect(md).toMatch(/\$tmux_tester\.test_result/);
    expect(md).toMatch(/\$tmux_tester\.plan_files_touched/);
  });

  it("frontmatter retains type=gate and Commit/Retry choices", () => {
    expect(md).toMatch(/type:\s*gate/);
    expect(md).toMatch(/-\s*Commit/);
    expect(md).toMatch(/-\s*Retry/);
  });
});
