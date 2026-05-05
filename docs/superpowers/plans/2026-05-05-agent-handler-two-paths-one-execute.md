# AgentHandler — Split Two Paths, Hide The Disjunction Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the ~290-line `AgentHandler.execute` into two focused handlers (`InteractiveAgentHandler`, `LoopingAgentHandler`) sharing a free function `assembleAgentPrompt`, route via a thin `AgentHandlerDispatch` shim, promote two runtime mode-confusion guards to graph validator rules, and delete the dead `ConsoleInterviewer` / `CallbackInterviewer` adapters.

**Architecture:** Refactor under green tests in four chunks. Chunk 1 extracts the shared prep into `agent-prep.ts` while keeping `AgentHandler` intact (delegating). Chunk 2 introduces `InteractiveAgentHandler`, `LoopingAgentHandler`, and `AgentHandlerDispatch`, retargets the seven `agent-handler-*.test.ts` files, and deletes `agent-handler.ts`. Chunk 3 adds two graph validator rules (`interactive_with_outputs_forbidden`, `interactive_with_loop_forbidden`) plus their tests, and removes the runtime `if (jsonSchema)` guard. Chunk 4 deletes the dead interviewer adapters and trims `interviewer.test.ts`.

**Tech Stack:** TypeScript (ESM), Node.js, vitest, tsup, zod (via `outputsToZod`), `@ts-graphviz/ast` (DOT parsing), source-location infrastructure (v0.1.31 `{ rule, severity, message, location }` diagnostic shape).

**Source-of-truth design doc:** `docs/superpowers/specs/2026-05-05-agent-handler-two-paths-one-execute-design.md`. Read §2 (Decision Summary) and §4 (Components & file edits) before starting any chunk.

**Single-commit constraint vs per-step commits:** The design's §8 says "All edits land in a single commit so the diff tells a single story." This plan uses per-step commits during execution because TDD discipline requires a green commit between red and refactor. **Before opening a PR, squash all chunk commits into one.** The squash command is given in the final verification step. If the executing engineer prefers commit-per-chunk, that is also acceptable as long as each chunk commit is green (`npx tsc --noEmit` + `npx vitest run` pass).

---

## Chunk 1: Extract `assembleAgentPrompt` into `agent-prep.ts`

**Goal of this chunk:** Lift the prompt-assembly prep (currently `agent-handler.ts:51-123`) into a free function in a new file. `AgentHandler` keeps its public shape — its `execute()` body now calls `assembleAgentPrompt()` instead of inlining the prep. All 7 existing `agent-handler-*.test.ts` files MUST pass unchanged after this chunk. This is a pure refactor — no behavior change, no new public surface, no test churn.

**Why first:** The two new handlers (Chunk 2) both need this shared prep. Extracting it under green tests proves the lift is byte-equivalent before splitting.

**Files:**
- Create: `src/attractor/handlers/agent-prep.ts`
- Modify: `src/attractor/handlers/agent-handler.ts`
- Test: existing `src/attractor/tests/agent-handler*.test.ts` (no edits — they prove behavior preservation)

### Task 1.1: Add a characterization test for `agent-prep` outputs

**Why:** Before extracting, lock the exact shape returned. The new function is the seam; the test proves the lift is faithful.

**Files:**
- Test: `src/attractor/tests/agent-prep.test.ts` (new)

- [x] **Step 1: Write the failing test**

Create `src/attractor/tests/agent-prep.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { assembleAgentPrompt } from "../handlers/agent-prep.js";
import type { AgentConfig } from "../../cli/lib/agent.js";
import type { Node, PipelineContext } from "../types.js";
import type { HandlerExecutionContext } from "../handlers/registry.js";

function makeConfig(): AgentConfig {
  return {
    name: "fake",
    description: "",
    model: "opus",
    permissionMode: "dangerouslySkipPermissions",
    tools: [],
    mcp: [],
    prompt: "AGENT INSTRUCTIONS",
  } as AgentConfig;
}

function makeMeta(cwd: string, logsRoot: string): HandlerExecutionContext {
  return {
    cwd,
    logsRoot,
    dotDir: cwd,
    completedNodes: [],
    nodeRetries: {},
    outgoingLabels: [],
  };
}

describe("assembleAgentPrompt", () => {
  it("returns prep object with prompt, agent, config, jsonSchema, agentVariables, nodeDir", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "ralph-prep-"));
    try {
      const cfg = makeConfig();
      const node: Node = { id: "n1", prompt: "STEERING", agent: "fake" };
      const ctx: PipelineContext = { values: {} };
      const meta = makeMeta(tmp, tmp);

      const fakeAgent = { run: async () => ({ exitCode: 0, sessionId: null, stdout: null }) } as any;

      const prep = assembleAgentPrompt(node, ctx, meta, () => cfg, () => fakeAgent);

      // PreparedAgent shape
      expect("fail" in prep).toBe(false);
      const ok = prep as Exclude<typeof prep, { fail: string }>;
      expect(ok.config.name).toBe("fake");
      expect(ok.agent).toBe(fakeAgent);
      expect(ok.jsonSchema).toBeUndefined();
      expect(ok.agentVariables).toBeDefined();
      expect(ok.prompt).toContain("AGENT INSTRUCTIONS");
      expect(ok.prompt).toContain("STEERING");
      expect(ok.nodeDir).toBe(join(tmp, "n1"));

      // prompt.md is written to nodeDir
      const onDisk = readFileSync(join(ok.nodeDir, "prompt.md"), "utf8");
      expect(onDisk).toBe(ok.prompt);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("returns { fail } when loadAgent throws", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ralph-prep-"));
    try {
      const node: Node = { id: "n1", agent: "missing" };
      const ctx: PipelineContext = { values: {} };
      const meta = makeMeta(tmp, tmp);
      const result = assembleAgentPrompt(
        node, ctx, meta,
        () => { throw new Error("agent file not found"); },
        () => ({} as any),
      );
      expect("fail" in result).toBe(true);
      if ("fail" in result) {
        expect(result.fail).toMatch(/Failed to resolve agent "missing"/);
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("wraps prompt with JSON-schema framing when config.jsonSchema is set", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ralph-prep-"));
    try {
      const cfg = { ...makeConfig(), jsonSchema: '{"type":"object"}' };
      const node: Node = { id: "n1", prompt: "p", agent: "fake" };
      const ctx: PipelineContext = { values: {} };
      const meta = makeMeta(tmp, tmp);
      const prep = assembleAgentPrompt(node, ctx, meta, () => cfg, () => ({} as any));
      expect("fail" in prep).toBe(false);
      const ok = prep as Exclude<typeof prep, { fail: string }>;
      expect(ok.jsonSchema).toBe('{"type":"object"}');
      expect(ok.prompt).toContain("Your FINAL response MUST be valid JSON");
      expect(ok.prompt).toContain('Schema: {"type":"object"}');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/attractor/tests/agent-prep.test.ts`
Expected: FAIL with `Cannot find module '../handlers/agent-prep.js'` or equivalent.

### Task 1.2: Create `agent-prep.ts`

**Files:**
- Create: `src/attractor/handlers/agent-prep.ts`

- [x] **Step 1: Write the new file**

Create `src/attractor/handlers/agent-prep.ts` by lifting `agent-handler.ts:1-123` verbatim, refactoring to a free function. The body is a near-1:1 lift of the existing prep. Concretely:

```ts
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import type { Node, PipelineContext, CheckpointState } from "../types.js";
import type { HandlerExecutionContext } from "./registry.js";
import { Agent, type AgentConfig } from "../../cli/lib/agent.js";
import { getIlluminationServerPath, getMetaMeditationsDir } from "../../cli/lib/assets.js";
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
  "META_MEDITATIONS_DIR",
] as const;

function buildSystemInjectedVars(projectRoot: string): Record<(typeof SYSTEM_INJECTED_VARS)[number], string> {
  return {
    ILLUMINATION_SERVER_PATH: getIlluminationServerPath(),
    PROJECT_ROOT: projectRoot,
    META_MEDITATIONS_DIR: getMetaMeditationsDir(),
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

export function assembleAgentPrompt(
  node: Node,
  ctx: PipelineContext,
  meta: HandlerExecutionContext,
  load: (name: string, pipelineDir: string) => AgentConfig,
  create: (config: AgentConfig) => Agent,
): PreparedAgent | { fail: string } {
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
  if (typeof __RALPH_PROD__ === "undefined") {
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
  mkdirSync(nodeDir, { recursive: true });
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
  writeFileSync(join(nodeDir, "prompt.md"), prompt);

  const agent = create({ ...config, prompt, ...(jsonSchema ? { jsonSchema } : {}) });

  return { agent, config, jsonSchema, agentVariables, prompt, nodeDir };
}
```

- [x] **Step 2: Run prep test to verify it passes**

Run: `npx vitest run src/attractor/tests/agent-prep.test.ts`
Expected: PASS (3 tests).

### Task 1.3: Make `AgentHandler.execute` delegate to `assembleAgentPrompt`

**Files:**
- Modify: `src/attractor/handlers/agent-handler.ts`

- [x] **Step 1: Refactor `agent-handler.ts` to call `assembleAgentPrompt`**

Replace lines 1-123 of `src/attractor/handlers/agent-handler.ts` so the file imports and uses `assembleAgentPrompt`, removing the duplicated prep code, the `SYSTEM_INJECTED_VARS` export, and the `buildSystemInjectedVars` helper. The `execute()` method body for the interactive and looping branches stays unchanged — it now sources `agent`, `config`, `jsonSchema`, `agentVariables`, `prompt`, `nodeDir` from the prep result.

The new top-of-file imports should look like this (delete the now-orphaned imports for `mkdirSync`, `writeFileSync`, `getIlluminationServerPath`, `getMetaMeditationsDir`, `buildPreamble`, `renderInputsBlock`, `extractDefaults`):

```ts
import { writeFileSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import type { NodeHandler, HandlerExecutionContext } from "./registry.js";
import type { Node, Outcome, PipelineContext } from "../types.js";
import { Agent, type AgentConfig, type ChildHandle } from "../../cli/lib/agent.js";
import { loadAgent as defaultLoadAgent } from "../../cli/lib/agent-loader.js";
import { outputsToZod } from "../../cli/lib/outputs-to-zod.js";
import { buildCorrectiveMessage } from "../../cli/lib/corrective-message.js";
import { evaluateAgentOutput } from "./evaluate-agent-output.js";
import { Session, buildSessionDigest } from "../../cli/lib/session.js";
import { assembleAgentPrompt, SYSTEM_INJECTED_VARS } from "./agent-prep.js";

export { SYSTEM_INJECTED_VARS };
```

The re-export of `SYSTEM_INJECTED_VARS` keeps `src/attractor/core/graph.ts:17` (`import { SYSTEM_INJECTED_VARS } from "../handlers/agent-handler.js"`) compiling unchanged in this chunk. The graph.ts import will be retargeted in Chunk 2 when `agent-handler.ts` is deleted.

The new `execute()` body (replaces lines 51-123 of the original — the interactive branch lines 126-186 and the looping branch lines 189-342 are inlined verbatim below from the pre-edit file):

```ts
  async execute(node: Node, ctx: PipelineContext, meta: HandlerExecutionContext): Promise<Outcome> {
    const prep = assembleAgentPrompt(node, ctx, meta, this.load, this.create);
    if ("fail" in prep) {
      return { status: "fail", failureReason: prep.fail };
    }
    const { agent, config, jsonSchema, agentVariables, prompt, nodeDir } = prep;
    const { cwd, signal, onStdout, onInteractiveRequest } = meta;
    // DOT attributes parse as strings; coerce explicitly to boolean
    const interactive = node.interactive === true || node.interactive === "true";

    // --- Path 1.5: interactive branch (verbatim copy of pre-edit agent-handler.ts:126-186) ---
    if (interactive) {
      if (jsonSchema) {
        return {
          status: "fail",
          failureReason: "interactive=true cannot be combined with outputs: structured output is incompatible with live chat streaming",
        };
      }

      const sessionId = randomUUID();
      const session = new Session(sessionId);
      const systemPrompt = prompt;

      const child: ChildHandle = agent.runInteractive({
        session,
        systemPrompt,
        cwd,
        variables: agentVariables,
      });

      if (!onInteractiveRequest) {
        try { await child.kill("SIGKILL"); } catch {}
        return {
          status: "fail",
          failureReason:
            "interactive=true node requires onInteractiveRequest in engine options",
        };
      }

      await onInteractiveRequest({ session, child, tracePath: nodeDir });

      try {
        await Promise.race([
          child.exited,
          new Promise<void>((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000)),
        ]);
      } catch {
        try { await child.kill("SIGKILL"); } catch {}
      }

      const digest = buildSessionDigest(session);
      const prefix = node.id;
      const contextUpdates: Record<string, unknown> = {
        [`${prefix}.output`]: digest.output,
        [`${prefix}.success`]: digest.success,
        [`${prefix}.turnsUsed`]: digest.turnsUsed,
        [`${prefix}.sessionId`]: digest.sessionId,
        [`${prefix}.exitReason`]: digest.exitReason,
        [`${prefix}.transcriptPath`]: digest.transcriptPath,
        [`${prefix}.digest`]: digest.digest,
      };

      writeFileSync(join(nodeDir, "digest.json"), JSON.stringify(digest, null, 2));

      return {
        status: digest.success ? "success" : "fail",
        failureReason: digest.success ? undefined : `Interactive session ended with ${digest.exitReason}`,
        contextUpdates,
      };
    }
    // --- end interactive branch; legacy path below is verbatim copy of pre-edit agent-handler.ts:189-342 ---

    const nodeCapRaw = node.maxIterations;
    const nodeCapParsed = typeof nodeCapRaw === "string" ? parseInt(nodeCapRaw, 10)
                        : typeof nodeCapRaw === "number"  ? nodeCapRaw
                        : undefined;
    const nodeCapValid = nodeCapParsed != null && !isNaN(nodeCapParsed) && nodeCapParsed >= 0;

    const agentCap = config.maxIterations;
    const loopMode = config.loop === true;

    const maxIterations =
      nodeCapValid
        ? (nodeCapParsed === 0 ? Infinity : nodeCapParsed!)
        : (typeof agentCap === "number" && agentCap >= 0
            ? (agentCap === 0 ? Infinity : agentCap)
            : (loopMode ? Infinity : 1));

    let lastSessionId: string | null = null;
    let iteration = 0;

    let lastParsed: Record<string, unknown> | null = null;
    let preferredLabel: string | undefined;

    const zodSchema = (jsonSchema && config.outputs) ? outputsToZod(config.outputs) : null;

    const overrideRetries = (node as Record<string, unknown>).outputValidationRetries;
    const maxRetries =
      typeof overrideRetries === "number" && overrideRetries >= 0
        ? overrideRetries
        : 1;

    const writeRaw = (n: number, raw: string) =>
      writeFileSync(join(nodeDir, `raw-attempt-${n}.txt`), raw ?? "");

    const baseAgentVariables: Record<string, unknown> = { ...agentVariables };
    const agentDeclaresNote =
      !!config.outputs && Object.prototype.hasOwnProperty.call(config.outputs, "note");
    let prevNote = "";

    const metaPrefix = node.id;
    const agentName = node.agent ?? "implement";

    for (let i = 0; i < maxIterations; i++) {
      if (signal?.aborted) break;

      if (i > 0) meta.onIterationStart?.(node.id, i);

      const iterVariables = agentDeclaresNote
        ? { ...baseAgentVariables, prev_note: prevNote }
        : baseAgentVariables;

      let result = await agent.run({
        cwd, signal, variables: iterVariables, onStdout,
      });
      iteration++;
      if (result.sessionId) lastSessionId = result.sessionId;

      if (result.exitCode !== 0) {
        return {
          status: "fail",
          failureReason: `Agent "${agentName}" exited with code ${result.exitCode}`,
          contextUpdates: {
            [`${metaPrefix}.iterations`]: String(iteration),
            [`${metaPrefix}.success`]: "false",
          },
        };
      }

      let parsed: Record<string, unknown> | undefined;
      if (jsonSchema) {
        writeRaw(1, result.output ?? "");
        let attempt = 1;
        let evaluation = evaluateAgentOutput(result.output ?? "", zodSchema);

        while (!evaluation.ok && attempt <= maxRetries) {
          meta.onValidationFailure?.({
            attempt,
            errors: evaluation.errors,
            rawOutputPath: `${node.id}/raw-attempt-${attempt}.txt`,
          });
          if (!lastSessionId) {
            return {
              status: "fail",
              failureReason:
                `Output validation failed and cannot retry: agent did not report sessionId ` +
                `(iter ${i + 1} attempt ${attempt}: ${evaluation.errors.map(e => `${e.path}: ${e.message}`).join("; ")})`,
              contextUpdates: { [`${metaPrefix}.iterations`]: String(iteration), [`${metaPrefix}.success`]: "false" },
            };
          }
          attempt += 1;
          meta.onValidationRetryStart?.(node.id, attempt);
          const corrective = buildCorrectiveMessage(evaluation.raw, evaluation.errors, jsonSchema);
          const retryResult = await agent.run({
            cwd, signal, variables: iterVariables, onStdout,
            resume: lastSessionId, message: corrective,
          });
          result = retryResult;
          if (retryResult.sessionId) lastSessionId = retryResult.sessionId;

          writeRaw(attempt, retryResult.output ?? "");
          evaluation = evaluateAgentOutput(retryResult.output ?? "", zodSchema);
        }

        if (!evaluation.ok) {
          meta.onValidationFailure?.({
            attempt,
            errors: evaluation.errors,
            rawOutputPath: `${node.id}/raw-attempt-${attempt}.txt`,
          });
          return {
            status: "fail",
            failureReason:
              `Output validation failed in iteration ${i + 1} after ${attempt} attempts: ` +
              evaluation.errors.map(e => `${e.path}: ${e.message}`).join("; "),
            contextUpdates: { [`${metaPrefix}.iterations`]: String(iteration), [`${metaPrefix}.success`]: "false" },
          };
        }

        parsed = evaluation.parsed as Record<string, unknown>;
        lastParsed = parsed;
        if (parsed.preferred_label != null) preferredLabel = String(parsed.preferred_label);
      }

      if (agentDeclaresNote && parsed && typeof parsed.note === "string") {
        prevNote = parsed.note;
      }

      const willBreak = parsed?.done === true;
      if (willBreak) break;

      const willContinue = !signal?.aborted && i < maxIterations - 1;
      if (willContinue) meta.onIterationEnd?.(node.id, i);
    }

    let structuredUpdates: Record<string, unknown> = {};
    if (lastParsed) {
      for (const [key, value] of Object.entries(lastParsed)) {
        const outKey = `${metaPrefix}.${key}`;
        structuredUpdates[outKey] = typeof value === "string" ? value : String(value);
      }
    }

    return {
      status: "success",
      ...(preferredLabel ? { preferredLabel } : {}),
      contextUpdates: {
        ...structuredUpdates,
        [`${metaPrefix}.iterations`]: String(iteration),
        [`${metaPrefix}.success`]: "true",
        ...(lastSessionId ? { [`${metaPrefix}.sessionId`]: lastSessionId } : {}),
      },
    };
  }
```

Note: `agentName` was previously sourced inline at `agent-handler.ts:52`; the verbatim looping branch above re-derives it as `const agentName = node.agent ?? "implement";` for the exit-code error message. The runtime `if (jsonSchema)` guard at the top of the interactive branch is **kept this chunk** — it drops in Chunk 3 when the validator rule lands.

- [x] **Step 2: Run all 7 agent-handler tests to verify behavior preservation**

Run: `npx vitest run src/attractor/tests/agent-handler.test.ts src/attractor/tests/agent-handler-interactive.test.ts src/attractor/tests/agent-handler-deep-loop.test.ts src/attractor/tests/agent-handler-frontmatter-jsonschema.test.ts src/attractor/tests/agent-handler-inputs.test.ts src/attractor/tests/agent-handler-json-constraint.test.ts src/attractor/tests/agent-handler-retry.test.ts`
Expected: PASS (all suites green; no test edits in this chunk).

- [x] **Step 3: Run prep test (still green)**

Run: `npx vitest run src/attractor/tests/agent-prep.test.ts`
Expected: PASS.

- [x] **Step 4: TypeScript check**

Run: `npx tsc --noEmit`
Expected: clean (no diagnostics).

- [x] **Step 5: Commit**

```bash
git add src/attractor/handlers/agent-prep.ts src/attractor/handlers/agent-handler.ts src/attractor/tests/agent-prep.test.ts
git commit -m "refactor(handlers): extract assembleAgentPrompt into agent-prep.ts

AgentHandler.execute() now delegates the prompt-assembly prep
(loadAgent, MCP swap, system-injected vars merge, defaults
extraction, inputs-renderer, preamble + JSON-schema wrap, prompt.md
write, Agent instantiation) to a free function. Both branches of
execute() consume the same PreparedAgent struct. SYSTEM_INJECTED_VARS
is re-exported from agent-handler.ts for graph.ts back-compat.

No behavior change. All 7 agent-handler-*.test.ts suites pass
unchanged."
```

## Verification targets

- Smokes: `pipelines/smoke/*.dot` — `None` exercised in this chunk
- Manual exercises: `None`
- Lint: `npx tsc --noEmit` + `npx vitest run src/attractor/tests/agent-handler*.test.ts src/attractor/tests/agent-prep.test.ts`
- Surfaces touched: `handler module`

---

## Chunk 2: Split into `InteractiveAgentHandler` + `LoopingAgentHandler` + `AgentHandlerDispatch`

**Goal of this chunk:** Create two new handlers and a dispatch shim. Wire them into `engine.ts`'s `buildHandlerMap`. Retarget the seven `agent-handler-*.test.ts` files at the new classes. Delete `agent-handler.ts`. Update `graph.ts`'s `SYSTEM_INJECTED_VARS` import to point at `agent-prep.ts`. **The runtime `if (jsonSchema)` guard at the start of the interactive branch stays in this chunk** — it drops in Chunk 3 when the validator rule lands.

**Why second:** The shared prep is in place from Chunk 1. The split now mechanically partitions the remainder of the original `execute()` body across two new handler classes; the dispatch shim makes the seam visible at the registry.

**Files:**
- Create: `src/attractor/handlers/interactive-agent-handler.ts`
- Create: `src/attractor/handlers/looping-agent-handler.ts`
- Create: `src/attractor/handlers/agent-dispatch.ts`
- Modify: `src/attractor/core/engine.ts`
- Modify: `src/attractor/core/graph.ts` (`SYSTEM_INJECTED_VARS` import path only)
- Modify: `src/attractor/tests/agent-handler.test.ts`
- Modify: `src/attractor/tests/agent-handler-interactive.test.ts`
- Modify: `src/attractor/tests/agent-handler-deep-loop.test.ts`
- Modify: `src/attractor/tests/agent-handler-frontmatter-jsonschema.test.ts`
- Modify: `src/attractor/tests/agent-handler-inputs.test.ts`
- Modify: `src/attractor/tests/agent-handler-json-constraint.test.ts`
- Modify: `src/attractor/tests/agent-handler-retry.test.ts`
- Delete: `src/attractor/handlers/agent-handler.ts`

### Task 2.1: Create `InteractiveAgentHandler`

**Files:**
- Create: `src/attractor/handlers/interactive-agent-handler.ts`
- Test: `src/attractor/tests/interactive-agent-handler.test.ts` (new)

- [x] **Step 1: Write a failing import test**

Create `src/attractor/tests/interactive-agent-handler.test.ts` with this minimal smoke test (the bulk of behavior coverage will land via the retargeted `agent-handler-interactive.test.ts` in Task 2.5):

```ts
import { describe, it, expect } from "vitest";
import { InteractiveAgentHandler } from "../handlers/interactive-agent-handler.js";

describe("InteractiveAgentHandler", () => {
  it("is a NodeHandler with execute() method", () => {
    const h = new InteractiveAgentHandler();
    expect(typeof h.execute).toBe("function");
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/attractor/tests/interactive-agent-handler.test.ts`
Expected: FAIL with `Cannot find module '../handlers/interactive-agent-handler.js'`.

- [x] **Step 3: Create the file**

Create `src/attractor/handlers/interactive-agent-handler.ts`. Lift the interactive branch body from `agent-handler.ts:126-186` (the version after Chunk 1's refactor):

```ts
import { writeFileSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import type { NodeHandler, HandlerExecutionContext } from "./registry.js";
import type { Node, Outcome, PipelineContext } from "../types.js";
import { Agent, type AgentConfig, type ChildHandle } from "../../cli/lib/agent.js";
import { loadAgent as defaultLoadAgent } from "../../cli/lib/agent-loader.js";
import { Session, buildSessionDigest } from "../../cli/lib/session.js";
import { assembleAgentPrompt } from "./agent-prep.js";

export interface InteractiveAgentHandlerDeps {
  loadAgent?: (name: string, pipelineDir: string) => AgentConfig;
  createAgent?: (config: AgentConfig) => Agent;
}

export class InteractiveAgentHandler implements NodeHandler {
  private load: (name: string, pipelineDir: string) => AgentConfig;
  private create: (config: AgentConfig) => Agent;

  constructor(deps?: InteractiveAgentHandlerDeps) {
    this.load = deps?.loadAgent ?? defaultLoadAgent;
    this.create = deps?.createAgent ?? ((c) => new Agent(c));
  }

  async execute(node: Node, ctx: PipelineContext, meta: HandlerExecutionContext): Promise<Outcome> {
    const prep = assembleAgentPrompt(node, ctx, meta, this.load, this.create);
    if ("fail" in prep) return { status: "fail", failureReason: prep.fail };
    const { agent, jsonSchema, agentVariables, prompt, nodeDir } = prep;
    const { cwd, onInteractiveRequest } = meta;

    // Runtime guard kept this chunk; dropped in Chunk 3 when validator rule lands.
    if (jsonSchema) {
      return {
        status: "fail",
        failureReason: "interactive=true cannot be combined with outputs: structured output is incompatible with live chat streaming",
      };
    }

    const sessionId = randomUUID();
    const session = new Session(sessionId);
    const systemPrompt = prompt;

    const child: ChildHandle = agent.runInteractive({
      session,
      systemPrompt,
      cwd,
      variables: agentVariables,
    });

    if (!onInteractiveRequest) {
      try { await child.kill("SIGKILL"); } catch {}
      return {
        status: "fail",
        failureReason: "interactive=true node requires onInteractiveRequest in engine options",
      };
    }

    await onInteractiveRequest({ session, child, tracePath: nodeDir });

    try {
      await Promise.race([
        child.exited,
        new Promise<void>((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000)),
      ]);
    } catch {
      try { await child.kill("SIGKILL"); } catch {}
    }

    const digest = buildSessionDigest(session);
    const prefix = node.id;
    const contextUpdates: Record<string, unknown> = {
      [`${prefix}.output`]: digest.output,
      [`${prefix}.success`]: digest.success,
      [`${prefix}.turnsUsed`]: digest.turnsUsed,
      [`${prefix}.sessionId`]: digest.sessionId,
      [`${prefix}.exitReason`]: digest.exitReason,
      [`${prefix}.transcriptPath`]: digest.transcriptPath,
      [`${prefix}.digest`]: digest.digest,
    };

    writeFileSync(join(nodeDir, "digest.json"), JSON.stringify(digest, null, 2));

    return {
      status: digest.success ? "success" : "fail",
      failureReason: digest.success ? undefined : `Interactive session ended with ${digest.exitReason}`,
      contextUpdates,
    };
  }
}
```

- [x] **Step 4: Run smoke test to verify it passes**

Run: `npx vitest run src/attractor/tests/interactive-agent-handler.test.ts`
Expected: PASS.

### Task 2.2: Create `LoopingAgentHandler`

**Files:**
- Create: `src/attractor/handlers/looping-agent-handler.ts`
- Test: `src/attractor/tests/looping-agent-handler.test.ts` (new)

- [x] **Step 1: Write a failing import test**

Create `src/attractor/tests/looping-agent-handler.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { LoopingAgentHandler } from "../handlers/looping-agent-handler.js";

describe("LoopingAgentHandler", () => {
  it("is a NodeHandler with execute() method", () => {
    const h = new LoopingAgentHandler();
    expect(typeof h.execute).toBe("function");
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/attractor/tests/looping-agent-handler.test.ts`
Expected: FAIL with `Cannot find module '../handlers/looping-agent-handler.js'`.

- [x] **Step 3: Create the file**

Create `src/attractor/handlers/looping-agent-handler.ts`. Lift the looping branch body from `agent-handler.ts:189-342`:

```ts
import { writeFileSync } from "fs";
import { join } from "path";
import type { NodeHandler, HandlerExecutionContext } from "./registry.js";
import type { Node, Outcome, PipelineContext } from "../types.js";
import { Agent, type AgentConfig } from "../../cli/lib/agent.js";
import { loadAgent as defaultLoadAgent } from "../../cli/lib/agent-loader.js";
import { outputsToZod } from "../../cli/lib/outputs-to-zod.js";
import { buildCorrectiveMessage } from "../../cli/lib/corrective-message.js";
import { evaluateAgentOutput } from "./evaluate-agent-output.js";
import { assembleAgentPrompt } from "./agent-prep.js";

export interface LoopingAgentHandlerDeps {
  loadAgent?: (name: string, pipelineDir: string) => AgentConfig;
  createAgent?: (config: AgentConfig) => Agent;
}

export class LoopingAgentHandler implements NodeHandler {
  private load: (name: string, pipelineDir: string) => AgentConfig;
  private create: (config: AgentConfig) => Agent;

  constructor(deps?: LoopingAgentHandlerDeps) {
    this.load = deps?.loadAgent ?? defaultLoadAgent;
    this.create = deps?.createAgent ?? ((c) => new Agent(c));
  }

  async execute(node: Node, ctx: PipelineContext, meta: HandlerExecutionContext): Promise<Outcome> {
    const prep = assembleAgentPrompt(node, ctx, meta, this.load, this.create);
    if ("fail" in prep) return { status: "fail", failureReason: prep.fail };
    const { agent, config, jsonSchema, agentVariables, nodeDir } = prep;
    const { cwd, signal, onStdout } = meta;

    const nodeCapRaw = node.maxIterations;
    const nodeCapParsed = typeof nodeCapRaw === "string" ? parseInt(nodeCapRaw, 10)
                        : typeof nodeCapRaw === "number"  ? nodeCapRaw
                        : undefined;
    const nodeCapValid = nodeCapParsed != null && !isNaN(nodeCapParsed) && nodeCapParsed >= 0;

    const agentCap = config.maxIterations;
    const loopMode = config.loop === true;

    const maxIterations =
      nodeCapValid
        ? (nodeCapParsed === 0 ? Infinity : nodeCapParsed!)
        : (typeof agentCap === "number" && agentCap >= 0
            ? (agentCap === 0 ? Infinity : agentCap)
            : (loopMode ? Infinity : 1));

    let lastSessionId: string | null = null;
    let iteration = 0;

    let lastParsed: Record<string, unknown> | null = null;
    let preferredLabel: string | undefined;

    const zodSchema = (jsonSchema && config.outputs) ? outputsToZod(config.outputs) : null;

    const overrideRetries = (node as Record<string, unknown>).outputValidationRetries;
    const maxRetries = typeof overrideRetries === "number" && overrideRetries >= 0 ? overrideRetries : 1;

    const writeRaw = (n: number, raw: string) =>
      writeFileSync(join(nodeDir, `raw-attempt-${n}.txt`), raw ?? "");

    const baseAgentVariables: Record<string, unknown> = { ...agentVariables };
    const agentDeclaresNote =
      !!config.outputs && Object.prototype.hasOwnProperty.call(config.outputs, "note");
    let prevNote = "";

    const metaPrefix = node.id;
    const agentName = node.agent ?? "implement";

    for (let i = 0; i < maxIterations; i++) {
      if (signal?.aborted) break;
      if (i > 0) meta.onIterationStart?.(node.id, i);

      const iterVariables = agentDeclaresNote
        ? { ...baseAgentVariables, prev_note: prevNote }
        : baseAgentVariables;

      let result = await agent.run({ cwd, signal, variables: iterVariables, onStdout });
      iteration++;
      if (result.sessionId) lastSessionId = result.sessionId;

      if (result.exitCode !== 0) {
        return {
          status: "fail",
          failureReason: `Agent "${agentName}" exited with code ${result.exitCode}`,
          contextUpdates: {
            [`${metaPrefix}.iterations`]: String(iteration),
            [`${metaPrefix}.success`]: "false",
          },
        };
      }

      let parsed: Record<string, unknown> | undefined;
      if (jsonSchema) {
        writeRaw(1, result.output ?? "");
        let attempt = 1;
        let evaluation = evaluateAgentOutput(result.output ?? "", zodSchema);

        while (!evaluation.ok && attempt <= maxRetries) {
          meta.onValidationFailure?.({
            attempt,
            errors: evaluation.errors,
            rawOutputPath: `${node.id}/raw-attempt-${attempt}.txt`,
          });
          if (!lastSessionId) {
            return {
              status: "fail",
              failureReason:
                `Output validation failed and cannot retry: agent did not report sessionId ` +
                `(iter ${i + 1} attempt ${attempt}: ${evaluation.errors.map(e => `${e.path}: ${e.message}`).join("; ")})`,
              contextUpdates: { [`${metaPrefix}.iterations`]: String(iteration), [`${metaPrefix}.success`]: "false" },
            };
          }
          attempt += 1;
          meta.onValidationRetryStart?.(node.id, attempt);
          const corrective = buildCorrectiveMessage(evaluation.raw, evaluation.errors, jsonSchema);
          const retryResult = await agent.run({
            cwd, signal, variables: iterVariables, onStdout,
            resume: lastSessionId, message: corrective,
          });
          result = retryResult;
          if (retryResult.sessionId) lastSessionId = retryResult.sessionId;
          writeRaw(attempt, retryResult.output ?? "");
          evaluation = evaluateAgentOutput(retryResult.output ?? "", zodSchema);
        }

        if (!evaluation.ok) {
          meta.onValidationFailure?.({
            attempt,
            errors: evaluation.errors,
            rawOutputPath: `${node.id}/raw-attempt-${attempt}.txt`,
          });
          return {
            status: "fail",
            failureReason:
              `Output validation failed in iteration ${i + 1} after ${attempt} attempts: ` +
              evaluation.errors.map(e => `${e.path}: ${e.message}`).join("; "),
            contextUpdates: { [`${metaPrefix}.iterations`]: String(iteration), [`${metaPrefix}.success`]: "false" },
          };
        }

        parsed = evaluation.parsed as Record<string, unknown>;
        lastParsed = parsed;
        if (parsed.preferred_label != null) preferredLabel = String(parsed.preferred_label);
      }

      if (agentDeclaresNote && parsed && typeof parsed.note === "string") {
        prevNote = parsed.note;
      }

      const willBreak = parsed?.done === true;
      if (willBreak) break;

      const willContinue = !signal?.aborted && i < maxIterations - 1;
      if (willContinue) meta.onIterationEnd?.(node.id, i);
    }

    let structuredUpdates: Record<string, unknown> = {};
    if (lastParsed) {
      for (const [key, value] of Object.entries(lastParsed)) {
        const outKey = `${metaPrefix}.${key}`;
        structuredUpdates[outKey] = typeof value === "string" ? value : String(value);
      }
    }

    return {
      status: "success",
      ...(preferredLabel ? { preferredLabel } : {}),
      contextUpdates: {
        ...structuredUpdates,
        [`${metaPrefix}.iterations`]: String(iteration),
        [`${metaPrefix}.success`]: "true",
        ...(lastSessionId ? { [`${metaPrefix}.sessionId`]: lastSessionId } : {}),
      },
    };
  }
}
```

- [x] **Step 4: Run smoke test to verify it passes**

Run: `npx vitest run src/attractor/tests/looping-agent-handler.test.ts`
Expected: PASS.

### Task 2.3: Create `AgentHandlerDispatch`

**Files:**
- Create: `src/attractor/handlers/agent-dispatch.ts`
- Test: `src/attractor/tests/agent-dispatch.test.ts` (new)

- [x] **Step 1: Write the failing test**

Create `src/attractor/tests/agent-dispatch.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { AgentHandlerDispatch } from "../handlers/agent-dispatch.js";
import type { NodeHandler } from "../handlers/registry.js";
import type { Node } from "../types.js";

function makeStubHandler(label: string): NodeHandler {
  return {
    execute: vi.fn().mockResolvedValue({ status: "success", contextUpdates: { from: label } }),
  };
}

describe("AgentHandlerDispatch", () => {
  it("routes interactive=true (boolean) to interactive handler", async () => {
    const interactive = makeStubHandler("interactive");
    const looping = makeStubHandler("looping");
    const dispatch = new AgentHandlerDispatch(interactive, looping);
    const node: Node = { id: "n1", interactive: true };
    const out = await dispatch.execute(node, { values: {} }, {} as any);
    expect(interactive.execute).toHaveBeenCalledOnce();
    expect(looping.execute).not.toHaveBeenCalled();
    expect(out.contextUpdates).toEqual({ from: "interactive" });
  });

  it('routes interactive="true" (string, DOT-coerced) to interactive handler', async () => {
    const interactive = makeStubHandler("interactive");
    const looping = makeStubHandler("looping");
    const dispatch = new AgentHandlerDispatch(interactive, looping);
    const node: Node = { id: "n1", interactive: "true" };
    await dispatch.execute(node, { values: {} }, {} as any);
    expect(interactive.execute).toHaveBeenCalledOnce();
    expect(looping.execute).not.toHaveBeenCalled();
  });

  it("routes missing/false interactive to looping handler", async () => {
    const interactive = makeStubHandler("interactive");
    const looping = makeStubHandler("looping");
    const dispatch = new AgentHandlerDispatch(interactive, looping);
    await dispatch.execute({ id: "n1" } as Node, { values: {} }, {} as any);
    await dispatch.execute({ id: "n2", interactive: false } as Node, { values: {} }, {} as any);
    expect(interactive.execute).not.toHaveBeenCalled();
    expect(looping.execute).toHaveBeenCalledTimes(2);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/attractor/tests/agent-dispatch.test.ts`
Expected: FAIL with `Cannot find module '../handlers/agent-dispatch.js'`.

- [x] **Step 3: Create `agent-dispatch.ts`**

Create `src/attractor/handlers/agent-dispatch.ts`:

```ts
import type { NodeHandler, HandlerExecutionContext } from "./registry.js";
import type { Node, Outcome, PipelineContext } from "../types.js";

export class AgentHandlerDispatch implements NodeHandler {
  constructor(
    private readonly interactive: NodeHandler,
    private readonly looping: NodeHandler,
  ) {}

  async execute(node: Node, ctx: PipelineContext, meta: HandlerExecutionContext): Promise<Outcome> {
    // DOT attributes parse as strings; coerce explicitly to boolean.
    const isInteractive = node.interactive === true || node.interactive === "true";
    return isInteractive
      ? this.interactive.execute(node, ctx, meta)
      : this.looping.execute(node, ctx, meta);
  }
}
```

- [x] **Step 4: Run dispatch test to verify it passes**

Run: `npx vitest run src/attractor/tests/agent-dispatch.test.ts`
Expected: PASS (3 tests).

### Task 2.4: Wire dispatch into `engine.ts`

**Files:**
- Modify: `src/attractor/core/engine.ts:15` (import) and `:47-63` (`buildHandlerMap`)

- [x] **Step 1: Replace the import**

In `src/attractor/core/engine.ts`, replace line 15:

```ts
import { AgentHandler } from "../handlers/agent-handler.js";
```

with:

```ts
import { InteractiveAgentHandler } from "../handlers/interactive-agent-handler.js";
import { LoopingAgentHandler } from "../handlers/looping-agent-handler.js";
import { AgentHandlerDispatch } from "../handlers/agent-dispatch.js";
```

- [x] **Step 2: Update `buildHandlerMap`**

Replace lines 47-63 (the entire `buildHandlerMap` body):

```ts
function buildHandlerMap(opts: EngineOptions): Map<string, NodeHandler> {
  const m = new Map<string, NodeHandler>();
  const interactiveAgent = new InteractiveAgentHandler();
  const loopingAgent = new LoopingAgentHandler();
  const agentDispatch = new AgentHandlerDispatch(interactiveAgent, loopingAgent);
  m.set("start", new StartHandler());
  m.set("exit", new ExitHandler());
  m.set("codergen", agentDispatch);
  m.set("conditional", new ConditionalHandler());
  m.set("wait.human", new WaitHumanHandler(opts.interviewer, opts.dotDir));
  m.set("tool", new ToolHandler());
  m.set("ralph.implement", agentDispatch);
  m.set("ralph.meditate", new RalphMeditateHandler());
  m.set("parallel", new ParallelHandler());
  m.set("parallel.fan_in", new FanInHandler());
  m.set("store", new StoreHandler());
  m.set("agent", agentDispatch);
  return m;
}
```

- [x] **Step 3: TypeScript check**

Run: `npx tsc --noEmit`
Expected: clean.

- [x] **Step 4: Run engine-touching smoke tests**

Run: `npx vitest run src/cli/tests/pipeline-smoke-agent-implement-folder.test.ts src/cli/tests/pipeline-smoke-agent-json-vars-folder.test.ts src/cli/tests/pipeline-smoke-chat-end-to-end-folder.test.ts src/cli/tests/pipeline-smoke-chat-only-folder.test.ts`
Expected: PASS — these exercise the dispatch path through `agent`, `chat-only`, and JSON-vars graphs.

### Task 2.5: Retarget the seven agent-handler test files

**Why:** The tests assert behavior against an `AgentHandler` instance. After Chunk 2's split, that class no longer exists; each test file targets either `InteractiveAgentHandler` or `LoopingAgentHandler` (per design §4 table).

**Files to retarget at `LoopingAgentHandler`:**
- `src/attractor/tests/agent-handler.test.ts`
- `src/attractor/tests/agent-handler-deep-loop.test.ts`
- `src/attractor/tests/agent-handler-frontmatter-jsonschema.test.ts`
- `src/attractor/tests/agent-handler-inputs.test.ts`
- `src/attractor/tests/agent-handler-json-constraint.test.ts`
- `src/attractor/tests/agent-handler-retry.test.ts`

**Files to retarget at `InteractiveAgentHandler`:**
- `src/attractor/tests/agent-handler-interactive.test.ts`

- [x] **Step 1: Retarget all six looping test files**

For each of the six files above, perform the following two edits (the assertions remain unchanged — only the import and the `new AgentHandler(...)` constructor call change):

1. Replace the import line `import { AgentHandler } from "../handlers/agent-handler.js";` with `import { LoopingAgentHandler } from "../handlers/looping-agent-handler.js";`
2. Replace every occurrence of `new AgentHandler(` with `new LoopingAgentHandler(` in the file. The constructor signature `{ loadAgent, createAgent }` is identical (preserved on the new handler class).

Use Grep+Edit per file. For example, for `src/attractor/tests/agent-handler-deep-loop.test.ts`, you would run two `Edit` calls (one for the import, one for `replace_all: true` on the constructor call).

- [x] **Step 2: Retarget `agent-handler-interactive.test.ts`**

Apply the same two-step edit, but with `InteractiveAgentHandler` instead of `LoopingAgentHandler`. Additionally, **the `it("passes non-interactive nodes through the legacy path unchanged", ...)` case (lines 91-110 of the current file) MUST be deleted** — the new `InteractiveAgentHandler` no longer has a non-interactive code path; that case now lives in `agent-dispatch.test.ts` (Task 2.3) and the looping tests. Open the file, locate the test by description, and delete it.

- [x] **Step 3: Run all retargeted tests to verify they pass**

Run: `npx vitest run src/attractor/tests/agent-handler.test.ts src/attractor/tests/agent-handler-interactive.test.ts src/attractor/tests/agent-handler-deep-loop.test.ts src/attractor/tests/agent-handler-frontmatter-jsonschema.test.ts src/attractor/tests/agent-handler-inputs.test.ts src/attractor/tests/agent-handler-json-constraint.test.ts src/attractor/tests/agent-handler-retry.test.ts`
Expected: PASS (all 7 suites green).

### Task 2.6: Retarget `graph.ts` import + delete `agent-handler.ts`

**Files:**
- Modify: `src/attractor/core/graph.ts:17`
- Delete: `src/attractor/handlers/agent-handler.ts`

- [x] **Step 1: Update `graph.ts` to import `SYSTEM_INJECTED_VARS` from `agent-prep.ts`**

In `src/attractor/core/graph.ts:17`, replace:

```ts
import { SYSTEM_INJECTED_VARS } from "../handlers/agent-handler.js";
```

with:

```ts
import { SYSTEM_INJECTED_VARS } from "../handlers/agent-prep.js";
```

- [x] **Step 2: Verify no other imports reference `agent-handler.js`**

Run: `grep -rn 'from "[^"]*agent-handler' src/ --include='*.ts'`
Expected: zero hits in `src/` (the import in `engine.ts` was updated in Task 2.4; the import in `graph.ts` was updated in Step 1; the seven retargeted tests no longer reference it).

If the grep returns matches, follow each one and update. There MUST be zero references before deleting the file.

- [x] **Step 3: Delete `agent-handler.ts`**

Run: `rm src/attractor/handlers/agent-handler.ts`

- [x] **Step 4: TypeScript check**

Run: `npx tsc --noEmit`
Expected: clean — no missing imports, no orphan exports.

- [x] **Step 5: Run the full vitest suite**

Run: `npx vitest run`
Expected: ALL PASS. Specifically: 7 retargeted handler tests, the new `agent-prep.test.ts`, the new `interactive-agent-handler.test.ts`, the new `looping-agent-handler.test.ts`, the new `agent-dispatch.test.ts`, all 14 `pipeline-smoke-*-folder.test.ts`, and every other suite.

- [x] **Step 6: Commit**

```bash
git add src/attractor/handlers/interactive-agent-handler.ts src/attractor/handlers/looping-agent-handler.ts src/attractor/handlers/agent-dispatch.ts src/attractor/core/engine.ts src/attractor/core/graph.ts src/attractor/tests/agent-handler.test.ts src/attractor/tests/agent-handler-interactive.test.ts src/attractor/tests/agent-handler-deep-loop.test.ts src/attractor/tests/agent-handler-frontmatter-jsonschema.test.ts src/attractor/tests/agent-handler-inputs.test.ts src/attractor/tests/agent-handler-json-constraint.test.ts src/attractor/tests/agent-handler-retry.test.ts src/attractor/tests/interactive-agent-handler.test.ts src/attractor/tests/looping-agent-handler.test.ts src/attractor/tests/agent-dispatch.test.ts
git rm src/attractor/handlers/agent-handler.ts
git commit -m "refactor(handlers): split AgentHandler into Interactive + Looping behind dispatch shim

Replaces the ~290-line AgentHandler.execute() (whose own line-187
comment named the second half 'legacy') with two focused handlers
sharing assembleAgentPrompt() from agent-prep.ts:

- InteractiveAgentHandler (Session + runInteractive + digest)
- LoopingAgentHandler (maxIterations + iteration loop + retry +
  prev_note + done-break)
- AgentHandlerDispatch (routes per-call on node.interactive)

engine.buildHandlerMap registers one shared dispatch instance for
'codergen', 'ralph.implement', and 'agent' semantic-name keys.
graph.ts SYSTEM_INJECTED_VARS import retargeted at agent-prep.ts.
agent-handler.ts deleted.

7 agent-handler-*.test.ts files retargeted at the new classes
(import swap + constructor rename); the runtime-jsonSchema-fail
case in agent-handler-interactive.test.ts is kept this chunk and
removed in Chunk 3 when the validator rule lands."
```

## Verification targets

- Smokes: `src/cli/tests/pipeline-smoke-agent-implement-folder.test.ts`, `src/cli/tests/pipeline-smoke-agent-json-vars-folder.test.ts`, `src/cli/tests/pipeline-smoke-chat-end-to-end-folder.test.ts`, `src/cli/tests/pipeline-smoke-chat-only-folder.test.ts`
- Manual exercises: `None` (no user-visible surface change in this chunk)
- Lint: `npx tsc --noEmit` + `npx vitest run`
- Surfaces touched: `handler module`, `core engine registry`, `test suite`

---

## Chunk 3: Promote runtime guards to graph validator rules

**Goal of this chunk:** Add two new graph validator rules in `src/attractor/core/graph.ts`:

1. `interactive_with_outputs_forbidden` — fires when a node sets `interactive=true` and its agent's frontmatter declares `outputs:` (a non-empty `outputs:` block, or any `jsonSchema`/`outputs` value that would cause `assembleAgentPrompt` to set `prep.jsonSchema`).
2. `interactive_with_loop_forbidden` — fires when a node sets `interactive=true` AND any of: `node.loop=true`, `node.maxIterations` parses to a number > 1, `agent.loop=true`, `agent.maxIterations` is a number > 1.

After the rules land, **drop the runtime `if (jsonSchema)` guard** from `interactive-agent-handler.ts` (the case kept in Chunk 2). The runtime fail string disappears; the validator rule fires earlier with file:line:col anchors.

**Why third:** The split must land first so the runtime guard lives in `interactive-agent-handler.ts` (single concrete handler), making its removal a one-line cleanup. The validator rules need agent-frontmatter access via `loadAgent`, which is already in scope per `src/attractor/core/graph.ts:11` (`import { loadAgent } from "../../cli/lib/agent-loader.js"`) and the `tryResolveAgent` helper at `:765-772`.

**Files:**
- Modify: `src/attractor/core/graph.ts`
- Modify: `src/attractor/handlers/interactive-agent-handler.ts` (remove jsonSchema guard)
- Modify: `src/attractor/tests/agent-handler-interactive.test.ts` (delete the jsonSchema-runtime-fail case)
- Test: `src/attractor/tests/graph-interactive-with-outputs-forbidden.test.ts` (new)
- Test: `src/attractor/tests/graph-interactive-with-loop-forbidden.test.ts` (new)

### Task 3.1: New rule `interactive_with_outputs_forbidden`

**Files:**
- Test: `src/attractor/tests/graph-interactive-with-outputs-forbidden.test.ts` (new)
- Modify: `src/attractor/core/graph.ts`

- [ ] **Step 1: Write the failing test**

First, look at one existing rule test to mirror its conventions for fixture setup. Locate an existing `graph-*.test.ts` file via `Glob src/attractor/tests/graph-*.test.ts` and read it (e.g. `graph-validator-loop-done.test.ts` if present). Mirror its fixture pattern: create a temp dir, write a `.dot` graph + a sibling agent `.md` file, call `validateGraph(parseDot(...), tmpdir)`, and inspect the returned `Diagnostic[]`.

Create `src/attractor/tests/graph-interactive-with-outputs-forbidden.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { validateGraph } from "../core/graph.js";
import { parseDot } from "../core/parse-dot.js";

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "ralph-vrule-"));
  return {
    dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
    writeAgent: (name: string, frontmatter: string, body = "agent body\n") => {
      writeFileSync(join(dir, `${name}.md`), `---\n${frontmatter}---\n\n${body}`);
    },
    writeDot: (dot: string) => {
      writeFileSync(join(dir, "g.dot"), dot);
    },
  };
}

describe("interactive_with_outputs_forbidden", () => {
  it("fires when interactive=true node uses an agent with outputs:", () => {
    const { dir, cleanup, writeAgent, writeDot } = setup();
    try {
      writeAgent("chat", `name: chat\nmodel: opus\noutputs:\n  note: string\n`);
      writeDot(`digraph G {\n  start [shape=Mdiamond];\n  n1 [agent="chat" interactive=true];\n  end [shape=Msquare];\n  start -> n1 -> end;\n}\n`);
      const graph = parseDot(join(dir, "g.dot"));
      const diags = validateGraph(graph, dir);
      const fired = diags.find(d => d.rule === "interactive_with_outputs_forbidden");
      expect(fired).toBeDefined();
      expect(fired!.severity).toBe("error");
      expect(fired!.message).toContain("n1");
      expect(fired!.message).toContain("chat");
      expect(fired!.location).toBeDefined();
    } finally {
      cleanup();
    }
  });

  it("does NOT fire when interactive=true node uses an agent without outputs:", () => {
    const { dir, cleanup, writeAgent, writeDot } = setup();
    try {
      writeAgent("chat", `name: chat\nmodel: opus\n`);
      writeDot(`digraph G {\n  start [shape=Mdiamond];\n  n1 [agent="chat" interactive=true];\n  end [shape=Msquare];\n  start -> n1 -> end;\n}\n`);
      const graph = parseDot(join(dir, "g.dot"));
      const diags = validateGraph(graph, dir);
      expect(diags.find(d => d.rule === "interactive_with_outputs_forbidden")).toBeUndefined();
    } finally {
      cleanup();
    }
  });

  it("does NOT fire when agent has outputs: but node is non-interactive", () => {
    const { dir, cleanup, writeAgent, writeDot } = setup();
    try {
      writeAgent("worker", `name: worker\nmodel: opus\noutputs:\n  note: string\n  done: boolean\n`);
      writeDot(`digraph G {\n  start [shape=Mdiamond];\n  n1 [agent="worker"];\n  end [shape=Msquare];\n  start -> n1 -> end;\n}\n`);
      const graph = parseDot(join(dir, "g.dot"));
      const diags = validateGraph(graph, dir);
      expect(diags.find(d => d.rule === "interactive_with_outputs_forbidden")).toBeUndefined();
    } finally {
      cleanup();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/attractor/tests/graph-interactive-with-outputs-forbidden.test.ts`
Expected: FAIL — the trigger case finds no diagnostic with `rule === "interactive_with_outputs_forbidden"`.

- [ ] **Step 3: Add the rule to `graph.ts`**

In `src/attractor/core/graph.ts`, add a new `checkInteractiveWithOutputs` helper alongside `checkAgentMissingOutputs` and `checkLoopRequiresDoneField` (around line 1025, after `checkAgentMissingOutputs`). Use the same shape as the existing helpers:

```ts
function checkInteractiveWithOutputs(
  node: Node,
  dotDir: string,
  diags: Diagnostic[],
): void {
  if (!node.agent) return;
  if (node.interactive !== true && node.interactive !== "true") return;
  const agentConfig = tryResolveAgent(node, dotDir);
  if (!agentConfig) return;
  const hasOutputs = !!(agentConfig.outputs && Object.keys(agentConfig.outputs).length > 0);
  if (!hasOutputs) return;
  diags.push({
    rule: "interactive_with_outputs_forbidden",
    severity: "error",
    message: `Node "${node.id}" sets interactive=true but agent "${node.agent}" declares outputs:; structured output is incompatible with live chat streaming`,
    location: node.sourceLocation,
  });
}
```

Then call it from the per-node validation loop where `checkAgentMissingOutputs` and `checkLoopRequiresDoneField` are called. Locate that loop (search `checkLoopRequiresDoneField(node, dotDir, diags)` in `graph.ts`) and add `checkInteractiveWithOutputs(node, dotDir, diags);` immediately after the existing call.

- [ ] **Step 4: Run rule test to verify it passes**

Run: `npx vitest run src/attractor/tests/graph-interactive-with-outputs-forbidden.test.ts`
Expected: PASS (3 cases).

### Task 3.2: New rule `interactive_with_loop_forbidden`

**Files:**
- Test: `src/attractor/tests/graph-interactive-with-loop-forbidden.test.ts` (new)
- Modify: `src/attractor/core/graph.ts`

- [ ] **Step 1: Write the failing test**

Create `src/attractor/tests/graph-interactive-with-loop-forbidden.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { validateGraph } from "../core/graph.js";
import { parseDot } from "../core/parse-dot.js";

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "ralph-vrule-"));
  return {
    dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
    writeAgent: (name: string, frontmatter: string, body = "agent body\n") => {
      writeFileSync(join(dir, `${name}.md`), `---\n${frontmatter}---\n\n${body}`);
    },
    writeDot: (dot: string) => writeFileSync(join(dir, "g.dot"), dot),
  };
}

describe("interactive_with_loop_forbidden", () => {
  it("fires when interactive=true + node loop=true", () => {
    const { dir, cleanup, writeAgent, writeDot } = setup();
    try {
      writeAgent("chat", `name: chat\nmodel: opus\n`);
      writeDot(`digraph G {\n  start [shape=Mdiamond];\n  n1 [agent="chat" interactive=true loop=true];\n  end [shape=Msquare];\n  start -> n1 -> end;\n}\n`);
      const graph = parseDot(join(dir, "g.dot"));
      const diags = validateGraph(graph, dir);
      const fired = diags.find(d => d.rule === "interactive_with_loop_forbidden");
      expect(fired).toBeDefined();
      expect(fired!.severity).toBe("error");
      expect(fired!.location).toBeDefined();
    } finally { cleanup(); }
  });

  it("fires when interactive=true + node max_iterations=2", () => {
    const { dir, cleanup, writeAgent, writeDot } = setup();
    try {
      writeAgent("chat", `name: chat\nmodel: opus\n`);
      writeDot(`digraph G {\n  start [shape=Mdiamond];\n  n1 [agent="chat" interactive=true max_iterations=2];\n  end [shape=Msquare];\n  start -> n1 -> end;\n}\n`);
      const graph = parseDot(join(dir, "g.dot"));
      const diags = validateGraph(graph, dir);
      expect(diags.find(d => d.rule === "interactive_with_loop_forbidden")).toBeDefined();
    } finally { cleanup(); }
  });

  it("fires when interactive=true + agent loop:true", () => {
    const { dir, cleanup, writeAgent, writeDot } = setup();
    try {
      writeAgent("looper", `name: looper\nmodel: opus\nloop: true\noutputs:\n  done: boolean\n`);
      writeDot(`digraph G {\n  start [shape=Mdiamond];\n  n1 [agent="looper" interactive=true];\n  end [shape=Msquare];\n  start -> n1 -> end;\n}\n`);
      const graph = parseDot(join(dir, "g.dot"));
      const diags = validateGraph(graph, dir);
      expect(diags.find(d => d.rule === "interactive_with_loop_forbidden")).toBeDefined();
    } finally { cleanup(); }
  });

  it("does NOT fire when interactive=true alone", () => {
    const { dir, cleanup, writeAgent, writeDot } = setup();
    try {
      writeAgent("chat", `name: chat\nmodel: opus\n`);
      writeDot(`digraph G {\n  start [shape=Mdiamond];\n  n1 [agent="chat" interactive=true];\n  end [shape=Msquare];\n  start -> n1 -> end;\n}\n`);
      const graph = parseDot(join(dir, "g.dot"));
      const diags = validateGraph(graph, dir);
      expect(diags.find(d => d.rule === "interactive_with_loop_forbidden")).toBeUndefined();
    } finally { cleanup(); }
  });

  it("does NOT fire when loop=true alone (no interactive)", () => {
    const { dir, cleanup, writeAgent, writeDot } = setup();
    try {
      writeAgent("looper", `name: looper\nmodel: opus\nloop: true\noutputs:\n  done: boolean\n`);
      writeDot(`digraph G {\n  start [shape=Mdiamond];\n  n1 [agent="looper"];\n  end [shape=Msquare];\n  start -> n1 -> end;\n}\n`);
      const graph = parseDot(join(dir, "g.dot"));
      const diags = validateGraph(graph, dir);
      expect(diags.find(d => d.rule === "interactive_with_loop_forbidden")).toBeUndefined();
    } finally { cleanup(); }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/attractor/tests/graph-interactive-with-loop-forbidden.test.ts`
Expected: FAIL — three trigger cases find no diagnostic with `rule === "interactive_with_loop_forbidden"`.

- [ ] **Step 3: Add the rule to `graph.ts`**

In `src/attractor/core/graph.ts`, add a `checkInteractiveWithLoop` helper directly after `checkInteractiveWithOutputs`:

```ts
function checkInteractiveWithLoop(
  node: Node,
  dotDir: string,
  diags: Diagnostic[],
): void {
  if (!node.agent) return;
  if (node.interactive !== true && node.interactive !== "true") return;

  // Node-level loop signals
  const nodeLoopOn = node.loop === true || node.loop === "true";
  const nodeMaxRaw = (node as Record<string, unknown>).maxIterations;
  const nodeMaxParsed =
    typeof nodeMaxRaw === "string" ? parseInt(nodeMaxRaw, 10)
    : typeof nodeMaxRaw === "number" ? nodeMaxRaw
    : undefined;
  const nodeMaxLoops = nodeMaxParsed != null && !isNaN(nodeMaxParsed) && nodeMaxParsed > 1;

  // Agent-level loop signals
  const agentConfig = tryResolveAgent(node, dotDir);
  const agentLoopOn = agentConfig?.loop === true;
  const agentMax = agentConfig?.maxIterations;
  const agentMaxLoops = typeof agentMax === "number" && agentMax > 1;

  if (!(nodeLoopOn || nodeMaxLoops || agentLoopOn || agentMaxLoops)) return;

  diags.push({
    rule: "interactive_with_loop_forbidden",
    severity: "error",
    message: `Node "${node.id}" sets interactive=true with looping (loop=true / maxIterations>1); interactive sessions cannot iterate`,
    location: node.sourceLocation,
  });
}
```

Add the call `checkInteractiveWithLoop(node, dotDir, diags);` in the same per-node loop, immediately after the call to `checkInteractiveWithOutputs` from Task 3.1.

- [ ] **Step 4: Run rule test to verify it passes**

Run: `npx vitest run src/attractor/tests/graph-interactive-with-loop-forbidden.test.ts`
Expected: PASS (5 cases).

### Task 3.3: Drop the runtime `jsonSchema` guard

**Files:**
- Modify: `src/attractor/handlers/interactive-agent-handler.ts`
- Modify: `src/attractor/tests/agent-handler-interactive.test.ts`

- [ ] **Step 1: Delete the test that asserts the runtime fail string**

Open `src/attractor/tests/agent-handler-interactive.test.ts`. Locate the case `it("rejects interactive=true combined with agent config.jsonSchema", ...)` (originally lines 112-132 in the pre-Chunk-2 file, with the `AgentHandler` reference replaced by `InteractiveAgentHandler` after Chunk 2). Delete that entire `it(...)` block. The validator rule test from Task 3.1 covers the same constraint at the right layer.

- [ ] **Step 2: Run the interactive test to verify it still passes after deletion**

Run: `npx vitest run src/attractor/tests/agent-handler-interactive.test.ts`
Expected: PASS — fewer tests run, all green.

- [ ] **Step 3: Remove the runtime guard from `interactive-agent-handler.ts`**

In `src/attractor/handlers/interactive-agent-handler.ts`, locate the block (added in Chunk 2 Task 2.1):

```ts
    // Runtime guard kept this chunk; dropped in Chunk 3 when validator rule lands.
    if (jsonSchema) {
      return {
        status: "fail",
        failureReason: "interactive=true cannot be combined with outputs: structured output is incompatible with live chat streaming",
      };
    }
```

Delete the entire block (the comment line plus the if-statement). Also remove `jsonSchema` from the destructure on the line above if it is no longer referenced — verify by grepping the file for `jsonSchema` after the delete; if zero hits remain, drop it from `const { agent, jsonSchema, agentVariables, prompt, nodeDir } = prep;` so the file does not declare an unused binding.

- [ ] **Step 4: Run all interactive-handler-touching tests**

Run: `npx vitest run src/attractor/tests/agent-handler-interactive.test.ts src/attractor/tests/interactive-agent-handler.test.ts`
Expected: PASS.

- [ ] **Step 5: TypeScript check**

Run: `npx tsc --noEmit`
Expected: clean (no unused-variable diagnostics).

- [ ] **Step 6: Run the full suite**

Run: `npx vitest run`
Expected: ALL PASS.

- [ ] **Step 7: Commit**

```bash
git add src/attractor/core/graph.ts src/attractor/handlers/interactive-agent-handler.ts src/attractor/tests/agent-handler-interactive.test.ts src/attractor/tests/graph-interactive-with-outputs-forbidden.test.ts src/attractor/tests/graph-interactive-with-loop-forbidden.test.ts
git commit -m "feat(graph): promote interactive mode-confusion guards to validator rules

Adds two new graph validator rules that catch interactive=true
misconfigurations at parse/validate time with file:line:col anchors:

- interactive_with_outputs_forbidden — fires when an interactive
  node references an agent whose frontmatter declares outputs:
  (structured output is incompatible with live chat streaming).
- interactive_with_loop_forbidden — fires when an interactive node
  also has loop=true or maxIterations>1 at either node or agent
  level (interactive sessions cannot iterate).

The runtime if (jsonSchema) guard at the top of the interactive
branch (carried into InteractiveAgentHandler in chunk 2) is now
removed; the corresponding test case is deleted in favor of the
validator-rule test. The interactive=true + loop=true silent no-op
(early-return at the would-be loop body) is now caught at validate
time too.

Both rules use tryResolveAgent + the existing diagnostic shape
{ rule, severity, message, location }. No existing rule is silenced
or re-worded."
```

## Verification targets

- Smokes: `src/cli/tests/pipeline-smoke-chat-end-to-end-folder.test.ts`, `src/cli/tests/pipeline-smoke-chat-only-folder.test.ts` (interactive paths still pass for currently-valid graphs); all 14 `pipeline-smoke-*-folder.test.ts` (no existing graph triggers either new rule)
- Manual exercises: `ralph pipeline validate <bundled-pipeline>` against any bundled pipeline — diagnostic output identical before and after (none of the bundled pipelines combine interactive=true with outputs: or loop:true)
- Lint: `npx tsc --noEmit` + `npx vitest run src/attractor/tests/graph-interactive-*.test.ts src/attractor/tests/agent-handler-interactive.test.ts`
- Surfaces touched: `graph validator`, `handler module`, `test suite`

---

## Chunk 4: Companion cleanup — delete dead `Console` and `Callback` interviewers

**Goal of this chunk:** Delete `src/attractor/interviewer/console.ts` (zero non-defining references in the repo) and `src/attractor/interviewer/callback.ts` (only self-tautological coverage in `interviewer.test.ts`). Trim `src/attractor/tests/interviewer.test.ts` to remove the `CallbackInterviewer` block. Trim `src/attractor/interviewer/index.ts` re-exports. The `Interviewer` interface, `InkInterviewer`, `AutoApproveInterviewer`, and `QueueInterviewer` stay.

**Why last:** Independent of the handler split. Sequenced last so chunks 1-3 can ship even if Chunk 4 surfaces an unexpected dependency.

**Files:**
- Delete: `src/attractor/interviewer/console.ts`
- Delete: `src/attractor/interviewer/callback.ts`
- Modify: `src/attractor/interviewer/index.ts`
- Modify: `src/attractor/tests/interviewer.test.ts`

### Task 4.1: Verify dead-code claim before deleting

**Why:** "Zero non-defining references" is a claim that must be verified at execution time, not memorized from the design doc. A sibling skill or new feature added between design and execution could have started using either class.

- [ ] **Step 1: Grep for `ConsoleInterviewer` references**

Run: `npx grep -rn 'ConsoleInterviewer' src/ --include='*.ts'`
Expected: matches ONLY in `src/attractor/interviewer/console.ts` (the definition) and `src/attractor/interviewer/index.ts` (re-export, if present). If any other file references it, **STOP** and surface to the user — the design doc's premise is invalidated.

- [ ] **Step 2: Grep for `CallbackInterviewer` references**

Run: `npx grep -rn 'CallbackInterviewer' src/ --include='*.ts'`
Expected: matches ONLY in `src/attractor/interviewer/callback.ts` (definition), `src/attractor/interviewer/index.ts` (re-export, if present), and `src/attractor/tests/interviewer.test.ts` (self-tautological tests). Any other reference → STOP, surface to user.

### Task 4.2: Delete the `CallbackInterviewer` test block

**Files:**
- Modify: `src/attractor/tests/interviewer.test.ts`

- [ ] **Step 1: Read the file and locate the `CallbackInterviewer` describe block**

Open `src/attractor/tests/interviewer.test.ts`. Find the `describe("CallbackInterviewer", ...)` block (or `describe.each`/`it` blocks that exercise `CallbackInterviewer`). Note its start and end line.

- [ ] **Step 2: Delete the block**

Use the Edit tool to remove the entire `describe("CallbackInterviewer", ...)` block, including its closing `});`. Also remove the `import { CallbackInterviewer } from ...` import line if it is no longer referenced anywhere else in the file (verify by grepping the file post-edit).

- [ ] **Step 3: Run the trimmed test to verify it passes**

Run: `npx vitest run src/attractor/tests/interviewer.test.ts`
Expected: PASS — Ink, AutoApprove, and Queue interviewer cases remain green.

### Task 4.3: Delete `console.ts` and `callback.ts`

- [ ] **Step 1: Delete the two files**

```bash
rm src/attractor/interviewer/console.ts src/attractor/interviewer/callback.ts
```

- [ ] **Step 2: Trim `interviewer/index.ts` re-exports**

Open `src/attractor/interviewer/index.ts`. Locate any re-export statements for `console` or `callback` modules (e.g., `export * from "./console.js"`, `export { ConsoleInterviewer } from "./console.js"`, or matching lines for `callback`). Delete those lines. Keep:

- The `Interviewer` interface declaration (the deep seam)
- Re-exports of `InkInterviewer`, `AutoApproveInterviewer`, `QueueInterviewer`

- [ ] **Step 3: TypeScript check**

Run: `npx tsc --noEmit`
Expected: clean — no missing imports.

- [ ] **Step 4: Final repo-wide grep — both classes must be gone**

Run: `grep -rn 'ConsoleInterviewer\|CallbackInterviewer' src/ --include='*.ts'`
Expected: ZERO matches in `src/`.

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run`
Expected: ALL PASS.

- [ ] **Step 6: Commit**

```bash
git add src/attractor/interviewer/index.ts src/attractor/tests/interviewer.test.ts
git rm src/attractor/interviewer/console.ts src/attractor/interviewer/callback.ts
git commit -m "chore(interviewer): delete dead ConsoleInterviewer and CallbackInterviewer adapters

ConsoleInterviewer had zero non-defining references in the repo;
CallbackInterviewer was referenced only by self-tautological tests
in interviewer.test.ts. Both adapters are unreachable from
production code (pipeline.ts:374-375 only ever instantiates
InkInterviewer for TTY or AutoApproveInterviewer for headless).

Interviewer interface and the three live adapters (Ink,
AutoApprove, Queue) are kept. The CallbackInterviewer describe
block in interviewer.test.ts is deleted.

Companion cleanup to the AgentHandler split — same shallow-module
rot pattern as the ParallelHandler / ManagerLoopHandler dead-code
findings in illuminations 2026-05-01T0423 and 2026-05-01T0828."
```

## Verification targets

- Smokes: ALL 14 `src/cli/tests/pipeline-smoke-*-folder.test.ts` (no behavior change, but the deletion ripple must not break engine wiring through the interviewer path)
- Manual exercises: `ralph pipeline run <bundled-pipeline>` end-to-end against the implement pipeline — Ink interviewer still loads, AutoApprove still loads in `--no-interactive` mode
- Lint: `npx tsc --noEmit` + `npx vitest run src/attractor/tests/interviewer.test.ts`
- Surfaces touched: `interviewer tier`, `test suite`

---

## Final verification (after all 4 chunks land)

Run these commands in order. They are not part of any chunk — they are the post-merge gate the executing engineer runs before opening the PR.

- [ ] **Static checks (per design §10.1)**

```bash
npx tsc --noEmit
grep -rn 'class AgentHandler\b' src/ --include='*.ts'              # expect zero
grep -rn 'from "[^"]*agent-handler"' src/ --include='*.ts'         # expect zero
grep -rn 'ConsoleInterviewer\|CallbackInterviewer' src/ --include='*.ts'  # expect zero
grep -rn 'class InteractiveAgentHandler' src/ --include='*.ts'     # expect 1
grep -rn 'class LoopingAgentHandler' src/ --include='*.ts'         # expect 1
grep -rn 'class AgentHandlerDispatch' src/ --include='*.ts'        # expect 1
grep -rn 'function assembleAgentPrompt' src/ --include='*.ts'      # expect 1
grep -rn 'interactive_with_outputs_forbidden' src/ --include='*.ts'  # expect >=2 (rule + test)
grep -rn 'interactive_with_loop_forbidden' src/ --include='*.ts'   # expect >=2 (rule + test)
```

- [ ] **Test suite (per design §10.2)**

```bash
npx vitest run
```

Expected: ALL PASS — including all 14 `pipeline-smoke-*-folder.test.ts`, all 7 retargeted `agent-handler-*.test.ts`, the 4 new handler/dispatch/prep tests, the 2 new validator-rule tests, the trimmed `interviewer.test.ts`, and every other suite.

- [ ] **Bundled-pipeline smoke (per design §10.3)**

```bash
npm run build
ralph pipeline validate src/cli/pipelines/implement.dot         # diagnostic output unchanged
ralph pipeline run src/cli/pipelines/implement.dot --max 1      # exit code 0; pipeline.jsonl byte-equivalent (mod timestamps)
```

- [ ] **Squash chunk commits into a single commit (per design §8 single-commit constraint)**

If you committed per-chunk during execution, squash before opening the PR so the diff tells a single story:

```bash
# Replace 4 with the actual count of commits this branch added beyond main
git rebase -i HEAD~4
# In the editor: keep the first commit as 'pick', mark the remaining 3 as 'squash' (or 's')
```

The squash commit message can be the body of the design doc summary (§11) or the writer's choice — what matters is one commit, one story.

---

## Open questions / disagreements with design

- **Single-commit vs per-step commits during execution.** The design's §8 mandates a single commit. TDD discipline calls for green commits between red and refactor, so this plan uses per-step commits with a final squash. If the executing engineer prefers true single-commit execution (writing all chunks before committing), they can stage the final state and skip the per-step `git commit` calls — the verification commands at each step still run, just without intermediate commits.
- **`SYSTEM_INJECTED_VARS` placement.** Design §9 flags this as cosmetic (could move to `src/attractor/core/system-vars.ts` to avoid the validator depending on `agent-prep.ts` just for a constant). This plan keeps it in `agent-prep.ts` and updates `graph.ts:17` to import from there. If the reviewer prefers the dedicated module, the move is a one-file extract + two import retargets — easy follow-up.
- **`AgentHandlerDispatch` location.** Design §9 leaves this as either `engine.ts` or its own file. This plan creates `src/attractor/handlers/agent-dispatch.ts` (own file) so the import shape in `engine.ts` stays clean and the dispatch shim is unit-testable in isolation (Task 2.3).
