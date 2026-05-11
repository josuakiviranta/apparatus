import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { replayTraceIntoApp, mapTraceLineToEvent } from "../lib/replayTraceIntoApp.js";

describe("replayTraceIntoApp", () => {
  it("emits a start+end pair for a node-start/node-end pair in the trace", () => {
    const dir = mkdtempSync(join(tmpdir(), "apparat-replay-"));
    const tracePath = join(dir, "pipeline.jsonl");
    writeFileSync(
      tracePath,
      [
        JSON.stringify({ kind: "pipeline-start", runId: "abcd1234", graph: { name: "t", nodes: [] }, timestamp: "t0" }),
        JSON.stringify({ kind: "node-start", nodeId: "work", nodeReceiveId: "work-1", timestamp: "t1" }),
        JSON.stringify({ kind: "node-end", nodeId: "work", success: true, contextUpdates: {}, timestamp: "t2" }),
        JSON.stringify({ kind: "pipeline-end", runId: "abcd1234", outcome: "success", timestamp: "t3" }),
      ].join("\n") + "\n",
    );

    const emit = vi.fn();
    replayTraceIntoApp(tracePath, emit);

    expect(emit).toHaveBeenCalled();
    const kinds = emit.mock.calls.map((c) => (c[0] as any).kind);
    expect(kinds).toContain("start");
    expect(kinds).toContain("end");

    rmSync(dir, { recursive: true, force: true });
  });

  it("returns silently when the trace file does not exist", () => {
    const emit = vi.fn();
    replayTraceIntoApp("/no/such/path.jsonl", emit);
    expect(emit).not.toHaveBeenCalled();
  });

  it("tolerates malformed lines (skips them)", () => {
    const dir = mkdtempSync(join(tmpdir(), "apparat-replay-bad-"));
    const tracePath = join(dir, "pipeline.jsonl");
    writeFileSync(
      tracePath,
      "garbage\n" +
        JSON.stringify({ kind: "node-start", nodeId: "ok", nodeReceiveId: "ok-1", timestamp: "t1" }) +
        "\n",
    );

    const emit = vi.fn();
    replayTraceIntoApp(tracePath, emit);
    const kinds = emit.mock.calls.map((c) => (c[0] as any).kind);
    expect(kinds).toContain("start");

    rmSync(dir, { recursive: true, force: true });
  });

  it("maps node-start with context snapshot correctly", () => {
    const dir = mkdtempSync(join(tmpdir(), "apparat-replay-ctx-"));
    const tracePath = join(dir, "pipeline.jsonl");
    writeFileSync(
      tracePath,
      JSON.stringify({
        kind: "node-start",
        nodeId: "analyze",
        nodeReceiveId: "analyze-1",
        contextSnapshot: { goal: "do something" },
        timestamp: "t1",
      }) + "\n",
    );

    const emit = vi.fn();
    replayTraceIntoApp(tracePath, emit);

    expect(emit).toHaveBeenCalledOnce();
    const ev = emit.mock.calls[0][0] as any;
    expect(ev.kind).toBe("start");
    expect(ev.nodeId).toBe("analyze");
    expect(ev.nodeReceiveId).toBe("analyze-1");
    expect(ev.hasContext).toBe(true);

    rmSync(dir, { recursive: true, force: true });
  });

  it("maps node-end failure correctly", () => {
    const dir = mkdtempSync(join(tmpdir(), "apparat-replay-fail-"));
    const tracePath = join(dir, "pipeline.jsonl");
    writeFileSync(
      tracePath,
      JSON.stringify({
        kind: "node-end",
        nodeId: "work",
        success: false,
        failureReason: "timed out",
        contextUpdates: {},
        timestamp: "t2",
      }) + "\n",
    );

    const emit = vi.fn();
    replayTraceIntoApp(tracePath, emit);

    expect(emit).toHaveBeenCalledOnce();
    const ev = emit.mock.calls[0][0] as any;
    expect(ev.kind).toBe("end");
    expect(ev.outcome.status).toBe("fail");
    expect(ev.outcome.reason).toBe("timed out");

    rmSync(dir, { recursive: true, force: true });
  });
});

describe("mapTraceLineToEvent", () => {
  it("maps node-start trace line to a NodeEvent of kind 'start'", () => {
    const line = JSON.stringify({
      kind: "node-start",
      nodeId: "verifier",
      nodeReceiveId: "rcv-1",
      contextSnapshot: { foo: "bar" },
    });
    const ev = mapTraceLineToEvent(line);
    expect(ev).toEqual({
      kind: "start",
      nodeId: "verifier",
      label: "verifier",
      blockKind: "agent",
      nodeReceiveId: "rcv-1",
      hasContext: true,
    });
  });

  it("maps node-end success to a NodeEvent of kind 'end' with success status", () => {
    const line = JSON.stringify({ kind: "node-end", success: true });
    expect(mapTraceLineToEvent(line)).toEqual({
      kind: "end",
      outcome: { status: "success", reason: undefined },
    });
  });

  it("maps node-end failure with failureReason", () => {
    const line = JSON.stringify({
      kind: "node-end", success: false, failureReason: "rubric failed",
    });
    expect(mapTraceLineToEvent(line)).toEqual({
      kind: "end",
      outcome: { status: "fail", reason: "rubric failed" },
    });
  });

  it("returns null for pipeline-start / pipeline-end / validation-failure / unknown kinds", () => {
    expect(mapTraceLineToEvent(JSON.stringify({ kind: "pipeline-start" }))).toBeNull();
    expect(mapTraceLineToEvent(JSON.stringify({ kind: "pipeline-end" }))).toBeNull();
    expect(mapTraceLineToEvent(JSON.stringify({ kind: "validation-failure" }))).toBeNull();
    expect(mapTraceLineToEvent(JSON.stringify({ kind: "node-foo" }))).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    expect(mapTraceLineToEvent("{not json")).toBeNull();
    expect(mapTraceLineToEvent("")).toBeNull();
  });
});
