import { describe, it, expect } from "vitest";
import {
  renderNodeReceive,
  inspectCommand,
  type NodeReceiveSnapshot,
  type RenderNodeReceiveOptions,
} from "../lib/node-receive-inspector.js";

const SNAP_EMPTY: NodeReceiveSnapshot = {
  nodeId: "start",
  nodeKind: "tool",
  timestamp: "2026-05-12T10:00:00.000Z",
  contextSnapshot: {},
};

const SNAP_MULTI: NodeReceiveSnapshot = {
  nodeId: "verifier",
  nodeKind: "agent",
  timestamp: "2026-05-12T10:05:00.000Z",
  contextSnapshot: { goal: "ship it", project: "." },
};

const LONG_VAL = "x".repeat(120); // > 80 chars → wraps unless full
const SNAP_LONG: NodeReceiveSnapshot = {
  nodeId: "explainer",
  nodeKind: "agent",
  timestamp: "2026-05-12T10:10:00.000Z",
  contextSnapshot: { note: LONG_VAL, short: "ok" },
};

describe("renderNodeReceive", () => {
  it("renders an empty snapshot with the first-node sentinel", () => {
    const out = renderNodeReceive(SNAP_EMPTY, { completedStages: [] });
    expect(out).toEqual([
      "",
      "node:     start",
      "kind:     tool",
      "received: 2026-05-12T10:00:00.000Z",
      "",
      "context snapshot (0 keys):",
      "  (empty — first node)",
      "",
      "completed stages: (none)",
    ]);
  });

  it("renders a multi-key snapshot with maxLen+2 padding and no wrap when values fit 80 chars", () => {
    const out = renderNodeReceive(SNAP_MULTI, { completedStages: ["start"] });
    // Keys: "goal" (4), "project" (7) → maxLen=7, padEnd(9).
    // "goal".padEnd(9)    = "goal" + 5 spaces.
    // "project".padEnd(9) = "project" + 2 spaces.
    expect(out).toEqual([
      "",
      "node:     verifier",
      "kind:     agent",
      "received: 2026-05-12T10:05:00.000Z",
      "",
      "context snapshot (2 keys):",
      "  goal     \"ship it\"",
      "  project  \".\"",
      "",
      "completed stages: start",
    ]);
  });

  it("wraps over-80-char values onto a second indented line when full is false", () => {
    const out = renderNodeReceive(SNAP_LONG, { full: false, completedStages: [] });
    // Keys: "note" (4), "short" (5) → maxLen=5, padEnd(7).
    // "note"  → wraps (val > 80 chars), prints `  note` then `    "<val>"` (no padding on wrap row).
    // "short" → padEnd(7) = "short" + 2 spaces → row `  short  "ok"`.
    expect(out).toEqual([
      "",
      "node:     explainer",
      "kind:     agent",
      "received: 2026-05-12T10:10:00.000Z",
      "",
      "context snapshot (2 keys):",
      "  note",
      `    "${LONG_VAL}"`,
      "  short  \"ok\"",
      "",
      "completed stages: (none)",
    ]);
  });

  it("renders the same over-80-char value as a single padded row when full is true", () => {
    const out = renderNodeReceive(SNAP_LONG, { full: true, completedStages: [] });
    // Same keys → maxLen=5, padEnd(7). With full=true the wrap path is suppressed
    // for the over-80 value, so both rows use the padded shape:
    //   "note".padEnd(7)  = "note" + 3 spaces.
    //   "short".padEnd(7) = "short" + 2 spaces.
    expect(out).toEqual([
      "",
      "node:     explainer",
      "kind:     agent",
      "received: 2026-05-12T10:10:00.000Z",
      "",
      "context snapshot (2 keys):",
      `  note   "${LONG_VAL}"`,
      "  short  \"ok\"",
      "",
      "completed stages: (none)",
    ]);
  });

  it("emits a prompt: line when promptPath is provided", () => {
    const out = renderNodeReceive(SNAP_EMPTY, {
      completedStages: [],
      promptPath: "/work/.apparat/runs/r1/start/prompt.md",
    });
    expect(out[4]).toBe("prompt:   /work/.apparat/runs/r1/start/prompt.md");
  });

  it("omits the prompt: line when promptPath is null", () => {
    const out = renderNodeReceive(SNAP_EMPTY, { completedStages: [], promptPath: null });
    expect(out.find(l => l.startsWith("prompt:"))).toBeUndefined();
  });

  it("renders the validation-attempts block when failures are present", () => {
    const out = renderNodeReceive(SNAP_MULTI, {
      completedStages: ["start"],
      validationFailures: [
        {
          attempt: 1,
          errors: [{ path: "ok", message: "Expected boolean" }],
          rawOutputPath: "/r/raw-1.txt",
        },
        {
          attempt: 2,
          errors: [
            { path: "ok", message: "Expected boolean" },
            { path: "score", message: "Required" },
          ],
          rawOutputPath: "/r/raw-2.txt",
        },
      ],
    });
    const idx = out.indexOf("validation attempts:");
    expect(idx).toBeGreaterThan(-1);
    expect(out.slice(idx, idx + 5)).toEqual([
      "validation attempts:",
      "  [1] ✗ failed — ok: Expected boolean",
      "      raw: /r/raw-1.txt",
      "  [2] ✗ failed — ok: Expected boolean, score: Required",
      "      raw: /r/raw-2.txt",
    ]);
  });

  it("renders completed-stages with dot separators when non-empty", () => {
    const out = renderNodeReceive(SNAP_EMPTY, { completedStages: ["a", "b", "c"] });
    expect(out[out.length - 1]).toBe("completed stages: a · b · c");
  });
});

describe("inspectCommand", () => {
  it("emits the bare recipe with no --full by default", () => {
    expect(inspectCommand("a1b2c3d4", "7f3e9c1a")).toBe(
      "apparat pipeline trace a1b2c3d4 --node-receive 7f3e9c1a"
    );
  });

  it("appends --full when { full: true }", () => {
    expect(inspectCommand("a1b2c3d4", "7f3e9c1a", { full: true })).toBe(
      "apparat pipeline trace a1b2c3d4 --node-receive 7f3e9c1a --full"
    );
  });

  it("omits --full when { full: false } (matches default)", () => {
    expect(inspectCommand("a1b2c3d4", "7f3e9c1a", { full: false })).toBe(
      "apparat pipeline trace a1b2c3d4 --node-receive 7f3e9c1a"
    );
  });
});
