---
date: 2026-05-06
description: Tracer test fixture passes nodes as Node[] array, leaking a dead defensive branch into production JsonlPipelineTracer code.
---

## Findings

1. **What:** `JsonlPipelineTracer.onPipelineStart` carries a dead `instanceof Map` guard that exists solely to accommodate a test fixture that violates `Graph`'s own type contract.

   **Evidence:**

   `src/attractor/tracer/jsonl-pipeline-tracer.ts:15-17`:
   ```typescript
   const nodes = graph.nodes instanceof Map
     ? [...graph.nodes.values()].map(n => n.id)
     : (graph.nodes as unknown as Node[]).map(n => n.id);
   ```

   `src/attractor/tracer/jsonl-pipeline-tracer.test.ts:8-10`:
   ```typescript
   function makeGraph(): Graph {
     return { goal: "test", nodes: [{ id: "run", type: "codergen" } as Node], edges: [] } as unknown as Graph;
   }
   ```

   `src/attractor/types.ts:75`:
   ```typescript
   nodes: Map<string, Node>;
   ```

   The production `Graph` interface mandates `nodes: Map<string, Node>`. The test helper returns a plain `Node[]` array cast via `as unknown as Graph`. The tracer then defends against an input shape that TypeScript declares impossible at every real call site.

   **Why it matters (KISS lens):** A reader of `jsonl-pipeline-tracer.ts` must hold two mental models — "nodes is always a Map at runtime" AND "unless it's an array, because the test says so." The `as unknown as` cast in the branch makes this a deliberate type escape, not an accident. The defensive branch is not just noise; it actively misleads: it implies the tracer is expected to handle both shapes. Any future tracer extension must now repeat the same guard or silently break on the test path.

   **Suggested action:**
   - Fix `makeGraph()` in `jsonl-pipeline-tracer.test.ts` to return a proper `Map<string, Node>`:
     ```typescript
     function makeGraph(): Graph {
       const nodes = new Map<string, Node>();
       nodes.set("run", { id: "run", type: "codergen" } as Node);
       return { goal: "test", nodes, edges: [], name: undefined, inputs: [] };
     }
     ```
   - Drop the `instanceof Map` ternary from `onPipelineStart` — replace with the direct Map path:
     ```typescript
     const nodes = [...graph.nodes.values()].map(n => n.id);
     ```
   - Remove the now-unused `Node` import from the tracer (if it becomes unused after the branch drops).

## Reading thread

- No prior illuminations found (list was empty at session start). No dedup overlap to report.
