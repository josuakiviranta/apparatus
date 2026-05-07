import { describe, it, expect } from "vitest";
import { classifyBlock } from "../lib/classify-stream.js";

describe("classifyBlock", () => {
  it("classifies text block", () => {
    const b = classifyBlock({ type: "text", text: "hello" });
    expect(b.kind).toBe("text");
    if (b.kind === "text") expect(b.text).toBe("hello");
  });

  it("text block with non-string text falls through to unknown", () => {
    const b = classifyBlock({ type: "text", text: 42 });
    expect(b.kind).toBe("unknown");
  });

  it("classifies tool_use block", () => {
    const b = classifyBlock({ type: "tool_use", id: "t1", name: "Read", input: { file_path: "/a" } });
    expect(b.kind).toBe("tool_use");
    if (b.kind === "tool_use") {
      expect(b.id).toBe("t1");
      expect(b.name).toBe("Read");
      expect(b.input).toEqual({ file_path: "/a" });
    }
  });

  it("tool_use coerces missing id and name to empty strings", () => {
    const b = classifyBlock({ type: "tool_use" });
    expect(b.kind).toBe("tool_use");
    if (b.kind === "tool_use") {
      expect(b.id).toBe("");
      expect(b.name).toBe("");
      expect(b.input).toBeUndefined();
    }
  });

  it("classifies tool_result block with explicit isError true", () => {
    const b = classifyBlock({ type: "tool_result", tool_use_id: "t1", content: "boom", is_error: true });
    expect(b.kind).toBe("tool_result");
    if (b.kind === "tool_result") {
      expect(b.toolUseId).toBe("t1");
      expect(b.content).toBe("boom");
      expect(b.isError).toBe(true);
    }
  });

  it("tool_result defaults isError to false when omitted", () => {
    const b = classifyBlock({ type: "tool_result", tool_use_id: "t1", content: "ok" });
    expect(b.kind).toBe("tool_result");
    if (b.kind === "tool_result") expect(b.isError).toBe(false);
  });

  it("tool_result preserves non-string content untouched", () => {
    const obj = { foo: 1, bar: [2, 3] };
    const b = classifyBlock({ type: "tool_result", tool_use_id: "t1", content: obj });
    expect(b.kind).toBe("tool_result");
    if (b.kind === "tool_result") {
      // consumer-side stringification stays in parseStreamJsonEvents
      expect(b.content).toBe(obj);
    }
  });

  it("returns kind 'unknown' for unrecognised block.type", () => {
    const b = classifyBlock({ type: "foo", payload: 1 });
    expect(b.kind).toBe("unknown");
    if (b.kind === "unknown") expect(b.raw.type).toBe("foo");
  });

  it("returns kind 'unknown' for non-object input", () => {
    const b = classifyBlock(null);
    expect(b.kind).toBe("unknown");
  });
});
