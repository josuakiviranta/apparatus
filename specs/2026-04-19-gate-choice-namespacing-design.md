# Gate Choice Namespacing — Design

**Date:** 2026-04-19
**Status:** Draft
**Source illumination:** `meditations/illuminations/2026-04-19T1100-gate-choice-namespacing.md`

## Context

Hexagon gate nodes (handler: `wait-human`) collect a user pick from an Ink prompt. Today the pick is returned on the `Outcome` object as `preferredLabel` and consumed immediately by `selectNextEdge` for label-based routing. The engine never writes it to pipeline context, so:

- `expandVariables` cannot interpolate the pick into downstream tool commands, script args, or agent prompts.
- `conditions.ts` has a code path that would read `ctx["choice"]` for `condition="choice=Approve"` — but nothing writes `choice`, so every such condition is vacuously false. This is effectively dead but documented code.
- Multi-gate pipelines (e.g. `pipelines/illumination-to-implementation.dot` with `remove_gate`, `approval_gate`, `review_gate`) cannot reference an earlier gate's decision from a later node — the information is gone the moment `selectNextEdge` returns.

The referenced illumination frames this as a "clobber" bug. The real bug is narrower: the data is never written at all. The fix is the same — persist each gate's choice into context under a namespaced key — but the framing matters for the acceptance tests (we are adding behavior, not patching a write collision).

## Goal

Every `wait-human` gate resolution writes its pick into pipeline context under two keys:

1. **Namespaced (authoritative):** `<gateNodeId>.choice` — survives for the remainder of the run. Never overwritten by another gate.
2. **Alias (sugar):** `choice` — always holds the **most recent** gate's pick. Exists for ergonomic one-gate pipelines and for `condition="choice=..."` edges that sit immediately after the gate.

Condition routing and variable expansion must transparently support both forms.

## Non-goals

- No change to `preferredLabel`-based edge selection. That path stays intact; condition edges and label edges coexist as they do today.
- No change to how gates render or collect input (Ink `GateSelector` untouched).
- No deep-object context shape. Context stays `Record<string, unknown>`; dotted keys are literal flat keys (the expansion regex already accepts dots in names).
- No migration of existing `.dot` files. Grep confirms zero pipelines use `condition="choice=..."` today; the alias keeps any future author-typed shorthand working.

## Design

### Contract: `WaitHumanHandler.execute`

File: `src/attractor/handlers/wait-human.ts`

Return shape changes from:

```ts
return { status: "success", preferredLabel: answer.value };
```

to:

```ts
return {
  status: "success",
  preferredLabel: answer.value,
  contextUpdates: {
    [`${nodeId}.choice`]: answer.value,
    choice: answer.value,
  },
};
```

`nodeId` comes from `node.id`. `WaitHumanHandler.execute` receives the full `Node` as its first argument (`src/attractor/handlers/wait-human.ts:9`), so no plumbing change is needed to access the id.

`contextUpdates` is only set on the success branch. Aborted / signal-cancelled gates (`wait-human.ts:13-14, 40-42`) return `status: "fail"` with no `contextUpdates`, so failed gates leave prior gate choices untouched in context.

The engine already merges `outcome.contextUpdates` into context at `src/attractor/core/engine.ts:262-263`. No engine change needed for the write side.

### Namespaced key format

- Key literal: `<nodeId>.choice`. The `.` is part of the key string, not a nested lookup.
- `expandVariables` (`src/attractor/transforms/variable-expansion.ts:48-56`) already matches `$name.dotted.segments` as a single key; this continues to work.
- `conditions.ts::resolveKey` already falls through to `ctx[key]` for unrecognized key forms. `condition="approval_gate.choice=Approve"` will read `ctx["approval_gate.choice"]` and match.

### Alias semantics

The bare `choice` key is overwritten on every gate resolution. Authors who need an earlier gate's pick must use the namespaced form. This is documented; the alias is a convenience, not a contract.

A lint/validate-time warning is **out of scope** for this change — a later pipeline-validator pass can flag `condition="choice=..."` that appears more than one gate downstream.

### Condition parser

No code change in `src/attractor/core/conditions.ts`. The existing fall-through (`ctx[key]`) covers both namespaced and alias forms. Confirmed via grep; a dedicated unit test locks this in.

### Variable expansion

No code change in `src/attractor/transforms/variable-expansion.ts`. The regex `/\$([a-zA-Z_]\w*(?:\.\w+)*)/g` already captures dotted names. A unit test asserts `expandVariables("picked $approval_gate.choice", { "approval_gate.choice": "Approve" })` returns `"picked Approve"`.

### Backward compatibility

- No pipeline currently reads `$choice` or `condition="choice=..."`. Nothing breaks.
- `preferredLabel`-based routing and hexagon `label="..."` edges are untouched.
- Tool and agent nodes that did not previously see a `choice` variable continue to see nothing unless a gate has run in the current execution.

## Acceptance criteria

1. After a gate `approval_gate` resolves to `"Approve"`, context contains both `approval_gate.choice === "Approve"` and `choice === "Approve"`.
2. After a second gate `review_gate` resolves to `"Decline"`, context contains `approval_gate.choice === "Approve"` (unchanged), `review_gate.choice === "Decline"`, and `choice === "Decline"` (alias updated).
3. `condition="approval_gate.choice=Approve"` on an edge any distance downstream routes correctly when the gate picked `"Approve"`.
4. `condition="choice=Approve"` on an edge immediately following a gate routes on that gate's pick (new working behavior — `ctx.choice` was never populated before).
5. An aborted gate (user cancels) produces `status: "fail"` and does not write `<nodeId>.choice` or `choice`; any prior gate's namespaced key remains intact.
6. `$<gateNodeId>.choice` and `$choice` expand inside `tool_command`, `script_args`, and agent prompt bodies via `expandVariables`.
7. A unit test covering the two-gate sequence from (1)+(2) exists and passes.

## Risks & trade-offs

- **Dotted keys as flat strings** is load-bearing. If a future refactor introduces a nested-object context shape, these keys must be migrated or the engine must keep flat-key semantics for the `.choice` suffix. Documented in the spec update.
- **Alias ambiguity.** A pipeline author may read `choice` expecting the gate adjacent to them and get a later gate's value if execution order differs from graph reading order. Mitigation: documentation calls out the namespaced form as the safe default.
- **Adding a real context write may surface latent bugs** in downstream nodes that coincidentally had keys named `choice` in test fixtures. Low risk (grep shows no collisions) but the test suite covers this via the existing attractor test set.
- **Parallel-branch gates race on the alias.** `HandlerExecutionContext` exposes `branchOutcomes` (`src/attractor/core/registry.ts:21`), implying parallel paths can host gates. Two gates resolving concurrently in separate branches non-deterministically overwrite `choice`. The namespaced `<nodeId>.choice` keys are collision-free; authors are directed to use them whenever a gate can race. The alias is documented as "most-recent wins, ordering non-deterministic under parallelism."
- **Checkpoint/resume preserved.** The engine writes `contextUpdates` into `context` before the status snapshot at `src/attractor/core/engine.ts:286`. The two new keys are regular string entries in a flat `Record`, so `JSON.stringify(context)` at checkpoint time captures them; `--resume` restores them verbatim. No checkpoint schema change needed.

## Files touched

| File | Change |
|---|---|
| `src/attractor/handlers/wait-human.ts` | Populate `contextUpdates` with `<nodeId>.choice` and `choice` alias |
| `src/attractor/tests/wait-human.test.ts` | Add test: handler returns `contextUpdates` for both keys |
| `src/attractor/tests/engine.test.ts` (or new `gate-choice.test.ts`) | Add two-gate regression: prior gate key survives, alias tracks most recent |
| `src/attractor/tests/conditions.test.ts` | Add test: `condition="<nodeId>.choice=X"` resolves via `ctx[key]` fall-through |
| `src/attractor/tests/variable-expansion.test.ts` | Add test: `$<nodeId>.choice` expands correctly |
| `specs/architecture.md` (or gate section of pipeline spec) | One-paragraph note: every gate writes `<nodeId>.choice`; bare `$choice` is alias for most-recent |

## Out of scope

- Validator heuristic warning for stale `choice` reads across gates (future work).
- Migration of illumination-to-implementation pipeline to use namespaced form (no current usage to migrate).
- Persistence of choices across run resume (checkpoint already serializes the full context map).
