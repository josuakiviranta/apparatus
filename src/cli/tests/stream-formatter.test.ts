import { describe, it, expect } from "vitest";
import { processLine, initialState, type FormatterState } from "../lib/stream-formatter";

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

  it("renders Agent tool_use as SUBAGENT START and stores the id in state", () => {
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
    expect(nextState.mainHeaderPrinted).toBe(true);
  });

  it("emits SUBAGENT DONE when tool_result matches pending id", () => {
    const state: FormatterState = { pendingSubagentIds: new Set(["agent-1"]), mainHeaderPrinted: true };
    const line = JSON.stringify({ type: "tool_result", tool_use_id: "agent-1", content: "done" });
    const { output, nextState } = processLine(line, state);
    expect(output).toBe("◀ SUBAGENT DONE\n");
    expect(nextState.pendingSubagentIds.has("agent-1")).toBe(false);
    expect(nextState.mainHeaderPrinted).toBe(false);
  });

  it("ignores tool_result for non-subagent ids", () => {
    const state: FormatterState = { pendingSubagentIds: new Set(), mainHeaderPrinted: false };
    const line = JSON.stringify({ type: "tool_result", tool_use_id: "some-other-id", content: "ok" });
    const { output } = processLine(line, state);
    expect(output).toBe("");
  });

  it("closes pending subagents on next assistant turn", () => {
    const state: FormatterState = { pendingSubagentIds: new Set(["agent-1"]), mainHeaderPrinted: true };
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "text", text: "continuing" }],
        usage: { input_tokens: 300, output_tokens: 5 },
      },
    });
    const { output, nextState } = processLine(line, state);
    expect(output).toContain("◀ SUBAGENT DONE");
    expect(nextState.pendingSubagentIds.size).toBe(0);
  });

  it("does not repeat header on consecutive assistant events", () => {
    const state: FormatterState = { pendingSubagentIds: new Set(), mainHeaderPrinted: true };
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
});
