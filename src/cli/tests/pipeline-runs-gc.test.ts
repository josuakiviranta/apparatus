// Compat shim: `gcOldRuns` was replaced by `gcOldRunsPerPipeline` in
// docs/superpowers/specs/2026-05-10-runs-folder-is-an-opaque-graveyard-design.md.
// This file's per-pipeline coverage lives in runs-gc-per-pipeline.test.ts;
// here we only pin the env-var → retention plumbing the run command does.
import { describe, it, expect } from "vitest";

describe("gcOldRuns is removed in favour of gcOldRunsPerPipeline", () => {
  it("does not export the old name from the barrel", async () => {
    const mod = await import("../commands/pipeline.js") as Record<string, unknown>;
    expect(mod.gcOldRuns).toBeUndefined();
    expect(typeof mod.gcOldRunsPerPipeline).toBe("function");
  });
});

describe("gcRunScopedArtefactsOnSuccess is exported from runs-gc", () => {
  it("is callable from the module path used by run.ts", async () => {
    const mod = await import("../commands/pipeline/runs-gc.js") as Record<string, unknown>;
    expect(typeof mod.gcRunScopedArtefactsOnSuccess).toBe("function");
  });
});
