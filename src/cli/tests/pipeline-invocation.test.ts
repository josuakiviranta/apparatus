import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, chmodSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import {
  loadPipeline,
  PipelineLoadError,
} from "../commands/pipeline-invocation.js";

const GOOD_DOT = `digraph g {
  start [label="start"];
  done [label="done"];
  start -> done;
}`;

const SYNTAX_DOT = `digraph g { start [label= ;`;

const VALIDATION_DOT = `digraph g {
  orphan [label="orphan"];
}`;

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "pipeline-invocation-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("loadPipeline", () => {
  it("loads a clean .dot file and returns the graph + diagnostics", async () => {
    const dotPath = join(tmp, "good.dot");
    writeFileSync(dotPath, GOOD_DOT, "utf8");
    const result = await loadPipeline(dotPath);
    expect(result.graph).toBeDefined();
    expect(result.src).toContain("digraph");
    expect(result.absPath).toBe(resolve(dotPath));
    expect(result.relPath).toBeTruthy();
    expect(result.projectRoot).toBe(resolve(process.cwd()));
    expect(Array.isArray(result.diagnostics)).toBe(true);
  });

  it("uses opts.project as projectRoot", async () => {
    const dotPath = join(tmp, "good.dot");
    writeFileSync(dotPath, GOOD_DOT, "utf8");
    const project = mkdtempSync(join(tmpdir(), "proj-"));
    try {
      const result = await loadPipeline(dotPath, { project });
      expect(result.projectRoot).toBe(resolve(project));
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  it("throws PipelineLoadError with kind=not-found for missing file", async () => {
    const missing = join(tmp, "nope.dot");
    await expect(loadPipeline(missing)).rejects.toMatchObject({
      kind: "not-found",
    });
    await expect(loadPipeline(missing)).rejects.toBeInstanceOf(PipelineLoadError);
  });

  it("throws PipelineLoadError with kind=syntax + diagnostic for parse error", async () => {
    const dotPath = join(tmp, "bad.dot");
    writeFileSync(dotPath, SYNTAX_DOT, "utf8");
    try {
      await loadPipeline(dotPath);
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(PipelineLoadError);
      const err = e as PipelineLoadError;
      expect(err.kind).toBe("syntax");
      expect(err.diagnostic).toBeDefined();
      expect(err.diagnostic?.severity).toBe("error");
    }
  });

  it("returns validation diagnostics WITHOUT throwing", async () => {
    const dotPath = join(tmp, "validation.dot");
    writeFileSync(dotPath, VALIDATION_DOT, "utf8");
    const result = await loadPipeline(dotPath);
    expect(result.graph).toBeDefined();
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
