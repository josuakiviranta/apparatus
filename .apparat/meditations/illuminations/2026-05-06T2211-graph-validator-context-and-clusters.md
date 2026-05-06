---
date: 2026-05-06
description: graph-validator.ts is a 1156-line monolith with 41 rules in inconsistent shapes — define ValidationContext, lift inline rules into it, then cluster by shared traversal state.
---

## Findings

1. **What:** `src/attractor/core/graph-validator.ts` (1156 lines) emits 41 distinct `rule:` strings. 30 of those are inline blocks in the 478-line body of `validateGraph` (lines 92–569); only 11 are extracted as named `check*` functions, and those 11 already drift across three signature shapes.
   - **Evidence:**
     - Line count: `wc -l` confirms 1156.
     - 41 unique rule names emitted, recoverable via grep `rule: ["']\w+["']`. Clusters: flow (9), types/schemas (3), variables (6), inputs/outputs refs (15), scripts (4), gates (4).
     - Signature drift across existing extractions:
       - `checkGateHandlers(graph, dotDir, diags)` — line 1078
       - `checkRequiredCallerVars(graph, nodeProduces, dotDir, diags)` — line 744
       - `checkAgentOutputsConflict(node, dotDir, diags)` — line 912
       - `checkInteractiveWithOutputs(node, dotDir, diags)` — line 1026
     - Inline rules share state via closure scope: `nodeProduces` (built lines 202–236), `traversal` (line 199 — `createGraphTraversal` bundle of `hasDefault` / `reachable` / `findQualifiedProducer`), `callerInputs` (line 187), `RESERVED_VARS` (line 186), `STRING_ATTRS`. Lifting inline rules without first defining a context bundles forces every new function to take 5–7 parameters.
   - **Why it matters:** Adding rule N+1 means another inline block in a 478-line function or another differently-shaped helper. Per-rule atomization (one file per rule) duplicates the traversal helpers across files. Cluster-only refactors propagate the existing signature drift. The load-bearing decision is the **shape** of what each rule receives, not whether they live in the same file.
   - **Suggested action:** Three-step deepening, in order:
     1. Define `ValidationContext` carrying `{graph, dotDir, nodeProduces, traversal, callerInputs, diags}`. One signature: `(ctx: ValidationContext) → void` (or `(ctx, node)` for per-node rules).
     2. Lift the 30 inline rules out of `validateGraph`'s body into named functions taking that context. Single extraction pass — don't normalize twice.
     3. Cluster the 41 normalized rules into modules grouped by shared context slice (flow, types, variables, inputs-refs, scripts, gates). Cluster count is emergent: rules that share the same context fields cluster naturally; small clusters (types: 3, scripts: 4) may merge into "node-level constraints" or stay separate as the slices reveal.

## Reading thread

- ADR-0009 (parser/validator split) extracted the validator out of `graph.ts` but did not address the validator's internal structure. This illumination picks up where ADR-0009 stopped: the validator advertises validation; now make the rules inside legible.
- Architecture review session 2026-05-06: candidate #2 in the deepening survey. Initial proposal was "one file per rule" — rejected because per-rule atomization duplicates the traversal helpers each rule needs. Cluster proposal validated, but the prerequisite (`ValidationContext` before clustering) is the load-bearing step — without it, clusters become folders of inconsistently-shaped functions.
