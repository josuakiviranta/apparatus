import { describe, it, expect } from "vitest";
import { Readable } from "stream";
import { parseStreamJsonEvents, type StreamJsonEvent } from "../lib/stream-formatter.js";

function readableFrom(lines: string[]): Readable {
  return Readable.from(lines.map((l) => l + "\n"));
}

async function collect(iter: AsyncIterable<StreamJsonEvent>): Promise<StreamJsonEvent[]> {
  const out: StreamJsonEvent[] = [];
  for await (const ev of iter) out.push(ev);
  return out;
}

describe("parseStreamJsonEvents", () => {
  it("yields system event with session id", async () => {
    const r = readableFrom([
      JSON.stringify({ type: "system", subtype: "init", session_id: "abc" }),
    ]);
    const events = await collect(parseStreamJsonEvents(r));
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("system");
    if (events[0].type === "system") {
      expect(events[0].sessionId).toBe("abc");
    }
  });

  it("yields assistant_delta for each text block in an assistant message", async () => {
    const r = readableFrom([
      JSON.stringify({
        type: "assistant",
        message: {
          id: "msg1",
          content: [
            { type: "text", text: "Hello " },
            { type: "text", text: "world" },
          ],
        },
      }),
    ]);
    const events = await collect(parseStreamJsonEvents(r));
    const deltas = events.filter((e) => e.type === "assistant_delta");
    expect(deltas).toHaveLength(2);
    if (deltas[0].type === "assistant_delta") expect(deltas[0].textDelta).toBe("Hello ");
    if (deltas[1].type === "assistant_delta") expect(deltas[1].textDelta).toBe("world");
  });

  it("yields tool_use for tool_use blocks in assistant messages", async () => {
    const r = readableFrom([
      JSON.stringify({
        type: "assistant",
        message: {
          id: "msg1",
          content: [
            { type: "tool_use", id: "tu1", name: "Read", input: { file_path: "/x" } },
          ],
        },
      }),
    ]);
    const events = await collect(parseStreamJsonEvents(r));
    const tuses = events.filter((e) => e.type === "tool_use");
    expect(tuses).toHaveLength(1);
    if (tuses[0].type === "tool_use") {
      expect(tuses[0].toolCall.name).toBe("Read");
      expect(tuses[0].toolCall.id).toBe("tu1");
    }
  });

  it("yields a result event with stopReason, usage, and final text", async () => {
    const r = readableFrom([
      JSON.stringify({
        type: "result",
        subtype: "success",
        result: "final answer",
        stop_reason: "end_turn",
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_read_input_tokens: 20,
        },
      }),
    ]);
    const events = await collect(parseStreamJsonEvents(r));
    const result = events.find((e) => e.type === "result");
    expect(result).toBeDefined();
    if (result && result.type === "result") {
      expect(result.stopReason).toBe("end_turn");
      expect(result.text).toBe("final answer");
      expect(result.usage.inputTokens).toBe(100);
      expect(result.usage.outputTokens).toBe(50);
      expect(result.usage.cacheReadTokens).toBe(20);
    }
  });

  it("maps turn_limit stop_reason verbatim", async () => {
    const r = readableFrom([
      JSON.stringify({
        type: "result",
        stop_reason: "turn_limit",
        result: "",
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    ]);
    const events = await collect(parseStreamJsonEvents(r));
    const result = events.find((e) => e.type === "result");
    if (result && result.type === "result") {
      expect(result.stopReason).toBe("turn_limit");
    }
  });

  it("yields parse_error for malformed lines without crashing the iterator", async () => {
    const r = readableFrom([
      "not json at all",
      JSON.stringify({ type: "system", subtype: "init", session_id: "x" }),
    ]);
    const events = await collect(parseStreamJsonEvents(r));
    const errors = events.filter((e) => e.type === "parse_error");
    expect(errors).toHaveLength(1);
    if (errors[0].type === "parse_error") {
      expect(errors[0].rawLine).toBe("not json at all");
    }
    // Iteration continues after the bad line
    expect(events.some((e) => e.type === "system")).toBe(true);
  });

  it("yields tool_result events from user-role messages (tool output)", async () => {
    const r = readableFrom([
      JSON.stringify({
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "tu1",
              content: "file contents here",
              is_error: false,
            },
          ],
        },
      }),
    ]);
    const events = await collect(parseStreamJsonEvents(r));
    const trs = events.filter((e) => e.type === "tool_result");
    expect(trs).toHaveLength(1);
    if (trs[0].type === "tool_result") {
      expect(trs[0].toolCallId).toBe("tu1");
      expect(trs[0].content).toBe("file contents here");
      expect(trs[0].isError).toBe(false);
    }
  });

  it("ignores empty lines", async () => {
    const r = readableFrom([
      "",
      JSON.stringify({ type: "system", subtype: "init", session_id: "x" }),
      "",
    ]);
    const events = await collect(parseStreamJsonEvents(r));
    expect(events.filter((e) => e.type !== "system")).toHaveLength(0);
  });
});
