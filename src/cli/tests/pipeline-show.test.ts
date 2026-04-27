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
});
