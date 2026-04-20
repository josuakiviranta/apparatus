import { describe, it, expect } from "vitest";
import { renderCodeFrame } from "../lib/code-frame.js";

describe("renderCodeFrame", () => {
  const src = ["line1", "line2 bad", "line3", "line4"].join("\n");

  it("renders N lines before and after, gutter with numbers", () => {
    const out = renderCodeFrame(src, { line: 2, column: 7 }, { context: 1, color: false });
    expect(out).toContain("1 |");
    expect(out).toContain("2 |");
    expect(out).toContain("3 |");
    expect(out).not.toContain("4 |");
  });

  it("emits caret under the offending column", () => {
    const out = renderCodeFrame(src, { line: 2, column: 7 }, { context: 0, color: false });
    const lines = out.split("\n");
    const caretLine = lines.find(l => l.includes("^"));
    expect(caretLine).toBeDefined();
    const caretIdx = caretLine!.indexOf("^");
    const prevLine = lines[lines.indexOf(caretLine!) - 1];
    expect(prevLine.charAt(caretIdx)).toBe("b");
  });

  it("spans caret across endColumn when provided", () => {
    const out = renderCodeFrame(src, { line: 2, column: 7, endLine: 2, endColumn: 10 }, { context: 0, color: false });
    expect(out).toMatch(/\^{3}/);
  });

  it("clamps lines past EOF", () => {
    const out = renderCodeFrame(src, { line: 99, column: 1 }, { context: 0, color: false });
    expect(out).not.toContain("undefined");
  });
});
