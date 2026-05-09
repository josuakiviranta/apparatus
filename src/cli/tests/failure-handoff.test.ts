import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  renderFailureFooter,
  type FailureHandoff,
} from "../lib/failure-handoff.js";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { loadFailureHandoff } from "../lib/failure-handoff.js";
import type { Graph, Node } from "../../attractor/types.js";

function buildGraph(node: Node): Graph {
  const nodes = new Map<string, Node>();
  nodes.set(node.id, node);
  return { name: "fixture", nodes, edges: [] } as unknown as Graph;
}

function writeJsonl(path: string, events: object[]): void {
  writeFileSync(path, events.map(e => JSON.stringify(e)).join("\n") + "\n");
}

const FULL: FailureHandoff = {
  nodeId: "runner",
  nodeReceiveId: "7f3e9c1a",
  agentRelPath: "pipelines/my/runner.md",
  reason: "boom-stderr",
  tracePath: "/work/.apparat/runs/a1b2c3d4/pipeline.jsonl",
  runId: "a1b2c3d4",
  rawOutputPath: "/work/.apparat/runs/a1b2c3d4/runner/raw-3.txt",
  resumeCommand: "apparat pipeline run /work/pipelines/my.dot --resume a1b2c3d4",
};

describe("renderFailureFooter", () => {
  it("renders the full recipe with agent + receive id + raw output + resume", () => {
    expect(renderFailureFooter(FULL)).toBe(
      "✗ failed at runner (agent: pipelines/my/runner.md): boom-stderr\n" +
      "trace: /work/.apparat/runs/a1b2c3d4/pipeline.jsonl\n" +
      "raw output: /work/.apparat/runs/a1b2c3d4/runner/raw-3.txt\n" +
      "inspect: apparat pipeline trace a1b2c3d4 --node-receive 7f3e9c1a --full\n" +
      "\n" +
      "resume: apparat pipeline run /work/pipelines/my.dot --resume a1b2c3d4\n"
    );
  });

  it("omits the agent clause when agentRelPath is null (tool node)", () => {
    const tool: FailureHandoff = { ...FULL, agentRelPath: null };
    const out = renderFailureFooter(tool);
    expect(out).toContain("✗ failed at runner: boom-stderr\n");
    expect(out).not.toContain("(agent:");
  });

  it("omits the inspect line when nodeReceiveId is null (early crash)", () => {
    const early: FailureHandoff = { ...FULL, nodeReceiveId: null, rawOutputPath: null };
    const out = renderFailureFooter(early);
    expect(out).not.toContain("inspect:");
    expect(out).not.toContain("raw output:");
    // Bird's-eye + trace + blank + resume = 4 lines + trailing newline.
    expect(out.split("\n")).toEqual([
      "✗ failed at runner (agent: pipelines/my/runner.md): boom-stderr",
      "trace: /work/.apparat/runs/a1b2c3d4/pipeline.jsonl",
      "",
      "resume: apparat pipeline run /work/pipelines/my.dot --resume a1b2c3d4",
      "",
    ]);
  });

  it("omits the raw output line when rawOutputPath is null but keeps inspect", () => {
    const noRaw: FailureHandoff = { ...FULL, rawOutputPath: null };
    const out = renderFailureFooter(noRaw);
    expect(out).not.toContain("raw output:");
    expect(out).toContain("inspect: apparat pipeline trace a1b2c3d4 --node-receive 7f3e9c1a --full");
  });

  it("always includes the blank-line separator before the resume block", () => {
    const out = renderFailureFooter(FULL);
    expect(out).toMatch(/\n\nresume: /);
  });

  it("ends with a trailing newline", () => {
    expect(renderFailureFooter(FULL).endsWith("\n")).toBe(true);
  });
});

describe("loadFailureHandoff", () => {
  let work: string;
  let tracePath: string;
  let dotDir: string;

  beforeEach(() => {
    work = mkdtempSync(join(tmpdir(), "apparat-load-handoff-"));
    mkdirSync(join(work, "runs"), { recursive: true });
    tracePath = join(work, "runs", "pipeline.jsonl");
    dotDir = work;
  });

  afterEach(() => {
    rmSync(work, { recursive: true, force: true });
  });

  it("picks the latest node-start's nodeReceiveId for the failed node", () => {
    writeJsonl(tracePath, [
      { kind: "pipeline-start", runId: "a1b2c3d4", pipelineName: "f" },
      { kind: "node-start", nodeReceiveId: "old-id", nodeId: "runner", nodeKind: "tool" },
      { kind: "node-end", nodeReceiveId: "old-id", nodeId: "runner", success: false, failureReason: "first" },
      { kind: "node-start", nodeReceiveId: "latest-id", nodeId: "runner", nodeKind: "tool" },
      { kind: "node-end", nodeReceiveId: "latest-id", nodeId: "runner", success: false, failureReason: "boom" },
      { kind: "pipeline-end", runId: "a1b2c3d4", outcome: "failure" },
    ]);

    const node = { id: "runner", type: "tool", shape: "parallelogram" } as Node;
    const handoff = loadFailureHandoff({
      tracePath,
      failedNodeId: "runner",
      failureReason: "boom",
      dotFile: "/work/my.dot",
      dotDir,
      runId: "a1b2c3d4",
      graph: buildGraph(node),
    });

    expect(handoff.nodeReceiveId).toBe("latest-id");
    expect(handoff.nodeId).toBe("runner");
    expect(handoff.reason).toBe("boom");
    expect(handoff.runId).toBe("a1b2c3d4");
    expect(handoff.tracePath).toBe(tracePath);
    expect(handoff.resumeCommand).toBe("apparat pipeline run /work/my.dot --resume a1b2c3d4");
    expect(handoff.agentRelPath).toBeNull(); // tool node
    expect(handoff.rawOutputPath).toBeNull(); // no validation-failure events
  });

  it("picks the highest-attempt validation-failure rawOutputPath", () => {
    writeJsonl(tracePath, [
      { kind: "node-start", nodeReceiveId: "rid-1", nodeId: "agent", nodeKind: "agent" },
      { kind: "validation-failure", nodeReceiveId: "rid-1", nodeId: "agent", attempt: 1, errors: [], rawOutputPath: "/r/raw-1.txt" },
      { kind: "validation-failure", nodeReceiveId: "rid-1", nodeId: "agent", attempt: 3, errors: [], rawOutputPath: "/r/raw-3.txt" },
      { kind: "validation-failure", nodeReceiveId: "rid-1", nodeId: "agent", attempt: 2, errors: [], rawOutputPath: "/r/raw-2.txt" },
      { kind: "node-end", nodeReceiveId: "rid-1", nodeId: "agent", success: false, failureReason: "schema fail" },
    ]);

    const node = { id: "agent", agent: "agent" } as Node;
    writeFileSync(join(dotDir, "agent.md"), "---\noutputs:\n  ok: bool\n---\n");

    const handoff = loadFailureHandoff({
      tracePath,
      failedNodeId: "agent",
      failureReason: "schema fail",
      dotFile: "/work/my.dot",
      dotDir,
      runId: "a1b2c3d4",
      graph: buildGraph(node),
    });

    expect(handoff.rawOutputPath).toBe("/r/raw-3.txt");
    expect(handoff.nodeReceiveId).toBe("rid-1");
    expect(handoff.agentRelPath).toMatch(/agent\.md$/);
  });

  it("returns nodeReceiveId=null when no node-start was authored for the failed node", () => {
    writeJsonl(tracePath, [
      { kind: "pipeline-start", runId: "a1b2c3d4" },
      { kind: "pipeline-end", runId: "a1b2c3d4", outcome: "failure" },
    ]);

    const node = { id: "runner", type: "tool" } as Node;
    const handoff = loadFailureHandoff({
      tracePath,
      failedNodeId: "runner",
      failureReason: "early crash",
      dotFile: "/work/my.dot",
      dotDir,
      runId: "a1b2c3d4",
      graph: buildGraph(node),
    });

    expect(handoff.nodeReceiveId).toBeNull();
    expect(handoff.rawOutputPath).toBeNull();
    expect(handoff.reason).toBe("early crash");
  });

  it("returns the degraded handoff when the trace file does not exist", () => {
    const node = { id: "runner", type: "tool" } as Node;
    const handoff = loadFailureHandoff({
      tracePath: "/nonexistent/path/pipeline.jsonl",
      failedNodeId: "runner",
      failureReason: "filesystem error",
      dotFile: "/work/my.dot",
      dotDir,
      runId: "a1b2c3d4",
      graph: buildGraph(node),
    });

    expect(handoff.nodeReceiveId).toBeNull();
    expect(handoff.rawOutputPath).toBeNull();
    expect(handoff.tracePath).toBe("/nonexistent/path/pipeline.jsonl");
    expect(handoff.reason).toBe("filesystem error");
  });

  it("truncates failureReason to 500 chars and collapses to one line", () => {
    writeJsonl(tracePath, [
      { kind: "node-start", nodeReceiveId: "rid", nodeId: "runner", nodeKind: "tool" },
    ]);
    const node = { id: "runner", type: "tool" } as Node;
    const longReason = "first line\nsecond line\n" + "x".repeat(1000);
    const handoff = loadFailureHandoff({
      tracePath,
      failedNodeId: "runner",
      failureReason: longReason,
      dotFile: "/work/my.dot",
      dotDir,
      runId: "a1b2c3d4",
      graph: buildGraph(node),
    });
    expect(handoff.reason).toBe("first line");
    expect(handoff.reason.length).toBeLessThanOrEqual(500);
  });

  it("falls back to 'pipeline failed' when failureReason is empty", () => {
    writeJsonl(tracePath, [
      { kind: "node-start", nodeReceiveId: "rid", nodeId: "runner", nodeKind: "tool" },
    ]);
    const node = { id: "runner", type: "tool" } as Node;
    const handoff = loadFailureHandoff({
      tracePath,
      failedNodeId: "runner",
      failureReason: "",
      dotFile: "/work/my.dot",
      dotDir,
      runId: "a1b2c3d4",
      graph: buildGraph(node),
    });
    expect(handoff.reason).toBe("pipeline failed");
  });

  it("resolves agent path for an agent node with an .md sibling", () => {
    writeFileSync(join(dotDir, "implement.md"), "---\noutputs:\n  done: bool\n---\n");
    writeJsonl(tracePath, [
      { kind: "node-start", nodeReceiveId: "rid", nodeId: "implement", nodeKind: "agent" },
    ]);
    const node = { id: "implement", agent: "implement" } as Node;
    const handoff = loadFailureHandoff({
      tracePath,
      failedNodeId: "implement",
      failureReason: "agent crash",
      dotFile: "/work/my.dot",
      dotDir,
      runId: "a1b2c3d4",
      graph: buildGraph(node),
    });
    expect(handoff.agentRelPath).toMatch(/implement\.md$/);
  });
});
