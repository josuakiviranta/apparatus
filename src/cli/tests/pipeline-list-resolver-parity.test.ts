import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { listAllPipelines, resolvePipelineArg } from "../lib/pipeline-resolver.js";

// Parity contract: every name that listAllPipelines returns must resolve via
// resolvePipelineArg to a path that exists on disk. Drift between the two
// surfaces is a red test, not a silent UX bug.

function seedLocalFolder(project: string, name: string): void {
  const dir = join(project, ".apparat", "pipelines", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "pipeline.dot"),
    `digraph ${name.replace(/-/g, "_")} {\n  start [shape=Mdiamond]\n  done [shape=Msquare]\n  start -> done\n}`,
  );
}

function seedLocalFlat(project: string, name: string): void {
  const dir = join(project, ".apparat", "pipelines");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${name}.dot`),
    `digraph ${name.replace(/-/g, "_")} {\n  start [shape=Mdiamond]\n  done [shape=Msquare]\n  start -> done\n}`,
  );
}

function assertParity(project: string): void {
  const entries = listAllPipelines(project);
  expect(entries.length).toBeGreaterThan(0);
  for (const e of entries) {
    const resolved = resolvePipelineArg(e.name, project);
    expect(existsSync(resolved)).toBe(true);
    // For non-fork-shadowed bundled rows AND every local row, the resolver
    // path must equal the listing's absPath. (Fork pairs intentionally have
    // two different absPaths for the same name — local wins.)
    if (e.origin !== "bundled" || !e.hasFork) {
      expect(resolved).toBe(e.absPath);
    }
  }
}

describe("pipeline list ↔ resolver parity", () => {
  it("fresh project (bundled only) — every listed name resolves", () => {
    const project = mkdtempSync(join(tmpdir(), "apparat-parity-fresh-"));
    try {
      assertParity(project);
      const entries = listAllPipelines(project);
      const bundledNames = entries.filter(e => e.origin === "bundled").map(e => e.name).sort();
      // Sanity: the three pipelines in src/cli/pipelines/ today.
      expect(bundledNames).toEqual(["implement", "janitor", "meditate"]);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  it("project with one local folder-form pipeline — every name resolves", () => {
    const project = mkdtempSync(join(tmpdir(), "apparat-parity-localfolder-"));
    try {
      seedLocalFolder(project, "my-flow");
      assertParity(project);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  it("project with one local flat-form pipeline — every name resolves", () => {
    const project = mkdtempSync(join(tmpdir(), "apparat-parity-localflat-"));
    try {
      seedLocalFlat(project, "legacy");
      assertParity(project);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  it("project with a forked bundled name — local wins, both rows tagged, resolver agrees with local", () => {
    const project = mkdtempSync(join(tmpdir(), "apparat-parity-fork-"));
    try {
      seedLocalFolder(project, "janitor");
      assertParity(project);

      const entries = listAllPipelines(project);
      const local = entries.find(e => e.origin === "local-folder" && e.name === "janitor");
      const bundled = entries.find(e => e.origin === "bundled" && e.name === "janitor");
      expect(local?.shadowedBundled).toBe(true);
      expect(bundled?.hasFork).toBe(true);

      // The resolver must side with local for "janitor" — that's what makes
      // the (forked → local) tag meaningful.
      const resolved = resolvePipelineArg("janitor", project);
      expect(resolved).toBe(local!.absPath);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});
