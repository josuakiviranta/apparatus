import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "../../..");
const PIPELINES_ROOT = join(REPO_ROOT, ".apparat", "pipelines");

// Both pipelines share byte-identical chat-refiner.md / chat-summarizer.md.
const PIPELINES = [
  "illumination-to-implementation",
  "parallel-illumination-to-implementation",
];

// The summarizer reads this exact path. The refiner must WRITE to the same one,
// or the chat-refinement loop silently drops the user's conclusions (the file
// the summarizer reads never exists). See the dot-less `apparat/runs/...`
// stray-artifact bug that surfaced this drift.
const CANONICAL_CHAT_NOTES =
  "$project/.apparat/meditations/illuminations/.triage/$run_id/chat-notes.md";

describe("chat-refiner ↔ chat-summarizer chat-notes path contract", () => {
  for (const pipeline of PIPELINES) {
    const dir = join(PIPELINES_ROOT, pipeline);
    const refiner = readFileSync(join(dir, "chat-refiner.md"), "utf-8");
    const summarizer = readFileSync(join(dir, "chat-summarizer.md"), "utf-8");

    it(`${pipeline}: summarizer reads the canonical chat-notes path`, () => {
      expect(summarizer).toContain(CANONICAL_CHAT_NOTES);
    });

    it(`${pipeline}: refiner writes to the exact path the summarizer reads`, () => {
      expect(refiner).toContain(CANONICAL_CHAT_NOTES);
    });

    it(`${pipeline}: refiner references no dot-less apparat/runs path`, () => {
      // `.apparat/runs` (dotted) is fine; bare `apparat/runs` is the bug.
      expect(refiner).not.toMatch(/(?<!\.)apparat\/runs/);
    });
  }
});
