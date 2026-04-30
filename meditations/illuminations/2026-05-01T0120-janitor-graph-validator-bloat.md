---
date: 2026-04-30
description: validateGraph in graph.ts is 1101 lines with three BFS helpers defined inline and two duplicate adjacency-list constructions that mirror flow-analyzer.ts — extract checkVariableCoverage and share the adjacency primitive.
---

## Findings

### 1. `graph.ts` is 1101 lines doing at least two jobs

**What:** `graph.ts` is 1101 lines and contains both the graph data-access layer (SHAPE_TO_TYPE, resolveHandlerType, parseDot, validateOrRaise) and the full validation engine (10+ distinct rules). By contrast every other `check*` function in the same file is already extracted as a module-level function — except `variable_coverage`, which remains embedded inside `validateGraph`.

**Evidence:**
- `src/attractor/core/graph.ts` — 1101 lines (grep `^` line count)
- `validateGraph` starts at line 68 and closes at the bottom of the variable_coverage BFS, spanning ~600 lines
- The ten `check*` module-level functions (checkOrphanOutput, checkInputTypeMismatch, checkRequiredCallerVars, checkMissingInputProducer, checkAgentOutputsConflict, checkAgentMissingOutputs, checkLoopRequiresDoneField, checkGateHandlers) were clearly extracted as separate functions — but `variable_coverage` was left in-place, making `validateGraph` still the longest function in the file

**Why it matters (KISS lens):** A reader auditing a failing `variable_coverage` diagnostic has to scroll 400+ lines into `validateGraph` to find the logic. Three local closures are invisible from outside, untestable in isolation, and easy to miss when searching for BFS helpers.

**Suggested action:** Extract the variable_coverage block into `checkVariableCoverage(graph, nodeProduces, dotDir, diags)` matching the signature pattern of every sibling `check*` function. `validateGraph` becomes a clean dispatcher of ~80 lines.

---

### 2. Three independent adjacency-list constructions for the same graph

**What:** `validateGraph`, `isProducerOnEveryPath`, and `flow-analyzer.ts:computeScope` each build their own forward-adjacency `Map<string, string[]>` from the same `graph.edges`. This is the identical three-line pattern repeated in three places.

**Evidence:**
- `src/attractor/core/graph.ts` inside `validateGraph` variable_coverage block:
  ```
  const adj = new Map<string, string[]>();
  for (const n of nodes.keys()) adj.set(n, []);
  for (const e of edges) { if (adj.has(e.from)) adj.get(e.from)!.push(e.to); }
  ```
- `src/attractor/core/graph.ts` inside `isProducerOnEveryPath`:
  ```
  const fwd = new Map<string, string[]>();
  for (const id of graph.nodes.keys()) fwd.set(id, []);
  for (const e of graph.edges) { if (fwd.has(e.from) && fwd.has(e.to)) fwd.get(e.from)!.push(e.to); }
  ```
- `src/attractor/core/flow-analyzer.ts:computeScope` (≈ line 56):
  ```
  const fwd = new Map<string, string[]>();
  ...
  for (const e of edges) { if (fwd.has(e.from) && fwd.has(e.to)) fwd.get(e.from)!.push(e.to); }
  ```

**Why it matters (KISS lens):** Three copies means three places to update when edge semantics change (e.g. adding a `disabled` flag). The slight variation in guard (`adj.has(e.from)` vs `fwd.has(e.from) && fwd.has(e.to)`) already hints at divergence.

**Suggested action:** Add `export function buildForwardAdj(graph: Graph): Map<string, string[]>` to `dot-common.ts` (already the shared graph-primitive module) or to `flow-analyzer.ts`, and call it from all three sites.

---

### 3. Three private closures inside `validateGraph` are untestable

**What:** `hasDefault`, `reachableWithout`, and `findQualifiedProducer` are defined as `function` declarations inside `validateGraph`, making them invisible to the test suite. All three are non-trivial logic — `reachableWithout` is a BFS, `findQualifiedProducer` iterates all tool nodes.

**Evidence:**
- `src/attractor/core/graph.ts` — `function hasDefault(node: Node, varName: string): boolean` defined inline inside `validateGraph`
- `src/attractor/core/graph.ts` — `function reachableWithout(source, target, excluded)` defined inline inside `validateGraph`
- `src/attractor/core/graph.ts` — `function findQualifiedProducer(consumerId)` defined inline inside `validateGraph`
- Contrast with `isProducerOnEveryPath`, which was correctly extracted at module level and has its own test file `src/attractor/tests/graph-inputs-flow.test.ts`

**Why it matters (KISS lens):** When a variable_coverage false-positive is reported, a developer cannot write a targeted unit test for `reachableWithout` without first extracting it. The pattern already exists for `isProducerOnEveryPath` — the three closures should receive the same treatment.

**Suggested action:** Promote `hasDefault`, `reachableWithout`, and `findQualifiedProducer` to module-level functions (or move to `flow-analyzer.ts`). The extracting of `variable_coverage` into `checkVariableCoverage` (Finding 1) naturally forces this.

## Reading thread

- `2026-05-01T0050-pipeline-location-drift-vs-vision.md` — the only prior illumination; covers pipeline location + resolver chain + stale docs. No overlap with graph.ts internals — `pipeline-resolver.ts` is mentioned there but not the validator. This illumination is additive, not duplicative.
