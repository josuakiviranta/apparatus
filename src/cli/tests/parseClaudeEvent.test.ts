import { describe, it, expect } from "vitest";
import { parseClaudeEvent } from "../lib/parseClaudeEvent.js";
import type { StreamJsonEvent } from "../lib/stream-formatter.js";

describe("parseClaudeEvent", () => {
  it("maps assistant_delta to a text event with role 'claude'", () => {
    const ev: StreamJsonEvent = { type: "assistant_delta", textDelta: "hello" };
    expect(parseClaudeEvent(ev)).toEqual([
      { kind: "text", role: "claude", text: "hello" },
    ]);
  });

  it("maps tool_use to a tool_use event with a readable summary", () => {
    const ev: StreamJsonEvent = {
      type: "tool_use",
      toolCall: { id: "t1", name: "Write", input: { file_path: "/tmp/x.md" } },
    };
    const out = parseClaudeEvent(ev);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("tool_use");
    if (out[0].kind !== "tool_use") throw new Error();
    expect(out[0].name).toBe("Write");
    expect(out[0].summary.length).toBeGreaterThan(0);
  });

  it("maps system event with sessionId to a trace-path event", () => {
    const ev: StreamJsonEvent = { type: "system", sessionId: "sid-abc", raw: {} };
    expect(parseClaudeEvent(ev)).toEqual([
      { kind: "trace-path", sessionId: "sid-abc" },
    ]);
  });

  it("returns [] for system event with no sessionId", () => {
    const ev: StreamJsonEvent = { type: "system", raw: {} };
    expect(parseClaudeEvent(ev)).toEqual([]);
  });

  it("maps result event to a stats event with token counts", () => {
    const ev: StreamJsonEvent = {
      type: "result",
      stopReason: "end_turn",
      text: "",
      usage: { inputTokens: 10, outputTokens: 5 },
      raw: {},
    };
    expect(parseClaudeEvent(ev)).toEqual([
      { kind: "stats", tokensIn: 10, tokensOut: 5 },
    ]);
  });

  it("returns [] for tool_result (caller renders from tool_use only)", () => {
    const ev: StreamJsonEvent = {
      type: "tool_result",
      toolCallId: "t1",
      content: "ok",
      isError: false,
    };
    expect(parseClaudeEvent(ev)).toEqual([]);
  });

  it("returns [] for parse_error", () => {
    const ev: StreamJsonEvent = {
      type: "parse_error",
      rawLine: "{bad",
      error: "json",
    };
    expect(parseClaudeEvent(ev)).toEqual([]);
  });
});
