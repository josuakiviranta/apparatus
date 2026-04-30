import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { findRunAcrossProjects, pipelineTraceCommand } from "../commands/pipeline.js";

function seedTrace(root: string, projectKey: string, runId: string, pipelineName: string): string {
  const dir = join(root, projectKey, "runs", runId);
  mkdirSync(dir, { recursive: true });
  const trace = join(dir, "pipeline.jsonl");
  writeFileSync(
    trace,
    JSON.stringify({ kind: "pipeline-start", runId, pipelineName, timestamp: "2026-04-26T00:00:00Z" }) + "\n",
  );
  return trace;
}

describe("findRunAcrossProjects", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "ralph-trace-"));
    process.env.RALPH_RUNS_ROOT = root;
  });
  afterEach(() => {
    delete process.env.RALPH_RUNS_ROOT;
    rmSync(root, { recursive: true, force: true });
  });

  it("returns the unique trace path when one project owns the runId", () => {
    const expected = seedTrace(root, "alpha-aaaaaa", "deadbeef", "p");
    expect(findRunAcrossProjects("deadbeef")).toBe(expected);
  });

  it("returns null when no project owns the runId", () => {
    seedTrace(root, "alpha-aaaaaa", "deadbeef", "p");
    expect(findRunAcrossProjects("cafef00d")).toBeNull();
  });

  it("throws when more than one project owns the same runId", () => {
    seedTrace(root, "alpha-aaaaaa", "deadbeef", "p");
    seedTrace(root, "beta-bbbbbb", "deadbeef", "p");
    expect(() => findRunAcrossProjects("deadbeef")).toThrow(/multiple/i);
  });
});

describe("pipelineTraceCommand", () => {
  let root: string;
  let exitCode: number | null = null;
  let written = "";

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "ralph-trace-cmd-"));
    process.env.RALPH_RUNS_ROOT = root;
    exitCode = null;
    written = "";
    vi.spyOn(process, "exit").mockImplementation(((c?: number) => {
      exitCode = c ?? 0;
      throw new Error("__exit__");
    }) as never);
    vi.spyOn(process.stdout, "write").mockImplementation((c: unknown) => {
      written += typeof c === "string" ? c : String(c);
      return true;
    });
    vi.spyOn(process.stderr, "write").mockImplementation((c: unknown) => {
      written += typeof c === "string" ? c : String(c);
      return true;
    });
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      written += args.map(a => typeof a === "string" ? a : String(a)).join(" ") + "\n";
    });
  });
  afterEach(() => {
    delete process.env.RALPH_RUNS_ROOT;
    rmSync(root, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("resolves a runId via cross-project scan when --project is absent", async () => {
    seedTrace(root, "alpha-aaaaaa", "deadbeef", "p");
    await expect(pipelineTraceCommand("deadbeef")).resolves.toBeUndefined();
    expect(written).toContain("deadbeef");
  });

  it("errors when no project owns the runId", async () => {
    await expect(pipelineTraceCommand("zzzzzzzz")).rejects.toThrow("__exit__");
    expect(exitCode).toBe(1);
    expect(written).toMatch(/no trace found/i);
  });
});
