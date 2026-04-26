import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { pipelineRunCommand } from "../commands/pipeline.js";

const DOT = `digraph fail_fixture {
  goal="exercise failure-reason surfacing"
  start [shape=Mdiamond]
  runner [shape=parallelogram, type="tool", cwd="$project", tool_command="echo boom-stderr 1>&2; exit 1"]
  done  [shape=Msquare]
  start -> runner -> done
}`;

describe("pipeline run — failureReason surfacing", () => {
  let work: string;
  let runsRoot: string;
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let writtenStderr = "";

  beforeEach(() => {
    work = mkdtempSync(join(tmpdir(), "ralph-failreason-"));
    runsRoot = join(work, "runs");
    process.env.RALPH_RUNS_ROOT = runsRoot;
    writeFileSync(join(work, "fail.dot"), DOT);
    writtenStderr = "";
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      writtenStderr += typeof chunk === "string" ? chunk : String(chunk);
      return true;
    });
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    delete process.env.RALPH_RUNS_ROOT;
    rmSync(work, { recursive: true, force: true });
  });

  it("writes failureReason into the trace and prints one-line stderr summary", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((_code?: number) => {
      throw new Error("__exit__");
    }) as never);

    await expect(
      pipelineRunCommand(join(work, "fail.dot"), { project: work }),
    ).rejects.toThrow("__exit__");

    exitSpy.mockRestore();

    expect(existsSync(runsRoot)).toBe(true);
    // New layout: runsRoot/<projectKey>/runs/<runId>/pipeline.jsonl
    const projectDirs = readdirSync(runsRoot);
    expect(projectDirs.length).toBeGreaterThan(0);
    const projectDir = projectDirs[0];
    const runsDir = join(runsRoot, projectDir, "runs");
    const runDirs = readdirSync(runsDir);
    expect(runDirs.length).toBeGreaterThan(0);
    const runDir = runDirs.find(d => existsSync(join(runsDir, d, "pipeline.jsonl"))) ?? runDirs[0];
    const tracePath = join(runsDir, runDir, "pipeline.jsonl");
    const trace = readFileSync(tracePath, "utf8");
    const failingEnd = trace
      .trim()
      .split("\n")
      .map(l => JSON.parse(l) as Record<string, unknown>)
      .find(e => e.kind === "node-end" && e.success === false);
    expect(failingEnd).toBeDefined();
    expect(String(failingEnd!.failureReason)).toContain("boom-stderr");

    expect(writtenStderr).toMatch(/✗ pipeline failed at node runner: .*boom-stderr/);
    expect(writtenStderr).toContain("trace: ");
    expect(writtenStderr).toContain(tracePath);
  });
});
