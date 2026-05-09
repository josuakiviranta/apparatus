import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../lib/output.js", () => ({
  error: vi.fn(async () => {}),
  warn: vi.fn(async () => {}),
  success: vi.fn(async () => {}),
  info: vi.fn(async () => {}),
  step: vi.fn(async () => {}),
  stream: vi.fn(async () => {}),
}));

import { pipelineExplainCommand } from "../commands/pipeline/explain.js";
import * as out from "../lib/output.js";

const logs: string[] = [];
const origLog = console.log;
beforeAll(() => { console.log = (...a: unknown[]) => logs.push(a.map(String).join(" ")); });
afterAll(() => { console.log = origLog; });
beforeEach(() => { logs.length = 0; vi.clearAllMocks(); });

function writeAgent(dir: string, name: string, frontmatter: string, body: string) {
  writeFileSync(
    join(dir, `${name}.md`),
    `---\n${frontmatter}\n---\n${body}\n`,
  );
}

function makeProject(): { project: string; pipelineDir: string } {
  const project = mkdtempSync(join(tmpdir(), "apparat-explain-"));
  const pipelineDir = join(project, ".apparat", "pipelines", "demo");
  mkdirSync(pipelineDir, { recursive: true });
  return { project, pipelineDir };
}

describe("pipelineExplainCommand — topology mode", () => {
  it("prints per-node consumes/produces/branches/next for a small fixture", async () => {
    const { project, pipelineDir } = makeProject();
    try {
      writeFileSync(join(pipelineDir, "pipeline.dot"), `digraph demo {
  goal="demo"
  start    [shape=Mdiamond]
  drafter  [agent="drafter"]
  done     [shape=Msquare]

  start -> drafter -> done
}
`);
      writeAgent(pipelineDir, "drafter",
        `name: drafter\ndescription: drafts text\nmodel: opus\ninputs: []\noutputs:\n  text: string`,
        "Draft a short text.");

      const code = await pipelineExplainCommand("demo", undefined, { project });
      expect(code).toBe(0);
      const text = logs.join("\n");

      expect(text).toMatch(/Pipeline:\s*demo/);
      expect(text).toMatch(/start\s+kind=start/);
      expect(text).toMatch(/drafter\s+kind=agent/);
      expect(text).toMatch(/produces:\s*drafter\.text/);
      expect(text).toMatch(/done\s+kind=exit/);
      expect(text).toMatch(/Reachability:/);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  it("enumerates gate branches by edge label", async () => {
    const { project, pipelineDir } = makeProject();
    try {
      writeFileSync(join(pipelineDir, "pipeline.dot"), `digraph demo {
  goal="g"
  start [shape=Mdiamond]
  approval [shape=hexagon]
  worker   [agent="worker"]
  done     [shape=Msquare]

  start -> approval
  approval -> worker [label="Approve"]
  approval -> done   [label="Decline"]
  worker   -> done
}
`);
      writeAgent(pipelineDir, "approval",
        `type: gate\nchoices: ["Approve", "Decline"]`,
        "Approve?");
      writeAgent(pipelineDir, "worker",
        `name: worker\ndescription: works\nmodel: opus\ninputs: []\noutputs:\n  result: string`,
        "Do the thing.");

      const code = await pipelineExplainCommand("demo", undefined, { project });
      expect(code).toBe(0);
      const text = logs.join("\n");
      expect(text).toMatch(/approval\s+kind=gate/);
      expect(text).toMatch(/branches:.*Approve.*worker.*Decline.*done/);
      expect(text).toMatch(/produces:\s*approval\.choice/);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  it("populates the Loops section when a back-edge exists", async () => {
    const { project, pipelineDir } = makeProject();
    try {
      writeFileSync(join(pipelineDir, "pipeline.dot"), `digraph demo {
  goal="g"
  start  [shape=Mdiamond]
  worker [agent="worker"]
  done   [shape=Msquare]

  start  -> worker
  worker -> worker [condition="agent.success=false"]
  worker -> done   [condition="agent.success=true"]
}
`);
      writeAgent(pipelineDir, "worker",
        `name: worker\ndescription: loops\nmodel: opus\nloop: true\ninputs: []\noutputs:\n  done: boolean`,
        "Loop until done.");

      const code = await pipelineExplainCommand("demo", undefined, { project });
      expect(code).toBe(0);
      const text = logs.join("\n");
      expect(text).toMatch(/Loops:/);
      expect(text).toMatch(/worker\s*->\s*worker/);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  it("returns 1 and prints diagnostics when the pipeline has validation errors", async () => {
    const { project, pipelineDir } = makeProject();
    try {
      // Missing exit (Msquare) → terminal_node error.
      writeFileSync(join(pipelineDir, "pipeline.dot"), `digraph demo {
  start [shape=Mdiamond]
}
`);
      const code = await pipelineExplainCommand("demo", undefined, { project });
      expect(code).toBe(1);
      expect(out.error).toHaveBeenCalled();
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  it("prints plain ASCII when FORCE_COLOR=0 (no ANSI escapes)", async () => {
    const prev = process.env.FORCE_COLOR;
    process.env.FORCE_COLOR = "0";
    const { project, pipelineDir } = makeProject();
    try {
      writeFileSync(join(pipelineDir, "pipeline.dot"), `digraph demo {
  goal="g"
  start [shape=Mdiamond]
  done  [shape=Msquare]
  start -> done
}
`);
      const code = await pipelineExplainCommand("demo", undefined, { project });
      expect(code).toBe(0);
      const text = logs.join("\n");
      // ANSI escape sequence is ESC[ … any letter
      expect(/\x1b\[/.test(text)).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.FORCE_COLOR; else process.env.FORCE_COLOR = prev;
      rmSync(project, { recursive: true, force: true });
    }
  });
});

describe("pipelineExplainCommand — node-zoom mode", () => {
  it("renders the agent's prompt skeleton with <placeholder:…> values inside the runtime <renderedTag> shape", async () => {
    const { project, pipelineDir } = makeProject();
    try {
      writeFileSync(join(pipelineDir, "pipeline.dot"), `digraph demo {
  goal="g"
  inputs="illumination_path"
  start    [shape=Mdiamond]
  verifier [agent="verifier"]
  done     [shape=Msquare]
  start -> verifier -> done
}
`);
      writeAgent(pipelineDir, "verifier",
        `name: verifier\ndescription: verifies\nmodel: opus\ninputs:\n  - illumination_path\noutputs:\n  summary: string`,
        "Verify the illumination at <illumination_path>.");

      const code = await pipelineExplainCommand("demo", "verifier", { project });
      expect(code).toBe(0);
      const text = logs.join("\n");
      expect(text).toContain("## Inputs");
      expect(text).toContain("<illumination_path><placeholder:illumination_path></illumination_path>");
      expect(text).toContain("Verify the illumination at <illumination_path>.");
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  it("renders qualified inputs with the underscore-mangled tag (verifier.summary → <verifier_summary>)", async () => {
    const { project, pipelineDir } = makeProject();
    try {
      writeFileSync(join(pipelineDir, "pipeline.dot"), `digraph demo {
  goal="g"
  start    [shape=Mdiamond]
  verifier [agent="verifier"]
  refiner  [agent="refiner"]
  done     [shape=Msquare]
  start -> verifier -> refiner -> done
}
`);
      writeAgent(pipelineDir, "verifier",
        `name: verifier\ndescription: v\nmodel: opus\ninputs: []\noutputs:\n  summary: string`,
        "Verify.");
      writeAgent(pipelineDir, "refiner",
        `name: refiner\ndescription: r\nmodel: opus\ninputs:\n  - verifier.summary\noutputs:\n  refined: string`,
        "Refine the summary.");

      const code = await pipelineExplainCommand("demo", "refiner", { project });
      expect(code).toBe(0);
      const text = logs.join("\n");
      expect(text).toContain("<verifier_summary><placeholder:verifier.summary></verifier_summary>");
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  it("returns 1 with available-nodes list when the node id is missing", async () => {
    const { project, pipelineDir } = makeProject();
    try {
      writeFileSync(join(pipelineDir, "pipeline.dot"), `digraph demo {
  goal="g"
  start [shape=Mdiamond]
  done  [shape=Msquare]
  start -> done
}
`);
      const code = await pipelineExplainCommand("demo", "nonexistent", { project });
      expect(code).toBe(1);
      const errCalls = (out.error as unknown as { mock: { calls: unknown[][] } }).mock.calls;
      const combined = errCalls.map(c => c[0] as string).join("\n");
      expect(combined).toMatch(/nonexistent/);
      expect(combined).toMatch(/available:.*start.*done|available:.*done.*start/);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  it("returns 1 when asked to zoom into a non-agent node", async () => {
    const { project, pipelineDir } = makeProject();
    try {
      writeFileSync(join(pipelineDir, "pipeline.dot"), `digraph demo {
  goal="g"
  start [shape=Mdiamond]
  approval [shape=hexagon]
  done  [shape=Msquare]
  start -> approval
  approval -> done [label="Approve"]
  approval -> done [label="Decline"]
}
`);
      writeAgent(pipelineDir, "approval",
        `type: gate\nchoices: ["Approve", "Decline"]`,
        "Approve?");

      const code = await pipelineExplainCommand("demo", "approval", { project });
      expect(code).toBe(1);
      const errCalls = (out.error as unknown as { mock: { calls: unknown[][] } }).mock.calls;
      const combined = errCalls.map(c => c[0] as string).join("\n");
      expect(combined).toMatch(/kind=gate/);
      expect(combined).toMatch(/agent nodes/);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});
