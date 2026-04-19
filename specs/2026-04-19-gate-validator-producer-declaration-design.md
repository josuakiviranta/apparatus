# Gate Validator Producer Declaration — Design

**Date:** 2026-04-19
**Status:** Draft
**Source illumination:** `meditations/illuminations/2026-04-19T1100-gate-choice-namespacing.md` (step 4)
**Related spec:** `specs/2026-04-19-gate-choice-namespacing-design.md` (steps 1–3, shipped in commit 8cb4eef)

## Context

Commit 8cb4eef landed the runtime half of the gate-choice namespacing work: `wait-human` handler now writes `<nodeId>.choice` and `choice` alias into pipeline context on every successful gate resolution. The runtime side of the illumination is resolved.

The validator side is not. Running `pipeline validate pipelines/illumination-to-implementation.dot` still emits:

```
⚠ [variable_coverage] Variable "$choice" referenced by node "mark_archived" has no known producer
```

At runtime both `remove_gate` and `approval_gate` are upstream of `mark_archived` and both write `$choice`. But the `variable_coverage` walker in `src/attractor/core/graph.ts:354-457` looks up producers in two places:

1. **Explicit `produces=` attribute** on the node (line 385-389).
2. **Handler-type implicit productions** via the `TYPE_PRODUCES` map (line 360-364):
   ```ts
   const TYPE_PRODUCES: Record<string, string[]> = {
     "tool": ["tool.output"],
     "store": ["store.path"],
     "wait.human": ["chat.output"],
   };
   ```

Hexagon gates (`wait.human`) are missing a declaration for the `choice` + `<nodeId>.choice` keys they **actually** write at runtime. The walker therefore treats every downstream `$choice` consumer as a "no known producer" false positive.

## Goal

Teach the `variable_coverage` walker that every `wait.human` gate produces:

- `choice` — the alias key that any gate populates.
- `<nodeId>.choice` — the node-specific key that only **this** gate populates.

After the fix, `pipeline validate pipelines/illumination-to-implementation.dot` reports no warnings. A two-gate pipeline where consumer references `$<gateId>.choice` on a path that bypasses that specific gate still warns with the existing path-analysis message ("may be undefined on path(s) that skip node X"). A consumer referencing `$choice` still warns when no gate is upstream at all.

The validator is now a pure pass/fail signal for this class of pipeline.

## Non-goals

- No change to runtime behavior. The handler already writes these keys (commit 8cb4eef).
- No change to `TYPE_PRODUCES` for other handler types.
- No new validate rule. Extending the existing `variable_coverage` rule's producer-resolution logic is sufficient.
- No retirement of `"chat.output"` from the `wait.human` entry. Gates still produce that value via the ChatUI path; removing it would break other validations.
- No schema-level `produces=` rewrite of hexagon nodes at load time. Implementation sits entirely inside the walker to keep the fix local.

## Design

### Surface of the change

File: `src/attractor/core/graph.ts`
Function: `validateGraph`
Block: the producer-collection loop at lines 374-391.

Today that loop does:

```ts
const nodeProduces = new Map<string, Set<string>>();
for (const [id, node] of nodes) {
  const produced = new Set<string>();
  const handlerType = resolveHandlerType(node);
  // Implicit productions from handler type
  if (TYPE_PRODUCES[handlerType]) {
    for (const v of TYPE_PRODUCES[handlerType]) produced.add(v);
  }
  // Interactive nodes produce chat.output
  if (node.interactive) produced.add("chat.output");
  // Explicit produces attribute (comma-separated)
  if (typeof node.produces === "string") {
    for (const v of (node.produces as string).split(",").map(s => s.trim()).filter(Boolean)) {
      produced.add(v);
    }
  }
  nodeProduces.set(id, produced);
}
```

The change:

1. Add `"choice"` to the `wait.human` entry in `TYPE_PRODUCES`. This handles the alias.
2. Inside the loop, after resolving `handlerType`, if the node is `wait.human`, add `<id>.choice` to `produced`. This handles the namespaced key.

After the change:

```ts
const TYPE_PRODUCES: Record<string, string[]> = {
  "tool": ["tool.output"],
  "store": ["store.path"],
  "wait.human": ["chat.output", "choice"],
};

// inside the loop:
if (handlerType === "wait.human") {
  produced.add(`${id}.choice`);
}
```

### Why keep the per-node augmentation out of `TYPE_PRODUCES`

`TYPE_PRODUCES` values are constants — they cannot reference `id`. The `<nodeId>.choice` key is specific to each gate. Doing the augmentation inline inside the loop is the minimal deviation from the existing shape.

### Alternative rejected: synthesize `produces=` attribute at load time

The illumination proposed (Option A) synthesizing `produces="<id>.choice, choice"` on every hexagon node during the DOT load step in `parseGraph`. That works but:

- Mutates node attributes before validation — future code that inspects `node.produces` for reasons other than the validator walker will see synthetic values it did not author.
- Splits the logic across two files (`graph.ts` load + `graph.ts` validate) where one place suffices.
- Doesn't actually change behavior relative to the chosen approach — the walker reads `TYPE_PRODUCES` and `node.produces` into the same `produced` Set.

The chosen approach (extend `TYPE_PRODUCES` + inline per-node augmentation) keeps the fix inside the walker where the check happens. A future validator walker (e.g. unused-producer check) that reads the same `nodeProduces` map will see the same declarations for free.

### Path analysis preserved

The existing producer walker sits **before** the path-reachability check at lines 453-470. Adding gates as producers feeds that analysis unchanged. The downstream flow:

- Consumer reads `$approval_gate.choice`.
- Walker finds `approval_gate` in `nodeProduces`.
- If `approval_gate` is on every path from start to consumer → no warning.
- If `approval_gate` is on some paths only → "may be undefined on path(s) that skip node approval_gate" warning (existing behavior preserved).
- If no `wait.human` node is upstream at all → "no known producer" warning (correct — no gate exists to write the key).

### Abort + failure paths

Gate abort returns `status: "fail"` → engine halts (`engine.ts:162-164`). Consumer never executes. Validator's optimistic assumption (gate will produce) is safe because the consumer is never reached under abort.

Tool-level runtime failures (exit non-zero, missing binary) are out of scope for the `variable_coverage` rule in general — the walker trusts declarations, same as every other produce link.

## Acceptance criteria

1. `TYPE_PRODUCES["wait.human"]` includes `"choice"`.
2. Per-node loop adds `<id>.choice` to the produced set for every `wait.human` node.
3. `npm run build && node dist/cli/index.js pipeline validate pipelines/illumination-to-implementation.dot` exits 0 with **no warnings** (today it passes with one `variable_coverage` warning).
4. A test pipeline with two gates `g1 -> g2 -> consumer` where consumer references `$g1.choice` and `$g2.choice` validates with zero warnings.
5. A test pipeline with a diamond router where one branch skips the gate: consumer referencing `$<gateId>.choice` or `$choice` downstream of the merge emits the existing "may be undefined on path(s) that skip node X" warning. The message wording is unchanged from current output.
6. A test pipeline with no gates at all but a consumer referencing `$choice` still emits "no known producer" (correct — no gate = no producer).
7. Existing `variable_coverage` tests in `src/attractor/tests/graph.test.ts` (tests at lines 544+) continue to pass with no message changes.
8. The full attractor test suite passes: `npx vitest run src/attractor`.
9. The full project test suite passes: `npm test`.

## Files touched

| File | Change |
|---|---|
| `src/attractor/core/graph.ts` | Extend `TYPE_PRODUCES["wait.human"]` with `"choice"`; inside producer loop, add `<id>.choice` for every `wait.human` node |
| `src/attractor/tests/graph.test.ts` | Add three regression tests: (a) two-gate pipeline validates with zero warnings; (b) skip-path pipeline still emits the existing "may be undefined" warning; (c) no-gate pipeline still emits "no known producer" |
| `pipelines/illumination-to-implementation.dot` | No change — exists only as a real-world validator smoke target |
| `meditations/illuminations/2026-04-19T1100-gate-choice-namespacing.md` | Flip frontmatter `status: open → resolved` after the fix lands and validate confirms clean pass |

No changes to the runtime handler, engine, conditions, or variable expansion. No changes to the DOT parser. No schema changes.

## Risks & trade-offs

- **False negatives on typos.** If a pipeline author writes `condition="choice==Approve"` (syntax error) next to a gate, `condition_syntax` rule catches it. If an author writes `$<wrongGateId>.choice`, the walker sees no producer for that specific key and warns correctly — each gate only produces **its own** `<id>.choice`, not every hexagon's. That granularity is what makes this fix safer than synthesizing a global `produces="choice"`.
- **Validator optimism.** The walker now assumes "gate runs → key written". Identical to the assumption it already makes for every `tool` node's `tool.output`. Not a new class of risk.
- **Test brittleness.** Acceptance test 5 depends on the exact wording of the "may be undefined on path(s) that skip node X" message. If a future change reworks the message, update the test alongside. Low churn risk — the message has been stable for several releases.

## Out of scope

- Adding a `pipeline validate --strict` mode that upgrades warnings to errors.
- Teaching the walker to follow the bare `choice` alias across branches to catch the "two gates on parallel branches — which one wins?" ambiguity. Separate follow-up (already noted in `specs/2026-04-19-gate-choice-namespacing-design.md:74`).
- Retrofitting illumination-to-implementation.dot consumers to reference `$<gateId>.choice` instead of bare `$choice`. No current runtime bug; alias works as designed.
