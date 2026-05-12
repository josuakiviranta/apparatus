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
