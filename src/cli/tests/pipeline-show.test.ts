import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

vi.mock("../lib/output.js", () => ({
  error: vi.fn(async () => {}),
  warn: vi.fn(async () => {}),
  success: vi.fn(async () => {}),
  info: vi.fn(async () => {}),
  step: vi.fn(async () => {}),
  stream: vi.fn(async () => {}),
}));

import { pipelineShowCommand } from "../commands/pipeline.js";
import * as out from "../lib/output.js";

describe("pipelineShowCommand", () => {
  let dir: string;
  beforeEach(() => {
    vi.clearAllMocks();
    dir = mkdtempSync(join(tmpdir(), "ralph-pipeline-show-test-"));
  });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("returns 1 and writes no SVG when the dot file is missing", async () => {
    const missing = join(dir, "missing.dot");
    const code = await pipelineShowCommand(missing);
    expect(code).toBe(1);
    expect(out.error).toHaveBeenCalled();
    const errorMsg = (out.error as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0] as string;
    expect(errorMsg).toMatch(/Dot file not found/);
    expect(readdirSync(dir).filter(f => f.endsWith(".svg"))).toEqual([]);
  });

  it("returns 1 with a [syntax] diagnostic and writes no SVG when DOT is malformed", async () => {
    const dotFile = join(dir, "broken.dot");
    // Truncated arrow — the AST parser in `parseDotV2` raises DotSyntaxError.
    const { writeFileSync } = await import("fs");
    writeFileSync(dotFile, `digraph g {\n  start [shape=Mdiamond]\n  start -> \n}`);
    const code = await pipelineShowCommand(dotFile);
    expect(code).toBe(1);
    const errorCalls = (out.error as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const combined = errorCalls.map(c => c[0] as string).join("\n");
    expect(combined).toContain("[syntax]");
    expect(readdirSync(dir).filter(f => f.endsWith(".svg"))).toEqual([]);
  });

  it("returns 1 with file:line:col diagnostic and writes no SVG when validation fails", async () => {
    const dotFile = join(dir, "missing-exit.dot");
    const { writeFileSync } = await import("fs");
    // Missing exit (Msquare) — validateGraph emits a `terminal_node` error.
    writeFileSync(dotFile, `digraph g {\n  start [shape=Mdiamond]\n}`);
    const code = await pipelineShowCommand(dotFile);
    expect(code).toBe(1);
    const errorCalls = (out.error as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(errorCalls.length).toBeGreaterThan(0);
    expect(readdirSync(dir).filter(f => f.endsWith(".svg"))).toEqual([]);
  });
});
