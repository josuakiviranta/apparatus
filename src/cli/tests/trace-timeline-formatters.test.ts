import { describe, it, expect } from "vitest";
import { summarizeToolInput } from "../lib/trace-timeline-formatters.js";

describe("summarizeToolInput", () => {
  it("Read: returns file_path verbatim when short", () => {
    expect(summarizeToolInput("Read", { file_path: "plan.md" })).toBe("plan.md");
  });

  it("Read: truncate-middle when file_path > 60 chars", () => {
    const long = "a/very/deep/nested/path/that/keeps/going/and/going/and/going/file.ts";
    const out = summarizeToolInput("Read", { file_path: long });
    expect(out.length).toBeLessThanOrEqual(60);
    expect(out).toContain("…");
    expect(out.startsWith("a/very/deep")).toBe(true);
    expect(out.endsWith("file.ts")).toBe(true);
  });

  it("Edit: renders -<oldLines>+<newLines>", () => {
    expect(
      summarizeToolInput("Edit", {
        file_path: "src/auth.ts",
        old_string: "line1\nline2\nline3",
        new_string: "lineA\nlineB",
      }),
    ).toBe("src/auth.ts -3+2");
  });

  it("Write: formats bytes as B / KB / MB", () => {
    expect(summarizeToolInput("Write", { file_path: "tiny.md", content: "x".repeat(900) })).toBe("tiny.md 900B");
    expect(summarizeToolInput("Write", { file_path: "med.md",  content: "x".repeat(2048) })).toBe("med.md 2.0KB");
    expect(summarizeToolInput("Write", { file_path: "big.md",  content: "x".repeat(2 * 1024 * 1024) })).toBe("big.md 2.0MB");
  });

  it("Bash: truncates command to 60 chars with ellipsis", () => {
    const short = "git rev-parse HEAD";
    expect(summarizeToolInput("Bash", { command: short })).toBe(short);
    const long = "npx vitest run src/cli/tests/some-very-long-named-test-file-that-keeps-going.test.ts";
    const out = summarizeToolInput("Bash", { command: long });
    expect(out.length).toBeLessThanOrEqual(60);
    expect(out.endsWith("…")).toBe(true);
  });

  it("Grep: renders `<pattern> in <path>` with default `.`", () => {
    expect(summarizeToolInput("Grep", { pattern: "TODO" })).toBe("TODO in .");
    expect(summarizeToolInput("Grep", { pattern: "TODO", path: "src/" })).toBe("TODO in src/");
  });

  it("Agent: renders ▶ <description> truncated", () => {
    expect(summarizeToolInput("Agent", { description: "audit imports", subagent_type: "general-purpose" }))
      .toBe("▶ audit imports");
    const long = "▶ " + "x".repeat(80);
    const out = summarizeToolInput("Agent", { description: "x".repeat(80), subagent_type: "general-purpose" });
    expect(out.length).toBeLessThanOrEqual(60);
    expect(out.startsWith("▶ ")).toBe(true);
    expect(out).toContain("…");
  });

  it("unknown tool: falls back to JSON.stringify slice(0, 60)", () => {
    const out = summarizeToolInput("WeirdTool", { a: 1, b: "two" });
    expect(out).toBe('{"a":1,"b":"two"}');
  });

  it("unknown tool with large payload: truncates", () => {
    const out = summarizeToolInput("WeirdTool", { junk: "y".repeat(200) });
    expect(out.length).toBeLessThanOrEqual(60);
  });
});
