# `apparat pipeline explain` — Prompt-Assembly Visibility Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `apparat pipeline explain <pipeline> [nodeId]` (topology + node-zoom prompt-skeleton render with placeholders), one extra `prompt:` line in `pipeline trace --node-receive`, a pure-core `buildAgentPrompt` extract behind the existing `assembleAgentPrompt` wrapper, and a `<renderedTag>` doc paragraph in `pipelines.md` — all additive, no breaking changes.

**Architecture:** (1) Split `assembleAgentPrompt` (`src/attractor/handlers/agent-prep.ts:37-102`) into a pure `buildAgentPrompt` core plus a thin runtime wrapper that retains the `mkdirSync`/`writeFileSync`. (2) New `src/cli/commands/pipeline/explain.ts` reuses `loadPipeline` + `buildAgentPrompt` to render either a plain-text topology walkthrough (bare invocation) or a single-node prompt skeleton with `<placeholder:…>` values (with-node invocation). (3) `pipeline trace --node-receive` adds one `prompt:` line guarded by `existsSync`. (4) Document the `<sourceNode>_<localKey>` tag-mangling rule in `src/cli/skills/apparatus/pipelines.md` §3 plus matching one-liners in `SKILL.md` and `README.md`.

**Tech Stack:** TypeScript (Node.js), commander, vitest, the existing attractor engine (`parseDot`, `validateGraph`, `flow-analyzer`, `inputs-resolver`, `inputs-renderer`, `agent-loader`).

**Source-of-truth design doc:** `docs/superpowers/specs/2026-05-09-prompt-assembly-invisible-until-runtime-design.md`.

**Originating illumination:** `.apparat/meditations/illuminations/2026-05-07T2008-prompt-assembly-invisible-until-runtime.md`.

---

## Chunk 1: Pure-core `buildAgentPrompt` extract

**Why this chunk first:** Both `pipeline explain <p> <nodeId>` (Chunk 2) and the runtime wrapper need a pure prompt-builder that does no `mkdirSync` / `writeFileSync`. Extracting the seam first lets Chunk 2 simply import `buildAgentPrompt` and pass synthetic placeholder context. Runtime behaviour is byte-identical: the extracted core builds the same string the wrapper writes to `prompt.md` today.

**Files:**
- Modify: `src/attractor/handlers/agent-prep.ts` (split `assembleAgentPrompt:37-102` into `buildAgentPrompt` pure core + `assembleAgentPrompt` wrapper; preserve five-arg signature)
- Modify: `src/attractor/tests/agent-prep.test.ts` (add `buildAgentPrompt` cases; existing `assembleAgentPrompt` cases stay green unchanged)

### Task 1.1 — Failing test: `buildAgentPrompt` returns a `BuiltPrompt` with no `prompt.md` written

- [x] **Step 1.1.1: Append the failing test to `src/attractor/tests/agent-prep.test.ts`**

Append a second `describe` block at the bottom of the existing file. Reuse the existing top-of-file imports (`mkdtempSync, rmSync, readFileSync` from `fs`, `tmpdir`, `join`, `assembleAgentPrompt`, `Node`, `PipelineContext`, `HandlerExecutionContext`) and the existing `makeConfig` / `makeMeta` helpers — they are already in scope. Add `buildAgentPrompt` to the existing `agent-prep.js` import line and `existsSync` to the existing `fs` import line:

```ts
// (extend the existing imports at the top of the file)
import { mkdtempSync, rmSync, readFileSync, existsSync } from "fs";
import { assembleAgentPrompt, buildAgentPrompt } from "../handlers/agent-prep.js";

describe("buildAgentPrompt", () => {
  it("returns BuiltPrompt and does NOT write prompt.md to nodeDir", () => {
    const tmp = mkdtempSync(join(tmpdir(), "apparat-build-"));
    try {
      const cfg = makeConfig();
      const node: Node = { id: "n1", prompt: "STEERING", agent: "fake" };
      const ctx: PipelineContext = { values: {} };
      const meta = makeMeta(tmp, tmp);

      const built = buildAgentPrompt(node, ctx, meta, () => cfg);

      expect("fail" in built).toBe(false);
      const ok = built as Exclude<typeof built, { fail: string }>;
      expect(ok.prompt).toContain("AGENT INSTRUCTIONS");
      expect(ok.prompt).toContain("STEERING");
      expect(ok.nodeDir).toBe(join(tmp, "n1"));

      // The pure core MUST NOT touch the filesystem.
      expect(existsSync(join(ok.nodeDir, "prompt.md"))).toBe(false);
      expect(existsSync(ok.nodeDir)).toBe(false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("returns identical `prompt` bytes as assembleAgentPrompt for the same inputs", () => {
    const tmp = mkdtempSync(join(tmpdir(), "apparat-parity-"));
    try {
      const cfg = makeConfig();
      const node: Node = { id: "n1", prompt: "STEERING", agent: "fake" };
      const ctx: PipelineContext = { values: {} };
      const meta = makeMeta(tmp, tmp);

      const built = buildAgentPrompt(node, ctx, meta, () => cfg);
      const prep = assembleAgentPrompt(node, ctx, meta, () => cfg, () => ({} as any));

      expect("fail" in built).toBe(false);
      expect("fail" in prep).toBe(false);
      const builtOk = built as Exclude<typeof built, { fail: string }>;
      const prepOk = prep as Exclude<typeof prep, { fail: string }>;

      expect(builtOk.prompt).toBe(prepOk.prompt);
      expect(builtOk.nodeDir).toBe(prepOk.nodeDir);
      expect(builtOk.jsonSchema).toBe(prepOk.jsonSchema);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("returns { fail } when load throws", () => {
    const tmp = mkdtempSync(join(tmpdir(), "apparat-build-"));
    try {
      const node: Node = { id: "n1", agent: "missing" };
      const ctx: PipelineContext = { values: {} };
      const meta = makeMeta(tmp, tmp);

      const built = buildAgentPrompt(
        node, ctx, meta,
        () => { throw new Error("agent file not found"); },
      );

      expect("fail" in built).toBe(true);
      if ("fail" in built) {
        expect(built.fail).toMatch(/Failed to resolve agent "missing"/);
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
```

- [x] **Step 1.1.2: Run the new tests and confirm they fail**

Run:

```
npx vitest run src/attractor/tests/agent-prep.test.ts -t "buildAgentPrompt"
```

Expected: 3 failing tests with errors like `buildAgentPrompt is not a function` (or TS compile error referencing the missing export). The existing `assembleAgentPrompt` cases must still pass — verify by running the unfiltered file at the end of this step:

```
npx vitest run src/attractor/tests/agent-prep.test.ts
```

Expected: 3 fails (the new cases), 3 passes (the original cases).

### Task 1.2 — Implement `buildAgentPrompt` + slim `assembleAgentPrompt`

**Files:**
- Modify: `src/attractor/handlers/agent-prep.ts` (the whole file)

- [x] **Step 1.2.1: Replace the body of `src/attractor/handlers/agent-prep.ts`**

Overwrite with the split implementation below. The five-arg signature of `assembleAgentPrompt` and the `PreparedAgent` shape are preserved verbatim — both existing call sites (`src/attractor/handlers/looping-agent-handler.ts:27`, `src/attractor/handlers/interactive-agent-handler.ts:26`) compile unchanged.

```ts
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import type { Node, PipelineContext, CheckpointState } from "../types.js";
import type { HandlerExecutionContext } from "./registry.js";
import { Agent, type AgentConfig } from "../../cli/lib/agent.js";
import { getIlluminationServerPath } from "../../cli/lib/assets.js";
import { buildPreamble } from "../transforms/preamble.js";
import { renderInputsBlock } from "../transforms/inputs-renderer.js";
import { extractDefaults } from "../transforms/variable-expansion.js";

/**
 * Keys auto-injected into every agent's variables by the pipeline engine.
 * Single source of truth: runtime (buildSystemInjectedVars) and graph validator
 * (bare_input_not_in_caller_inputs_or_system rule) both consume this.
 */
export const SYSTEM_INJECTED_VARS = [
  "ILLUMINATION_SERVER_PATH",
  "PROJECT_ROOT",
] as const;

function buildSystemInjectedVars(projectRoot: string): Record<(typeof SYSTEM_INJECTED_VARS)[number], string> {
  return {
    ILLUMINATION_SERVER_PATH: getIlluminationServerPath(),
    PROJECT_ROOT: projectRoot,
  };
}

export interface PreparedAgent {
  agent: Agent;
  config: AgentConfig;
  jsonSchema: string | undefined;
  agentVariables: Record<string, unknown>;
  prompt: string;
  nodeDir: string;
}

/**
 * Pure prompt-skeleton produced by `buildAgentPrompt`. Carries every piece
 * the runtime wrapper needs to instantiate an Agent and write `prompt.md`,
 * but performs no filesystem I/O itself beyond the caller-injected `load`.
 */
export interface BuiltPrompt {
  prompt: string;
  inputsBlock: string;
  jsonSchema: string | undefined;
  agentVariables: Record<string, unknown>;
  config: AgentConfig;
  /** Path the runtime would `mkdir`+write into. NOT created here. */
  nodeDir: string;
}

/**
 * Pure (modulo the caller-injected `load` reading the agent .md). Used by both
 * the runtime wrapper (`assembleAgentPrompt`) and design-time tools
 * (`apparat pipeline explain <pipeline> <nodeId>`).
 */
export function buildAgentPrompt(
  node: Node,
  ctx: PipelineContext,
  meta: HandlerExecutionContext,
  load: (name: string, pipelineDir: string) => AgentConfig,
): BuiltPrompt | { fail: string } {
  const agentName = node.agent ?? "implement";
  if (!agentName) {
    return { fail: "Node has no agent attribute" };
  }

  let config: AgentConfig;
  try {
    config = load(agentName, meta.dotDir);
  } catch (err) {
    return { fail: `Failed to resolve agent "${agentName}": ${(err as Error).message}` };
  }

  if (node.llmModel) config = { ...config, model: node.llmModel as string };

  const { logsRoot, cwd, completedNodes, nodeRetries } = meta;

  // Dev-mode tsx swap (see agent-handler.ts:71-76 for the original justification).
  if (typeof __APPARAT_PROD__ === "undefined") {
    config = {
      ...config,
      mcp: config.mcp.map((m) => (m.command === "node" ? { ...m, command: "tsx" } : m)),
    };
  }

  const agentVariables: Record<string, unknown> = {
    ...buildSystemInjectedVars(meta.projectDir ?? cwd),
    ...ctx.values,
  };

  const jsonSchema: string | undefined = config.jsonSchema;

  const nodeDir = join(logsRoot, node.id);
  const agentInstructions = (config.prompt ?? "").trim();

  const declaredInputs = (config.inputs as string[] | undefined) ?? [];
  const rawDefaults = extractDefaults(node as unknown as Record<string, unknown>);
  const nodeAttrs: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rawDefaults)) nodeAttrs[`default_${k}`] = v;
  const inputsBlock = renderInputsBlock(declaredInputs, ctx.values, nodeAttrs);
  const steeringRaw = (node.prompt ?? "").trim();
  const steeringBlock = steeringRaw ? `\n\n## Steering\n\n${steeringRaw}\n` : "";
  const assembledPrompt = `${agentInstructions}\n\n---\n\n${inputsBlock}${steeringBlock}`;

  const fidelity = (node.fidelity as string | undefined) ?? "compact";
  const preamble = buildPreamble(
    { timestamp: "", currentNode: node.id, completedNodes, nodeRetries, context: ctx.values } as CheckpointState,
    fidelity,
  );
  const jsonWrappedPrompt = jsonSchema
    ? `IMPORTANT: Your FINAL response MUST be valid JSON matching this schema. No markdown, no preamble, output ONLY the JSON object.\nSchema: ${jsonSchema}\n\n${assembledPrompt}\n\nREMINDER: Output MUST be valid JSON matching the schema above. No markdown, no explanation.`
    : assembledPrompt;
  const prompt = preamble + jsonWrappedPrompt;

  return { prompt, inputsBlock, jsonSchema, agentVariables, config, nodeDir };
}

/**
 * Runtime wrapper. Preserves today's exported signature exactly so the two
 * existing call sites (`looping-agent-handler.ts:27`, `interactive-agent-handler.ts:26`)
 * and the existing tests compile unchanged.
 */
export function assembleAgentPrompt(
  node: Node,
  ctx: PipelineContext,
  meta: HandlerExecutionContext,
  load: (name: string, pipelineDir: string) => AgentConfig,
  create: (config: AgentConfig) => Agent,
): PreparedAgent | { fail: string } {
  const built = buildAgentPrompt(node, ctx, meta, load);
  if ("fail" in built) return built;

  mkdirSync(built.nodeDir, { recursive: true });
  writeFileSync(join(built.nodeDir, "prompt.md"), built.prompt);

  const agent = create({
    ...built.config,
    prompt: built.prompt,
    ...(built.jsonSchema ? { jsonSchema: built.jsonSchema } : {}),
  });

  return {
    agent,
    config: built.config,
    jsonSchema: built.jsonSchema,
    agentVariables: built.agentVariables,
    prompt: built.prompt,
    nodeDir: built.nodeDir,
  };
}
```

Key correctness anchors vs. the pre-split file (lines reference the original `agent-prep.ts`):

- The dev-mode tsx swap (lines 61-66) stays inside `buildAgentPrompt` — the `pipeline explain` output must match what the runtime would assemble byte-for-byte.
- `nodeDir = join(logsRoot, node.id)` (line 75) is computed inside the pure core but the directory is **not** created there; only the wrapper creates and writes.
- `buildSystemInjectedVars(meta.projectDir ?? cwd)` (line 69) stays in the pure core.
- `renderInputsBlock(declaredInputs, ctx.values, nodeAttrs)` (line 83) stays in the pure core. This is the only place the `<renderedTag>` shape gets written into the assembled string.
- The wrapper does exactly two side effects: `mkdirSync` (was line 76) and `writeFileSync` (was line 97). The `create()` call (was line 99) stays in the wrapper.

- [x] **Step 1.2.2: Run the agent-prep test file end-to-end**

```
npx vitest run src/attractor/tests/agent-prep.test.ts
```

Expected: all 6 tests pass — both the original `assembleAgentPrompt` block (3 cases) and the new `buildAgentPrompt` block (3 cases). If the original `assembleAgentPrompt` cases regress, the wrapper has diverged from the pre-split behaviour — re-check that the wrapper still calls `create()` after `writeFileSync` and that the pre-existing assertion `expect(onDisk).toBe(ok.prompt)` (line 59 of the pre-edit file) continues to hold.

### Task 1.3 — Confirm the seam is safe across the engine

- [x] **Step 1.3.1: Run `tsc` to catch any signature drift**

```
npx tsc --noEmit
```

Expected: clean. Both `assembleAgentPrompt` call sites — `src/attractor/handlers/looping-agent-handler.ts:27` and `src/attractor/handlers/interactive-agent-handler.ts:26` — must compile against the unchanged five-arg signature.

- [x] **Step 1.3.2: Run the broader handler test suite**

```
npx vitest run src/attractor
```

Expected: all attractor tests pass. The pure-core extract changes the *call shape* of one symbol but not its *output bytes* — any regression here means the wrapper or the pure core diverged from the pre-edit assembled-prompt content.

### Task 1.4 — Commit

- [x] **Step 1.4.1: Stage + commit the seam**

```
git add src/attractor/handlers/agent-prep.ts src/attractor/tests/agent-prep.test.ts
git commit -m "refactor(agent-prep): extract pure buildAgentPrompt core, keep assembleAgentPrompt wrapper"
```

The commit body is the design's §3.3 motivation in one line; no behaviour change for runtime callers.

## Verification targets

- Smokes: `None` — this chunk introduces no new pipeline; the engine's behaviour is byte-identical for the two existing `assembleAgentPrompt` call sites.
- Manual exercises: `apparat pipeline run <any-bundled-pipeline> --project .` — runtime path still writes `prompt.md` under `<project>/.apparat/runs/<runId>/<nodeId>/`. Verify by `ls .apparat/runs/<latest>/<nodeId>/prompt.md` immediately after the node completes.
- Lint: `npx vitest run src/attractor/tests/agent-prep.test.ts` and `npx tsc --noEmit`.
- Surfaces touched: engine (attractor handlers), tests (attractor).

---

## Chunk 2: `apparat pipeline explain <pipeline> [nodeId]` command

**Why this chunk now:** Chunk 1's `buildAgentPrompt` is the only seam needed for node-zoom mode. Topology mode reuses `loadPipeline` + `flow-analyzer.ts` + `loadAgent`. This chunk lands the new subcommand, registers it in `program.ts`, and adds the `pipeline-explain.test.ts` cases the design enumerates in §6.

**Verified anchors before drafting (cited so the implementer does not re-read):**

- `src/attractor/transforms/inputs-renderer.ts:29-37` — value substitution is a raw string concatenation: `lines.push(\`<${r.renderedTag}>${stringValue}</${r.renderedTag}>\`)`. No HTML/XML escaping. Passing the literal string `<placeholder:foo>` as the value yields the literal output `<foo><placeholder:foo></foo>` — the inner angle brackets are never parsed.
- `src/attractor/types.ts:19-46` — `Node.shape` is a top-level optional `string`. Direct property access (`node.shape`) is correct everywhere.
- `src/attractor/core/schemas.ts:84-93` — `classifyNode` returns `"start"` for `shape="Mdiamond"`, `"exit"` for `"Msquare"`, `"gate"` for `"hexagon"`, `"tool"` for `type="tool"`, `"agent"` when `agent` is set, else `null`.
- `src/attractor/handlers/registry.ts:13-37` — `HandlerExecutionContext` requires `logsRoot, cwd, dotDir, outgoingLabels, completedNodes, nodeRetries`. All other fields are optional.
- `src/cli/lib/agent-loader.ts:29-39` — `loadAgent(name, pipelineDir)` returns the parsed `AgentConfig` plus `metadata`.
- `src/cli/lib/gate-registry.ts:12-31` — `resolveGate(nodeId, { dotDir })` returns `{ choices, inputs?, prompt }`.
- `src/cli/commands/pipeline/trace.ts:100-102` — existing trace output uses `✓`/`✗` Unicode characters; the FORCE_COLOR=0 contract is about ANSI escape sequences, not character set. Reusing `✓`/`✗` here keeps parity with trace.

**Files:**
- Create: `src/cli/commands/pipeline/explain.ts`
- Modify: `src/cli/commands/pipeline.ts` (add re-export)
- Modify: `src/cli/program.ts` (register `pipeline.command("explain <pipeline> [nodeId]")`)
- Create: `src/cli/tests/pipeline-explain.test.ts`

### Task 2.1 — Failing tests for both modes

- [ ] **Step 2.1.1: Create `src/cli/tests/pipeline-explain.test.ts`**

Mirror the structure of `src/cli/tests/pipeline-show.test.ts` (mock `output.js`, capture `console.log` via override). Use the existing `tmpdir()` + `mkdtempSync` pattern from `pipeline-trace-command-validation.test.ts:16-19` for fixtures.

```ts
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
        `name: drafter\ndescription: drafts text\nmodel: opus\noutputs:\n  text: string`,
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
  approval [shape=hexagon, label="Approve?"]
  worker   [agent="worker"]
  done     [shape=Msquare]

  start -> approval
  approval -> worker [label="Approve"]
  approval -> done   [label="Decline"]
  worker   -> done
}
`);
      writeAgent(pipelineDir, "approval",
        `name: approval\ndescription: gate\ntype: gate\nchoices: ["Approve", "Decline"]`,
        "Approve?");
      writeAgent(pipelineDir, "worker",
        `name: worker\ndescription: works\nmodel: opus\noutputs:\n  result: string`,
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
        `name: worker\ndescription: loops\nmodel: opus\nloop: true\noutputs:\n  done: boolean`,
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
        `name: verifier\ndescription: v\nmodel: opus\noutputs:\n  summary: string`,
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
  approval [shape=hexagon, label="Approve?"]
  done  [shape=Msquare]
  start -> approval
  approval -> done [label="Approve"]
  approval -> done [label="Decline"]
}
`);
      writeAgent(pipelineDir, "approval",
        `name: approval\ndescription: gate\ntype: gate\nchoices: ["Approve", "Decline"]`,
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
```

- [ ] **Step 2.1.2: Run the new test file and confirm all cases fail**

```
npx vitest run src/cli/tests/pipeline-explain.test.ts
```

Expected: every test fails (or TS compile error) because `pipelineExplainCommand` is not yet exported. The exact failure mode varies by test runner version; the goal is that the file is referenced and runs.

### Task 2.2 — Implement `pipelineExplainCommand`

**Files:**
- Create: `src/cli/commands/pipeline/explain.ts`

- [ ] **Step 2.2.1: Write `src/cli/commands/pipeline/explain.ts`**

Skeleton (the implementer fills the renderer bodies based on §3.2.1 / §3.2.2 of the design doc):

```ts
import { resolve, dirname } from "path";
import { existsSync, readFileSync } from "fs";
import { loadPipeline, PipelineLoadError } from "../pipeline-invocation.js";
import { buildAgentPrompt } from "../../../attractor/handlers/agent-prep.js";
import { computeVarsInScope, computeVarsInAnyScope } from "../../../attractor/core/flow-analyzer.js";
import { resolveInputDecl } from "../../../attractor/transforms/inputs-resolver.js";
import { classifyNode, type NodeKind } from "../../../attractor/core/schemas.js";
import { loadAgent } from "../../lib/agent-loader.js";
import { resolveGate } from "../../lib/gate-registry.js";
import { formatPipelineDiag } from "../../lib/pipeline-diag-format.js";
import * as output from "../../lib/output.js";
import type { Graph, Node, PipelineContext } from "../../../attractor/types.js";
import type { HandlerExecutionContext } from "../../../attractor/handlers/registry.js";

export interface PipelineExplainOptions {
  project?: string;
}

export async function pipelineExplainCommand(
  pipelineArg: string,
  nodeId: string | undefined,
  opts: PipelineExplainOptions = {},
): Promise<number> {
  const projectRoot = resolve(opts.project ?? process.cwd());

  let loaded;
  try {
    loaded = await loadPipeline(pipelineArg, { project: projectRoot });
  } catch (err) {
    if (err instanceof PipelineLoadError) {
      if (err.diagnostic) {
        await output.error(formatPipelineDiag(err.diagnostic, err.src ?? "", err.relPath ?? ""));
      } else if (err.kind === "not-found") {
        await output.error(`Pipeline file not found: ${pipelineArg}`);
      } else {
        await output.error(err.message);
      }
      return 1;
    }
    throw err;
  }

  const errors = loaded.diagnostics.filter(d => d.severity === "error");
  if (errors.length > 0) {
    for (const d of errors) {
      await output.error(formatPipelineDiag(d, loaded.src, loaded.relPath));
    }
    return 1;
  }

  if (nodeId === undefined) {
    return renderTopology(loaded.graph, loaded.absPath);
  }
  return renderNodeZoom(loaded.graph, loaded.absPath, nodeId, projectRoot);
}

// ──────────────────────────────────────────────────────────
// Topology mode — §3.2.1
// ──────────────────────────────────────────────────────────

function renderTopology(graph: Graph, absPath: string): number {
  const dotDir = dirname(absPath);
  const goal = graph.goal ?? "(no goal=)";
  console.log(`\nPipeline: ${graph.name}`);
  console.log(`  goal: ${goal}\n`);
  console.log("Nodes:\n");

  // Per-node "produces" set (from agent outputs / gate choice / start inputs).
  const produces = collectProduces(graph, dotDir);

  // Topological order — reuse the ordering primitive in flow-analyzer
  // by computing scope; the iteration order of the returned Map is the
  // same Kahn order computeScope walks.
  const order = topologicalOrder(graph);

  for (const id of order) {
    const node = graph.nodes.get(id);
    if (!node) continue;
    const kind = classifyNode(node) ?? "unknown";
    const sibling = (kind === "agent" && node.agent)
      ? ` (agent: ${node.agent})`
      : (kind === "gate") ? ` (sibling: ${id}.md)` : "";
    console.log(`  ${id}${pad(id, 24)}kind=${kind}${sibling}`);

    const consumers = collectConsumers(node, kind, dotDir);
    if (consumers.length > 0) console.log(`    consumes: ${consumers.join(", ")}`);

    const myProduces = produces.get(id);
    if (myProduces && myProduces.size > 0) {
      console.log(`    produces: ${[...myProduces].sort().join(", ")}`);
    }

    const outgoing = graph.edges.filter(e => e.from === id);
    const labelled = outgoing.filter(e => e.label || e.condition);
    if (labelled.length > 0) {
      const branches = labelled
        .map(e => `${e.label ?? e.condition} → ${e.to}`)
        .join(" · ");
      console.log(`    branches: ${branches}`);
    }
    const next = outgoing.map(e => e.to).join(", ");
    if (next) console.log(`    next: ${next}`);
    console.log("");
  }

  // Loops — back-edges (target appears earlier in topo order than source).
  const idx = new Map(order.map((id, i) => [id, i]));
  const backEdges = graph.edges.filter(e => {
    const fi = idx.get(e.from);
    const ti = idx.get(e.to);
    return fi !== undefined && ti !== undefined && ti <= fi;
  });
  if (backEdges.length > 0) {
    console.log("Loops:");
    for (const e of backEdges) {
      const label = e.label || e.condition || "";
      console.log(`  - ${e.from} -> ${e.to}${label ? ` (on ${label})` : ""}`);
    }
    console.log("");
  }

  // Reachability — every node reachable from start; report mismatches.
  const inScope = computeVarsInScope(graph, produces);
  const inAny = computeVarsInAnyScope(graph, produces);
  const branchWarnings: string[] = [];
  for (const id of order) {
    const node = graph.nodes.get(id);
    if (!node) continue;
    const kind = classifyNode(node);
    if (kind !== "agent") continue;
    const consumers = collectConsumers(node, kind, dotDir);
    for (const c of consumers) {
      const r = resolveInputDecl(c);
      const everywhere = inScope.get(id)?.has(r.lookupKey) ?? false;
      const somewhere = inAny.get(id)?.has(r.lookupKey) ?? false;
      if (!everywhere && somewhere) {
        branchWarnings.push(`  - ${id} consumes "${c}" but only some predecessors produce it`);
      }
    }
  }

  console.log("Reachability:");
  console.log(`  - all nodes reachable from start ${order.length === graph.nodes.size ? "✓" : "✗"}`);
  if (branchWarnings.length > 0) {
    console.log("\nBranch warnings:");
    for (const w of branchWarnings) console.log(w);
  }
  console.log("");
  return 0;
}

// ──────────────────────────────────────────────────────────
// Node-zoom mode — §3.2.2
// ──────────────────────────────────────────────────────────

async function renderNodeZoom(
  graph: Graph,
  absPath: string,
  nodeId: string,
  projectRoot: string,
): Promise<number> {
  const dotDir = dirname(absPath);
  const node = graph.nodes.get(nodeId);
  if (!node) {
    const available = [...graph.nodes.keys()].join(", ");
    await output.error(`node "${nodeId}" not found in ${graph.name}; available: ${available}`);
    return 1;
  }
  const kind = classifyNode(node);
  if (kind !== "agent") {
    await output.error(
      `node "${nodeId}" is kind=${kind ?? "unknown"}; explain <node> only renders agent nodes ` +
      `(use bare "apparat pipeline explain ${graph.name}" for the topology view).`,
    );
    return 1;
  }

  // Synthesise placeholder ctx.values from the agent's declared inputs.
  let agentConfig;
  try {
    agentConfig = loadAgent(node.agent as string, dotDir);
  } catch (err) {
    await output.error(`Failed to load agent "${node.agent}": ${(err as Error).message}`);
    return 1;
  }
  const declaredInputs = (agentConfig.inputs as string[] | undefined) ?? [];
  const values: Record<string, unknown> = {};
  for (const decl of declaredInputs) {
    const r = resolveInputDecl(decl);
    values[r.lookupKey] = `<placeholder:${decl}>`;
  }
  const ctx: PipelineContext = { values };

  const meta: HandlerExecutionContext = {
    cwd: projectRoot,
    dotDir,
    logsRoot: "/dev/null",
    completedNodes: [],
    nodeRetries: {},
    outgoingLabels: [],
    projectDir: projectRoot,
  };

  const built = buildAgentPrompt(node, ctx, meta, loadAgent);
  if ("fail" in built) {
    await output.error(built.fail);
    return 1;
  }
  // Use console.log (not process.stdout.write) so the existing test harness's
  // `console.log` override captures the rendered prompt. trim() drops only the
  // trailing newline that buildPreamble might add — the prompt body itself is
  // already a clean multi-line string from inputs-renderer + agent body.
  console.log(built.prompt.replace(/\n+$/, ""));
  return 0;
}

// ──────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────

function pad(id: string, width: number): string {
  return id.length >= width ? " " : " ".repeat(width - id.length);
}

function collectProduces(graph: Graph, dotDir: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const [id, node] of graph.nodes) {
    const set = new Set<string>();
    const kind = classifyNode(node);
    if (kind === "agent" && node.agent) {
      try {
        const cfg = loadAgent(node.agent as string, dotDir);
        if (cfg.outputs && typeof cfg.outputs === "object") {
          for (const key of Object.keys(cfg.outputs)) set.add(`${id}.${key}`);
        }
      } catch { /* missing agent file → validator already errored */ }
    } else if (kind === "gate") {
      set.add(`${id}.choice`);
    }
    out.set(id, set);
  }
  return out;
}

function collectConsumers(node: Node, kind: NodeKind | null, dotDir: string): string[] {
  if (kind === "agent" && node.agent) {
    try {
      const cfg = loadAgent(node.agent as string, dotDir);
      return (cfg.inputs as string[] | undefined) ?? [];
    } catch { return []; }
  }
  if (kind === "gate") {
    try {
      const gate = resolveGate(node.id, { dotDir });
      return gate.inputs ?? [];
    } catch { return []; }
  }
  return [];
}

function topologicalOrder(graph: Graph): string[] {
  const fwd = new Map<string, string[]>();
  for (const id of graph.nodes.keys()) fwd.set(id, []);
  const inDeg = new Map<string, number>();
  for (const id of graph.nodes.keys()) inDeg.set(id, 0);
  for (const e of graph.edges) {
    if (!fwd.has(e.from) || !fwd.has(e.to)) continue;
    fwd.get(e.from)!.push(e.to);
    inDeg.set(e.to, (inDeg.get(e.to) ?? 0) + 1);
  }
  const startId = [...graph.nodes.values()].find(n => n.shape === "Mdiamond" || n.id === "start")?.id;
  const queue: string[] = startId ? [startId] : [];
  const seen = new Set<string>();
  if (startId) { inDeg.set(startId, 0); seen.add(startId); }
  const order: string[] = [];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    order.push(cur);
    for (const nxt of fwd.get(cur) ?? []) {
      if (seen.has(nxt)) continue;
      const d = (inDeg.get(nxt) ?? 0) - 1;
      inDeg.set(nxt, d);
      if (d <= 0) { queue.push(nxt); seen.add(nxt); }
    }
  }
  // Append disconnected.
  for (const id of graph.nodes.keys()) if (!order.includes(id)) order.push(id);
  return order;
}
```

Notes for the implementer:

- `classifyNode` (`src/attractor/core/schemas.ts:84`) maps shape/type to `"start" | "exit" | "tool" | "agent" | "gate" | null`.
- `loadAgent` (`src/cli/lib/agent-loader.ts:29`) returns a full `AgentConfig` with parsed `inputs:` / `outputs:`.
- `resolveGate` (`src/cli/lib/gate-registry.ts:12`) returns gate `choices:` and `inputs:`.
- The renderer is plain `console.log` — no chalk, no boxen, no ANSI escapes — so the FORCE_COLOR=0 test passes trivially.
- `process.stdout.write(built.prompt)` writes one chunk; the test captures via the `console.log` override. Switch the renderer to `console.log(built.prompt)` if the test framework's stdout capture proves easier — both forms are byte-identical to the design's success-only-prompt rule (§3.2.2 step 8).

- [ ] **Step 2.2.2: Run the explain test file**

```
npx vitest run src/cli/tests/pipeline-explain.test.ts
```

Expected: all 9 tests pass. Iterate on the renderer until the assertions match the rendered text (the assertions deliberately match on substrings rather than exact layout to give the implementer latitude on whitespace).

### Task 2.3 — Re-export and CLI registration

- [ ] **Step 2.3.1: Add the re-export to `src/cli/commands/pipeline.ts`**

Append after the existing `pipelineShowCommand` re-export at line 12:

```ts
export { pipelineExplainCommand } from "./pipeline/explain.js";
export type { PipelineExplainOptions } from "./pipeline/explain.js";
```

- [ ] **Step 2.3.2: Register the subcommand in `src/cli/program.ts`**

Add the import at the top of the file (next to the existing pipeline subcommand imports at lines 6-10):

```ts
import { pipelineExplainCommand } from "./commands/pipeline/explain.js";
```

Add a new registration block immediately after the `pipeline.command("show <dotfile>")` block ending at `src/cli/program.ts:203`:

```ts
  pipeline
    .command("explain <pipeline> [nodeId]")
    .description("Plain-text walkthrough of a pipeline's topology, or render a node's prompt skeleton")
    .addHelpText("after", `
Examples:
  apparat pipeline explain <pipeline>           # topology walkthrough
  apparat pipeline explain <pipeline> <nodeId>  # render the agent's prompt skeleton

Bare invocation prints node-by-node consumes/produces/branches, plus Loops and
Reachability sections. With a node id, prints the rendered prompt skeleton with
placeholder values — no LLM invoked, no run dir created.
`)
    .option("--project <folder>", "Project folder (defaults to cwd)")
    .action(async (pipelineArg: string, nodeId: string | undefined, opts: { project?: string }) => {
      const code = await pipelineExplainCommand(pipelineArg, nodeId, opts);
      process.exit(code);
    });
```

**Note (deferred to Chunk 3):** the `apparat pipeline …` overview block that lives in `program.ts:21-77` (mirrored by `README.md` lines 43-51) is updated in Chunk 3, Task 3.5. Do **not** double-edit it here.

- [ ] **Step 2.3.3: Confirm `tsc` is clean**

```
npx tsc --noEmit
```

Expected: clean. The new import in `program.ts` resolves to the new file; the action signature matches commander's typing for `<pipeline> [nodeId]`.

### Task 2.4 — Smoke against the real `illumination-to-implementation` pipeline

- [ ] **Step 2.4.1: Build and run the bare topology view**

```
npm run build
node dist/cli/index.js pipeline explain illumination-to-implementation --project .
```

Expected exit 0; stdout contains a `Pipeline: illumination-to-implementation` header, a `Nodes:` block with at least the `start`, `verifier`, `explainer`, `approval_gate`, and `implement` rows, a non-empty `Loops:` section (the `implement` retry edge), and a `Reachability:` line. Pipe through `cat -v` to confirm zero ANSI escapes.

- [ ] **Step 2.4.2: Run the node-zoom view against `verifier`**

```
node dist/cli/index.js pipeline explain illumination-to-implementation verifier --project .
```

Expected: stdout is the rendered prompt skeleton; contains `## Inputs`; contains a tag like `<illumination_path><placeholder:illumination_path></illumination_path>` (or the qualified form, depending on the verifier agent's declared inputs); contains the verifier agent body verbatim. Exit 0. No new directory under `.apparat/runs/`.

- [ ] **Step 2.4.3: Run the missing-node negative case**

```
node dist/cli/index.js pipeline explain illumination-to-implementation does_not_exist --project .
```

Expected exit 1; stderr contains `does_not_exist` and an `available:` listing.

- [ ] **Step 2.4.4: Run the non-agent negative case**

```
node dist/cli/index.js pipeline explain illumination-to-implementation approval_gate --project .
```

Expected exit 1; stderr contains `kind=gate` and `agent nodes`.

### Task 2.5 — Commit

- [ ] **Step 2.5.1: Stage + commit**

```
git add src/cli/commands/pipeline/explain.ts src/cli/commands/pipeline.ts src/cli/program.ts src/cli/tests/pipeline-explain.test.ts
git commit -m "feat(pipeline): add 'explain <pipeline> [nodeId]' for topology + prompt-skeleton render"
```

## Verification targets

- Smokes: `None` — `pipeline explain` is a CLI surface, not a runnable pipeline.
- Manual exercises:
  - `apparat pipeline explain illumination-to-implementation --project .` (topology, exit 0)
  - `apparat pipeline explain illumination-to-implementation verifier --project .` (node-zoom, exit 0)
  - `apparat pipeline explain illumination-to-implementation does_not_exist --project .` (exit 1)
  - `apparat pipeline explain illumination-to-implementation approval_gate --project .` (exit 1, kind-mismatch)
- Lint: `npx vitest run src/cli/tests/pipeline-explain.test.ts` and `npx tsc --noEmit`.
- Surfaces touched: CLI (program registration, new pipeline subcommand), engine (consumer of the Chunk-1 seam), tests (CLI).

---

## Chunk 3: Trace prompt-line + docs (`pipelines.md`, `SKILL.md`, `README.md`)

**Why this chunk last:** None of the docs or the `trace` one-liner depend on Chunks 1 or 2 *executing* — they just describe surfaces that are now present. Landing them here keeps the doc deltas in their own commit and surfaces the new command in the live authoring reference.

**Files:**
- Modify: `src/cli/commands/pipeline/trace.ts:49-52` (insert three lines)
- Modify: `src/cli/skills/apparatus/pipelines.md` §3 (one new sub-section between the §3 frontmatter table and the §3 example digraph)
- Modify: `src/cli/skills/apparatus/SKILL.md` (one new row in the command table)
- Modify: `README.md` (one new bash-block entry between `pipeline validate` and `pipeline list`)
- Modify: `src/cli/program.ts` (one new line inside the `addHelpText` overview block at lines 21-77, mirroring README)
- Modify: `src/cli/tests/pipeline-trace-command-validation.test.ts` (new cases asserting the `prompt:` line, present + absent)

### Task 3.1 — Failing test for the trace prompt-line

- [ ] **Step 3.1.1: Add new `it(...)` blocks to `src/cli/tests/pipeline-trace-command-validation.test.ts`**

Reuse the existing top-of-file imports (`mkdtempSync, writeFileSync, mkdirSync` from `node:fs`, `tmpdir`, `join`, `pipelineTraceCommand`, `runDir`) and the file-level `logs[]` array — no new imports are required. Append the two `it(...)` blocks below inside the existing `describe(...)` block (after the existing case at lines 15-36):

```ts
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
    expect(out).toMatch(new RegExp(`prompt:\\s+${promptPath.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}`));
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
```

- [ ] **Step 3.1.2: Run the trace test file and confirm the two new cases fail**

```
npx vitest run src/cli/tests/pipeline-trace-command-validation.test.ts
```

Expected: 2 fails (the new cases — `prompt:` line is not yet emitted), 1 pass (the existing validation-attempts case).

### Task 3.2 — Implement the three-line `trace.ts` addition

- [ ] **Step 3.2.1: Edit `src/cli/commands/pipeline/trace.ts` between lines 51 and 52**

Replace:

```ts
    console.log(`received: ${event.timestamp}`);
    console.log(`\ncontext snapshot (${keys.length} key${keys.length === 1 ? "" : "s"}):`);
```

with:

```ts
    console.log(`received: ${event.timestamp}`);
    const promptPath = join(runDir(project, runId), String(event.nodeId), "prompt.md");
    if (existsSync(promptPath)) {
      console.log(`prompt:   ${promptPath}`);
    }
    console.log(`\ncontext snapshot (${keys.length} key${keys.length === 1 ? "" : "s"}):`);
```

Zero new imports — `existsSync` is already at line 1, `runDir` at line 3, `join` at line 2, `project` is in scope from line 10.

- [ ] **Step 3.2.2: Re-run the trace test file**

```
npx vitest run src/cli/tests/pipeline-trace-command-validation.test.ts
```

Expected: 3 passes (the new two + the existing one).

### Task 3.3 — Document the `<renderedTag>` rule in `pipelines.md`

**Files:**
- Modify: `src/cli/skills/apparatus/pipelines.md` §3 (insert one new sub-section between the §3 frontmatter table and the §3 example digraph)

- [ ] **Step 3.3.1: Insert a new sub-section in `pipelines.md`**

Anchor: the **§3** "Example digraph" heading. There is also a `### Example digraph` heading later in §4 — disambiguate by inserting between two specific anchors:

- **Above this heading** (the closer of the §3 frontmatter table): `### Schema — sibling \`<name>.md\` frontmatter`
- **Below this heading**: the §3 `### Example digraph` (the *first* such heading in the file).

Insert exactly the literal markdown below at that point. **Do not wrap it in an outer code fence** — the lines are intended to render as live markdown (a heading, two paragraphs, and one fenced code block):

````
### Auto-injected `## Inputs` block

When an agent runs, the engine prepends a `## Inputs` section to the prompt
that wraps each declared input in an XML-style tag. The tag name uses
`<sourceNode>_<localKey>` for qualified inputs (the dot is replaced by an
underscore) and `<bareKey>` for caller-graph inputs and system-injected vars.

Example: an agent declaring `inputs: [verifier.summary, illumination_path]`
receives:

```
<verifier_summary>...the value...</verifier_summary>
<illumination_path>...the value...</illumination_path>
```

Use `apparat pipeline explain <pipeline> <nodeId>` to render the exact
skeleton with placeholder values without running the LLM.
````

The four-backtick wrapper above is for *this plan document only*, so the inner triple-backtick fence renders literally. The actual markdown to paste into `pipelines.md` is everything between the two four-backtick lines, with the inner triple-backtick fence intact.

### Task 3.4 — Add the `pipeline explain` row to `SKILL.md`

- [ ] **Step 3.4.1: Edit `src/cli/skills/apparatus/SKILL.md` command table (line 12-22)**

Add this row immediately after the existing `pipeline trace …` row (line 20):

```markdown
| `apparat pipeline explain <name> [nodeId]` | Plain-text topology walkthrough; with `nodeId`, render the agent's prompt skeleton (placeholders, no LLM). |
```

ADR-0011 ships SKILL.md as a hand-edited shim today — there is no `scripts/` regen target (verified absent at plan-write time). Hand-edit is the correct path.

### Task 3.5 — Add the `pipeline explain` entry to `README.md` and the `program.ts` overview mirror

- [ ] **Step 3.5.1: Edit `README.md` — insert a new bash block between `pipeline validate` (lines 84-87) and `pipeline list` (lines 89-92)**

Insert exactly the literal markdown below immediately after the `apparat pipeline validate` paragraph and immediately before the `apparat pipeline list` bash block. **Do not wrap in an outer code fence** — the snippet is live markdown containing one bash code block plus one prose paragraph:

````
```bash
apparat pipeline explain <pipeline> [nodeId]
```
Plain-text walkthrough of a pipeline's topology (per-node `consumes:` / `produces:` / `branches:` / `next:`, plus `Loops:` and `Reachability:`). With a node id, renders that agent's prompt skeleton with `<placeholder:…>` values — useful for iterating on agent `.md` files without spawning an LLM.
````

The four-backtick wrapper above is plan-document-only. The actual content to paste into `README.md` is everything between the two four-backtick lines, including the inner triple-backtick `bash` fence.

- [ ] **Step 3.5.2: Edit `src/cli/program.ts` `addHelpText` overview block at lines 21-77**

`README.md` has no `Pipeline engine (DOT-graph workflows):` overview block — only per-command bash sections (the one added in Step 3.5.1). The overview lives only in `program.ts` and surfaces via `apparat --help`.

In the multi-line template-literal at `src/cli/program.ts` that begins at line 22 (`Bootstrap a project: …`), find the `Pipeline engine (DOT-graph workflows):` section (lines 43-51). Find the line:

```
  apparat pipeline show workflow.dot                 Render a pipeline as SVG next to the source
```

and insert immediately after it:

```
  apparat pipeline explain workflow.dot              Plain-text topology walkthrough or node prompt skeleton
```

Verify with `grep -n "pipeline explain workflow.dot" src/cli/program.ts` — should return exactly one match.

### Task 3.6 — Final full test + tsc + commit

- [ ] **Step 3.6.1: Full test run**

```
npx vitest run
npx tsc --noEmit
```

Expected: both clean. Any regression at this point is in the docs (unlikely to break tests) or in the trace edit (which is covered by the new cases) — re-read the diff for the offending file and align.

- [ ] **Step 3.6.2: Stage + commit**

```
git add src/cli/commands/pipeline/trace.ts \
        src/cli/tests/pipeline-trace-command-validation.test.ts \
        src/cli/skills/apparatus/pipelines.md \
        src/cli/skills/apparatus/SKILL.md \
        src/cli/program.ts \
        README.md
git commit -m "feat(trace+docs): emit prompt: path in --node-receive; document <renderedTag> + pipeline explain"
```

## Verification targets

- Smokes: `None`.
- Manual exercises:
  - `apparat pipeline run <small-pipeline> --project .` then `apparat pipeline trace <runId> --node-receive <nodeId>` — output now contains a `prompt:   <runDir>/<nodeId>/prompt.md` line whose path resolves to a real file.
  - Trace against an old run whose `prompt.md` was lazily pruned (`rm <runDir>/<nodeId>/prompt.md` then re-run trace) — the `prompt:` line is omitted, no error, exit 0.
  - `grep -n "renderedTag\\|<sourceNode>_<localKey>" src/cli/skills/apparatus/pipelines.md` — at least one match.
  - `grep -n "pipeline explain" README.md src/cli/skills/apparatus/SKILL.md` — at least one match per file.
- Lint: `npx vitest run src/cli/tests/pipeline-trace-command-validation.test.ts` and `npx tsc --noEmit`.
- Surfaces touched: CLI (trace command), docs (pipelines.md, SKILL.md, README.md), tests (CLI).

---

## Open questions (deferred to implementation)

- **Phase grouping vs. topological grouping in topology view.** Topological is the universal fallback; phase-comment grouping is only worth attempting if `parseDot` already surfaces phase comments cleanly. Default: topological (the renderer above uses topological order).
- **`BuiltPrompt` interface location.** Default: inline in `agent-prep.ts` (as written in Chunk 1). Move to a shared types file only if a third consumer appears.
- **`SKILL.md` regeneration vs. hand-edit.** Plan-write-time check (`find scripts -name "*skill*"` returned nothing): no regeneration script exists today. Hand-edit is correct. If a regen script lands between plan write and execution, prefer the regen path.
