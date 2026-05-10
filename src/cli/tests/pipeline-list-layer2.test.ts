import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const logs: string[] = [];

vi.mock("../lib/output.js", () => ({
  info: vi.fn(async (msg: string) => { logs.push(String(msg)); }),
  step: vi.fn(async (msg: string) => { logs.push(String(msg)); }),
  warn: vi.fn(async (msg: string) => { logs.push(String(msg)); }),
  error: vi.fn(async (msg: string) => { logs.push(String(msg)); }),
  success: vi.fn(async (msg: string) => { logs.push(String(msg)); }),
  header: vi.fn(async () => {}),
  spinner: vi.fn(async (_label: string, fn: () => Promise<unknown>) => fn()),
  stream: vi.fn(async () => {}),
}));

import { pipelineListCommand } from "../commands/pipeline/list.js";

beforeEach(() => { logs.length = 0; });

function makeProject(): string {
  const project = mkdtempSync(join(tmpdir(), "apparat-list-layer2-"));
  // Layer-1 fixture: one local pipeline.
  const pipelinesDir = join(project, ".apparat", "pipelines", "meditate");
  mkdirSync(pipelinesDir, { recursive: true });
  writeFileSync(
    join(pipelinesDir, "pipeline.dot"),
    'digraph meditate { goal="Generate illuminations"; start [shape=Mdiamond]; done [shape=Msquare]; start -> done; }\n',
  );
  return project;
}

describe("pipeline list — Layer 1 (no positional)", () => {
  it("renders the Local + Bundled section headers and the meditate row unchanged", async () => {
    const project = makeProject();
    await pipelineListCommand({ project });
    const out = logs.join("\n");
    expect(out).toMatch(/Local pipelines:/);
    expect(out).toMatch(/Bundled pipelines:/);
    expect(out).toMatch(/meditate.*"Generate illuminations"/);
    rmSync(project, { recursive: true, force: true });
  });
});

function seedRun(project: string, runId: string, pipelineName: string, opts: {
  outcome?: "success" | "failure";
  failedNodeId?: string;
  startedAt?: string;
  endedAt?: string;
}): void {
  const dir = join(project, ".apparat", "runs", runId);
  mkdirSync(dir, { recursive: true });
  const startedAt = opts.startedAt ?? "2026-05-09T19:30:00.000Z";
  const endedAt = opts.endedAt ?? "2026-05-09T19:30:12.400Z";
  const events: Array<Record<string, unknown>> = [
    { kind: "pipeline-start", runId, pipelineName, goal: "g", nodes: [], timestamp: startedAt },
  ];
  if (opts.outcome === "failure") {
    events.push({ kind: "node-end", nodeReceiveId: "x-1", nodeId: opts.failedNodeId ?? "classifier", success: false, contextUpdates: {} });
    events.push({ kind: "pipeline-end", runId, outcome: "failure", timestamp: endedAt });
  } else if (opts.outcome === "success") {
    events.push({ kind: "pipeline-end", runId, outcome: "success", timestamp: endedAt });
  }
  // outcome undefined → in-progress (omit pipeline-end).
  writeFileSync(join(dir, "pipeline.jsonl"), events.map(e => JSON.stringify(e)).join("\n") + "\n");
}

describe("pipeline list <name> — Layer 2 (positional)", () => {
  it("renders a recent-runs sub-table newest-first with outcome glyphs and trace hints", async () => {
    const project = makeProject();
    seedRun(project, "meditate-aaaaaaaa", "meditate", { outcome: "success", startedAt: "2026-05-09T19:30:00.000Z", endedAt: "2026-05-09T19:30:12.400Z" });
    seedRun(project, "meditate-bbbbbbbb", "meditate", { outcome: "failure", failedNodeId: "classifier", startedAt: "2026-05-09T18:12:00.000Z", endedAt: "2026-05-09T18:12:04.100Z" });
    seedRun(project, "meditate-cccccccc", "meditate", { startedAt: "2026-05-09T20:00:00.000Z" }); // in-progress

    await pipelineListCommand({ project, name: "meditate" });

    const out = logs.join("\n");
    expect(out).toMatch(/Local pipelines:/);
    expect(out).toMatch(/meditate.*"Generate illuminations"/);
    expect(out).toMatch(/recent runs:/);
    // Newest in-progress on top.
    const idx = (s: string) => out.indexOf(s);
    expect(idx("meditate-cccccccc")).toBeGreaterThan(-1);
    expect(idx("meditate-cccccccc")).toBeLessThan(idx("meditate-aaaaaaaa"));
    expect(idx("meditate-aaaaaaaa")).toBeLessThan(idx("meditate-bbbbbbbb"));
    // Outcome glyphs.
    expect(out).toMatch(/✓\s+meditate-aaaaaaaa/);
    expect(out).toMatch(/✗\s+meditate-bbbbbbbb/);
    expect(out).toMatch(/…\s+meditate-cccccccc/);
    // Failed-node tail on the failure row.
    expect(out).toMatch(/failed at: classifier/);
    // Copy-paste trace hint on every row.
    expect(out).toMatch(/→ apparat pipeline trace meditate-aaaaaaaa/);
    expect(out).toMatch(/→ apparat pipeline trace meditate-bbbbbbbb/);
    expect(out).toMatch(/→ apparat pipeline trace meditate-cccccccc/);
    rmSync(project, { recursive: true, force: true });
  });

  it("prints `recent runs: (none)` when no runs exist for the named pipeline", async () => {
    const project = makeProject();
    await pipelineListCommand({ project, name: "meditate" });
    const out = logs.join("\n");
    expect(out).toMatch(/recent runs:\s*\(none\)/);
    rmSync(project, { recursive: true, force: true });
  });

  it("exits 1 when the pipeline name is unknown", async () => {
    const project = makeProject();
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((c?: number) => { throw new Error(`exit:${c}`); }) as any);
    const errs: string[] = [];
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(((s: string | Uint8Array) => {
      errs.push(typeof s === "string" ? s : Buffer.from(s).toString("utf8"));
      return true;
    }) as any);
    try {
      await expect(pipelineListCommand({ project, name: "no-such-pipeline" })).rejects.toThrow(/exit:1/);
    } finally {
      exitSpy.mockRestore();
      errSpy.mockRestore();
    }
    expect(errs.join("")).toMatch(/pipeline not found: no-such-pipeline/);
    rmSync(project, { recursive: true, force: true });
  });

  it("matches old bare-id directories whose JSONL still carries pipelineName=meditate", async () => {
    const project = makeProject();
    seedRun(project, "deadbeef", "meditate", { outcome: "success", startedAt: "2026-05-09T17:00:00.000Z", endedAt: "2026-05-09T17:00:01.000Z" });
    await pipelineListCommand({ project, name: "meditate" });
    const out = logs.join("\n");
    expect(out).toMatch(/✓\s+deadbeef/);
    expect(out).toMatch(/→ apparat pipeline trace deadbeef/);
    rmSync(project, { recursive: true, force: true });
  });
});
