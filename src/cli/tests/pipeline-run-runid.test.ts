import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { rmSync } from "fs";
import { pipelineRunCommand } from "../commands/pipeline/run.js";

afterEach(() => vi.restoreAllMocks());

describe("pipelineRunCommand --run-id override", () => {
  it("uses opts.runId instead of allocating a fresh one", async () => {
    const project = mkdtempSync(join(tmpdir(), "apparat-runid-"));
    const dotFile = join(project, "smoke.dot");
    writeFileSync(
      dotFile,
      'digraph smoke { goal="t"; start [shape=Mdiamond]; done [shape=Msquare]; start -> done; }\n',
    );
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((c?: number) => { throw new Error(`exit:${c}`); }) as any);
    try {
      await pipelineRunCommand(dotFile, { project, runId: "deadbeef" });
    } catch {} finally { exitSpy.mockRestore(); }
    const tracePath = join(project, ".apparat", "runs", "deadbeef", "pipeline.jsonl");
    expect(existsSync(tracePath)).toBe(true);
    rmSync(project, { recursive: true, force: true });
  });
});
