import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { replayTraceIntoApp } from "../lib/replayTraceIntoApp.js";

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
