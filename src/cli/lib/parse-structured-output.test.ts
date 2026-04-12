import { describe, it, expect } from "vitest";
import { parseStructuredOutput } from "./parse-structured-output.js";

describe("parseStructuredOutput", () => {
  it("parses a JSON array", () => {
    const input = '[{"type":"result","cost":0.5}]';
    const result = parseStructuredOutput(input);
    expect(result).toEqual([{ type: "result", cost: 0.5 }]);
  });

  it("parses a single JSON object by wrapping in array", () => {
    const input = '{"type":"result","cost":0.5}';
    const result = parseStructuredOutput(input);
    expect(result).toEqual([{ type: "result", cost: 0.5 }]);
  });

  it("parses NDJSON (newline-delimited JSON)", () => {
    const input = '{"type":"a"}\n{"type":"b"}';
    const result = parseStructuredOutput(input);
    expect(result).toEqual([{ type: "a" }, { type: "b" }]);
  });

  it("handles leading/trailing whitespace", () => {
    const input = '  [{"type":"result"}]  ';
    const result = parseStructuredOutput(input);
    expect(result).toEqual([{ type: "result" }]);
  });

  it("skips empty lines in NDJSON", () => {
    const input = '{"a":1}\n\n{"b":2}\n';
    const result = parseStructuredOutput(input);
    expect(result).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("returns empty array for empty input", () => {
    expect(parseStructuredOutput("")).toEqual([]);
    expect(parseStructuredOutput("  ")).toEqual([]);
  });

  it("skips non-JSON lines in NDJSON mode", () => {
    const input = '{"a":1}\nnot json\n{"b":2}';
    const result = parseStructuredOutput(input);
    expect(result).toEqual([{ a: 1 }, { b: 2 }]);
  });
});
