---
date: 2026-05-06
description: The "is this an interactive agent?" decision is open-coded in two unrelated modules — handler dispatch and renderer classifier — with no shared seam.
---

## Files

- `src/attractor/handlers/agent-dispatch.ts` (17 LOC)
- `src/cli/lib/classifyNode.ts` (53 LOC)

## Problem

Both modules branch on the same pair of facts:

`agent-dispatch.ts:12`:
```typescript
const isInteractive = node.interactive === true || node.interactive === "true";
```

`classifyNode.ts:35`:
```typescript
const interactive = node.interactive === true || node.interactive === "true";
return interactive ? "interactive-agent" : "agent";
```

Both also call `resolveHandlerType(node)` to decide whether the node is an agent at all. `agent-dispatch` uses the result to pick a handler; `classifyNode` uses it to pick a renderer block kind. Same fact, two readers, no canonical predicate — drift waiting.

The DOT-attribute coercion (`=== true || === "true"`) is itself a domain rule (DOT attributes parse as strings; sometimes pre-coerced upstream). A future schema tightening that forces `interactive: boolean` at parse time would need both call sites updated; missing one would be a silent renderer/handler split.

## Solution

Promote a single typed predicate `isInteractiveAgent(node: Node): boolean` next to `resolveHandlerType` in `src/attractor/core/graph.ts` (or wherever those node-shape predicates settle after illumination #1's `graph.ts` cleanup). Both call sites import it.

Optional follow-up: collapse the DOT string-vs-boolean coercion into the parser so downstream code sees `node.interactive: boolean` and the predicate becomes a one-liner.

## Benefits

- **Locality:** one place to read what "interactive" means at runtime.
- **Leverage:** future renderer/dispatcher consumers (e.g. `pipeline show` enrichment, scenario fixtures) inherit the predicate for free.
- **Tests:** the predicate becomes a pure function with a small enumerable input space — cheaper to pin than two parallel branches.
- **Deletion test:** removing the duplication concentrates complexity into one named seam; nothing disperses.
