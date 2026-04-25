---
status: implemented
---

# Gate Validator Producer Declaration Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teach the `variable_coverage` validator walker that every `wait.human` gate produces `choice` (alias) and `<nodeId>.choice` (namespaced). Eliminates the false-positive "no known producer" warning on `pipelines/illumination-to-implementation.dot` and every future multi-gate pipeline.

**Architecture:** Single localized edit in `src/attractor/core/graph.ts` inside `validateGraph`. Extend `TYPE_PRODUCES["wait.human"]` with `"choice"` (type-constant, covers the alias) and add a one-line per-node augmentation inside the existing producer-collection loop for `<id>.choice` (node-specific, covers the namespaced form). No runtime code change, no schema change, no DOT-parser change. Red-first TDD with three regression tests in `graph.test.ts`; smoke-verify on the real pipeline.

**Tech Stack:** TypeScript, Vitest. No new dependencies.

**Spec:** `specs/2026-04-19-gate-validator-producer-declaration-design.md`

---

## Chunk 1: Validator producer declaration + regression tests

Goal: `validateGraph` recognizes hexagon gates as producers of `choice` and `<id>.choice`. Three regression tests in `graph.test.ts` lock the three validator outcomes (clean / path-warning / no-producer). Smoke-verify on `pipelines/illumination-to-implementation.dot`.

### Task 0: Pre-flight — confirm test harness and current validate output

**Files:**
- Read: `src/attractor/tests/graph.test.ts` (understand the existing `validateGraph — variable_coverage` describe block at line 544+)

- [ ] **Step 1: Inspect existing `variable_coverage` tests for style**

Run: `Grep` in `src/attractor/tests/graph.test.ts` for `variable_coverage` to find the describe block (around line 544). The block holds 13 pre-existing tests (lines 545, 571, 585, 598, 610, 622, 635, 648, 661, 674, 695, 712, 738) covering path-analysis, defaults, reserved vars, multi-var warns, explicit `produces=`, store/wait.human/interactive implicit producers, snake_case and singleword defaults, gate-label var scan, and default-on-gate-label. Note:
  - How they build the DOT string inline.
  - How they call `parseDot` (the actual exported helper — confirmed by the existing test file imports) + `validateGraph`.
  - How they filter diagnostics by `rule === "variable_coverage"` and assert `.toHaveLength(...)` or `.message.toContain(...)`.

New tests must use the same construction pattern.

- [ ] **Step 2: Capture current validate output on the real pipeline**

Run: `npm run build && node dist/cli/index.js pipeline validate pipelines/illumination-to-implementation.dot 2>&1`

Expected today (baseline — keep this as the "before" snapshot):
```
⚠ [variable_coverage] Variable "$choice" referenced by node "mark_archived" has
 no known producer
✔ Pipeline valid (20 nodes, 28 edges)
```

After this plan lands, the warning line disappears and only the `✔ Pipeline valid ...` line remains.

### Task 1: Failing test — two-gate pipeline validates with zero `variable_coverage` warnings

**Files:**
- Modify: `src/attractor/tests/graph.test.ts`

- [ ] **Step 1: Add failing test inside the `validateGraph — variable_coverage` describe block**

Append to the `describe("validateGraph — variable_coverage", ...)` block in `src/attractor/tests/graph.test.ts`:

```ts
it("treats wait.human gates as implicit producers of choice and <id>.choice", () => {
  const graph = parseDot(`digraph g {
    start [shape=Mdiamond];
    g1   [shape=hexagon, label="First pick?"];
    g2   [shape=hexagon, label="Second pick?"];
    use  [shape=box, prompt="saw $g1.choice then $g2.choice aka $choice"];
    done [shape=Msquare];
    start -> g1; g1 -> g2; g2 -> use; use -> done;
  }`);
  const diags = validateGraph(graph);
  const warnings = diags.filter(d => d.rule === "variable_coverage");
  expect(warnings).toHaveLength(0);
});
```

Use the `parseDot` helper (already imported at the top of `graph.test.ts`; the existing `variable_coverage` tests call it directly).

- [ ] **Step 2: Run the test — expect FAIL**

Run: `npx vitest run src/attractor/tests/graph.test.ts -t "treats wait.human gates as implicit producers"`

Expected: FAIL. The walker currently finds no producer for `$g1.choice`, `$g2.choice`, or `$choice` on the `use` node — all three references fall into the "no known producer" branch (line 452-458), so `warnings.length` will be 3 (one per variable), not 0.

If the failure mode is different (e.g. parse error, undefined helper), stop and fix the test construction before implementing.

### Task 2: Implement the producer declaration

**Files:**
- Modify: `src/attractor/core/graph.ts`

- [ ] **Step 1: Extend `TYPE_PRODUCES` to include `"choice"` for `wait.human`**

In `src/attractor/core/graph.ts` at roughly line 360-364, change:

```ts
const TYPE_PRODUCES: Record<string, string[]> = {
  "tool": ["tool.output"],
  "store": ["store.path"],
  "wait.human": ["chat.output"],
};
```

to:

```ts
const TYPE_PRODUCES: Record<string, string[]> = {
  "tool": ["tool.output"],
  "store": ["store.path"],
  "wait.human": ["chat.output", "choice"],
};
```

- [ ] **Step 2: Add the per-node `<id>.choice` augmentation**

In the same file, inside the producer-collection loop (currently lines 375-391), after the `TYPE_PRODUCES[handlerType]` block and before the `node.interactive` block, add:

```ts
// Gates write a node-specific choice key in addition to the alias (8cb4eef).
if (handlerType === "wait.human") {
  produced.add(`${id}.choice`);
}
```

Keep the comment tight — it explains the non-obvious link to the handler's runtime write.

- [ ] **Step 3: Run the new test — expect PASS**

Run: `npx vitest run src/attractor/tests/graph.test.ts -t "treats wait.human gates as implicit producers"`

Expected: PASS. Walker now finds `g1` as producer of `g1.choice` + `choice`, `g2` as producer of `g2.choice` + `choice`, so `use` sees producers for all three references.

- [ ] **Step 4: Run the full `validateGraph — variable_coverage` describe block**

Run: `npx vitest run src/attractor/tests/graph.test.ts -t "variable_coverage"`

Expected: all tests PASS, including the two pre-existing ones. If either pre-existing test fails, the new logic is over-producing — e.g. accidentally declaring `choice` on non-gate nodes. Audit the per-node augmentation; it must gate on `handlerType === "wait.human"` exactly.

### Task 3: Regression — skip-path still warns

**Files:**
- Modify: `src/attractor/tests/graph.test.ts`

- [ ] **Step 1: Add test**

Append to the same describe block:

```ts
it("still warns when a gate sits on only some paths to the consumer", () => {
  const graph = parseDot(`digraph g {
    start  [shape=Mdiamond];
    router [shape=diamond];
    gate   [shape=hexagon, label="Pick?"];
    merge  [shape=box];
    use    [shape=box, prompt="read $gate.choice"];
    done   [shape=Msquare];
    start -> router;
    router -> gate [condition="x=a"];
    router -> merge [condition="x=b"];
    gate -> merge;
    merge -> use;
    use -> done;
  }`);
  const diags = validateGraph(graph);
  const warnings = diags.filter(d => d.rule === "variable_coverage");
  expect(warnings).toHaveLength(1);
  expect(warnings[0].message).toContain("may be undefined on path(s) that skip");
  expect(warnings[0].message).toContain("gate");
});
```

- [ ] **Step 2: Run — expect PASS**

Run: `npx vitest run src/attractor/tests/graph.test.ts -t "still warns when a gate sits on only some paths"`

Expected: PASS. The walker now recognizes `gate` as a producer of `gate.choice`, runs the existing path-analysis code, and emits the "may be undefined on path(s) that skip node gate" warning because the `router -> merge` path bypasses `gate`.

If FAIL with zero warnings: the path-analysis block is not firing for the new producer. Double-check that the `<id>.choice` key went into `nodeProduces` for `gate` specifically (add a `console.log(nodeProduces)` temporarily, then remove).

If FAIL with a different message: the wording of the "may be undefined" diagnostic has drifted since the spec was written. Update the spec's acceptance criterion 5 to the current wording, then update the test.

### Task 4: Regression — no gate upstream still warns

**Files:**
- Modify: `src/attractor/tests/graph.test.ts`

- [ ] **Step 1: Add test**

Append:

```ts
it("still warns when a consumer references $choice with no gate upstream", () => {
  const graph = parseDot(`digraph g {
    start [shape=Mdiamond];
    use   [shape=box, prompt="read $choice"];
    done  [shape=Msquare];
    start -> use; use -> done;
  }`);
  const diags = validateGraph(graph);
  const warnings = diags.filter(d => d.rule === "variable_coverage");
  expect(warnings).toHaveLength(1);
  expect(warnings[0].message).toContain("has no known producer");
  expect(warnings[0].message).toContain("$choice");
});
```

- [ ] **Step 2: Run — expect PASS**

Run: `npx vitest run src/attractor/tests/graph.test.ts -t "still warns when a consumer references \\$choice with no gate upstream"`

Expected: PASS. No `wait.human` node exists in this graph, so `nodeProduces` contains no producer for `choice`, and the "no known producer" branch fires.

### Task 5: Smoke-verify on the real pipeline

**Files:**
- Verify: `pipelines/illumination-to-implementation.dot`

- [ ] **Step 1: Rebuild and revalidate**

Run: `npm run build && node dist/cli/index.js pipeline validate pipelines/illumination-to-implementation.dot 2>&1`

Expected:
```
✔ Pipeline valid (20 nodes, 28 edges)
```

No `variable_coverage` warning. The validator is now a pure pass/fail for this pipeline.

If a warning still appears: check which variable is unresolved. If it's `$choice` / `<gateId>.choice`, the implementation has a typo — revisit Task 2. If it's a different variable, that is out of scope for this plan (log it and address separately).

### Task 6: Run full test suite

- [ ] **Step 1: Attractor suite**

Run: `npx vitest run src/attractor`
Expected: all tests PASS.

- [ ] **Step 2: Full project suite**

Run: `npm test`
Expected: all tests PASS. Pre-existing type errors (e.g. `agent-handler.ts:36` per commit 8cb4eef commit body) are acceptable if they were already there before this change — confirm with `git stash && npm test && git stash pop` if in doubt.

### Task 7: Mark the illumination resolved

**Files:**
- Modify: `meditations/illuminations/2026-04-19T1100-gate-choice-namespacing.md`

- [ ] **Step 1: Flip frontmatter status**

Edit line 3 of `meditations/illuminations/2026-04-19T1100-gate-choice-namespacing.md`:

From: `status: open`
To:   `status: resolved`

Append a closing note below the existing "Revised Implementation Steps" section:

```markdown
## Resolution

- Steps 1-3, 5, 6: shipped in commit 8cb4eef (runtime write) + af80f89 (docs).
- Step 4 (validator producer declaration): shipped per `specs/2026-04-19-gate-validator-producer-declaration-design.md`.

`pipeline validate pipelines/illumination-to-implementation.dot` is now a clean pass.
```

### Task 8: Commit

- [ ] **Step 1: Commit**

```bash
git add \
  src/attractor/core/graph.ts \
  src/attractor/tests/graph.test.ts \
  specs/2026-04-19-gate-validator-producer-declaration-design.md \
  docs/superpowers/plans/2026-04-19-gate-validator-producer-declaration.md \
  meditations/illuminations/2026-04-19T1100-gate-choice-namespacing.md
git commit -m "feat(validate): declare wait.human gates as producers of choice + <id>.choice"
```

The commit message should also include a short body referencing the source illumination and spec, matching the project's existing commit-message style (see 8cb4eef for the pattern).

---

## Verification checklist

- [ ] `npx vitest run src/attractor/tests/graph.test.ts -t "variable_coverage"` — all PASS (16 tests: 13 pre-existing + 3 new)
- [ ] `npx vitest run src/attractor` — all PASS
- [ ] `npm test` — all PASS (ignoring pre-existing type errors outside this change's scope)
- [ ] `npm run build && node dist/cli/index.js pipeline validate pipelines/illumination-to-implementation.dot` — exits 0 with no warnings
- [ ] Illumination frontmatter reads `status: resolved`

## Out of scope

- Adding `pipeline validate --strict` mode.
- Synthesizing `produces=` attribute on hexagon nodes at DOT load time (considered and rejected in the spec — the walker-side fix is sufficient and localized).
- Teaching the walker that the bare `choice` alias is ambiguous under parallel-branch gates. Follow-up (noted in `specs/2026-04-19-gate-choice-namespacing-design.md:74`).
