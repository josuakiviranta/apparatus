# attractor — the pipeline execution engine

This folder is the pipeline execution engine. The name "attractor" predates
"engine/orchestrator" vocabulary in the codebase and stuck because the
metaphor (graph nodes as basins pulling context through) survived rename
attempts. If you came looking for "the engine," this is it.

## Folder map

- `core/` — graph types, DOT parser (`graph-ast.ts`), shape→type resolver
  (`graph.ts`), validators, schemas. Pure / no I/O.
- `handlers/` — per-node-type execution. `agent-dispatch.ts` picks between
  `InteractiveAgentHandler` and `LoopingAgentHandler` based on the node's
  `interactive` attribute (see CONTEXT.md → Interactive vs looping handlers).
  Tool, store, wait-human, conditional handlers live here too.
- `transforms/` — pure pre-execution graph rewrites (variable expansion,
  inputs resolution, grounded-opening prompt append for interactive nodes).
- `interviewer/` — operator-input abstraction used by gates and interactive
  agents. Swappable for tests.
- `tracer/` — JSONL trace writer + context-delta synthesis consumed by
  `apparat pipeline trace` and `apparat status`.
- `tests/` — engine-level vitest specs (parser, validator, dispatch,
  checkpoint resume, deep-loop semantics).
- `checkpoint.ts` — `[currentNode, completedNodes, context, nodeRetries]`
  JSON serialization for `--resume`.
- `types.ts` — `Graph`, `Node`, `Edge`, `Outcome`, `OutcomeStatus`.

The engine is stateless: it takes an immutable `Graph` + a starting context,
walks it node by node, and threads `Outcome.contextUpdates` back into the
context dict. All mutation is funnelled through this dict, which is what
makes `--resume` cheap (one JSON file, no event log).
