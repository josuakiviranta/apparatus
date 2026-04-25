---
status: implemented
---

# Gate Choice Namespacing Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist every `wait-human` gate's pick into pipeline context under `<gateNodeId>.choice` (authoritative, never overwritten) and `choice` (alias, most-recent). Enables condition routing and variable expansion on gate decisions across the remainder of a run.

**Architecture:** Minimal handler change — `WaitHumanHandler.execute` returns `contextUpdates` with the two keys on the success branch only. Engine already merges `contextUpdates` into context at `src/attractor/core/engine.ts:262-263`, and both `conditions.ts` (direct-key `ctx[key]` fall-through) and `variable-expansion.ts` (regex already matches dotted key names) support the new keys without modification. Tests lock this behavior in at the handler, engine, condition, and expansion layers.

**Tech Stack:** TypeScript, Vitest. No new dependencies.

**Spec:** `specs/2026-04-19-gate-choice-namespacing-design.md`

---

## Chunk 1: Handler write + handler-level tests

Goal: `WaitHumanHandler.execute` populates `contextUpdates` with `<nodeId>.choice` and `choice` on success. Aborted gates do not write. Handler-level Vitest test locks this in.

### Task 0: Pre-flight — discover existing test helpers

**Files:**
- Read: `src/attractor/tests/wait-human.test.ts`, `src/attractor/tests/helpers*` (if present)

- [ ] **Step 1: Grep for helper names referenced later in this plan**

Run: `grep -rn "makeTestHandlers\|makeExecutionContext" src/attractor/tests/`

If either helper exists, note its signature (return shape, required args) and use it as-is in subsequent tasks.

If neither exists, use the construction pattern from the nearest existing passing test in `wait-human.test.ts` to build `Node`, `HandlerExecutionContext`, and handler-map objects inline. Do not introduce new helper modules as part of this plan (YAGNI).

- [ ] **Step 2: Note findings in the task runner's notes**

Record whether `makeExecutionContext` and `makeTestHandlers` exist. If they do not, the inline construction pattern is the one used by the test immediately above the insertion point in each target file.

### Task 1: Handler-level test — success writes both keys

**Files:**
- Modify: `src/attractor/tests/wait-human.test.ts`

- [ ] **Step 1: Read current test file to understand harness and mocking style**

Run: `cat src/attractor/tests/wait-human.test.ts | head -80`

Note the existing mock for `GateSelector` / Ink render harness. The test asserts `outcome.status` and `outcome.preferredLabel`. Reuse the same mock pattern for the new test.

- [ ] **Step 2: Add failing test — success produces namespaced + alias contextUpdates**

Append to `src/attractor/tests/wait-human.test.ts`:

```ts
it("writes <nodeId>.choice and choice alias into contextUpdates on success", async () => {
  const handler = new WaitHumanHandler();
  const node: Node = {
    id: "approval_gate",
    type: "wait-human",
    attributes: { question: "Approve?", choices: ["Approve", "Decline"] },
  };
  // reuse the existing test double that resolves the prompt with "Approve"
  const ctx = makeExecutionContext({ resolveWith: "Approve" });

  const outcome = await handler.execute(node, ctx);

  expect(outcome.status).toBe("success");
  expect(outcome.preferredLabel).toBe("Approve");
  expect(outcome.contextUpdates).toEqual({
    "approval_gate.choice": "Approve",
    choice: "Approve",
  });
});
```

Match `makeExecutionContext` to whatever helper the existing tests use. If none exists, build the context inline using the same shape the current passing tests use.

- [ ] **Step 3: Run test — expect FAIL**

Run: `npx vitest run src/attractor/tests/wait-human.test.ts -t "writes <nodeId>.choice"`
Expected: FAIL with `expect(received).toEqual(expected)` — `contextUpdates` is `undefined`.

- [ ] **Step 4: Implement handler change**

Edit `src/attractor/handlers/wait-human.ts`. On the success branch (currently line ~27), change the returned `Outcome` to include `contextUpdates`:

```ts
return {
  status: "success",
  preferredLabel: answer.value,
  contextUpdates: {
    [`${node.id}.choice`]: answer.value,
    choice: answer.value,
  },
};
```

`node` is already the first argument of `execute`; `answer.value` is already the resolved pick.

- [ ] **Step 5: Run test — expect PASS**

Run: `npx vitest run src/attractor/tests/wait-human.test.ts -t "writes <nodeId>.choice"`
Expected: PASS.

- [ ] **Step 6: Run full handler test file to catch regressions**

Run: `npx vitest run src/attractor/tests/wait-human.test.ts`
Expected: all tests PASS (the previous success-path tests that only checked `preferredLabel` continue to pass — `contextUpdates` is additive).

- [ ] **Step 7: Commit**

```bash
git add src/attractor/handlers/wait-human.ts src/attractor/tests/wait-human.test.ts
git commit -m "feat(gate): write <nodeId>.choice and choice alias on wait-human success"
```

### Task 2: Handler-level regression guard — aborted gate writes nothing

> This is a **regression guard**, not a red-first driver test. The abort branch of `wait-human.ts` already returns with no `contextUpdates` and cannot reach the success-only assignment from Task 1. The test locks that invariant in so a future edit to the handler cannot accidentally cross-contaminate the two branches.

**Files:**
- Modify: `src/attractor/tests/wait-human.test.ts`

- [ ] **Step 1: Add regression guard — aborted gate returns no contextUpdates**

Append to `src/attractor/tests/wait-human.test.ts`:

```ts
it("does not write contextUpdates when gate is aborted", async () => {
  const handler = new WaitHumanHandler();
  const node: Node = {
    id: "approval_gate",
    type: "wait-human",
    attributes: { question: "Approve?", choices: ["Approve", "Decline"] },
  };
  const ctx = makeExecutionContext({ abort: true });

  const outcome = await handler.execute(node, ctx);

  expect(outcome.status).toBe("fail");
  expect(outcome.contextUpdates).toBeUndefined();
});
```

Use whatever abort hook the existing abort test uses (`AbortSignal`, `SIGINT`, or the in-file test-double mechanism).

- [ ] **Step 2: Run — expect PASS without code change**

Run: `npx vitest run src/attractor/tests/wait-human.test.ts -t "does not write contextUpdates when gate is aborted"`
Expected: PASS (the abort branch already returns without a `contextUpdates` field).

If FAIL: the abort branch is accidentally writing `contextUpdates`. Fix by confirming the `contextUpdates` assignment is only on the success branch, not shared with fail/abort exits.

- [ ] **Step 3: Commit**

```bash
git add src/attractor/tests/wait-human.test.ts
git commit -m "test(gate): aborted wait-human writes no contextUpdates"
```

---

## Chunk 2: Engine-level two-gate regression + condition + expansion lock-in

Goal: Lock in the end-to-end behavior via engine, condition, and expansion tests. Confirms the alias updates on most-recent, the namespaced key survives, and both forms work in `condition=` and `$var` interpolation.

### Task 3: Engine regression — two sequential gates

**Files:**
- Create: `src/attractor/tests/gate-choice.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/attractor/tests/gate-choice.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { runPipeline } from "../core/engine";
import { parseDot } from "../core/graph";
import { makeTestHandlers } from "./helpers";

describe("gate choice namespacing across multiple gates", () => {
  it("preserves prior gate's <nodeId>.choice and updates alias on most-recent", async () => {
    const dot = `
      digraph g {
        start [type="start"];
        g1 [type="wait-human", question="Q1", choices="a,b"];
        g2 [type="wait-human", question="Q2", choices="x,y"];
        end [type="end"];
        start -> g1;
        g1 -> g2;
        g2 -> end;
      }
    `;
    const graph = parseDot(dot);
    const handlers = makeTestHandlers({
      "wait-human": {
        g1: { resolveWith: "a" },
        g2: { resolveWith: "x" },
      },
    });

    const result = await runPipeline(graph, { handlers });

    expect(result.context["g1.choice"]).toBe("a");
    expect(result.context["g2.choice"]).toBe("x");
    expect(result.context["choice"]).toBe("x"); // alias = most recent
  });
});
```

If `makeTestHandlers` shape differs, adapt to the repo's actual test helper. The essential assertion is the three `context` keys.

- [ ] **Step 2: Run — expect PASS**

Run: `npx vitest run src/attractor/tests/gate-choice.test.ts`
Expected: PASS — all three keys are populated because the handler change from Task 1 emits them per gate.

If FAIL on `g1.choice`: the engine is overwriting namespaced keys. Investigate `engine.ts:262-263` merge semantics. Should not happen because keys are distinct per gate id.

- [ ] **Step 3: Commit**

```bash
git add src/attractor/tests/gate-choice.test.ts
git commit -m "test(engine): multi-gate choice namespacing + alias regression"
```

### Task 4: Condition parser — namespaced key routing

**Files:**
- Modify: `src/attractor/tests/conditions.test.ts`

- [ ] **Step 1: Read current conditions.test.ts to match style**

Run: `cat src/attractor/tests/conditions.test.ts`

Confirm the test constructs a fake `outcome` and `ctx` directly and calls `evaluateCondition(condition, outcome, ctx)`. Reuse the pattern.

- [ ] **Step 2: Add failing test (should actually pass — lock-in only)**

Append to `src/attractor/tests/conditions.test.ts`:

```ts
it("evaluates namespaced gate choice key via direct ctx[key] fall-through", () => {
  const outcome = { status: "success" as const };
  const ctx = { "approval_gate.choice": "Approve" };

  expect(evaluateCondition("approval_gate.choice=Approve", outcome, ctx)).toBe(true);
  expect(evaluateCondition("approval_gate.choice=Decline", outcome, ctx)).toBe(false);
});

it("evaluates bare `choice` alias", () => {
  const outcome = { status: "success" as const };
  const ctx = { choice: "Approve", "approval_gate.choice": "Approve" };

  expect(evaluateCondition("choice=Approve", outcome, ctx)).toBe(true);
});
```

- [ ] **Step 3: Run — expect PASS**

Run: `npx vitest run src/attractor/tests/conditions.test.ts -t "namespaced gate choice"`
Expected: PASS. `conditions.ts::resolveKey` already falls through to `ctx[key]` for unrecognized keys.

If FAIL: open `src/attractor/core/conditions.ts` and verify the fall-through returns `ctx[key]` for any dotted key not starting with `context.`. Do not add a special case — the existing fall-through is sufficient by design.

- [ ] **Step 4: Commit**

```bash
git add src/attractor/tests/conditions.test.ts
git commit -m "test(conditions): namespaced gate choice + alias routing"
```

### Task 5: Variable expansion — dotted key

**Files:**
- Modify: `src/attractor/tests/variable-expansion.test.ts`

- [ ] **Step 1: Add lock-in test**

Append to `src/attractor/tests/variable-expansion.test.ts`:

```ts
it("expands $<nodeId>.choice from flat-keyed context", () => {
  const result = expandVariables(
    "picked $approval_gate.choice",
    { "approval_gate.choice": "Approve" },
  );
  expect(result).toBe("picked Approve");
});
```

- [ ] **Step 2: Run — expect PASS**

Run: `npx vitest run src/attractor/tests/variable-expansion.test.ts -t "expands \\$<nodeId>.choice"`
Expected: PASS. The regex `/\$([a-zA-Z_]\w*(?:\.\w+)*)/g` already matches dotted names.

- [ ] **Step 3: Commit**

```bash
git add src/attractor/tests/variable-expansion.test.ts
git commit -m "test(expansion): dotted gate-choice key expansion"
```

---

## Chunk 3: Documentation

Goal: Update the relevant spec so future authors know about the namespaced form and the alias contract.

### Task 6: Spec update

**Files:**
- Modify: `specs/architecture.md` OR the specific pipeline/gate spec (identify by reading the file first)

- [ ] **Step 1: Locate the authoritative gate documentation**

Run: `grep -rln "wait-human\|hexagon\|gate" specs/ | head -20`

Choose the file that currently documents hexagon/gate semantics. If none exists beyond `architecture.md`, add the new section there.

- [ ] **Step 2: Add namespaced-choice section**

Insert the following paragraph in the gate/hexagon section:

```markdown
### Gate choice in context

Every `wait-human` gate that resolves to a user pick writes two keys into pipeline context:

- `<gateNodeId>.choice` — authoritative and immutable for the rest of the run. Reference this from any downstream node, condition, or variable expansion that needs the specific gate's decision.
- `choice` — alias that always holds the most-recent resolved gate's pick. Convenient for one-gate pipelines and for `condition="choice=..."` edges immediately adjacent to a gate. Under parallel branches, `choice` is last-writer-wins and non-deterministic; prefer the namespaced form whenever a gate can race.

Aborted or failed gates do not write either key. Existing `<gateNodeId>.choice` entries from prior successful gates remain intact.

Condition edges consume these via the standard `condition="key=value"` syntax; variable expansion consumes them as `$<gateNodeId>.choice` or `$choice`.
```

- [ ] **Step 3: Commit**

```bash
git add specs/<chosen-file>.md
git commit -m "docs(gate): namespaced choice contract + alias semantics"
```

---

## Verification

- [ ] Run full attractor test suite: `npx vitest run src/attractor`
- [ ] Run full project test suite: `npm test`
- [ ] Smoke-run a multi-gate pipeline interactively (optional): `ralph pipeline run pipelines/illumination-to-implementation.dot --project . --var ...` and confirm after each gate resolution that a subsequent `tool_command` containing `$approval_gate.choice` expands to the prior gate's pick.

## Out of scope

- Adding a `portability_heuristic` / validator warning for `condition="choice=..."` used more than one gate downstream. Future work; not blocking this change.
- Migrating `pipelines/illumination-to-implementation.dot` to reference earlier gates' choices. No current pipeline needs it.
