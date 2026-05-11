// src/cli/tests/parallel-illumination-to-implementation-dag-schema.test.ts
import { describe, it, expect } from "vitest";
import { DagSchema, type Dag } from "../lib/dag-schema.js";

describe("dag-schema", () => {
  const valid: Dag = {
    plan_path: "docs/superpowers/plans/2026-05-11-foo.md",
    pre_sha: null,
    chunks: [
      {
        id: "c1",
        title: "scaffold zod schema",
        depends_on: [],
        files_touched: ["src/cli/lib/foo.ts"],
        branch: "parallel-impl/c1-scaffold-zod-schema",
        worktree_path: null,
        status: "ready",
        head_sha: null,
        merge_sha: null,
        conflict_files: null,
        resolver_attempts: 0,
      },
    ],
  };

  it("accepts a canonical valid dag", () => {
    expect(() => DagSchema.parse(valid)).not.toThrow();
  });

  it("rejects an invalid status enum value", () => {
    const bad = { ...valid, chunks: [{ ...valid.chunks[0], status: "frobnicated" }] };
    expect(() => DagSchema.parse(bad)).toThrow();
  });

  it("rejects a dangling depends_on reference", () => {
    const bad = { ...valid, chunks: [{ ...valid.chunks[0], depends_on: ["c-nonexistent"] }] };
    expect(() => DagSchema.parse(bad)).toThrow();
  });
});
