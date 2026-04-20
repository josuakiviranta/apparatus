# DOT Parser AST Migration — Design

**Date:** 2026-04-20
**Status:** Approved for implementation (probe green, dep installed)

## Problem

`parseDot()` in `src/attractor/core/graph.ts:116-223` is a regex-driven string-mutation chain:

1. `stripComments` removes `//` and `/* */`
2. `flattenSubgraphs` inlines subgraph bodies
3. Collapses multi-line `[ ]` attribute blocks
4. Collapses multi-line quoted values
5. Splits on `\n`, matches each line with a regex

After all these transforms source positions are detached from original lines. Adding **file:line to schema_error diagnostics** (authoring-time ergonomics) is blocked by this design.

Secondary pain: the regex chain is fragile — every new loose-syntax feature we accept is a new edge case. 968 tests exist precisely because each regex boundary has its own bugs.

## Goal

Replace the regex parser with an AST-based one so that:

1. Every `Node` carries `sourceLine: number` (line in original `.dot` file).
2. Every **attribute** can be located to `line:column`, enabling per-attr pinpoint in `schema_error` (e.g. `pipelines/foo.dot:17:18` on the exact offending attr).
3. Zero behavior change for the 19 existing pipelines — all `parseDot(src)` outputs remain semantically equivalent before and after.
4. Future tooling (AST-based `refine`, formatter, round-trip edit) has a real parser foundation.

## Non-goals

- Changing the `Graph` / `Node` / `Edge` public API shape (other than adding optional `sourceLine`).
- Reformatting / rewriting existing `.dot` files.
- Exposing AST outside of `parseDot` internals — callers keep getting `Graph`.
- Building a `ralph pipeline schema` command (separate follow-up).

## Evidence gathered (2026-04-20 probe)

- `@ts-graphviz/ast ^3.0.6` — MIT, zero transitive deps, 468 KB installed.
- **All 19 ralph pipelines parse clean** (`pipelines/*.dot` + `pipelines/smoke/*.dot`).
- AST exposes `location: {start, end}` with `{offset, line, column}` on every node type including `Attribute` children.
- Library keeps escape sequences raw (`\n` stays as literal `\n`) — we continue using our existing `unescapeDotString` helper.
- AST shape we care about:
  - `Dot` (root) → `children: [Graph]`
  - `Graph` → `id.value`, `children: (Attribute | AttributeList | Node | Edge | Subgraph)[]`
  - `Attribute` → `key.value`, `value.value`, `value.quoted`, `location`
  - `AttributeList` → `kind: "Node" | "Edge" | "Graph"`, `children: Attribute[]` (for `node [...]` / `edge [...]` / `graph [...]` defaults)
  - `Node` → `id.value`, `children: Attribute[]`, `location`
  - `Edge` → `targets: NodeRef[]`, `children: Attribute[]`, `location` (chained edges expand into sequential targets)
  - `NodeRef` → `id.value`
  - `Subgraph` → `id?.value`, `children: same union` (recursive)

## Architecture

### New module: `src/attractor/core/graph-ast.ts`

Single responsibility: take DOT source → produce `Graph` + attach source positions.

```
parseDotV2(src: string): Graph
    │
    ├─► parseAST(src)          // @ts-graphviz/ast
    ├─► walkGraph(ast)         // recursive descent:
    │     ├── graph-level attrs (goal, inputs, modelStylesheet, …)
    │     ├── AttributeList{kind:Node}  → accumulate nodeDefaults
    │     ├── AttributeList{kind:Edge}  → accumulate edgeDefaults
    │     ├── AttributeList{kind:Graph} → merge into graphAttrs
    │     ├── Node   → build Node, apply nodeDefaults, record sourceLine
    │     ├── Edge   → expand targets pairwise, apply edgeDefaults
    │     └── Subgraph → recurse; subgraph-local defaults shadow outer
    ├─► applyStylesheet(nodes, rules)  // reused from graph.ts
    └─► return { name, goal, nodes, edges, inputs, … }
```

### Shared helpers extracted to `src/attractor/core/dot-common.ts`

Both parsers need these:
- `toCamel(s: string)` — snake_case → camelCase
- `coerceValue(val: string)` — `"true"` → `true`, numeric strings → `Number`
- `unescapeDotString(s: string)` — DOT escape sequences
- `parseStylesheet(css: string)`, `applyStylesheet(node, rules)` — already pure
- `parseInputsAttr(raw)` — graph-level `inputs=` comma-split

Extract verbatim, keep existing `graph.ts` importing them so the old parser continues to work during dual-run.

### Type change: `src/attractor/types.ts`

```ts
export interface Node {
  id: string;
  // … existing fields …
  /** 1-based line in the original .dot file where this node was declared. */
  sourceLine?: number;
  [key: string]: unknown;
}
```

Optional field; legacy callers (tests, serialised checkpoints) unaffected.

### Dual-run safety net (interim commit)

`parseDot` stays in place during migration. New file `src/attractor/tests/dual-parser.test.ts` runs every `pipelines/**/*.dot` through both parsers and deep-asserts semantic equivalence (ignoring `sourceLine`). Red = blocker for migration; green = safe to flip.

After one clean release cycle, `parseDot` in `graph.ts` becomes a thin shim `export const parseDot = parseDotV2;` and the regex machinery is deleted.

## Equivalence definition (what the dual-run test asserts)

For every `.dot` file under `pipelines/`:

| Field | Assertion |
|---|---|
| `graph.name` | strict equality |
| `graph.goal`, `label`, `modelStylesheet`, `inputs`, etc. | strict equality |
| `graph.nodes` | same key set; each node shallow-equal on ALL fields EXCEPT `sourceLine` |
| `graph.edges` | same length; pairwise equal on `from`, `to`, `label`, `condition`, plus any other attrs set |
| `edges` order | equal (important because edge-label diff uses order) |

`sourceLine` is the intentional new field — excluded from equivalence and verified separately.

## Consumer updates

Only one consumer changes behavior:

### `src/attractor/core/schemas.ts` + `src/cli/commands/pipeline.ts`

`validateNode` already emits `schema_error` diagnostics. After migration, those diagnostics gain `file:line` prefix when the caller passes the graph through the validator. This is a separate PR / plan — the parser migration just unlocks it. **Parser migration ships without any error-output changes.**

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Semantic drift on edge cases our regex parser was permissive about | Dual-run test over all 19 pipelines catches any divergence; if a file diverges, either fix the `.dot` (if its loose syntax was the bug) or adapt `parseDotV2` (if the permissiveness was intentional). |
| Stylesheet application ordering differs | Keep `applyStylesheet` exactly as-is, call it at the same point (after all nodes collected). |
| Edge chain expansion differs (`a -> b -> c`) | Dual-run asserts edge order + count. Two tests: simple chain, chain with mid-chain attrs. |
| Subgraph defaults don't cascade the same way | Probe shows same pipelines parse; dual-run will catch drift. Subgraphs are rare in our pipelines. |
| Build size bump | 468 KB on disk, tree-shakable; verify `dist/cli/index.js` grows <100 KB. |
| Parser rejects a new `.dot` someone writes next week | Dual-run test runs in CI; any new file that diverges blocks merge. |

## Success criteria

- [ ] `parseDotV2` lives in `src/attractor/core/graph-ast.ts`.
- [ ] Shared helpers in `src/attractor/core/dot-common.ts`, imported by both parsers.
- [ ] Dual-run test green across all 19 pipelines.
- [ ] Every `Node` from `parseDotV2` has `sourceLine` matching the original `.dot` file.
- [ ] `npx vitest run` 968/968 passing (no existing test broken).
- [ ] `npm run build` succeeds; `dist/cli/index.js` grows by less than 100 KB.
- [ ] `parseDot` delegates to `parseDotV2` (or is replaced).
- [ ] Old regex helpers (`stripComments`, `flattenSubgraphs`, `parseAttrs` duplicate) removed.

**Follow-up shipped:** The "every attribute can be located to line:column" uplift (goal 2) was cashed in by the [source-location diagnostics](./2026-04-20-source-location-diagnostics-design.md) spec (v0.1.31).

## Follow-ups (out of scope)

- Add `file:line:col` prefix to `schema_error` diagnostics (separate plan).
- Fuzzy "did you mean" suggestion via Levenshtein.
- `--verbose` flag on `ralph pipeline validate` to gate full allowed-keys table.
- AST-based `ralph pipeline refine` that edits via AST instead of regex rewrite.
