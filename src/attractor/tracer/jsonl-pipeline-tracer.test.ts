import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { JsonlPipelineTracer } from "./jsonl-pipeline-tracer.js";
import type { Graph, Node, PipelineContext, Outcome } from "../types.js";

function makeGraph(): Graph {
  return { goal: "test", nodes: [{ id: "run", type: "codergen" } as Node], edges: [] } as unknown as Graph;
}
function makeNode(id: string): Node {
  return { id, type: "codergen" } as Node;
}
function makeCtx(values: Record<string, unknown> = {}): PipelineContext {
  return { values };
}
function makeOutcome(success: boolean): Outcome {
  return { status: success ? "success" : "fail", contextUpdates: { "run.success": String(success) } };
}

describe("JsonlPipelineTracer", () => {
  let dir: string;
  let tracePath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ralph-tracer-test-"));
    tracePath = join(dir, "pipeline.jsonl");
  });
  afterEach(() => { rmSync(dir, { recursive: true }); });

  function readLines(): Array<Record<string, unknown>> {
    return readFileSync(tracePath, "utf-8")
      .trim()
      .split("\n")
      .map(l => JSON.parse(l));
  }

  it("creates the trace file and writes pipeline-start event", () => {
    const tracer = new JsonlPipelineTracer(tracePath);
    tracer.onPipelineStart({ runId: "abc123", graph: makeGraph(), ctx: makeCtx() });
    const lines = readLines();
    expect(lines).toHaveLength(1);
    expect(lines[0].kind).toBe("pipeline-start");
    expect(lines[0].runId).toBe("abc123");
    expect(lines[0].goal).toBe("test");
    expect(lines[0].nodes).toEqual(["run"]);
    expect(typeof lines[0].timestamp).toBe("string");
  });

  it("writes node-start event with contextSnapshot", () => {
    const tracer = new JsonlPipelineTracer(tracePath);
    const ctx = makeCtx({ "run.output": "some output", "run.success": "true" });
    tracer.onNodeStart({ nodeReceiveId: "summarize-4f8c", node: makeNode("summarize"), ctx });
    const lines = readLines();
    expect(lines[0].kind).toBe("node-start");
    expect(lines[0].nodeReceiveId).toBe("summarize-4f8c");
    expect(lines[0].nodeId).toBe("summarize");
    expect(lines[0].contextSnapshot).toEqual({ "run.output": "some output", "run.success": "true" });
  });

  it("writes node-end event with contextUpdates", () => {
    const tracer = new JsonlPipelineTracer(tracePath);
    tracer.onNodeEnd({
      nodeReceiveId: "run-1a3d",
      node: makeNode("run"),
      outcome: makeOutcome(true),
    });
    const lines = readLines();
    expect(lines[0].kind).toBe("node-end");
    expect(lines[0].nodeReceiveId).toBe("run-1a3d");
    expect(lines[0].success).toBe(true);
    expect(lines[0].contextUpdates).toEqual({ "run.success": "true" });
  });

  it("writes pipeline-end event", () => {
    const tracer = new JsonlPipelineTracer(tracePath);
    tracer.onPipelineEnd({ runId: "abc123", outcome: "success" });
    const lines = readLines();
    expect(lines[0].kind).toBe("pipeline-end");
    expect(lines[0].outcome).toBe("success");
  });

  it("appends events sequentially (full pipeline sequence)", () => {
    const tracer = new JsonlPipelineTracer(tracePath);
    tracer.onPipelineStart({ runId: "abc123", graph: makeGraph(), ctx: makeCtx() });
    tracer.onNodeStart({ nodeReceiveId: "run-1a3d", node: makeNode("run"), ctx: makeCtx() });
    tracer.onNodeEnd({ nodeReceiveId: "run-1a3d", node: makeNode("run"), outcome: makeOutcome(true) });
    tracer.onPipelineEnd({ runId: "abc123", outcome: "success" });
    const lines = readLines();
    expect(lines).toHaveLength(4);
    expect(lines.map(l => l.kind)).toEqual([
      "pipeline-start", "node-start", "node-end", "pipeline-end"
    ]);
  });

  it("creates parent directory if it does not exist", () => {
    const nestedPath = join(dir, "nested", "deep", "pipeline.jsonl");
    const tracer = new JsonlPipelineTracer(nestedPath);
    tracer.onPipelineEnd({ runId: "x", outcome: "failure" });
    const lines = readFileSync(nestedPath, "utf-8").trim().split("\n").map(l => JSON.parse(l));
    expect(lines[0].kind).toBe("pipeline-end");
  });

  it("writes node-end event with failureReason when outcome has one", () => {
    const tracer = new JsonlPipelineTracer(tracePath);
    tracer.onNodeEnd({
      nodeReceiveId: "run-abcd",
      node: makeNode("run"),
      outcome: { status: "fail", failureReason: "Script exited with code 1: boom\n", contextUpdates: { "tool.output": "" } },
    });
    const lines = readLines();
    expect(lines[0].kind).toBe("node-end");
    expect(lines[0].success).toBe(false);
    expect(lines[0].failureReason).toBe("Script exited with code 1: boom\n");
  });

  it("omits failureReason from node-end event when outcome has none", () => {
    const tracer = new JsonlPipelineTracer(tracePath);
    tracer.onNodeEnd({
      nodeReceiveId: "run-abcd",
      node: makeNode("run"),
      outcome: makeOutcome(true),
    });
    const lines = readLines();
    expect(lines[0].kind).toBe("node-end");
    expect("failureReason" in lines[0]).toBe(false);
  });
});
