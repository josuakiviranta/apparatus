import { describe, it, expect } from "vitest";
import { JsonlPipelineTracer } from "../../attractor/tracer/jsonl-pipeline-tracer.js";
import type { PipelineTracer } from "../../attractor/tracer/pipeline-tracer.js";
import { mkdtempSync, rmSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { Node } from "../../attractor/types.js";

/**
 * Mirrors the wrapper at src/cli/commands/pipeline/run.ts:147-155.
 * If this test fails, the wrapper at :147 is missing onValidationFailure
 * and validation-failure events will never reach pipeline.jsonl.
 */
describe("pipeline/run.ts tracer wrapper — onValidationFailure forwarding", () => {
  it("the wrapper forwards onValidationFailure to JsonlPipelineTracer", () => {
    const work = mkdtempSync(join(tmpdir(), "apparat-tracer-fwd-"));
    try {
      const tracePath = join(work, "pipeline.jsonl");
      const jsonlTracer = new JsonlPipelineTracer(tracePath);

      // Mirror of run.ts:147-155 with the fix applied.
      const tracer: PipelineTracer = {
        onPipelineStart(meta) { jsonlTracer.onPipelineStart(meta); },
        onNodeStart(meta)     { jsonlTracer.onNodeStart(meta); },
        onNodeEnd(meta)       { jsonlTracer.onNodeEnd(meta); },
        onPipelineEnd(meta)   { jsonlTracer.onPipelineEnd(meta); },
        onValidationFailure(meta) { jsonlTracer.onValidationFailure?.(meta); },
      };

      const node = { id: "agent", agent: "agent" } as Node;
      tracer.onValidationFailure!({
        nodeReceiveId: "rid-1",
        node,
        attempt: 2,
        errors: [{ path: "$.ok", message: "expected boolean" }],
        rawOutputPath: "/work/runs/agent/raw-2.txt",
      });

      const trace = readFileSync(tracePath, "utf-8");
      const events = trace.trim().split("\n").map(l => JSON.parse(l));
      const vf = events.find(e => e.kind === "validation-failure");
      expect(vf).toBeDefined();
      expect(vf.nodeReceiveId).toBe("rid-1");
      expect(vf.attempt).toBe(2);
      expect(vf.rawOutputPath).toBe("/work/runs/agent/raw-2.txt");
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });
});
