# ADR-0009: Parser and validator live in separate files

**Date:** 2026-05-05
**Status:** Accepted

## Context

`src/attractor/core/graph.ts` carried two unrelated jobs in the same 1187-line file: the parser (`parseDot`, `string → Graph`) and the validator (`validateGraph` + 11 private `check*` rules + `validateOrRaise`). The validator pulled in four cross-cutting deps (`agent-loader`, `flow-analyzer`, `conditions`, `gate-registry`) that the parser does not use. Adding a 12th rule meant another function in an already-monolithic file. The 11 `check*` helpers were all private to the file — verified by repo-wide grep — so the seam was clean.

ADR-0001 endorsed single-purpose modules (`agent-loader.ts` as the canonical example). ADR-0004 ("source as truth, no behavioural specs") accepted internal restructuring whose only signal is the source itself. Recent commits (`c8370da` split `AgentHandler`, `4b67e07` extracted `assembleAgentPrompt`, `1fa6811` deleted parallel/conditional handlers) showed momentum toward focused modules.

## Decision

Extract the validator into `src/attractor/core/graph-validator.ts`:

- `validateGraph` + 11 `check*` rules + `validateOrRaise` move verbatim — no rule edits, no diagnostic-message edits, no signature changes.
- The four validator-only imports (`agent-loader`, `flow-analyzer`, `conditions`, `gate-registry`) move with the validator.
- `KNOWN_TYPES`, `UNIMPLEMENTED_TYPES`, `SHAPE_TO_TYPE` (touched by both parser and validator) stay in `graph.ts` and are re-exported so `graph-validator.ts` imports them from a single canonical location.
- `graph.ts` retains `parseDot`, `resolveHandlerType`, the shared constants, and any helpers `parseDot` calls.
- One module, not a `checks/<rule>.ts` directory — the 11 rules average ~50 lines each; per-file overhead is noisier than the body. Mirror the existing `src/attractor/handlers/` convention (one file per handler, no per-handler directory). If a future rule outgrows the average, that rule alone can move to its own file.

Public exports (`parseDot`, `resolveHandlerType`, `validateGraph`, `validateOrRaise`, `Diagnostic`) keep their signatures verbatim. Diagnostic strings stay byte-identical, pinned by `src/attractor/tests/graph-validator-byte-identical.test.ts`.

## Consequences

- "Where do I add a new validation rule?" gets a one-word answer: `graph-validator.ts`.
- `graph.ts` advertises a parser and is one.
- The two designs `2026-05-04-janitor-graph-validator-bloat-design.md` and this one commute. If the bloat-design ships first, this design imports its `createGraphTraversal` from wherever it landed. If this design ships first, the bloat-design re-points its line citations to `graph-validator.ts`.
- No re-export shim from `graph.ts` — see design §7.2. The import-path move is the canonical signal that the validator no longer lives in the parser file.

## References

- ADR-0001 (single-purpose modules)
- ADR-0004 (source as truth, no behavioural specs)
- Originating illumination: `meditations/illuminations/2026-05-05T1028-graph-ts-parser-validator-conflation.md`
- Design doc: `docs/superpowers/specs/2026-05-05-graph-ts-parser-validator-conflation-design.md`
