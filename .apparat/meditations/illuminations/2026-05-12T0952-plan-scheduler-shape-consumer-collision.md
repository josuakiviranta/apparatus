---
date: 2026-05-12
description: plan_scheduler should serialize chunks that edit a shared type shape against chunks that consume it, so parallel batches avoid predictable merge_resolver round-trips.
---

## Core Idea

When `plan_scheduler` builds the parallel DAG, it currently treats chunk-to-chunk merge risk as opaque — batches kick off in parallel, and `merge_resolver` cleans up after the fact. But there is a structural pattern the scheduler can see in the plan itself: a chunk that edits a **shared type shape** (e.g. `LiveBlock` in `src/cli/lib/pipelineEvents.ts`) will always collide with a chunk that **consumes that shape** (drivers reading `LiveBlock.kind`, footer rendering `LiveBlock`, reducer cases keyed on the shape). The collision is predictable from the chunk's file-touch list — the scheduler can detect it and serialize, instead of paying a `merge_resolver` cycle every time.

## Why It Matters

In run `parallel-illumination-to-implementation-fe4624db`, two batches collided on c2 ("Flip the seam") and c3 ("Cross-driver escape contract scenario") because both edited `pipelineEvents.ts`, `pipelineReducer.ts`, `LiveFooter.test.tsx`, `pipeline-run-view.test.tsx`. `merge_resolver` resolved cleanly in one cycle (commits `a873af7`, `8300b3f`), so the run shipped — but the cycle cost real time and the conflict pattern was *named in the memory file as predictable*: "any chunk that edits the shared `LiveBlock` shape will collide with chunks that add drivers consuming it."

Future deep-driver refactors (the wait-human driver, plus any approve-diff / pick-file kinds anticipated in `docs/adr/0014-interaction-drivers.md`) will hit the same shape — shrinking a type and then having sibling chunks consume the new shape is the *core motion* of these refactors. Today the engine handles it, but every refactor in this style pays a `merge_resolver` tax. Making the scheduler aware turns a routine retry into a clean run.

## Revised Implementation Steps

1. **Identify the signal.** In `plan_scheduler`, when reading each chunk's declared `files:` (or scanning the chunk body for fenced code paths), classify each path as either **shape-edit** (file is exported from `src/cli/lib/` and other chunks reference it from non-`src/cli/lib/` paths) or **shape-consume** (chunk imports/reads from a path another chunk is editing).
2. **Compute the collision graph.** For each pair of chunks, mark an edge when chunk A edits a path that chunk B reads (or both edit the same test file). Today this graph is implicit in `merge_resolver`; the scheduler should compute it explicitly.
3. **Serialize colliding chunks in the DAG output.** Where the existing DAG marks two chunks parallel, the scheduler should add a `depends_on` edge from the consumer to the shape-editor when the collision signal fires. The resulting DAG runs the shape-edit chunk first, then unblocks consumers — the merge_resolver step still exists as a safety net, but should idle for these runs.
4. **Add a scenario.** New smoke under `.apparat/scenarios/scheduler-shape-collision/` that feeds a two-chunk plan (chunk A edits a shared type, chunk B consumes it) and asserts the emitted `*.dag.json` serializes them. Mirrors how `interaction-driver-escape` freezes the abort contract.
5. **Trace observability.** When the scheduler enforces a serialization edge it didn't otherwise need, emit it as a `scheduler.serialized_for_shape_collision` event on the run trace so future memory files can confirm the heuristic is firing as intended.
6. **Validate against this run.** Replay the `parallel-illumination-to-implementation-fe4624db` plan through the upgraded scheduler offline and confirm c2 → c3 gets a `depends_on` edge — the conflict in `pipelineEvents.ts` and three test files is the canonical positive case.

## Provenance

- Source memory: `.apparat/sessions/2026-05-12-interaction-kinds-need-deep-drivers.md`
- Pipeline run id: `parallel-illumination-to-implementation-fe4624db`
- Surfaced by: memory-reflector
