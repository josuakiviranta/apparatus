---
date: 2026-05-07
description: Lifecycle nodes consume_plan and consume delete plan + illumination even when tmux_tester.test_result=fail, because they only branch on tmux_confirm_gate.choice — a Commit on a failed test burns the work.
---

## Core Idea

Terminal lifecycle nodes `consume_plan` and `consume` in `illumination-to-implementation.dot` branch on `tmux_confirm_gate.choice` alone. When `tmux_tester.test_result=fail` but the user picks `Commit` at the confirm gate (intentionally or by misclick), both lifecycle nodes still fire — best-effort deleting the plan file and the illumination file from disk despite the implement node having produced zero code. The work tracked in those files is lost while the underlying problem remains unsolved.

## Why It Matters

Run `c0af6a95` (this session) demonstrates the failure end-to-end:

- `implement.success=true`, `implement.iterations=1`, but `git status` reports a clean tree and `git log` shows no implementation commit.
- `tmux_tester.test_result=fail` with a precise summary: "implement node committed nothing — design doc and plan exist … but zero code diff."
- `tmux_confirm_gate.choice=Commit` was nonetheless selected.
- The pipeline then proceeded to the lifecycle terminals. `consume_plan` and `consume` will best-effort delete `docs/superpowers/plans/2026-05-07-prompt-assembly-invisible-until-runtime.md` and `.apparat/meditations/illuminations/2026-05-07T2008-prompt-assembly-invisible-until-runtime.md` — even though no code was written for them.

The memory file at `.apparat/sessions/2026-05-07-prompt-assembly-invisible-until-runtime.md` flags this directly: *"the terminal-node lifecycle calls (step 7a/7b) will still consume the plan and illumination — burning both."* That is one user misclick away from losing both the plan and the source illumination with no implementation behind either.

This compounds the already-filed `2026-05-07T2148-implement-node-no-op-passes-verification.md`: even when tmux-tester correctly catches a no-op, the `Commit` choice at the next gate is destructive in a way the user would not necessarily expect — the gate's name suggests it gates a `git commit`, not a filesystem deletion of the plan and illumination.

## Revised Implementation Steps

1. **Inspect `illumination-to-implementation.dot`** — locate the `tmux_confirm_gate` node and its outgoing edges into `commit_push`, `consume_plan`, and `consume`. Confirm the current branch labels (`Commit` / `Retry` / `Quit` or similar) and whether any condition references `tmux_tester.test_result`.

2. **Add a precondition to the lifecycle terminals.** Either (a) introduce an explicit gate node `safe_to_consume` with `consumes: [tmux_tester.test_result, tmux_confirm_gate.choice]` that branches `proceed` only when `test_result == "pass" && choice == "Commit"`, routing the `fail+Commit` case to a new `force_commit_no_consume` terminal that runs `commit_push` but skips `consume_plan` and `consume`; or (b) wire `consume_plan` and `consume` directly to consume `tmux_tester.test_result` and no-op when it is `fail`.

3. **Rename or annotate the `Commit` choice when `test_result=fail`.** In `gates/tmux-confirm-gate.md` (or wherever the gate's choice text lives), make it clear that `Commit` on a failed test will commit the artifact paths (design doc, etc.) but **not** consume the plan or illumination. Two-line description per choice, mirroring the existing `Retry` / `Quit` framing.

4. **Add a regression scenario** under `.apparat/scenarios/` (e.g. `tmux-fail-commit-skips-consume/`) that drives a tmux_tester returning `fail`, a confirm_gate choice of `Commit`, and asserts that `consume_plan` and `consume` did not run. Include the asserted run-trace shape so future regressions are caught by `pipeline validate` plus a focused `pipeline run`.

5. **Update `pipelines.md` §<lifecycle-section>** to document the invariant: *terminal lifecycle nodes (`consume_plan`, `consume`) run only when `tmux_tester.test_result == "pass"`*. Cross-link from the gate-design subsection so future pipeline authors copying this shape inherit the rule.

6. **Backfill provenance into the run-trace.** When a lifecycle terminal is skipped because of this gate, log a structured trace event `lifecycle_skipped` with `reason: "tmux_tester.test_result=fail"` so `pipeline trace <run>` makes the skip visible (this also addresses the shallow-trace pattern noted in run `c0af6a95`'s memory).

## Provenance

- Source memory: `.apparat/sessions/2026-05-07-prompt-assembly-invisible-until-runtime.md`
- Pipeline run id: `c0af6a95`
- Surfaced by: memory-reflector
