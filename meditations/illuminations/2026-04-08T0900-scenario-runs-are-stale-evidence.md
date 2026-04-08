---
date: 2026-04-08
description: 'The `scenario-runs/` folder looks like proof that features work, but it is a graveyard of past runs that no longer reflect current behavior.'
---

# Scenario Runs Are Stale Evidence

## Core Idea

The `scenario-runs/` folder looks like proof that features work, but it is a graveyard of past runs that no longer reflect current behavior. Two of the five scenario run records are now actively misleading: one shows a FAIL for a bug that was already fixed (`run-scenarios` output directory, commit `855daea`), and one shows OLD box-drawing markers (`┌─ MAIN AGENT`) passing — markers that no longer exist in the code. Neither record updates automatically when code changes.

## Why It Matters

Scenario runs are the primary human-readable evidence layer in this project. When an agent or developer scans `scenario-runs/` to understand project health, they see a FAIL for `run-scenarios` and infer the command is broken. It isn't — the bug was fixed. They see a PASS for `stream-formatter` with `┌─ MAIN AGENT` markers and infer the formatter works — but those markers were replaced by `▶ MAIN AGENT` in the 0.0.25 refactor. The scenario test script was updated (`test-stream-formatter.sh` now checks for `▶`/`◀` markers), but the recorded run wasn't refreshed. The evidence is pointing at a version of the code that no longer exists.

The `proof-of-work-proof-of-usage` problem applies here directly: scenario run artifacts look like proof of usage but are only proof of past work. There is no mechanism in the folder to signal staleness. A timestamp in the filename communicates *when* the run happened, not whether it is still valid.

There is also one uncommitted change: `src/daemon/runner.ts` is modified but unstaged. It may be a minor fix or cleanup, but it is invisible until committed.

## Revised Implementation Steps

1. **Commit or revert `src/daemon/runner.ts`.** The file has unstaged changes. Run `git diff src/daemon/runner.ts`, understand the change, and either commit it with a clear message or revert it. Do not let it drift.

2. **Build current dist and re-run all five scenario tests.** Run `npm run build`, then run each script under `scenario-tests/` manually or via `ralph run-scenarios . --all`. Record fresh results in `scenario-runs/`. The stream-formatter test should pass with new `▶`/`◀` markers. The run-scenarios test should now pass (output directory bug was fixed).

3. **Delete or archive the two stale scenario run records.** Remove `2026-04-07T1627-run-scenarios-command-end-to-end.md` and `2026-04-07T1627-stream-formatter-output-markers.md` — or move them to an `archive/` subfolder. Their current presence misleads without context.

4. **Add a `scenario-runs/README.md` that explains the staleness model.** One sentence: "Each file is a snapshot of one scenario run at a point in time. After a major code change, re-run all scenarios to refresh." This makes the evidence model explicit rather than implied.

5. **Treat "re-run all scenario tests" as a mandatory step after any refactor that changes observable output.** The 0.0.25 stream-formatter refactor changed every marker the stream-formatter emits — and no scenario test was re-run afterward. A checklist item in IMPLEMENTATION_PLAN.md is not enough; the actual run records must be refreshed before marking work complete.
