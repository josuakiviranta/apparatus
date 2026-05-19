import { describe, it, expect } from "vitest";
import { buildTimeline, type TimelineRow } from "../lib/trace-timeline.js";
import type { JsonlLine } from "../lib/trace-cleaner.js";

function pipelineFrame(kind: string, extra: Record<string, unknown>): JsonlLine {
  return { kind, ...extra } as JsonlLine;
}

function toolUseFrame(ts: string, toolName: string, input: unknown): JsonlLine {
  return {
    type: "assistant",
    timestamp: ts,
    message: {
      role: "assistant",
      content: [{ type: "tool_use", name: toolName, input }],
    },
  } as unknown as JsonlLine;
}

describe("buildTimeline", () => {
  it("merges pipeline.jsonl + raw-attempt frames in timestamp order", () => {
    const pipeline: JsonlLine[] = [
      pipelineFrame("pipeline-start", { timestamp: "2026-05-19T00:00:00.000Z", runId: "r1" }),
      pipelineFrame("node-start", {
        timestamp: "2026-05-19T00:00:01.000Z",
        nodeId: "verifier", nodeReceiveId: "verifier-1", nodeKind: "looping-agent",
      }),
      pipelineFrame("node-start", {
        timestamp: "2026-05-19T00:00:05.000Z",
        nodeId: "implement", nodeReceiveId: "implement-1", nodeKind: "looping-agent",
      }),
    ];

    const rawAttempts = [
      {
        nodeReceiveId: "verifier-1",
        iteration: 1,
        lines: [toolUseFrame("2026-05-19T00:00:02.000Z", "Read", { file_path: "illuminations/auth.md" })],
      },
      {
        nodeReceiveId: "implement-1",
        iteration: 1,
        lines: [toolUseFrame("2026-05-19T00:00:06.000Z", "Read", { file_path: "plan.md" })],
      },
      {
        nodeReceiveId: "implement-1",
        iteration: 2,
        lines: [toolUseFrame("2026-05-19T00:00:07.000Z", "Read", { file_path: "plan.md" })],
      },
    ];

    const rows = buildTimeline(pipeline, rawAttempts);

    expect(rows.map(r => r.toolName)).toEqual(["Read", "Read", "Read"]);
    expect(rows.map(r => r.nodeReceiveId)).toEqual(["verifier-1", "implement-1", "implement-1"]);
    expect(rows.map(r => r.iteration)).toEqual([1, 1, 2]);
    expect(rows.map(r => r.inputSummary)).toEqual([
      "illuminations/auth.md", "plan.md", "plan.md",
    ]);
  });

  it("computes tOffsetSec from the first row", () => {
    const pipeline: JsonlLine[] = [
      pipelineFrame("pipeline-start", { timestamp: "2026-05-19T00:00:00.000Z", runId: "r1" }),
      pipelineFrame("node-start", {
        timestamp: "2026-05-19T00:00:10.000Z",
        nodeId: "n", nodeReceiveId: "n-1", nodeKind: "looping-agent",
      }),
    ];
    const rawAttempts = [
      {
        nodeReceiveId: "n-1", iteration: 1,
        lines: [
          toolUseFrame("2026-05-19T00:00:10.500Z", "Read", { file_path: "a" }),
          toolUseFrame("2026-05-19T00:00:12.000Z", "Read", { file_path: "b" }),
        ],
      },
    ];
    const rows = buildTimeline(pipeline, rawAttempts);
    expect(rows[0].tOffsetSec).toBeCloseTo(0, 3);
    expect(rows[1].tOffsetSec).toBeCloseTo(1.5, 3);
  });

  it("annotates re-reads of the same file_path across iterations", () => {
    const pipeline: JsonlLine[] = [
      pipelineFrame("pipeline-start", { timestamp: "2026-05-19T00:00:00.000Z", runId: "r1" }),
      pipelineFrame("node-start", {
        timestamp: "2026-05-19T00:00:01.000Z",
        nodeId: "implement", nodeReceiveId: "implement-1", nodeKind: "looping-agent",
      }),
    ];
    const rawAttempts = [
      {
        nodeReceiveId: "implement-1", iteration: 1,
        lines: [toolUseFrame("2026-05-19T00:00:02.000Z", "Read", { file_path: "plan.md" })],
      },
      {
        nodeReceiveId: "implement-1", iteration: 2,
        lines: [toolUseFrame("2026-05-19T00:00:03.000Z", "Read", { file_path: "plan.md" })],
      },
    ];
    const rows = buildTimeline(pipeline, rawAttempts);
    expect(rows[0].rereadOf).toBeUndefined();
    expect(rows[1].rereadOf).toBe(0);
  });

  it("opts.annotateRereads === false disables annotation", () => {
    const pipeline: JsonlLine[] = [
      pipelineFrame("pipeline-start", { timestamp: "2026-05-19T00:00:00.000Z", runId: "r1" }),
    ];
    const rawAttempts = [
      {
        nodeReceiveId: "n-1", iteration: 1,
        lines: [
          toolUseFrame("2026-05-19T00:00:01.000Z", "Read", { file_path: "x.md" }),
          toolUseFrame("2026-05-19T00:00:02.000Z", "Read", { file_path: "x.md" }),
        ],
      },
    ];
    const rows = buildTimeline(pipeline, rawAttempts, { annotateRereads: false });
    expect(rows.every(r => r.rereadOf === undefined)).toBe(true);
  });

  it("does not mutate inputs (pure)", () => {
    const pipeline: JsonlLine[] = [
      pipelineFrame("pipeline-start", { timestamp: "2026-05-19T00:00:00.000Z", runId: "r1" }),
    ];
    const rawAttempts = [
      {
        nodeReceiveId: "n-1", iteration: 1,
        lines: [toolUseFrame("2026-05-19T00:00:01.000Z", "Read", { file_path: "x.md" })],
      },
    ];
    const pipelineClone = JSON.parse(JSON.stringify(pipeline));
    const rawClone = JSON.parse(JSON.stringify(rawAttempts));
    buildTimeline(pipeline, rawAttempts);
    expect(pipeline).toEqual(pipelineClone);
    expect(rawAttempts).toEqual(rawClone);
  });

  it("returns empty when no frames", () => {
    expect(buildTimeline([], [])).toEqual([]);
  });

  it("seeds (interactive) synthetic row for chat-session node-start frames with no raw-attempt", () => {
    const pipeline: JsonlLine[] = [
      pipelineFrame("pipeline-start", { timestamp: "2026-05-19T00:00:00.000Z", runId: "r1" }),
      pipelineFrame("node-start", {
        timestamp: "2026-05-19T00:00:01.000Z",
        nodeId: "chat", nodeReceiveId: "chat-1", nodeKind: "chat-session",
      }),
    ];
    const rows = buildTimeline(pipeline, []);
    expect(rows).toHaveLength(1);
    expect(rows[0].toolName).toBe("(interactive)");
    expect(rows[0].nodeReceiveId).toBe("chat-1");
    expect(rows[0].tOffsetSec).toBe(0);
  });

  it("seeds (gate) synthetic row for gate / approval-gate node-start frames with no raw-attempt", () => {
    const pipeline: JsonlLine[] = [
      pipelineFrame("pipeline-start", { timestamp: "2026-05-19T00:00:00.000Z", runId: "r1" }),
      pipelineFrame("node-start", {
        timestamp: "2026-05-19T00:00:01.000Z",
        nodeId: "approval_gate", nodeReceiveId: "approval_gate-1", nodeKind: "approval-gate",
      }),
    ];
    const rows = buildTimeline(pipeline, []);
    expect(rows).toHaveLength(1);
    expect(rows[0].toolName).toBe("(gate)");
    expect(rows[0].nodeReceiveId).toBe("approval_gate-1");
  });

  it("renders bare nodeId (no [iter] suffix) for nodes with a single raw-attempt", () => {
    const pipeline: JsonlLine[] = [
      pipelineFrame("pipeline-start", { timestamp: "2026-05-19T00:00:00.000Z", runId: "r1" }),
      pipelineFrame("node-start", {
        timestamp: "2026-05-19T00:00:01.000Z",
        nodeId: "verifier", nodeReceiveId: "verifier-1", nodeKind: "looping-agent",
      }),
    ];
    const rawAttempts = [
      {
        nodeReceiveId: "verifier-1", iteration: 1,
        lines: [toolUseFrame("2026-05-19T00:00:02.000Z", "Read", { file_path: "x.md" })],
      },
    ];
    const rows = buildTimeline(pipeline, rawAttempts);
    // iteration is reported on the row, but the renderer (Chunk 3) is the place
    // that decides to append [N] only when nodeReceiveId has >1 iteration.
    // The helper merely surfaces a sentinel: iteration may be null on bare runs.
    expect(rows[0].iteration).toBe(null);
  });

  it("stable sort: equal timestamps preserve input order", () => {
    const pipeline: JsonlLine[] = [
      pipelineFrame("pipeline-start", { timestamp: "2026-05-19T00:00:00.000Z", runId: "r1" }),
      pipelineFrame("node-start", {
        timestamp: "2026-05-19T00:00:01.000Z",
        nodeId: "n", nodeReceiveId: "n-1", nodeKind: "looping-agent",
      }),
    ];
    const rawAttempts = [
      {
        nodeReceiveId: "n-1", iteration: 1,
        lines: [
          toolUseFrame("2026-05-19T00:00:02.000Z", "Read", { file_path: "first" }),
          toolUseFrame("2026-05-19T00:00:02.000Z", "Read", { file_path: "second" }),
        ],
      },
    ];
    const rows = buildTimeline(pipeline, rawAttempts);
    expect(rows.map(r => r.inputSummary)).toEqual(["first", "second"]);
  });
});
