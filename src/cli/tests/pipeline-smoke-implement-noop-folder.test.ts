import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "../../..");
const PIPELINE_DIR = join(
  REPO_ROOT,
  ".apparat",
  "pipelines",
  "illumination-to-implementation",
);

const IMPLEMENT_MD = join(PIPELINE_DIR, "implement.md");
const TMUX_TESTER_MD = join(PIPELINE_DIR, "tmux-tester.md");
const GATE_MD = join(PIPELINE_DIR, "tmux_confirm_gate.md");
const MEMORY_WRITER_MD = join(PIPELINE_DIR, "memory-writer.md");
const PIPELINE_DOT = join(PIPELINE_DIR, "pipeline.dot");
const CAPTURE_SCRIPT = join(PIPELINE_DIR, "capture-pre-sha.sh");

describe("pipeline-smoke: illumination-to-implementation no-op refusal interlock", () => {
  it("capture-pre-sha.sh exists and is executable", () => {
    expect(existsSync(CAPTURE_SCRIPT)).toBe(true);
    const mode = statSync(CAPTURE_SCRIPT).mode & 0o111;
    expect(mode).not.toBe(0);
    const body = readFileSync(CAPTURE_SCRIPT, "utf-8");
    expect(body).toMatch(/git rev-parse HEAD/);
    expect(body).toMatch(/"pre_sha"/);
  });

  it("pipeline.dot declares capture_pre_sha tool node with produces_from_stdout + produces=pre_sha", () => {
    const dot = readFileSync(PIPELINE_DOT, "utf-8");
    expect(dot).toMatch(/capture_pre_sha\s*\[type="tool"/);
    expect(dot).toMatch(/script_file="capture-pre-sha\.sh"/);
    expect(dot).toMatch(/produces_from_stdout="true"/);
    expect(dot).toMatch(/produces="pre_sha"/);
  });

  it("pipeline.dot wires plan_writer -> capture_pre_sha -> implement", () => {
    const dot = readFileSync(PIPELINE_DOT, "utf-8");
    expect(dot).toMatch(/plan_writer\s*->\s*capture_pre_sha\s*->\s*implement/);
  });

  it("implement.md outputs reason but NOT pre_sha; consumes capture_pre_sha.pre_sha as input", () => {
    const implement = readFileSync(IMPLEMENT_MD, "utf-8");
    expect(implement).not.toMatch(/outputs:[\s\S]*?pre_sha:\s*string/);
    expect(implement).toMatch(/outputs:[\s\S]*?reason:\s*\{enum:\s*\[no_diff_produced/);
    expect(implement).toMatch(/inputs:[\s\S]*?-\s*capture_pre_sha\.pre_sha/);
  });

  it("tmux-tester.md consumes capture_pre_sha.pre_sha (not implement.pre_sha)", () => {
    const tester = readFileSync(TMUX_TESTER_MD, "utf-8");
    expect(tester).toMatch(/inputs:[\s\S]*?-\s*capture_pre_sha\.pre_sha/);
    expect(tester).not.toMatch(/inputs:[\s\S]*?-\s*implement\.pre_sha/);
  });

  it("tmux-tester.md emits plan_files_touched; tmux_confirm_gate.md consumes it", () => {
    const tester = readFileSync(TMUX_TESTER_MD, "utf-8");
    const gate = readFileSync(GATE_MD, "utf-8");
    expect(tester).toMatch(/outputs:[\s\S]*?plan_files_touched:\s*number/);
    expect(gate).toMatch(/inputs:[\s\S]*?-\s*tmux_tester\.plan_files_touched/);
    expect(gate).toMatch(/\$tmux_tester\.plan_files_touched/);
  });

  it("tmux_confirm_gate.md renders all three orthogonal signals", () => {
    const gate = readFileSync(GATE_MD, "utf-8");
    expect(gate).toMatch(/\$implement\.done/);
    expect(gate).toMatch(/\$implement\.reason/);
    expect(gate).toMatch(/\$tmux_tester\.test_result/);
    expect(gate).toMatch(/\$tmux_tester\.plan_files_touched/);
  });

  it("memory-writer.md Step 4a scans test_summary for the four no-op substrings", () => {
    const memw = readFileSync(MEMORY_WRITER_MD, "utf-8");
    expect(memw).toMatch(/4a\./);
    expect(memw).toContain("no in-scope diff");
    expect(memw).toContain("nothing to verify");
    expect(memw).toContain("implement node committed only");
    expect(memw).toContain("no_diff_produced");
    expect(memw).toMatch(/##\s*Warnings/);
  });

  it("pipeline.dot routing between implement → review_gate → tmux_tester → tmux_confirm_gate → memory_writer is unchanged", () => {
    const dot = readFileSync(PIPELINE_DOT, "utf-8");
    expect(dot).toMatch(/implement\s*->\s*review_gate/);
    expect(dot).toMatch(/review_gate\s*->\s*tmux_tester\s*\[label="Tmux"\]/);
    expect(dot).toMatch(/tmux_tester\s*->\s*tmux_confirm_gate/);
    expect(dot).toMatch(/tmux_confirm_gate\s*->\s*memory_writer\s*\[label="Commit"\]/);
  });
});
