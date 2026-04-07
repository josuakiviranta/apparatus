import { describe, it, expect } from "vitest";
import { processLine, initialState, flushState, type FormatterState } from "../lib/stream-formatter";

const HEADER = "┌─ MAIN AGENT ──────────────────────────────────────────\n";

describe("processLine", () => {
  it("ignores system events", () => {
    const line = JSON.stringify({ type: "system", session_id: "abc" });
    const { output } = processLine(line, initialState());
    expect(output).toBe("");
  });

  it("ignores result events", () => {
    const line = JSON.stringify({ type: "result", result: "done" });
    const { output } = processLine(line, initialState());
    expect(output).toBe("");
  });

  it("ignores non-JSON lines", () => {
    const { output } = processLine("not json", initialState());
    expect(output).toBe("");
  });

  it("renders text content with header and token count", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "text", text: "Hello world" }],
        usage: { input_tokens: 1234, output_tokens: 10 },
      },
    });
    const { output } = processLine(line, initialState());
    expect(output).toBe(
      HEADER + "Hello world\n◈ ctx: 1,234 tokens\n"
    );
  });

  it("renders Read tool_use with file path", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "Read", id: "t1", input: { file_path: "/src/foo.ts" } }],
        usage: { input_tokens: 500, output_tokens: 5 },
      },
    });
    const { output } = processLine(line, initialState());
    expect(output).toContain("→ [read] /src/foo.ts");
    expect(output).toContain("◈ ctx: 500 tokens");
  });

  it("renders Write tool_use with file path", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "Write", id: "t1", input: { file_path: "/out.ts" } }],
        usage: { input_tokens: 100, output_tokens: 5 },
      },
    });
    const { output } = processLine(line, initialState());
    expect(output).toContain("→ [write] /out.ts");
  });

  it("renders Edit tool_use with file path", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "Edit", id: "t1", input: { file_path: "/edit.ts" } }],
        usage: { input_tokens: 100, output_tokens: 5 },
      },
    });
    const { output } = processLine(line, initialState());
    expect(output).toContain("→ [edit] /edit.ts");
  });

  it("renders Grep tool_use with pattern and path", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "Grep", id: "t1", input: { pattern: "foo", path: "src/" } }],
        usage: { input_tokens: 100, output_tokens: 5 },
      },
    });
    const { output } = processLine(line, initialState());
    expect(output).toContain("→ [grep] foo  src/");
  });

  it("renders Grep without path when path is absent", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "Grep", id: "t1", input: { pattern: "bar" } }],
        usage: { input_tokens: 100, output_tokens: 5 },
      },
    });
    const { output } = processLine(line, initialState());
    expect(output).toContain("→ [grep] bar");
    expect(output).not.toContain("undefined");
  });

  it("renders Glob tool_use with pattern", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "Glob", id: "t1", input: { pattern: "**/*.ts" } }],
        usage: { input_tokens: 100, output_tokens: 5 },
      },
    });
    const { output } = processLine(line, initialState());
    expect(output).toContain("→ [glob] **/*.ts");
  });

  it("renders Bash tool_use with command", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "Bash", id: "t1", input: { command: "npm test" } }],
        usage: { input_tokens: 100, output_tokens: 5 },
      },
    });
    const { output } = processLine(line, initialState());
    expect(output).toContain("→ [bash] npm test");
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
    const { output } = processLine(line, initialState());
    expect(output).toContain("→ [bash] " + "a".repeat(80) + "…");
  });

  it("renders unknown tool with generic label", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "TodoWrite", id: "t1", input: {} }],
        usage: { input_tokens: 100, output_tokens: 5 },
      },
    });
    const { output } = processLine(line, initialState());
    expect(output).toContain("→ [tool] TodoWrite");
  });

  it("renders Agent tool_use as SUBAGENT START and stores id, description, buffer in state", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "Agent", id: "agent-1", input: { description: "Explore auth" } }],
        usage: { input_tokens: 200, output_tokens: 5 },
      },
    });
    const { output, nextState } = processLine(line, initialState());
    expect(output).toContain("▶ SUBAGENT: Explore auth");
    expect(nextState.pendingSubagentIds.has("agent-1")).toBe(true);
    expect(nextState.subagentDescriptions.get("agent-1")).toBe("Explore auth");
    expect(nextState.subagentBuffers.has("agent-1")).toBe(true);
    expect(nextState.mainHeaderPrinted).toBe(true);
  });

  it("buffers subagent assistant event, no immediate output", () => {
    const state: FormatterState = {
      pendingSubagentIds: new Set(["agent-1"]),
      subagentBuffers: new Map([["agent-1", ""]]),
      subagentDescriptions: new Map([["agent-1", "Explore auth"]]),
      mainHeaderPrinted: true,
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
    const { output, nextState } = processLine(line, state);
    expect(output).toBe("");
    expect(nextState.subagentBuffers.get("agent-1")).toBe("  → [glob] **/*.ts\n");
  });

  it("flushes subagent buffer as labeled block on close", () => {
    const state: FormatterState = {
      pendingSubagentIds: new Set(["agent-1"]),
      subagentBuffers: new Map([["agent-1", "  → [glob] **/*.ts\n"]]),
      subagentDescriptions: new Map([["agent-1", "Explore auth"]]),
      mainHeaderPrinted: true,
      lastMainCtxTotal: 0,
    };
    const line = JSON.stringify({
      type: "user",
      message: {
        content: [{ type: "tool_result", tool_use_id: "agent-1", content: [] }],
      },
    });
    const { output, nextState } = processLine(line, state);
    expect(output).toContain("┌─ SUBAGENT: Explore auth");
    expect(output).toContain("  → [glob] **/*.ts");
    expect(output).toContain("◀ ──");
    expect(nextState.pendingSubagentIds.has("agent-1")).toBe(false);
    expect(nextState.mainHeaderPrinted).toBe(false);
  });

  it("ignores tool_result for non-subagent ids (user-wrapped)", () => {
    const state: FormatterState = {
      pendingSubagentIds: new Set(),
      subagentBuffers: new Map(),
      subagentDescriptions: new Map(),
      mainHeaderPrinted: false,
      lastMainCtxTotal: 0,
    };
    const line = JSON.stringify({
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: "some-other-id", content: "ok" }] },
    });
    const { output } = processLine(line, state);
    expect(output).toBe("");
  });

  it("does not repeat header on consecutive assistant events", () => {
    const state: FormatterState = {
      pendingSubagentIds: new Set(),
      subagentBuffers: new Map(),
      subagentDescriptions: new Map(),
      mainHeaderPrinted: true,
      lastMainCtxTotal: 0,
    };
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "Read", id: "t2", input: { file_path: "/b.ts" } }],
        usage: { input_tokens: 500, output_tokens: 5 },
      },
    });
    const { output } = processLine(line, state);
    expect(output).not.toContain(HEADER);
    expect(output).toContain("→ [read] /b.ts");
  });

  it("skips events with no substantive content", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "text", text: "   " }],
        usage: { input_tokens: 50, output_tokens: 1 },
      },
    });
    const { output } = processLine(line, initialState());
    expect(output).toBe("");
  });

  it("sums cache tokens into ctx total", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "text", text: "hi" }],
        usage: { input_tokens: 1000, cache_read_input_tokens: 90000, cache_creation_input_tokens: 5000 },
      },
    });
    const { output } = processLine(line, initialState());
    expect(output).toContain("◈ ctx: 96,000 tokens");
  });

  it("omits token line when usage is absent", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "hi" }] },
    });
    const { output } = processLine(line, initialState());
    expect(output).not.toContain("◈ ctx");
  });

  it("formats token count with thousands separator", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "text", text: "x" }],
        usage: { input_tokens: 1234567, output_tokens: 5 },
      },
    });
    const { output } = processLine(line, initialState());
    expect(output).toContain("◈ ctx: 1,234,567 tokens");
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
    // First call from initialState: 1000 > 0 → prints
    const { output: o1, nextState: s1 } = processLine(line, initialState());
    expect(o1).toContain("◈ ctx: 1,000 tokens");
    expect(s1.lastMainCtxTotal).toBe(1000);

    // Second call: 1000 is not > 1000 → suppressed
    const { output: o2 } = processLine(line, s1);
    expect(o2).not.toContain("◈ ctx");
  });

  it("suppresses ctx line when total has not grown", () => {
    const state: FormatterState = {
      pendingSubagentIds: new Set(),
      subagentBuffers: new Map(),
      subagentDescriptions: new Map(),
      mainHeaderPrinted: false,
      lastMainCtxTotal: 5000,
    };
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "text", text: "same size" }],
        usage: { input_tokens: 5000, output_tokens: 5 },
      },
    });
    const { output } = processLine(line, state);
    expect(output).not.toContain("◈ ctx");
  });

  it("never prints ctx line for subagent assistant events", () => {
    const state: FormatterState = {
      pendingSubagentIds: new Set(["agent-1"]),
      subagentBuffers: new Map([["agent-1", ""]]),
      subagentDescriptions: new Map([["agent-1", "Explore auth"]]),
      mainHeaderPrinted: true,
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
    const { output } = processLine(line, state);
    expect(output).toBe(""); // buffered, not printed — no ctx line emitted
  });

  // formatSubagentBlock tests (tested via processLine/flushState)
  it("formatSubagentBlock: normal description produces correct framing", () => {
    const state: FormatterState = {
      pendingSubagentIds: new Set(["a1"]),
      subagentBuffers: new Map([["a1", "  → [glob] **/*.ts\n"]]),
      subagentDescriptions: new Map([["a1", "Study specs"]]),
      mainHeaderPrinted: true,
      lastMainCtxTotal: 0,
    };
    const line = JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "a1", content: [] }] } });
    const { output } = processLine(line, state);
    expect(output).toContain("┌─ SUBAGENT: Study specs ");
    expect(output).toContain("◀ ──");
    expect(output).toContain("  → [glob] **/*.ts");
  });

  it("formatSubagentBlock: long description clamps dashes to zero", () => {
    const longDesc = "A".repeat(60); // label alone exceeds totalWidth=56
    const state: FormatterState = {
      pendingSubagentIds: new Set(["a1"]),
      subagentBuffers: new Map([["a1", ""]]),
      subagentDescriptions: new Map([["a1", longDesc]]),
      mainHeaderPrinted: true,
      lastMainCtxTotal: 0,
    };
    const line = JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "a1", content: [] }] } });
    const { output } = processLine(line, state);
    // Should not throw and should still contain the description
    expect(output).toContain(`┌─ SUBAGENT: ${longDesc}`);
  });
});

describe("flushState", () => {
  it("returns formatted block for each pending subagent", () => {
    const state: FormatterState = {
      pendingSubagentIds: new Set(["agent-1"]),
      subagentBuffers: new Map([["agent-1", "  → [glob] **/*.ts\n"]]),
      subagentDescriptions: new Map([["agent-1", "Explore auth"]]),
      mainHeaderPrinted: true,
      lastMainCtxTotal: 0,
    };
    const output = flushState(state);
    expect(output).toContain("┌─ SUBAGENT: Explore auth");
    expect(output).toContain("  → [glob] **/*.ts");
    expect(output).toContain("◀ ──");
  });

  it("returns empty string when no pending subagents", () => {
    expect(flushState(initialState())).toBe("");
  });
});
