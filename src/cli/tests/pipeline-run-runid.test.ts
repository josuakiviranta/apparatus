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
    try {
      await pipelineRunCommand(dotFile, { project, runId: "deadbeef" });
    } catch {} finally { exitSpy.mockRestore(); }
    const tracePath = join(project, ".apparat", "runs", "deadbeef", "pipeline.jsonl");
    expect(existsSync(tracePath)).toBe(true);
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

    const runsRoot = join(project, ".apparat", "runs");
    const dirs = readdirSync(runsRoot);
    expect(dirs.length).toBe(1);
    expect(dirs[0]).toMatch(/^janitor-[0-9a-f]{8}$/);
    rmSync(project, { recursive: true, force: true });
  });
});
