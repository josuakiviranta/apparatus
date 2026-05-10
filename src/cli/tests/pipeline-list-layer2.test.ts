import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
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
