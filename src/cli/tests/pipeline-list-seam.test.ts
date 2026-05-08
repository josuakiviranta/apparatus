import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// Point the bundled tier at a temp directory so each test owns its bundled
// inventory. We mock getBundledPipelinesDir + resolveBundledPipeline only
// (no fs mock — the seam walks real fs).

let bundledFixture: string;

vi.mock("../lib/assets.js", () => ({
  resolveBundledPipeline: (n: string) => join(bundledFixture, n, "pipeline.dot"),
  getBundledPipelinesDir: () => bundledFixture,
}));

import { listAllPipelines } from "../lib/pipeline-resolver.js";

function seedBundled(...names: string[]): void {
  for (const n of names) {
    mkdirSync(join(bundledFixture, n), { recursive: true });
    writeFileSync(
      join(bundledFixture, n, "pipeline.dot"),
      `digraph ${n.replace(/-/g, "_")} {\n  start [shape=Mdiamond]\n  done [shape=Msquare]\n  start -> done\n}`,
    );
  }
}

describe("listAllPipelines", () => {
  beforeEach(() => {
    bundledFixture = mkdtempSync(join(tmpdir(), "apparat-bundled-fixture-"));
    seedBundled("implement", "janitor", "meditate");
  });
  afterEach(() => {
    rmSync(bundledFixture, { recursive: true, force: true });
  });

  it("returns bundled-only roster on a fresh project (no local pipelines)", () => {
    const project = mkdtempSync(join(tmpdir(), "apparat-fresh-"));
    try {
      const entries = listAllPipelines(project);
      const bundled = entries.filter(e => e.origin === "bundled").map(e => e.name).sort();
      expect(bundled).toEqual(["implement", "janitor", "meditate"]);
      expect(entries.filter(e => e.origin !== "bundled")).toHaveLength(0);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  it("includes a local folder-form pipeline alongside bundled ones", () => {
    const project = mkdtempSync(join(tmpdir(), "apparat-localfolder-"));
    try {
      const localDir = join(project, ".apparat", "pipelines", "my-flow");
      mkdirSync(localDir, { recursive: true });
      writeFileSync(
        join(localDir, "pipeline.dot"),
        `digraph my_flow {\n  start [shape=Mdiamond]\n  done [shape=Msquare]\n  start -> done\n}`,
      );
      const local = listAllPipelines(project).filter(e => e.origin === "local-folder");
      expect(local).toHaveLength(1);
      expect(local[0].name).toBe("my-flow");
      expect(local[0].absPath).toBe(join(localDir, "pipeline.dot"));
      expect(local[0].shadowedBundled).toBeFalsy();
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  it("includes a local flat-form pipeline alongside bundled ones", () => {
    const project = mkdtempSync(join(tmpdir(), "apparat-localflat-"));
    try {
      const dir = join(project, ".apparat", "pipelines");
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, "legacy.dot"),
        `digraph legacy {\n  start [shape=Mdiamond]\n  done [shape=Msquare]\n  start -> done\n}`,
      );
      const flats = listAllPipelines(project).filter(e => e.origin === "local-flat");
      expect(flats.map(e => e.name)).toEqual(["legacy"]);
      expect(flats[0].absPath).toBe(join(dir, "legacy.dot"));
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  it("marks fork pairs on BOTH rows (local entry shadowedBundled, bundled entry hasFork)", () => {
    const project = mkdtempSync(join(tmpdir(), "apparat-fork-"));
    try {
      const fork = join(project, ".apparat", "pipelines", "janitor");
      mkdirSync(fork, { recursive: true });
      writeFileSync(
        join(fork, "pipeline.dot"),
        `digraph janitor {\n  start [shape=Mdiamond]\n  done [shape=Msquare]\n  start -> done\n}`,
      );
      const entries = listAllPipelines(project);
      const local = entries.find(e => e.origin === "local-folder" && e.name === "janitor");
      const bundled = entries.find(e => e.origin === "bundled" && e.name === "janitor");
      expect(local?.shadowedBundled).toBe(true);
      expect(bundled?.hasFork).toBe(true);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  it("prefers folder-form when BOTH folder and flat with the same name exist (mirror resolvePipelineArg precedence)", () => {
    const project = mkdtempSync(join(tmpdir(), "apparat-pref-"));
    try {
      const dir = join(project, ".apparat", "pipelines");
      mkdirSync(join(dir, "dup"), { recursive: true });
      writeFileSync(
        join(dir, "dup", "pipeline.dot"),
        `digraph dup {\n  start [shape=Mdiamond]\n  done [shape=Msquare]\n  start -> done\n}`,
      );
      writeFileSync(
        join(dir, "dup.dot"),
        `digraph dup {\n  start [shape=Mdiamond]\n  done [shape=Msquare]\n  start -> done\n}`,
      );
      const dups = listAllPipelines(project).filter(e => e.name === "dup" && e.origin !== "bundled");
      expect(dups).toHaveLength(1);
      expect(dups[0].origin).toBe("local-folder");
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  it("sorts each origin bucket alphabetically by name", () => {
    const project = mkdtempSync(join(tmpdir(), "apparat-sort-"));
    try {
      const dir = join(project, ".apparat", "pipelines");
      mkdirSync(dir, { recursive: true });
      for (const n of ["zeta", "alpha", "mike"]) {
        writeFileSync(
          join(dir, `${n}.dot`),
          `digraph ${n} {\n  start [shape=Mdiamond]\n  done [shape=Msquare]\n  start -> done\n}`,
        );
      }
      const localNames = listAllPipelines(project)
        .filter(e => e.origin !== "bundled")
        .map(e => e.name);
      expect(localNames).toEqual(["alpha", "mike", "zeta"]);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  it("returns bundled-only when project has no .apparat/pipelines/ folder at all", () => {
    const project = mkdtempSync(join(tmpdir(), "apparat-nofolder-"));
    try {
      const entries = listAllPipelines(project);
      expect(entries.every(e => e.origin === "bundled")).toBe(true);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});
