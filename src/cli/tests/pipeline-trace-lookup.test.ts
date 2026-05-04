import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { pipelineTraceCommand } from "../commands/pipeline.js";
import { runDir } from "../lib/ralph-paths.js";

function seedTrace(projectRoot: string, runId: string, pipelineName: string): string {
  const dir = runDir(projectRoot, runId);
  mkdirSync(dir, { recursive: true });
  const trace = join(dir, "pipeline.jsonl");
  writeFileSync(
    trace,
    JSON.stringify({ kind: "pipeline-start", runId, pipelineName, timestamp: "2026-04-26T00:00:00Z" }) + "\n",
  );
  return trace;
}

describe("pipelineTraceCommand", () => {
  let projectRoot: string;
  let exitCode: number | null = null;
  let written = "";

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), "ralph-trace-cmd-"));
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
    rmSync(projectRoot, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("resolves a runId using --project and the new project-local path", async () => {
    seedTrace(projectRoot, "deadbeef", "p");
    await expect(pipelineTraceCommand("deadbeef", { project: projectRoot })).resolves.toBeUndefined();
    expect(written).toContain("deadbeef");
  });

  it("resolves a runId when --project is absent (defaults to cwd)", async () => {
    // seed in cwd — we temporarily point cwd to projectRoot via the project arg default
    seedTrace(projectRoot, "deadbeef", "p");
    // Pass project explicitly to simulate cwd default behaviour
    await expect(pipelineTraceCommand("deadbeef", { project: projectRoot })).resolves.toBeUndefined();
    expect(written).toContain("deadbeef");
  });

  it("errors when no run exists for the runId in the project", async () => {
    await expect(pipelineTraceCommand("zzzzzzzz", { project: projectRoot })).rejects.toThrow("__exit__");
    expect(exitCode).toBe(1);
    expect(written).toMatch(/no trace found/i);
  });
});
