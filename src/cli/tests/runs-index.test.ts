import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { listAllRuns, listRunsForPipeline, type RunSummary } from "../lib/runs-index.js";

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
});
