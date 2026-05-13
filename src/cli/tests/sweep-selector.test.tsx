import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { SweepSelector } from "../components/SweepSelector.js";
import type { Entry } from "../lib/sweep-fs.js";

const entries: Entry[] = [
  { relPath: "runs/run-aaaa1111", tag: "scratch", size: 512 },
  { relPath: "meditations/illuminations/.triage/trg-b2", tag: "scratch", size: 256 },
  { relPath: "meditations/illuminations", tag: "curated", size: 4096 },
  { relPath: "notes.md", tag: "curated", size: 128 },
];

describe("SweepSelector", () => {
  it("renders one row per entry with size, tag, and pre-selection state", () => {
    const { lastFrame } = render(
      <SweepSelector entries={entries} onSubmit={() => {}} onCancel={() => {}} />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("runs/run-aaaa1111");
    expect(frame).toContain("notes.md");
    expect(frame).toContain("[scratch]");
    expect(frame).toContain("[curated]");
    // pre-select state: scratch checked, curated unchecked
    const scratchRow = frame.split("\n").find((l) => l.includes("runs/run-aaaa1111")) ?? "";
    const curatedRow = frame.split("\n").find((l) => l.includes("notes.md")) ?? "";
    expect(scratchRow).toMatch(/\[x\]/);
    expect(curatedRow).toMatch(/\[ \]/);
  });

  it("toggles a row on space and emits the selection on Enter -> y", async () => {
    let submitted: Entry[] | null = null;
    const { stdin } = render(
      <SweepSelector
        entries={entries}
        onSubmit={(sel) => {
          submitted = sel;
        }}
        onCancel={() => {}}
      />,
    );

    // initial selection = both scratch rows. Move down, down to the curated illuminations row.
    const flush = () => new Promise((r) => setTimeout(r, 20));
    stdin.write("\u001B[B"); // ↓
    await flush();
    stdin.write("\u001B[B"); // ↓
    await flush();
    stdin.write(" "); // toggle curated illuminations ON (warn)
    await flush();
    stdin.write("\r"); // Enter -> confirm prompt
    await flush();
    stdin.write("y"); // confirm
    await flush();

    expect(submitted).not.toBeNull();
    const rels = (submitted as unknown as Entry[]).map((e) => e.relPath).sort();
    expect(rels).toEqual([
      "meditations/illuminations",
      "meditations/illuminations/.triage/trg-b2",
      "runs/run-aaaa1111",
    ]);
  });

  it("cancels on Esc — onSubmit is NOT called, onCancel IS", async () => {
    let submitted = false;
    let cancelled = false;
    const { stdin } = render(
      <SweepSelector
        entries={entries}
        onSubmit={() => {
          submitted = true;
        }}
        onCancel={() => {
          cancelled = true;
        }}
      />,
    );
    stdin.write("\u001B"); // Esc
    await new Promise((r) => setTimeout(r, 50));
    expect(submitted).toBe(false);
    expect(cancelled).toBe(true);
  });

  it("warns visually on curated rows even before toggle (marker e.g. [!])", () => {
    const { lastFrame } = render(
      <SweepSelector entries={entries} onSubmit={() => {}} onCancel={() => {}} />,
    );
    const frame = lastFrame() ?? "";
    const curatedRow = frame.split("\n").find((l) => l.includes("notes.md")) ?? "";
    // The warning marker is part of the curated row rendering (column or color).
    // We assert presence of [!] anywhere in the curated row text.
    expect(curatedRow).toMatch(/\[!\]/);
  });
});
