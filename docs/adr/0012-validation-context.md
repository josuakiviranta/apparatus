# ADR-0012: ValidationContext bundle and clustered validators

**Status:** accepted
**Date:** 2026-05-06
**Predecessor:** ADR-0009 (parser/validator split)

## Context

ADR-0009 extracted the validator out of `graph.ts` into `src/attractor/core/graph-validator.ts` with a strict "no rule edits, no signature changes" constraint. That extraction succeeded — the file was clean at birth. But the file accumulated rules steadily, and by 2026-05-06 it stood at 1156 lines: 41 distinct `rule:` strings, a 478-line `validateGraph` body with ~24 inline rule blocks, and 11 named `check*` helpers each picking a different subset of `(graph, node, dotDir, nodeProduces, diags)`.

The structural problem was not size alone. The 11 helpers drifted across three signature shapes: some took `(graph, dotDir, diags)`, others `(graph, nodeProduces, dotDir, diags)`, others `(node, dotDir, diags)`. Seven further extractions (e.g. `checkOrphanOutput`, `checkAgentMissingOutputs`, `checkLoopRequiresDoneField`) each picked their own subset of the same closure state. The inline rule blocks captured everything through `validateGraph`'s closure. Adding rule N+1 meant either another inline block buried in a 478-line function body, or another helper with yet another bespoke signature. Both paths were structurally unsafe: the second would spread the signature drift across sibling files; the first would further obscure the emission order on which `graph-validator-byte-identical.test.ts` depends.

The root cause was the absence of a canonical answer to "what does a validation rule receive?" — not the absence of separate files.

## Decision

Define a `ValidationContext` bundle carrying all state that any rule may need:

```ts
interface ValidationContext {
  graph: Graph;
  dotDir: string | undefined;
  nodeProduces: Map<string, Set<string>>;
  traversal: GraphTraversal;   // hasDefault / reachable / findQualifiedProducer
  callerInputs: string[];
  diags: Diagnostic[];
}
```

The canonical rule signatures are `(ctx: ValidationContext) => void` for graph-wide rules and `(ctx: ValidationContext, node: Node) => void` for per-node rules. Both shapes receive the full bundle; rules use only the fields they need.

The 41 rules are lifted out of `validateGraph`'s body and the 11 helpers are re-shaped to these signatures in a single extraction pass, then clustered into modules under `src/attractor/core/validators/`:

- `flow.ts` — start/exit/reachability rules (9 rules)
- `types.ts` — handler-type checks (2 rules)
- `variables.ts` — variable coverage, portability heuristic, required-caller-vars; split into `runEarly` (coverage + portability, run before interactive checks) and `runLate` (required_caller_vars info banner, run after all per-node checks) to preserve the original emission order
- `inputs-refs.ts` — agent inputs/outputs cross-checks (15 rules); dispatches `interactive.ts` per-node helpers internally to maintain round-robin node-iteration order across the two clusters
- `scripts.ts` — tool-handler script rules (4 rules)
- `gates.ts` — wait.human gate rules (4 rules)
- `interactive.ts` — interactive-mode constraints (3 per-node helpers, no standalone `run` export; consumed exclusively by `inputs-refs.ts`)
- `context.ts` — `ValidationContext` shape + `createValidationContext` factory
- `agent-resolver.ts` — shared helper `findAgentJsonPath` used by multiple clusters
- `index.ts` — orchestrator; exports `runAllValidators(ctx)` which calls each cluster in the same order the inline blocks fired in the original `validateGraph` body

`src/attractor/core/graph-validator.ts` is retained as a 17-LOC façade exporting `validateGraph`, `validateOrRaise`, and `Diagnostic` with byte-identical signatures. No consumer (engine, CLI, MCP, tests) saw a surface change.

## Rule-to-cluster mapping

See `docs/superpowers/specs/2026-05-06-graph-validator-context-and-clusters-design.md` §3.4 for the authoritative rule-to-cluster table. This ADR does not duplicate the table.

## Alternatives considered

- **Per-rule files** (rejected): traversal helpers like `findQualifiedProducer` and the `nodeProduces` map would have to be threaded into every rule file that needs reachability information. The coordination cost across 41 files outweighs the file-size gain, and the emission order becomes harder to audit.
- **Cluster-first without context bundle** (rejected): this is the direct alternative to the chosen approach. Splitting the file into 6–8 topic clusters without first unifying the parameter list would propagate the existing signature drift into sibling files. The root cause — no canonical shape — survives the refactor.

## Consequences

- Every new rule has a one-paragraph answer to "what does a rule receive?": the `ValidationContext` shape defined in `context.ts`.
- The 41 rule strings, all diagnostic messages, and the full emission order are pinned by `src/attractor/tests/graph-validator-byte-identical.test.ts`. Any reorder, message edit, or missed rule fails the test diagnostic-by-diagnostic.
- The façade `graph-validator.ts` is 17 LOC; `validateGraph` and `validateOrRaise` signatures are byte-identical to ADR-0009. No downstream consumer saw a surface change.
- The `variables.ts` `runEarly` / `runLate` split preserves the original `validateGraph` ordering: variable-coverage and portability rules fire before interactive per-node checks; the `required_caller_vars` info banner fires after all per-node checks complete.
- `interactive.ts` exports per-node helpers only (no standalone `run`). It is an internal dependency of `inputs-refs.ts`, not a top-level cluster, because the two share the same per-node iteration loop and interleaving their emissions is what the byte-identical test enforces.

## References

- Design doc: `docs/superpowers/specs/2026-05-06-graph-validator-context-and-clusters-design.md`
- Predecessor: `docs/adr/0009-parser-validator-split.md`
- Originating illumination: `.apparat/meditations/illuminations/2026-05-06T2211-graph-validator-context-and-clusters.md`
