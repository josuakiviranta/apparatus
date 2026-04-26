import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, existsSync, writeFileSync, utimesSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { gcOldRuns } from "../commands/pipeline.js";

function makeRun(root: string, name: string, mtimeSec: number): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "pipeline.jsonl"), "{}\n");
  utimesSync(dir, mtimeSec, mtimeSec);
  return dir;
}

describe("gcOldRuns", () => {
  let root: string;

  beforeEach(() => { root = mkdtempSync(join(tmpdir(), "ralph-gc-")); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it("is a no-op when fewer than `keep` runs exist", () => {
    makeRun(root, "aaaaaaaa", 1000);
    makeRun(root, "bbbbbbbb", 2000);
    gcOldRuns(root, 5);
    expect(existsSync(join(root, "aaaaaaaa"))).toBe(true);
    expect(existsSync(join(root, "bbbbbbbb"))).toBe(true);
  });

  it("keeps the N newest by mtime and prunes the rest", () => {
    const old1 = makeRun(root, "old1", 1000);
    const old2 = makeRun(root, "old2", 2000);
    const new1 = makeRun(root, "new1", 3000);
    const new2 = makeRun(root, "new2", 4000);
    gcOldRuns(root, 2);
    expect(existsSync(old1)).toBe(false);
    expect(existsSync(old2)).toBe(false);
    expect(existsSync(new1)).toBe(true);
    expect(existsSync(new2)).toBe(true);
  });

  it("ignores non-directory entries", () => {
    writeFileSync(join(root, "stray.txt"), "x");
    makeRun(root, "aaaaaaaa", 1000);
    expect(() => gcOldRuns(root, 5)).not.toThrow();
    expect(existsSync(join(root, "stray.txt"))).toBe(true);
  });

  it("returns silently if root does not exist", () => {
    expect(() => gcOldRuns(join(root, "missing"), 50)).not.toThrow();
  });
});
