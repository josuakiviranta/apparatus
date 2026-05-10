import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipelineTraceCommand } from "../commands/pipeline.js";
import { runDir } from "../lib/apparat-paths.js";

describe("pipeline trace accepts both runId shapes", () => {
  const logs: string[] = [];
  const origLog = console.log;
  beforeEach(() => { logs.length = 0; });
  beforeAll(() => { console.log = (...a: unknown[]) => logs.push(a.map(String).join(" ")); });
  afterAll(() => { console.log = origLog; });

  function seedTrace(projectRoot: string, runId: string): void {
    const traceDir = runDir(projectRoot, runId);
    mkdirSync(traceDir, { recursive: true });
    const lines = [
      { kind: "pipeline-start", runId, pipelineName: "meditate", goal: "g", nodes: ["start","done"], timestamp: "2026-05-09T19:00:00.000Z" },
      { kind: "node-start", nodeReceiveId: "done-1", nodeId: "done", nodeKind: "marker", timestamp: "2026-05-09T19:00:01.000Z", contextSnapshot: {} },
      { kind: "node-end", nodeReceiveId: "done-1", nodeId: "done", success: true, contextUpdates: {} },
      { kind: "pipeline-end", runId, outcome: "success", timestamp: "2026-05-09T19:00:02.000Z" },
    ];
    writeFileSync(join(traceDir, "pipeline.jsonl"), lines.map(l => JSON.stringify(l)).join("\n"));
  }

  it("renders a slug-prefixed runId", async () => {
    const project = mkdtempSync(join(tmpdir(), "apparat-trace-compat-"));
    seedTrace(project, "meditate-aaaaaaaa");
    await pipelineTraceCommand("meditate-aaaaaaaa", { project });
    const out = logs.join("\n");
    expect(out).toMatch(/run:\s+meditate-aaaaaaaa/);
    expect(out).toMatch(/outcome: success/);
  });

  it("renders a bare 8-char runId (back-compat for old run dirs)", async () => {
    const project = mkdtempSync(join(tmpdir(), "apparat-trace-compat-"));
    seedTrace(project, "deadbeef");
    await pipelineTraceCommand("deadbeef", { project });
    const out = logs.join("\n");
    expect(out).toMatch(/run:\s+deadbeef/);
    expect(out).toMatch(/outcome: success/);
  });
});
