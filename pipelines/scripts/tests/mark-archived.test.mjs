import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync, copyFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(__dirname, "..", "mark-archived.mjs");
const FIXTURES = resolve(__dirname, "fixtures");

function runScript(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: "utf8",
  });
}

describe("mark-archived.mjs", () => {
  let tmp;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "mark-archived-test-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("flips status: open → status: archived and appends archived_at + reason (literal)", () => {
    const target = join(tmp, "open.md");
    copyFileSync(join(FIXTURES, "mark-archived-open.md"), target);

    const reason = "Declined at approval gate";
    const result = runScript([target, reason]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");

    const today = new Date().toISOString().slice(0, 10);
    const after = readFileSync(target, "utf8");
    expect(after).toContain("status: archived\n");
    expect(after).not.toContain("status: open\n");
    expect(after).toContain(`archived_at: ${today}\n`);
    expect(after).toContain(`reason: ${reason}\n`);

    // Body preserved
    expect(after).toContain("## Core Idea");
    expect(after).toContain("Fixture content.");
  });

  it("reads reason from file when arg2 is a path to an existing file (prose carrier)", () => {
    const target = join(tmp, "open.md");
    copyFileSync(join(FIXTURES, "mark-archived-open.md"), target);

    const reasonFile = join(tmp, "invalid-reason.txt");
    writeFileSync(
      reasonFile,
      "pipelineFailed boolean already present; process.exitCode assignment already committed.\n",
    );

    const result = runScript([target, reasonFile]);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");

    const after = readFileSync(target, "utf8");
    expect(after).toContain(
      "reason: pipelineFailed boolean already present; process.exitCode assignment already committed.\n",
    );
  });

  it("collapses embedded newlines and consecutive whitespace into single spaces on write", () => {
    const target = join(tmp, "open.md");
    copyFileSync(join(FIXTURES, "mark-archived-open.md"), target);

    // Load the fixture that contains multi-line + multi-space text.
    const reasonFile = join(FIXTURES, "mark-archived-reason-multiline.txt");
    const result = runScript([target, reasonFile]);
    expect(result.status).toBe(0);

    const after = readFileSync(target, "utf8");
    expect(after).toContain(
      "reason: pipelineFailed boolean already present; process.exitCode assignment already committed.\n",
    );
    // Defensively: no raw newline or double-space landed inside the reason line.
    const reasonLine = after.split("\n").find((l) => l.startsWith("reason:"));
    expect(reasonLine).toBeDefined();
    expect(reasonLine).not.toMatch(/  /);
  });

  it("returns idempotent: true when already archived with the same reason", () => {
    const target = join(tmp, "archived-same.md");
    copyFileSync(join(FIXTURES, "mark-archived-archived-same-reason.md"), target);

    const result = runScript([target, "Declined at approval gate"]);
    expect(result.status).toBe(0);

    const trimmed = result.stdout.trim();
    expect(trimmed.includes("\n")).toBe(false);
    const parsed = JSON.parse(trimmed);
    expect(parsed).toEqual({ marked_archived: target, idempotent: true });

    // File should not be rewritten — no duplicate archived_at / reason lines.
    const after = readFileSync(target, "utf8");
    const archivedAtCount = (after.match(/archived_at:/g) || []).length;
    const reasonCount = (after.match(/reason:/g) || []).length;
    expect(archivedAtCount).toBe(1);
    expect(reasonCount).toBe(1);
  });

  it("fails with exit 1 when already archived with a different reason", () => {
    const target = join(tmp, "archived-different.md");
    copyFileSync(join(FIXTURES, "mark-archived-archived-different-reason.md"), target);

    const result = runScript([target, "Declined at approval gate"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("already archived with a different reason");
  });

  it("fails with exit 1 and 'status not open' when status is dispatched", () => {
    const target = join(tmp, "dispatched.md");
    copyFileSync(join(FIXTURES, "mark-archived-dispatched.md"), target);

    const result = runScript([target, "Some reason"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("status not open");
  });

  it("fails with exit 2 and usage message when args are missing", () => {
    const result = runScript([]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("usage: mark-archived.mjs");
  });

  it("treats arg2 as a literal reason when it is not an existing file path", () => {
    const target = join(tmp, "open.md");
    copyFileSync(join(FIXTURES, "mark-archived-open.md"), target);

    // Path-shaped but nonexistent: script must fall back to literal.
    const literal = "/definitely/does/not/exist/invalid-reason.txt";
    const result = runScript([target, literal]);
    expect(result.status).toBe(0);

    const after = readFileSync(target, "utf8");
    expect(after).toContain(`reason: ${literal}\n`);
  });
});
