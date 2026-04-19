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
});
