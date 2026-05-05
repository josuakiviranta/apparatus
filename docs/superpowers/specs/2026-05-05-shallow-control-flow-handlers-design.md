# Design: Shallow Control-Flow Handlers — Inline Conditional, Delete Parallel

**Date:** 2026-05-05
**Status:** draft (pending review)
**Originating illumination:** `.ralph/meditations/illuminations/2026-05-05T1030-shallow-control-flow-handlers.md`

## 1. Motivation

The `NodeHandler` seam exists for node types that encapsulate real per-variant work: `agent` (Claude subprocess + stream), `tool` (shell + capture), `wait.human` (interactive gate), `store` (context-key write), `start`/`exit` (lifecycle markers), `stack.manager_loop`. For these the "deletion test" passes — removing a handler concentrates real complexity that would otherwise reappear in engine.

`conditional` and `parallel` are different. They are control-flow primitives, not node variants, and their handler bodies do near-zero real work:

1. **`ConditionalHandler` is a no-op.** From `src/attractor/handlers/conditional.ts:4-7`:

    ```ts
    export class ConditionalHandler implements NodeHandler {
      async execute(_node: Node, _ctx: PipelineContext, _meta: HandlerExecutionContext): Promise<Outcome> {
        return { status: "success" };
      }
    }
    ```

    Every parameter is underscore-prefixed. The actual branch decision lives in `selectNextEdge` at `src/attractor/core/engine.ts:82-93`, which filters outgoing edges by `condition` and calls `evaluateCondition`. The handler is theatre — `execute()` returns `success`, then engine immediately re-routes via edge-condition matching that has nothing to do with the handler.

2. **`ParallelHandler` / `FanInHandler` are dead code.** From `src/attractor/handlers/parallel.ts:4-23`:

    ```ts
    export class ParallelHandler implements NodeHandler {
      async execute(_node, _ctx, meta) {
        const branchOutcomes = meta.branchOutcomes ?? {};
        return {
          status: "success",
          contextUpdates: { "parallel.results": JSON.stringify(Object.values(branchOutcomes)) },
        };
      }
    }
    export class FanInHandler implements NodeHandler {
      async execute(_node, ctx, _meta) {
        const raw = ctx.values["parallel.results"];
        const results: Outcome[] = raw ? JSON.parse(String(raw)) : [];
        const allSucceeded = results.every(r => r.status === "success");
        const anySucceeded = results.some(r => r.status === "success");
        const status = allSucceeded ? "success" : anySucceeded ? "partial_success" : "fail";
        return { status };
      }
    }
    ```

    `ParallelHandler` is a JSON encoder of `meta.branchOutcomes`. `FanInHandler` decodes the same key and merges statuses. Branch fan-out is not implemented anywhere — `meta.branchOutcomes` is never populated by the engine; it is only set by hand in `src/attractor/tests/handlers.test.ts:117-186`. This was already flagged by the existing `UNIMPLEMENTED_TYPES` guard at `src/attractor/core/graph.ts:38-41`:

    ```ts
    const UNIMPLEMENTED_TYPES = new Set([
      "parallel", "parallel.fan_in",     // fan-out execution not yet implemented
      "stack.manager_loop",              // no handler registered
    ]);
    ```

    Adjacent illumination `2026-05-01T0423-janitor-parallel-handler-yagni.md` already proposed pure deletion. This design folds that conclusion in.

3. **`partial_success` exists for a single, dead caller.** `src/attractor/types.ts:1` declares `OutcomeStatus = "success" | "retry" | "fail" | "partial_success"`. The only producer of `partial_success` is `FanInHandler.execute()` at `parallel.ts:20`. The only non-test consumer is the renderer mapping at `src/cli/commands/pipeline.ts:454-462`, which already collapses `partial_success` → `"fail"` + a "partial success" reason string. With `FanInHandler` gone, the union member has zero producers and the renderer special-case becomes unreachable.

The chosen structure under the deep-modules lens (per the chat refinement on the parallel-handler-yagni illumination): **delete the parallel handlers outright**, **delete the conditional handler and inline its no-op pass-through into the engine's main dispatch loop**, and **collapse `partial_success` out of the internal `OutcomeStatus` union**. The `NodeHandler` seam stays meaningful for the survivors — every implementer encapsulates real per-type complexity.

This is plumbing-under-the-floor: the user-visible surface — CLI, MCP, agents, pipelines, `.dot` syntax, frontmatter shapes, `pipeline.jsonl`, public exports — does not change. No `.dot` file in the repo references `type=conditional`, `type=parallel`, or `type=parallel.fan_in` (verified by repo-wide grep over `pipelines/**/*.dot` and `src/cli/pipelines/**/*.dot`).

## 2. Decision Summary

1. **Delete `src/attractor/handlers/parallel.ts`.** Both classes (`ParallelHandler`, `FanInHandler`) have zero `.dot` consumers and are already in `UNIMPLEMENTED_TYPES`. The 7 handler tests at `src/attractor/tests/handlers.test.ts:117-187` go with the file (two `describe` blocks: `ParallelHandler`, `FanInHandler`).

2. **Delete `src/attractor/handlers/conditional.ts`.** The `ConditionalHandler.execute()` body is `return { status: "success" }`. Edge selection on conditioned edges already lives in `selectNextEdge` at `engine.ts:82-93`. Inline a one-line passthrough in the engine's dispatch loop (see §3.3) so diamond-shaped / `type="conditional"` nodes resolve to `success` without a handler-map entry.

3. **Trim the engine handler map.** In `src/attractor/core/engine.ts:49-67`, remove three `m.set` calls and three imports:

    - `m.set("conditional", new ConditionalHandler());` at line 57
    - `m.set("parallel", new ParallelHandler());` at line 62
    - `m.set("parallel.fan_in", new FanInHandler());` at line 63
    - `import { ConditionalHandler } from "../handlers/conditional.js";` at line 9
    - `import { ParallelHandler, FanInHandler } from "../handlers/parallel.js";` at line 14

4. **Add a one-line conditional passthrough in the engine's dispatch loop.** Just before the `handler.execute()` call at `engine.ts:258`, short-circuit when `handlerType === "conditional"`:

    ```ts
    let outcome: Outcome;
    if (handlerType === "conditional") {
      outcome = { status: "success" };
    } else {
      try {
        outcome = await handler.execute(node, ctx, meta);
      } catch (err) { ... }
    }
    ```

    The `handlers.get(handlerType)` call at `engine.ts:223` is moved below the conditional check (or guarded so the missing-handler error doesn't fire for `conditional`). This is the only place where the absence of a `ConditionalHandler` becomes visible to the dispatch loop.

5. **Trim the validator's type tables.** In `src/attractor/core/graph.ts`:

    - `KNOWN_TYPES` at line 30-35 — drop `"parallel"` and `"parallel.fan_in"`. Keep `"conditional"` (still a valid authoring-time type; the engine handles it inline).
    - `UNIMPLEMENTED_TYPES` at lines 38-41 — drop the two `parallel*` entries. The set continues to cover `stack.manager_loop`.
    - `SHAPE_TO_TYPE` at line 43-49 — drop the `component: "parallel"` and `tripleoctagon: "parallel.fan_in"` entries. Keep `diamond: "conditional"` (diamond is the GraphViz shape pipelines use for branch nodes; it stays mapped because the engine's inline passthrough handles it).

6. **Drop `partial_success` from the `OutcomeStatus` union.** In `src/attractor/types.ts:1`:

    ```ts
    // before
    export type OutcomeStatus = "success" | "retry" | "fail" | "partial_success";
    // after
    export type OutcomeStatus = "success" | "retry" | "fail";
    ```

    Update the single non-test caller at `src/cli/commands/pipeline.ts:454-462` — the renderer's special-case for `partial_success` becomes unreachable and is removed:

    ```ts
    // src/cli/commands/pipeline.ts:454-462 (before)
    // Engine OutcomeStatus is "success"|"retry"|"fail"|"partial_success".
    // Map to the renderer's 3-value union.
    const status = outcome.status === "success" ? "success" as const : "fail" as const;
    emit({
      kind: "end",
      outcome: {
        status,
        reason: outcome.failureReason ?? (outcome.status === "partial_success" ? "partial success" : undefined),
      },
    });

    // after
    const status = outcome.status === "success" ? "success" as const : "fail" as const;
    emit({
      kind: "end",
      outcome: { status, reason: outcome.failureReason },
    });
    ```

7. **Drop `branchOutcomes` from `HandlerExecutionContext`.** In `src/attractor/handlers/registry.ts:21`:

    ```ts
    branchOutcomes?: Record<string, Outcome>;
    ```

    With `ParallelHandler` deleted, this field has zero readers. Remove the field; the rest of the interface stays.

Out of scope (locked by the chat-refinement on the adjacent yagni illumination + this illumination's "Things to keep in mind" tail):

- A future fan-out implementation. If parallel branches are ever required by a real pipeline, the design lands against the actual need — not as a speculative pre-built handler.
- Any `.dot` pipeline edits. Repo-wide grep confirms zero `.dot` files reference `type=parallel`, `type=parallel.fan_in`, or `type=conditional`. Diamond-shaped nodes in pipelines keep working via the SHAPE_TO_TYPE mapping + inline engine passthrough.
- Any CLI / flag / `pipeline.jsonl` schema change. `pipeline.jsonl` records `nodeKind: resolveHandlerType(node)`; the resolver is unchanged for diamond nodes.
- Any CONTEXT.md / README / ADR updates. Verified by repo-wide grep — zero references to `ConditionalHandler`, `ParallelHandler`, or `FanInHandler` in any doc surface.
- Removing the diamond → conditional shape mapping. The validator + engine still recognize `type="conditional"` as a routing-only marker; only the handler module and registry entry go.
- Engine refactor to add a "branch coordinator". The illumination/explainer phrasing ("fold into engine's branch coordinator") is forward-looking — there is no branch coordinator today; the present scope is the deletion + one-line inline passthrough.

## 3. Architecture

### 3.1 Current shape

```
src/attractor/handlers/conditional.ts                    (8 lines)
  └── class ConditionalHandler implements NodeHandler
        └── execute(_node, _ctx, _meta) → { status: "success" }    ← no-op

src/attractor/handlers/parallel.ts                       (23 lines)
  ├── class ParallelHandler implements NodeHandler
  │     └── execute → JSON.stringify(meta.branchOutcomes)            ← codec
  └── class FanInHandler implements NodeHandler
        └── execute → JSON.parse + status reduce                      ← codec + merge

src/attractor/handlers/registry.ts:21
  └── interface HandlerExecutionContext
        └── branchOutcomes?: Record<string, Outcome>                  ← only ParallelHandler reads

src/attractor/core/engine.ts                             (359 lines)
  ├── import { ConditionalHandler } from ".../conditional.js"        (line 9)
  ├── import { ParallelHandler, FanInHandler } from ".../parallel.js" (line 14)
  └── buildHandlerMap                                                (lines 49-67)
        ├── m.set("conditional", new ConditionalHandler())            (line 57)
        ├── m.set("parallel", new ParallelHandler())                  (line 62)
        └── m.set("parallel.fan_in", new FanInHandler())              (line 63)

src/attractor/core/graph.ts
  ├── KNOWN_TYPES         (lines 30-35) ← includes parallel, parallel.fan_in
  ├── UNIMPLEMENTED_TYPES (lines 38-41) ← already errors on parallel*
  └── SHAPE_TO_TYPE       (lines 43-49) ← component→parallel, tripleoctagon→parallel.fan_in

src/attractor/types.ts:1
  └── OutcomeStatus = "success" | "retry" | "fail" | "partial_success"   ← member used only by FanInHandler

src/cli/commands/pipeline.ts:454-462
  └── partial_success → "fail" + "partial success" reason mapping        ← unreachable post-delete

src/attractor/tests/handlers.test.ts:117-187
  ├── describe("ParallelHandler")  (lines 117-151)
  └── describe("FanInHandler")     (lines 153-187)
```

### 3.2 Target shape

```
src/attractor/handlers/conditional.ts                    ← deleted
src/attractor/handlers/parallel.ts                       ← deleted

src/attractor/handlers/registry.ts
  └── interface HandlerExecutionContext
        (branchOutcomes field removed)

src/attractor/core/engine.ts
  ├── (ConditionalHandler / ParallelHandler / FanInHandler imports removed)
  ├── buildHandlerMap (3 m.set calls removed; survivors unchanged)
  └── dispatch loop
        └── if (handlerType === "conditional") { outcome = { status: "success" }; }
            else { outcome = await handler.execute(node, ctx, meta); }   ← inline passthrough

src/attractor/core/graph.ts
  ├── KNOWN_TYPES         (parallel, parallel.fan_in dropped — conditional kept)
  ├── UNIMPLEMENTED_TYPES (parallel, parallel.fan_in dropped — stack.manager_loop kept)
  └── SHAPE_TO_TYPE       (component, tripleoctagon dropped — diamond → conditional kept)

src/attractor/types.ts:1
  └── OutcomeStatus = "success" | "retry" | "fail"

src/cli/commands/pipeline.ts:454-462
  └── (partial_success special-case removed; mapping simplifies)

src/attractor/tests/handlers.test.ts
  └── (describe("ParallelHandler") and describe("FanInHandler") deleted — survivors untouched)
```

### 3.3 Engine inline passthrough

The single behavioral change in `runPipeline` lives at the dispatch site. Current code at `src/attractor/core/engine.ts:222-226, 257-258`:

```ts
const handlerType = resolveHandlerType(node);
const handler = handlers.get(handlerType);
if (!handler) {
  return finalize({ status: "fail", completedNodes, context, failureReason: `No handler for type "${handlerType}"` }, opts, runId);
}
// ... meta build ...
let outcome: Outcome;
try {
  outcome = await handler.execute(node, ctx, meta);
} catch (err) { ... }
```

After:

```ts
const handlerType = resolveHandlerType(node);
let handler: NodeHandler | undefined;
if (handlerType !== "conditional") {
  handler = handlers.get(handlerType);
  if (!handler) {
    return finalize({ status: "fail", completedNodes, context, failureReason: `No handler for type "${handlerType}"` }, opts, runId);
  }
}
// ... meta build (unchanged) ...
let outcome: Outcome;
if (handlerType === "conditional") {
  outcome = { status: "success" };
} else {
  try {
    outcome = await handler!.execute(node, ctx, meta);
  } catch (err) { ... }
}
```

The conditional branch sits next to the existing `isExitNode(node)` shape-marker check at `engine.ts:167, 183` — both are routing-only short-circuits. After `outcome` is assigned, the rest of the loop body (context-update merge, traceWriter callbacks, retry handling, `selectNextEdge` / `selectFailEdge`) runs unchanged. `selectNextEdge` at `engine.ts:82-93` keeps owning conditional edge selection — that path was already independent of the handler call.

### 3.4 Validator type-table trim

`KNOWN_TYPES` (currently `graph.ts:30-35`) is the authoring-time recognition set; `UNIMPLEMENTED_TYPES` (lines 38-41) is the subset that fails validation regardless. After this change:

```ts
const KNOWN_TYPES = new Set([
  "codergen", "tool", "wait.human", "conditional",
  "start", "exit", "store",
  "ralph.implement", "ralph.meditate",
  "agent", "stack.manager_loop",
]);

const UNIMPLEMENTED_TYPES = new Set([
  "stack.manager_loop",              // no handler registered
]);

const SHAPE_TO_TYPE: Record<string, string> = {
  Mdiamond: "start", Msquare: "exit", box: "codergen",
  hexagon: "wait.human", diamond: "conditional",
  parallelogram: "tool", house: "stack.manager_loop",
  circle: "ralph.implement", octagon: "ralph.meditate",
  cylinder: "store",
};
```

`diamond` keeps its mapping because diamond-shaped nodes are routing markers and the engine's inline passthrough now serves them. `component` and `tripleoctagon` mappings drop — there are no live consumers (the parallel feature was never used).

## 4. Components & file edits

| File | Change |
|---|---|
| `src/attractor/handlers/conditional.ts` | **Deleted.** 8 lines, single class, no other importers. |
| `src/attractor/handlers/parallel.ts` | **Deleted.** 23 lines, two classes, no live consumers. |
| `src/attractor/handlers/registry.ts` | Remove `branchOutcomes?: Record<string, Outcome>;` at line 21. The rest of `HandlerExecutionContext` and the `NodeHandler` interface stay. |
| `src/attractor/core/engine.ts` | Remove imports at lines 9 and 14. Remove `m.set("conditional", ...)`, `m.set("parallel", ...)`, `m.set("parallel.fan_in", ...)` at lines 57, 62, 63 inside `buildHandlerMap`. Add the conditional passthrough at the dispatch site (lines 222-226 + 257-258, see §3.3). |
| `src/attractor/core/graph.ts` | Trim `KNOWN_TYPES` (drop `"parallel"`, `"parallel.fan_in"`). Trim `UNIMPLEMENTED_TYPES` (drop both parallel entries; keep `stack.manager_loop`). Trim `SHAPE_TO_TYPE` (drop `component` and `tripleoctagon` keys; keep `diamond`). |
| `src/attractor/types.ts` | Change `OutcomeStatus` union to `"success" \| "retry" \| "fail"` (line 1). |
| `src/cli/commands/pipeline.ts` | Simplify the `onNodeEnd` mapping at lines 454-462. Drop the `partial_success → "partial success"` reason fallback. The `success`/`fail` collapse stays (engine still emits non-success values). |
| `src/attractor/tests/handlers.test.ts` | Delete the `describe("ParallelHandler")` block (lines 117-151) and the `describe("FanInHandler")` block (lines 153-187). Remove the `import { ParallelHandler, FanInHandler } from "../handlers/parallel.js";` at line 7. Survivors (`ConditionalHandler` describe at lines 20-27 — drop this block too since the class is gone, `WaitHumanHandler`, `ToolHandler`, `Start/ExitHandler`, `ManagerLoopHandler`) untouched except as noted. |

No `.dot` pipeline edits. No CLI / MCP / agent-rubric edits. No CONTEXT.md / README / ADR edits.

## 5. Data flow

The pipeline run path is byte-identical before and after for any `.dot` graph that is currently valid. Inputs (the parsed `Graph`) and outputs (`PipelineResult.context`, `pipeline.jsonl` per-node records) keep their existing shapes — `pipeline.jsonl` records `nodeKind: resolveHandlerType(node)`, and `resolveHandlerType` is unchanged for diamond-shaped routing nodes.

Conditional nodes (diamond shape, or explicit `type="conditional"`):

- **Before:** `handlers.get("conditional").execute(node, ctx, meta)` returns `{ status: "success" }` synchronously after one async-await tick.
- **After:** the engine assigns `outcome = { status: "success" }` directly without dispatching through the handler map.

The path through `selectNextEdge` / `evaluateCondition` for outgoing conditioned edges is unchanged. The traceWriter `onNodeStart` / `onNodeEnd` callbacks fire identically — they consume `node` and `outcome`, both unchanged.

Parallel / fan-in nodes:

- **Before:** validation rejects them via `UNIMPLEMENTED_TYPES`; the engine never executes them.
- **After:** validation rejects them as unknown types — `handlerType` falls through `KNOWN_TYPES` and the existing unknown-type diagnostic fires. The error severity stays `error`; only the rule key shifts from "unimplemented" to "unknown". This is a strictly stricter recognition surface, not a looser one.

`partial_success` lifecycle:

- The `OutcomeStatus` union loses a member. No engine code constructs `partial_success` outside `FanInHandler` (verified by repo-wide grep against `src/`). The renderer mapping at `pipeline.ts:454-462` handled it as a `fail` alias; removing the alias matches the engine's actual emit set.

## 6. Blast radius / impact surface

Sourced from the verifier's `Blast radius:` paragraph and the explainer's `## Blast radius` block.

- **Size:** S
- **Files touched:** ~8 — 2 deleted handler files, 1 engine edit, 1 validator edit, 1 registry edit, 1 types edit, 1 renderer edit, 1 test-file edit. All inside the pipeline-engine surface.
- **Surfaces crossed:** pipeline engine + handler module + test suite.
  - **CLI:** unaffected — no command, flag, or help-text change.
  - **MCP / `illumination-server`:** unaffected.
  - **Pipeline engine (run path):** behaviorally identical for currently-valid graphs. Diamond-shaped routing nodes resolve to `success` via the inline passthrough — same outcome, same trace-writer events, same `pipeline.jsonl` record shape.
  - **Pipeline engine (validate path):** `parallel` and `parallel.fan_in` shift from "unimplemented" diagnostic to "unknown type" diagnostic. Both are `error` severity — no graph that previously passed validation now fails or vice versa.
  - **Agents:** unaffected — no agent rubric, prompt, or contract sees a change.
  - **`.dot` syntax:** unaffected. `type=conditional` and the `diamond` shape both keep working. `type=parallel` / `type=parallel.fan_in` / shapes `component` / `tripleoctagon` stop being recognized — verified zero `.dot` files use them in `pipelines/` or `src/cli/pipelines/`.
  - **Frontmatter shapes:** unaffected.
  - **`.ralph/` layout:** unaffected.
  - **Public exports:** `parseDot`, `resolveHandlerType`, `validateGraph`, `validateOrRaise`, `runPipeline`, `Outcome`, `OutcomeStatus` — all signatures stay stable except `OutcomeStatus`, which loses one union member. No external consumer of `OutcomeStatus` exists outside the pipeline engine + renderer (verified by repo-wide grep).
- **Breaking change:** **no.** Internal-only refactor; no public flag / schema / pipeline contract moves. `OutcomeStatus`'s drop is a tightening that no current emitter violates.
- **Spec / docs ripple checklist:**
  - [ ] No CONTEXT.md update required — zero mentions of `ConditionalHandler`, `ParallelHandler`, `FanInHandler`, `partial_success`, or `branchOutcomes`.
  - [ ] No README update required — same.
  - [ ] No ADR update required — no ADR protects per-node-type handler files; ADR-0002 explicitly applies YAGNI to engine surface.
  - [ ] Adjacent illumination `2026-05-01T0423-janitor-parallel-handler-yagni.md` overlaps with this design's parallel-deletion path; this design supersedes its action.
- **Test ripple checklist:**
  - [ ] `src/attractor/tests/handlers.test.ts` — delete `describe("ConditionalHandler")` (lines 20-27), `describe("ParallelHandler")` (lines 117-151), `describe("FanInHandler")` (lines 153-187). Remove `ConditionalHandler` and `ParallelHandler`/`FanInHandler` imports.
  - [ ] No new test file required. The 14 `pipeline-smoke-*-folder.test.ts` files under `src/cli/tests/` exercise `validateGraph` + the engine end-to-end against bundled pipelines; none of those pipelines use the deleted shapes/types, so all 14 pass unchanged.
  - [ ] No edit needed to engine integration tests — the conditional inline passthrough preserves the trace-writer callback order.

## 7. Trade-offs

### 7.1 Inline passthrough vs sentinel handler

`ConditionalHandler` could equally be replaced by a one-line `class NoOpHandler implements NodeHandler { async execute() { return { status: "success" }; } }` registered for `"conditional"`. Reasons to inline instead:

- The illumination's argument is precisely that polymorphism here is **shallow** — keeping a handler class for a node type that does no work re-creates the surface this work is removing. A sentinel class would still be in the registry, still exercised by handler-test infrastructure, and would still answer the question "what does the conditional handler do?" with "nothing." The inline passthrough makes the no-op visible at the dispatch site, where `selectNextEdge` already lives.
- The engine already special-cases `start` / `exit` markers via `isExitNode` at `engine.ts:167` (shape-based), short-circuiting before the handler dispatch. The conditional inline lands as a sibling of that pattern — routing-only markers handled inline; real-work nodes go through the registry.

### 7.2 Keep diamond → conditional shape mapping

`SHAPE_TO_TYPE.diamond = "conditional"` stays. Pipelines author conditional nodes by drawing a diamond in `.dot`; removing the mapping would force an explicit `type="conditional"` attribute on every diamond node and break authored pipelines. The cost of keeping the mapping is one entry in `KNOWN_TYPES` and one `if` clause in the engine — both cheap.

### 7.3 Drop `partial_success` instead of leaving it as documentation

The union member could be retained as a "documenting" possibility for future fan-in semantics. Reasons to drop:

- TypeScript exhaustiveness checks on `OutcomeStatus` currently force every consumer to handle `partial_success`. The renderer at `pipeline.ts:454-462` has an explicit special-case that becomes unreachable; downstream consumers (trace writer, future analytics) would all carry the dead branch.
- The illumination's structural argument is that the handler's existence implies a semantics the engine doesn't actually have. Same logic applies to the union member — declaring `partial_success` while no engine path produces it is the type-level twin of declaring a handler that does no work.
- If parallel fan-in is ever implemented, the union grows back at that point with proven semantics, against a real consumer.

### 7.4 Keep `branchOutcomes?` as `?` field for forward compat

The optional field could remain on `HandlerExecutionContext` against future fan-out work. Reasons to drop:

- Zero readers after `ParallelHandler` deletion. An optional field with no readers is documentation pretending to be code.
- The interface lives at `src/attractor/handlers/registry.ts:21`; adding the field back later is a one-line edit and TypeScript will guide the change. Forward-compat by speculation is exactly the YAGNI failure mode the project's stance objects to.

### 7.5 Don't try to "fold parallel into engine's branch coordinator"

The illumination's text and the explainer's `## What changes` paragraph both say "the encode/decode/aggregate trio folds into engine's branch coordinator." That phrasing is forward-looking — there is no branch coordinator in `engine.ts` today. Engine's main loop is strictly sequential (one node at a time, advance via `selectNextEdge`). Pulling parallel "into" a coordinator that doesn't exist would require building a fan-out subsystem against zero pipelines that need it — pure speculative generality.

The honest scope is **delete the parallel handlers**, not "fold them into engine." If a future pipeline needs parallel branches, the engine grows a real branch coordinator at that point, sized to the actual need.

### 7.6 Validation diagnostic shift for parallel types

Pre-change: `parallel` and `parallel.fan_in` produce a "type X is not yet implemented" diagnostic via `UNIMPLEMENTED_TYPES`. Post-change: same node types produce an "unknown type X" diagnostic via the existing `KNOWN_TYPES` filter. Both are `error` severity; the diagnostic message changes wording but not the validate-pass outcome. Any test asserting the exact "not yet implemented" wording would need a one-line update — verified by grep that no current test asserts on that string (the unimplemented-type message is exercised end-to-end by the pipeline-smoke suite, which checks for non-zero diagnostics, not message content).

## 8. Constraints

- All edits land in a single commit so the diff tells a single story (2 deleted handler files, 1 engine inline + 3 registry deletes, 1 validator type-table trim, 1 registry interface field drop, 1 union narrow, 1 renderer simplification, 1 test-file partial delete).
- `npx tsc --noEmit` must pass after the change. The narrowed `OutcomeStatus` union forces the renderer's `partial_success` branch removal — TypeScript exhaustiveness guides the edit. `branchOutcomes`'s removal from `HandlerExecutionContext` has zero non-test consumers.
- `npx vitest run` must pass with no edits to the 14 `pipeline-smoke-*-folder.test.ts` files. The 3 deleted handler-test blocks are the only test surface that disappears.
- `pipeline.jsonl` byte-equivalence (modulo timestamps + nondeterministic IDs) for any pre-change valid graph. Diamond-shaped routing nodes record `nodeKind: "conditional"` before and after; the inline passthrough does not change `resolveHandlerType`.
- Diagnostic strings on existing rules (`reaches_exit`, `variable_coverage`, `script_command_conflict`, etc.) stay byte-identical. Any wording change indicates accidental coupling and must be reverted before merge.
- The "unknown type" / "unimplemented type" wording shift for `parallel` / `parallel.fan_in` is acceptable (no pipeline-smoke test asserts on either string); if a follow-up reviewer wants the wording stable, the fix is a one-line message tweak in the validator's unknown-type emission.

## 9. Open questions

None at design-doc time. All three rubric criteria (still-relevant / technically-accurate / project-fit) pass per the verifier's evidence; the explainer's before/after framing is honored except for the "fold into engine's branch coordinator" phrasing — sharpened in §7.5 to "delete and let any future fan-out land against real need."

The reviewer loop may surface nits on:

- Whether `diamond` should keep mapping to `"conditional"` or be promoted to a first-class authoring-time concept (e.g. rename to `"branch"` or fold into the start-marker bucket). Out-of-scope of the deletion question, but raised here for transparency.
- Whether the inline conditional passthrough belongs at the dispatch site (`engine.ts:222-258`) or as a sibling marker check next to `isExitNode` at `engine.ts:167-220` (shape-based short-circuit before handler resolution). Functionally identical; the dispatch-site placement is closer to the `selectNextEdge` call that owns the actual routing decision.
- Whether `partial_success` should be retained for one release cycle as a deprecated alias before being removed. Cosmetic; the project's stance is direct deletion when the producer goes.

## 10. Verification approach

### 10.1 Static checks

Run after the change, in order:

- `npx tsc --noEmit` — clean. The narrowed union forces the renderer edit; no other type sites narrow.
- Repo-wide grep for `class ConditionalHandler\b` — expected: zero hits (file deleted).
- Repo-wide grep for `class ParallelHandler\b\|class FanInHandler\b` — expected: zero hits (file deleted).
- Repo-wide grep for `from ".*handlers/conditional"` and `from ".*handlers/parallel"` — expected: zero hits (only `engine.ts` and `handlers.test.ts` imported them, both updated).
- Repo-wide grep for `partial_success` — expected: zero hits in `src/` (the renderer special-case is gone; no other consumer).
- Repo-wide grep for `branchOutcomes` — expected: zero hits in `src/` (interface field removed; only handler-test fixtures referenced it, deleted alongside the handler tests).
- Positive-existence grep for `handlerType === "conditional"` — expected: at least 1 hit (the new inline passthrough at `engine.ts`).

### 10.2 Tests

- `npx vitest run src/attractor/tests/handlers.test.ts` — passes after the three `describe` deletions. Survivors (`StartHandler`/`ExitHandler`, `WaitHumanHandler`, `ToolHandler`, `ManagerLoopHandler`) are untouched.
- `npx vitest run src/cli/tests/pipeline-smoke-*-folder.test.ts` — all 14 files pass. They exercise `validateGraph` + engine end-to-end against bundled per-folder pipelines; behavior is unchanged for currently-valid graphs.
- `npx vitest run` — entire suite passes.

### 10.3 Smoke

- `ralph pipeline validate <bundled-pipeline>` against each of the 14 bundled per-folder pipelines under `src/cli/pipelines/` — expected: identical diagnostic output before and after. None of the bundled pipelines use `component` / `tripleoctagon` shapes or `type=parallel*` (verified by manual spot-check of `src/cli/pipelines/**/*.dot`).
- `ralph pipeline run <bundled-pipeline>` against the bundled `implement` pipeline (which contains diamond-shaped routing nodes) — expected: identical exit code and `pipeline.jsonl` content (modulo timestamps + nondeterministic IDs).
- Hash-diff of `pipeline.jsonl` traces from a known-good `implement` run pre-change vs post-change — equal.
- `npm run build` — `tsup` produces the same `dist/` shape minus two emitted files (`dist/.../handlers/conditional.js`, `dist/.../handlers/parallel.js`). No new bin entries, no removed bin entries.

### 10.4 Negative cases

- A pipeline authored with `type=parallel` or `type=parallel.fan_in` after this change — expected: validator emits an "unknown type" `error` diagnostic with the existing message format. Authoring those types remains rejected; only the rule name / wording shifts.
- A pipeline authored with a `component`- or `tripleoctagon`-shaped node — expected: `resolveHandlerType` falls through to `"codergen"` (the `node.shape && SHAPE_TO_TYPE[node.shape]` guard fails, default branch fires). The validator's `KNOWN_TYPES` set still contains `"codergen"`, so this becomes a `codergen`-type node. This is a behavior shift compared to pre-change (where it would have been a parallel-handler-type node) — but no pipeline uses these shapes, so the shift is observable only to a hypothetical author. Acceptable; flagged here for transparency.

## 11. Summary

`src/attractor/handlers/conditional.ts` (8 lines) and `src/attractor/handlers/parallel.ts` (23 lines) are deleted. The conditional no-op (formerly `ConditionalHandler.execute()`) folds into a one-line passthrough at the engine's dispatch site (`src/attractor/core/engine.ts:222-258`), sibling to the existing `isExitNode` shape-marker check. The parallel pair is pure deletion — the feature was never implemented end-to-end (engine has no fan-out coordinator; `meta.branchOutcomes` is populated only by handler-test fixtures), and the existing `UNIMPLEMENTED_TYPES` guard at `graph.ts:38-41` already rejected those types in validation. Three `m.set` calls + three imports drop from `engine.ts`. Validator type tables (`KNOWN_TYPES`, `UNIMPLEMENTED_TYPES`, `SHAPE_TO_TYPE` at `graph.ts:30-49`) shed entries for the dropped types and shapes; `diamond → conditional` stays so authored diamond nodes keep routing through the engine inline passthrough. `OutcomeStatus` (`src/attractor/types.ts:1`) narrows from 4 members to 3 — `partial_success` had a single producer (`FanInHandler`) and a single non-test consumer (renderer at `src/cli/commands/pipeline.ts:454-462`), both removed in this change. `HandlerExecutionContext.branchOutcomes` (`registry.ts:21`) drops along with its sole reader. The 14 `pipeline-smoke-*-folder.test.ts` files run unchanged; `handlers.test.ts` loses three `describe` blocks (`ConditionalHandler` lines 20-27, `ParallelHandler` lines 117-151, `FanInHandler` lines 153-187). No `.dot` pipeline edits, no CLI / flag / `pipeline.jsonl` schema changes, no CONTEXT.md / README / ADR updates. Public exports — `parseDot`, `resolveHandlerType`, `validateGraph`, `runPipeline` — keep their signatures. Net code direction is reduction: shallow-handler rot collapses into the dispatch site that already owned the routing decision, and a dead union member follows its dead producer to the bin.
