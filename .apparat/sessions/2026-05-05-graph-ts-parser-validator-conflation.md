---
date: 2026-05-05
run_id: ea4869dd-752c-437e-8b81-8cd4241fb4ce
plan: docs/superpowers/plans/2026-05-05-graph-ts-parser-validator-conflation.md
design: docs/superpowers/specs/2026-05-05-graph-ts-parser-validator-conflation-design.md
illumination: meditations/illuminations/2026-05-05T1028-graph-ts-parser-validator-conflation.md
test_result: pass
---

# graph-ts-parser-validator-conflation

## What was implemented
Split `src/attractor/core/graph.ts` into a parser-only `graph.ts` and a new `graph-validator.ts` owning `validateGraph` + the 11 private `check*` rules + `validateOrRaise`. Public surface (`parseDot`, `resolveHandlerType`, `validateGraph`, `validateOrRaise`, `Diagnostic`) preserved byte-for-byte.

## Key files
- `src/attractor/core/graph-validator.ts` (new, 1156 lines)
- `src/attractor/core/graph.ts` (1187 → ~25 lines after extraction)
- `src/attractor/tests/graph-validator-byte-identical.test.ts` (new diagnostic-string pin) + snapshot
- `docs/adr/0009-parser-validator-split.md` (new ADR)
- `src/cli/commands/pipeline.ts` (consumer import update)
- ~30 test files in `src/attractor/tests/` and `src/cli/tests/pipeline-*-folder.test.ts` updated for the split import path

## Decisions and patterns
- Validator-only imports (`agent-loader`, `flow-analyzer`, `conditions`, `gate-registry`) followed `validateGraph` into the new module — `graph.ts` now imports none of them.
- `KNOWN_TYPES` / `UNIMPLEMENTED_TYPES` / `SHAPE_TO_TYPE` kept in `graph.ts` as the canonical type-recognition source; `graph-validator.ts` imports them. Avoids duplicating handler-type knowledge across modules.
- Diagnostic message strings pinned byte-identical via snapshot test (`graph-validator-byte-identical.test.ts.snap`) — guards against accidental wording drift during the move.
- ADR-0009 records the parser/validator split per ADR-0004's source-as-authority principle.

## Gotchas and constraints
- `parseDot` is **not** re-exported from `graph-validator.ts`; consumers must import each function from its owning module. Tests that previously did `import { parseDot, validateGraph } from '../core/graph'` now split into two imports.
- All 11 `check*` helpers remain private to `graph-validator.ts` (zero external references confirmed by verifier subagent before extraction).
- The illumination's rhetorical anchor — that sibling janitor illumination 2026-05-01T0344 was already acted on — is **false**; that illumination is still alive and `pipelineRunCommand` remains monolithic. Refactor stood on its own structural merits regardless.

## Final verification
- test_result: pass
- test_summary: Cycle 1 clean: build succeeded and 1272/1272 tests passed across 141 files (incl. all pipeline-smoke-*-folder.test.ts and the byte-identical diagnostic pin test). CLI sanity checks (`ralph --help`, `ralph pipeline --help`) rendered cleanly with no crashes. No fixes needed.
