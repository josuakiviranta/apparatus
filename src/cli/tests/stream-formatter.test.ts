import { describe, it, expect } from "vitest";
import { processLine, initialState, flushState, type FormatterState, type StreamEvent } from "../lib/stream-formatter";

/** Serialize StreamEvent[] back to the old string format for compact assertions. */
function eventsToText(events: StreamEvent[]): string {
  let out = "";
  for (const ev of events) {
    switch (ev.type) {
      case "main_agent_open":
        out += "\u25b6\u25b6\u25b6 MAIN AGENT\n";
        break;
      case "main_agent_close":
        out += "\u25c0\u25c0\u25c0 MAIN AGENT\n\n";
        break;
      case "subagent_open":
        out += `\u25b6 SUBAGENT: ${ev.description}\n`;
        break;
      case "subagent_close":
        out += "\u25c0 SUBAGENT\n";
        break;
      case "text":
        out += (ev.indented ? "  " : "") + ev.content + "\n";
        break;
      case "tool":
        out += (ev.indented ? "  " : "") + `\u2192 [${ev.name}] ${ev.label}\n`;
        break;
      case "ctx":
        out += `\u25c8 ctx: ${ev.tokens.toLocaleString("en-US")} tokens\n`;
        break;
    }
  }
  return out;
}

describe("processLine", () => {
  it("ignores system events", () => {
    const line = JSON.stringify({ type: "system", session_id: "abc" });
    const { events } = processLine(line, initialState());
    expect(events).toEqual([]);
  });

  it("ignores result events", () => {
    const line = JSON.stringify({ type: "result", result: "done" });
    const { events } = processLine(line, initialState());
    expect(events).toEqual([]);
  });

  it("ignores non-JSON lines", () => {
    const { events } = processLine("not json", initialState());
    expect(events).toEqual([]);
  });

  it("renders text content with header and token count", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "text", text: "Hello world" }],
        usage: { input_tokens: 1234, output_tokens: 10 },
      },
    });
    const { events } = processLine(line, initialState());
    expect(events).toEqual([
      { type: "main_agent_open" },
      { type: "text", content: "Hello world" },
      { type: "ctx", tokens: 1234 },
    ]);
    expect(eventsToText(events)).toBe("\u25b6\u25b6\u25b6 MAIN AGENT\nHello world\n\u25c8 ctx: 1,234 tokens\n");
  });

  it("renders Read tool_use with file path", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "Read", id: "t1", input: { file_path: "/src/foo.ts" } }],
        usage: { input_tokens: 500, output_tokens: 5 },
      },
    });
    const { events } = processLine(line, initialState());
    expect(events).toContainEqual({ type: "tool", name: "read", label: "/src/foo.ts" });
    expect(events).toContainEqual({ type: "ctx", tokens: 500 });
  });

  it("renders Write tool_use with file path", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "Write", id: "t1", input: { file_path: "/out.ts" } }],
        usage: { input_tokens: 100, output_tokens: 5 },
      },
    });
    const { events } = processLine(line, initialState());
    expect(events).toContainEqual({ type: "tool", name: "write", label: "/out.ts" });
  });

  it("renders Edit tool_use with file path", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "Edit", id: "t1", input: { file_path: "/edit.ts" } }],
        usage: { input_tokens: 100, output_tokens: 5 },
      },
    });
    const { events } = processLine(line, initialState());
    expect(events).toContainEqual({ type: "tool", name: "edit", label: "/edit.ts" });
  });

  it("renders Grep tool_use with pattern and path", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "Grep", id: "t1", input: { pattern: "foo", path: "src/" } }],
        usage: { input_tokens: 100, output_tokens: 5 },
      },
    });
    const { events } = processLine(line, initialState());
    expect(events).toContainEqual({ type: "tool", name: "grep", label: "foo  src/" });
  });

  it("renders Grep without path when path is absent", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "Grep", id: "t1", input: { pattern: "bar" } }],
        usage: { input_tokens: 100, output_tokens: 5 },
      },
    });
    const { events } = processLine(line, initialState());
    expect(events).toContainEqual({ type: "tool", name: "grep", label: "bar" });
    const text = eventsToText(events);
    expect(text).not.toContain("undefined");
  });

  it("renders Glob tool_use with pattern", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "Glob", id: "t1", input: { pattern: "**/*.ts" } }],
        usage: { input_tokens: 100, output_tokens: 5 },
      },
    });
    const { events } = processLine(line, initialState());
    expect(events).toContainEqual({ type: "tool", name: "glob", label: "**/*.ts" });
  });

  it("renders Bash tool_use with command", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "Bash", id: "t1", input: { command: "npm test" } }],
        usage: { input_tokens: 100, output_tokens: 5 },
      },
    });
    const { events } = processLine(line, initialState());
    expect(events).toContainEqual({ type: "tool", name: "bash", label: "npm test" });
  });

  it("truncates Bash command at 80 chars with ellipsis", () => {
    const longCmd = "a".repeat(100);
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "Bash", id: "t1", input: { command: longCmd } }],
        usage: { input_tokens: 100, output_tokens: 5 },
      },
    });
    const { events } = processLine(line, initialState());
    expect(events).toContainEqual({ type: "tool", name: "bash", label: "a".repeat(80) + "\u2026" });
  });

  it("renders unknown tool with generic label", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "TodoWrite", id: "t1", input: {} }],
        usage: { input_tokens: 100, output_tokens: 5 },
      },
    });
    const { events } = processLine(line, initialState());
    expect(events).toContainEqual({ type: "tool", name: "tool", label: "TodoWrite" });
  });

  it("renders Agent tool_use as SUBAGENT START and stores id, description, buffer in state", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "Agent", id: "agent-1", input: { description: "Explore auth" } }],
        usage: { input_tokens: 200, output_tokens: 5 },
      },
    });
    const { events, nextState } = processLine(line, initialState());
    // Subagent header is deferred to close time -- no events at dispatch
    expect(events).toEqual([]);
    expect(nextState.pendingSubagentIds.has("agent-1")).toBe(true);
    expect(nextState.subagentDescriptions.get("agent-1")).toBe("Explore auth");
    expect(nextState.subagentBuffers.has("agent-1")).toBe(true);
    expect(nextState.subagentBuffers.get("agent-1")).toEqual([]);
    expect(nextState.mainAgentOpen).toBe(false);
  });

  it("buffers subagent assistant event, no immediate output", () => {
    const state: FormatterState = {
      pendingSubagentIds: new Set(["agent-1"]),
      subagentBuffers: new Map([["agent-1", []]]),
      subagentDescriptions: new Map([["agent-1", "Explore auth"]]),
      mainAgentOpen: false,
      lastMainCtxTotal: 0,
    };
    const line = JSON.stringify({
      type: "assistant",
      parent_tool_use_id: "agent-1",
      message: {
        content: [{ type: "tool_use", name: "Glob", id: "t1", input: { pattern: "**/*.ts" } }],
        usage: { input_tokens: 500, output_tokens: 5 },
      },
    });
    const { events, nextState } = processLine(line, state);
    expect(events).toEqual([]);
    expect(nextState.subagentBuffers.get("agent-1")).toEqual([
      { type: "tool", name: "glob", label: "**/*.ts", indented: true },
    ]);
  });

  it("flushes subagent buffer with header at close, no anticipatory MAIN AGENT", () => {
    const state: FormatterState = {
      pendingSubagentIds: new Set(["agent-1"]),
      subagentBuffers: new Map([["agent-1", [
        { type: "tool", name: "glob", label: "**/*.ts", indented: true } as StreamEvent,
      ]]]),
      subagentDescriptions: new Map([["agent-1", "Explore auth"]]),
      mainAgentOpen: false,
      lastMainCtxTotal: 0,
    };
    const line = JSON.stringify({
      type: "user",
      message: {
        content: [{ type: "tool_result", tool_use_id: "agent-1", content: [] }],
      },
    });
    const { events, nextState } = processLine(line, state);
    // Header printed at close time; no anticipatory MAIN AGENT
    expect(events).toEqual([
      { type: "subagent_open", description: "Explore auth" },
      { type: "tool", name: "glob", label: "**/*.ts", indented: true },
      { type: "subagent_close" },
    ]);
    expect(eventsToText(events)).toBe("\u25b6 SUBAGENT: Explore auth\n  \u2192 [glob] **/*.ts\n\u25c0 SUBAGENT\n");
    expect(nextState.pendingSubagentIds.has("agent-1")).toBe(false);
    expect(nextState.mainAgentOpen).toBe(false);
  });

  it("ignores tool_result for non-subagent ids (user-wrapped)", () => {
    const state: FormatterState = {
      pendingSubagentIds: new Set(),
      subagentBuffers: new Map(),
      subagentDescriptions: new Map(),
      mainAgentOpen: false,
      lastMainCtxTotal: 0,
    };
    const line = JSON.stringify({
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: "some-other-id", content: "ok" }] },
    });
    const { events } = processLine(line, state);
    expect(events).toEqual([]);
  });

  it("does not repeat header on consecutive assistant events", () => {
    const state: FormatterState = {
      pendingSubagentIds: new Set(),
      subagentBuffers: new Map(),
      subagentDescriptions: new Map(),
      mainAgentOpen: true,
      lastMainCtxTotal: 0,
    };
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "Read", id: "t2", input: { file_path: "/b.ts" } }],
        usage: { input_tokens: 500, output_tokens: 5 },
      },
    });
    const { events } = processLine(line, state);
    const text = eventsToText(events);
    expect(text).not.toContain("MAIN AGENT");
    expect(events).toContainEqual({ type: "tool", name: "read", label: "/b.ts" });
  });

  it("skips events with no substantive content", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "text", text: "   " }],
        usage: { input_tokens: 50, output_tokens: 1 },
      },
    });
    const { events } = processLine(line, initialState());
    expect(events).toEqual([]);
  });

  it("sums cache tokens into ctx total", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "text", text: "hi" }],
        usage: { input_tokens: 1000, cache_read_input_tokens: 90000, cache_creation_input_tokens: 5000 },
      },
    });
    const { events } = processLine(line, initialState());
    expect(events).toContainEqual({ type: "ctx", tokens: 96000 });
  });

  it("omits token line when usage is absent", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "hi" }] },
    });
    const { events } = processLine(line, initialState());
    expect(events.some(e => e.type === "ctx")).toBe(false);
  });

  it("formats token count with thousands separator", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "text", text: "x" }],
        usage: { input_tokens: 1234567, output_tokens: 5 },
      },
    });
    const { events } = processLine(line, initialState());
    expect(events).toContainEqual({ type: "ctx", tokens: 1234567 });
    expect(eventsToText(events)).toContain("\u25c8 ctx: 1,234,567 tokens");
  });

  // ctx growth gating tests
  it("prints ctx line when total grows, suppresses when equal", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "text", text: "hi" }],
        usage: { input_tokens: 1000, output_tokens: 5 },
      },
    });
    // First call from initialState: 1000 > 0 -> prints
    const { events: e1, nextState: s1 } = processLine(line, initialState());
    expect(e1).toContainEqual({ type: "ctx", tokens: 1000 });
    expect(s1.lastMainCtxTotal).toBe(1000);

    // Second call: 1000 is not > 1000 -> suppressed
    const { events: e2 } = processLine(line, s1);
    expect(e2.some(e => e.type === "ctx")).toBe(false);
  });

  it("suppresses ctx line when total has not grown", () => {
    const state: FormatterState = {
      pendingSubagentIds: new Set(),
      subagentBuffers: new Map(),
      subagentDescriptions: new Map(),
      mainAgentOpen: false,
      lastMainCtxTotal: 5000,
    };
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "text", text: "same size" }],
        usage: { input_tokens: 5000, output_tokens: 5 },
      },
    });
    const { events } = processLine(line, state);
    expect(events.some(e => e.type === "ctx")).toBe(false);
  });

  it("never prints ctx line for subagent assistant events", () => {
    const state: FormatterState = {
      pendingSubagentIds: new Set(["agent-1"]),
      subagentBuffers: new Map([["agent-1", []]]),
      subagentDescriptions: new Map([["agent-1", "Explore auth"]]),
      mainAgentOpen: false,
      lastMainCtxTotal: 0,
    };
    const line = JSON.stringify({
      type: "assistant",
      parent_tool_use_id: "agent-1",
      message: {
        content: [{ type: "tool_use", name: "Glob", id: "t1", input: { pattern: "**/*.ts" } }],
        usage: { input_tokens: 9999, output_tokens: 5 },
      },
    });
    const { events } = processLine(line, state);
    expect(events).toEqual([]); // buffered, not emitted -- no ctx line
  });

  it("emits main_agent_open on first substantive main agent event", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "text", text: "Hello" }],
        usage: { input_tokens: 100, output_tokens: 5 },
      },
    });
    const { events, nextState } = processLine(line, initialState());
    expect(events[0]).toEqual({ type: "main_agent_open" });
    expect(nextState.mainAgentOpen).toBe(true);
  });

  it("does not emit main_agent_open again on second event when already open", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "text", text: "Second" }],
        usage: { input_tokens: 200, output_tokens: 5 },
      },
    });
    const stateWithOpen: FormatterState = {
      pendingSubagentIds: new Set(),
      subagentBuffers: new Map(),
      subagentDescriptions: new Map(),
      mainAgentOpen: true,
      lastMainCtxTotal: 0,
    };
    const { events } = processLine(line, stateWithOpen);
    expect(events.some(e => e.type === "main_agent_open")).toBe(false);
  });

  it("emits main_agent_close when main agent is open and Agent is dispatched", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "Agent", id: "a1", input: { description: "Do something" } }],
        usage: { input_tokens: 300, output_tokens: 5 },
      },
    });
    const stateWithOpen: FormatterState = {
      pendingSubagentIds: new Set(),
      subagentBuffers: new Map(),
      subagentDescriptions: new Map(),
      mainAgentOpen: true,
      lastMainCtxTotal: 0,
    };
    const { events, nextState } = processLine(line, stateWithOpen);
    // Only main_agent_close -- subagent header is deferred to close time
    expect(events).toEqual([{ type: "main_agent_close" }]);
    expect(nextState.mainAgentOpen).toBe(false);
  });

  it("produces no output when Agent is dispatched and main agent is not open", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "Agent", id: "a1", input: { description: "First thing" } }],
        usage: { input_tokens: 300, output_tokens: 5 },
      },
    });
    const { events, nextState } = processLine(line, initialState());
    expect(events).toEqual([]);
    expect(nextState.mainAgentOpen).toBe(false);
    expect(nextState.pendingSubagentIds.has("a1")).toBe(true);
  });

  // Parallel subagent scenario tests
  it("produces no output when multiple parallel Agent calls are dispatched", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", name: "Agent", id: "a1", input: { description: "Task 1" } },
          { type: "tool_use", name: "Agent", id: "a2", input: { description: "Task 2" } },
        ],
        usage: { input_tokens: 400, output_tokens: 5 },
      },
    });
    const { events, nextState } = processLine(line, initialState());
    expect(events).toEqual([]);
    expect(nextState.pendingSubagentIds.has("a1")).toBe(true);
    expect(nextState.pendingSubagentIds.has("a2")).toBe(true);
  });

  it("does not open MAIN AGENT when first of two parallel subagents closes", () => {
    const state: FormatterState = {
      pendingSubagentIds: new Set(["a1", "a2"]),
      subagentBuffers: new Map([
        ["a1", [{ type: "tool", name: "read", label: "/foo.ts", indented: true } as StreamEvent]],
        ["a2", []],
      ]),
      subagentDescriptions: new Map([["a1", "Task 1"], ["a2", "Task 2"]]),
      mainAgentOpen: false,
      lastMainCtxTotal: 0,
    };
    const line = JSON.stringify({
      type: "user",
      message: {
        content: [{ type: "tool_result", tool_use_id: "a1", content: [] }],
      },
    });
    const { events, nextState } = processLine(line, state);
    expect(events).toEqual([
      { type: "subagent_open", description: "Task 1" },
      { type: "tool", name: "read", label: "/foo.ts", indented: true },
      { type: "subagent_close" },
    ]);
    expect(eventsToText(events)).toBe("\u25b6 SUBAGENT: Task 1\n  \u2192 [read] /foo.ts\n\u25c0 SUBAGENT\n");
    expect(nextState.pendingSubagentIds.has("a1")).toBe(false);
    expect(nextState.pendingSubagentIds.has("a2")).toBe(true);
    expect(nextState.mainAgentOpen).toBe(false);
  });

  it("MAIN AGENT opens lazily when main agent produces content after all subagents closed", () => {
    // State after both subagents have closed
    const state: FormatterState = {
      pendingSubagentIds: new Set(),
      subagentBuffers: new Map(),
      subagentDescriptions: new Map(),
      mainAgentOpen: false,
      lastMainCtxTotal: 0,
    };
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "text", text: "Done with subagents" }],
        usage: { input_tokens: 500, output_tokens: 5 },
      },
    });
    const { events, nextState } = processLine(line, state);
    expect(events[0]).toEqual({ type: "main_agent_open" });
    expect(events).toContainEqual({ type: "text", content: "Done with subagents" });
    expect(nextState.mainAgentOpen).toBe(true);
  });

  it("full round-trip: dispatch 2 parallel agents, both close, main agent continues", () => {
    let state = initialState();

    // Main agent text + dispatch two subagents
    const dispatchLine = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "Running two tasks in parallel." },
          { type: "tool_use", name: "Agent", id: "a1", input: { description: "Task Alpha" } },
          { type: "tool_use", name: "Agent", id: "a2", input: { description: "Task Beta" } },
        ],
        usage: { input_tokens: 300, output_tokens: 5 },
      },
    });
    const { events: e1, nextState: s1 } = processLine(dispatchLine, state);
    state = s1;
    // Main agent text shown, then closed; ctx suppressed (main agent closed before ctx gate)
    expect(eventsToText(e1)).toBe("\u25b6\u25b6\u25b6 MAIN AGENT\nRunning two tasks in parallel.\n\u25c0\u25c0\u25c0 MAIN AGENT\n\n");

    // Subagent a1 tool call arrives
    const subA1Line = JSON.stringify({
      type: "assistant",
      parent_tool_use_id: "a1",
      message: {
        content: [{ type: "tool_use", name: "Read", id: "t1", input: { file_path: "/alpha.ts" } }],
        usage: { input_tokens: 100, output_tokens: 2 },
      },
    });
    const { events: e2, nextState: s2 } = processLine(subA1Line, state);
    state = s2;
    expect(e2).toEqual([]); // buffered

    // Subagent a2 tool call arrives
    const subA2Line = JSON.stringify({
      type: "assistant",
      parent_tool_use_id: "a2",
      message: {
        content: [{ type: "tool_use", name: "Read", id: "t2", input: { file_path: "/beta.ts" } }],
        usage: { input_tokens: 100, output_tokens: 2 },
      },
    });
    const { events: e3, nextState: s3 } = processLine(subA2Line, state);
    state = s3;
    expect(e3).toEqual([]); // buffered

    // a1 closes
    const closeA1 = JSON.stringify({
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: "a1", content: [] }] },
    });
    const { events: e4, nextState: s4 } = processLine(closeA1, state);
    state = s4;
    expect(eventsToText(e4)).toBe("\u25b6 SUBAGENT: Task Alpha\n  \u2192 [read] /alpha.ts\n\u25c0 SUBAGENT\n");
    expect(state.mainAgentOpen).toBe(false);

    // a2 closes
    const closeA2 = JSON.stringify({
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: "a2", content: [] }] },
    });
    const { events: e5, nextState: s5 } = processLine(closeA2, state);
    state = s5;
    expect(eventsToText(e5)).toBe("\u25b6 SUBAGENT: Task Beta\n  \u2192 [read] /beta.ts\n\u25c0 SUBAGENT\n");
    expect(state.mainAgentOpen).toBe(false);
    expect(state.pendingSubagentIds.size).toBe(0);

    // Main agent resumes
    const resumeLine = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "text", text: "All done." }],
        usage: { input_tokens: 600, output_tokens: 5 },
      },
    });
    const { events: e6 } = processLine(resumeLine, state);
    expect(e6[0]).toEqual({ type: "main_agent_open" });
    expect(e6).toContainEqual({ type: "text", content: "All done." });
  });
});

describe("flushState", () => {
  it("returns header + buffered content + close marker for each pending subagent", () => {
    const state: FormatterState = {
      pendingSubagentIds: new Set(["agent-1"]),
      subagentBuffers: new Map([["agent-1", [
        { type: "tool", name: "glob", label: "**/*.ts", indented: true } as StreamEvent,
      ]]]),
      subagentDescriptions: new Map([["agent-1", "Explore auth"]]),
      mainAgentOpen: false,
      lastMainCtxTotal: 0,
    };
    const events = flushState(state);
    expect(events).toEqual([
      { type: "subagent_open", description: "Explore auth" },
      { type: "tool", name: "glob", label: "**/*.ts", indented: true },
      { type: "subagent_close" },
    ]);
    expect(eventsToText(events)).toBe("\u25b6 SUBAGENT: Explore auth\n  \u2192 [glob] **/*.ts\n\u25c0 SUBAGENT\n");
  });

  it("closes main agent block if open", () => {
    const state: FormatterState = {
      pendingSubagentIds: new Set(),
      subagentBuffers: new Map(),
      subagentDescriptions: new Map(),
      mainAgentOpen: true,
      lastMainCtxTotal: 0,
    };
    const events = flushState(state);
    expect(events).toEqual([{ type: "main_agent_close" }]);
  });

  it("returns empty array when nothing is open", () => {
    expect(flushState(initialState())).toEqual([]);
  });
});
