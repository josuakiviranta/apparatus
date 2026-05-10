import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { pipelineRunCommand } from "../commands/pipeline.js";
import { runsDir } from "../lib/apparat-paths.js";

const DOT = `digraph fail_fixture {
  goal="exercise failure-reason surfacing"
  start [shape=Mdiamond]
  runner [shape=parallelogram, type="tool", cwd="$project", tool_command="echo boom-stderr 1>&2; exit 1"]
  done  [shape=Msquare]
  start -> runner -> done
}`;

describe("pipeline run — failureReason surfacing", () => {
  let work: string;
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let writtenStderr = "";
  let fakeHome: string;
  let origHome: string | undefined;

  beforeEach(() => {
    fakeHome = mkdtempSync(join(tmpdir(), "apparat-failreason-home-"));
    origHome = process.env.HOME;
    process.env.HOME = fakeHome;
    work = mkdtempSync(join(tmpdir(), "apparat-failreason-"));
    writeFileSync(join(work, "fail.dot"), DOT);
    writtenStderr = "";
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      writtenStderr += typeof chunk === "string" ? chunk : String(chunk);
      return true;
    });
  });

  afterEach(() => {
    if (origHome === undefined) delete process.env.HOME;
    else process.env.HOME = origHome;
    rmSync(fakeHome, { recursive: true, force: true });
    stderrSpy.mockRestore();
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

    // New layout: <project>/.apparat/runs/<runId>/pipeline.jsonl
    const projectRunsDir = runsDir(work);
    expect(existsSync(projectRunsDir)).toBe(true);
    const runDirs = readdirSync(projectRunsDir);
    expect(runDirs.length).toBeGreaterThan(0);
    const runDirEntry = runDirs.find(d => existsSync(join(projectRunsDir, d, "pipeline.jsonl"))) ?? runDirs[0];
    const tracePath = join(projectRunsDir, runDirEntry, "pipeline.jsonl");
    const trace = readFileSync(tracePath, "utf8");
    const failingEnd = trace
      .trim()
      .split("\n")
      .map(l => JSON.parse(l) as Record<string, unknown>)
      .find(e => e.kind === "node-end" && e.success === false);
    expect(failingEnd).toBeDefined();
    expect(String(failingEnd!.failureReason)).toContain("boom-stderr");

    expect(writtenStderr).toMatch(/✗ failed at runner: .*boom-stderr/);
    expect(writtenStderr).toContain(`trace: ${tracePath}`);
    expect(writtenStderr).toMatch(/inspect: apparat pipeline trace .* --node-receive \S+ --full/);
    expect(writtenStderr).toMatch(/\n\nresume: apparat pipeline run .*--resume \S+/);
    // Tool node — no agent clause, no raw-output line.
    expect(writtenStderr).not.toContain("(agent:");
    expect(writtenStderr).not.toContain("raw output:");
  });
});
