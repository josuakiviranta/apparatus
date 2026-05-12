import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipelineTraceCommand } from "../commands/pipeline.js";
import { runDir } from "../lib/apparat-paths.js";
import * as output from "../lib/output.js";

describe("pipeline trace --node-receive surfaces validation attempts", () => {
  const logs: string[] = [];
  const origLog = console.log;
  beforeEach(() => { logs.length = 0; });
  beforeAll(() => { console.log = (...a: unknown[]) => logs.push(a.map(String).join(" ")); });
  afterAll(() => { console.log = origLog; });

  it("prints validation-failure events keyed by nodeReceiveId", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "trace-"));
    const traceDir = runDir(projectRoot, "r1");
    mkdirSync(traceDir, { recursive: true });
    const tracePath = join(traceDir, "pipeline.jsonl");

    const lines = [
      { kind: "pipeline-start", runId: "r1", pipelineName: "p", nodes: ["start","verifier"], timestamp: "" },
      { kind: "node-start", nodeReceiveId: "verifier-1", nodeId: "verifier", nodeKind: "agent", timestamp: "", contextSnapshot: { foo: "bar" } },
      { kind: "validation-failure", nodeReceiveId: "verifier-1", nodeId: "verifier", attempt: 1, errors: [{ path: "preferred_label", message: "Required" }], rawOutputPath: "verifier/raw-attempt-1.txt", timestamp: "" },
      { kind: "node-end", nodeReceiveId: "verifier-1", nodeId: "verifier", success: false, contextUpdates: {} },
      { kind: "pipeline-end", runId: "r1", outcome: "failure", timestamp: "" },
    ];
    writeFileSync(tracePath, lines.map(l => JSON.stringify(l)).join("\n"));

    await pipelineTraceCommand("r1", { project: projectRoot, nodeReceive: "verifier-1" });

    const out = logs.join("\n");
    expect(out).toMatch(/validation attempts:/);
    expect(out).toMatch(/\[1\] ✗ failed — preferred_label: Required/);
    expect(out).toMatch(/raw: verifier\/raw-attempt-1\.txt/);
  });

  it("prints `prompt: <runDir>/<nodeId>/prompt.md` after `received:` when the file exists", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "trace-prompt-"));
    const traceDir = runDir(projectRoot, "r2");
    mkdirSync(traceDir, { recursive: true });
    const tracePath = join(traceDir, "pipeline.jsonl");

    // Drop a real prompt.md under <runDir>/<nodeId>/ so existsSync passes.
    const nodeDir = join(traceDir, "verifier");
    mkdirSync(nodeDir, { recursive: true });
    const promptPath = join(nodeDir, "prompt.md");
    writeFileSync(promptPath, "PROMPT BODY");

    const lines = [
      { kind: "pipeline-start", runId: "r2", pipelineName: "p", nodes: ["start","verifier"], timestamp: "" },
      { kind: "node-start", nodeReceiveId: "verifier-1", nodeId: "verifier", nodeKind: "agent", timestamp: "T0", contextSnapshot: { foo: "bar" } },
      { kind: "node-end", nodeReceiveId: "verifier-1", nodeId: "verifier", success: true, contextUpdates: {} },
      { kind: "pipeline-end", runId: "r2", outcome: "success", timestamp: "" },
    ];
    writeFileSync(tracePath, lines.map(l => JSON.stringify(l)).join("\n"));

    await pipelineTraceCommand("r2", { project: projectRoot, nodeReceive: "verifier-1" });

    const out = logs.join("\n");
    expect(out).toMatch(/received: T0/);
    expect(out).toMatch(new RegExp(`prompt:\\s+${promptPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  });

  it("omits the `prompt:` line when prompt.md is missing (lazy prune)", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "trace-prompt-"));
    const traceDir = runDir(projectRoot, "r3");
    mkdirSync(traceDir, { recursive: true });
    const tracePath = join(traceDir, "pipeline.jsonl");
    const lines = [
      { kind: "pipeline-start", runId: "r3", pipelineName: "p", nodes: ["start","verifier"], timestamp: "" },
      { kind: "node-start", nodeReceiveId: "verifier-1", nodeId: "verifier", nodeKind: "agent", timestamp: "T0", contextSnapshot: {} },
      { kind: "node-end", nodeReceiveId: "verifier-1", nodeId: "verifier", success: true, contextUpdates: {} },
      { kind: "pipeline-end", runId: "r3", outcome: "success", timestamp: "" },
    ];
    writeFileSync(tracePath, lines.map(l => JSON.stringify(l)).join("\n"));

    await pipelineTraceCommand("r3", { project: projectRoot, nodeReceive: "verifier-1" });

    const out = logs.join("\n");
    expect(out).toMatch(/received: T0/);
    expect(out).not.toMatch(/prompt:\s/);
  });

  it("emits an ADR-0015 hint line when the trace is missing", async () => {
    const errors: string[] = [];
    const errSpy = vi.spyOn(output, "error").mockImplementation(async (msg: string) => {
      errors.push(msg);
    });
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code ?? 0}`);
    }) as never);

    const tmp = mkdtempSync(join(tmpdir(), "apparat-trace-hint-"));
    try {
      await expect(pipelineTraceCommand("ghost-runid", { project: tmp })).rejects.toThrow(/exit:1/);
      expect(errors.some(l => l.includes("ADR-0015"))).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
      errSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });
});
