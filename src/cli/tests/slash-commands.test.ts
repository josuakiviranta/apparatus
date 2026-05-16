import { describe, it, expect } from "vitest";
import { parseSlashCommand, HELP_TEXT } from "../lib/slash-commands.js";

describe("parseSlashCommand", () => {
  it("parses /end", () => {
    expect(parseSlashCommand("/end")).toEqual({ kind: "end" });
  });

  it("parses /abort", () => {
    expect(parseSlashCommand("/abort")).toEqual({ kind: "abort" });
  });

  it("parses /help", () => {
    expect(parseSlashCommand("/help")).toEqual({ kind: "help" });
  });

  it("is case-insensitive for commands", () => {
    expect(parseSlashCommand("/END")).toEqual({ kind: "end" });
    expect(parseSlashCommand("/Help")).toEqual({ kind: "help" });
  });

  it("trims surrounding whitespace on commands", () => {
    expect(parseSlashCommand("  /end  ")).toEqual({ kind: "end" });
  });

  it("returns unknown for /foo", () => {
    expect(parseSlashCommand("/foo")).toEqual({ kind: "unknown", raw: "/foo" });
  });

  it("unknown command preserves trimmed raw", () => {
    expect(parseSlashCommand("  /FOO  ")).toEqual({ kind: "unknown", raw: "/FOO" });
  });

  it("returns message for plain text", () => {
    expect(parseSlashCommand("hello world")).toEqual({ kind: "message", text: "hello world" });
  });

  it("treats text starting with non-slash as message even if /something appears later", () => {
    expect(parseSlashCommand("tell me about /end")).toEqual({
      kind: "message",
      text: "tell me about /end",
    });
  });

  it("preserves the original (un-trimmed) text in a message", () => {
    expect(parseSlashCommand("  hello  ")).toEqual({ kind: "message", text: "  hello  " });
  });

  it("HELP_TEXT mentions /end, /abort, /help", () => {
    expect(HELP_TEXT).toMatch(/\/end/);
    expect(HELP_TEXT).toMatch(/\/abort/);
    expect(HELP_TEXT).toMatch(/\/help/);
  });

  it("parses /edit-instructions", () => {
    expect(parseSlashCommand("/edit-instructions")).toEqual({ kind: "edit-instructions" });
  });

  it("/edit-instructions is case-insensitive", () => {
    expect(parseSlashCommand("/Edit-Instructions")).toEqual({ kind: "edit-instructions" });
  });

  it("HELP_TEXT mentions /edit-instructions", () => {
    expect(HELP_TEXT).toMatch(/\/edit-instructions/);
  });
});
