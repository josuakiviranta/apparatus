import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(__dirname, "..", "mark-dispatched.mjs");
const FIXTURES = resolve(__dirname, "fixtures");

function runScript(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: "utf8",
  });
}

describe("mark-dispatched.mjs", () => {
  let tmp;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "mark-dispatched-test-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("flips status: open → status: dispatched and appends dispatched_at + plan_path", () => {
    const target = join(tmp, "open.md");
    copyFileSync(join(FIXTURES, "open.md"), target);

    const planPath = "docs/superpowers/plans/2026-04-17-sample.md";
    const result = runScript([target, planPath]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");

    const today = new Date().toISOString().slice(0, 10);
    const after = readFileSync(target, "utf8");
    expect(after).toContain("status: dispatched\n");
    expect(after).not.toContain("status: open\n");
    expect(after).toContain(`dispatched_at: ${today}\n`);
    expect(after).toContain(`plan_path: ${planPath}\n`);

    // Body should be preserved
    expect(after).toContain("## Core Idea");
    expect(after).toContain("Fixture content.");
  });

  it("emits a single-line JSON object to stdout on success", () => {
    const target = join(tmp, "open.md");
    copyFileSync(join(FIXTURES, "open.md"), target);

    const result = runScript([target, "some/plan.md"]);
    expect(result.status).toBe(0);

    const trimmed = result.stdout.trim();
    // Must be a single line — newline only at the very end
    expect(trimmed.includes("\n")).toBe(false);
    const parsed = JSON.parse(trimmed);
    expect(parsed).toEqual({ marked_dispatched: target });
  });

  it("fails with exit 1 and 'status not open: dispatched' when already dispatched", () => {
    const target = join(tmp, "dispatched.md");
    copyFileSync(join(FIXTURES, "dispatched.md"), target);

    const result = runScript([target, "any/plan.md"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("status not open: dispatched");
  });

  it("fails with exit 1 and 'no frontmatter' when the file has no frontmatter", () => {
    const target = join(tmp, "no-frontmatter.md");
    copyFileSync(join(FIXTURES, "no-frontmatter.md"), target);

    const result = runScript([target, "any/plan.md"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("no frontmatter");
  });

  it("fails with exit 2 and usage message when args are missing", () => {
    const result = runScript([]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("usage: mark-dispatched.mjs");
  });
});
