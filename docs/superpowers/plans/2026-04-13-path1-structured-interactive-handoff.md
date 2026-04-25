---
status: implemented
---

# Structured Interactive Handoff (Path 1.5) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate file-based conversation handoff between interactive pipeline nodes and downstream nodes by widening `Outcome.contextUpdates` to `Record<string, unknown>`, spawning Claude Code CLI as a long-lived bidirectional stream-json subprocess, and rendering the conversation via a host-owned Ink UI that keeps full conversation history in ralph's memory.

**Architecture:** Two code paths coexist in `src/cli/lib/agent.ts`: legacy `run()` unchanged, plus a new `runInteractive()` returning a `ChildHandle` over an `AsyncIterable<StreamJsonEvent>`. A new `Session` class owns the conversation history; `ChatUI.tsx` (Ink) renders it and drives slash commands; `agent-handler.ts` gains an `interactive=true` branch that mounts ChatUI, awaits exit, flattens a `SubAgentResult`-shaped digest into `contextUpdates`.

**Tech Stack:** TypeScript, Node 18+, Ink 6.8.0, React 19, vitest, ink-testing-library. Claude Code CLI 2.1.69+ for `--input-format stream-json --output-format stream-json --verbose --append-system-prompt --session-id`.

**Spec:** `docs/superpowers/specs/2026-04-10-path1-structured-interactive-handoff-design.md`

---

## Chunks Overview

| Chunk | Phase | Scope |
|---|---|---|
| 1 | P0 | Type widening: `Outcome.contextUpdates` + checkpoint + context merge + coercion at 3 call sites |
| 2 | P1 | Bug B.1 (`wait-human.ts` label expansion) + Bug B.2 (`graph.ts` unescape in `parseAttrs`) |
| 3 | P2 | New `session.ts`, `slash-commands.ts`, `stream-json-input.ts` + unit tests |
| 4 | P3 | `agent.runInteractive()` + typed raw-event iterator + contract tests |
| 5 | P4 + P5 | `TextInput.tsx` + `ChatUI.tsx` + component tests |
| 6 | P6 | `agent-handler.ts` interactive branch + handler integration tests |
| 7 | P7 + P8 | Smoke pipelines + manual verification checklist |

All tasks use `- [ ]` checkboxes. Each task is TDD: write failing test → verify failure → implement minimal code → verify passing → commit.

---

## Conventions Used In This Plan

- **File paths** are absolute from repo root (e.g. `src/cli/lib/session.ts`).
- **Line references** match the state captured at spec approval. If the plan says `engine.ts:196` but the executor finds the line has shifted by a few due to earlier chunks, the executor updates the reference and proceeds — the surrounding context string is the source of truth.
- **Commands** assume `cwd = /Users/josu/Documents/projects/ralph-cli` unless noted.
- **Commit messages** use Conventional Commits (`feat:`, `fix:`, `test:`, `refactor:`, `chore:`). One logical change per commit.
- **Test command** is `npm test` for the whole suite, or `npx vitest run <pattern>` for a targeted file.
- **Skill references:** `@superpowers:test-driven-development` for every test-first step, `@superpowers:verification-before-completion` before claiming chunk done.

---

## Chunk 1: P0 — Type Widening (`Outcome.contextUpdates` to `unknown`)

**Goal:** Widen `Outcome.contextUpdates` and `CheckpointState.context` from `Record<string, string>` to `Record<string, unknown>`. Add explicit `String(...)` coercion at three call sites that inject context values into strings (preamble, variable expansion, conditions). Every existing pipeline must continue to behave identically — this is pure variance widening.

**Verification after chunk complete:**
- [ ] `npm test` is green.
- [ ] `npm run build` succeeds with no type errors.
- [ ] `ralph pipeline run pipelines/illumination-to-plan.dot` (if you have time for a dry run) completes the same way it did before.

### Task 1.1: Widen `Outcome.contextUpdates` and related types

**Files:**
- Modify: `src/attractor/types.ts:9,66,70`
- Modify: `src/attractor/core/engine.ts:32` (`PipelineResult.context`)

- [ ] **Step 1: Read the current shape**

Run: `grep -n 'contextUpdates' src/attractor/types.ts`
Expected output: `9:  contextUpdates?: Record<string, string>;`

- [ ] **Step 2: Write a regression test asserting that numeric/boolean/object values survive a round trip through `Outcome`**

Create: `src/attractor/tests/context-widening.test.ts`

```ts
import { describe, it, expect } from "vitest";
import type { Outcome, CheckpointState } from "../types.js";

describe("Outcome.contextUpdates widened to unknown", () => {
  it("accepts string values (backwards compat)", () => {
    const o: Outcome = {
      status: "success",
      contextUpdates: { "k.s": "value" },
    };
    expect(o.contextUpdates!["k.s"]).toBe("value");
  });

  it("accepts number values", () => {
    const o: Outcome = {
      status: "success",
      contextUpdates: { "k.n": 42 },
    };
    expect(o.contextUpdates!["k.n"]).toBe(42);
  });

  it("accepts boolean values", () => {
    const o: Outcome = {
      status: "success",
      contextUpdates: { "k.b": true },
    };
    expect(o.contextUpdates!["k.b"]).toBe(true);
  });

  it("accepts object values", () => {
    const digest = { messageCount: 3, tools: [] as unknown[] };
    const o: Outcome = {
      status: "success",
      contextUpdates: { "k.o": digest },
    };
    expect(o.contextUpdates!["k.o"]).toEqual(digest);
  });

  it("CheckpointState.context accepts unknown values", () => {
    const state: CheckpointState = {
      timestamp: "2026-04-13T00:00:00.000Z",
      currentNode: "n1",
      completedNodes: [],
      nodeRetries: {},
      context: { "k.n": 42, "k.s": "v" },
    };
    expect(state.context["k.n"]).toBe(42);
  });
});
```

- [ ] **Step 3: Run the test and verify it fails with type errors**

Run: `npx vitest run src/attractor/tests/context-widening.test.ts`
Expected: TypeScript compile error `Type 'number' is not assignable to type 'string'` (or similar) for the `number`/`boolean`/`object` cases.

- [ ] **Step 4: Widen `Outcome.contextUpdates`, `CheckpointState.context`, and `PipelineContext.values`**

Edit `src/attractor/types.ts`:

```ts
// line 9 — before
contextUpdates?: Record<string, string>;
// line 9 — after
contextUpdates?: Record<string, unknown>;
```

```ts
// line 66 — before
context: Record<string, string>;
// line 66 — after
context: Record<string, unknown>;
```

```ts
// line 70 — before
export interface PipelineContext {
  values: Record<string, string>;
}
// after
export interface PipelineContext {
  values: Record<string, unknown>;
}
```

Then edit `src/attractor/core/engine.ts`:

```ts
// line 32 — before
context: Record<string, string>;
// line 32 — after
context: Record<string, unknown>;
```

- [ ] **Step 5: Run the test and verify it passes (type errors gone)**

Run: `npx vitest run src/attractor/tests/context-widening.test.ts`
Expected: 5 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/attractor/types.ts src/attractor/core/engine.ts src/attractor/tests/context-widening.test.ts
git commit -m "feat(types): widen Outcome.contextUpdates and context map types to unknown"
```

### Task 1.2: Update engine context merge to accept `unknown`

**Files:**
- Modify: `src/attractor/core/engine.ts:54-91` (selectNextEdge) and `:194-197` (merge site)

- [ ] **Step 1: Identify every place engine.ts types context as `Record<string, string>`**

Run: `grep -n 'Record<string' src/attractor/core/engine.ts`
Expected: at least two occurrences — `selectNextEdge` signature (ctx param, ~line 57) and the inner `context` local variable.

- [ ] **Step 2: Write a test that puts a numeric contextUpdate through a full engine run**

Add to: `src/attractor/tests/engine.test.ts` (inside the existing `describe("runPipeline", ...)` block, after the "runs a minimal pipeline to completion" test).

The existing engine tests mock `Agent.run` at module load (see the top of `engine.test.ts`). We piggy-back on that mock to inject a numeric contextUpdate by having the fake agent return usage the handler will surface. Simpler: monkey-patch the `AgentHandler.execute` method directly for this one test using `vi.spyOn` so the handler returns a controlled outcome.

```ts
it("merges unknown-typed contextUpdates without coercion", async () => {
  const dot = `digraph g {
    start [shape=Mdiamond]
    work  [shape=box, type=codergen, prompt="Do the work"]
    done  [shape=Msquare]
    start -> work -> done
  }`;
  // Intercept the codergen handler's execute to return non-string context updates.
  const { AgentHandler } = await import("../handlers/agent-handler.js");
  const spy = vi.spyOn(AgentHandler.prototype, "execute").mockResolvedValue({
    status: "success",
    contextUpdates: { "work.num": 42, "work.bool": true, "work.obj": { a: 1 } },
  });
  try {
    const result = await runPipeline(parseDot(dot), makeOpts(dir));
    expect(result.status).toBe("success");
    expect(result.context["work.num"]).toBe(42);
    expect(result.context["work.bool"]).toBe(true);
    expect(result.context["work.obj"]).toEqual({ a: 1 });
    // Critically: not coerced to strings.
    expect(typeof result.context["work.num"]).toBe("number");
    expect(typeof result.context["work.bool"]).toBe("boolean");
  } finally {
    spy.mockRestore();
  }
});
```

This reuses the existing `mockOpts(dir)` helper, the `vi.mock` at top of file that stubs `Agent.run`, and adds a targeted `vi.spyOn` on `AgentHandler.prototype.execute` — no new test harness required.

- [ ] **Step 3: Run the test, verify it fails**

Run: `npx vitest run src/attractor/tests/engine.test.ts -t "unknown-typed contextUpdates"`
Expected: FAIL — either a type error or the merged value has been coerced to a string.

- [ ] **Step 4: Widen the engine's context typing**

Edit `src/attractor/core/engine.ts`:

1. Find the local `let context: Record<string, string>` declaration and change to `Record<string, unknown>`.
2. In `selectNextEdge(node, outcome, ctx, edges)`, change the `ctx` parameter from `Record<string, string>` to `Record<string, unknown>`.
3. The merge at line ~196 `context = { ...context, ...outcome.contextUpdates };` needs no change — spread already preserves values.
4. If `saveCheckpoint` downstream receives `context`, confirm `CheckpointState.context` already widened in Task 1.1 (yes).

- [ ] **Step 5: Run the test, verify it passes**

Run: `npx vitest run src/attractor/tests/engine.test.ts -t "unknown-typed contextUpdates"`
Expected: PASS.

- [ ] **Step 6: Run the full test suite to catch ripples**

Run: `npm test`
Expected: all green. If a downstream file (checkpoint, preamble, expansion, conditions) refuses to compile, that's covered in Tasks 1.3–1.6 — but engine.ts must compile standalone.

- [ ] **Step 7: Commit**

```bash
git add src/attractor/core/engine.ts src/attractor/tests/engine.test.ts
git commit -m "feat(engine): propagate unknown-typed context through pipeline merge"
```

### Task 1.3: Coerce non-string values in `buildPreamble`

**Files:**
- Modify: `src/attractor/transforms/preamble.ts:14`
- Test: `src/attractor/tests/transforms.test.ts` (EXTEND — do NOT create a new file; the existing file already imports `buildPreamble` and `expandVariables` at lines 1–3)

- [ ] **Step 1: Confirm the existing test file covers both transforms**

Run: `head -5 src/attractor/tests/transforms.test.ts`
Expected: imports from `../transforms/variable-expansion.js` and `../transforms/preamble.js`. This is where all preamble + variable-expansion test cases live.

- [ ] **Step 2: Append a failing test block for non-string coercion**

Append to `src/attractor/tests/transforms.test.ts` (after the existing `describe` blocks, same file):

```ts
describe("buildPreamble coerces non-string context values", () => {
  const base = (ctx: Record<string, unknown>): CheckpointState => ({
    timestamp: "",
    currentNode: "n1",
    completedNodes: ["a"],
    nodeRetries: {},
    context: ctx,
  });

  it("coerces numbers via String()", () => {
    const out = buildPreamble(base({ "k.n": 42 }), "compact");
    expect(out).toContain("k.n: 42");
  });

  it("coerces booleans via String()", () => {
    const out = buildPreamble(base({ "k.b": true }), "compact");
    expect(out).toContain("k.b: true");
  });

  it("stringifies objects via JSON.stringify", () => {
    const out = buildPreamble(base({ "k.o": { a: 1, b: 2 } }), "compact");
    expect(out).toContain('k.o: {"a":1,"b":2}');
  });

  it("handles null/undefined", () => {
    const out = buildPreamble(base({ "k.null": null, "k.undef": undefined }), "compact");
    expect(out).toContain("k.null: null");
    expect(out).toContain("k.undef: undefined");
  });
});
```

- [ ] **Step 3: Run test, verify it fails**

Run: `npx vitest run src/attractor/tests/transforms.test.ts -t "buildPreamble coerces"`
Expected: FAIL — current code does `lines.push(\`  ${k}: ${v}\`)` which stringifies objects as `[object Object]`.

- [ ] **Step 4: Implement coercion**

Edit `src/attractor/transforms/preamble.ts`:

```ts
// lines 11-16 — before
if (Object.keys(checkpoint.context).length > 0) {
  lines.push("Key context values:");
  for (const [k, v] of Object.entries(checkpoint.context)) {
    lines.push(`  ${k}: ${v}`);
  }
}
// after
if (Object.keys(checkpoint.context).length > 0) {
  lines.push("Key context values:");
  for (const [k, v] of Object.entries(checkpoint.context)) {
    const rendered =
      typeof v === "string" || typeof v === "number" || typeof v === "boolean" || v == null
        ? String(v)
        : JSON.stringify(v);
    lines.push(`  ${k}: ${rendered}`);
  }
}
```

Also widen the function signature to accept `CheckpointState` with `context: Record<string, unknown>` — the type is already widened in Chunk 1.1, so this is automatic.

- [ ] **Step 5: Run test, verify it passes**

Run: `npx vitest run src/attractor/tests/transforms.test.ts -t "buildPreamble coerces"`
Expected: all 4 cases PASS.

- [ ] **Step 6: Commit**

```bash
git add src/attractor/transforms/preamble.ts src/attractor/tests/transforms.test.ts
git commit -m "fix(preamble): coerce non-string context values via String()/JSON.stringify"
```

### Task 1.4: Coerce non-string values in `expandVariables`

**Files:**
- Modify: `src/attractor/transforms/variable-expansion.ts:7-12`
- Test: `src/attractor/tests/transforms.test.ts` (EXTEND — this file already tests `expandVariables`; do NOT create a new file)

- [ ] **Step 1: Append a failing test block to transforms.test.ts**

Append after the preamble tests added in Task 1.3:

```ts
describe("expandVariables coerces non-string context values", () => {
  it("expands a numeric context value", () => {
    // Post-Task-1.1 widening, ctx is Record<string, unknown> — no cast needed.
    const out = expandVariables("turns=$chat.turnsUsed", { "chat.turnsUsed": 7 });
    expect(out).toBe("turns=7");
  });

  it("expands a boolean context value", () => {
    const out = expandVariables("ok=$chat.success", { "chat.success": true });
    expect(out).toBe("ok=true");
  });

  it("stringifies an object context value", () => {
    const out = expandVariables("d=$chat.digest", { "chat.digest": { n: 1 } });
    expect(out).toBe('d={"n":1}');
  });

  it("passes through string values unchanged", () => {
    const out = expandVariables("s=$k", { k: "hello" });
    expect(out).toBe("s=hello");
  });
});
```

- [ ] **Step 2: Run test, verify failure**

Run: `npx vitest run src/attractor/tests/transforms.test.ts -t "expandVariables coerces"`
Expected: FAIL — the signature is still `Record<string, string>` so the non-string calls are type errors; once the code is changed the object case would still produce `[object Object]` without coercion.

- [ ] **Step 3: Widen the signature and implement coercion**

Edit `src/attractor/transforms/variable-expansion.ts`:

```ts
// lines 1-12 — before
import type { Graph } from "../types.js";

/**
 * Expand $key references in a string against a key-value context.
 * Skips $goal and $project (handled by the graph-level transform).
 */
export function expandVariables(s: string, ctx: Record<string, string>): string {
  return s.replace(/\$([a-zA-Z_][\w.]*)/g, (match, key) => {
    if (key === "goal" || key === "project") return match;
    return ctx[key] ?? match;
  });
}
// after
import type { Graph } from "../types.js";

/**
 * Expand $key references in a string against a key-value context.
 * Skips $goal and $project (handled by the graph-level transform).
 *
 * Non-string values are coerced via String() for primitives or
 * JSON.stringify() for objects. Matches the spec's coercion rule
 * (§3.9 row 4).
 */
export function expandVariables(s: string, ctx: Record<string, unknown>): string {
  return s.replace(/\$([a-zA-Z_][\w.]*)/g, (match, key) => {
    if (key === "goal" || key === "project") return match;
    const v = ctx[key];
    if (v === undefined) return match;
    if (typeof v === "string") return v;
    if (typeof v === "number" || typeof v === "boolean" || v === null) return String(v);
    return JSON.stringify(v);
  });
}
```

Also update `variableExpansionTransform(graph, vars)` signature at the bottom of the same file — the `vars.context?: Record<string, string>` becomes `Record<string, unknown>`.

- [ ] **Step 4: Run test, verify pass**

Run: `npx vitest run src/attractor/tests/transforms.test.ts -t "expandVariables coerces"`
Expected: all 4 cases PASS.

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: all green. If anything else breaks it's likely a type error from a caller passing `Record<string, string>` where `unknown` is now accepted (covariant — should be fine).

- [ ] **Step 6: Commit**

```bash
git add src/attractor/transforms/variable-expansion.ts src/attractor/tests/transforms.test.ts
git commit -m "fix(variable-expansion): coerce non-string context values"
```

### Task 1.5: Widen `conditions.ts` ContextMap + coerce in `resolveKey`

**Files:**
- Modify: `src/attractor/core/conditions.ts:3,5-11`
- Test: `src/attractor/tests/conditions.test.ts` (extend)

- [ ] **Step 1: Write a failing test for non-string LHS comparison**

```ts
import { describe, it, expect } from "vitest";
import { evaluateCondition } from "../core/conditions.js";
import type { Outcome } from "../types.js";

describe("evaluateCondition handles unknown-typed context values", () => {
  const success: Outcome = { status: "success" };

  it("compares numeric context value via string coercion", () => {
    // Post-Task-1.1 widening, ContextMap is Record<string, unknown> — no cast needed.
    const ctx: Record<string, unknown> = { "chat.turnsUsed": 7 };
    expect(evaluateCondition("context.chat.turnsUsed=7", success, ctx)).toBe(true);
    expect(evaluateCondition("context.chat.turnsUsed=8", success, ctx)).toBe(false);
  });

  it("compares boolean context value via string coercion", () => {
    const ctx: Record<string, unknown> = { "chat.success": true };
    expect(evaluateCondition("context.chat.success=true", success, ctx)).toBe(true);
    expect(evaluateCondition("context.chat.success=false", success, ctx)).toBe(false);
  });
});
```

- [ ] **Step 2: Run, verify failure (type error or comparison mismatch)**

Run: `npx vitest run src/attractor/tests/conditions.test.ts -t "unknown-typed"`
Expected: FAIL (type error on the test casts, OR comparison returns wrong result if the raw object shows up).

- [ ] **Step 3: Widen `ContextMap` and coerce in `resolveKey`**

Edit `src/attractor/core/conditions.ts`:

```ts
// line 3 — before
type ContextMap = Record<string, string>;

// after
type ContextMap = Record<string, unknown>;
```

```ts
// lines 5-11 — before
function resolveKey(key: string, outcome: Outcome, ctx: ContextMap): string {
  if (key === "outcome") return outcome.status;
  if (key === "preferred_label") return outcome.preferredLabel ?? "";
  // Support both "context.X" (prefixed key) and unprefixed context value lookup
  if (key.startsWith("context.")) return ctx[key] ?? ctx[key.slice(8)] ?? "";
  return "";
}

// after
function resolveKey(key: string, outcome: Outcome, ctx: ContextMap): string {
  if (key === "outcome") return outcome.status;
  if (key === "preferred_label") return outcome.preferredLabel ?? "";
  if (key.startsWith("context.")) {
    const v = ctx[key] ?? ctx[key.slice(8)];
    if (v === undefined || v === null) return "";
    if (typeof v === "string") return v;
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    return JSON.stringify(v);
  }
  return "";
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `npx vitest run src/attractor/tests/conditions.test.ts`
Expected: all tests pass (new + existing).

- [ ] **Step 5: Commit**

```bash
git add src/attractor/core/conditions.ts src/attractor/tests/conditions.test.ts
git commit -m "fix(conditions): coerce non-string context values in resolveKey"
```

### Task 1.6: Checkpoint round-trip preserves non-string values

**Files:**
- Modify: `src/attractor/checkpoint.ts` (no functional change — just confirm the widened `CheckpointState` type flows through)
- Test: `src/attractor/tests/checkpoint.test.ts` (extend)

- [ ] **Step 1: Write a failing test for round-trip of non-string values**

```ts
import { describe, it, expect } from "vitest";
import { saveCheckpoint, loadCheckpoint } from "../checkpoint.js";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { CheckpointState } from "../types.js";

describe("checkpoint round-trip with unknown context values", () => {
  it("preserves numbers, booleans, and nested objects", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ralph-ckpt-"));
    try {
      const state: CheckpointState = {
        timestamp: "2026-04-13T00:00:00.000Z",
        currentNode: "n1",
        completedNodes: ["start"],
        nodeRetries: {},
        context: {
          "chat.turnsUsed": 7,
          "chat.success": true,
          "chat.digest": { messageCount: 14, usage: { inputTokens: 100, outputTokens: 50 }, tools: [] },
          "chat.output": "plain string",
        },
      };
      await saveCheckpoint(dir, state);
      const loaded = await loadCheckpoint(dir);
      expect(loaded).not.toBeNull();
      expect(loaded!.context["chat.turnsUsed"]).toBe(7);
      expect(loaded!.context["chat.success"]).toBe(true);
      expect(loaded!.context["chat.digest"]).toEqual({
        messageCount: 14,
        usage: { inputTokens: 100, outputTokens: 50 },
        tools: [],
      });
      expect(loaded!.context["chat.output"]).toBe("plain string");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run, verify it either already passes OR fails on a type check**

Run: `npx vitest run src/attractor/tests/checkpoint.test.ts -t "unknown context values"`
Expected: likely **passes without modification** — `JSON.parse`/`JSON.stringify` are value-preserving. If type errors appear, the cast-free path of Task 1.1 already fixed them.

- [ ] **Step 3: If the test passes, no code change needed — commit the test**

```bash
git add src/attractor/tests/checkpoint.test.ts
git commit -m "test(checkpoint): round-trip preserves unknown-typed context values"
```

- [ ] **Step 4: Run full test suite + build**

Run: `npm test && npm run build`
Expected: all green. This is the P0 gate — non-interactive pipelines must be unaffected.

### Task 1.7: Chunk 1 verification gate

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all previously passing tests still pass. New tests added in 1.1–1.6 all pass.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: exit code 0, no type errors.

- [ ] **Step 3: Sanity-check existing pipeline parses and executes a dry step**

Run: `ralph pipeline validate pipelines/illumination-to-plan.dot` (if such a subcommand exists; otherwise `ralph pipeline list pipelines/`)
Expected: no validation errors.

- [ ] **Step 4: Mark Chunk 1 complete**

No commit here — Chunk 1 is done when all 1.1–1.6 commits have landed and the verification gate passes.

---

## Chunk 2: P1 — Bug Rollups (wait-human label expansion + DOT unescape)

**Goal:** Fix two pre-existing bugs that this spec rolls up. Both are small, localized, and independently testable.

- **Bug B.1:** `src/attractor/handlers/wait-human.ts:18` uses `node.label` verbatim, so `${var}` references in the label are never expanded against context.
- **Bug B.2:** `src/attractor/core/graph.ts:parseAttrs()` at line 25–35 does not unescape `\n`, `\t`, `\"`, `\\` inside double-quoted DOT attribute values, so a DOT file with multi-line prompts stored via `\n` arrives at the handler verbatim.

**Verification after chunk:**
- [ ] `npm test` green.
- [ ] New tests for B.1 and B.2 added and passing.
- [ ] No regressions in `graph.test.ts` on unquoted identifier values.

### Task 2.1: Bug B.1 — expand `${var}` references in wait-human label

**Files:**
- Modify: `src/attractor/handlers/wait-human.ts:18`
- Test: `src/attractor/tests/wait-human.test.ts` (new or extend)

- [ ] **Step 1: Write a failing test**

Add to `src/attractor/tests/wait-human.test.ts` (create file if missing — mirror `handlers.test.ts` structure for interviewer mocking):

```ts
import { describe, it, expect, vi } from "vitest";
import { WaitHumanHandler } from "../handlers/wait-human.js";
import type { Interviewer, Question, Answer } from "../interviewer/index.js";
import type { Node } from "../types.js";

describe("WaitHumanHandler — label variable expansion (Bug B.1)", () => {
  it("expands $var references in the label before showing to the user", async () => {
    const captured: Question[] = [];
    const interviewer: Interviewer = {
      ask: async (q: Question): Promise<Answer> => {
        captured.push(q);
        return { value: "continue" };
      },
    };
    const handler = new WaitHumanHandler(interviewer);
    const node: Node = {
      id: "gate",
      label: "Review $chat.output before continuing",
    };
    const ctx = { values: { "chat.output": "the proposal text" } };
    const meta = { outgoingLabels: ["continue"] };

    await handler.execute(node, ctx as any, meta);

    expect(captured[0].prompt).toBe("Review the proposal text before continuing");
  });

  it("leaves unreferenced labels unchanged", async () => {
    const captured: Question[] = [];
    const interviewer: Interviewer = {
      ask: async (q) => { captured.push(q); return { value: "continue" }; },
    };
    const handler = new WaitHumanHandler(interviewer);
    const node: Node = { id: "gate", label: "Just continue" };
    await handler.execute(node, { values: {} } as any, { outgoingLabels: ["continue"] });
    expect(captured[0].prompt).toBe("Just continue");
  });
});
```

- [ ] **Step 2: Run, verify failure**

Run: `npx vitest run src/attractor/tests/wait-human.test.ts`
Expected: first test fails — captured prompt is the raw `"Review $chat.output before continuing"`.

- [ ] **Step 3: Implement the fix**

Edit `src/attractor/handlers/wait-human.ts`:

```ts
// line 1-3 — add import
import type { NodeHandler } from "./registry.js";
import type { Node, Outcome, PipelineContext } from "../types.js";
import type { Interviewer } from "../interviewer/index.js";
import { expandVariables } from "../transforms/variable-expansion.js";
```

```ts
// line 16-20 — before
const askPromise = this.interviewer.ask({
  type: "MULTIPLE_CHOICE",
  prompt: node.label ?? node.id,
  options: labels.length > 0 ? labels : ["continue"],
});

// after
const rawLabel = node.label ?? node.id;
// Post-Chunk-1, PipelineContext.values is already Record<string, unknown> — no cast needed.
const expandedLabel = expandVariables(rawLabel, ctx.values);
const askPromise = this.interviewer.ask({
  type: "MULTIPLE_CHOICE",
  prompt: expandedLabel,
  options: labels.length > 0 ? labels : ["continue"],
});
```

Note: the `_ctx` parameter at line 8 must be renamed to `ctx` since we now use it. The existing signature is `execute(node: Node, _ctx: PipelineContext, meta: ...)`.

- [ ] **Step 4: Run, verify pass**

Run: `npx vitest run src/attractor/tests/wait-human.test.ts`
Expected: both tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/attractor/handlers/wait-human.ts src/attractor/tests/wait-human.test.ts
git commit -m "fix(wait-human): expand \${var} references in label before rendering"
```

### Task 2.2: Bug B.2 — unescape `\n`, `\t`, `\"`, `\\` inside quoted DOT attrs

**Files:**
- Modify: `src/attractor/core/graph.ts:25-35` (`parseAttrs`)
- Test: `src/attractor/tests/graph.test.ts`

- [ ] **Step 1: Write a failing test for multi-line prompt via `\n`**

Add to `src/attractor/tests/graph.test.ts`:

```ts
describe("parseDot — Bug B.2 unescape inside quoted attributes", () => {
  it("unescapes \\n inside quoted node attr", () => {
    const src = `digraph t { n1 [kind=agent, prompt="line1\\nline2"]; }`;
    const g = parseDot(src);
    const n = g.nodes.get("n1")!;
    expect(n.prompt).toBe("line1\nline2");
  });

  it("unescapes \\t and \\\" inside quoted attr", () => {
    const src = `digraph t { n1 [kind=agent, prompt="tab\\there and \\\"quote\\\""]; }`;
    const g = parseDot(src);
    expect(g.nodes.get("n1")!.prompt).toBe('tab\there and "quote"');
  });

  it("unescapes \\\\ inside quoted attr", () => {
    const src = `digraph t { n1 [kind=agent, prompt="a\\\\b"]; }`;
    const g = parseDot(src);
    expect(g.nodes.get("n1")!.prompt).toBe("a\\b");
  });

  it("does NOT touch unquoted values (kind=agent)", () => {
    const src = `digraph t { n1 [kind=agent, weight=5]; }`;
    const g = parseDot(src);
    const n = g.nodes.get("n1")!;
    expect(n.kind).toBe("agent");
    expect(n.weight).toBe(5);
  });

  it("does NOT interpret backslashes in unquoted identifier values", () => {
    // Regression guard: if an unquoted value somehow contained a backslash
    // (unlikely in well-formed DOT but defensively tested), it must pass through
    // untouched. This guards against applying unescape globally.
    const src = `digraph t { n1 [kind=agent]; }`;
    const g = parseDot(src);
    expect(g.nodes.get("n1")!.kind).toBe("agent");
  });
});
```

- [ ] **Step 2: Run, verify failure**

Run: `npx vitest run src/attractor/tests/graph.test.ts -t "Bug B.2"`
Expected: the first three tests fail (literal `\n` etc. in the parsed value); the unquoted tests pass.

- [ ] **Step 3: Implement scoped unescape**

The existing regex at line 27 is:

```ts
const re = /(\w+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s,\]]+))/g;
```

Group `m[2]` is the **quoted** value (without surrounding quotes); group `m[3]` is the **unquoted** value. The fix is to call `unescapeDotString()` **only** on `m[2]`.

Edit `src/attractor/core/graph.ts`:

```ts
// Add helper above parseAttrs (around line 24)
function unescapeDotString(s: string): string {
  // Order matters: handle \\ first so \\n is preserved as literal "\n".
  // We use a single pass with a regex to avoid the double-replacement pitfall.
  return s.replace(/\\(.)/g, (_, ch) => {
    switch (ch) {
      case "n": return "\n";
      case "t": return "\t";
      case "r": return "\r";
      case '"': return '"';
      case "\\": return "\\";
      default: return ch; // unknown escape: drop the backslash
    }
  });
}

// Modify parseAttrs (lines 25-35) — before
function parseAttrs(attrStr: string): Record<string, unknown> {
  const attrs: Record<string, unknown> = {};
  const re = /(\w+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s,\]]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(attrStr)) !== null) {
    const key = toCamel(m[1]);
    const val = m[2] !== undefined ? m[2] : m[3];
    attrs[key] = coerceValue(val);
  }
  return attrs;
}

// after
function parseAttrs(attrStr: string): Record<string, unknown> {
  const attrs: Record<string, unknown> = {};
  const re = /(\w+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s,\]]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(attrStr)) !== null) {
    const key = toCamel(m[1]);
    // m[2] is the quoted value (escape sequences apply);
    // m[3] is the unquoted value (raw identifier/number/bool — no escape processing)
    const rawVal = m[2] !== undefined ? unescapeDotString(m[2]) : m[3];
    attrs[key] = coerceValue(rawVal);
  }
  return attrs;
}
```

**Note on the regex single-pass approach:** The `\\(.)/g` form processes each backslash-escape pair exactly once left-to-right, so the input `\\n` (two chars: backslash + n) becomes literal `\n` (single newline) only when it was written in the DOT source as `\n` (backslash + n). Input `\\\\n` in the DOT source (four chars: two backslashes + n) is parsed by JS as `\\n` (backslash + n), which unescape reads as `\` + `n` → `\n` (two chars: literal backslash + literal n). This matches DOT semantics.

- [ ] **Step 4: Run, verify all tests pass including unquoted regression**

Run: `npx vitest run src/attractor/tests/graph.test.ts`
Expected: all tests (new + existing) pass.

- [ ] **Step 5: Run full suite to catch collateral**

Run: `npm test`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/attractor/core/graph.ts src/attractor/tests/graph.test.ts
git commit -m "fix(graph): unescape \\n/\\t/\\\"/\\\\ inside quoted DOT attribute values"
```

### Task 2.3: Chunk 2 verification gate

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: all green.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: no type errors.

- [ ] **Step 3: Sanity-check `illumination-to-plan.dot` still parses**

Run: `ralph pipeline validate pipelines/illumination-to-plan.dot` (or equivalent)
Expected: no new errors.

---

## Chunk 3: P2 — Session Primitive + Slash Commands + Stream-JSON Input

**Goal:** Create three small pure-function modules that the ChatUI and `runInteractive()` will depend on:

1. `src/cli/lib/session.ts` — `Session` class, `Turn` union, `Usage`, `ToolCall`, `ExitReason`, `InteractiveSessionDigest`, `buildSessionDigest()`.
2. `src/cli/lib/slash-commands.ts` — `parseSlashCommand()` discriminated union, `HELP_TEXT` constant.
3. `src/cli/lib/stream-json-input.ts` — `formatUserTurn(text)` → NDJSON line.

All three are pure, I/O-free, and covered by unit tests. No spawns, no disk.

**Verification after chunk:**
- [ ] New test files all pass.
- [ ] `npm run build` succeeds.
- [ ] No behavioral change to any existing command.

### Task 3.1: Create `src/cli/lib/session.ts`

**Files:**
- Create: `src/cli/lib/session.ts`
- Test: `src/cli/tests/session.test.ts`

- [ ] **Step 1: Write the failing test file**

Create `src/cli/tests/session.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { Session, buildSessionDigest, type Turn } from "../lib/session.js";

describe("Session", () => {
  it("starts with empty history and configured id", () => {
    const s = new Session("abc-123");
    expect(s.id).toBe("abc-123");
    expect(s.history).toEqual([]);
    expect(s.exitReason).toBeUndefined();
  });

  it("lastAssistantText returns empty string for empty history", () => {
    const s = new Session("x");
    expect(s.lastAssistantText()).toBe("");
  });

  it("lastAssistantText returns the most recent assistant turn", () => {
    const s = new Session("x");
    s.history.push({ role: "user", text: "hi", at: 1 });
    s.history.push({ role: "assistant", text: "first", toolCalls: [], at: 2 });
    s.history.push({ role: "user", text: "more", at: 3 });
    s.history.push({ role: "assistant", text: "latest", toolCalls: [], at: 4 });
    expect(s.lastAssistantText()).toBe("latest");
  });

  it("turnsUsed counts user turns only", () => {
    const s = new Session("x");
    s.history.push({ role: "user", text: "1", at: 1 });
    s.history.push({ role: "assistant", text: "a", toolCalls: [], at: 2 });
    s.history.push({ role: "user", text: "2", at: 3 });
    s.history.push({ role: "system", text: "note", at: 4 });
    expect(s.turnsUsed()).toBe(2);
  });

  it("aggregateUsage sums across assistant turns", () => {
    const s = new Session("x");
    s.history.push({
      role: "assistant",
      text: "a",
      toolCalls: [],
      at: 1,
      usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 10 },
    });
    s.history.push({
      role: "assistant",
      text: "b",
      toolCalls: [],
      at: 2,
      usage: { inputTokens: 200, outputTokens: 75 },
    });
    const u = s.aggregateUsage();
    expect(u.inputTokens).toBe(300);
    expect(u.outputTokens).toBe(125);
    expect(u.cacheReadTokens).toBe(10);
  });

  it("aggregateUsage returns zeroes for empty history", () => {
    const s = new Session("x");
    expect(s.aggregateUsage()).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it("aggregateUsage ignores assistant turns with no usage field", () => {
    const s = new Session("x");
    s.history.push({ role: "assistant", text: "a", toolCalls: [], at: 1 });
    s.history.push({
      role: "assistant",
      text: "b",
      toolCalls: [],
      at: 2,
      usage: { inputTokens: 50, outputTokens: 25 },
    });
    const u = s.aggregateUsage();
    expect(u.inputTokens).toBe(50);
    expect(u.outputTokens).toBe(25);
  });

  it("toolCallsSummary returns empty array for history with no tool calls", () => {
    const s = new Session("x");
    s.history.push({ role: "assistant", text: "a", toolCalls: [], at: 1 });
    expect(s.toolCallsSummary()).toEqual([]);
  });

  it("toolCallsSummary groups and counts tools", () => {
    const s = new Session("x");
    s.history.push({
      role: "assistant",
      text: "",
      at: 1,
      toolCalls: [
        { id: "1", name: "Read", input: {} },
        { id: "2", name: "Read", input: {} },
        { id: "3", name: "Bash", input: {} },
      ],
    });
    s.history.push({
      role: "assistant",
      text: "",
      at: 2,
      toolCalls: [{ id: "4", name: "Read", input: {} }],
    });
    const summary = s.toolCallsSummary();
    expect(summary).toEqual(
      expect.arrayContaining([
        { name: "Read", count: 3 },
        { name: "Bash", count: 1 },
      ]),
    );
    expect(summary).toHaveLength(2);
  });
});

describe("buildSessionDigest", () => {
  it("empty session yields empty-string output with turnsUsed=0", () => {
    const s = new Session("x");
    s.exitReason = "user_end";
    const d = buildSessionDigest(s);
    expect(d.output).toBe("");
    expect(d.turnsUsed).toBe(0);
    expect(d.success).toBe(true);
    expect(d.sessionId).toBe("x");
    expect(d.exitReason).toBe("user_end");
    expect(d.transcriptPath).toBeNull();
    expect(d.digest.messageCount).toBe(0);
  });

  it("user_end → success=true", () => {
    const s = new Session("x");
    s.history.push({ role: "assistant", text: "final", toolCalls: [], at: 1 });
    s.exitReason = "user_end";
    expect(buildSessionDigest(s).success).toBe(true);
  });

  it("turn_limit → success=true (graceful)", () => {
    const s = new Session("x");
    s.exitReason = "turn_limit";
    expect(buildSessionDigest(s).success).toBe(true);
  });

  it("abort → success=false", () => {
    const s = new Session("x");
    s.exitReason = "abort";
    expect(buildSessionDigest(s).success).toBe(false);
  });

  it("child_crash → success=false", () => {
    const s = new Session("x");
    s.exitReason = "child_crash";
    expect(buildSessionDigest(s).success).toBe(false);
  });

  it("parse_error → success=false", () => {
    const s = new Session("x");
    s.exitReason = "parse_error";
    expect(buildSessionDigest(s).success).toBe(false);
  });

  it("parent_killed → success=false", () => {
    const s = new Session("x");
    s.exitReason = "parent_killed";
    expect(buildSessionDigest(s).success).toBe(false);
  });

  it("missing exitReason defaults to user_end in the digest field", () => {
    const s = new Session("x");
    // exitReason not set
    expect(buildSessionDigest(s).exitReason).toBe("user_end");
  });

  it("digest.messageCount matches history length", () => {
    const s = new Session("x");
    s.history.push({ role: "user", text: "1", at: 1 });
    s.history.push({ role: "assistant", text: "a", toolCalls: [], at: 2 });
    s.history.push({ role: "user", text: "2", at: 3 });
    s.exitReason = "user_end";
    expect(buildSessionDigest(s).digest.messageCount).toBe(3);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails (module does not exist yet)**

Run: `npx vitest run src/cli/tests/session.test.ts`
Expected: FAIL — `Cannot find module '../lib/session.js'`.

- [ ] **Step 3: Create `src/cli/lib/session.ts`**

```ts
export type Turn =
  | { role: "user"; text: string; at: number }
  | {
      role: "assistant";
      text: string;
      toolCalls: ToolCall[];
      usage?: Usage;
      stopReason?: "end_turn" | "turn_limit" | "abort" | "error";
      at: number;
    }
  | { role: "tool_result"; toolCallId: string; content: string; isError: boolean; at: number }
  | { role: "system"; text: string; at: number };

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export type ExitReason =
  | "user_end"
  | "abort"
  | "turn_limit"
  | "child_crash"
  | "parse_error"
  | "parent_killed";

export interface InteractiveSessionDigest {
  output: string;
  success: boolean;
  turnsUsed: number;
  sessionId: string;
  exitReason: ExitReason;
  transcriptPath: null;
  digest: {
    messageCount: number;
    usage: Usage;
    tools: Array<{ name: string; count: number }>;
  };
}

export class Session {
  readonly id: string;
  history: Turn[] = [];
  exitReason?: ExitReason;

  constructor(id: string) {
    this.id = id;
  }

  lastAssistantText(): string {
    for (let i = this.history.length - 1; i >= 0; i--) {
      const t = this.history[i];
      if (t.role === "assistant") return t.text;
    }
    return "";
  }

  turnsUsed(): number {
    return this.history.filter((t) => t.role === "user").length;
  }

  aggregateUsage(): Usage {
    // Design note: spec §3.1 sketch uses `+=` unconditionally on cache tokens,
    // which would leave `undefined + number = NaN`. This implementation guards
    // each cache-token accumulation so the return type stays clean
    // (undefined if no turn had cache usage; a real number otherwise).
    // Numerically identical to the spec's intent when all turns have usage set.
    const acc: Usage = { inputTokens: 0, outputTokens: 0 };
    for (const t of this.history) {
      if (t.role === "assistant" && t.usage) {
        acc.inputTokens += t.usage.inputTokens;
        acc.outputTokens += t.usage.outputTokens;
        if (t.usage.cacheReadTokens !== undefined) {
          acc.cacheReadTokens = (acc.cacheReadTokens ?? 0) + t.usage.cacheReadTokens;
        }
        if (t.usage.cacheWriteTokens !== undefined) {
          acc.cacheWriteTokens = (acc.cacheWriteTokens ?? 0) + t.usage.cacheWriteTokens;
        }
      }
    }
    return acc;
  }

  toolCallsSummary(): Array<{ name: string; count: number }> {
    const counts = new Map<string, number>();
    for (const t of this.history) {
      if (t.role === "assistant") {
        for (const tc of t.toolCalls) {
          counts.set(tc.name, (counts.get(tc.name) ?? 0) + 1);
        }
      }
    }
    return Array.from(counts, ([name, count]) => ({ name, count }));
  }
}

export function buildSessionDigest(session: Session): InteractiveSessionDigest {
  return {
    output: session.lastAssistantText(),
    success: session.exitReason === "user_end" || session.exitReason === "turn_limit",
    turnsUsed: session.turnsUsed(),
    sessionId: session.id,
    exitReason: session.exitReason ?? "user_end",
    transcriptPath: null,
    digest: {
      messageCount: session.history.length,
      usage: session.aggregateUsage(),
      tools: session.toolCallsSummary(),
    },
  };
}
```

- [ ] **Step 4: Run the test, verify pass**

Run: `npx vitest run src/cli/tests/session.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/cli/lib/session.ts src/cli/tests/session.test.ts
git commit -m "feat(session): add Session, Turn, and buildSessionDigest primitives"
```

### Task 3.2: Create `src/cli/lib/slash-commands.ts`

**Files:**
- Create: `src/cli/lib/slash-commands.ts`
- Test: `src/cli/tests/slash-commands.test.ts`

- [ ] **Step 1: Write the failing test file**

```ts
import { describe, it, expect } from "vitest";
import { parseSlashCommand, HELP_TEXT } from "../lib/slash-commands.js";

describe("parseSlashCommand", () => {
  it("parses /end", () => {
    expect(parseSlashCommand("/end")).toEqual({ kind: "end" });
  });

  it("parses /abort", () => {
    expect(parseSlashCommand("/abort")).toEqual({ kind: "abort" });
  });

  it("parses /help", () => {
    expect(parseSlashCommand("/help")).toEqual({ kind: "help" });
  });

  it("is case-insensitive for commands", () => {
    expect(parseSlashCommand("/END")).toEqual({ kind: "end" });
    expect(parseSlashCommand("/Help")).toEqual({ kind: "help" });
  });

  it("trims surrounding whitespace on commands", () => {
    expect(parseSlashCommand("  /end  ")).toEqual({ kind: "end" });
  });

  it("returns unknown for /foo", () => {
    expect(parseSlashCommand("/foo")).toEqual({ kind: "unknown", raw: "/foo" });
  });

  it("unknown command is lowercased before matching and preserves trimmed raw", () => {
    expect(parseSlashCommand("  /FOO  ")).toEqual({ kind: "unknown", raw: "/FOO" });
  });

  it("returns message for plain text", () => {
    expect(parseSlashCommand("hello world")).toEqual({ kind: "message", text: "hello world" });
  });

  it("treats text starting with non-slash as message even if /something appears later", () => {
    expect(parseSlashCommand("tell me about /end")).toEqual({
      kind: "message",
      text: "tell me about /end",
    });
  });

  it("preserves the original (un-trimmed) text in a message", () => {
    expect(parseSlashCommand("  hello  ")).toEqual({ kind: "message", text: "  hello  " });
  });

  it("HELP_TEXT mentions /end, /abort, /help", () => {
    expect(HELP_TEXT).toMatch(/\/end/);
    expect(HELP_TEXT).toMatch(/\/abort/);
    expect(HELP_TEXT).toMatch(/\/help/);
  });
});
```

- [ ] **Step 2: Run, verify fail (module missing)**

Run: `npx vitest run src/cli/tests/slash-commands.test.ts`
Expected: module not found.

- [ ] **Step 3: Create `src/cli/lib/slash-commands.ts`**

```ts
export type SlashCommand =
  | { kind: "end" }
  | { kind: "abort" }
  | { kind: "help" }
  | { kind: "unknown"; raw: string }
  | { kind: "message"; text: string };

export function parseSlashCommand(input: string): SlashCommand {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return { kind: "message", text: input };
  const cmd = trimmed.slice(1).toLowerCase();
  if (cmd === "end") return { kind: "end" };
  if (cmd === "abort") return { kind: "abort" };
  if (cmd === "help") return { kind: "help" };
  return { kind: "unknown", raw: trimmed };
}

export const HELP_TEXT = `
Available commands:
  /end    Finish the chat gracefully. The full conversation will be
          summarized and passed to the next pipeline node.
  /abort  Abort the chat immediately. The pipeline will fail.
  /help   Show this message.

Type a regular message (no leading slash) to send it to Claude.
`.trim();
```

- [ ] **Step 4: Run, verify pass**

Run: `npx vitest run src/cli/tests/slash-commands.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/cli/lib/slash-commands.ts src/cli/tests/slash-commands.test.ts
git commit -m "feat(slash-commands): add parseSlashCommand and HELP_TEXT"
```

### Task 3.3: Create `src/cli/lib/stream-json-input.ts`

**Files:**
- Create: `src/cli/lib/stream-json-input.ts`
- Test: `src/cli/tests/stream-json-input.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { formatUserTurn } from "../lib/stream-json-input.js";

describe("formatUserTurn", () => {
  it("produces a single NDJSON line ending with \\n", () => {
    const out = formatUserTurn("hello");
    expect(out.endsWith("\n")).toBe(true);
    expect(out.split("\n").filter(Boolean)).toHaveLength(1);
  });

  it("produces valid JSON with the expected stream-json user-turn shape", () => {
    const out = formatUserTurn("hello");
    const parsed = JSON.parse(out);
    expect(parsed).toEqual({
      type: "user",
      message: {
        role: "user",
        content: [{ type: "text", text: "hello" }],
      },
    });
  });

  it("preserves unicode text", () => {
    const out = formatUserTurn("héllo 🌟 世界");
    const parsed = JSON.parse(out);
    expect(parsed.message.content[0].text).toBe("héllo 🌟 世界");
  });

  it("handles empty string", () => {
    const out = formatUserTurn("");
    const parsed = JSON.parse(out);
    expect(parsed.message.content[0].text).toBe("");
  });

  it("escapes embedded newlines so the output is still one NDJSON line", () => {
    const out = formatUserTurn("line1\nline2");
    // exactly one trailing newline
    expect(out.indexOf("\n")).toBe(out.length - 1);
    const parsed = JSON.parse(out.slice(0, -1));
    expect(parsed.message.content[0].text).toBe("line1\nline2");
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run src/cli/tests/stream-json-input.test.ts`
Expected: module not found.

- [ ] **Step 3: Create `src/cli/lib/stream-json-input.ts`**

```ts
/**
 * Format a user text turn as a single NDJSON line suitable for
 * Claude Code CLI's --input-format stream-json stdin.
 */
export function formatUserTurn(text: string): string {
  return (
    JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: [{ type: "text", text }],
      },
    }) + "\n"
  );
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npx vitest run src/cli/tests/stream-json-input.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/cli/lib/stream-json-input.ts src/cli/tests/stream-json-input.test.ts
git commit -m "feat(stream-json-input): add formatUserTurn helper"
```

### Task 3.4: Chunk 3 verification gate

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: all green.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: no type errors.

---

## Chunk 4: P3 — `agent.runInteractive()` + Typed Raw-Event Iterator

**Goal:** Add `Agent.runInteractive(options): ChildHandle` to `src/cli/lib/agent.ts` without touching `Agent.run()`. Add a new typed raw-event iterator (in `src/cli/lib/stream-formatter.ts` or a new sibling file) that yields `StreamJsonEvent` objects matching the fields ChatUI needs (`assistant_delta`, `result`, `system`, `user`, `parse_error`). The existing high-level `streamEvents()` stays as-is and is **not** modified — `runInteractive` uses a lower-level parser because ChatUI needs the raw assistant text deltas and `result.stop_reason`/`result.usage`, which the existing formatter discards.

**Why a new parser (deviation-note from spec §3.5):** The spec text says "the existing helper that parses Claude's stream-json output into typed events is reused." In practice, the existing `streamEvents()` exports `StreamEvent` as `{ text | tool | ctx | subagent_* | main_* }` — it collapses stream-json into a UI-display abstraction. ChatUI needs the raw shapes (`assistant_delta` textDelta, `result.stop_reason`, `result.usage`), which that formatter discards. The cleanest fix is a second, smaller iterator that does line-splitting + `JSON.parse` + shape classification without any of the subagent buffering or tool-label logic. It lives alongside `streamEvents()` in the same file.

**Verification after chunk:**
- [ ] New `runInteractive()` contract tests pass against a fake child process (no real Claude spawn).
- [ ] `agent.run()` behavior is unchanged — all existing `agent.test.ts` tests still pass.

### Task 4.1: Add `parseStreamJsonEvents()` raw iterator

**Files:**
- Modify: `src/cli/lib/stream-formatter.ts` (append, do not touch existing exports)
- Test: `src/cli/tests/stream-json-events.test.ts` (new)

- [ ] **Step 1: Write the failing test file**

```ts
import { describe, it, expect } from "vitest";
import { Readable } from "stream";
import { parseStreamJsonEvents, type StreamJsonEvent } from "../lib/stream-formatter.js";

function readableFrom(lines: string[]): Readable {
  return Readable.from(lines.map((l) => l + "\n"));
}

async function collect(iter: AsyncIterable<StreamJsonEvent>): Promise<StreamJsonEvent[]> {
  const out: StreamJsonEvent[] = [];
  for await (const ev of iter) out.push(ev);
  return out;
}

describe("parseStreamJsonEvents", () => {
  it("yields system event with session id", async () => {
    const r = readableFrom([
      JSON.stringify({ type: "system", subtype: "init", session_id: "abc" }),
    ]);
    const events = await collect(parseStreamJsonEvents(r));
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("system");
    if (events[0].type === "system") {
      expect(events[0].sessionId).toBe("abc");
    }
  });

  it("yields assistant_delta for each text block in an assistant message", async () => {
    const r = readableFrom([
      JSON.stringify({
        type: "assistant",
        message: {
          id: "msg1",
          content: [
            { type: "text", text: "Hello " },
            { type: "text", text: "world" },
          ],
        },
      }),
    ]);
    const events = await collect(parseStreamJsonEvents(r));
    const deltas = events.filter((e) => e.type === "assistant_delta");
    expect(deltas).toHaveLength(2);
    if (deltas[0].type === "assistant_delta") expect(deltas[0].textDelta).toBe("Hello ");
    if (deltas[1].type === "assistant_delta") expect(deltas[1].textDelta).toBe("world");
  });

  it("yields tool_use for tool_use blocks in assistant messages", async () => {
    const r = readableFrom([
      JSON.stringify({
        type: "assistant",
        message: {
          id: "msg1",
          content: [
            { type: "tool_use", id: "tu1", name: "Read", input: { file_path: "/x" } },
          ],
        },
      }),
    ]);
    const events = await collect(parseStreamJsonEvents(r));
    const tuses = events.filter((e) => e.type === "tool_use");
    expect(tuses).toHaveLength(1);
    if (tuses[0].type === "tool_use") {
      expect(tuses[0].toolCall.name).toBe("Read");
      expect(tuses[0].toolCall.id).toBe("tu1");
    }
  });

  it("yields a result event with stopReason, usage, and final text", async () => {
    const r = readableFrom([
      JSON.stringify({
        type: "result",
        subtype: "success",
        result: "final answer",
        stop_reason: "end_turn",
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_read_input_tokens: 20,
        },
      }),
    ]);
    const events = await collect(parseStreamJsonEvents(r));
    const result = events.find((e) => e.type === "result");
    expect(result).toBeDefined();
    if (result && result.type === "result") {
      expect(result.stopReason).toBe("end_turn");
      expect(result.text).toBe("final answer");
      expect(result.usage.inputTokens).toBe(100);
      expect(result.usage.outputTokens).toBe(50);
      expect(result.usage.cacheReadTokens).toBe(20);
    }
  });

  it("maps turn_limit stop_reason verbatim", async () => {
    const r = readableFrom([
      JSON.stringify({
        type: "result",
        stop_reason: "turn_limit",
        result: "",
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    ]);
    const events = await collect(parseStreamJsonEvents(r));
    const result = events.find((e) => e.type === "result");
    if (result && result.type === "result") {
      expect(result.stopReason).toBe("turn_limit");
    }
  });

  it("yields parse_error for malformed lines without crashing the iterator", async () => {
    const r = readableFrom([
      "not json at all",
      JSON.stringify({ type: "system", subtype: "init", session_id: "x" }),
    ]);
    const events = await collect(parseStreamJsonEvents(r));
    const errors = events.filter((e) => e.type === "parse_error");
    expect(errors).toHaveLength(1);
    if (errors[0].type === "parse_error") {
      expect(errors[0].rawLine).toBe("not json at all");
    }
    // Iteration continues after the bad line
    expect(events.some((e) => e.type === "system")).toBe(true);
  });

  it("yields tool_result events from user-role messages (tool output)", async () => {
    const r = readableFrom([
      JSON.stringify({
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "tu1",
              content: "file contents here",
              is_error: false,
            },
          ],
        },
      }),
    ]);
    const events = await collect(parseStreamJsonEvents(r));
    const trs = events.filter((e) => e.type === "tool_result");
    expect(trs).toHaveLength(1);
    if (trs[0].type === "tool_result") {
      expect(trs[0].toolCallId).toBe("tu1");
      expect(trs[0].content).toBe("file contents here");
      expect(trs[0].isError).toBe(false);
    }
  });

  it("ignores empty lines", async () => {
    const r = readableFrom([
      "",
      JSON.stringify({ type: "system", subtype: "init", session_id: "x" }),
      "",
    ]);
    const events = await collect(parseStreamJsonEvents(r));
    expect(events.filter((e) => e.type !== "system")).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run src/cli/tests/stream-json-events.test.ts`
Expected: `parseStreamJsonEvents` is not exported.

- [ ] **Step 3: Append `parseStreamJsonEvents` and `StreamJsonEvent` union to `src/cli/lib/stream-formatter.ts`**

Add at the bottom of the existing file (keep the existing `streamEvents` and `StreamEvent` untouched — they remain for the legacy display path used by `implement`):

```ts
// =============================================================================
// Raw stream-json event iterator for interactive chat (Path 1.5)
// =============================================================================
//
// This is a lower-level parser than streamEvents() above. It yields a typed
// union that preserves the raw shape of Claude CLI's stream-json output so
// ChatUI can display text deltas and inspect stop_reason/usage directly.
//
// streamEvents() intentionally collapses stream-json into a display-oriented
// StreamEvent (text/tool/subagent_*); that shape is wrong for interactive UI
// where we need per-block deltas and per-turn result metadata. The two
// iterators coexist: streamEvents() drives non-interactive display; this one
// drives ChatUI.

import type { ToolCall, Usage } from "./session.js";

export type StreamJsonEvent =
  | { type: "system"; sessionId?: string; raw: unknown }
  | { type: "assistant_delta"; textDelta: string; messageId?: string }
  | { type: "tool_use"; toolCall: ToolCall; messageId?: string }
  | { type: "tool_result"; toolCallId: string; content: string; isError: boolean }
  | {
      type: "result";
      stopReason: "end_turn" | "turn_limit" | "abort" | "error" | string;
      text: string;
      usage: Usage;
      raw: unknown;
    }
  | { type: "parse_error"; rawLine: string; error: string };

function coerceUsage(u: unknown): Usage {
  const obj = (u ?? {}) as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === "number" ? v : 0);
  return {
    inputTokens: n(obj.input_tokens),
    outputTokens: n(obj.output_tokens),
    cacheReadTokens: typeof obj.cache_read_input_tokens === "number" ? obj.cache_read_input_tokens : undefined,
    cacheWriteTokens: typeof obj.cache_creation_input_tokens === "number" ? obj.cache_creation_input_tokens : undefined,
  };
}

export async function* parseStreamJsonEvents(
  readable: NodeJS.ReadableStream,
): AsyncGenerator<StreamJsonEvent> {
  const rl = readline.createInterface({ input: readable, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;

    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line) as Record<string, unknown>;
    } catch (err) {
      yield { type: "parse_error", rawLine: line, error: (err as Error).message };
      continue;
    }

    const t = event.type;
    if (t === "system") {
      yield {
        type: "system",
        sessionId: typeof event.session_id === "string" ? event.session_id : undefined,
        raw: event,
      };
    } else if (t === "assistant") {
      const msg = (event.message ?? {}) as Record<string, unknown>;
      const messageId = typeof msg.id === "string" ? msg.id : undefined;
      const content = Array.isArray(msg.content) ? (msg.content as unknown[]) : [];
      for (const block of content) {
        const b = block as Record<string, unknown>;
        if (b.type === "text" && typeof b.text === "string") {
          yield { type: "assistant_delta", textDelta: b.text, messageId };
        } else if (b.type === "tool_use") {
          yield {
            type: "tool_use",
            toolCall: {
              id: String(b.id ?? ""),
              name: String(b.name ?? ""),
              input: b.input,
            },
            messageId,
          };
        }
      }
    } else if (t === "user") {
      // Tool results are fed back via user-role messages
      const msg = (event.message ?? {}) as Record<string, unknown>;
      const content = Array.isArray(msg.content) ? (msg.content as unknown[]) : [];
      for (const block of content) {
        const b = block as Record<string, unknown>;
        if (b.type === "tool_result") {
          yield {
            type: "tool_result",
            toolCallId: String(b.tool_use_id ?? ""),
            content: typeof b.content === "string" ? b.content : JSON.stringify(b.content ?? ""),
            isError: b.is_error === true,
          };
        }
      }
    } else if (t === "result") {
      yield {
        type: "result",
        stopReason: typeof event.stop_reason === "string" ? (event.stop_reason as any) : "end_turn",
        text: typeof event.result === "string" ? event.result : "",
        usage: coerceUsage(event.usage),
        raw: event,
      };
    }
    // unknown event types are silently ignored — forward-compat with CLI updates
  }
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npx vitest run src/cli/tests/stream-json-events.test.ts`
Expected: all tests pass. If `readline` is not imported at the top of the file, confirm — the existing file already imports it at line 1.

- [ ] **Step 5: Verify existing `streamEvents()` is untouched by running its tests**

Run: `npx vitest run src/cli/tests/stream-formatter.test.ts`
Expected: all existing tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/cli/lib/stream-formatter.ts src/cli/tests/stream-json-events.test.ts
git commit -m "feat(stream-formatter): add parseStreamJsonEvents raw iterator for interactive chat"
```

### Task 4.2: Add `runInteractive()` to `Agent` with `ChildHandle` contract

**Files:**
- Modify: `src/cli/lib/agent.ts` (add method + interface; do not change `run()`)
- Test: `src/cli/tests/agent-interactive.test.ts` (new)

- [ ] **Step 1: Write the failing contract test**

The key design constraint: the test must NOT spawn a real `claude` binary. It mocks `spawn` to return a fake `ChildProcess` built from `EventEmitter` + a writable stdin + a `Readable.from` stdout.

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";
import { Readable, Writable } from "stream";

// Hoisted mock — same pattern as existing agent.test.ts
const { mockSpawn } = vi.hoisted(() => {
  return { mockSpawn: vi.fn() };
});
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: (...args: any[]) => {
      const override = mockSpawn();
      if (override) return override;
      return actual.spawn(...(args as Parameters<typeof actual.spawn>));
    },
  };
});

import { Agent, type AgentConfig } from "../lib/agent.js";
import { Session } from "../lib/session.js";

function makeFakeChild(stdoutLines: string[] = []) {
  const child = new EventEmitter() as any;
  child.pid = 12345;

  const stdinWrites: string[] = [];
  child.stdin = new Writable({
    write(chunk, _enc, cb) {
      stdinWrites.push(chunk.toString());
      cb();
    },
  });
  (child.stdin as any).__writes = stdinWrites;

  // Controllable stdout: start paused, let the test push lines
  const pushable: string[] = [...stdoutLines];
  child.stdout = new Readable({
    read() {
      const next = pushable.shift();
      if (next !== undefined) this.push(next + "\n");
      else this.push(null); // EOF only when we explicitly drain
    },
  });
  child.stdout.push = child.stdout.push.bind(child.stdout);

  child.kill = vi.fn();
  return child;
}

const baseConfig: AgentConfig = {
  name: "chatter",
  description: "",
  model: "opus",
  permissionMode: "dangerouslySkipPermissions",
  tools: [],
  mcp: [],
  prompt: "ignored for runInteractive",
};

describe("Agent.runInteractive — buildArgs", () => {
  it("includes -p, stream-json input/output, --verbose, --append-system-prompt, --session-id", () => {
    const agent = new Agent(baseConfig);
    const args = agent.buildInteractiveArgs({
      systemPrompt: "you are helpful",
      sessionId: "11111111-2222-3333-4444-555555555555",
    });
    expect(args).toContain("-p");
    expect(args).toContain("--input-format");
    expect(args[args.indexOf("--input-format") + 1]).toBe("stream-json");
    expect(args).toContain("--output-format");
    expect(args[args.indexOf("--output-format") + 1]).toBe("stream-json");
    expect(args).toContain("--verbose");
    expect(args).toContain("--append-system-prompt");
    expect(args[args.indexOf("--append-system-prompt") + 1]).toBe("you are helpful");
    expect(args).toContain("--session-id");
    expect(args[args.indexOf("--session-id") + 1]).toBe("11111111-2222-3333-4444-555555555555");
  });
});

describe("Agent.runInteractive — ChildHandle behavior", () => {
  beforeEach(() => {
    mockSpawn.mockReset();
  });

  it("submit(text) writes one NDJSON line to stdin", async () => {
    const child = makeFakeChild([]);
    mockSpawn.mockReturnValue(child);

    const agent = new Agent(baseConfig);
    const session = new Session("test-uuid");
    const handle = agent.runInteractive({
      session,
      systemPrompt: "test",
      cwd: "/tmp",
    });

    await handle.submit("hello");
    const writes = (child.stdin as any).__writes as string[];
    expect(writes.length).toBe(1);
    const parsed = JSON.parse(writes[0].trim());
    expect(parsed).toEqual({
      type: "user",
      message: { role: "user", content: [{ type: "text", text: "hello" }] },
    });
  });

  it("events iterator yields parsed events from stdout lines", async () => {
    const initLine = JSON.stringify({ type: "system", subtype: "init", session_id: "s1" });
    const assistantLine = JSON.stringify({
      type: "assistant",
      message: { id: "m1", content: [{ type: "text", text: "hi" }] },
    });
    const resultLine = JSON.stringify({
      type: "result",
      stop_reason: "end_turn",
      result: "hi",
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const child = makeFakeChild([initLine, assistantLine, resultLine]);
    mockSpawn.mockReturnValue(child);

    const agent = new Agent(baseConfig);
    const session = new Session("s1");
    const handle = agent.runInteractive({ session, systemPrompt: "p", cwd: "/tmp" });

    const collected: any[] = [];
    const consumer = (async () => {
      for await (const ev of handle.events) {
        collected.push(ev);
        if (ev.type === "result") break;
      }
    })();

    await consumer;
    // Then close the child so the handle resolves cleanly
    child.emit("close", 0);

    expect(collected.some((e) => e.type === "system")).toBe(true);
    expect(collected.some((e) => e.type === "assistant_delta")).toBe(true);
    expect(collected.some((e) => e.type === "result")).toBe(true);
  });

  it("end() calls stdin.end and resolves when child exits", async () => {
    const child = makeFakeChild([]);
    const endSpy = vi.spyOn(child.stdin, "end");
    mockSpawn.mockReturnValue(child);

    const agent = new Agent(baseConfig);
    const handle = agent.runInteractive({
      session: new Session("s1"),
      systemPrompt: "p",
      cwd: "/tmp",
    });

    const endPromise = handle.end();
    child.emit("close", 0);
    await endPromise;
    expect(endSpy).toHaveBeenCalled();
  });

  it("kill() sends SIGTERM, then SIGKILL after 3s if child still alive", async () => {
    vi.useFakeTimers();
    try {
      const child = makeFakeChild([]);
      mockSpawn.mockReturnValue(child);

      const agent = new Agent(baseConfig);
      const handle = agent.runInteractive({
        session: new Session("s1"),
        systemPrompt: "p",
        cwd: "/tmp",
      });

      const killPromise = handle.kill("SIGTERM");
      expect(child.kill).toHaveBeenCalledWith("SIGTERM");

      // Advance past the 3-second escalation timer
      vi.advanceTimersByTime(3100);
      // Simulate the child eventually dying from SIGKILL
      child.emit("close", null);
      await killPromise;

      // SIGKILL should have been sent after the timer
      expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    } finally {
      vi.useRealTimers();
    }
  });

  it("submit after end rejects", async () => {
    const child = makeFakeChild([]);
    mockSpawn.mockReturnValue(child);

    const agent = new Agent(baseConfig);
    const handle = agent.runInteractive({
      session: new Session("s1"),
      systemPrompt: "p",
      cwd: "/tmp",
    });

    const endP = handle.end();
    child.emit("close", 0);
    await endP;

    await expect(handle.submit("late")).rejects.toThrow(/closed|ended|not writable/i);
  });

  it("sessionId is exposed on the handle", () => {
    const child = makeFakeChild([]);
    mockSpawn.mockReturnValue(child);
    const agent = new Agent(baseConfig);
    const handle = agent.runInteractive({
      session: new Session("session-uuid-xyz"),
      systemPrompt: "p",
      cwd: "/tmp",
    });
    expect(handle.sessionId).toBe("session-uuid-xyz");
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run src/cli/tests/agent-interactive.test.ts`
Expected: `buildInteractiveArgs` and `runInteractive` don't exist.

- [ ] **Step 3: Implement `RunInteractiveOptions`, `ChildHandle`, `buildInteractiveArgs`, and `runInteractive`**

Edit `src/cli/lib/agent.ts`:

Add to the imports block at top:

```ts
import { Session } from "./session.js";
import { parseStreamJsonEvents, type StreamJsonEvent } from "./stream-formatter.js";
import { formatUserTurn } from "./stream-json-input.js";
```

Add new interfaces after the existing `RunResult` interface (around line 49):

```ts
export interface RunInteractiveOptions {
  session: Session;
  systemPrompt: string;           // combined preamble + node prompt
  cwd: string;
  allowedTools?: string[];
  dangerouslySkipPermissions?: boolean;
  abortSignal?: AbortSignal;
}

export interface ChildHandle {
  events: AsyncIterable<StreamJsonEvent>;
  submit(userText: string): Promise<void>;
  end(): Promise<void>;
  kill(signal?: NodeJS.Signals): Promise<void>;
  sessionId: string;
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}
```

Add two new methods to the `Agent` class:

```ts
  buildInteractiveArgs(opts: { systemPrompt: string; sessionId: string }): string[] {
    const args: string[] = ["-p"];
    args.push("--input-format", "stream-json");
    args.push("--output-format", "stream-json");
    args.push("--verbose");
    args.push("--append-system-prompt", opts.systemPrompt);
    args.push("--session-id", opts.sessionId);
    args.push("--model", this.config.model);
    if (this.config.permissionMode === "dangerouslySkipPermissions") {
      args.push("--dangerously-skip-permissions");
    } else {
      args.push("--permission-mode", this.config.permissionMode);
    }
    for (const tool of this.config.tools) {
      args.push("--allowedTools", tool);
    }
    if (this._mcpConfigPath) {
      args.push("--mcp-config", this._mcpConfigPath);
    }
    return args;
  }

  runInteractive(options: RunInteractiveOptions): ChildHandle {
    const args = this.buildInteractiveArgs({
      systemPrompt: options.systemPrompt,
      sessionId: options.session.id,
    });

    const child = spawn("claude", args, {
      cwd: options.cwd,
      detached: true,
      stdio: ["pipe", "pipe", "inherit"],
    });
    this._child = child;

    let closed = false;
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      child.on("close", (code, signal) => {
        closed = true;
        resolve({ code, signal });
      });
    });

    // Wire abort signal → kill
    if (options.abortSignal) {
      if (options.abortSignal.aborted) {
        child.kill("SIGTERM");
      } else {
        options.abortSignal.addEventListener(
          "abort",
          () => { try { child.kill("SIGTERM"); } catch {} },
          { once: true },
        );
      }
    }

    const events: AsyncIterable<StreamJsonEvent> = child.stdout
      ? parseStreamJsonEvents(child.stdout)
      : (async function* () {})();

    const submit = async (userText: string): Promise<void> => {
      if (closed || !child.stdin || !child.stdin.writable) {
        throw new Error("runInteractive: child stdin is closed, cannot submit");
      }
      return new Promise<void>((resolve, reject) => {
        child.stdin!.write(formatUserTurn(userText), (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    };

    const end = async (): Promise<void> => {
      try {
        if (child.stdin && !child.stdin.destroyed) {
          child.stdin.end();
        }
      } catch {
        // idempotent
      }
      await exited;
    };

    const kill = async (signal: NodeJS.Signals = "SIGTERM"): Promise<void> => {
      try { child.kill(signal); } catch {}
      const timeout = setTimeout(() => {
        try { child.kill("SIGKILL"); } catch {}
      }, 3000);
      try {
        await exited;
      } finally {
        clearTimeout(timeout);
      }
    };

    return {
      events,
      submit,
      end,
      kill,
      sessionId: options.session.id,
      exited,
    };
  }
```

- [ ] **Step 4: Run the contract tests, verify pass**

Run: `npx vitest run src/cli/tests/agent-interactive.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Run the existing `agent.test.ts` to verify `run()` is untouched**

Run: `npx vitest run src/cli/tests/agent.test.ts`
Expected: all existing tests pass with zero changes.

- [ ] **Step 6: Build**

Run: `npm run build`
Expected: no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/cli/lib/agent.ts src/cli/tests/agent-interactive.test.ts
git commit -m "feat(agent): add runInteractive() with ChildHandle for bidirectional stream-json"
```

### Task 4.3: Chunk 4 verification gate

- [ ] **Step 1: Full suite**

Run: `npm test && npm run build`
Expected: all green, no type errors.

---

## Chunk 5: P4 + P5 — TextInput + ChatUI Ink Components

**Goal:** Create two Ink components under `src/cli/components/`:

1. `TextInput.tsx` — ~85-line custom text input with cursor rendering, `useInput` hook, disable/focus support.
2. `ChatUI.tsx` — ~300-line chat renderer: consumes a `ChildHandle.events` iterator, owns a state machine (`streaming | awaiting | ended`), dispatches slash commands, handles SIGINT, resolves an `onExit(reason)` callback when the session ends.

All behavior is unit-testable via `ink-testing-library`.

**Verification after chunk:**
- [ ] TextInput tests pass.
- [ ] ChatUI tests pass against a fake `ChildHandle`.
- [ ] `npm run build` succeeds.

### Task 5.1: Create `src/cli/components/TextInput.tsx`

**Files:**
- Create: `src/cli/components/TextInput.tsx`
- Test: `src/cli/tests/TextInput.test.tsx`

- [ ] **Step 1: Verify `src/cli/components/` exists (create if missing)**

Run: `ls src/cli/components/ 2>/dev/null || mkdir -p src/cli/components`

- [ ] **Step 2: Write the failing test**

Create `src/cli/tests/TextInput.test.tsx`:

```tsx
import React, { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import { TextInput } from "../components/TextInput.js";

function Harness({
  initial = "",
  disabled = false,
  placeholder = "",
  onSubmit = () => {},
}: {
  initial?: string;
  disabled?: boolean;
  placeholder?: string;
  onSubmit?: (v: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <TextInput
      value={value}
      onChange={setValue}
      onSubmit={onSubmit}
      disabled={disabled}
      placeholder={placeholder}
    />
  );
}

describe("TextInput", () => {
  it("shows placeholder when value is empty", () => {
    const { lastFrame } = render(<Harness placeholder="type here" />);
    expect(lastFrame()).toContain("type here");
  });

  it("appends printable characters and moves cursor", () => {
    const { stdin, lastFrame } = render(<Harness />);
    stdin.write("h");
    stdin.write("i");
    expect(lastFrame()).toContain("hi");
  });

  it("backspace deletes the previous character", () => {
    const { stdin, lastFrame } = render(<Harness initial="hello" />);
    stdin.write("\u0008"); // backspace
    expect(lastFrame()).toContain("hell");
  });

  it("Enter calls onSubmit with current value", () => {
    const onSubmit = vi.fn();
    const { stdin } = render(<Harness initial="submit me" onSubmit={onSubmit} />);
    stdin.write("\r"); // enter
    expect(onSubmit).toHaveBeenCalledWith("submit me");
  });

  it("disabled ignores keystrokes", () => {
    const onSubmit = vi.fn();
    const { stdin, lastFrame } = render(<Harness disabled onSubmit={onSubmit} />);
    stdin.write("x");
    stdin.write("\r");
    expect(onSubmit).not.toHaveBeenCalled();
    // Placeholder/value unchanged
  });

  it("left/right arrows move the cursor within bounds", () => {
    const { stdin, lastFrame } = render(<Harness initial="abc" />);
    // Cursor starts at end; left 1 → between b and c
    stdin.write("\u001b[D"); // left arrow
    stdin.write("X");
    expect(lastFrame()).toContain("abXc");
  });
});
```

- [ ] **Step 3: Run, verify fail (component missing)**

Run: `npx vitest run src/cli/tests/TextInput.test.tsx`
Expected: import fails.

- [ ] **Step 4: Create `src/cli/components/TextInput.tsx`**

```tsx
import React, { useState } from "react";
import { Box, Text, useInput } from "ink";

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
  focus?: boolean;
}

export function TextInput({
  value,
  onChange,
  onSubmit,
  disabled = false,
  placeholder = "",
  focus = true,
}: Props) {
  const [cursor, setCursor] = useState(value.length);

  useInput(
    (input, key) => {
      if (disabled) return;

      if (key.return) {
        onSubmit(value);
        setCursor(0);
        return;
      }
      if (key.backspace || key.delete) {
        if (cursor > 0) {
          const next = value.slice(0, cursor - 1) + value.slice(cursor);
          onChange(next);
          setCursor(cursor - 1);
        }
        return;
      }
      if (key.leftArrow) {
        setCursor(Math.max(0, cursor - 1));
        return;
      }
      if (key.rightArrow) {
        setCursor(Math.min(value.length, cursor + 1));
        return;
      }
      if (key.ctrl && input === "a") { setCursor(0); return; }
      if (key.ctrl && input === "e") { setCursor(value.length); return; }

      if (input && !key.ctrl && !key.meta) {
        const next = value.slice(0, cursor) + input + value.slice(cursor);
        onChange(next);
        setCursor(cursor + input.length);
      }
    },
    { isActive: focus && !disabled },
  );

  if (value.length === 0 && placeholder) {
    return (
      <Box>
        <Text dimColor>{placeholder}</Text>
      </Box>
    );
  }

  const before = value.slice(0, cursor);
  const at = value.slice(cursor, cursor + 1) || " ";
  const after = value.slice(cursor + 1);

  return (
    <Box>
      <Text>{before}</Text>
      <Text inverse>{at}</Text>
      <Text>{after}</Text>
    </Box>
  );
}
```

- [ ] **Step 5: Run, verify pass**

Run: `npx vitest run src/cli/tests/TextInput.test.tsx`
Expected: all tests pass. If ink-testing-library's `stdin.write` does not translate `\u0008` to backspace, use the raw Ink key sequence — check the existing Ink component tests in the repo (`src/cli/tests/` likely has prior art) for the exact sequence used.

- [ ] **Step 6: Commit**

```bash
git add src/cli/components/TextInput.tsx src/cli/tests/TextInput.test.tsx
git commit -m "feat(components): add TextInput Ink component"
```

### Task 5.2: Create `src/cli/components/ChatUI.tsx`

**Files:**
- Create: `src/cli/components/ChatUI.tsx`
- Create: `src/cli/tests/helpers/fake-child-handle.ts`
- Test: `src/cli/tests/ChatUI.test.tsx`

**Prerequisites from earlier chunks** (if any symbol below is missing, stop and re-run the earlier chunk first):
- From Chunk 3 `src/cli/lib/session.ts`: `Session`, `Turn` (with `role: "user" | "assistant" | "tool_result" | "system"`), `Usage`, `ToolCall`, `ExitReason` (including `"child_crash"`, `"turn_limit"`).
- From Chunk 3 `src/cli/lib/slash-commands.ts`: `parseSlashCommand`, `HELP_TEXT` (must contain the literal strings `/end`, `/abort`, `/help`).
- From Chunk 4 `src/cli/lib/agent.ts`: `ChildHandle` interface with `events: AsyncIterable<StreamJsonEvent>`, `submit`, `end`, `kill`, `sessionId`, `exited`.
- From Chunk 4 `src/cli/lib/stream-formatter.ts`: `StreamJsonEvent` union including `assistant_delta`, `tool_use`, `tool_result`, `result`, `parse_error`, `system`.

**Design note:** ChatUI is the largest new file (~260 lines). It has a single responsibility — render the chat and drive the session state machine. Splitting it further (e.g., TurnView into its own file) would not help: the sub-components are tiny and only used here.

**Static component note:** Ink's `<Static>` is append-only — it renders newly appended items exactly once and never re-renders existing items. This is intentional for chat history: each turn is immutable once committed. Do NOT mutate existing turns in `session.history`; always `push` new turns and pass a shallow-copied array to `setHistory` so React detects the change.

- [ ] **Step 1: Define the fake `ChildHandle` helper that the tests will use**

Create `src/cli/tests/helpers/fake-child-handle.ts`:

```ts
import type { ChildHandle } from "../../lib/agent.js";
import type { StreamJsonEvent } from "../../lib/stream-formatter.js";

export interface FakeChildHandleController {
  handle: ChildHandle;
  emit(event: StreamJsonEvent): void;
  endStream(): void;
  submitted: string[];
  endCalled: boolean;
  killSignal: NodeJS.Signals | null;
  exitWith(code: number | null): void;
}

export function createFakeChildHandle(sessionId = "fake-uuid"): FakeChildHandleController {
  const submitted: string[] = [];
  let endCalled = false;
  let killSignal: NodeJS.Signals | null = null;
  let resolveExit: (r: { code: number | null; signal: NodeJS.Signals | null }) => void;
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((res) => {
    resolveExit = res;
  });

  // Pending deliveries + pending awaiters for the async iterator
  const pending: StreamJsonEvent[] = [];
  const awaiters: Array<(v: IteratorResult<StreamJsonEvent>) => void> = [];
  let streamEnded = false;

  const events: AsyncIterable<StreamJsonEvent> = {
    [Symbol.asyncIterator]() {
      return {
        next(): Promise<IteratorResult<StreamJsonEvent>> {
          if (pending.length > 0) {
            return Promise.resolve({ value: pending.shift()!, done: false });
          }
          if (streamEnded) {
            return Promise.resolve({ value: undefined as any, done: true });
          }
          return new Promise((resolve) => {
            awaiters.push(resolve);
          });
        },
      };
    },
  };

  const controller: FakeChildHandleController = {
    handle: {
      events,
      submit: async (text: string) => {
        submitted.push(text);
      },
      end: async () => {
        endCalled = true;
        resolveExit!({ code: 0, signal: null });
      },
      kill: async (sig: NodeJS.Signals = "SIGTERM") => {
        killSignal = sig;
        resolveExit!({ code: null, signal: sig });
      },
      sessionId,
      exited,
    },
    emit(event) {
      if (awaiters.length > 0) {
        awaiters.shift()!({ value: event, done: false });
      } else {
        pending.push(event);
      }
    },
    endStream() {
      streamEnded = true;
      while (awaiters.length > 0) {
        awaiters.shift()!({ value: undefined as any, done: true });
      }
    },
    get submitted() { return submitted; },
    get endCalled() { return endCalled; },
    get killSignal() { return killSignal; },
    exitWith(code) {
      resolveExit!({ code, signal: null });
    },
  };

  return controller;
}
```

- [ ] **Step 2: Write ChatUI tests**

Create `src/cli/tests/ChatUI.test.tsx`:

```tsx
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render } from "ink-testing-library";
import { ChatUI } from "../components/ChatUI.js";
import { Session } from "../lib/session.js";
import { createFakeChildHandle } from "./helpers/fake-child-handle.js";

function waitForFrames(ms = 50) {
  return new Promise((r) => setTimeout(r, ms));
}

describe("ChatUI", () => {
  // Belt-and-suspenders: ChatUI registers a SIGINT handler via process.once
  // in useEffect and cleans up on unmount. In case a test forgets to unmount,
  // strip any leftover listeners between tests so handlers don't leak.
  afterEach(() => {
    process.removeAllListeners("SIGINT");
  });

  it("starts in streaming status and shows placeholder for empty history", async () => {
    const session = new Session("s1");
    const ctrl = createFakeChildHandle("s1");
    const onExit = vi.fn();

    const { lastFrame, unmount } = render(
      <ChatUI session={session} child={ctrl.handle} onExit={onExit} />,
    );
    await waitForFrames();
    // Placeholder present in the TextInput area
    expect(lastFrame()).toMatch(/Type a message|\/end|\/help/);
    unmount();
  });

  it("transitions to awaiting after first result event", async () => {
    const session = new Session("s1");
    const ctrl = createFakeChildHandle("s1");
    const onExit = vi.fn();

    const { lastFrame, unmount } = render(
      <ChatUI session={session} child={ctrl.handle} onExit={onExit} />,
    );

    ctrl.emit({ type: "assistant_delta", textDelta: "Hi there" });
    ctrl.emit({
      type: "result",
      stopReason: "end_turn",
      text: "Hi there",
      usage: { inputTokens: 10, outputTokens: 5 },
      raw: {},
    });
    await waitForFrames();
    // Session.history now has the assistant turn
    expect(session.history.some((t) => t.role === "assistant")).toBe(true);
    unmount();
  });

  it("dispatches /help locally and does not call submit", async () => {
    const session = new Session("s1");
    const ctrl = createFakeChildHandle("s1");
    const onExit = vi.fn();

    const { stdin, unmount } = render(
      <ChatUI session={session} child={ctrl.handle} onExit={onExit} />,
    );
    // Move to awaiting
    ctrl.emit({
      type: "result", stopReason: "end_turn", text: "", usage: { inputTokens: 0, outputTokens: 0 }, raw: {},
    });
    await waitForFrames();

    "/help".split("").forEach((ch) => stdin.write(ch));
    stdin.write("\r");
    await waitForFrames();

    expect(ctrl.submitted).toHaveLength(0);
    expect(session.history.some((t) => t.role === "system" && t.text.includes("/end"))).toBe(true);
    unmount();
  });

  it("dispatches /end by calling child.end and onExit('user_end')", async () => {
    const session = new Session("s1");
    const ctrl = createFakeChildHandle("s1");
    const onExit = vi.fn();

    const { stdin, unmount } = render(
      <ChatUI session={session} child={ctrl.handle} onExit={onExit} />,
    );
    ctrl.emit({
      type: "result", stopReason: "end_turn", text: "", usage: { inputTokens: 0, outputTokens: 0 }, raw: {},
    });
    await waitForFrames();

    "/end".split("").forEach((ch) => stdin.write(ch));
    stdin.write("\r");
    await waitForFrames();

    expect(ctrl.endCalled).toBe(true);
    expect(onExit).toHaveBeenCalledWith("user_end");
    expect(session.exitReason).toBe("user_end");
    unmount();
  });

  it("dispatches /abort by calling child.kill and onExit('abort')", async () => {
    const session = new Session("s1");
    const ctrl = createFakeChildHandle("s1");
    const onExit = vi.fn();

    const { stdin, unmount } = render(
      <ChatUI session={session} child={ctrl.handle} onExit={onExit} />,
    );
    ctrl.emit({
      type: "result", stopReason: "end_turn", text: "", usage: { inputTokens: 0, outputTokens: 0 }, raw: {},
    });
    await waitForFrames();

    "/abort".split("").forEach((ch) => stdin.write(ch));
    stdin.write("\r");
    await waitForFrames();

    expect(ctrl.killSignal).toBe("SIGTERM");
    expect(onExit).toHaveBeenCalledWith("abort");
    expect(session.exitReason).toBe("abort");
    unmount();
  });

  it("unknown slash command adds a system notice without calling submit", async () => {
    const session = new Session("s1");
    const ctrl = createFakeChildHandle("s1");
    const { stdin, unmount } = render(
      <ChatUI session={session} child={ctrl.handle} onExit={() => {}} />,
    );
    ctrl.emit({
      type: "result", stopReason: "end_turn", text: "", usage: { inputTokens: 0, outputTokens: 0 }, raw: {},
    });
    await waitForFrames();

    "/foo".split("").forEach((ch) => stdin.write(ch));
    stdin.write("\r");
    await waitForFrames();

    expect(ctrl.submitted).toHaveLength(0);
    expect(session.history.some((t) => t.role === "system" && t.text.includes("Unknown command"))).toBe(true);
    unmount();
  });

  it("regular message pushes user turn, calls submit, transitions back to streaming", async () => {
    const session = new Session("s1");
    const ctrl = createFakeChildHandle("s1");
    const { stdin, unmount } = render(
      <ChatUI session={session} child={ctrl.handle} onExit={() => {}} />,
    );
    ctrl.emit({
      type: "result", stopReason: "end_turn", text: "hi", usage: { inputTokens: 0, outputTokens: 0 }, raw: {},
    });
    await waitForFrames();

    "hello".split("").forEach((ch) => stdin.write(ch));
    stdin.write("\r");
    await waitForFrames();

    expect(ctrl.submitted).toEqual(["hello"]);
    expect(session.history.filter((t) => t.role === "user")).toHaveLength(1);
    unmount();
  });

  it("empty submit (whitespace) is a no-op", async () => {
    const session = new Session("s1");
    const ctrl = createFakeChildHandle("s1");
    const { stdin, unmount } = render(
      <ChatUI session={session} child={ctrl.handle} onExit={() => {}} />,
    );
    ctrl.emit({
      type: "result", stopReason: "end_turn", text: "", usage: { inputTokens: 0, outputTokens: 0 }, raw: {},
    });
    await waitForFrames();

    "   ".split("").forEach((ch) => stdin.write(ch));
    stdin.write("\r");
    await waitForFrames();

    expect(ctrl.submitted).toHaveLength(0);
    expect(session.history.filter((t) => t.role === "user")).toHaveLength(0);
    unmount();
  });

  it("turn_limit result transitions to ended with exitReason=turn_limit", async () => {
    const session = new Session("s1");
    const ctrl = createFakeChildHandle("s1");
    const onExit = vi.fn();
    const { unmount } = render(
      <ChatUI session={session} child={ctrl.handle} onExit={onExit} />,
    );
    ctrl.emit({
      type: "result",
      stopReason: "turn_limit",
      text: "capped",
      usage: { inputTokens: 0, outputTokens: 0 },
      raw: {},
    });
    await waitForFrames();
    expect(session.exitReason).toBe("turn_limit");
    expect(onExit).toHaveBeenCalledWith("turn_limit");
    unmount();
  });

  it("parse_error adds system notice but keeps session alive", async () => {
    const session = new Session("s1");
    const ctrl = createFakeChildHandle("s1");
    const { unmount } = render(
      <ChatUI session={session} child={ctrl.handle} onExit={() => {}} />,
    );
    ctrl.emit({ type: "parse_error", rawLine: "not json", error: "Unexpected token" });
    await waitForFrames();
    expect(session.history.some((t) => t.role === "system" && t.text.includes("parse"))).toBe(true);
    expect(session.exitReason).toBeUndefined();
    unmount();
  });

  it("child_crash (non-zero exit) sets exitReason and calls onExit('child_crash')", async () => {
    const session = new Session("s1");
    const ctrl = createFakeChildHandle("s1");
    const onExit = vi.fn();
    const { unmount } = render(
      <ChatUI session={session} child={ctrl.handle} onExit={onExit} />,
    );
    ctrl.exitWith(1);
    await waitForFrames();
    expect(session.exitReason).toBe("child_crash");
    expect(onExit).toHaveBeenCalledWith("child_crash");
    expect(session.history.some((t) => t.role === "system" && t.text.includes("exited with code 1"))).toBe(true);
    unmount();
  });

  it("events iterator termination (endStream) is handled without crashing", async () => {
    const session = new Session("s1");
    const ctrl = createFakeChildHandle("s1");
    const { unmount } = render(
      <ChatUI session={session} child={ctrl.handle} onExit={() => {}} />,
    );
    // Deliver one result, then terminate the events stream.
    ctrl.emit({
      type: "result", stopReason: "end_turn", text: "hi",
      usage: { inputTokens: 0, outputTokens: 0 }, raw: {},
    });
    await waitForFrames();
    ctrl.endStream();
    await waitForFrames();
    // No state change — session stays alive until explicit exit.
    expect(session.exitReason).toBeUndefined();
    unmount();
  });
});
```

- [ ] **Step 3: Run, verify fail**

Run: `npx vitest run src/cli/tests/ChatUI.test.tsx`
Expected: module not found.

- [ ] **Step 4: Create `src/cli/components/ChatUI.tsx`**

```tsx
import React, { useEffect, useState, useCallback, useRef } from "react";
import { Box, Static, Text } from "ink";
import type { Session, Turn, Usage, ExitReason, ToolCall } from "../lib/session.js";
import type { ChildHandle } from "../lib/agent.js";
import { parseSlashCommand, HELP_TEXT } from "../lib/slash-commands.js";
import { TextInput } from "./TextInput.js";

type Status = "streaming" | "awaiting" | "ended";

interface Props {
  session: Session;
  child: ChildHandle;
  onExit: (reason: ExitReason) => void;
}

export function ChatUI({ session, child, onExit }: Props) {
  const [history, setHistory] = useState<Turn[]>(() => [...session.history]);
  const [streamingText, setStreamingText] = useState("");
  const [inputBuffer, setInputBuffer] = useState("");
  const [status, setStatus] = useState<Status>("streaming");
  const [lastUsage, setLastUsage] = useState<Usage | undefined>();

  // Accumulate per-turn deltas and tool calls for the in-flight assistant turn
  const pendingText = useRef<string>("");
  const pendingToolCalls = useRef<ToolCall[]>([]);

  // Consume child events
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        for await (const ev of child.events) {
          if (cancelled) break;

          if (ev.type === "assistant_delta") {
            pendingText.current += ev.textDelta;
            setStreamingText(pendingText.current);
          } else if (ev.type === "tool_use") {
            pendingToolCalls.current.push(ev.toolCall);
          } else if (ev.type === "result") {
            // Narrow stopReason to the literal union Turn["stopReason"] understands.
            // Anything not recognised falls back to "end_turn" (benign;
            // session stays alive, user can keep typing).
            const stop: "end_turn" | "turn_limit" | "abort" | "error" =
              ev.stopReason === "turn_limit" ? "turn_limit"
              : ev.stopReason === "abort" ? "abort"
              : ev.stopReason === "error" ? "error"
              : "end_turn";
            const assistantTurn: Turn = {
              role: "assistant",
              text: pendingText.current || ev.text,
              toolCalls: pendingToolCalls.current.slice(),
              usage: ev.usage,
              stopReason: stop,
              at: Date.now(),
            };
            session.history.push(assistantTurn);
            setHistory([...session.history]);
            setStreamingText("");
            setLastUsage(ev.usage);
            pendingText.current = "";
            pendingToolCalls.current.length = 0;

            if (ev.stopReason === "turn_limit") {
              setStatus("ended");
              session.exitReason = "turn_limit";
              onExit("turn_limit");
            } else {
              setStatus("awaiting");
            }
          } else if (ev.type === "parse_error") {
            session.history.push({
              role: "system",
              text: `stream-json parse error: ${ev.error} (line: ${ev.rawLine.slice(0, 80)})`,
              at: Date.now(),
            });
            setHistory([...session.history]);
          } else if (ev.type === "tool_result") {
            session.history.push({
              role: "tool_result",
              toolCallId: ev.toolCallId,
              content: ev.content,
              isError: ev.isError,
              at: Date.now(),
            });
            setHistory([...session.history]);
          }
          // system events ignored for UI (already captured in session id on handle)
        }
      } catch (err) {
        session.history.push({
          role: "system",
          text: `event stream error: ${(err as Error).message}`,
          at: Date.now(),
        });
        setHistory([...session.history]);
      }
    })();
    return () => { cancelled = true; };
  }, [child, session, onExit]);

  // Detect child crash
  useEffect(() => {
    let cancelled = false;
    child.exited.then((res) => {
      if (cancelled) return;
      if (session.exitReason !== undefined) return; // already ended via /end or /abort
      if (res.code !== 0 && res.code !== null) {
        session.exitReason = "child_crash";
        setStatus("ended");
        session.history.push({
          role: "system",
          text: `Child process exited with code ${res.code}`,
          at: Date.now(),
        });
        setHistory([...session.history]);
        onExit("child_crash");
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [child, session, onExit]);

  // SIGINT — node-scoped, first press aborts
  useEffect(() => {
    const handler = () => {
      if (session.exitReason !== undefined) return;
      session.exitReason = "abort";
      setStatus("ended");
      child.kill("SIGTERM").finally(() => onExit("abort"));
    };
    process.once("SIGINT", handler);
    return () => {
      process.removeListener("SIGINT", handler);
    };
  }, [child, session, onExit]);

  const handleSubmit = useCallback(
    async (raw: string) => {
      setInputBuffer("");
      const parsed = parseSlashCommand(raw);

      if (parsed.kind === "help") {
        session.history.push({ role: "system", text: HELP_TEXT, at: Date.now() });
        setHistory([...session.history]);
        return;
      }
      if (parsed.kind === "unknown") {
        session.history.push({
          role: "system",
          text: `Unknown command: ${parsed.raw}. Type /help.`,
          at: Date.now(),
        });
        setHistory([...session.history]);
        return;
      }
      if (parsed.kind === "end") {
        setStatus("ended");
        session.exitReason = "user_end";
        try { await child.end(); } catch {}
        onExit("user_end");
        return;
      }
      if (parsed.kind === "abort") {
        setStatus("ended");
        session.exitReason = "abort";
        try { await child.kill("SIGTERM"); } catch {}
        onExit("abort");
        return;
      }
      // regular message
      if (parsed.text.trim().length === 0) return;
      session.history.push({ role: "user", text: parsed.text, at: Date.now() });
      setHistory([...session.history]);
      setStatus("streaming");
      try {
        await child.submit(parsed.text);
      } catch (err) {
        session.history.push({
          role: "system",
          text: `Failed to send: ${(err as Error).message}`,
          at: Date.now(),
        });
        setHistory([...session.history]);
        setStatus("awaiting");
      }
    },
    [child, session, onExit],
  );

  return (
    <Box flexDirection="column">
      <Static items={history.map((turn, i) => ({ turn, key: `${turn.at}-${i}` }))}>
        {(item) => <TurnView key={item.key} turn={item.turn} />}
      </Static>
      {status === "streaming" && streamingText ? (
        <Box marginTop={1}>
          <Text color="cyan">{streamingText}</Text>
        </Box>
      ) : null}
      <Box marginTop={1}>
        <Text color="gray">{"> "}</Text>
        <TextInput
          value={inputBuffer}
          onChange={setInputBuffer}
          onSubmit={handleSubmit}
          disabled={status !== "awaiting"}
          placeholder="Type a message, /help, or /end"
        />
      </Box>
      <StatusBar status={status} turnsUsed={session.turnsUsed()} usage={lastUsage} />
    </Box>
  );
}

function TurnView({ turn }: { turn: Turn }) {
  if (turn.role === "user") {
    return (
      <Box marginTop={1}>
        <Text color="green">you: </Text>
        <Text>{turn.text}</Text>
      </Box>
    );
  }
  if (turn.role === "assistant") {
    return (
      <Box marginTop={1}>
        <Text color="cyan">claude: </Text>
        <Text>{turn.text}</Text>
      </Box>
    );
  }
  if (turn.role === "system") {
    return (
      <Box marginTop={1}>
        <Text dimColor>{turn.text}</Text>
      </Box>
    );
  }
  if (turn.role === "tool_result") {
    return (
      <Box marginTop={1}>
        <Text color={turn.isError ? "red" : "yellow"} dimColor>
          [tool result {turn.isError ? "(error) " : ""}{turn.toolCallId}]
        </Text>
      </Box>
    );
  }
  return null;
}

function StatusBar({
  status,
  turnsUsed,
  usage,
}: {
  status: Status;
  turnsUsed: number;
  usage?: Usage;
}) {
  const parts = [`status: ${status}`, `turns: ${turnsUsed}`];
  if (usage) parts.push(`in/out: ${usage.inputTokens}/${usage.outputTokens}`);
  return (
    <Box marginTop={1}>
      <Text dimColor>{parts.join("  |  ")}</Text>
    </Box>
  );
}
```

- [ ] **Step 5: Run the tests, verify pass**

Run: `npx vitest run src/cli/tests/ChatUI.test.tsx`
Expected: all tests pass. If a test is flaky due to Ink async scheduling, bump `waitForFrames` to 100ms — but do NOT add `setTimeout` loops in the component itself; the test is the thing that flexes for Ink's async.

- [ ] **Step 6: Full suite + build**

Run: `npm test && npm run build`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add src/cli/components/ChatUI.tsx src/cli/tests/ChatUI.test.tsx src/cli/tests/helpers/fake-child-handle.ts
git commit -m "feat(components): add ChatUI Ink component with state machine + slash commands"
```

### Task 5.3: Chunk 5 verification gate

- [ ] **Step 1: Full suite**

Run: `npm test && npm run build`
Expected: all green.

---

## Chunk 6: P6 — `agent-handler.ts` Interactive Branch

**Goal:** Add an `interactive=true` branch to `src/attractor/handlers/agent-handler.ts` that:

1. Creates a host-assigned `Session` (`crypto.randomUUID()`).
2. Calls `agent.runInteractive()` with the combined `preamble + expandedPrompt` as `systemPrompt`.
3. Mounts `ChatUI` via Ink's `render()` and awaits a promise resolved by `onExit`.
4. Flattens `buildSessionDigest()` into `contextUpdates` keys prefixed by `node.id`.
5. Returns an `Outcome` with `status=success` if `digest.success`, `failure` otherwise.
6. Guards: rejects `interactive=true` combined with `jsonSchemaFile` (the two are mutually exclusive — structured output needs a single batched response, interactive needs a live stream).

Legacy `interactive=false` path is untouched.

**Verification after chunk:**
- [ ] Existing `agent-handler` tests still pass.
- [ ] New handler integration test file passes using a fake `Agent` that returns a controllable fake `ChildHandle`.
- [ ] `npm run build` succeeds.

### Task 6.1: Add handler integration tests (fake agent, fake ChildHandle)

**Files:**
- Test: `src/attractor/tests/agent-handler-interactive.test.ts` (new)

**Prerequisites from earlier chunks** (verify present before starting — if missing, re-run the listed chunk):
- Chunk 4: `Agent.runInteractive()` + `ChildHandle` type exported from `src/cli/lib/agent.ts`.
- Chunk 5: `createFakeChildHandle` helper at `src/cli/tests/helpers/fake-child-handle.ts`, exposing `handle.events` as an async iterable matching the `ChildHandle` contract.
- Chunk 3: `Session`, `buildSessionDigest`, `ExitReason` from `src/cli/lib/session.ts`.

- [ ] **Step 1: Write the failing test file**

```ts
import { describe, it, expect, vi } from "vitest";
import { AgentHandler } from "../handlers/agent-handler.js";
import { Session } from "../../cli/lib/session.js";
import type { AgentConfig, ChildHandle } from "../../cli/lib/agent.js";
import type { Node, PipelineContext } from "../types.js";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createFakeChildHandle } from "../../cli/tests/helpers/fake-child-handle.js";

function makeFakeAgent(controllerSetup: (ctrl: ReturnType<typeof createFakeChildHandle>, session: Session) => void) {
  return {
    config: {
      name: "chat",
      description: "",
      model: "opus",
      permissionMode: "dangerouslySkipPermissions",
      tools: [],
      mcp: [],
      prompt: "",
    } as AgentConfig,
    buildArgs: () => [],
    writeMcpConfig: () => null,
    cleanupMcpConfig: () => {},
    kill: () => {},
    run: async () => ({ exitCode: 0, sessionId: null, stdout: null }),
    runInteractive: (opts: { session: Session; systemPrompt: string; cwd: string }): ChildHandle => {
      const ctrl = createFakeChildHandle(opts.session.id);
      controllerSetup(ctrl, opts.session);
      return ctrl.handle;
    },
    expandPrompt: () => "",
    buildInteractiveArgs: () => [],
    mcpConfigPath: null,
  } as any;
}

const baseMeta = (cwd: string, logsRoot: string) => ({
  cwd,
  logsRoot,
  completedNodes: [],
  nodeRetries: {},
  outgoingLabels: [],
});

const baseCtx = (): PipelineContext => ({ values: {} });

describe("AgentHandler — interactive branch", () => {
  it("passes non-interactive nodes through the legacy path unchanged", async () => {
    const legacyRun = vi.fn().mockResolvedValue({ exitCode: 0, sessionId: "legacy", stdout: null });
    const agent = {
      ...makeFakeAgent(() => {}),
      run: legacyRun,
    };
    const handler = new AgentHandler({
      resolveAgent: () => agent.config,
      createAgent: () => agent,
    });
    const tmp = mkdtempSync(join(tmpdir(), "ralph-handler-"));
    try {
      const node: Node = { id: "n1", prompt: "do stuff" };
      const out = await handler.execute(node, baseCtx(), baseMeta(tmp, tmp));
      expect(legacyRun).toHaveBeenCalled();
      expect(out.status).toBe("success");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("rejects interactive=true combined with jsonSchemaFile", async () => {
    const agent = makeFakeAgent(() => {});
    const handler = new AgentHandler({
      resolveAgent: () => agent.config,
      createAgent: () => agent,
    });
    const tmp = mkdtempSync(join(tmpdir(), "ralph-handler-"));
    try {
      // Create a bogus schema file so the read succeeds (we're testing the guard, not missing file)
      const schemaPath = join(tmp, "schema.json");
      (await import("fs")).writeFileSync(schemaPath, "{}");
      const node: Node = {
        id: "n1",
        prompt: "chat",
        interactive: true,
        jsonSchemaFile: "schema.json",
      };
      const out = await handler.execute(node, baseCtx(), baseMeta(tmp, tmp));
      expect(out.status).toBe("fail");
      expect(out.failureReason).toMatch(/interactive.*json_schema|json_schema.*interactive/i);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  // Completed in Task 6.2 Step 3 once the handler exposes the deps.render hook.
  // Marked `.skip` here so the omission fails loudly if Task 6.2 is skipped —
  // a placeholder `expect(true).toBe(true)` would silently pass.
  it.skip("interactive success path: flattens digest into contextUpdates", async () => {
    /* implementation added in Task 6.2 Step 3 */
  });
});
```

- [ ] **Step 2: Run, verify partial fail**

Run: `npx vitest run src/attractor/tests/agent-handler-interactive.test.ts`
Expected: the legacy-passthrough test passes (handler unchanged), the jsonSchema-guard test fails because no guard yet, the skipped "interactive success path" test is reported as skipped.

### Task 6.2: Implement interactive branch with `deps.render` injection hook

**Files:**
- Modify: `src/attractor/handlers/agent-handler.ts`

**Design note — why a `deps.render` hook:** The handler calls Ink's `render()` at runtime, but tests can't render into a real Ink terminal in Node. The pattern: accept an optional `render` function in `AgentHandlerDeps` defaulted to Ink's `render`. Tests pass a stub that resolves the `onExit` promise synchronously based on canned session state. This keeps the production path equivalent to calling `ink.render` directly while making the branch testable.

**Downstream consumers of the `render` seam:** The `render` dep is consumed only by `AgentHandler` itself. Engine wiring and pipeline execution never see this seam — production just passes no `deps.render`, which lazy-loads Ink's real `render` on first interactive node. Tests construct `new AgentHandler({ render: stubRender })` directly.

- [ ] **Step 0: Preflight read — confirm variable names in the current file**

Run: `grep -n 'const agent\|jsonSchema\|jsonSchemaFile\|interactive\|nodeDir\|onStdout\|signal\|cwd\|config' src/attractor/handlers/agent-handler.ts`

Confirm the following bindings exist at the insertion point (inside the current `execute(node, ctx, meta)` body), and record the line numbers:
- `const cwd = meta.cwd` (or similar)
- `const signal = meta.signal` (or similar, optional)
- `const nodeDir` (the logs directory path)
- `const config = this.resolve(node.agent ?? ...)` (the resolved `AgentConfig`)
- `const interactive = node.interactive === true` (add this line if missing)
- `const jsonSchema = ...` (may currently be derived from `jsonSchemaFile`)
- `const onStdout = ...` (only used by `agent.run()` loop)

If any of these are missing in the current file, add them above the interactive branch as local constants. The plan assumes each is in scope; this preflight is the ground truth.

- [ ] **Step 1: Extend `AgentHandlerDeps` and the constructor**

Edit `src/attractor/handlers/agent-handler.ts`:

```ts
// Update imports at top
import { mkdirSync, writeFileSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { randomUUID } from "crypto";
import type { NodeHandler } from "./registry.js";
import type { Node, Outcome, PipelineContext, CheckpointState } from "../types.js";
import { Agent, type AgentConfig, type RunResult, type ChildHandle } from "../../cli/lib/agent.js";
import { resolveAgent as defaultResolveAgent } from "../../cli/lib/agent-registry.js";
import { buildPreamble } from "../transforms/preamble.js";
import { expandVariables } from "../transforms/variable-expansion.js";
import { Session, buildSessionDigest, type ExitReason } from "../../cli/lib/session.js";
import React from "react";

// Dependency type for the Ink renderer (so tests can inject a stub)
export type InkRenderFn = (
  element: React.ReactElement,
) => { unmount: () => void; waitUntilExit: () => Promise<void> };

export interface AgentHandlerDeps {
  resolveAgent?: (name: string) => AgentConfig;
  createAgent?: (config: AgentConfig) => Agent;
  render?: InkRenderFn;
}
```

Update the constructor:

```ts
export class AgentHandler implements NodeHandler {
  private resolve: (name: string) => AgentConfig;
  private create: (config: AgentConfig) => Agent;
  private render: InkRenderFn | null;

  constructor(deps?: AgentHandlerDeps) {
    this.resolve = deps?.resolveAgent ?? defaultResolveAgent;
    this.create = deps?.createAgent ?? ((c) => new Agent(c));
    this.render = deps?.render ?? null; // lazy-load ink at runtime to avoid ESM init issues in tests
  }
  // ... rest of class
}
```

- [ ] **Step 2: Add the interactive branch in `execute()`**

First, re-arrange so the `const agent = this.create({...})` instance is created **above** the interactive branch (both paths need it). Before:

```ts
// (existing order, simplified)
const expandedRawPrompt = expandVariables(node.prompt ?? "", ctx.values);
const preamble = buildPreamble(checkpoint, fidelity);
const prompt = preamble + expandedRawPrompt;
writeFileSync(join(nodeDir, "prompt.md"), prompt);

// ... loop over retries calling agent.run({ ... interactive ? undefined : onStdout }) ...
const agent = this.create(config);  // currently somewhere inside or near the loop
```

After:

```ts
const expandedRawPrompt = expandVariables(node.prompt ?? "", ctx.values);
const preamble = buildPreamble(checkpoint, fidelity);
const prompt = preamble + expandedRawPrompt;
writeFileSync(join(nodeDir, "prompt.md"), prompt);

// Declare the node.interactive flag explicitly (add if the binding doesn't exist yet)
const interactive = node.interactive === true;

// Hoist agent construction — both interactive and legacy paths use it
const agent = this.create(config);

// --- Path 1.5: interactive branch (inserted here) ---
if (interactive) {
  // ... see below ...
}

// ... legacy retry loop calling agent.run({...}) continues unchanged below ...
```

If the legacy `agent.run(...)` call previously included `interactive ? undefined : onStdout`, simplify it to just `onStdout` — control now never reaches the loop when `interactive === true`. If that conditional expression doesn't already exist in the file (from an earlier chunk), skip this simplification.

Insert the interactive branch body:

```ts
    // --- Path 1.5: interactive branch ---
    if (interactive) {
      // Guard: interactive + json_schema_file is not allowed
      if (jsonSchema) {
        return {
          status: "fail",
          failureReason: "interactive=true cannot be combined with json_schema_file: structured output (json_schema) is incompatible with live chat streaming",
        };
      }

      const sessionId = randomUUID();
      const session = new Session(sessionId);
      const systemPrompt = prompt; // already preamble + expanded node prompt

      const child: ChildHandle = agent.runInteractive({
        session,
        systemPrompt,
        cwd,
        allowedTools: config.tools,
        dangerouslySkipPermissions: config.permissionMode === "dangerouslySkipPermissions",
        abortSignal: signal,
      });

      // Lazy-load Ink render and ChatUI to avoid import cost for non-interactive pipelines
      let renderFn = this.render;
      let ChatUIComponent: any;
      if (!renderFn) {
        const ink = await import("ink");
        renderFn = ink.render as unknown as InkRenderFn;
      }
      const chatUiModule = await import("../../cli/components/ChatUI.js");
      ChatUIComponent = chatUiModule.ChatUI;

      const exitReason: ExitReason = await new Promise<ExitReason>((resolvePromise) => {
        let handled = false;
        const handleExit = (reason: ExitReason) => {
          if (handled) return;
          handled = true;
          resolvePromise(reason);
        };
        const instance = renderFn!(
          React.createElement(ChatUIComponent, { session, child, onExit: handleExit }),
        );
        // If the child exits unexpectedly before ChatUI has a chance to set exitReason,
        // the ChatUI's internal useEffect on child.exited handles it.
        child.exited.finally(() => {
          try { instance.unmount(); } catch {}
        });
      });

      // Ensure the process is actually gone
      try {
        await Promise.race([
          child.exited,
          new Promise<void>((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000)),
        ]);
      } catch {
        try { await child.kill("SIGKILL"); } catch {}
      }

      // Build digest and flatten into contextUpdates
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

      // Persist the flattened digest to the node's logs dir for operator visibility
      writeFileSync(join(nodeDir, "digest.json"), JSON.stringify(digest, null, 2));

      return {
        status: digest.success ? "success" : "fail",
        failureReason: digest.success ? undefined : `Interactive session ended with ${digest.exitReason}`,
        contextUpdates,
      };
    }
    // --- end interactive branch; legacy path below is unchanged ---
```

**Scoping notes already covered above:**
- `const agent` must be hoisted above the `if (interactive)` branch (see "Before"/"After" diff).
- `jsonSchema` is derived from `jsonSchemaFile` higher up in the file (confirmed in the Step 0 preflight).
- The legacy `onStdout` branch inside the retry loop is unchanged if it wasn't previously conditional on `interactive`.

- [ ] **Step 3: Unskip and finish the deferred test case from Task 6.1**

Edit the `it.skip(...)` placeholder in `src/attractor/tests/agent-handler-interactive.test.ts` — remove `.skip` and fill in the body:

Edit `src/attractor/tests/agent-handler-interactive.test.ts` and replace the `expect(true).toBe(true)` placeholder with:

```ts
    // Inject a stub render that reads from the fake ChildHandle controller
    const stubRender: any = (element: any) => {
      const props = element.props;
      const { session, child, onExit } = props;
      // Simulate ChatUI behavior: drain events until result, then call /end path
      (async () => {
        for await (const ev of child.events) {
          if (ev.type === "result") {
            session.history.push({
              role: "assistant",
              text: ev.text,
              toolCalls: [],
              usage: ev.usage,
              at: Date.now(),
            });
            session.exitReason = "user_end";
            try { await child.end(); } catch {}
            onExit("user_end");
            return;
          }
        }
      })();
      return { unmount: () => {}, waitUntilExit: async () => {} };
    };

    const handler = new AgentHandler({
      resolveAgent: () => agent.config,
      createAgent: () => agent,
      render: stubRender,
    });

    const tmp = mkdtempSync(join(tmpdir(), "ralph-handler-"));
    try {
      const node: Node = {
        id: "chat_node",
        prompt: "talk to the user",
        interactive: true,
      };
      const out = await handler.execute(node, baseCtx(), baseMeta(tmp, tmp));
      expect(out.status).toBe("success");
      expect(out.contextUpdates!["chat_node.output"]).toBe("summary text");
      expect(out.contextUpdates!["chat_node.success"]).toBe(true);
      expect(out.contextUpdates!["chat_node.exitReason"]).toBe("user_end");
      // Session.turnsUsed() counts user-role turns; the stub only pushed an
      // assistant turn, so turnsUsed is 0. (See src/cli/lib/session.ts — Chunk 3.)
      expect(out.contextUpdates!["chat_node.turnsUsed"]).toBe(0);
      expect(typeof out.contextUpdates!["chat_node.digest"]).toBe("object");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
```

Also add an abort-path test:

```ts
  it("interactive abort path: status='fail', contextUpdates contain partial digest", async () => {
    const agent = makeFakeAgent((ctrl, session) => {
      setTimeout(() => {
        session.exitReason = "abort";
      }, 10);
    });

    const stubRender: any = (element: any) => {
      const { session, child, onExit } = element.props;
      setTimeout(() => {
        session.exitReason = "abort";
        child.kill("SIGTERM").finally(() => onExit("abort"));
      }, 5);
      return { unmount: () => {}, waitUntilExit: async () => {} };
    };

    const handler = new AgentHandler({
      resolveAgent: () => agent.config,
      createAgent: () => agent,
      render: stubRender,
    });

    const tmp = mkdtempSync(join(tmpdir(), "ralph-handler-"));
    try {
      const node: Node = { id: "chat_node", prompt: "p", interactive: true };
      const out = await handler.execute(node, baseCtx(), baseMeta(tmp, tmp));
      expect(out.status).toBe("fail");
      expect(out.contextUpdates!["chat_node.success"]).toBe(false);
      expect(out.contextUpdates!["chat_node.exitReason"]).toBe("abort");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npx vitest run src/attractor/tests/agent-handler-interactive.test.ts`
Expected: all tests pass, including legacy passthrough, jsonSchema guard, success path, abort path.

- [ ] **Step 5: Run the full suite + build**

Run: `npm test && npm run build`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/attractor/handlers/agent-handler.ts src/attractor/tests/agent-handler-interactive.test.ts
git commit -m "feat(agent-handler): add interactive=true branch with ChatUI + digest flattening"
```

### Task 6.3: Chunk 6 verification gate

- [ ] **Step 1: Full suite**

Run: `npm test && npm run build`
Expected: all green.

- [ ] **Step 2: Regression check — existing non-interactive pipelines**

Run: `ralph pipeline validate pipelines/illumination-to-plan.dot`
Expected: no errors.

- [ ] **Step 3: Confirm `interactive=true` nodes now go through the new branch (dry check)**

Grep: `grep -n 'runInteractive\|interactive branch' src/attractor/handlers/agent-handler.ts`
Expected: matches on both the branch guard and the `agent.runInteractive()` call.

---

## Chunk 7: P7 + P8 — Smoke Pipelines + Manual Verification

**Goal:** Create three new files under `pipelines/smoke/` — `chat-only.dot`, `chat-end-to-end.dot`, `schemas/summary.json` — then execute the full manual smoke test matrix from spec §5.7. This chunk is the **definition of done** for the spec.

**`pipelines/illumination-to-plan.dot` is NOT modified** in this chunk (Q4 from spec §7).

### Task 7.1: Create `pipelines/smoke/chat-only.dot`

**Files:**
- Create: `pipelines/smoke/chat-only.dot`

- [ ] **Step 1: Write the file**

```
digraph chat_only {
  start [kind=entry];
  chat  [kind=agent, interactive=true, prompt="You are a helpful assistant. Introduce yourself in one sentence, then ask the user what they want to talk about."];
  done  [kind=exit];
  start -> chat;
  chat  -> done;
}
```

- [ ] **Step 2: Validate it parses**

Run: `ralph pipeline validate pipelines/smoke/chat-only.dot` (or whatever validate subcommand exists; `ralph pipeline list pipelines/smoke/` otherwise)
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add pipelines/smoke/chat-only.dot
git commit -m "feat(pipelines): add chat-only smoke pipeline for ChatUI isolation testing"
```

### Task 7.2: Create `pipelines/smoke/chat-end-to-end.dot` + schema

**Files:**
- Create: `pipelines/smoke/chat-end-to-end.dot`
- Create: `pipelines/smoke/schemas/summary.json`

- [ ] **Step 1: Write the schema file**

Create `pipelines/smoke/schemas/summary.json`:

```json
{
  "type": "object",
  "required": ["summary"],
  "properties": {
    "summary": { "type": "string" }
  }
}
```

- [ ] **Step 2: Write the DOT file**

Create `pipelines/smoke/chat-end-to-end.dot`:

```
digraph chat_end_to_end {
  start [kind=entry];

  chat [
    kind=agent,
    interactive=true,
    prompt="You are helping the user capture one thing they learned today. Ask them one question, acknowledge their answer, then tell them you will summarize it for them."
  ];

  summarize [
    kind=agent,
    interactive=false,
    prompt="Summarize this chat into a single sentence. Input:\n\n$chat.output",
    json_schema_file="pipelines/smoke/schemas/summary.json"
  ];

  recovery [
    kind=agent,
    interactive=false,
    prompt="The interactive chat was aborted. Write a one-line note saying the user aborted early. Partial output (may be empty): $chat.output"
  ];

  done [kind=exit];

  start     -> chat;
  chat      -> summarize [condition="outcome=success"];
  chat      -> recovery  [condition="outcome=fail"];
  summarize -> done;
  recovery  -> done;
}
```

**Note on variable syntax:** ralph-cli's `expandVariables` uses `$key` (single-dollar) per `src/attractor/transforms/variable-expansion.ts:8`. The spec text uses `${chat.output}` in prose but this plan uses the actual working syntax `$chat.output`.

- [ ] **Step 3: Validate it parses**

Run: `ralph pipeline validate pipelines/smoke/chat-end-to-end.dot`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add pipelines/smoke/chat-end-to-end.dot pipelines/smoke/schemas/summary.json
git commit -m "feat(pipelines): add chat-end-to-end smoke pipeline with success/recovery paths"
```

### Task 7.3: Build, link, and run the manual smoke test matrix

This task cannot be automated. The executor (human or agent with TTY access) must run each test and check each box. Each failed test is a **blocker** until fixed.

- [ ] **Step 1: Build + link**

Run:

```bash
cd /Users/josu/Documents/projects/ralph-cli
npm install
npm run build
npm link
which ralph     # expect /Users/josu/.npm-global/bin/ralph or similar
ralph --version
claude --version  # must be 2.1.69 or newer
```

- [ ] **Step 2: Smoke test 1 — `npm test`**

Run: `npm test`
Expected: all unit, contract, component, integration tests pass.

- [ ] **Step 3: Smoke test 2 — Non-interactive regression**

Run: in a scratch project folder, `ralph <folder> plan` (exits cleanly via stdio:inherit two-phase) and `ralph <folder> implement --max 1` (single iteration).
Expected: both commands behave identically to pre-change.

- [ ] **Step 4: Smoke test 3 — ChatUI standalone (`chat-only.dot`)**

Run: `ralph pipeline run pipelines/smoke/chat-only.dot`

Manual checklist:

- [ ] Ink ChatUI appears after pipeline banner
- [ ] Claude's introduction streams in visible chunks
- [ ] Status transitions to "awaiting" after the first `result` event
- [ ] TextInput accepts typed characters, shows cursor, shows placeholder when empty
- [ ] `/help` renders HELP_TEXT without a round-trip
- [ ] Regular message round-trips (user → assistant)
- [ ] `/end` unmounts cleanly; terminal returns to normal
- [ ] Pipeline engine logs show `chat.output` contains the last assistant message
- [ ] `logs/chat/digest.json` (or equivalent) exists and matches the digest shape
- [ ] Checkpoint file has flat-keyed entries (`chat.output`, `chat.success`, `chat.turnsUsed`, `chat.sessionId`, `chat.exitReason`, `chat.digest`)
- [ ] `ps aux | grep claude` shows no orphan process

- [ ] **Step 5: Smoke test 4 — Abort paths**

- **4a — `/abort`:** Run `chat-only.dot`, type `/abort` mid-chat.
  - [ ] SIGTERM delivered, Ink unmounts, `exitReason=abort`, pipeline exits with failure (`chat-only.dot` has no recovery edge).
- **4b — single Ctrl-C:** Run `chat-only.dot`, press Ctrl-C once.
  - [ ] ChatUI unmounts, pipeline fails, parent shell returns to prompt without hang.
- **4b-2 — double Ctrl-C:** Run `chat-only.dot`, press Ctrl-C twice in rapid succession.
  - [ ] Double-SIGINT escalates via Node default handler, whole process tree killed, parent shell returns with non-zero exit.
- **4c — child crash (REQUIRED):** Run `chat-only.dot`, from another terminal run `pgrep -f "claude.*stream-json"` and then `kill -9 <pid>` on the child claude process.
  - [ ] ChatUI detects exit, reports `child_crash`, pipeline fails cleanly.
  - Promoted from optional: this is the only manual coverage of the `child_crash` exit reason path (spec §4.1), which would otherwise regress silently. If reproduction is flaky on a fast machine, increase chat latency by asking Claude for a long response before killing.
- **4d — abort with recovery edge:** Run `chat-end-to-end.dot`, type `/abort` during the chat.
  - [ ] Pipeline follows `outcome=fail` edge to `recovery`, completes, reaches `done` with overall `status=success`.

- [ ] **Step 6: Smoke test 5 — End-to-end success path (`chat-end-to-end.dot`)**

Run: `ralph pipeline run pipelines/smoke/chat-end-to-end.dot`

Manual checklist:

- [ ] Pipeline enters `chat` node, ChatUI appears
- [ ] Claude asks one question
- [ ] User answers, gets acknowledgement, types `/end`
- [ ] Ink unmounts cleanly
- [ ] Pipeline advances to `summarize` (non-interactive)
- [ ] `summarize` produces a JSON object matching `schemas/summary.json`, populated with content derived from `$chat.output`
- [ ] Pipeline reaches `done` with `status=success`
- [ ] `meditations/.triage/chat-notes.md` does NOT exist at any point (verify: `ls meditations/.triage/ 2>&1 | grep chat-notes` returns nothing)
- [ ] Checkpoint contains `chat.output`, `chat.success=true`, `chat.exitReason=user_end`, `chat.turnsUsed>0`, `summarize.structured_output.summary` (or equivalent per current structured-output key naming)

- [ ] **Step 7: Smoke test 6 — Checkpoint resume**

Run: `ralph pipeline run pipelines/smoke/chat-end-to-end.dot`

1. Complete `chat` with `/end` (success path)
2. While `summarize` is running, press Ctrl-C at the shell level (between nodes, not inside ChatUI)
3. Run: `ralph pipeline resume` (or the equivalent resume invocation)

Manual checklist:

- [ ] Resume does NOT re-launch ChatUI (interactive node already in `completedNodes`)
- [ ] Resume picks up at `summarize` with `$chat.output` still populated from restored context
- [ ] Resume reaches `done` successfully
- [ ] Inspection of checkpoint file: `chat.output`, `chat.success`, `chat.exitReason`, `chat.turnsUsed` are flat primitives — NO nested `Session.history` array

- [ ] **Step 8: Regression — illumination-to-plan.dot still works**

Run: `ralph pipeline run pipelines/illumination-to-plan.dot` (or whatever the existing invocation is)
Expected: same behavior as before this spec. It still uses its file-based handoff; it is the untouched regression baseline per Q4.

- [ ] **Step 9: No orphan processes**

Run: `ps aux | grep -i claude | grep -v grep`
Expected: empty (or only the currently-running ralph process, if any).

### Task 7.4: Chunk 7 final verification gate (definition of done)

- [ ] **Step 1: All six smoke test groups (1, 2, 3, 4a/4b/4b-2/4d, 5, 6) are green**
- [ ] **Step 2: `npm test` green**
- [ ] **Step 3: `npm run build` succeeds**
- [ ] **Step 4: `pipelines/illumination-to-plan.dot` runs unchanged**
- [ ] **Step 5: No orphan `claude` processes after any smoke test**
- [ ] **Step 6: Commit the smoke test outcome notes (if any changes were made during debugging)**

```bash
git add -A
git commit -m "chore: smoke test verification for Path 1.5"
```

- [ ] **Step 7: Mark spec complete**

The spec is implemented when all seven chunks have their verification gates green. Invoke `@superpowers:verification-before-completion` to confirm evidence before declaring done.

---

## Plan Summary

| Chunk | Phase | Files touched |
|---|---|---|
| 1 | P0 Type widening | `types.ts`, `engine.ts`, `conditions.ts`, `preamble.ts`, `variable-expansion.ts`, `checkpoint.ts` + tests |
| 2 | P1 Bug rollups | `wait-human.ts`, `graph.ts` + tests |
| 3 | P2 New primitives | `session.ts`, `slash-commands.ts`, `stream-json-input.ts` + tests |
| 4 | P3 runInteractive | `agent.ts` (add methods), `stream-formatter.ts` (add parser) + tests |
| 5 | P4+P5 Components | `TextInput.tsx`, `ChatUI.tsx` + tests + helper |
| 6 | P6 Handler branch | `agent-handler.ts` + integration tests |
| 7 | P7+P8 Smoke | `pipelines/smoke/chat-only.dot`, `pipelines/smoke/chat-end-to-end.dot`, `pipelines/smoke/schemas/summary.json` + manual verification |

**All existing code paths are preserved:** `Agent.run()`, `plan.ts`, `new.ts`, `meditate-create.ts`, `streamEvents()` (the high-level formatter), and `pipelines/illumination-to-plan.dot` are untouched.

