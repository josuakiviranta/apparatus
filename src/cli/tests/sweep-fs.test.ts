import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  listEntries,
  dirSize,
  tagOf,
  formatSize,
  type Entry,
} from "../lib/sweep-fs.js";

describe("sweep-fs helpers", () => {
  let project: string;
  let apparatDir: string;

  beforeEach(() => {
    project = mkdtempSync(join(tmpdir(), "apparat-sweep-fs-"));
    apparatDir = join(project, ".apparat");
    mkdirSync(apparatDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(project, { recursive: true, force: true });
  });

  function seed(): void {
    mkdirSync(join(apparatDir, "runs", "run-aaaa1111"), { recursive: true });
    writeFileSync(join(apparatDir, "runs", "run-aaaa1111", "pipeline.jsonl"), "{}\n");

    mkdirSync(join(apparatDir, "meditations", "illuminations", ".triage", "trg-bbbb2222"), { recursive: true });
    writeFileSync(join(apparatDir, "meditations", "illuminations", ".triage", "trg-bbbb2222", "chat-notes.md"), "x");

    mkdirSync(join(apparatDir, "meditations", "stimuli", ".triage", "trg-cccc3333"), { recursive: true });
    writeFileSync(join(apparatDir, "meditations", "stimuli", ".triage", "trg-cccc3333", "lens.md"), "y");

    mkdirSync(join(apparatDir, "sessions"), { recursive: true });
    writeFileSync(join(apparatDir, "sessions", "2026-05-12-x.md"), "session");

    writeFileSync(join(apparatDir, "meditations", "illuminations", "2026-05-12T0900-keep.md"), "curated");
    writeFileSync(join(apparatDir, "notes.md"), "curated notes");
  }

  it("listEntries returns each .triage/<runId>/ as a separate scratch row", () => {
    seed();
    const entries = listEntries(apparatDir);
    const rels = entries.map((e: Entry) => e.relPath);
    expect(rels).toContain("runs/run-aaaa1111");
    expect(rels).toContain("meditations/illuminations/.triage/trg-bbbb2222");
    expect(rels).toContain("meditations/stimuli/.triage/trg-cccc3333");
  });

  it("listEntries tags meditations/illuminations and meditations/stimuli as curated", () => {
    seed();
    const entries = listEntries(apparatDir);
    const illum = entries.find((e) => e.relPath === "meditations/illuminations");
    const stim = entries.find((e) => e.relPath === "meditations/stimuli");
    expect(illum?.tag).toBe("curated");
    expect(stim?.tag).toBe("curated");
  });

  it("listEntries tags sessions and runs as scratch", () => {
    seed();
    const entries = listEntries(apparatDir);
    const sessions = entries.find((e) => e.relPath === "sessions");
    const runChild = entries.find((e) => e.relPath === "runs/run-aaaa1111");
    expect(sessions?.tag).toBe("scratch");
    expect(runChild?.tag).toBe("scratch");
  });

  it("listEntries tags notes.md as curated", () => {
    seed();
    const entries = listEntries(apparatDir);
    const notes = entries.find((e) => e.relPath === "notes.md");
    expect(notes?.tag).toBe("curated");
  });

  it("dirSize sums bytes recursively", () => {
    const a = join(apparatDir, "a");
    mkdirSync(join(a, "b"), { recursive: true });
    writeFileSync(join(a, "b", "x.txt"), "hello"); // 5 bytes
    writeFileSync(join(a, "y.txt"), "world!"); // 6 bytes
    expect(dirSize(a)).toBe(11);
  });

  it("dirSize returns 0 for missing paths", () => {
    expect(dirSize(join(apparatDir, "does-not-exist"))).toBe(0);
  });

  it("tagOf classifies known prefixes", () => {
    expect(tagOf("runs/r1")).toBe("scratch");
    expect(tagOf("sessions")).toBe("scratch");
    expect(tagOf("meditations/illuminations")).toBe("curated");
    expect(tagOf("meditations/stimuli")).toBe("curated");
    expect(tagOf("notes.md")).toBe("curated");
    expect(tagOf("random-thing")).toBe("untagged");
  });

  it("formatSize renders B / KB / MB tokens", () => {
    expect(formatSize(0)).toMatch(/^0 B$/);
    expect(formatSize(2048)).toMatch(/KB/);
    expect(formatSize(2 * 1024 * 1024)).toMatch(/MB/);
  });
});
