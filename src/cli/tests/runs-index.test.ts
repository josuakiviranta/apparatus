import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { listAllRuns, listRunsForPipeline, summarizeRun, type RunSummary } from "../lib/runs-index.js";

function writeRun(
  root: string,
  runId: string,
  events: Array<Record<string, unknown>>,
): string {
  const dir = join(root, runId);
  mkdirSync(dir, { recursive: true });
  if (events.length > 0) {
    writeFileSync(
      join(dir, "pipeline.jsonl"),
      events.map(e => JSON.stringify(e)).join("\n") + "\n",
    );
  }
  return dir;
}

describe("listAllRuns", () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), "apparat-runs-idx-")); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it("parses pipeline-start + pipeline-end into a success RunSummary", () => {
    writeRun(root, "meditate-aaaaaaaa", [
      { kind: "pipeline-start", runId: "meditate-aaaaaaaa", pipelineName: "meditate", goal: "g", nodes: [], timestamp: "2026-05-09T19:30:00.000Z" },
      { kind: "pipeline-end", runId: "meditate-aaaaaaaa", outcome: "success", timestamp: "2026-05-09T19:30:12.400Z" },
    ]);
    const runs = listAllRuns(root);
    expect(runs).toHaveLength(1);
    const r: RunSummary = runs[0];
    expect(r.runId).toBe("meditate-aaaaaaaa");
    expect(r.pipelineName).toBe("meditate");
    expect(r.startedAt).toBe("2026-05-09T19:30:00.000Z");
    expect(r.outcome).toBe("success");
    expect(r.durationMs).toBe(12400);
    expect(r.failedNodeId).toBeNull();
  });

  it("classifies a dir with no pipeline.jsonl as crashed (pipelineName null)", () => {
    mkdirSync(join(root, "crashed-1"), { recursive: true });
    const runs = listAllRuns(root);
    expect(runs).toHaveLength(1);
    expect(runs[0].outcome).toBe("crashed");
    expect(runs[0].pipelineName).toBeNull();
    expect(runs[0].startedAt).toBeNull();
  });

  it("classifies pipeline-start without pipeline-end as in-progress", () => {
    writeRun(root, "meditate-bbbbbbbb", [
      { kind: "pipeline-start", runId: "meditate-bbbbbbbb", pipelineName: "meditate", goal: "g", nodes: [], timestamp: "2026-05-09T19:30:00.000Z" },
      { kind: "node-start", nodeReceiveId: "n-1", nodeId: "n", nodeKind: "agent", timestamp: "T1", contextSnapshot: {} },
    ]);
    const runs = listAllRuns(root);
    expect(runs).toHaveLength(1);
    expect(runs[0].outcome).toBe("in-progress");
    expect(runs[0].durationMs).toBeNull();
    expect(runs[0].failedNodeId).toBeNull();
  });

  it("populates failedNodeId from the last failed node-end on a failure run", () => {
    writeRun(root, "meditate-cccccccc", [
      { kind: "pipeline-start", runId: "meditate-cccccccc", pipelineName: "meditate", goal: "g", nodes: [], timestamp: "2026-05-09T19:00:00.000Z" },
      { kind: "node-end", nodeReceiveId: "ok-1", nodeId: "ok-node", success: true, contextUpdates: {} },
      { kind: "node-end", nodeReceiveId: "bad-1", nodeId: "classifier", success: false, contextUpdates: {} },
      { kind: "pipeline-end", runId: "meditate-cccccccc", outcome: "failure", timestamp: "2026-05-09T19:00:04.100Z" },
    ]);
    const runs = listAllRuns(root);
    expect(runs[0].outcome).toBe("failure");
    expect(runs[0].failedNodeId).toBe("classifier");
    expect(runs[0].durationMs).toBe(4100);
  });

  it("sorts newest-first by startedAt and pushes crashed entries to the end", () => {
    writeRun(root, "meditate-1", [
      { kind: "pipeline-start", runId: "meditate-1", pipelineName: "meditate", goal: "g", nodes: [], timestamp: "2026-05-09T18:00:00.000Z" },
      { kind: "pipeline-end", runId: "meditate-1", outcome: "success", timestamp: "2026-05-09T18:00:01.000Z" },
    ]);
    writeRun(root, "meditate-2", [
      { kind: "pipeline-start", runId: "meditate-2", pipelineName: "meditate", goal: "g", nodes: [], timestamp: "2026-05-09T19:00:00.000Z" },
      { kind: "pipeline-end", runId: "meditate-2", outcome: "success", timestamp: "2026-05-09T19:00:01.000Z" },
    ]);
    mkdirSync(join(root, "crashed-1"), { recursive: true });
    const ids = listAllRuns(root).map(r => r.runId);
    expect(ids).toEqual(["meditate-2", "meditate-1", "crashed-1"]);
  });

  it("ignores non-directory entries", () => {
    writeFileSync(join(root, "stray.txt"), "x");
    expect(listAllRuns(root)).toEqual([]);
  });

  it("returns [] when runsRoot does not exist", () => {
    expect(listAllRuns(join(root, "missing"))).toEqual([]);
  });
});

describe("listRunsForPipeline", () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), "apparat-runs-idx-filter-")); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it("filters to runs whose JSONL pipelineName matches", () => {
    writeRun(root, "meditate-1", [
      { kind: "pipeline-start", runId: "meditate-1", pipelineName: "meditate", goal: "g", nodes: [], timestamp: "2026-05-09T19:00:00.000Z" },
      { kind: "pipeline-end", runId: "meditate-1", outcome: "success", timestamp: "2026-05-09T19:00:01.000Z" },
    ]);
    writeRun(root, "janitor-1", [
      { kind: "pipeline-start", runId: "janitor-1", pipelineName: "janitor", goal: "g", nodes: [], timestamp: "2026-05-09T19:30:00.000Z" },
      { kind: "pipeline-end", runId: "janitor-1", outcome: "success", timestamp: "2026-05-09T19:30:01.000Z" },
    ]);
    expect(listRunsForPipeline(root, "meditate").map(r => r.runId)).toEqual(["meditate-1"]);
    expect(listRunsForPipeline(root, "janitor").map(r => r.runId)).toEqual(["janitor-1"]);
    expect(listRunsForPipeline(root, "unknown")).toEqual([]);
  });

  it("matches old bare-id directories whose JSONL still carries pipelineName", () => {
    writeRun(root, "deadbeef", [
      { kind: "pipeline-start", runId: "deadbeef", pipelineName: "meditate", goal: "g", nodes: [], timestamp: "2026-05-09T19:00:00.000Z" },
      { kind: "pipeline-end", runId: "deadbeef", outcome: "success", timestamp: "2026-05-09T19:00:01.000Z" },
    ]);
    expect(listRunsForPipeline(root, "meditate").map(r => r.runId)).toEqual(["deadbeef"]);
  });
});

describe("summarizeRun", () => {
  it("returns a RunSummary for an existing run dir with a finished trace", () => {
    const root = mkdtempSync(join(tmpdir(), "runs-summary-"));
    const dir = join(root, "r-1");
    mkdirSync(dir);
    writeFileSync(join(dir, "pipeline.jsonl"),
      JSON.stringify({ kind: "pipeline-start", pipelineName: "demo", timestamp: "2026-05-11T10:00:00Z" }) + "\n" +
      JSON.stringify({ kind: "pipeline-end",   outcome: "success",   timestamp: "2026-05-11T10:00:01Z" }) + "\n"
    );
    const s = summarizeRun(root, "r-1");
    expect(s.runId).toBe("r-1");
    expect(s.pipelineName).toBe("demo");
    expect(s.outcome).toBe("success");
    rmSync(root, { recursive: true });
  });

  it("returns outcome 'crashed' when the run dir has no pipeline.jsonl", () => {
    const root = mkdtempSync(join(tmpdir(), "runs-summary-"));
    const dir = join(root, "r-2");
    mkdirSync(dir);
    const s = summarizeRun(root, "r-2");
    expect(s.outcome).toBe("crashed");
    expect(s.runId).toBe("r-2");
    rmSync(root, { recursive: true });
  });

  it("returns outcome 'in-progress' when pipeline-end is missing", () => {
    const root = mkdtempSync(join(tmpdir(), "runs-summary-"));
    const dir = join(root, "r-3");
    mkdirSync(dir);
    writeFileSync(join(dir, "pipeline.jsonl"),
      JSON.stringify({ kind: "pipeline-start", pipelineName: "demo", timestamp: "2026-05-11T10:00:00Z" }) + "\n"
    );
    expect(summarizeRun(root, "r-3").outcome).toBe("in-progress");
    rmSync(root, { recursive: true });
  });
});
