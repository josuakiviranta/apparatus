import { describe, it, expect } from "vitest";
import { classifyLine } from "../lib/classify-stream.js";

describe("classifyLine", () => {
  it("returns parse_error on malformed JSON", () => {
    const ev = classifyLine("not json");
    expect(ev.kind).toBe("parse_error");
    if (ev.kind === "parse_error") {
      expect(ev.rawLine).toBe("not json");
      expect(typeof ev.error).toBe("string");
      expect(ev.error.length).toBeGreaterThan(0);
    }
  });

  it("classifies system event with sessionId", () => {
    const line = JSON.stringify({ type: "system", session_id: "abc-123", subtype: "init" });
    const ev = classifyLine(line);
    expect(ev.kind).toBe("system");
    if (ev.kind === "system") {
      expect(ev.sessionId).toBe("abc-123");
      expect(ev.raw.subtype).toBe("init");
    }
  });

  it("classifies system event with missing session_id as undefined", () => {
    const ev = classifyLine(JSON.stringify({ type: "system" }));
    expect(ev.kind).toBe("system");
    if (ev.kind === "system") {
      expect(ev.sessionId).toBeUndefined();
    }
  });

  it("classifies assistant event with content array and messageId", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { id: "msg-1", content: [{ type: "text", text: "hi" }], usage: { input_tokens: 5 } },
    });
    const ev = classifyLine(line);
    expect(ev.kind).toBe("assistant");
    if (ev.kind === "assistant") {
      expect(ev.messageId).toBe("msg-1");
      expect(ev.content).toEqual([{ type: "text", text: "hi" }]);
      expect(ev.usage).toEqual({ input_tokens: 5 });
      expect(ev.parentToolUseId).toBeUndefined();
    }
  });

  it("round-trips parent_tool_use_id on assistant", () => {
    const line = JSON.stringify({
      type: "assistant",
      parent_tool_use_id: "tool_abc",
      message: { content: [] },
    });
    const ev = classifyLine(line);
    expect(ev.kind).toBe("assistant");
    if (ev.kind === "assistant") {
      expect(ev.parentToolUseId).toBe("tool_abc");
    }
  });

  it("classifies assistant with missing message as empty content", () => {
    const ev = classifyLine(JSON.stringify({ type: "assistant" }));
    expect(ev.kind).toBe("assistant");
    if (ev.kind === "assistant") {
      expect(ev.content).toEqual([]);
      expect(ev.messageId).toBeUndefined();
      expect(ev.usage).toBeUndefined();
    }
  });

  it("classifies user event with content array", () => {
    const line = JSON.stringify({
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] },
    });
    const ev = classifyLine(line);
    expect(ev.kind).toBe("user");
    if (ev.kind === "user") {
      expect(ev.content).toEqual([{ type: "tool_result", tool_use_id: "t1", content: "ok" }]);
    }
  });

  it("classifies user with missing message as empty content", () => {
    const ev = classifyLine(JSON.stringify({ type: "user" }));
    expect(ev.kind).toBe("user");
    if (ev.kind === "user") {
      expect(ev.content).toEqual([]);
    }
  });

  it("classifies result event with stopReason, text, usage, raw", () => {
    const line = JSON.stringify({
      type: "result",
      stop_reason: "end_turn",
      result: "done",
      usage: { input_tokens: 1, output_tokens: 2 },
    });
    const ev = classifyLine(line);
    expect(ev.kind).toBe("result");
    if (ev.kind === "result") {
      expect(ev.stopReason).toBe("end_turn");
      expect(ev.text).toBe("done");
      expect(ev.usage).toEqual({ input_tokens: 1, output_tokens: 2 });
      expect(ev.raw.type).toBe("result");
    }
  });

  it("defaults result.stopReason and text when missing", () => {
    const ev = classifyLine(JSON.stringify({ type: "result" }));
    expect(ev.kind).toBe("result");
    if (ev.kind === "result") {
      expect(ev.stopReason).toBe("");
      expect(ev.text).toBe("");
      expect(ev.usage).toEqual({});
    }
  });

  it("returns kind 'unknown' for unrecognised event.type", () => {
    const ev = classifyLine(JSON.stringify({ type: "foo", payload: 1 }));
    expect(ev.kind).toBe("unknown");
    if (ev.kind === "unknown") {
      expect(ev.raw.type).toBe("foo");
    }
  });
});
