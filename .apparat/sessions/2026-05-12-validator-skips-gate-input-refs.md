---
date: 2026-05-12
run_id: parallel-illumination-to-implementation-dee4bbac
plan: docs/superpowers/plans/2026-05-12-validator-skips-gate-input-refs.md
design: docs/superpowers/specs/2026-05-12-validator-skips-gate-input-refs-design.md
illumination: .apparat/meditations/illuminations/2026-05-11T2315-validator-skips-gate-input-refs.md
test_result: pass
---

# Validator skips gate input refs

## What was implemented
`pipeline validate` now applies `unknown_source_node` and `source_missing_output_key` to hexagon-gate `inputs:` declarations, closing the gap that let a stale `inputs: [implement.done]` slip past validation and explode ~50 min into run `parallel-illumination-to-implementation-df1d9cf6`.

## Key files
- `src/attractor/core/validators/inputs-refs.ts` — extracted `iterateGateInputs`, added `checkGateUnknownSourceNode` + `checkGateSourceMissingOutputKey` wired into Block D before `checkOrphanOutput`.
- `src/attractor/tests/graph-validator-inputs.test.ts` — regression tests mirroring the 2026-05-11 incident (stale `[implement.done]` against a graph with only `batch_orchestrator`) and a key-missing case.
- `docs/superpowers/specs/2026-05-12-validator-skips-gate-input-refs-design.md` — design doc.
- `docs/superpowers/plans/2026-05-12-validator-skips-gate-input-refs.md` + `.dag.json` — implementation plan and DAG.

## Decisions and patterns
- Two TDD chunks (`c2`, `c3`) merged through `parallel-impl/*` branches; chunk 1 (`iterateGateInputs` extraction) landed as a pure refactor with byte-identical snapshot unchanged.
- Gate-side diagnostic messages use `Gate "<id>"` instead of `Agent "<name>"` to disambiguate from existing agent-surface emissions sharing the same `rule:` key.
- Audit of bundled gates: 0 stale refs — every existing qualified gate `inputs:` already resolves against a sibling `pipeline.dot` producer, so `graph-validator-byte-identical.test.ts.snap` regenerated with empty diff.

## Gotchas and constraints
- New rules wired immediately before `checkOrphanOutput` to keep the byte-identical snapshot delta contiguous; reordering would force snapshot churn unrelated to the rule itself.
- Gate-side rules reuse the existing rule keys (`unknown_source_node`, `source_missing_output_key`) — downstream `Diagnostic[]` consumers see the same `rule` strings on both surfaces; only `nodeId` distinguishes.

## Learnings from the run
- `batch_orchestrator` ran three times (`e79c` ✗ → `49c7` ✓ → `ffb3` ✓ after merge_resolver). The first attempt failed, merge_resolver intervened once, second orchestrator pass cleared remaining chunks. Pattern consistent with the c2/c3 parallel-branch shape this plan scheduled; not a new failure mode.

## Final verification
- test_result: pass
- test_summary: Single cycle clean. npm run build + npm test green (1493 passed, 3 skipped, 0 failed). All 15 scenarios validated clean; live-ran `gate` scenario as floor coverage (Proceed branch reached exit). No fixes needed.
