# Design: Janitor — Forward-Adjacency Primitive + `GraphTraversal` Deep Module

**Date:** 2026-05-04
**Status:** draft (pending review)
**Originating illumination:** `.ralph/meditations/illuminations/2026-05-01T0120-janitor-graph-validator-bloat.md`

## 1. Motivation

The validator core (`src/attractor/core/graph.ts`) has accreted three near-identical forward-adjacency builders and three non-trivial helpers nested inside `validateGraph` as closures. The illumination flagged this under the bloat / KISS lens; during the chat refinement the user re-framed it under the deep-modules lens (Pocock / Ousterhout: smaller interface, more implementation hidden) and removed the original "extract a 10th `checkVariableCoverage` sibling" idea on the grounds that it would replicate the existing shallow-module pattern. Two structural fixes survive the refinement:

1. **One adjacency builder, three callers.** Three sites construct `Map<string, string[]>` from `graph.edges` — and they have already drifted. From `src/attractor/core/graph.ts:172-176` (inside `validateGraph`):

    ```ts
    const adj = new Map<string, string[]>();
    for (const n of nodes.keys()) adj.set(n, []);
    for (const e of edges) {
      if (adj.has(e.from)) adj.get(e.from)!.push(e.to);
    }
    ```

    From `src/attractor/core/graph.ts:826-839` (inside `isProducerOnEveryPath`, which the verifier originally cited at lines 835-838 — module has slid by ~10 lines):

    ```ts
    const fwd = new Map<string, string[]>();
    for (const id of graph.nodes.keys()) fwd.set(id, []);
    for (const e of graph.edges) {
      if (fwd.has(e.from) && fwd.has(e.to)) fwd.get(e.from)!.push(e.to);
    }
    ```

    From `src/attractor/core/flow-analyzer.ts:52-58` (inside `computeScope`, originally cited at 42-54 — minor drift):

    ```ts
    for (const e of edges) {
      if (fwd.has(e.from) && fwd.has(e.to)) {
        fwd.get(e.from)!.push(e.to);
        rev.get(e.to)!.push(e.from);
      }
    }
    ```

    The first guard differs (`adj.has(e.from)` vs `fwd.has(e.from) && fwd.has(e.to)`) — the divergence the illumination predicted is already on the page. Adding a `disabled` flag or a self-loop policy to edges today would silently land in only one of the three sites.

2. **Three closures, no test reach.** Inside `validateGraph` at `src/attractor/core/graph.ts:219`, `:225`, `:242`:

    ```ts
    function hasDefault(node: Node, varName: string): boolean { ... }
    function reachableWithout(source, target, excluded): boolean { ... }
    function findQualifiedProducer(consumerId): string | undefined { ... }
    ```

    They are mutually recursive (`findQualifiedProducer` → `reachableWithout`) and capture `adj` and `nodes` lexically. No test in the suite can reach them — the only coverage is end-to-end through the `variable_coverage` cases in `src/attractor/tests/graph.test.ts`. Naked module-level promotion would force 5+ parameter signatures (the captured `adj`, `nodes`, plus mutual recursion) — that is precisely the shallow shape the chat refinement rejected.

The chosen structure under the deep-modules lens is: **one shared primitive** (`buildForwardAdj`) for the recipe, **one deep module** (`GraphTraversal`) for the closure cluster, with the captured state hidden behind a small `hasDefault` / `reachable` / `findQualifiedProducer` interface. The variable_coverage block stays inline in `validateGraph`; no 10th sibling is created.

This is plumbing-under-the-floor: the user-visible surface — CLI, MCP, agents, pipelines, `.ralph/` layout, frontmatter shapes, public exports — does not change.

## 2. Decision Summary

1. **Add one export to `src/attractor/core/dot-common.ts`:**

    ```ts
    export function buildForwardAdj(graph: Graph): Map<string, string[]>
    ```

    Behavior: returns a `Map<string, string[]>` keyed by every node id, with the strict guard `fwd.has(e.from) && fwd.has(e.to)` (the safer of the two existing variants — see §7.1).

2. **Route three call sites through it:**
    - `validateGraph` at `src/attractor/core/graph.ts:172-176` — replace inline builder with `const adj = buildForwardAdj(graph);`. Behavior widens by one guard clause (`fwd.has(e.to)`), which is a no-op because edges referencing non-node ids are already filtered out at parse time — verified below in §7.1.
    - `isProducerOnEveryPath` at `src/attractor/core/graph.ts:826-839` — replace inline builder with `const fwd = buildForwardAdj(graph);`. Strict guard preserved verbatim.
    - `flow-analyzer.computeScope` at `src/attractor/core/flow-analyzer.ts:52-58` — replace the `fwd` half with `const fwd = buildForwardAdj(graph);`. The `rev` (reverse) map is constructed separately in the same loop today; that half is **not** consolidated in this design (a `buildReverseAdj` could land later if the need crystallizes — out of scope).

3. **Bundle the three closures into a `GraphTraversal` deep module.** A factory function `createGraphTraversal(graph, adj, resolveHandlerType)` returns an object exposing only:

    ```ts
    interface GraphTraversal {
      hasDefault(node: Node, varName: string): boolean;
      reachable(source: string, target: string, excluded: Set<string>): boolean;
      findQualifiedProducer(consumerId: string): string | undefined;
    }
    ```

    `adj`, `nodes`, and `resolveHandlerType` are captured in the closure created by the factory — invisible to callers. The mutual recursion (`findQualifiedProducer` → `reachable`) is contained inside the module. The renaming `reachableWithout` → `reachable` reflects that "exclusion set" is now a parameter of a method on a graph-traversal object, not a property of a free function name.

4. **Variable_coverage block stays inline in `validateGraph`.** The diagnostic strings at `src/attractor/core/graph.ts:301-314` are byte-identical before and after. The block now calls `traversal.hasDefault(...)` / `traversal.reachable(...)` / `traversal.findQualifiedProducer(...)` instead of free-function names.

5. **No new test files.** The 17 `variable_coverage` cases in `src/attractor/tests/graph.test.ts` exercise `validateGraph` end-to-end and remain unchanged. `src/attractor/tests/dot-common.test.ts` extends naturally with one or two `buildForwardAdj` cases (a positive shape check + an edge-with-missing-node skip case). Direct-helper unit tests on `GraphTraversal` are optional polish, deferred per the chat refinement.

Out of scope (locked by the chat refinement):

- A 10th sibling `checkVariableCoverage` extraction. Rejected because adding one more 3-4 param `check*` function replicates the existing shallow-module pattern across nine siblings.
- A `buildReverseAdj` helper or a unified `buildAdj(graph): { fwd, rev }`. The reverse-adjacency need exists in only one place (`flow-analyzer.computeScope`); a single shared primitive there would not pay for itself.
- Un-extracting the existing nine `check*` siblings into a `GraphValidator` class. Future janitor pass; flagged for transparency, not pulled into this plan.
- Any user-visible surface change. CLI, MCP, agents, pipelines, `.ralph/` layout, frontmatter shapes, public exports of `parseDot` / `resolveHandlerType` / `validateGraph` / `validateOrRaise` all unchanged.

## 3. Architecture

### 3.1 Current shape

```
src/attractor/core/dot-common.ts
  ├── toCamel              (line 4, exported)
  ├── coerceValue          (line 9)
  ├── unescapeDotString    (line 18)
  ├── parseStylesheet      (line 32)
  ├── applyStylesheet      (line 57)
  └── parseInputsAttr      (line 76)
  (no buildForwardAdj — verified by repo-wide grep)

src/attractor/core/graph.ts
  └── validateGraph        (line 66, exported)
        ├── inline forward-adjacency builder  (line 172-176)         ← copy A
        ├── nested function hasDefault         (line 219)             ← closure
        ├── nested function reachableWithout   (line 225)             ← closure
        ├── nested function findQualifiedProducer (line 242)          ← closure
        └── variable_coverage block (uses adj + closures, line ~248-315)

src/attractor/core/graph.ts
  └── isProducerOnEveryPath (line 826)
        └── inline forward-adjacency builder  (line 835-839)         ← copy B (stricter guard)

src/attractor/core/flow-analyzer.ts
  └── computeScope          (line ~44, internal)
        └── inline fwd + rev adjacency loop   (line 52-58)            ← copy C (stricter guard, also builds rev)
```

Three drifted copies of the adjacency recipe; three closures with no test reach.

### 3.2 Target shape

```
src/attractor/core/dot-common.ts
  ├── toCamel              (unchanged)
  ├── coerceValue          (unchanged)
  ├── unescapeDotString    (unchanged)
  ├── parseStylesheet      (unchanged)
  ├── applyStylesheet      (unchanged)
  ├── parseInputsAttr      (unchanged)
  └── buildForwardAdj      ← new export, single source of truth

src/attractor/core/graph.ts
  ├── import { ..., buildForwardAdj } from "./dot-common.js"         ← import widened
  ├── createGraphTraversal(graph, adj, resolveHandlerType)            ← new module-level factory
  │     └── returns { hasDefault, reachable, findQualifiedProducer }
  └── validateGraph
        ├── const adj = buildForwardAdj(graph);                       ← shared primitive
        ├── const traversal = createGraphTraversal(graph, adj, resolveHandlerType);
        └── variable_coverage block (calls traversal.*; diags byte-identical)

src/attractor/core/graph.ts
  └── isProducerOnEveryPath
        └── const fwd = buildForwardAdj(graph);                       ← shared primitive

src/attractor/core/flow-analyzer.ts
  ├── import { buildForwardAdj } from "./dot-common.js"
  └── computeScope
        ├── const fwd = buildForwardAdj(graph);                       ← shared primitive
        └── inline rev loop (unchanged — only one site needs reverse)
```

One source of truth for the adjacency recipe; the three closures live behind a narrow named door with their captured state hidden.

### 3.3 `GraphTraversal` interface

```ts
// Module-level, exported from graph.ts only if a test wants to reach it.
// Captured state: adj, graph.nodes, resolveHandlerType. Invisible to callers.
function createGraphTraversal(
  graph: Graph,
  adj: Map<string, string[]>,
  resolveHandlerType: (node: Node) => string,
): GraphTraversal {
  const { nodes } = graph;

  function hasDefault(node: Node, varName: string): boolean {
    const key = toCamel("default_" + varName);
    return node[key] !== undefined;
  }

  function reachable(source: string, target: string, excluded: Set<string>): boolean {
    if (source === target) return true;
    const visited = new Set<string>();
    const queue = [source];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (visited.has(cur)) continue;
      visited.add(cur);
      if (cur === target) return true;
      for (const next of (adj.get(cur) ?? [])) {
        if (!excluded.has(next)) queue.push(next);
      }
    }
    return false;
  }

  function findQualifiedProducer(consumerId: string): string | undefined {
    for (const [id, node] of nodes) {
      if (id === consumerId) continue;
      if (resolveHandlerType(node) !== "tool") continue;
      if (!node.producesFromStdout) continue;
      if (!reachable(id, consumerId, new Set())) continue;
      return id;
    }
    return undefined;
  }

  return { hasDefault, reachable, findQualifiedProducer };
}
```

Body is a near-1:1 lift of the existing closures with the rename `reachableWithout` → `reachable` and the captured-state move from validateGraph's lexical scope into the factory's lexical scope. No semantics change.

### 3.4 `buildForwardAdj` shape

```ts
// dot-common.ts addition
import type { Graph } from "../types.js";

export function buildForwardAdj(graph: Graph): Map<string, string[]> {
  const fwd = new Map<string, string[]>();
  for (const id of graph.nodes.keys()) fwd.set(id, []);
  for (const e of graph.edges) {
    if (fwd.has(e.from) && fwd.has(e.to)) fwd.get(e.from)!.push(e.to);
  }
  return fwd;
}
```

Strict guard chosen — see §7.1 for why this is safe at the previously-loose `validateGraph` site.

## 4. Components & file edits

| File | Change |
|---|---|
| `src/attractor/core/dot-common.ts` | Add `import type { Graph } from "../types.js";` if not present, plus `export function buildForwardAdj(graph: Graph): Map<string, string[]>` at the bottom (after `parseInputsAttr`). |
| `src/attractor/core/graph.ts` | Add `buildForwardAdj` to existing `import { toCamel } from "./dot-common.js"`. Add module-level `createGraphTraversal` factory. Replace inline adjacency builder at lines 172-176 with `const adj = buildForwardAdj(graph);`. Replace inline adjacency builder at lines 835-839 (current) inside `isProducerOnEveryPath` with `const fwd = buildForwardAdj(graph);`. Delete the three nested functions at lines 219 / 225 / 242 and instantiate `const traversal = createGraphTraversal(graph, adj, resolveHandlerType);` once before the variable_coverage loop. Rewrite the three call sites inside the variable_coverage loop to call `traversal.hasDefault(...)` / `traversal.reachable(...)` / `traversal.findQualifiedProducer(...)`. Diagnostic strings at lines 301-314 stay byte-identical. |
| `src/attractor/core/flow-analyzer.ts` | Add `import { buildForwardAdj } from "./dot-common.js"`. Replace the `fwd` half of the adjacency loop in `computeScope` (lines 52-58) with `const fwd = buildForwardAdj(graph);`. Keep the `rev` half inline. |
| `src/attractor/tests/dot-common.test.ts` | Append two cases for `buildForwardAdj` — one positive shape check (`{ a→b, b→c }` returns `Map([[a,[b]],[b,[c]],[c,[]]])`), one defensive case (edge with missing endpoint id is silently skipped). |

No other file touched. No file renamed or deleted. No new file created.

## 5. Data flow

The validator's diagnostic pipeline is unchanged. Inputs (the parsed `Graph`) and outputs (the `Diagnostic[]` list) keep their existing shapes. The change happens entirely inside the construction of two intermediate values used by `validateGraph` — `adj` and the cluster of three reachability helpers — and propagates through their existing call sites.

`pipeline run` data flow is byte-identical before and after. No node attribute is added, removed, or renamed; no expansion semantics change; no error code or message at runtime is affected; `flow-analyzer.computeScope` returns the same `Map<string, Set<string>>` from the same input it received before.

## 6. Blast radius / impact surface

Sourced from the verifier's `Blast radius:` paragraph and the explainer's `## Blast radius` block.

- **Size:** S
- **Files touched:** 3 source + 1 test. `src/attractor/core/dot-common.ts` (one append), `src/attractor/core/graph.ts` (factory + 3 call sites + 3 closure deletions), `src/attractor/core/flow-analyzer.ts` (one line swap), `src/attractor/tests/dot-common.test.ts` (two appended cases).
- **Surfaces crossed:** validator core + shared graph primitive only.
  - **CLI:** unaffected — no command, flag, or help text changes.
  - **MCP / `illumination-server`:** unaffected — no surface touched.
  - **Pipeline engine (run path):** unaffected — `computeScope` keeps its public shape and behavior; `flow-analyzer.computeVarsInScope` / `computeVarsInAnyScope` (the only exports of `flow-analyzer.ts` consumed elsewhere) are not touched.
  - **Pipeline engine (validate path):** behaviorally identical. Same diagnostics, same byte-identical messages at `graph.ts:301-314`. Internal call shape changes only.
  - **Agents:** unaffected — no agent rubric, prompt, or contract sees a change.
  - **Pipeline schema / `.dot` syntax:** unaffected.
  - **`.ralph/` layout, frontmatter shapes:** unaffected.
  - **Public exports:** `parseDot` (33 importers), `resolveHandlerType` (4 importers), `validateGraph` (33 importers across `src/cli/tests/`), `validateOrRaise` (1 importer) — all signatures unchanged. The three nested closures have zero external imports, verified safe to delete. `buildForwardAdj` is a new export with no prior name collision (zero repo-wide hits before this change).
- **Breaking change:** no.
- **Spec / docs ripple checklist:**
  - [ ] No ADR update required — ADR-0003 (`0003-scenario-tests-in-implement-pipeline.md`) cites only `checkRequiredCallerVars` at `graph.ts:757-787`, which the revised scope does not touch. ADR-0004 (source-as-truth) explicitly endorses internal restructuring.
  - [ ] No README update required.
  - [ ] No CONTEXT.md update required — the Janitor section at `CONTEXT.md:180-197` already names "scheduled scans for bloat" as the lens; this work is an instance, not a change.
- **Test ripple checklist:**
  - [ ] `src/attractor/tests/graph.test.ts` — no edits. The 17 `variable_coverage` cases (file opens around line 544) exercise `validateGraph` end-to-end and continue to pass unchanged.
  - [ ] `src/attractor/tests/graph-validator-outputs.test.ts`, `graph-required-caller-vars.test.ts`, `graph-outputs-*.test.ts` — no edits, no behavior change.
  - [ ] 14 `pipeline-smoke-*-folder.test.ts` files under `src/cli/tests/` — no edits, no behavior change. They all import `validateGraph` from `../../attractor/core/graph.js` and assert zero error-level diagnostics on bundled pipelines.
  - [ ] `src/attractor/tests/dot-common.test.ts` — two appended cases for `buildForwardAdj`.
  - [ ] No new test file required.

## 7. Trade-offs

### 7.1 Strict guard at the validateGraph site

The current `validateGraph` adjacency builder uses the loose guard `if (adj.has(e.from)) adj.get(e.from)!.push(e.to);` while the other two sites use the strict guard `if (fwd.has(e.from) && fwd.has(e.to)) fwd.get(e.from)!.push(e.to);`. `buildForwardAdj` adopts the strict guard.

**Chose strict because:**

- Edges with one endpoint missing should not appear in the graph after parse — `parseDotV2` populates `graph.nodes` from every node id seen in node statements *or* edge endpoints, so `e.to` not being in `nodes.keys()` would already be a parser invariant violation.
- Of the two existing variants, the strict one is the safer default — it cannot push a value that points to a non-node id. The loose variant could, in principle, allow `adj.get(e.from)!.push("orphan-id")`, which would then be silently consumed by BFS and never reach a real successor.
- The behavioral difference at `validateGraph` is only observable if a parser regression introduces an edge with a missing endpoint. Today no such case exists in the test corpus, and the strict-guard behavior is what `isProducerOnEveryPath` and `computeScope` already do — so unifying on strict converges existing siblings rather than diverging from them.

If a user-authored pipeline ever produced an edge with a missing endpoint, the strict guard would suppress the orphan from the adjacency map; the orphan node would still be reported by the existing `reachability` rule in `validateGraph` (lines 84-94). Net signal to the user is unchanged.

### 7.2 Bundling vs naked promotion of the three closures

The brainstorm refinement explicitly chose bundling. Naked module-level promotion would force these signatures:

```ts
function reachableWithout(adj: Map<string, string[]>, source: string, target: string, excluded: Set<string>): boolean
function findQualifiedProducer(graph: Graph, adj: Map<string, string[]>, resolveHandlerType: ..., consumerId: string): string | undefined
```

That is the shallow shape the user rejected — every caller would have to thread `adj` and `resolveHandlerType` through their own scope, replicating the captured-state plumbing at every call site. The factory pattern hides those parameters once at construction and exposes a 1-2 argument method surface to callers. That is the deepening criterion (smaller interface, more implementation hidden), not Clean-Code SRP decomposition.

### 7.3 Skip `buildReverseAdj` for now

`flow-analyzer.computeScope` is the only site that builds a reverse adjacency map. Consolidating reverse adjacency into `dot-common.ts` would add an export with one consumer — premature. Left for a future janitor pass if a second consumer ever appears.

### 7.4 Variable_coverage stays inline (no 10th sibling)

The original illumination's Finding 1 proposed a `checkVariableCoverage(graph, nodeProduces, dotDir, diags)` extraction matching the nine existing `check*` siblings. The chat refinement rejected this on the grounds that an audit of the existing siblings showed an avg 52-line, uniform 3-4 param shallow signature — adding a 10th replicates the pattern instead of fixing it. The rationale (per chat_summarizer): "User wants deepening, not Clean-Code SRP decomposition." The variable_coverage block stays in `validateGraph`, calls the `traversal` object instead of free closures, and remains the longest block in the function — that is acceptable under deep-modules; it would not be acceptable under the original KISS-by-extraction lens.

A future, separate janitor pass could un-extract the nine existing siblings into a `GraphValidator` class holding `dotDir` + `graph` + `diags` as state, which would re-bundle by domain. **Out of scope for this design**; flagged for transparency only.

## 8. Constraints

- All edits land in a single commit so the diff tells a single story (one new export, three call-site swaps, three closure deletions, one factory addition, two appended test cases).
- `npx tsc --noEmit` must pass after the change. The factory pattern preserves all existing types; `buildForwardAdj` reuses the `Map<string, string[]>` shape already in scope at all three sites.
- `npx vitest run` must pass with no edits to the existing 17 `variable_coverage` cases or the 14 pipeline-smoke folder tests. The two appended `dot-common` cases lock the `buildForwardAdj` shape.
- Diagnostic strings at `src/attractor/core/graph.ts:301-314` remain byte-identical. Any wording change indicates accidental coupling and must be reverted before merge.
- `parseDot` / `resolveHandlerType` / `validateGraph` / `validateOrRaise` signatures stay verbatim. Any change to the public surface indicates accidental coupling and must be reverted before merge.

## 9. Open questions

None at design-doc time. All three rubric criteria pass under the revised scope (see verifier explanation in the originating context); the chat-refinement log is fully consumed by §2 / §6. The reviewer loop may surface nits on factory placement (graph.ts vs a new file), the rename `reachableWithout` → `reachable`, or the choice to skip `buildReverseAdj` — those will be resolved in-loop or surfaced to the user.

One transparency note (not a question): the existing nine sibling `check*` functions are themselves shallow under the deep-modules lens. Out of scope for this triage; deferred to a future janitor pass that would re-bundle them by domain.

## 10. Verification approach

### 10.1 Static checks

Run after the change, in order:

- `npx tsc --noEmit` — expected: clean. The new `buildForwardAdj` export resolves at the three import sites; the factory typedef is local to graph.ts and has no external surface.
- Repo-wide grep for `new Map<string, string[]>()` inside `src/attractor/core/graph.ts` — expected: zero hits inside function bodies that build forward adjacency from edges (call sites now use `buildForwardAdj`). Other unrelated `Map<string, string[]>` constructions (e.g. for `nodeProduces` or future inverted indices) may legitimately remain.
- Repo-wide grep for `new Map<string, string[]>()` inside `src/attractor/core/flow-analyzer.ts` — expected: one hit (the `rev` map, which is not consolidated).
- Positive-existence grep for `buildForwardAdj` — expected: at least four hits (one definition + three call sites + new test cases).
- Repo-wide grep for `function hasDefault\\b`, `function reachableWithout\\b`, `function findQualifiedProducer\\b` — expected: zero hits inside `validateGraph`. The factory replaces all three.

### 10.2 Tests

- `npx vitest run src/attractor/tests/graph.test.ts` — full file passes, all 17 `variable_coverage` cases unchanged.
- `npx vitest run src/attractor/tests/dot-common.test.ts` — full file passes, including the two new `buildForwardAdj` cases.
- `npx vitest run` — entire suite passes, including the 14 `pipeline-smoke-*-folder.test.ts` files that exercise `validateGraph` against bundled pipelines.

### 10.3 Smoke

- `ralph pipeline validate <bundled-pipeline>` against any of the per-folder bundled pipelines under `src/cli/pipelines/` — expected: identical diagnostic output before and after. (Behavioral test of byte-identical messages.)
- `ralph pipeline run <bundled-pipeline>` against a known-good pipeline — expected: identical exit code and output. (Behavioral test that flow-analyzer scope computation is unchanged.)
- `npm run build` — `tsup` produces the same `dist/` shape as before. No new entry, no removed entry.

## 11. Summary

Three duplicated forward-adjacency builders in `src/attractor/core/graph.ts:172-176`, `:826-839`, and `src/attractor/core/flow-analyzer.ts:52-58` are replaced by a single new export `buildForwardAdj(graph)` in `src/attractor/core/dot-common.ts`. Three nested closures inside `validateGraph` (`hasDefault` at line 219, `reachableWithout` at line 225, `findQualifiedProducer` at line 242) are bundled into a `GraphTraversal` deep module via a `createGraphTraversal(graph, adj, resolveHandlerType)` factory that hides `adj` / `nodes` / `resolveHandlerType` as captured state behind a narrow `{ hasDefault, reachable, findQualifiedProducer }` interface. The variable_coverage block stays inline in `validateGraph`; its diagnostic strings at lines 301-314 remain byte-identical. Public exports of `parseDot`, `resolveHandlerType`, `validateGraph`, `validateOrRaise` are unchanged, as are agent contracts, pipeline schemas, the `.ralph/` layout, and the CLI surface. Two appended cases in `src/attractor/tests/dot-common.test.ts` lock the `buildForwardAdj` shape; no other test changes. Net code direction is reduction — three drifted recipe copies and three buried closures collapse into one shared primitive and one named module.
