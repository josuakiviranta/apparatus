---
date: 2026-05-11
run_id: parallel-illumination-to-implementation-df1d9cf6
plan: docs/superpowers/plans/2026-05-11-pipeline-shims-hide-pipeline-dot.md
design: docs/superpowers/specs/2026-05-11-pipeline-shims-hide-pipeline-dot-design.md
illumination: .apparat/meditations/illuminations/2026-05-11T1551-pipeline-shims-hide-pipeline-dot.md
test_result: pass
---

# Pipeline shims hide pipeline.dot — CLI surface unification

## What was implemented
`apparat implement` and `apparat meditate` collapsed to thin Commander aliases over `pipelineRunCommand`. Dropped `--max` and `--scenarios` flags from `implement`. Promoted `--steer` to first-class flag on `meditate`. Unified positional shape to `apparat <pipeline> <project>` across `implement`, `meditate`, and `pipeline run`. Shared bootstrap (PID lock, gitignore append, ensureDirs, tmux preflight) extracted to `src/cli/lib/pipeline-bootstrap.ts`.

## Key files
- `src/cli/commands/implement.ts` — collapsed to thin shim; `--max`/`--scenarios` removed
- `src/cli/commands/meditate.ts` — collapsed to thin shim; `--steer` first-class
- `src/cli/lib/pipeline-bootstrap.ts` — new shared bootstrap module
- `src/cli/program.ts` — unified positional shape; `--project` retained as deprecated alias for `pipeline run`
- `src/cli/tests/implement.test.ts` — `--max`/`--scenarios` tests deleted
- `src/cli/tests/meditate.test.ts` — PID-lock tests migrated out
- `src/cli/tests/pipeline-bootstrap.test.ts` — new test home for migrated bootstrap tests
- `src/cli/tests/pipeline-shape-parity.test.ts` — drift guard across three shims
- `src/cli/tests/pipeline-run-positional.test.ts` — covers `pipeline run` positional/flag precedence
- `README.md` — examples updated to unified shape; `--steer` ↔ `--var steer=` equivalence noted
- `docs/superpowers/specs/2026-05-11-pipeline-shims-hide-pipeline-dot-design.md` — design
- `docs/superpowers/plans/2026-05-11-pipeline-shims-hide-pipeline-dot.md` — plan
- `docs/superpowers/plans/2026-05-11-pipeline-shims-hide-pipeline-dot.md.dag.json` — DAG schedule

## Decisions and patterns
- **Hard removal, no alias.** `--max` and `--scenarios` deleted outright; escape hatch is generic `--var max_iterations=N` / `--var scenarios_dir=…` via `pipeline run`. User confirmed they never invoke either flag; pipeline.dot defaults cover the safe path.
- **`--steer` kept as first-class** because user invokes it daily. Implemented as one-line translation to `--var steer=<text>`, not a new file format.
- **No `pipeline.toml`.** Original illumination proposed a declarative sibling file; user rejected as format-creep. Bootstrap stays in TypeScript (`pipeline-bootstrap.ts`).
- **`--project <folder>` retained as deprecated alias** on `pipeline run` to keep heartbeat-scripted invocations working through the deprecation window; positional precedence is explicit.

## Gotchas and constraints
- Shape-parity drift guard (`pipeline-shape-parity.test.ts`) is the future safety net — if anyone re-adds a bespoke flag, the test fires.
- `implement` and `meditate` bootstrap order is now driven by `pipeline-bootstrap.ts`; touching one shim's bootstrap means touching the shared module, not the per-command file.
- Heartbeat ripple is zero only because heartbeat shells out through the CLI shim path. Any future code that imports `implement.ts` / `meditate.ts` directly will inherit the now-thin behaviour — bootstrap will not run.

## Learnings from the run
- `batch_orchestrator` ran `iterations: 2` and `merge_resolver` ran `iterations: 2` — conflict cycle observed. Resolver succeeded on the second pass; commit `8631fda` documents the orchestrator early-termination bug that was patched mid-run when the orchestrator emitted `done=true` after the first conflict and short-circuited remaining ready batches. Chunk c4 had to be added manually after the early-exit bug surfaced.
- `tmux_confirm_gate` instance `58a2` ✗ then `1af5` ✓ — gate retried once. Earlier sub-fix `tmux_confirm_gate.md` had stale `$implement.done` refs (copy-paste from sequential pipeline); patched in the same `8631fda` commit to use `$batch_orchestrator.done` / `$batch_orchestrator.reason`.
- Run trace `outcome: failure` despite `tmux_tester.test_result=pass` — the failure flag reflects the earlier in-run pipeline definition bugs (orchestrator early-exit, stale gate refs) that were patched as the run progressed, not the final implementation outcome.

## Final verification
- test_result: pass
- test_summary: Cycle 1 clean: build green, 1472 tests passed (1 skipped), tool scenario reached exit, implement/meditate help output reflects spec (no --max/--scenarios on implement; --steer first-class on meditate). No fixes needed.
