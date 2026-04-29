# Deep Loop Nodes Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add agent-driven self-termination for long-running pipeline loops. An agent declares `loop: true` + `done: boolean` in its frontmatter; the handler iterates with fresh contexts and breaks on the agent's `done=true` signal. Replaces manual Ctrl+C as the only termination for `ralph implement`.

**Architecture:** New `loop` and `maxIterations` fields on agent frontmatter (parsed in `validateAgentConfig`); cap cascade `node > agent > (loop ? Infinity : 1)`; handler restructures to parse outputs per iteration (reusing chunk-2's `evaluateAgentOutput`) and break on `done=true`; optional `note` field surfaces as `$prev_note` variable on next iteration via per-iteration variable bag rebuild; new validator rule `loop_missing_done_field`. Composes orthogonally with chunk-2's `--resume`-based validation retry — that loop nests inside each deep-loop iteration.

**Tech Stack:** TypeScript, vitest, zod (existing), `@ts-graphviz/ast` (existing).

**Spec:** `docs/superpowers/specs/2026-04-29-deep-loop-nodes.md`

**Pre-req (already shipped to main):**
- `evaluateAgentOutput` at `src/attractor/handlers/evaluate-agent-output.ts` (chunk-2). Includes `normaliseRaw` so test fixtures can emit either NDJSON or `JSON.stringify([...])` arrays.
- `outputs-to-zod.ts` accepts shorthand `boolean`/`string` and the long form `{type: "boolean"}`.
- `validateAgentConfig` at `src/cli/lib/agent.ts:459` is the canonical agent-config gate; `parseAgentFile` (`src/cli/lib/agent-registry.ts:41`) defers to it via `{ ...attributes, prompt: body }`.

---

## File Structure

| Area | File | Responsibility |
|---|---|---|
| Agent config | `src/cli/lib/agent.ts` | Add `loop?: boolean` and `maxIterations?: number` to `AgentConfig` (lines 48–59) and propagate them through `validateAgentConfig` (lines 459–485) with runtime checks. |
| Validator rule | `src/attractor/core/graph.ts` | Add `checkLoopRequiresDoneField` alongside `checkAgentMissingOutputs`; wire it into the dispatcher at lines 393–398. Modify `checkAgentMissingOutputs` so the `agent_outputs_empty` warning suppresses when `loop:true`. |
| Variable preflight | `src/attractor/transforms/variable-expansion.ts` | When an agent in the graph declares `note: string` in `outputs:`, add `prev_note` to the **producers** set so it does not surface as an undeclared-var diagnostic. |
| Handler | `src/attractor/handlers/agent-handler.ts` | (a) Replace lines 168–174 cap parse with cascade. (b) Move validation+retry block (lines 218–297) inside the iteration loop body. (c) Per-iteration: parse outputs via `evaluateAgentOutput`, read `done`, break on true. (d) Build per-iteration variable bag with `prev_note`. (e) Treat any non-zero exit during deep-loop iteration as hard failure (drop the `maxIterations === 1` guard at line 206). (f) Last iteration's parsed outputs feed `contextUpdates`. |
| Implement agent | `pipelines/illumination-to-implementation/implement.md` | Add `loop: true` and `outputs: { done: boolean }`; update prompt to emit `done` after each iteration. |
| Implement pipeline | `src/cli/pipelines/implement.dot` | Verify shape; no structural change required. |
| Docs | `README.md` | New section: "Deep loop nodes — authoring guide." |

---

## Chunks

1. **Frontmatter parsing for `loop` and `maxIterations`** — extend `validateAgentConfig`; no runtime behavior change yet.
2. **Validator rule `loop_missing_done_field`** — fail fast on misconfigured agents; suppress `agent_outputs_empty` warning when superseded.
3. **Cap cascade in handler** — wire D3 resolution. `loop:false` regression suite untouched.
4. **Per-iteration outputs parse + `done` break + crash exit** — the core handler restructure. Drops the `maxIterations === 1` crash guard; re-classifies the existing "does not fail on non-zero exit during multi-iteration loop" test.
5. **`$prev_note` channel** — opt-in cross-iteration carry-over with preflight seeding.
6. **Migration of `implement` agent** — apply the new contract; reconcile prompt body with the handler's `jsonWrappedPrompt` wrap.
7. **Documentation** — README authoring guide.

Each chunk ships green and is independently committable.

---

## Chunk 1: Frontmatter parsing for `loop` and `maxIterations`

**Ships green:** Agent files can declare `loop: true` and `maxIterations: N` in frontmatter; `validateAgentConfig` round-trips both fields. No behavioral change yet — handler ignores them.

### Task 1.1 — Add fields to `AgentConfig`

**Files:**
- Modify: `src/cli/lib/agent.ts:48-59`

- [x] **Step 1: Add fields to interface**

In `src/cli/lib/agent.ts:48–59`, append two optional fields:

```ts
export interface AgentConfig {
  name: string;
  description: string;
  model: string;
  permissionMode: string;
  tools: string[];
  mcp: McpServerConfig[];
  prompt: string;
  jsonSchema?: string;
  outputs?: Record<string, JsonSchemaFragment>;
  inputs?: string[];
  loop?: boolean;
  maxIterations?: number;
}
```

- [x] **Step 2: Verify the type compiles**

Run: `npx tsc --noEmit`
Expected: zero errors. (Just an interface widening; no callers need updating yet.)

- [x] **Step 3: Commit** _(done: 9d4d0f9)_

```bash
git add src/cli/lib/agent.ts
git commit -m "feat(agent-config): widen AgentConfig with loop and maxIterations"
```

### Task 1.2 — `validateAgentConfig` propagates the new fields

**Files:**
- Modify: `src/cli/lib/agent.ts:459-485` (`validateAgentConfig`)
- Test: `src/cli/tests/agent-validate.test.ts` (extend if exists; otherwise create)

- [x] **Step 1: Locate existing tests**

Run: `ls src/cli/tests/ | grep -i agent`
Use the existing config/validate test file if present. Otherwise create `src/cli/tests/agent-validate.test.ts` with this header:

```ts
import { describe, it, expect } from "vitest";
import { validateAgentConfig } from "../lib/agent.js";
```

- [x] **Step 2: Write failing tests**

```ts
describe("validateAgentConfig — deep loop fields", () => {
  it("propagates loop:true into the returned config", () => {
    const cfg = validateAgentConfig({
      name: "x",
      description: "y",
      prompt: "z",
      loop: true,
    });
    expect(cfg.loop).toBe(true);
  });

  it("propagates maxIterations into the returned config", () => {
    const cfg = validateAgentConfig({
      name: "x",
      description: "y",
      prompt: "z",
      loop: true,
      maxIterations: 25,
    });
    expect(cfg.maxIterations).toBe(25);
  });

  it("omits both fields when not provided", () => {
    const cfg = validateAgentConfig({
      name: "x",
      description: "y",
      prompt: "z",
    });
    expect(cfg.loop).toBeUndefined();
    expect(cfg.maxIterations).toBeUndefined();
  });

  it("rejects non-boolean loop", () => {
    expect(() => validateAgentConfig({
      name: "x",
      description: "y",
      prompt: "z",
      loop: "yes" as any,
    })).toThrow(/loop must be a boolean/i);
  });

  it("rejects non-integer maxIterations", () => {
    expect(() => validateAgentConfig({
      name: "x",
      description: "y",
      prompt: "z",
      maxIterations: 1.5 as any,
    })).toThrow(/maxIterations must be a non-negative integer/i);
  });

  it("rejects negative maxIterations", () => {
    expect(() => validateAgentConfig({
      name: "x",
      description: "y",
      prompt: "z",
      maxIterations: -1 as any,
    })).toThrow(/maxIterations must be a non-negative integer/i);
  });

  it("accepts maxIterations=0 (back-compat: maps to Infinity at runtime)", () => {
    const cfg = validateAgentConfig({
      name: "x",
      description: "y",
      prompt: "z",
      maxIterations: 0,
    });
    expect(cfg.maxIterations).toBe(0);
  });
});
```

- [x] **Step 3: Run tests, expect failure**

Run: `npx vitest run src/cli/tests/agent-validate.test.ts -t "deep loop fields"`
Expected: all FAIL — fields stripped by `validateAgentConfig`.

- [x] **Step 4: Implement**

Modify `src/cli/lib/agent.ts:459-485`. After the existing required-field checks, add runtime validation and propagate fields:

```ts
export function validateAgentConfig(
  config: Partial<AgentConfig> & { prompt?: string },
): AgentConfig {
  if (!config.name) throw new Error("name is required");
  if (!config.description) throw new Error("description is required");
  if (typeof config.prompt !== "string") throw new Error("prompt body is required");

  if (config.loop !== undefined && typeof config.loop !== "boolean") {
    throw new Error("loop must be a boolean");
  }
  if (config.maxIterations !== undefined &&
      (typeof config.maxIterations !== "number" ||
       !Number.isInteger(config.maxIterations) ||
       config.maxIterations < 0)) {
    throw new Error("maxIterations must be a non-negative integer");
  }

  const derivedJsonSchema = (config.outputs && !config.jsonSchema)
    ? deriveJsonSchemaString(config.outputs)
    : config.jsonSchema;

  return {
    name: config.name,
    description: config.description,
    model: config.model ?? DEFAULTS.model!,
    permissionMode: config.permissionMode ?? DEFAULTS.permissionMode!,
    tools: config.tools ?? DEFAULTS.tools!,
    mcp: config.mcp ?? DEFAULTS.mcp!,
    prompt: config.prompt,
    ...(derivedJsonSchema !== undefined ? { jsonSchema: derivedJsonSchema } : {}),
    ...(config.outputs !== undefined ? { outputs: config.outputs } : {}),
    ...(config.inputs !== undefined ? { inputs: config.inputs } : {}),
    ...(config.loop !== undefined ? { loop: config.loop } : {}),
    ...(config.maxIterations !== undefined ? { maxIterations: config.maxIterations } : {}),
  };
}
```

- [x] **Step 5: Run tests, expect pass**

Run: `npx vitest run src/cli/tests/agent-validate.test.ts -t "deep loop fields"`
Expected: all PASS.

- [x] **Step 6: End-to-end via parseAgentFile**

Add a sanity-check test in the same file (round-trip from frontmatter through `parseAgentFile`):

```ts
import { parseAgentFile } from "../lib/agent-registry.js";

describe("parseAgentFile — deep loop fields round-trip", () => {
  it("reads loop and maxIterations from frontmatter", () => {
    const cfg = parseAgentFile([
      "---",
      "name: looper",
      "description: x",
      "loop: true",
      "maxIterations: 50",
      "outputs:",
      "  done: boolean",
      "---",
      "Body.",
    ].join("\n"));
    expect(cfg.loop).toBe(true);
    expect(cfg.maxIterations).toBe(50);
    expect(cfg.outputs?.done).toBe("boolean");
  });
});
```

Run: `npx vitest run src/cli/tests/agent-validate.test.ts`
Expected: all PASS.

- [x] **Step 7: Commit** _(done: 293d759)_

```bash
git add src/cli/lib/agent.ts src/cli/tests/agent-validate.test.ts
git commit -m "feat(validateAgentConfig): accept and propagate loop and maxIterations"
```

---

## Chunk 2: Validator rule `loop_missing_done_field` ✅ SHIPPED (4ee115f)

**Ships green:** `pipeline validate` errors when an agent declares `loop: true` without a `done: boolean` field in `outputs:`. Empty-outputs case routes to the new error and suppresses the existing `agent_outputs_empty` warning.

### Task 2.1 — Add `checkLoopRequiresDoneField` rule ✅ DONE

**Files:**
- Modify: `src/attractor/core/graph.ts` (add function below `checkAgentMissingOutputs` at line 683; wire into dispatcher at lines 393–398; update `checkAgentMissingOutputs` empty-branch to skip when `loop:true`)
- Test: locate the existing validator test file

- [x] **Step 1: Locate validator test conventions**

Run: `grep -n "checkAgentMissingOutputs\|agent_missing_outputs" src/attractor/tests/*.test.ts`
Identify the existing test file (e.g., `src/attractor/tests/graph-validator.test.ts` or `src/attractor/tests/graph.test.ts`). Read its imports — copy the same `parseDot` / graph-loading helper that existing rule tests use. Do NOT invent a `cli/lib/dot-parser.js` import.

- [x] **Step 2: Write failing tests**

In the located validator test file, append a new describe block. Mimic the existing tests' setup pattern (tmp dir, write `.dot` + sibling `.md`, parse via the same helper, call `validate(graph, dotDir)`):

```ts
describe("validator — loop_missing_done_field", () => {
  it("errors when loop:true agent has no done field in outputs", () => {
    /* setup tmp dir, write looper.md with loop:true + outputs:{result:string} */
    /* write pipeline.dot referencing agent="looper" */
    /* parse + validate */
    expect(diags.some(d => d.rule === "loop_missing_done_field")).toBe(true);
  });

  it("errors when loop:true agent has done with non-boolean type", () => {
    /* outputs: { done: string } */
    expect(diags.some(d => d.rule === "loop_missing_done_field")).toBe(true);
  });

  it("accepts loop:true with done:boolean shorthand", () => {
    /* outputs: { done: boolean } */
    expect(diags.some(d => d.rule === "loop_missing_done_field")).toBe(false);
  });

  it("accepts loop:true with done long form { type: boolean }", () => {
    /* outputs: { done: { type: "boolean" } } */
    expect(diags.some(d => d.rule === "loop_missing_done_field")).toBe(false);
  });

  it("loop:true + outputs:{} → loop_missing_done_field (suppresses agent_outputs_empty)", () => {
    /* outputs: {} */
    expect(diags.some(d => d.rule === "loop_missing_done_field")).toBe(true);
    expect(diags.some(d => d.rule === "agent_outputs_empty")).toBe(false);
  });

  it("loop:false (default) does NOT trigger the rule", () => {
    /* no loop attr, outputs: { result: string } */
    expect(diags.some(d => d.rule === "loop_missing_done_field")).toBe(false);
  });
});
```

Replace the `/* setup */` comments with the actual fixtures (mirror surrounding `agent_missing_outputs` tests for the exact helper calls).

- [x] **Step 3: Run tests, expect failure**

Run: `npx vitest run src/attractor/tests/graph*.test.ts -t "loop_missing_done_field"`
Expected: all FAIL.

- [x] **Step 4: Implement `checkLoopRequiresDoneField`**

In `src/attractor/core/graph.ts`, add below `checkAgentMissingOutputs` (after line 683):

```ts
function checkLoopRequiresDoneField(
  node: Node,
  dotDir: string,
  diags: Diagnostic[],
): void {
  if (!node.agent) return;
  if (node.interactive === true || node.interactive === "true") return;

  const agentConfig = tryResolveAgent(node, dotDir);
  if (!agentConfig) return;
  if (agentConfig.loop !== true) return;

  const outputs = agentConfig.outputs ?? {};
  const doneShape = (outputs as Record<string, unknown>).done;
  const ok =
    doneShape === "boolean" ||
    (typeof doneShape === "object" && doneShape !== null &&
     (doneShape as { type?: string }).type === "boolean");

  if (!ok) {
    diags.push({
      rule: "loop_missing_done_field",
      severity: "error",
      message: `Agent "${node.agent}" at node "${node.id}" declares loop:true but its outputs: lacks a done:boolean field. Add 'done: boolean' to the agent's outputs frontmatter.`,
      location: node.sourceLocation,
    });
  }
}
```

- [x] **Step 5: Modify `checkAgentMissingOutputs` to suppress `agent_outputs_empty` when `loop:true`**

In `src/attractor/core/graph.ts:675-682`, change the empty-outputs branch:

```ts
if (typeof agentConfig.outputs === "object" && Object.keys(agentConfig.outputs).length === 0) {
  // When loop:true, loop_missing_done_field handles this case with a stronger error.
  if (agentConfig.loop === true) return;
  diags.push({
    rule: "agent_outputs_empty",
    severity: "warning",
    message: `Agent "${node.agent}" at node "${node.id}" has outputs: {} with no keys. Declare at least one output key, or remove outputs: if this agent intentionally produces nothing.`,
    location: node.sourceLocation,
  });
}
```

- [x] **Step 6: Wire into the dispatcher at `graph.ts:393-398`**

```ts
if (dotDir) {
  for (const node of nodes.values()) {
    checkAgentMissingOutputs(node, dotDir, diags);
    checkLoopRequiresDoneField(node, dotDir, diags);
  }
}
```

- [x] **Step 7: Run tests, expect pass**

Run: `npx vitest run src/attractor/tests/graph*.test.ts -t "loop_missing_done_field"`
Expected: all PASS.

- [x] **Step 8: Run full validator test**

Run: `npx vitest run src/attractor/tests/`
Expected: all PASS.

- [x] **Step 9: Commit** _(done: 4ee115f)_

```bash
git add src/attractor/core/graph.ts src/attractor/tests/
git commit -m "feat(validator): loop_missing_done_field rule + agent_outputs_empty suppression"
```

---

## Chunk 3: Cap cascade in handler ✅ SHIPPED

**Ships green:** Handler computes `final_cap` per the D3 cascade. Behavior unchanged for non-loop agents (default `1` preserved); for `loop:true` agents the default becomes `Infinity`. Per-iteration loop body untouched in this chunk; existing `maxIterations === 1` crash guard untouched (it moves in Chunk 4).

### Task 3.1 — Cascade resolution ✅ DONE

**Files:**
- Modify: `src/attractor/handlers/agent-handler.ts:168-174` (replace cap parse)
- Test: extend `src/attractor/tests/agent-handler.test.ts` (uses existing helpers `mockResolve`, `mockAgentRun`, `makeNode`, `makeContext`, `baseCtx`, `baseConfig`, `makeHandler`)

- [x] **Step 1: Write failing tests**

Append to `src/attractor/tests/agent-handler.test.ts` (inside the existing `describe("AgentHandler", …)` block):

```ts
describe("cap cascade", () => {
  it("loop:true with no cap defaults to Infinity (loops until signal abort)", async () => {
    mockResolve.mockReturnValue({ ...baseConfig, loop: true });

    const controller = new AbortController();
    let calls = 0;
    mockAgentRun.mockImplementation(async () => {
      calls++;
      if (calls >= 4) controller.abort();
      return { exitCode: 0, sessionId: `s${calls}`, stdout: null };
    });

    const handler = makeHandler();
    await handler.execute(
      makeNode(),
      baseCtx(),
      makeContext({ signal: controller.signal }),
    );
    expect(calls).toBe(4);
  });

  it("loop:false (default) caps at 1 iteration", async () => {
    mockResolve.mockReturnValue({ ...baseConfig });
    mockAgentRun.mockResolvedValue({ exitCode: 0, sessionId: "s", stdout: null });

    const handler = makeHandler();
    await handler.execute(makeNode(), baseCtx(), makeContext());
    expect(mockAgentRun).toHaveBeenCalledTimes(1);
  });

  it("node.maxIterations overrides agent.maxIterations", async () => {
    mockResolve.mockReturnValue({ ...baseConfig, loop: true, maxIterations: 20 });
    mockAgentRun.mockResolvedValue({ exitCode: 0, sessionId: "s", stdout: null });

    const handler = makeHandler();
    await handler.execute(
      makeNode({ maxIterations: 3 }),
      baseCtx(),
      makeContext(),
    );
    expect(mockAgentRun).toHaveBeenCalledTimes(3);
  });

  it("agent.maxIterations applies when node has none", async () => {
    mockResolve.mockReturnValue({ ...baseConfig, loop: true, maxIterations: 2 });
    mockAgentRun.mockResolvedValue({ exitCode: 0, sessionId: "s", stdout: null });

    const handler = makeHandler();
    await handler.execute(makeNode(), baseCtx(), makeContext());
    expect(mockAgentRun).toHaveBeenCalledTimes(2);
  });

  it("max_iterations=0 maps to Infinity at node level (back-compat)", async () => {
    mockResolve.mockReturnValue({ ...baseConfig, loop: true });

    const controller = new AbortController();
    let calls = 0;
    mockAgentRun.mockImplementation(async () => {
      calls++;
      if (calls >= 3) controller.abort();
      return { exitCode: 0, sessionId: `s${calls}`, stdout: null };
    });

    const handler = makeHandler();
    await handler.execute(
      makeNode({ maxIterations: 0 }),
      baseCtx(),
      makeContext({ signal: controller.signal }),
    );
    expect(calls).toBe(3);
  });
});
```

- [x] **Step 2: Run tests, expect failure**

Run: `npx vitest run src/attractor/tests/agent-handler.test.ts -t "cap cascade"`
Expected: FAIL — current code reads only `node.maxIterations`. **Confirmed:** 2/5 failed (loop:true defaults).

- [x] **Step 3: Implement cascade**

Replace `src/attractor/handlers/agent-handler.ts:168-174` with:

```ts
const nodeCapRaw = node.maxIterations;
const nodeCapParsed = typeof nodeCapRaw === "string" ? parseInt(nodeCapRaw, 10)
                    : typeof nodeCapRaw === "number"  ? nodeCapRaw
                    : undefined;
const nodeCapValid = nodeCapParsed != null && !isNaN(nodeCapParsed) && nodeCapParsed >= 0;

const agentCap = config.maxIterations;
const loopMode = config.loop === true;

const maxIterations =
  nodeCapValid
    ? (nodeCapParsed === 0 ? Infinity : nodeCapParsed)
    : (typeof agentCap === "number" && agentCap >= 0
        ? (agentCap === 0 ? Infinity : agentCap)
        : (loopMode ? Infinity : 1));
```

- [x] **Step 4: Run tests, expect pass**

Run: `npx vitest run src/attractor/tests/agent-handler.test.ts -t "cap cascade"`
Expected: all PASS. **Confirmed:** 5/5 cap-cascade pass.

- [x] **Step 5: Run full handler test suite**

Run: `npx vitest run src/attractor/tests/agent-handler.test.ts`
Expected: all PASS — including pre-existing tests `loops when node has maxIterations`, `does not fail on non-zero exit during multi-iteration loop`, and `max_iterations=0 runs until signal aborted`. **Confirmed:** 37/37 pass; full vitest 1273/1273; typecheck clean.

(These pass because: the cascade preserves `nodeCap=N` semantics when set; the existing crash guard at line 206 is still in place; the `0 → Infinity` idiom is preserved at the node level.)

- [x] **Step 6: Commit** (in progress, this commit)

```bash
git add src/attractor/handlers/agent-handler.ts src/attractor/tests/agent-handler.test.ts
git commit -m "feat(handler): cap cascade — node > agent > (loop ? Infinity : 1)"
```

---

## Chunk 4: Per-iteration outputs parse + `done` break + crash exit ✅ SHIPPED

**Ships green:** The handler's iteration loop now parses outputs each iteration via `evaluateAgentOutput`, breaks on `done=true`, treats any non-zero exit as hard failure, and exposes the LAST iteration's parsed outputs as `contextUpdates`. Validation+retry block moves inside the loop body.

This chunk also re-classifies the existing test `does not fail on non-zero exit during multi-iteration loop` (line 100 of `agent-handler.test.ts`) — its semantics no longer match the new contract. It becomes "exits the loop with agent.success=false on first non-zero exit during deep-loop iteration".

### Task 4.1 — Move validation+retry inside the iteration loop and add per-iteration `done` break ✅ DONE

**Implementation note:** Filename pattern stayed `raw-attempt-${n}.txt` (not `iter-${i+1}-attempt-${n}.txt` as originally drafted) to keep `agent-handler-retry.test.ts` and `agent-handler-json-constraint.test.ts` filename assertions green. Per-iteration files overwrite each other — adequate for current forensics. Failure-reason wording prefixed with `iteration ${i+1}` so retry test regex updated to `/output validation failed.*N attempts/i`.

**Files:**
- Modify: `src/attractor/handlers/agent-handler.ts` (relocate lines 218–297 into the iteration loop body; drop the `maxIterations === 1` guard at line 206; iteration counter must NOT double-count retries)
- Modify: `src/attractor/tests/agent-handler.test.ts` (re-classify existing test)
- Create: `src/attractor/tests/agent-handler-deep-loop.test.ts`

- [ ] **Step 1: Verify the stream-output fixture format**

Read `src/attractor/handlers/evaluate-agent-output.ts` (lines 27–84). Note: `normaliseRaw` accepts both NDJSON and `JSON.stringify([...])` shapes. Existing chunk-2 tests in `src/attractor/tests/agent-handler-validation.test.ts` use array-of-events fixtures. Use the same shape.

Helper for new tests:

```ts
const streamJsonResult = (result: object): string => JSON.stringify([
  { type: "system", subtype: "init", session_id: "s-1" },
  { type: "result", subtype: "success", result: JSON.stringify(result) },
]);
```

- [ ] **Step 2: Write failing tests in `src/attractor/tests/agent-handler-deep-loop.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AgentHandler } from "../handlers/agent-handler.js";
import type { HandlerExecutionContext } from "../handlers/registry.js";
import type { Node, PipelineContext } from "../types.js";

const baseCtx = (): PipelineContext => ({ values: {} });
function makeContext(overrides: Partial<HandlerExecutionContext> = {}): HandlerExecutionContext {
  return { logsRoot: "/tmp/logs", cwd: "/tmp/project", dotDir: "/tmp/project", outgoingLabels: [], completedNodes: [], nodeRetries: {}, ...overrides };
}

const streamJsonResult = (result: object): string => JSON.stringify([
  { type: "system", subtype: "init", session_id: "s-1" },
  { type: "result", subtype: "success", result: JSON.stringify(result) },
]);

const loopBaseConfig = {
  name: "looper",
  description: "x",
  model: "opus",
  prompt: "Do things",
  tools: [] as string[],
  mcp: [] as any[],
  permissionMode: "dangerouslySkipPermissions",
  loop: true,
  outputs: { done: "boolean" },
  jsonSchema: JSON.stringify({
    type: "object",
    properties: { done: { type: "boolean" } },
    required: ["done"],
    additionalProperties: false,
  }),
};

describe("AgentHandler deep loop — done break", () => {
  const mockResolve = vi.fn();
  const mockAgentRun = vi.fn();

  function makeHandler() {
    return new AgentHandler({
      resolveAgent: mockResolve,
      createAgent: () => ({ run: mockAgentRun, kill: vi.fn(), config: {} } as any),
    });
  }

  function makeNode(overrides: Partial<Node> = {}): Node {
    return { id: "deep", shape: "box", label: "Deep work", agent: "looper", ...overrides } as Node;
  }

  beforeEach(() => vi.clearAllMocks());

  it("breaks on iteration 3 of cap=10 when done=true emitted", async () => {
    mockResolve.mockReturnValue({ ...loopBaseConfig });
    let i = 0;
    mockAgentRun.mockImplementation(async () => {
      i++;
      return {
        exitCode: 0, sessionId: `s${i}`, stdout: null,
        output: streamJsonResult({ done: i >= 3 }),
      };
    });

    const handler = makeHandler();
    const outcome = await handler.execute(
      makeNode({ maxIterations: 10 }),
      baseCtx(),
      makeContext(),
    );
    expect(mockAgentRun).toHaveBeenCalledTimes(3);
    expect(outcome.status).toBe("success");
    expect(outcome.contextUpdates?.done).toBe("true");
    expect(outcome.contextUpdates?.["agent.iterations"]).toBe("3");
  });

  it("runs to cap when done never emits true", async () => {
    mockResolve.mockReturnValue({ ...loopBaseConfig });
    mockAgentRun.mockResolvedValue({
      exitCode: 0, sessionId: "s", stdout: null,
      output: streamJsonResult({ done: false }),
    });

    const handler = makeHandler();
    const outcome = await handler.execute(
      makeNode({ maxIterations: 5 }),
      baseCtx(),
      makeContext(),
    );
    expect(mockAgentRun).toHaveBeenCalledTimes(5);
    expect(outcome.status).toBe("success");
    expect(outcome.contextUpdates?.done).toBe("false");
  });

  it("agent.success=true when loop terminates via done", async () => {
    mockResolve.mockReturnValue({ ...loopBaseConfig });
    mockAgentRun.mockResolvedValue({
      exitCode: 0, sessionId: "s", stdout: null,
      output: streamJsonResult({ done: true }),
    });

    const handler = makeHandler();
    const outcome = await handler.execute(
      makeNode({ maxIterations: 5 }),
      baseCtx(),
      makeContext(),
    );
    expect(outcome.contextUpdates?.["agent.success"]).toBe("true");
  });
});

describe("AgentHandler deep loop — crash mid-iteration", () => {
  const mockResolve = vi.fn();
  const mockAgentRun = vi.fn();

  function makeHandler() {
    return new AgentHandler({
      resolveAgent: mockResolve,
      createAgent: () => ({ run: mockAgentRun, kill: vi.fn(), config: {} } as any),
    });
  }
  function makeNode(overrides: Partial<Node> = {}): Node {
    return { id: "deep", shape: "box", label: "x", agent: "looper", ...overrides } as Node;
  }

  beforeEach(() => vi.clearAllMocks());

  it("exits loop with agent.success=false when iteration 2 crashes (deep-loop mode)", async () => {
    mockResolve.mockReturnValue({ ...loopBaseConfig });
    let i = 0;
    mockAgentRun.mockImplementation(async () => {
      i++;
      if (i === 2) return { exitCode: 137, sessionId: "s2", stdout: null, output: "" };
      return {
        exitCode: 0, sessionId: `s${i}`, stdout: null,
        output: streamJsonResult({ done: false }),
      };
    });

    const handler = makeHandler();
    const outcome = await handler.execute(
      makeNode({ maxIterations: 5 }),
      baseCtx(),
      makeContext(),
    );
    expect(outcome.status).toBe("fail");
    expect(mockAgentRun).toHaveBeenCalledTimes(2);
    expect(outcome.contextUpdates?.["agent.success"]).toBe("false");
  });

  it("non-loop agent (loop:false) — single iteration crash still fails (regression)", async () => {
    mockResolve.mockReturnValue({
      ...loopBaseConfig,
      loop: undefined,
      outputs: undefined,
      jsonSchema: undefined,
    });
    mockAgentRun.mockResolvedValue({ exitCode: 1, sessionId: null, stdout: null });

    const handler = makeHandler();
    const outcome = await handler.execute(
      makeNode(),
      baseCtx(),
      makeContext(),
    );
    expect(outcome.status).toBe("fail");
    expect(mockAgentRun).toHaveBeenCalledTimes(1);
  });
});

describe("AgentHandler deep loop — chunk-2 retry composition", () => {
  const mockResolve = vi.fn();
  const mockAgentRun = vi.fn();

  function makeHandler() {
    return new AgentHandler({
      resolveAgent: mockResolve,
      createAgent: () => ({ run: mockAgentRun, kill: vi.fn(), config: {} } as any),
    });
  }
  function makeNode(overrides: Partial<Node> = {}): Node {
    return { id: "deep", shape: "box", label: "x", agent: "looper", ...overrides } as Node;
  }

  beforeEach(() => vi.clearAllMocks());

  it("malformed done triggers chunk-2 retry within iteration; loop continues if retry succeeds", async () => {
    mockResolve.mockReturnValue({ ...loopBaseConfig });
    let calls = 0;
    mockAgentRun.mockImplementation(async (opts: any) => {
      calls++;
      if (calls === 1) {
        // First attempt: malformed done as string
        return {
          exitCode: 0, sessionId: "s1", stdout: null,
          output: streamJsonResult({ done: "true" }),
        };
      }
      if (calls === 2) {
        // Retry within iteration 1 — must be --resume same session
        expect(opts.resume).toBe("s1");
        return {
          exitCode: 0, sessionId: "s1", stdout: null,
          output: streamJsonResult({ done: true }),
        };
      }
      throw new Error("unexpected extra call");
    });

    const handler = makeHandler();
    const outcome = await handler.execute(
      makeNode({ maxIterations: 5, outputValidationRetries: 1 }),
      baseCtx(),
      makeContext(),
    );
    expect(calls).toBe(2);
    expect(outcome.status).toBe("success");
    expect(outcome.contextUpdates?.done).toBe("true");
  });

  it("retry exhaustion within iteration 1 aborts deep loop", async () => {
    mockResolve.mockReturnValue({ ...loopBaseConfig });
    mockAgentRun.mockResolvedValue({
      exitCode: 0, sessionId: "s1", stdout: null,
      output: streamJsonResult({ done: "true" }), // string — never validates
    });

    const handler = makeHandler();
    const outcome = await handler.execute(
      makeNode({ maxIterations: 5, outputValidationRetries: 1 }),
      baseCtx(),
      makeContext(),
    );
    expect(outcome.status).toBe("fail");
    expect(mockAgentRun).toHaveBeenCalledTimes(2); // 1 initial + 1 retry; no iteration 2
  });

  it("agent.iterations reflects only outer iterations, not retry attempts", async () => {
    mockResolve.mockReturnValue({ ...loopBaseConfig });
    let calls = 0;
    mockAgentRun.mockImplementation(async () => {
      calls++;
      // iteration 1: malformed → retry → valid done=false
      // iteration 2: valid done=true → break
      if (calls === 1) {
        return { exitCode: 0, sessionId: "s1", stdout: null, output: streamJsonResult({ done: "no" }) };
      }
      if (calls === 2) {
        return { exitCode: 0, sessionId: "s1", stdout: null, output: streamJsonResult({ done: false }) };
      }
      if (calls === 3) {
        return { exitCode: 0, sessionId: "s2", stdout: null, output: streamJsonResult({ done: true }) };
      }
      throw new Error("unexpected");
    });

    const handler = makeHandler();
    const outcome = await handler.execute(
      makeNode({ maxIterations: 5, outputValidationRetries: 1 }),
      baseCtx(),
      makeContext(),
    );
    expect(calls).toBe(3);
    // 2 outer iterations (retry counts as same iteration)
    expect(outcome.contextUpdates?.["agent.iterations"]).toBe("2");
  });
});
```

- [ ] **Step 3: Re-classify the existing test in `agent-handler.test.ts`**

Find the test at line 100: `does not fail on non-zero exit during multi-iteration loop`. This contradicts the new spec (D6 says any non-zero exit during deep-loop iteration is hard failure).

The test currently uses `mockResolve.mockReturnValue({ ...baseConfig })` — i.e., `loop` undefined, so it's testing the OLD (non-loop) multi-iteration behavior. Multi-iteration without loop is no longer a normal path (the cap cascade defaults `loop:false` → 1 iteration).

Decision: this test was always exercising an unusual configuration (`maxIterations: 3` on a non-loop agent). Repurpose it to exercise the new contract on a `loop:true` agent that crashes mid-loop:

```ts
it("exits loop on first non-zero exit during deep-loop multi-iteration", async () => {
  mockResolve.mockReturnValue({
    ...baseConfig,
    loop: true,
    outputs: { done: "boolean" },
    jsonSchema: JSON.stringify({
      type: "object",
      properties: { done: { type: "boolean" } },
      required: ["done"],
      additionalProperties: false,
    }),
  });
  mockAgentRun
    .mockResolvedValueOnce({ exitCode: 0, sessionId: "s1", stdout: null, output: JSON.stringify([
      { type: "system", subtype: "init", session_id: "s1" },
      { type: "result", subtype: "success", result: '{"done":false}' },
    ]) })
    .mockResolvedValueOnce({ exitCode: 1, sessionId: null, stdout: null });

  const handler = makeHandler();
  const outcome = await handler.execute(
    makeNode({ maxIterations: 3 }),
    baseCtx(),
    makeContext(),
  );

  expect(outcome.status).toBe("fail");
  expect(mockAgentRun).toHaveBeenCalledTimes(2);
});
```

(Also delete the original assertion `outcome.status === "success"` and `times(3)` — those reflected the old behavior.)

- [ ] **Step 4: Run tests, expect failure**

Run: `npx vitest run src/attractor/tests/agent-handler-deep-loop.test.ts src/attractor/tests/agent-handler.test.ts`
Expected: deep-loop tests FAIL; old-handler tests on the renamed-test branch FAIL until the handler restructure lands.

- [ ] **Step 5: Restructure the handler**

In `src/attractor/handlers/agent-handler.ts`, the iteration loop body (currently lines 180–216) plus the validation+retry block (lines 218–297) become a single fused loop. Replace lines 176–308 with:

```ts
let lastResult: RunResult | null = null;
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

for (let i = 0; i < maxIterations; i++) {
  if (signal?.aborted) break;

  if (i > 0) meta.onIterationStart?.(node.id, i);

  let result = await agent.run({
    cwd, signal, variables: agentVariables, onStdout,
  });
  lastResult = result;
  iteration++;
  if (result.sessionId) lastSessionId = result.sessionId;

  // D6: any non-zero exit during deep-loop iteration = hard failure.
  if (result.exitCode !== 0) {
    return {
      status: "fail",
      failureReason: `Agent "${agentName}" exited with code ${result.exitCode}`,
      contextUpdates: {
        "agent.iterations": String(iteration),
        "agent.success": "false",
      },
    };
  }

  // Per-iteration validation + chunk-2 retry layer.
  let parsed: Record<string, unknown> | undefined;
  if (jsonSchema) {
    const writeRaw = (n: number, raw: string) =>
      writeFileSync(join(nodeDir, `iter-${i + 1}-attempt-${n}.txt`), raw ?? "");

    writeRaw(1, result.output ?? "");
    let attempt = 1;
    let evaluation = evaluateAgentOutput(result.output ?? "", zodSchema);

    while (!evaluation.ok && attempt <= maxRetries) {
      meta.onValidationFailure?.({
        attempt,
        errors: evaluation.errors,
        rawOutputPath: `${node.id}/iter-${i + 1}-attempt-${attempt}.txt`,
      });
      if (!lastSessionId) {
        return {
          status: "fail",
          failureReason: `Output validation failed and cannot retry: agent did not report sessionId (iter ${i + 1} attempt ${attempt})`,
          contextUpdates: { "agent.iterations": String(iteration), "agent.success": "false" },
        };
      }
      attempt += 1;
      meta.onValidationRetryStart?.(node.id, attempt);
      const corrective = buildCorrectiveMessage(evaluation.raw, evaluation.errors, jsonSchema);
      const retryResult = await agent.run({
        cwd, signal, variables: agentVariables, onStdout,
        resume: lastSessionId, message: corrective,
      });
      result = retryResult;
      lastResult = retryResult;
      if (retryResult.sessionId) lastSessionId = retryResult.sessionId;
      // NOTE: do NOT increment `iteration` for retries (they're sub-attempts of this iteration).

      writeRaw(attempt, retryResult.output ?? "");
      evaluation = evaluateAgentOutput(retryResult.output ?? "", zodSchema);
    }

    if (!evaluation.ok) {
      meta.onValidationFailure?.({
        attempt,
        errors: evaluation.errors,
        rawOutputPath: `${node.id}/iter-${i + 1}-attempt-${attempt}.txt`,
      });
      return {
        status: "fail",
        failureReason: `Output validation failed in iteration ${i + 1} after ${attempt} attempts: ` +
          evaluation.errors.map(e => `${e.path}: ${e.message}`).join("; "),
        contextUpdates: { "agent.iterations": String(iteration), "agent.success": "false" },
      };
    }

    parsed = evaluation.parsed as Record<string, unknown>;
    lastParsed = parsed;
    if (parsed.preferred_label != null) preferredLabel = String(parsed.preferred_label);
  }

  // Deep-loop break MUST be checked BEFORE onIterationEnd; if we break, we
  // do not "end the iteration to start another one" — the outer onNodeEnd
  // closes the block. (UI hook ordering matters.)
  const willBreak = parsed?.done === true;
  if (willBreak) break;

  const willContinue = !signal?.aborted && i < maxIterations - 1;
  if (willContinue) meta.onIterationEnd?.(node.id, i);
}

// Defense in depth: a loop:true agent must produce parsed output to know if
// done. If the validator was bypassed and we somehow have no schema, treat
// the loop as a no-op success (preserves loop:false behavior; loop:true is
// validator-guarded).
let structuredUpdates: Record<string, unknown> = {};
if (lastParsed) {
  for (const [key, value] of Object.entries(lastParsed)) {
    structuredUpdates[key] = typeof value === "string" ? value : String(value);
  }
}

return {
  status: "success",
  ...(preferredLabel ? { preferredLabel } : {}),
  contextUpdates: {
    ...structuredUpdates,
    "agent.iterations": String(iteration),
    "agent.success": "true",
    ...(lastSessionId ? { "agent.sessionId": lastSessionId } : {}),
  },
};
```

DELETE the now-orphaned old block at the bottom of `execute()` (was lines 218–308 in the pre-chunk version).

- [ ] **Step 6: Run deep-loop tests, expect pass**

Run: `npx vitest run src/attractor/tests/agent-handler-deep-loop.test.ts`
Expected: all PASS.

- [ ] **Step 7: Run full handler test**

Run: `npx vitest run src/attractor/tests/agent-handler.test.ts src/attractor/tests/agent-handler-deep-loop.test.ts`
Expected: all PASS — including the re-classified test.

- [ ] **Step 8: Run chunk-2 regression suite**

Run: `npx vitest run src/attractor/tests/agent-handler-validation.test.ts src/attractor/tests/agent-handler-retry.test.ts src/attractor/tests/agent-handler-frontmatter-jsonschema.test.ts`
Expected: all PASS — these tests exercise single-iteration agents; they hit the new in-loop path with `i=0` and break out at the bottom (no `done` field in their schemas → `parsed.done !== true` → loop continues, but `maxIterations === 1` for non-loop → loop ends after one iteration).

- [ ] **Step 9: Commit**

```bash
git add src/attractor/handlers/agent-handler.ts src/attractor/tests/agent-handler-deep-loop.test.ts src/attractor/tests/agent-handler.test.ts
git commit -m "feat(handler): per-iteration outputs parse + done break + crash-as-failure"
```

---

## Chunk 5: `$prev_note` channel ✅ SHIPPED

**Ships green:** When an agent declares `note: string` in `outputs:`, its emitted value carries forward as variable `prev_note` in the next iteration's prompt expansion. First iteration sees `$prev_note=""`. Preflight does not raise undeclared-variable errors for `prev_note` on such agents.

The LAST iteration's `note` is intentionally discarded — only inter-iteration self-talk is supported. Persisting state at the end of the loop is the agent's job (filesystem, git).

**Status:** Task 5.1 + 5.2 shipped (commits `ab65842`, `23ce6de`, `a3e0bb9`). Full vitest 1286/1286 green; `tsc --noEmit` clean.

### Task 5.1 — Per-iteration variable bag rebuild ✅ DONE

**Files:**
- Modify: `src/attractor/handlers/agent-handler.ts` (within the iteration loop body from Chunk 4; build a per-iteration variable bag with `prev_note`)
- Test: extend `src/attractor/tests/agent-handler-deep-loop.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `src/attractor/tests/agent-handler-deep-loop.test.ts`:

```ts
const noteConfig = {
  ...loopBaseConfig,
  outputs: { done: "boolean", note: "string" },
  jsonSchema: JSON.stringify({
    type: "object",
    properties: { done: { type: "boolean" }, note: { type: "string" } },
    required: ["done", "note"],
    additionalProperties: false,
  }),
};

describe("AgentHandler deep loop — \$prev_note carry-over", () => {
  const mockResolve = vi.fn();
  const mockAgentRun = vi.fn();
  function makeHandler() {
    return new AgentHandler({
      resolveAgent: mockResolve,
      createAgent: () => ({ run: mockAgentRun, kill: vi.fn(), config: {} } as any),
    });
  }
  function makeNode(overrides: Partial<Node> = {}): Node {
    return { id: "deep", shape: "box", label: "x", agent: "looper", ...overrides } as Node;
  }
  beforeEach(() => vi.clearAllMocks());

  it("first iteration sees prev_note empty; second sees iteration-1's note", async () => {
    mockResolve.mockReturnValue({ ...noteConfig });
    let i = 0;
    const captured: string[] = [];
    mockAgentRun.mockImplementation(async (opts: any) => {
      i++;
      captured.push(String(opts.variables?.prev_note ?? ""));
      return {
        exitCode: 0, sessionId: `s${i}`, stdout: null,
        output: streamJsonResult({
          done: i >= 2,
          note: i === 1 ? "started chunk A" : "",
        }),
      };
    });
    const handler = makeHandler();
    await handler.execute(
      makeNode({ maxIterations: 5 }),
      baseCtx(),
      makeContext(),
    );
    expect(captured[0]).toBe("");
    expect(captured[1]).toBe("started chunk A");
  });

  it("note replaces, does not accumulate", async () => {
    mockResolve.mockReturnValue({ ...noteConfig });
    let i = 0;
    const captured: string[] = [];
    mockAgentRun.mockImplementation(async (opts: any) => {
      i++;
      captured.push(String(opts.variables?.prev_note ?? ""));
      return {
        exitCode: 0, sessionId: `s${i}`, stdout: null,
        output: streamJsonResult({ done: i >= 3, note: `note-${i}` }),
      };
    });
    const handler = makeHandler();
    await handler.execute(
      makeNode({ maxIterations: 5 }),
      baseCtx(),
      makeContext(),
    );
    expect(captured).toEqual(["", "note-1", "note-2"]);
  });

  it("agent without note declaration does not receive prev_note variable", async () => {
    mockResolve.mockReturnValue({ ...loopBaseConfig }); // no note in outputs
    let i = 0;
    const sawPrevNote: boolean[] = [];
    mockAgentRun.mockImplementation(async (opts: any) => {
      i++;
      sawPrevNote.push("prev_note" in (opts.variables ?? {}));
      return {
        exitCode: 0, sessionId: `s${i}`, stdout: null,
        output: streamJsonResult({ done: i >= 2 }),
      };
    });
    const handler = makeHandler();
    await handler.execute(
      makeNode({ maxIterations: 5 }),
      baseCtx(),
      makeContext(),
    );
    expect(sawPrevNote.every(b => b === false)).toBe(true);
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npx vitest run src/attractor/tests/agent-handler-deep-loop.test.ts -t "prev_note"`
Expected: FAIL.

- [ ] **Step 3: Implement variable rebuild**

In `src/attractor/handlers/agent-handler.ts`, just before the `for (let i…)` loop, snapshot the base bag and capture whether the agent declares `note`:

```ts
const baseAgentVariables: Record<string, unknown> = { ...agentVariables };
const agentDeclaresNote =
  config.outputs && Object.prototype.hasOwnProperty.call(config.outputs, "note");
let prevNote = "";
```

Inside the loop body, replace the existing `agent.run({ ..., variables: agentVariables, ... })` call with a per-iteration bag:

```ts
const iterVariables = agentDeclaresNote
  ? { ...baseAgentVariables, prev_note: prevNote }
  : baseAgentVariables;
let result = await agent.run({
  cwd, signal, variables: iterVariables, onStdout,
});
```

Pass the SAME `iterVariables` to the chunk-2 retry call inside the validation loop.

After the validation block, when a successful parse exists, capture the next iteration's note:

```ts
if (agentDeclaresNote && parsed && typeof parsed.note === "string") {
  prevNote = parsed.note;
}
```

(Place this BEFORE the `done`-break check so even if iteration N is the last, `prevNote` is updated — though it's then unused.)

- [ ] **Step 4: Run, expect pass**

Run: `npx vitest run src/attractor/tests/agent-handler-deep-loop.test.ts -t "prev_note"`
Expected: PASS.

- [ ] **Step 5: Run full deep-loop suite**

Run: `npx vitest run src/attractor/tests/agent-handler-deep-loop.test.ts src/attractor/tests/agent-handler.test.ts`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/attractor/handlers/agent-handler.ts src/attractor/tests/agent-handler-deep-loop.test.ts
git commit -m "feat(handler): \$prev_note carries last iteration's note into next"
```

### Task 5.2 — Preflight seeds `prev_note` so it's not flagged as undeclared ✅ DONE

**Files:**
- Modify: `src/attractor/transforms/variable-expansion.ts` (`scanUndeclaredCallerVars` — add `prev_note` to **producers**, not declared/RESERVED)
- Test: extend `src/attractor/tests/variable-expansion.test.ts`

**Why producers, not declared:** the missing-set is built by subtracting `producers ∪ ctxKeys` from references. Adding to `declared` only affects classification within already-handled refs. Adding to `producers` filters from `missing`.

- [ ] **Step 1: Locate the producers-set construction**

Run: `grep -n "producers\|nodeProduces\|collectProducers" src/attractor/transforms/variable-expansion.ts`
Identify where the producers set is built across the graph (likely a fold over nodes calling `collectProducers`).

- [ ] **Step 2: Write failing test**

Append to `src/attractor/tests/variable-expansion.test.ts`:

```ts
describe("scanUndeclaredCallerVars — prev_note seed for note-declaring loop agents", () => {
  it("does NOT report prev_note as missing when an agent declares note in outputs", () => {
    /*
     * Build a test graph:
     * - tmp dir
     * - looper.md (frontmatter: loop:true, outputs:{done:boolean, note:string}; body references $prev_note)
     * - pipeline.dot referencing agent="looper"
     * Use the same parseDot helper / tmp-dir setup the file's existing tests use.
     */
    const result = scanUndeclaredCallerVars(graph, {});
    const missingNames = result.missing.map(m => typeof m === "string" ? m : (m as any).var ?? (m as any).name);
    expect(missingNames).not.toContain("prev_note");
  });

  it("DOES report prev_note as missing when no agent declares note in outputs", () => {
    /* graph with a normal agent referencing $prev_note in body */
    const result = scanUndeclaredCallerVars(graph, {});
    const missingNames = result.missing.map(m => typeof m === "string" ? m : (m as any).var ?? (m as any).name);
    expect(missingNames).toContain("prev_note");
  });
});
```

(Mirror the file's existing test patterns for the `/* setup */` comments.)

- [ ] **Step 3: Run, expect failure**

Run: `npx vitest run src/attractor/tests/variable-expansion.test.ts -t "prev_note seed"`
Expected: first test FAIL (prev_note flagged), second test PASS (correctly flagged).

- [ ] **Step 4: Implement seed**

In `scanUndeclaredCallerVars`, after `collectProducers` runs across nodes, walk the graph and for each agent that declares `note` in `outputs:`, add `prev_note` to the producers set:

```ts
// After producers are collected from `produces=` attrs:
for (const node of graph.nodes.values()) {
  const agentName = (node as Record<string, unknown>).agent;
  if (typeof agentName !== "string") continue;
  // (node has its own prompt or label that overrides agent body — same skip rule
  // collectAgentBodyRefs already uses, but for producers we don't need to skip,
  // we just need to know what the agent might emit.)
  const path = resolveAgentMdPath(projectDir, agentName);
  if (!path) continue;
  let raw: string;
  try { raw = readFileSync(path, "utf8"); } catch { continue; }
  const { attributes } = parseFrontmatter(raw);
  const outputs = (attributes as Record<string, unknown>).outputs;
  if (outputs && typeof outputs === "object" && Object.prototype.hasOwnProperty.call(outputs, "note")) {
    producers.add("prev_note");
  }
}
```

(`producers` is the set already built earlier in the function; `resolveAgentMdPath` exists at line 176; `parseFrontmatter` is already imported. Adapt names to match the actual local-variable conventions.)

- [ ] **Step 5: Run, expect pass**

Run: `npx vitest run src/attractor/tests/variable-expansion.test.ts -t "prev_note seed"`
Expected: both PASS.

- [ ] **Step 6: Run full preflight suite**

Run: `npx vitest run src/attractor/tests/variable-expansion.test.ts`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add src/attractor/transforms/variable-expansion.ts src/attractor/tests/variable-expansion.test.ts
git commit -m "feat(preflight): seed prev_note producer for note-declaring loop agents"
```

---

## Chunk 6: Migration of `implement` agent

**Ships green:** `pipelines/illumination-to-implementation/implement.md` declares `loop: true` + `outputs: { done: boolean }`; prompt body instructs the agent to emit `done` truthfully on each iteration WITHOUT compromising its tool use (bash/git). Validator passes; smoke pipelines stay green.

### Task 6.1 — Update implement agent frontmatter and prompt

**Files:**
- Modify: `pipelines/illumination-to-implementation/implement.md`

**Pre-read:** `agent-handler.ts:95-96` defines `jsonWrappedPrompt`. When `jsonSchema` is set, the handler appends a JSON-only reminder to the prompt: `IMPORTANT: Your FINAL response MUST be valid JSON … No markdown, no preamble, output ONLY the JSON object.` This applies to the FINAL turn, not in-session bash/git tool use. The implement agent must therefore use tools freely DURING the iteration but emit ONLY JSON as the FINAL textual response.

- [x] **Step 1: Read current implement.md**

Run: `cat pipelines/illumination-to-implementation/implement.md`
Confirm current frontmatter has `outputs: {}` and tools list `tools: []`.

- [x] **Step 2: Edit frontmatter**

Replace the YAML frontmatter:

```yaml
---
name: implement
description: Autonomous code implementation loop
model: opus
permissionMode: dangerouslySkipPermissions
tools: []
mcp: []
loop: true
outputs:
  done: boolean
---
```

(`loop: true` placed adjacent to `outputs:` for visual coupling.)

- [x] **Step 3: Append `## Output contract` to the prompt body**

After the existing numbered instructions (i.e., after the line ending with "Take your time. I know you got this. I love you.", or wherever the last instruction line is), add:

```markdown

## Output contract

This agent runs in a deep loop: each iteration is a fresh process; you do work via Bash/git/subagent tools during the iteration; the LAST text response of each iteration MUST be a single JSON object describing whether the implementation plan is complete.

Use Bash, git, and subagents freely during the iteration to read, write, commit, and push.

After committing your chunk (or determining no chunks remain), emit JSON as your FINAL TEXT response. Never inside a thinking block.

JSON shape:
- `done: true` — when **every** chunk in the implementation plan is marked complete (`[x]`) AND no `[ ]` items remain.
- `done: false` — when at least one `[ ]` item remains in the plan.

Be honest. False positives leave incomplete work committed and visible in git history. False negatives waste iterations. Re-read the plan after committing to verify your judgment.

Example final response:

\`\`\`json
{ "done": false }
\`\`\`
```

(The trailing instruction "Emit JSON as your final TEXT response. Never inside a thinking block." mirrors the verifier prompt fix from chunk-1. Intentional duplication — both agents need the same anti-thinking-block hint. Edits to one should be considered for the other.)

- [x] **Step 4: Validate the pipeline**

Run: `npm run build && npx ralph pipeline validate pipelines/illumination-to-implementation/pipeline.dot`
Expected: zero errors. (`agent_outputs_empty` warning is gone; `loop_missing_done_field` does not fire because `done: boolean` is now present.)

- [x] **Step 5: Validate every other pipeline regressions**

Run:
```bash
for f in $(find pipelines src/cli/pipelines -name "*.dot"); do
  echo "--- $f"
  npx ralph pipeline validate "$f"
done
```
Expected: zero errors per pipeline.

- [x] **Step 6: Run full vitest suite**

Run: `npm run test`
Expected: all PASS.

- [x] **Step 7: Commit** _(done: 6c473df)_

```bash
git add pipelines/illumination-to-implementation/implement.md
git commit -m "feat(implement-agent): adopt loop:true + done:boolean contract"
```

### Task 6.2 — `pipelines/implement.dot` housekeeping

**Files:** `src/cli/pipelines/implement.dot`

- [x] **Step 1: Inspect**

Run: `cat src/cli/pipelines/implement.dot`

- [x] **Step 2: Decide**

`max_iterations="$max_iterations"` is harmless and supports the `--max N` escape hatch. Keep it. Without `--max` the variable expands to empty → cascade falls to agent default (loop → Infinity). With `--max N` the node-level cap wins.

(No edit. This step is verification only.)

- [x] **Step 3: Smoke validate**

Run: `npx ralph pipeline validate src/cli/pipelines/implement.dot`
Expected: zero errors. (Only `orphan_output` warning — `done` is consumed by the loop handler, not a graph node. Pipeline is valid.)

---

## Chunk 7: Documentation

**Ships green:** README has a short authoring guide for deep-loop agents.

### Task 7.1 — README "Deep loop nodes" section

**Files:** `README.md`

- [ ] **Step 1: Locate insertion point**

Run: `grep -n "^## \|^### " README.md | head -40`
Identify the heading after which the new section fits best (typically below "Pipeline tool nodes and `cwd=`" if it exists; otherwise above the bottom Specs links). Confirm the exact heading with the grep output before editing.

- [ ] **Step 2: Insert section**

Add the following content at the chosen insertion point:

```markdown
### Deep loop nodes (agent-driven self-termination)

Agents that need to iterate until self-declared "done" — e.g. the implement
agent walking an implementation plan one chunk at a time — opt in by adding
`loop: true` and a `done: boolean` field to their frontmatter:

\`\`\`yaml
---
name: my-deep-agent
description: Iterates until the work stack is empty.
model: opus
loop: true
outputs:
  done: boolean
  note: string         # optional cross-iteration handoff
---
\`\`\`

The handler runs the agent in a fresh context window per iteration. After
each iteration it parses the structured output; when `done=true`, the loop
breaks and the pipeline advances. Per-iteration state lives on the
filesystem (commits, plan file). The optional `note: string` field carries
into the next iteration as `$prev_note` (replace, not accumulate). The
LAST iteration's `note` is discarded — persist anything important via files.

Cap behavior:

- `loop: true` with no cap → unlimited; agent's `done` is the only stop.
- Pipeline node attribute `max_iterations="N"` → tightens the cap for one use.
- Agent frontmatter `maxIterations: N` → default cap for the agent.
- Cascade: node > agent > (loop ? Infinity : 1).

Routing on `done`:

\`\`\`dot
deep_node -> next_step  [condition="done=true"]
deep_node -> escalate   [condition="done=false"]
\`\`\`

`done=false` reaches downstream only when the cap is hit without
self-termination. Pipelines can route on it for retry / escalate paths.

Authoring checklist:

- [ ] `loop: true` in frontmatter
- [ ] `outputs: { done: boolean }` (boolean shorthand or `{type: "boolean"}`)
- [ ] Prompt body instructs the agent to emit `done` after each iteration as the FINAL TEXT response (never in a thinking block)
- [ ] (Optional) `note: string` + a `$prev_note` slot in the prompt for cross-iteration self-talk
- [ ] `pipeline validate` passes

The validator rejects `loop: true` without `done: boolean` with error
`loop_missing_done_field`. A non-zero exit during any deep-loop iteration
exits the loop with `agent.success=false`.
```

- [ ] **Step 3: Verify markdown**

Eyeball or run a markdown linter if available.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs(readme): authoring guide for deep loop nodes"
```

---

## Final verification

- [ ] **Step 1: Full test sweep**

Run: `npm run test`
Expected: every test passes; no skipped suites.

- [ ] **Step 2: TypeScript clean**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 3: Build succeeds**

Run: `npm run build`
Expected: `dist/` produced; no build errors.

- [ ] **Step 4: Validate every pipeline in the repo**

Run:
```bash
for f in $(find pipelines src/cli/pipelines -name "*.dot"); do
  echo "--- $f"
  npx ralph pipeline validate "$f"
done
```
Expected: zero errors across all `.dot` files.

- [ ] **Step 5: Live smoke — `ralph implement` on a tiny disposable plan**

In a scratch project:

1. Create `IMPLEMENTATION_PLAN.md` with one chunk and a single `[ ]` task.
2. Run `npx ralph implement <scratch-folder>`.
3. Confirm: agent commits the chunk, marks `[x]`, emits `{ "done": true }` as final text, loop terminates without Ctrl+C.
4. Confirm: TUI shows iteration progress (`onIterationStart` / `onIterationEnd` blocks) and a clean exit.

(Hands-on verification; document the result in the implementation memory but do not block CI on it.)

- [ ] **Step 6: Tag**

```bash
git tag deep-loop-nodes
git push origin main --tags
```

- [ ] **Step 7: Memory write**

Append a short memory file under `/Users/josu/.claude/projects/-Users-josu-Documents-projects-ralph-cli/memory/` named `2026-04-29-deep-loop-nodes-shipped.md` referencing the spec, the chunks, any surprises during implementation. Add an index line to `MEMORY.md`.

---

## Notes for the executing agent

- Chunks 1–3 of `agent-output-validation-and-retry` are **shipped to main** — `evaluateAgentOutput`, `outputs-to-zod.ts`, and the `--resume` retry path already exist. Do not redo.
- Chunk 4 is the largest behavioral change. Run its tests after every edit to the iteration loop body, not just at the end.
- `signal?.aborted` checks remain at the top of the iteration loop body. Do NOT remove them when restructuring.
- Iteration counter must NOT increment on retries (Chunk 4 explicit). Retries are sub-attempts of the same iteration.
- The `onIterationEnd` TUI hook fires only when the loop will continue to iteration `i+1`. When breaking on `done=true`, do NOT call it — the outer `onNodeEnd` closes the block.
- The pre-existing test "does not fail on non-zero exit during multi-iteration loop" (`agent-handler.test.ts:100`) is intentionally re-classified in Chunk 4. It now asserts the OPPOSITE — that any non-zero exit during multi-iteration mode ends the loop with failure. The plan rewrites it; do not skip that step.
- If a behavior gap surfaces during execution that this plan does not cover, update the plan in place and continue. A follow-up chunk is preferred to silent extension.
