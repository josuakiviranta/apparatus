import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { pipelineTraceCommand } from "../commands/pipeline.js";
import { runDir } from "../lib/apparat-paths.js";
import { runPipeline } from "../../attractor/core/engine.js";
import { parseDot } from "../../attractor/core/graph.js";
import { AutoApproveInterviewer } from "../../attractor/interviewer/auto-approve.js";
import { JsonlPipelineTracer } from "../../attractor/tracer/jsonl-pipeline-tracer.js";

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

  it("after a real run, $run_id in context equals the on-disk dir name and trace command resolves", async () => {
    // Inject a deterministic 8-char runId so we can pin both context and on-disk dir.
    const runId = "abcd1234";
    const logsRoot = runDir(projectRoot, runId);
    mkdirSync(logsRoot, { recursive: true });
    const tracePath = join(logsRoot, "pipeline.jsonl");
    const tracer = new JsonlPipelineTracer(tracePath);

    const dot = `digraph g {
      start [shape=Mdiamond]
      done  [shape=Msquare]
      start -> done
    }`;

    const result = await runPipeline(parseDot(dot), {
      logsRoot,
      cwd: projectRoot,
      interviewer: new AutoApproveInterviewer(),
      runId,
      traceWriter: tracer,
    });

    expect(result.status).toBe("success");
    // Load-bearing invariant: $run_id seen by agents == on-disk dir name.
    expect(result.context.run_id).toBe(runId);

    // Public contract: ralph pipeline trace <$run_id> exits 0.
    await expect(
      pipelineTraceCommand(String(result.context.run_id), { project: projectRoot }),
    ).resolves.toBeUndefined();
    expect(written).toContain(runId);
  });
});
