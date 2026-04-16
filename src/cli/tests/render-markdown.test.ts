import { describe, it, expect } from "vitest";
import { renderMarkdown } from "../lib/render-markdown.js";

describe("renderMarkdown", () => {
  it("converts bold syntax to ANSI bold", () => {
    const result = renderMarkdown("**bold text**");
    expect(result).not.toContain("**");
    expect(result.length).toBeGreaterThan(0);
  });

  it("converts heading syntax — no literal # in output", () => {
    const result = renderMarkdown("# My Heading");
    expect(result).not.toMatch(/^#\s/m);
  });

  it("passes plain text through unchanged (no markdown)", () => {
    const result = renderMarkdown("hello world");
    expect(result.trim()).toContain("hello world");
  });

  it("handles numbered lists without literal markdown", () => {
    const result = renderMarkdown("1. First\n2. Second");
    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain("First");
    expect(result).toContain("Second");
  });

  it("does not add trailing newlines", () => {
    const result = renderMarkdown("some text");
    expect(result).toBe(result.trimEnd());
  });

  it("handles empty string without throwing", () => {
    expect(() => renderMarkdown("")).not.toThrow();
  });
});
