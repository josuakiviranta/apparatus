---
date: 2026-04-20
status: open
description: `ralph pipeline validate` today checks only per-node attribute shape; it never walks edges to prove that `$var` references consumed by a node are guaranteed to be in context on every incoming path, so bugs like mark_archived's missing `$archive_reason_short` on the decline branch only surface at runtime.
---

## Core Idea

The current validator (`src/attractor/core/graph.ts` `validateGraph` + per-kind zod schemas in `src/attractor/core/schemas.ts`) is **structural**: it checks each node in isolation against a zod shape. It never asks "does this var actually exist in context at this node?" The graph's edges — the thing that makes a pipeline a pipeline — are invisible to validation.

Runtime preflight (`scanUndeclaredCallerVars` in `src/cli/commands/pipeline.ts`, interpolation logic in `src/attractor/transforms/variable-expansion.ts`) fills part of the gap, but asks only the weaker question: "is this var produced by *some* upstream node?" For diamond-shaped graphs where multiple paths converge on a consumer, that question admits false positives — a var can be "produced upstream" on one path and entirely absent on another.

**Concrete motivating bug.** `pipelines/illumination-to-implementation.dot:14-18` has `mark_archived` consuming `$archive_reason_short` via `script_args`. Two edges arrive at `mark_archived`:

- `remove_gate --Archive-->` — verifier on this path emits `archive_reason_short` via `produces`.
- `approval_gate --Decline-->` — nothing on this path produces the var.

Runtime preflight passes (the var *is* produced upstream on one path). Execution down the Decline path then interpolates an empty string into `script_args`, the archive tool receives a malformed arg, debugging is opaque. The author's workaround — `default_archive_reason_short="Declined at approval gate"` on the consumer — collided with the strict `ToolNodeSchema` whitelist (see `2026-04-20T1800-validator-and-runtime-disagree-on-defaults.md`), so even the intended fix was rejected.

## Why It Matters

This is the next layer of semantic validation beyond what `2026-04-15T0400-pipeline-validate-checks-syntax-not-semantics.md` named. Authors currently discover path-sensitive var bugs by running the pipeline down every branch — an NP-flavoured manual audit that scales poorly as graphs grow. A static check turns "works on the happy path, breaks in production on the rare decline branch" into a validator error at authoring time.

The class of bug is persistent: `2026-04-19T1200-default-vars-whitelist.md` documents the same shape (optional upstream produces → consumer needs fallback), and every new convergence point risks re-introducing it. Machine-checkable path semantics is the general solution.

## Revised Implementation Steps

1. **Derive consumed-vars per node.** For each node N, scan `prompt`, `tool_command`, `script_args`, `label`, and any other interpolated attribute for `$var` / `${var}` tokens. The scanner logic already exists partially in `src/attractor/transforms/variable-expansion.ts` — lift it to a pure function `collectConsumedVars(node): Set<string>` in `src/attractor/core/graph.ts`. Respect fenced code-block skip rules (see `2026-04-19T...-fenced-var-skip-shipped.md`).

2. **Derive produced-vars per node.** Read the comma-separated `produces=` attribute into `collectProducedVars(node): Set<string>`. Treat every `default_<varname>=` attribute on N as also producing `<varname>` *at N itself* (shadow producer — this is the contract `2026-04-20T2300-tool-node-default-passthrough.md` formalizes).

3. **Path-sensitive var-flow analysis.** For each node N with predecessors, compute `availableVars[N] = intersection over incoming paths of (accumulated produced-vars along that path)`. Implement as fixed-point iteration: initialize every node's `available` to `{}`, then repeatedly for each node set `available[N] = ∩_{p ∈ preds(N)} (available[p] ∪ produced[p])` until no set changes. Fixed-point handles cycles — a loop that produces a var on iteration 2 is recognized.

4. **Diagnostic on mismatch.** For each consumed-var `v` in N not in `available[N]`, emit a `schema_error` diagnostic. Include: the node id, the var, the satisfied path(s), and the missing path(s), each as a `start → ... → N` chain. Suggest two fixes: add `v` to `produces=` on a node along the missing path, or add `default_<v>=` on N.

   Example message:
   ```
   [var-flow] mark_archived consumes $archive_reason_short
     ok:      start → ... → remove_gate --Archive--> mark_archived   (produced by verifier)
     missing: start → ... → approval_gate --Decline--> mark_archived (no producer on this path)
     fix: add archive_reason_short to produces= on a node along the Decline path,
          or add default_archive_reason_short="..." to mark_archived.
   ```

5. **Severity lane.** Missing on **all** paths → `error` (pipeline is broken). Missing on **some** paths, no default on consumer → `error`. Missing on some paths, default present on consumer → `warning` (author may have intended the fallback but validator surfaces the asymmetry). This maps cleanly onto `2026-04-20T2400-split-validate-and-lint-lanes.md` — the error lane blocks `pipeline run`, the warning lane prints on `pipeline lint`.

6. **Performance.** Fixed-point over tens of nodes is trivial. Bail out after `nodes.length + 1` iterations to catch pathological cases.

7. **Interaction with `2026-04-20T2200-explicit-consumes-declarations.md`.** If that illumination ships first, step 1 becomes "read the declarative `consumes=` attribute" instead of scanning every string. The var-flow analysis itself is unchanged — the source of the consumed-set is just more reliable and the diagnostic points to a single line.

## Cross-links

- `2026-04-15T0400-pipeline-validate-checks-syntax-not-semantics.md` — foundation. The earlier illumination named the syntax-vs-semantics gap for the validator; this one proposes the next semantic check to add after agent-name and file-path validation.
- `2026-04-20T2200-explicit-consumes-declarations.md` — enabler. If nodes declare consumed-vars explicitly, step 1 reads one attribute instead of scanning every interpolated string, and error messages point to a single declarative line.
- `2026-04-20T2300-tool-node-default-passthrough.md` — interaction. Path-sensitive analysis treats `default_*` as a shadow producer at the consumer, so the two directions must agree on the semantics of defaults.
- `2026-04-20T2400-split-validate-and-lint-lanes.md` — severity. Missing-on-all-paths is an error; missing-on-some-paths-with-default is a warning. Splitting validate vs lint lanes makes this actionable without breaking CI.
- `2026-04-19T1200-default-vars-whitelist.md` — same bug class. Both illuminations try to make pipelines robust to optional branches; the whitelist removal makes defaults expressible, this illumination makes the branching behavior machine-checkable.
