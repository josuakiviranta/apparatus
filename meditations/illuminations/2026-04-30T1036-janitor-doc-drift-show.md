---
date: 2026-04-30
status: open
description: ralph pipeline show is implemented and registered in program.ts but has no entry in specs/commands.md — the command spec is the pipeline's verifier ground truth and the gap means any illumination reasoning about pipeline show behavior cannot be verified.
---

## Findings

### 1. `ralph pipeline show` is implemented but absent from `specs/commands.md`

- **What:** `pipelineShowCommand` is exported from `src/cli/commands/pipeline.ts:951`, registered as a subcommand at `src/cli/program.ts:268`, and surfaced in the help text at `src/cli/program.ts:54` (`"Render a pipeline as SVG next to the source"`) — but `specs/commands.md` has no `### ralph pipeline show` section. Every other pipeline subcommand (`run`, `list`, `validate`, `refine`, `trace`, `create`) has a dedicated spec section. `pipeline show` is the lone gap.
- **Evidence:**
  - `src/cli/program.ts:54`: `ralph pipeline show workflow.dot                 Render a pipeline as SVG next to the source`
  - `src/cli/program.ts:258-259`: `ralph pipeline show pipelines/illumination-to-implementation/pipeline.dot`
  - `specs/commands.md`: grep for `pipeline show` returns zero matches; `### ralph pipeline` sections end at `### ralph pipeline create` (line 212).
- **Why it matters:** The pipeline verifier uses `specs/commands.md` as ground truth to evaluate whether an illumination's command-behavior claims are correct. Any illumination that reasons about `pipeline show` flags, exit codes, or SVG output paths will pass verification unchallenged — the spec doesn't exist to refute it. `2026-04-27T1459-pipeline-show-two-open-seams.md` diagnosed two concrete open seams in `pipeline show` (duplicate `formatDiag` copy + no SVG staleness guard) but that illumination cannot be verified against spec because there is no spec.
- **Suggested action:** Add a `### ralph pipeline show <dotfile> [--project <folder>]` section to `specs/commands.md` describing: (1) flag surface, (2) SVG output path convention, (3) exit codes (validate-first behavior), (4) staleness semantics. This closes the verifier blind spot for the command and provides ground truth for T1459's two open seams.

### 2. `meditate-backpressure-guard` feature confirmed NOT shipped — plan genuinely pending

- **What:** `docs/superpowers/plans/2026-04-12-meditate-backpressure-guard.md` (status: pending) prescribes a pre-session guard checking unprocessed illumination count before `ralph meditate` runs. Grep across `src/**/*.ts` for `backpressure`, `unprocessed.*count`, and `illumination.*count` returns zero hits in the engine or heartbeat paths.
- **Evidence:** `grep backpressure src/` — no matches in production code; only `src/cli/tests/illumination-server.test.ts:1220,1224,1229,1232` reference the plan filename as a test fixture, not a feature.
- **Why it matters:** T0834 left this plan as "genuinely pending" pending backfill of an `illumination_source:` field pointing to `2026-04-14T0300-meditate-has-no-backpressure.md` (open). Without the cross-reference, both the plan and the illumination remain orphaned from the reconciliation loop. This is the second pass confirming the feature has not shipped — it is safe to deprioritize in favor of backfilling the cross-reference.
- **Suggested action:** Add `illumination_source: 2026-04-14T0300-meditate-has-no-backpressure.md` to the plan's YAML frontmatter. One-line edit; unblocks future janitor closure once the guard actually ships.

## Lifecycle changes this run

- `mark_plan_implemented("2026-04-12-top-level-directory-map.md")` — plan `status: pending → implemented`. Evidence: `README.md:179` contains `## Directory Map` section — the plan's prescribed artefact is present. T0834 established this evidence in the prior run; this run executes the closure.
- No `mark_implemented` calls — all five dispatched illuminations remain blocked: T0600/T1000/T1100 plans are `status: pending`; T0900/T2000 plan_paths are orphan plans with no frontmatter.

## Reading thread

- `2026-04-30T0834-janitor-stale-plan-audit.md` — proposed closing `top-level-directory-map` in a future run with grep evidence; this run executes that closure and confirms the README has the prescribed `## Directory Map` section. Also established `meditate-backpressure-guard` as genuinely pending.
- `2026-04-27T1459-pipeline-show-two-open-seams.md` — documented two open seams in `pipeline show` (`formatDiag` duplication, no SVG staleness guard); finding 1 above is the prerequisite for closing those seams — without a spec, the verifier cannot evaluate the fixes when they land.
- `2026-04-19T0600-specs-commands-missing-three-pipeline-subcommands.md` (implemented) — the prior instance of this exact pattern: `validate`, `refine`, and `trace` were absent from `specs/commands.md` and that illumination drove a spec backfill. `pipeline show` is the same gap one version later.
