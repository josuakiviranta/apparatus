import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, existsSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { gcOldRunsPerPipeline } from "../commands/pipeline.js";

function writeRun(
  root: string,
  runId: string,
  events: Array<Record<string, unknown>> | "no-jsonl",
): string {
  const dir = join(root, runId);
  mkdirSync(dir, { recursive: true });
  if (events !== "no-jsonl") {
    writeFileSync(
      join(dir, "pipeline.jsonl"),
      events.map(e => JSON.stringify(e)).join("\n") + "\n",
    );
  }
  return dir;
}

function meditateRun(runId: string, ts: string): Array<Record<string, unknown>> {
  return [
    { kind: "pipeline-start", runId, pipelineName: "meditate", goal: "g", nodes: [], timestamp: ts },
    { kind: "pipeline-end", runId, outcome: "success", timestamp: ts },
  ];
}
function janitorRun(runId: string, ts: string): Array<Record<string, unknown>> {
  return [
    { kind: "pipeline-start", runId, pipelineName: "janitor", goal: "g", nodes: [], timestamp: ts },
    { kind: "pipeline-end", runId, outcome: "success", timestamp: ts },
  ];
}

describe("gcOldRunsPerPipeline", () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), "apparat-gc-pp-")); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it("is a no-op when fewer than perPipelineKeep runs exist", () => {
    writeRun(root, "meditate-1", meditateRun("meditate-1", "2026-05-09T18:00:00.000Z"));
    writeRun(root, "meditate-2", meditateRun("meditate-2", "2026-05-09T18:00:01.000Z"));
    gcOldRunsPerPipeline(root, { perPipelineKeep: 5, crashAtStartKeep: 5 });
    expect(existsSync(join(root, "meditate-1"))).toBe(true);
    expect(existsSync(join(root, "meditate-2"))).toBe(true);
  });

  it("keeps the newest K per pipeline, deletes the rest of that bucket", () => {
    for (let i = 0; i < 5; i++) {
      const ts = `2026-05-09T18:00:0${i}.000Z`;
      writeRun(root, `meditate-${i}`, meditateRun(`meditate-${i}`, ts));
    }
    for (let i = 0; i < 3; i++) {
      const ts = `2026-05-09T19:00:0${i}.000Z`;
      writeRun(root, `janitor-${i}`, janitorRun(`janitor-${i}`, ts));
    }
    gcOldRunsPerPipeline(root, { perPipelineKeep: 2, crashAtStartKeep: 5 });
    expect(existsSync(join(root, "meditate-3"))).toBe(true);
    expect(existsSync(join(root, "meditate-4"))).toBe(true);
    expect(existsSync(join(root, "meditate-0"))).toBe(false);
    expect(existsSync(join(root, "meditate-1"))).toBe(false);
    expect(existsSync(join(root, "meditate-2"))).toBe(false);
    expect(existsSync(join(root, "janitor-1"))).toBe(true);
    expect(existsSync(join(root, "janitor-2"))).toBe(true);
    expect(existsSync(join(root, "janitor-0"))).toBe(false);
  });

  it("buckets crash-at-start dirs (no pipeline.jsonl) separately from named buckets", () => {
    for (let i = 0; i < 3; i++) {
      const ts = `2026-05-09T18:00:0${i}.000Z`;
      writeRun(root, `meditate-${i}`, meditateRun(`meditate-${i}`, ts));
    }
    for (let i = 0; i < 7; i++) {
      writeRun(root, `crash-${i}`, "no-jsonl");
    }
    gcOldRunsPerPipeline(root, { perPipelineKeep: 2, crashAtStartKeep: 5 });
    expect(existsSync(join(root, "meditate-2"))).toBe(true);
    expect(existsSync(join(root, "meditate-1"))).toBe(true);
    expect(existsSync(join(root, "meditate-0"))).toBe(false);
    const crashSurvivors = ["crash-0","crash-1","crash-2","crash-3","crash-4","crash-5","crash-6"]
      .filter(n => existsSync(join(root, n)));
    expect(crashSurvivors.length).toBe(5);
  });

  it("buckets dirs whose pipeline.jsonl exists but has no pipeline-start as crashed", () => {
    writeRun(root, "broken-1", [{ kind: "node-start", nodeReceiveId: "x" }]);
    writeRun(root, "broken-2", [{ kind: "node-start", nodeReceiveId: "y" }]);
    writeRun(root, "broken-3", [{ kind: "node-start", nodeReceiveId: "z" }]);
    gcOldRunsPerPipeline(root, { perPipelineKeep: 10, crashAtStartKeep: 2 });
    const survivors = ["broken-1","broken-2","broken-3"].filter(n => existsSync(join(root, n)));
    expect(survivors.length).toBe(2);
  });

  it("returns silently if root does not exist", () => {
    expect(() => gcOldRunsPerPipeline(join(root, "missing"), { perPipelineKeep: 5, crashAtStartKeep: 5 })).not.toThrow();
  });

  it("ignores non-directory entries in the runs root", () => {
    writeFileSync(join(root, "stray.txt"), "x");
    writeRun(root, "meditate-1", meditateRun("meditate-1", "2026-05-09T18:00:00.000Z"));
    expect(() => gcOldRunsPerPipeline(root, { perPipelineKeep: 5, crashAtStartKeep: 5 })).not.toThrow();
    expect(existsSync(join(root, "stray.txt"))).toBe(true);
  });

  it("preserves bare-id legacy dirs whose JSONL still carries pipelineName", () => {
    writeRun(root, "deadbeef", meditateRun("deadbeef", "2026-05-09T18:00:00.000Z"));
    writeRun(root, "feedface", meditateRun("feedface", "2026-05-09T18:00:01.000Z"));
    writeRun(root, "meditate-1", meditateRun("meditate-1", "2026-05-09T18:00:02.000Z"));
    gcOldRunsPerPipeline(root, { perPipelineKeep: 2, crashAtStartKeep: 5 });
    expect(existsSync(join(root, "deadbeef"))).toBe(false);
    expect(existsSync(join(root, "feedface"))).toBe(true);
    expect(existsSync(join(root, "meditate-1"))).toBe(true);
  });

  it("respects APPARAT_RUNS_KEEP + APPARAT_CRASH_AT_START_KEEP via the run command's caller plumbing", async () => {
    const { pipelineRunCommand } = await import("../commands/pipeline.js");
    const project = root;
    const dotFile = join(project, "smoke.dot");
    writeFileSync(
      dotFile,
      'digraph meditate { goal="t"; start [shape=Mdiamond]; done [shape=Msquare]; start -> done; }\n',
    );

    for (let i = 0; i < 3; i++) {
      const ts = `2026-05-08T18:00:0${i}.000Z`;
      writeRun(root, `meditate-old-${i}`, meditateRun(`meditate-old-${i}`, ts));
    }
    const orig = process.env.APPARAT_RUNS_KEEP;
    process.env.APPARAT_RUNS_KEEP = "1";
    try {
      const { default: vi } = await import("vitest").then(m => ({ default: m.vi }));
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(((c?: number) => { throw new Error(`exit:${c}`); }) as any);
      try {
        await pipelineRunCommand(dotFile, { project });
      } catch {} finally { exitSpy.mockRestore(); }
    } finally {
      if (orig === undefined) delete process.env.APPARAT_RUNS_KEEP;
      else process.env.APPARAT_RUNS_KEEP = orig;
    }
    const survivors = ["meditate-old-0","meditate-old-1","meditate-old-2"]
      .filter(n => existsSync(join(root, n)));
    expect(survivors.length).toBe(0);
  });
});
