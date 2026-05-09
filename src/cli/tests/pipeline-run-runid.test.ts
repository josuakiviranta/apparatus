import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { rmSync } from "fs";
import { pipelineRunCommand } from "../commands/pipeline/run.js";
import { readProjects } from "../lib/projects-registry.js";

afterEach(() => { vi.restoreAllMocks(); });

describe("pipelineRunCommand records the project in ~/.apparat/projects.json", () => {
  it("appends the absolute project path with lastSeen", async () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "apparat-rec-home-"));
    const origHome = process.env.HOME;
    process.env.HOME = fakeHome;
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

    process.env.HOME = origHome;
    rmSync(fakeHome, { recursive: true, force: true });
    rmSync(project, { recursive: true, force: true });
  });
});

describe("pipelineRunCommand --run-id override", () => {
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
