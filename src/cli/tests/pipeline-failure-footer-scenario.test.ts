import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, copyFileSync, existsSync, readdirSync } from "fs";
import { tmpdir } from "os";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { pipelineRunCommand } from "../commands/pipeline.js";
import { runsDir } from "../lib/apparat-paths.js";

// Anchor scenario path on this test file's location — survives any cwd shift.
const __dirname = dirname(fileURLToPath(import.meta.url));
const SCENARIO = resolve(__dirname, "../../../.apparat/scenarios/pipeline-failure-footer/pipeline.dot");

describe("scenario: pipeline-failure-footer", () => {
  let work: string;
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let writtenStderr = "";

  beforeEach(() => {
    work = mkdtempSync(join(tmpdir(), "apparat-failure-footer-scenario-"));
    copyFileSync(SCENARIO, join(work, "pipeline.dot"));
    writtenStderr = "";
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      writtenStderr += typeof chunk === "string" ? chunk : String(chunk);
      return true;
    });
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    rmSync(work, { recursive: true, force: true });
  });

  it("prints the recipe-shape footer when the tool node fails", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((_code?: number) => {
      throw new Error("__exit__");
    }) as never);

    await expect(
      pipelineRunCommand(join(work, "pipeline.dot"), { project: work }),
    ).rejects.toThrow("__exit__");

    exitSpy.mockRestore();

    // Bird's-eye line.
    expect(writtenStderr).toMatch(/✗ failed at runner: .*boom-stderr/);
    // Trace line points at the actual JSONL.
    const projectRunsDir = runsDir(work);
    expect(existsSync(projectRunsDir)).toBe(true);
    const runDirs = readdirSync(projectRunsDir);
    expect(runDirs.length).toBeGreaterThan(0);
    expect(writtenStderr).toMatch(/\ntrace: .*\/pipeline\.jsonl/);
    // Inspect command — the engine emits node-start before the tool runs, so
    // a receive id is always present.
    expect(writtenStderr).toMatch(/\ninspect: apparat pipeline trace [^ ]+ --node-receive [^ ]+ --full/);
    // Blank line separator between investigation and retry blocks.
    expect(writtenStderr).toMatch(/\n\nresume: apparat pipeline run .*--resume /);
    // Tool node — no agent clause, no raw output line.
    expect(writtenStderr).not.toContain("(agent:");
    expect(writtenStderr).not.toContain("raw output:");
  });
});
