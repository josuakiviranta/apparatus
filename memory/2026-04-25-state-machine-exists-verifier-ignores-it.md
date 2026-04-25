---
date: 2026-04-25
run_id: 3b4d285b-1077-4635-8ed0-2ca6e7046322
plan: docs/superpowers/plans/2026-04-25-state-machine-exists-verifier-ignores-it.md
design: specs/2026-04-25-state-machine-exists-verifier-ignores-it-design.md
illumination: meditations/illuminations/2026-04-14T0600-state-machine-exists-verifier-ignores-it.md
test_result: pass
---

# State Machine Exists, Verifier Ignores It

## What was implemented

Closed three lifecycle-integrity gaps in the illumination state machine: verifier now reads `list_illuminations(status: open)` instead of globbing all `*.md`, the three `mark_*` MCP functions auto-commit their frontmatter writes (matching `writeIllumination`'s precedent), and `list_illuminations(status="archived")` now actually reads the `archive/` subdirectory. Bumped to v0.1.36.

## Key files

- M `pipelines/illumination-to-plan.dot` — verifier step 1 now calls `list_illuminations(status: open)`.
- A `src/cli/tests/illumination-to-plan-pipeline.test.ts` — pins the verifier prompt change.
- M `src/cli/mcp/illumination-server.ts` — auto-commit appended to `markImplemented`, `markDispatched`, `markArchived`; `listIlluminations` swaps `dir` to `archive/` when `status === "archived"`.
- M `src/cli/tests/illumination-server.test.ts` — round-trip tests (dispatch, archive) plus auto-commit observability tests for all three mark-* functions.
- M `package.json`, `IMPLEMENTATION_PLAN.md` — version bump to 0.1.36 + plan ledger.
- A `specs/2026-04-25-state-machine-exists-verifier-ignores-it-design.md` — design doc.

## Decisions and patterns

- **Duplication over abstraction.** The four-line `try/catch { execSync git add; execSync git commit }` is copy-pasted into all three `mark_*` functions, mirroring `writeIllumination:33-42`. No `gitAutoCommit()` helper extracted — design explicitly forbade introducing one because the existing precedent IS the contract.
- **Rename = one commit.** `markArchived` issues two `git add` calls (deleted source path + new archive path) before a single `commit`, so history records `meditate: archive <file>` as a clean rename rather than a transient delete-only state.
- **Test isolation gotcha — `mockReset` not `mockClear`.** Auto-commit tests in `illumination-server.test.ts` use `mockReset` so `mockImplementation` from neighboring fail-open tests does not leak. Documented inline in commit `5875b69`.
- **Defensive frontmatter filter retained on archive dir.** Even though every file in `archive/` should already have `status: archived`, the in-loop frontmatter check stays — a hand-edited stray file with wrong frontmatter is filtered out cleanly. No behavior change for top-level dir reads.
- **Out-of-scope guardrails honored.** `pipelines/illumination-to-implementation.dot` (newer pipeline using external `mark-*.mjs` script_files) was deliberately untouched; only `illumination-to-plan.dot` carried the live bug.

## Gotchas and constraints

- `archive/` directory absence is non-fatal — the existing `try/catch` around `readdirSync` returns `NO_ILLUMINATIONS_MESSAGE` on `ENOENT`. No pre-creation needed.
- The MCP commit `try/catch` swallows failures silently (no git, no repo, hooks rejecting). The file write is load-bearing; commit is best-effort durability. Same precedent as `writeIllumination`.
- Verifier's existing step-2 empty-handling (`If no files exist, return preferred_label: empty`) reads naturally over the new step 1 because `list_illuminations` returns the literal `No illuminations found.` — same empty-state signal.
- Engine, validator, and `agent-handler` were untouched. Fix is isolated to one prompt string + MCP-server logic.

## Final verification

- test_result: pass
- test_summary: Cycle 1: build clean; first full test run flaked on pipeline-app-integration.test.tsx (React 18 batching timing — passed 100% in isolation, full suite clean on re-run with 1076/1076). Targeted illumination-server.test.ts ran 101/101. Pipeline validate: ✔ 14 nodes, 18 edges. No regressions, no fixes needed.
