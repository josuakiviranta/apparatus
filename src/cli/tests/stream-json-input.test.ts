import { describe, it, expect } from "vitest";
import { formatUserTurn } from "../lib/stream-json-input.js";

describe("formatUserTurn", () => {
  it("produces a single NDJSON line ending with \\n", () => {
    const out = formatUserTurn("hello");
    expect(out.endsWith("\n")).toBe(true);
    expect(out.split("\n").filter(Boolean)).toHaveLength(1);
  });

  it("produces valid JSON with the expected stream-json user-turn shape", () => {
    const out = formatUserTurn("hello");
    const parsed = JSON.parse(out);
    expect(parsed).toEqual({
      type: "user",
      message: {
        role: "user",
        content: [{ type: "text", text: "hello" }],
      },
    });
  });

  it("preserves unicode text", () => {
    const out = formatUserTurn("héllo 🌟 世界");
    const parsed = JSON.parse(out);
    expect(parsed.message.content[0].text).toBe("héllo 🌟 世界");
  });

  it("handles empty string", () => {
    const out = formatUserTurn("");
    const parsed = JSON.parse(out);
    expect(parsed.message.content[0].text).toBe("");
  });

  it("escapes embedded newlines so the output is still one NDJSON line", () => {
    const out = formatUserTurn("line1\nline2");
    // exactly one trailing newline
    expect(out.indexOf("\n")).toBe(out.length - 1);
    const parsed = JSON.parse(out.slice(0, -1));
    expect(parsed.message.content[0].text).toBe("line1\nline2");
  });
});
