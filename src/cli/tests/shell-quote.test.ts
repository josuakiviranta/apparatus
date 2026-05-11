import { describe, it, expect } from "vitest";
import { shellQuote } from "../lib/shell-quote.js";

describe("shellQuote", () => {
  it("wraps a plain string in single quotes", () => {
    expect(shellQuote("hello")).toBe("'hello'");
  });

  it("wraps a string with whitespace in single quotes", () => {
    expect(shellQuote("focus on auth")).toBe("'focus on auth'");
  });

  it("escapes embedded single quotes with the '\\'' pattern", () => {
    expect(shellQuote("it's fine")).toBe("'it'\\''s fine'");
  });

  it("leaves double quotes, $, and backticks inside the single-quoted shell-safe envelope untouched", () => {
    expect(shellQuote('a"b$c`d')).toBe("'a\"b$c`d'");
  });

  it("quotes an empty string as two adjacent single quotes", () => {
    expect(shellQuote("")).toBe("''");
  });

  it("quotes a key=value pair as a single token", () => {
    expect(shellQuote("steer=focus on auth")).toBe("'steer=focus on auth'");
  });
});
