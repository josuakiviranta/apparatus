import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "../../..");

function pipelineDot(folder: string): string {
  return readFileSync(
    join(REPO_ROOT, ".apparat", "pipelines", folder, "pipeline.dot"),
    "utf-8",
  );
}

describe("PR1 sessions kill — illumination-to-implementation rewire", () => {
  const dot = pipelineDot("illumination-to-implementation");

  it("removes the memory_writer node declaration", () => {
    expect(dot).not.toMatch(/^\s*memory_writer\s*\[/m);
  });

  it("removes the memory_reflector node declaration", () => {
    expect(dot).not.toMatch(/^\s*memory_reflector\s*\[/m);
  });

  it("removes any memory_writer / memory_reflector edges", () => {
    expect(dot).not.toMatch(/memory_writer\b/);
    expect(dot).not.toMatch(/memory_reflector\b/);
  });

  it('routes review_gate -> done [label="Approve"]', () => {
    expect(dot).toMatch(/review_gate\s*->\s*done\s*\[label="Approve"\]/);
  });

  it('routes tmux_confirm_gate -> done [label="Commit"]', () => {
    expect(dot).toMatch(/tmux_confirm_gate\s*->\s*done\s*\[label="Commit"\]/);
  });

  it("memory-writer.md and memory-reflector.md are deleted", () => {
    const folder = join(REPO_ROOT, ".apparat", "pipelines", "illumination-to-implementation");
    expect(existsSync(join(folder, "memory-writer.md"))).toBe(false);
    expect(existsSync(join(folder, "memory-reflector.md"))).toBe(false);
  });
});

describe("PR1 sessions kill — parallel-illumination-to-implementation rewire", () => {
  const dot = pipelineDot("parallel-illumination-to-implementation");

  it("removes the memory_writer node declaration", () => {
    expect(dot).not.toMatch(/^\s*memory_writer\s*\[/m);
  });

  it("removes the memory_reflector node declaration", () => {
    expect(dot).not.toMatch(/^\s*memory_reflector\s*\[/m);
  });

  it("removes any memory_writer / memory_reflector edges", () => {
    expect(dot).not.toMatch(/memory_writer\b/);
    expect(dot).not.toMatch(/memory_reflector\b/);
  });

  it('routes tmux_confirm_gate -> commit_push [label="Commit"] -> done', () => {
    expect(dot).toMatch(/tmux_confirm_gate\s*->\s*commit_push\s*\[label="Commit"\]/);
    expect(dot).toMatch(/commit_push\s*->\s*done/);
  });

  it("memory-writer.md and memory-reflector.md are deleted", () => {
    const folder = join(REPO_ROOT, ".apparat", "pipelines", "parallel-illumination-to-implementation");
    expect(existsSync(join(folder, "memory-writer.md"))).toBe(false);
    expect(existsSync(join(folder, "memory-reflector.md"))).toBe(false);
  });
});
