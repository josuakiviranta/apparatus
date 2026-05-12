import { describe, it, expect, vi } from "vitest";
import { pipelineReducer } from "../lib/pipelineReducer.js";
import { initialPipelineState, type PipelineState } from "../lib/pipelineEvents.js";
import type { ChildHandle } from "../lib/agent.js";

describe("pipelineReducer — basic lifecycle", () => {
  it("start creates a live block and leaves frozen empty", () => {
    const s = pipelineReducer(initialPipelineState, {
      kind: "start",
      nodeId: "chat",
      label: "interactive agent",
      blockKind: "interactive-agent",
    });
    expect(s.frozen).toEqual([]);
    expect(s.live).not.toBeNull();
    expect(s.live!.nodeId).toBe("chat");
    expect(s.live!.body).toEqual([]);
    expect(s.live!.stats).toEqual({ turns: 0, tokensIn: 0, tokensOut: 0 });
  });

  it("text event appends to live.body", () => {
    let s: PipelineState = pipelineReducer(initialPipelineState, {
      kind: "start", nodeId: "x", label: "agent", blockKind: "agent",
    });
    s = pipelineReducer(s, { kind: "text", role: "claude", text: "hello" });
    s = pipelineReducer(s, { kind: "text", role: "claude", text: " world" });
    expect(s.live!.body).toEqual([
      { kind: "text", role: "claude", text: "hello" },
      { kind: "text", role: "claude", text: " world" },
    ]);
  });

  it("end freezes live and clears it", () => {
    let s: PipelineState = pipelineReducer(initialPipelineState, {
      kind: "start", nodeId: "x", label: "agent", blockKind: "agent",
    });
    s = pipelineReducer(s, { kind: "text", role: "claude", text: "hi" });
    s = pipelineReducer(s, {
      kind: "end",
      outcome: { status: "success" },
      stats: { turns: 1, tokensIn: 10, tokensOut: 5, durationMs: 200 },
    });
    expect(s.live).toBeNull();
    expect(s.frozen).toHaveLength(1);
    expect(s.frozen[0].nodeId).toBe("x");
    expect(s.frozen[0].outcome.status).toBe("success");
    expect(s.frozen[0].stats).toEqual({ turns: 1, tokensIn: 10, tokensOut: 5, durationMs: 200 });
  });
});

describe("pipelineReducer — invariants (regression guards)", () => {
  it("frozen blocks survive subsequent live updates and state changes", () => {
    let s = pipelineReducer(initialPipelineState, {
      kind: "start", nodeId: "chat", label: "interactive agent", blockKind: "interactive-agent",
    });
    s = pipelineReducer(s, { kind: "trace-path", sessionId: "sid-a" });
    s = pipelineReducer(s, { kind: "text", role: "you", text: "hello" });
    s = pipelineReducer(s, { kind: "text", role: "claude", text: "hi there" });
    s = pipelineReducer(s, {
      kind: "end",
      outcome: { status: "success" },
      stats: { turns: 1, tokensIn: 10, tokensOut: 5, durationMs: 1200 },
    });

    // second node starts
    s = pipelineReducer(s, {
      kind: "start", nodeId: "summarize", label: "agent", blockKind: "agent",
    });
    s = pipelineReducer(s, { kind: "text", role: "claude", text: "here is a summary" });

    expect(s.frozen).toHaveLength(1);
    expect(s.frozen[0].nodeId).toBe("chat");
    expect(s.frozen[0].tracePath).toContain("sid-a.jsonl");
    expect(s.frozen[0].body).toEqual([
      { kind: "text", role: "you", text: "hello" },
      { kind: "text", role: "claude", text: "hi there" },
    ]);
    expect(s.live?.nodeId).toBe("summarize");
    expect(s.live?.body).toHaveLength(1);
  });

  it("frozen array is a new reference on end (not mutated in place)", () => {
    let s = pipelineReducer(initialPipelineState, {
      kind: "start", nodeId: "a", label: "agent", blockKind: "agent",
    });
    const frozenBefore = s.frozen;
    s = pipelineReducer(s, {
      kind: "end",
      outcome: { status: "success" },
      stats: { turns: 1, tokensIn: 0, tokensOut: 0, durationMs: 10 },
    });
    expect(s.frozen).not.toBe(frozenBefore);
    expect(frozenBefore).toEqual([]);
  });

  it("end with omitted stats backfills from live.stats + elapsed time", () => {
    const before = Date.now();
    let s = pipelineReducer(initialPipelineState, {
      kind: "start", nodeId: "x", label: "agent", blockKind: "agent",
    });
    s = pipelineReducer(s, { kind: "end", outcome: { status: "abort", reason: "user-interrupt" } });
    expect(s.frozen[0].stats.turns).toBe(0);
    expect(s.frozen[0].stats.tokensIn).toBe(0);
    expect(s.frozen[0].stats.tokensOut).toBe(0);
    expect(s.frozen[0].stats.durationMs).toBeGreaterThanOrEqual(0);
    expect(s.frozen[0].stats.durationMs).toBeLessThan(Date.now() - before + 50);
  });

  it("driver-event/agent.ready stores agent state without invoking callbacks", async () => {
    const { __agentStatesForTest } = await import("../lib/interactions/drivers/agent.js");
    __agentStatesForTest.clear();
    const fakeChild = { kill: () => Promise.resolve() } as unknown as ChildHandle;
    const onDone = () => { throw new Error("reducer must not call onDone"); };
    let s = pipelineReducer(initialPipelineState, {
      kind: "start", nodeId: "chat", label: "agent", blockKind: "interactive-agent",
    });
    s = pipelineReducer(s, {
      kind: "driver-event",
      payload: {
        driver: "interactive-agent",
        kind: "agent.ready",
        child: fakeChild,
        onDone,
      },
    });
    expect(s.live).not.toBeNull();
    const entry = __agentStatesForTest.get(s.live!.id);
    expect(entry?.child).toBe(fakeChild);
    expect(entry?.onDone).toBe(onDone);
    __agentStatesForTest.clear();
  });

  it("end runs the driver's onFreeze hook and carries onDone onto the frozen block", async () => {
    const { __agentStatesForTest } = await import("../lib/interactions/drivers/agent.js");
    __agentStatesForTest.clear();
    const fakeChild = { kill: () => Promise.resolve() } as unknown as ChildHandle;
    const onDone = () => { throw new Error("reducer must not call onDone at end time"); };
    let s = pipelineReducer(initialPipelineState, {
      kind: "start", nodeId: "chat", label: "agent", blockKind: "interactive-agent",
    });
    s = pipelineReducer(s, {
      kind: "driver-event",
      payload: { driver: "interactive-agent", kind: "agent.ready", child: fakeChild, onDone },
    });
    expect(() => {
      s = pipelineReducer(s, {
        kind: "end",
        outcome: { status: "success" },
        stats: { turns: 1, tokensIn: 0, tokensOut: 0, durationMs: 1 },
      });
    }).not.toThrow();
    expect(s.live).toBeNull();
    expect(s.frozen).toHaveLength(1);
    expect(s.frozen[0].onDone).toBe(onDone);
    __agentStatesForTest.clear();
  });

  it("events targeting live when live is null are no-ops (all four mutators)", () => {
    const s1 = pipelineReducer(initialPipelineState, { kind: "text", role: "claude", text: "x" });
    const s2 = pipelineReducer(initialPipelineState, { kind: "tool_use", name: "Write", summary: "x" });
    const s3 = pipelineReducer(initialPipelineState, { kind: "end", outcome: { status: "fail" } });
    const s4 = pipelineReducer(initialPipelineState, { kind: "trace-path", sessionId: "x" });
    const s5 = pipelineReducer(initialPipelineState, {
      kind: "driver-event",
      payload: {
        driver: "interactive-agent",
        kind: "agent.ready",
        child: {} as ChildHandle,
        onDone: () => {},
      },
    });
    expect(s1).toEqual(initialPipelineState);
    expect(s2).toEqual(initialPipelineState);
    expect(s3).toEqual(initialPipelineState);
    expect(s4).toEqual(initialPipelineState);
    expect(s5).toEqual(initialPipelineState);
  });

  it("abort end with omitted stats preserves token counts and sets status=abort", () => {
    let s = pipelineReducer(initialPipelineState, {
      kind: "start", nodeId: "x", label: "agent", blockKind: "agent",
    });
    s = {
      ...s,
      live: s.live && {
        ...s.live,
        stats: { turns: 3, tokensIn: 120, tokensOut: 48 },
      },
    };
    s = pipelineReducer(s, {
      kind: "end",
      outcome: { status: "abort", reason: "user-interrupt" },
    });
    expect(s.frozen).toHaveLength(1);
    expect(s.frozen[0].outcome).toEqual({ status: "abort", reason: "user-interrupt" });
    expect(s.frozen[0].stats.turns).toBe(3);
    expect(s.frozen[0].stats.tokensIn).toBe(120);
    expect(s.frozen[0].stats.tokensOut).toBe(48);
    expect(s.frozen[0].stats.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("two sequential nodes produce two frozen blocks with live=null between them", () => {
    let s = pipelineReducer(initialPipelineState, {
      kind: "start", nodeId: "a", label: "agent", blockKind: "agent",
    });
    s = pipelineReducer(s, {
      kind: "end", outcome: { status: "success" },
      stats: { turns: 1, tokensIn: 0, tokensOut: 0, durationMs: 10 },
    });
    expect(s.live).toBeNull();
    expect(s.frozen).toHaveLength(1);
    s = pipelineReducer(s, {
      kind: "start", nodeId: "b", label: "agent", blockKind: "agent",
    });
    expect(s.frozen).toHaveLength(1);
    expect(s.live?.nodeId).toBe("b");
    s = pipelineReducer(s, {
      kind: "end", outcome: { status: "success" },
      stats: { turns: 1, tokensIn: 0, tokensOut: 0, durationMs: 10 },
    });
    expect(s.frozen).toHaveLength(2);
    expect(s.frozen.map(b => b.nodeId)).toEqual(["a", "b"]);
  });

  it("frozen[0] is not mutated when the second node appends body lines", () => {
    let s = pipelineReducer(initialPipelineState, {
      kind: "start", nodeId: "a", label: "agent", blockKind: "agent",
    });
    s = pipelineReducer(s, { kind: "text", role: "claude", text: "first" });
    s = pipelineReducer(s, {
      kind: "end", outcome: { status: "success" },
      stats: { turns: 1, tokensIn: 0, tokensOut: 0, durationMs: 10 },
    });
    const firstFrozenRef = s.frozen[0];
    const firstBodyRef = s.frozen[0].body;

    s = pipelineReducer(s, {
      kind: "start", nodeId: "b", label: "agent", blockKind: "agent",
    });
    s = pipelineReducer(s, { kind: "text", role: "claude", text: "second" });

    expect(s.frozen[0]).toBe(firstFrozenRef);
    expect(s.frozen[0].body).toBe(firstBodyRef);
    expect(s.frozen[0].body).toEqual([{ kind: "text", role: "claude", text: "first" }]);
  });
});

describe("pipelineReducer — trace-path derivation", () => {
  it("sets live.tracePath to the claudeTracePath of the sessionId", () => {
    let s = pipelineReducer(initialPipelineState, {
      kind: "start", nodeId: "chat", label: "agent", blockKind: "interactive-agent",
    });
    s = pipelineReducer(s, { kind: "trace-path", sessionId: "abc" });
    expect(s.live?.tracePath).toMatch(/\.claude\/projects\/.*\/abc\.jsonl$/);
  });

  it("is idempotent (second trace-path emit replaces first)", () => {
    let s = pipelineReducer(initialPipelineState, {
      kind: "start", nodeId: "chat", label: "agent", blockKind: "interactive-agent",
    });
    s = pipelineReducer(s, { kind: "trace-path", sessionId: "first" });
    s = pipelineReducer(s, { kind: "trace-path", sessionId: "second" });
    expect(s.live?.tracePath).toMatch(/second\.jsonl$/);
  });

  it("is a no-op when live is null (trace-path before start)", () => {
    const s = pipelineReducer(initialPipelineState, { kind: "trace-path", sessionId: "x" });
    expect(s).toEqual(initialPipelineState);
  });
});

describe("pipelineReducer — stream-line", () => {
  it("stream-line event is a no-op (does not mutate state)", () => {
    let s: PipelineState = pipelineReducer(initialPipelineState, {
      kind: "start", nodeId: "run", label: "agent", blockKind: "agent",
    });
    const before = s;
    s = pipelineReducer(s, { kind: "stream-line", event: { type: "main_agent_open" } });
    expect(s).toBe(before); // same reference — no mutation
  });
});

describe("pipelineReducer — gate driver-event", () => {
  it("delegates to gateDriver.reduce which stores options + onChoose in the gate state map", async () => {
    const { __gateStatesForTest } = await import("../lib/interactions/drivers/gate.js");
    __gateStatesForTest.clear();
    let s = pipelineReducer(initialPipelineState, {
      kind: "start", nodeId: "g", label: "Gate?", blockKind: "wait-human",
    });
    const onChoose = vi.fn();
    s = pipelineReducer(s, {
      kind: "driver-event",
      payload: { driver: "wait-human", kind: "gate.ready", options: ["Yes", "No"], onChoose },
    });
    const entry = __gateStatesForTest.get(s.live!.id);
    expect(entry?.options).toEqual(["Yes", "No"]);
    expect(entry?.onChoose).toBe(onChoose);
    __gateStatesForTest.clear();
  });

  it("is a no-op when live is null", () => {
    const onChoose = vi.fn();
    const s = pipelineReducer(initialPipelineState, {
      kind: "driver-event",
      payload: { driver: "wait-human", kind: "gate.ready", options: ["Yes"], onChoose },
    });
    expect(s).toEqual(initialPipelineState);
  });

  it("does not call onChoose (reducer never invokes callbacks)", async () => {
    const { __gateStatesForTest } = await import("../lib/interactions/drivers/gate.js");
    __gateStatesForTest.clear();
    let s = pipelineReducer(initialPipelineState, {
      kind: "start", nodeId: "g", label: "Gate?", blockKind: "wait-human",
    });
    const onChoose = vi.fn();
    s = pipelineReducer(s, {
      kind: "driver-event",
      payload: { driver: "wait-human", kind: "gate.ready", options: ["Yes"], onChoose },
    });
    expect(onChoose).not.toHaveBeenCalled();
    __gateStatesForTest.clear();
  });

  it("driver-event does not affect frozen array", async () => {
    const { __gateStatesForTest } = await import("../lib/interactions/drivers/gate.js");
    __gateStatesForTest.clear();
    let s = pipelineReducer(initialPipelineState, {
      kind: "start", nodeId: "g", label: "Gate?", blockKind: "wait-human",
    });
    s = pipelineReducer(s, {
      kind: "driver-event",
      payload: { driver: "wait-human", kind: "gate.ready", options: ["Yes"], onChoose: vi.fn() },
    });
    expect(s.frozen).toHaveLength(0);
    __gateStatesForTest.clear();
  });
});
