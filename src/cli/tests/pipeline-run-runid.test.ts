import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { rmSync } from "fs";
import { pipelineRunCommand } from "../commands/pipeline/run.js";
import { readProjects } from "../lib/projects-registry.js";
import { withFakeApparatHome, type FakeApparatHome } from "./_apparatHome";

afterEach(() => { vi.restoreAllMocks(); });

describe("pipelineRunCommand records the project in ~/.apparat/projects.json", () => {
  let scratch: FakeApparatHome;

  beforeEach(() => {
    scratch = withFakeApparatHome("apparat-rec-home");
  });

  afterEach(() => {
    scratch.cleanup();
  });

  it("appends the absolute project path with lastSeen", async () => {
    const project = mkdtempSync(join(tmpdir(), "apparat-rec-proj-"));
    const dotFile = join(project, "smoke.dot");
    writeFileSync(
      dotFile,
      'digraph smoke { goal="t"; start [shape=Mdiamond]; done [shape=Msquare]; start -> done; }\n',
    );
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((c?: number) => { throw new Error(`exit:${c}`); }) as any);
    try {
      await pipelineRunCommand(dotFile, { project });
    } catch {} finally { exitSpy.mockRestore(); }

    const entries = readProjects();
    expect(entries.find((e) => e.path === project)).toBeTruthy();

    rmSync(project, { recursive: true, force: true });
  });
});

describe("pipelineRunCommand --run-id override", () => {
  let scratch: FakeApparatHome;

  beforeEach(() => {
    scratch = withFakeApparatHome("apparat-runid-home");
  });

  afterEach(() => {
    scratch.cleanup();
  });

  it("uses opts.runId instead of allocating a fresh one", async () => {
    const project = mkdtempSync(join(tmpdir(), "apparat-runid-"));
    const dotFile = join(project, "smoke.dot");
    writeFileSync(
      dotFile,
      'digraph smoke { goal="t"; start [shape=Mdiamond]; done [shape=Msquare]; start -> done; }\n',
    );
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((c?: number) => { throw new Error(`exit:${c}`); }) as any);
    let caught: unknown = null;
    try {
      await pipelineRunCommand(dotFile, { project, runId: "deadbeef" });
    } catch (e) { caught = e; } finally { exitSpy.mockRestore(); }
    // After 2026-05-12-pipeline-write-consume-pairing: green runs delete
    // <project>/.apparat/runs/<runId>/ via gcRunScopedArtefactsOnSuccess.
    // The override is honoured when no _other_ run dir is created (the runner
    // would otherwise allocate a fresh <slug>-<8hex> and we'd see it here).
    const runsRoot = join(project, ".apparat", "runs");
    const dirs = existsSync(runsRoot) ? readdirSync(runsRoot) : [];
    expect(dirs.filter(d => d !== "deadbeef")).toEqual([]);
    rmSync(project, { recursive: true, force: true });
  });
});

describe("pipelineRunCommand --resume uses the resumed id as runId", () => {
  let scratch: FakeApparatHome;

  beforeEach(() => {
    scratch = withFakeApparatHome("apparat-resume-runid-home");
  });

  afterEach(() => {
    scratch.cleanup();
  });

  it("propagates --resume <id> as runId so success-GC reaps the resumed dir", async () => {
    const project = mkdtempSync(join(tmpdir(), "apparat-resume-runid-"));
    const dotFile = join(project, "smoke.dot");
    writeFileSync(
      dotFile,
      'digraph smoke { goal="t"; start [shape=Mdiamond]; done [shape=Msquare]; start -> done; }\n',
    );
    // Pre-create the run dir so resolveResumeLogsRoot doesn't exit.
    // Engine will warn "no checkpoint" and start fresh — graph completes.
    const runsRoot = join(project, ".apparat", "runs");
    const resumedId = "smoke-deadbeef";
    const { mkdirSync } = await import("fs");
    mkdirSync(join(runsRoot, resumedId), { recursive: true });

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((c?: number) => { throw new Error(`exit:${c}`); }) as any);
    try {
      await pipelineRunCommand(dotFile, { project, resume: resumedId });
    } catch {} finally { exitSpy.mockRestore(); }

    // After fix: runId === resumedId, success-GC removes <runsRoot>/<resumedId>,
    // leaving runsRoot empty. With the bug, runId is a freshly-minted phantom,
    // success-GC tries to rm <runsRoot>/<phantom> (no-op), and the resumed
    // dir LEAKS. Asserting empty runsRoot pins the contract.
    const dirs = existsSync(runsRoot) ? readdirSync(runsRoot) : [];
    expect(dirs).toEqual([]);
    rmSync(project, { recursive: true, force: true });
  });
});

describe("pipelineRunCommand allocates a slug-prefixed runId by default", () => {
  let scratch: FakeApparatHome;

  beforeEach(() => {
    scratch = withFakeApparatHome("apparat-slugrunid-home");
  });

  afterEach(() => {
    scratch.cleanup();
  });

  it("creates <project>/.apparat/runs/<pipeline-slug>-<8hex>/pipeline.jsonl", async () => {
    const project = mkdtempSync(join(tmpdir(), "apparat-slug-runid-"));
    const dotFile = join(project, "smoke.dot");
    writeFileSync(
      dotFile,
      'digraph janitor { goal="t"; start [shape=Mdiamond]; done [shape=Msquare]; start -> done; }\n',
    );
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((c?: number) => { throw new Error(`exit:${c}`); }) as any);
    try {
      await pipelineRunCommand(dotFile, { project });
    } catch {} finally { exitSpy.mockRestore(); }

    // After 2026-05-12-pipeline-write-consume-pairing: green runs GC the
    // <project>/.apparat/runs/<runId>/ dir. The runner still allocates a
    // slug-prefixed runId — coverage for the allocator's name shape lives in
    // src/cli/tests/apparat-paths-slug-format.test.ts. Here we only confirm
    // the green-run contract: the run dir is GC'd (zero residue under runsRoot).
    const runsRoot = join(project, ".apparat", "runs");
    const dirs = existsSync(runsRoot) ? readdirSync(runsRoot) : [];
    expect(dirs).toEqual([]);
    rmSync(project, { recursive: true, force: true });
  });
});
