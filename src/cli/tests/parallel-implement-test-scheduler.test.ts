// src/cli/tests/parallel-implement-test-scheduler.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { scheduleFromPlan, type SchedulerResult } from "../lib/dag-scheduler.js";

const fixture = (name: string) =>
  readFileSync(resolve(__dirname, "fixtures/parallel-implement-test", name), "utf-8");

describe("dag-scheduler", () => {
  it("all-parallel fixture: batch_count=1, every chunk depends_on=[]", () => {
    const result: SchedulerResult = scheduleFromPlan({
      planPath: "docs/superpowers/plans/all-parallel.md",
      planContent: fixture("plan-all-parallel.md"),
    });
    expect(result.dag.chunks).toHaveLength(3);
    expect(result.batchCount).toBe(1);
    expect(result.parallelWorthwhile).toBe(true);
    expect(result.dag.chunks.every((c) => c.depends_on.length === 0)).toBe(true);
  });

  it("all-serial fixture: batch_count=3, each chunk depends on its predecessor", () => {
    const result = scheduleFromPlan({
      planPath: "docs/superpowers/plans/all-serial.md",
      planContent: fixture("plan-all-serial.md"),
    });
    expect(result.dag.chunks).toHaveLength(3);
    expect(result.batchCount).toBe(3);
    expect(result.parallelWorthwhile).toBe(false);
    expect(result.dag.chunks[0].depends_on).toEqual([]);
    expect(result.dag.chunks[1].depends_on).toEqual(["c1"]);
    expect(result.dag.chunks[2].depends_on).toEqual(["c2"]);
  });

  it("mixed fixture: batch_count=2, batches are {c1,c3,c5} then {c2,c4}", () => {
    const result = scheduleFromPlan({
      planPath: "docs/superpowers/plans/mixed.md",
      planContent: fixture("plan-mixed.md"),
    });
    expect(result.dag.chunks).toHaveLength(5);
    expect(result.batchCount).toBe(2);
    expect(result.parallelWorthwhile).toBe(true);
    expect(result.dag.chunks[1].depends_on).toEqual(["c1"]);
    expect(result.dag.chunks[3].depends_on).toEqual(["c3"]);
    expect(result.dag.chunks[4].depends_on).toEqual([]);
    expect(result.batches[0].map((c) => c.id).sort()).toEqual(["c1", "c3", "c5"]);
    expect(result.batches[1].map((c) => c.id).sort()).toEqual(["c2", "c4"]);
  });

  it("empty plan: chunk_count=0, parallel_worthwhile=false, batch_count=0", () => {
    const result = scheduleFromPlan({
      planPath: "docs/superpowers/plans/empty.md",
      planContent: "# Empty plan with no chunks\n",
    });
    expect(result.dag.chunks).toHaveLength(0);
    expect(result.batchCount).toBe(0);
    expect(result.parallelWorthwhile).toBe(false);
  });

  it("chunk with no files_touched falls back to depends_on=[all-previous-chunks]", () => {
    const plan = `
# Plan with missing files-touched

## Chunk 1: clear chunk
**Files:**
- Create: \`src/a.ts\`

## Chunk 2: chunk without files stanza

Some prose with no Files: section anywhere.

## Chunk 3: clear chunk again
**Files:**
- Create: \`src/c.ts\`
`;
    const result = scheduleFromPlan({
      planPath: "docs/superpowers/plans/missing.md",
      planContent: plan,
    });
    expect(result.dag.chunks[1].depends_on).toEqual(["c1"]);
    expect(result.dag.chunks[1].files_touched).toEqual([]);
    expect(result.warnings).toContain("chunk c2 has no files_touched — falling back to depends_on=[all-previous]");
  });
});
