import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonlPipelineTracer } from "../tracer/jsonl-pipeline-tracer.js";

describe("JsonlPipelineTracer.onValidationFailure", () => {
  it("emits a validation-failure event line", () => {
    const dir = mkdtempSync(join(tmpdir(), "tracer-"));
    const path = join(dir, "pipeline.jsonl");
    const t = new JsonlPipelineTracer(path);
    const fakeNode = { id: "verifier" } as any;
    t.onValidationFailure!({
      nodeReceiveId: "verifier-734e",
      node: fakeNode,
      attempt: 1,
      errors: [{ path: "preferred_label", message: "Required" }],
      rawOutputPath: "verifier/raw-attempt-1.txt",
    });
    const lines = readFileSync(path, "utf8").trim().split("\n");
    const evt = JSON.parse(lines[lines.length - 1]);
    expect(evt.kind).toBe("validation-failure");
    expect(evt.nodeReceiveId).toBe("verifier-734e");
    expect(evt.nodeId).toBe("verifier");
    expect(evt.attempt).toBe(1);
    expect(evt.errors[0]).toMatchObject({ path: "preferred_label" });
    expect(evt.rawOutputPath).toBe("verifier/raw-attempt-1.txt");
    expect(typeof evt.timestamp).toBe("string");
  });
});
