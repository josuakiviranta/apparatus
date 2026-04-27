import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { resolveGate } from "../lib/gate-registry.js";

let tmpDir: string;

afterEach(() => {
  if (tmpDir) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

describe("resolveGate", () => {
  it("happy path: returns GateConfig with choices, inputs, and trimmed prompt", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "gate-registry-test-"));
    const content = [
      "---",
      "type: gate",
      "choices:",
      "  - Approve",
      "  - Decline",
      "  - Chat",
      "inputs:",
      "  - plan_path",
      "---",
      "Proceed with plan?",
      "",
      "$plan_path",
    ].join("\n");
    writeFileSync(join(tmpDir, "approval_gate.md"), content, "utf-8");

    const result = resolveGate("approval_gate", { dotDir: tmpDir });

    expect(result.choices).toEqual(["Approve", "Decline", "Chat"]);
    expect(result.inputs).toEqual(["plan_path"]);
    expect(result.prompt).toBe("Proceed with plan?\n\n$plan_path");
  });

  it("missing file: throws with message matching /Gate file not found.*nope\\.md/", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "gate-registry-test-"));

    expect(() => resolveGate("nope", { dotDir: tmpDir })).toThrow(
      /Gate file not found.*nope\.md/,
    );
  });

  it("invalid frontmatter (no type): throws zod error", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "gate-registry-test-"));
    const content = [
      "---",
      "choices:",
      "  - a",
      "  - b",
      "---",
      "Some prompt body",
    ].join("\n");
    writeFileSync(join(tmpDir, "bad_gate.md"), content, "utf-8");

    expect(() => resolveGate("bad_gate", { dotDir: tmpDir })).toThrow();
  });

  it("body trimmed: leading/trailing newlines stripped from prompt", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "gate-registry-test-"));
    const content = [
      "---",
      "type: gate",
      "choices:",
      "  - Yes",
      "  - No",
      "---",
      "",
      "",
      "Inner prompt text",
      "",
      "",
    ].join("\n");
    writeFileSync(join(tmpDir, "trim_gate.md"), content, "utf-8");

    const result = resolveGate("trim_gate", { dotDir: tmpDir });

    expect(result.prompt).toBe("Inner prompt text");
  });
});
