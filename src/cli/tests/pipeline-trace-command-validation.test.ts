import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipelineTraceCommand } from "../commands/pipeline.js";
import { runDir } from "../lib/apparat-paths.js";

describe("pipeline trace --node-receive surfaces validation attempts", () => {
  const logs: string[] = [];
  const origLog = console.log;
  beforeEach(() => { logs.length = 0; });
  beforeAll(() => { console.log = (...a: unknown[]) => logs.push(a.map(String).join(" ")); });
  afterAll(() => { console.log = origLog; });

  it("prints validation-failure events keyed by nodeReceiveId", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "trace-"));
    const traceDir = runDir(projectRoot, "r1");
    mkdirSync(traceDir, { recursive: true });
    const tracePath = join(traceDir, "pipeline.jsonl");

    const lines = [
      { kind: "pipeline-start", runId: "r1", pipelineName: "p", nodes: ["start","verifier"], timestamp: "" },
      { kind: "node-start", nodeReceiveId: "verifier-1", nodeId: "verifier", nodeKind: "agent", timestamp: "", contextSnapshot: { foo: "bar" } },
      { kind: "validation-failure", nodeReceiveId: "verifier-1", nodeId: "verifier", attempt: 1, errors: [{ path: "preferred_label", message: "Required" }], rawOutputPath: "verifier/raw-attempt-1.txt", timestamp: "" },
      { kind: "node-end", nodeReceiveId: "verifier-1", nodeId: "verifier", success: false, contextUpdates: {} },
      { kind: "pipeline-end", runId: "r1", outcome: "failure", timestamp: "" },
    ];
    writeFileSync(tracePath, lines.map(l => JSON.stringify(l)).join("\n"));

    await pipelineTraceCommand("r1", { project: projectRoot, nodeReceive: "verifier-1" });

    const out = logs.join("\n");
    expect(out).toMatch(/validation attempts:/);
    expect(out).toMatch(/\[1\] ✗ failed — preferred_label: Required/);
    expect(out).toMatch(/raw: verifier\/raw-attempt-1\.txt/);
  });
});
