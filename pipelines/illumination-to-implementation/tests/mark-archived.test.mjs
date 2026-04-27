import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync, execFileSync } from "node:child_process";
import {
  readFileSync,
  copyFileSync,
  writeFileSync,
  mkdtempSync,
  rmSync,
  mkdirSync,
  existsSync,
} from "node:fs";
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

function setupIllum(tmp, fixturePath, filename = "open.md") {
  const illumDir = join(tmp, "meditations", "illuminations");
  mkdirSync(illumDir, { recursive: true });
  const target = join(illumDir, filename);
  copyFileSync(fixturePath, target);
  // Init git so the script's commit attempt is harmless and contained.
  spawnSync("git", ["-C", tmp, "init", "-b", "main"], { stdio: "ignore" });
  spawnSync("git", ["-C", tmp, "config", "user.email", "test@example.com"], {
    stdio: "ignore",
  });
  spawnSync("git", ["-C", tmp, "config", "user.name", "Test"], { stdio: "ignore" });
  spawnSync("git", ["-C", tmp, "add", "."], { stdio: "ignore" });
  spawnSync("git", ["-C", tmp, "commit", "-m", "seed"], { stdio: "ignore" });
  return {
    target,
    archivedTarget: join(tmp, "meditations", "archived-illuminations", filename),
  };
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
    const { target, archivedTarget } = setupIllum(
      tmp,
      join(FIXTURES, "mark-archived-open.md"),
    );

    const reason = "Declined at approval gate";
    const result = runScript([target, reason]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");

    const today = new Date().toISOString().slice(0, 10);
    const after = readFileSync(archivedTarget, "utf8");
    expect(after).toContain("status: archived\n");
    expect(after).not.toContain("status: open\n");
    expect(after).toContain(`archived_at: ${today}\n`);
    expect(after).toContain(`reason: ${reason}\n`);

    // Body preserved
    expect(after).toContain("## Core Idea");
    expect(after).toContain("Fixture content.");
  });

  it("joins multiple argv entries (simulates sh -c tokenization of a multi-word reason)", () => {
    const { target, archivedTarget } = setupIllum(
      tmp,
      join(FIXTURES, "mark-archived-open.md"),
    );

    // Simulates engine raw-expansion of `$archive_reason_short` into sh -c,
    // which tokenizes the sentence into separate argv entries.
    const result = runScript([
      target,
      "pipelineFailed",
      "boolean",
      "already",
      "present",
      "at",
      "src/attractor/engine.ts:221",
    ]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");

    const after = readFileSync(archivedTarget, "utf8");
    expect(after).toContain(
      "reason: pipelineFailed boolean already present at src/attractor/engine.ts:221\n",
    );
  });

  it("joins multiple argv entries for the decline-path default reason", () => {
    const { target, archivedTarget } = setupIllum(
      tmp,
      join(FIXTURES, "mark-archived-open.md"),
    );

    // Decline path: node default `Declined at approval gate` tokenizes to 4 argv entries.
    const result = runScript([target, "Declined", "at", "approval", "gate"]);

    expect(result.status).toBe(0);
    const after = readFileSync(archivedTarget, "utf8");
    expect(after).toContain("reason: Declined at approval gate\n");
  });

  it("reads reason from file when arg2 is a path to an existing file (prose carrier)", () => {
    const { target, archivedTarget } = setupIllum(
      tmp,
      join(FIXTURES, "mark-archived-open.md"),
    );

    const reasonFile = join(tmp, "invalid-reason.txt");
    writeFileSync(
      reasonFile,
      "pipelineFailed boolean already present; process.exitCode assignment already committed.\n",
    );

    const result = runScript([target, reasonFile]);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");

    const after = readFileSync(archivedTarget, "utf8");
    expect(after).toContain(
      "reason: pipelineFailed boolean already present; process.exitCode assignment already committed.\n",
    );
  });

  it("collapses embedded newlines and consecutive whitespace into single spaces on write", () => {
    const { target, archivedTarget } = setupIllum(
      tmp,
      join(FIXTURES, "mark-archived-open.md"),
    );

    // Load the fixture that contains multi-line + multi-space text.
    const reasonFile = join(FIXTURES, "mark-archived-reason-multiline.txt");
    const result = runScript([target, reasonFile]);
    expect(result.status).toBe(0);

    const after = readFileSync(archivedTarget, "utf8");
    expect(after).toContain(
      "reason: pipelineFailed boolean already present; process.exitCode assignment already committed.\n",
    );
    // Defensively: no raw newline or double-space landed inside the reason line.
    const reasonLine = after.split("\n").find((l) => l.startsWith("reason:"));
    expect(reasonLine).toBeDefined();
    expect(reasonLine).not.toMatch(/  /);
  });

  it("returns idempotent: true when already archived with the same reason", () => {
    const { target } = setupIllum(
      tmp,
      join(FIXTURES, "mark-archived-archived-same-reason.md"),
      "archived-same.md",
    );

    const result = runScript([target, "Declined at approval gate"]);
    expect(result.status).toBe(0);

    const trimmed = result.stdout.trim();
    expect(trimmed.includes("\n")).toBe(false);
    const parsed = JSON.parse(trimmed);
    expect(parsed).toMatchObject({ marked_archived: target, idempotent: true });
    expect(typeof parsed.archive_path).toBe("string");

    // File should not be rewritten — no duplicate archived_at / reason lines.
    const after = readFileSync(target, "utf8");
    const archivedAtCount = (after.match(/archived_at:/g) || []).length;
    const reasonCount = (after.match(/reason:/g) || []).length;
    expect(archivedAtCount).toBe(1);
    expect(reasonCount).toBe(1);
  });

  it("returns idempotent: true even when called with a different reason than the existing one", () => {
    const { target } = setupIllum(
      tmp,
      join(FIXTURES, "mark-archived-archived-different-reason.md"),
      "archived-different.md",
    );

    const before = readFileSync(target, "utf8");
    const originalReason =
      "Some prior reason that will mismatch the test-supplied reason.";
    expect(before).toContain(`reason: ${originalReason}\n`);

    const newReason = "A completely different new reason";
    const result = runScript([target, newReason]);
    expect(result.status).toBe(0);

    const parsed = JSON.parse(result.stdout.trim());
    expect(parsed.idempotent).toBe(true);
    expect(typeof parsed.archive_path).toBe("string");

    // File content not rewritten — original reason preserved, new reason absent.
    const after = readFileSync(target, "utf8");
    expect(after).toBe(before);
    expect(after).toContain(`reason: ${originalReason}\n`);
    expect(after).not.toContain(`reason: ${newReason}`);
    const reasonCount = (after.match(/reason:/g) || []).length;
    expect(reasonCount).toBe(1);
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
    const { target, archivedTarget } = setupIllum(
      tmp,
      join(FIXTURES, "mark-archived-open.md"),
    );

    // Path-shaped but nonexistent: script must fall back to literal.
    const literal = "/definitely/does/not/exist/invalid-reason.txt";
    const result = runScript([target, literal]);
    expect(result.status).toBe(0);

    const after = readFileSync(archivedTarget, "utf8");
    expect(after).toContain(`reason: ${literal}\n`);
  });
});

describe("mark-archived.mjs (file move semantics)", () => {
  let tmp;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "mark-archived-move-test-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("physically moves the illumination, commits the move, and emits archive_path", () => {
    const filename = "T7000-test.md";
    const illumDir = join(tmp, "meditations", "illuminations");
    mkdirSync(illumDir, { recursive: true });
    const target = join(illumDir, filename);
    copyFileSync(join(FIXTURES, "mark-archived-open.md"), target);

    // Real git repo so the script can commit the move.
    execFileSync("git", ["-C", tmp, "init", "-b", "main"], { stdio: "ignore" });
    execFileSync("git", ["-C", tmp, "config", "user.email", "test@example.com"], {
      stdio: "ignore",
    });
    execFileSync("git", ["-C", tmp, "config", "user.name", "Test"], { stdio: "ignore" });
    execFileSync("git", ["-C", tmp, "add", "."], { stdio: "ignore" });
    execFileSync("git", ["-C", tmp, "commit", "-m", "seed"], { stdio: "ignore" });

    const result = runScript([target, "Declined at approval gate"]);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");

    const parsed = JSON.parse(result.stdout.trim());
    expect(parsed.archive_path).toBe(
      join("meditations", "archived-illuminations", filename),
    );

    // File moved.
    expect(existsSync(target)).toBe(false);
    const archivedTarget = join(tmp, "meditations", "archived-illuminations", filename);
    expect(existsSync(archivedTarget)).toBe(true);

    // Commit landed.
    const log = execFileSync("git", ["-C", tmp, "log", "--oneline", "-1"], {
      encoding: "utf8",
    });
    expect(log).toContain(`meditate: archive ${filename}`);
  });
});
