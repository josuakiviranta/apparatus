---
date: 2026-05-07
run_id: c0af6a95
plan: docs/superpowers/plans/2026-05-07-prompt-assembly-invisible-until-runtime.md
design: docs/superpowers/specs/2026-05-07-prompt-assembly-invisible-until-runtime-design.md
illumination: .apparat/meditations/illuminations/2026-05-07T2008-prompt-assembly-invisible-until-runtime.md
test_result: fail
---

# prompt-assembly-invisible-until-runtime

## What was implemented
Nothing. The `implement` node returned `agent.success=true` but produced **zero code diff** for the prompt-assembly visibility work. Design doc and plan are written; the engine/CLI/docs changes the plan describes were not made.

## Key files
- `docs/superpowers/specs/2026-05-07-prompt-assembly-invisible-until-runtime-design.md` — design doc (untracked, written by `design_writer`)
- `docs/superpowers/plans/2026-05-07-prompt-assembly-invisible-until-runtime.md` — plan (tracked by prior commit; never executed)
- `.apparat/meditations/illuminations/.triage/c0af6a95/chat-notes.md` — chat-summarizer artifact (untracked)

No source files changed. `git log --oneline -25` shows no implementation commit between the plan being written and `tmux_tester` running. The most recent non-meditation commits all predate this run.

## Decisions and patterns
Refinements log (chat round 1) narrowed scope before implement ever ran:
- Ship steps 1, 2, 3, 4, 6 of the illumination only. Drop step 5 (`.last-rendered/` mirror); step 7 (`pipeline watch`) stays deferred.
- `pipeline preview <pipeline> --node <id> --var k=v` is the headline; everything else supports the same seam.
- `pipeline explain` output format: plain-text node list with `consumes:` / `produces:` / `branches:` / `next:` per node, plus separate Loops + Reachability sections. No ASCII art.
- `--var` parsing: literal substitution + agent-frontmatter defaults only. No env vars, no `$project` resolution.
- `assembleAgentPrompt` signature must be preserved during the pure-core split into `buildAgentPrompt`.
- Step 6 (docs) is mandatory: `pipelines.md` new §8 + §3 inputs-block subsection covering the `<sourceNode>_<localKey>` tag-mangling rule.

## Gotchas and constraints
- The illumination at `.apparat/meditations/illuminations/2026-05-07T2148-implement-node-no-op-passes-verification.md` predicted exactly this failure: `agent.success=true` is not the same as "code was written." The pipeline has no post-implement structural check that the plan's claimed paths now exist.
- `consume_plan` and `consume` (this node, step 7) will best-effort delete the plan and illumination from disk. The plan was **not implemented** — consuming it now would lose the work tracked there. See Learnings.

## Learnings from the run
- **Implement node was a no-op but reported success.** Trace shows `implement-827d agent ✓` (single iteration, `success=true`, sessionId `1eedbd82-d18e-43fd-bbfb-f1a0486ce561`). No retries, no agent loop. Yet `git status` reports clean tree apart from two untracked artifacts unrelated to the plan, and `git log --oneline -25` shows no commit attributable to run `c0af6a95` for prompt-assembly work. Root cause is upstream of this session: the implement-agent rubric exits success without verifying the plan's filesystem effects. Already filed: `2026-05-07T2148-implement-node-no-op-passes-verification.md`.
- **Tmux-tester correctly caught the no-op** but the user pressed `Commit` at the `tmux_confirm_gate` despite `test_result=fail`. The terminal-node lifecycle calls (step 7a/7b) will still consume the plan and illumination — burning both. Future memory-mining: when `tmux_tester.test_result=fail` is followed by `tmux_confirm_gate.choice=Commit`, treat the lifecycle calls as suspect; consider gating `consume_plan` on `test_result != "fail"`.
- **Pipeline trace remains shallow on agent no-ops.** `apparat pipeline trace c0af6a95` shows node start/end + iteration count but no diff snapshot pre/post implement. A `git diff` capture in the implement node would have made the regression obvious in the trace itself rather than only via tmux-tester.

## Final verification
- test_result: fail
- test_summary: Cycle 1 only: build green, 1331/1331 unit+integration tests pass, all 14 scenarios validate clean. CRITICAL: implement node committed nothing — design doc and plan exist (untracked + tracked respectively) but zero code diff for the prompt-assembly illumination (no `preview.ts`, no `explain.ts`, no `agent-prep.ts` pure-core split, no `trace.ts` edit, no `program.ts` registration, no `pipelines.md` update). Live `apparat pipeline run static-multi-node` also surfaces pre-existing agent-name `_` vs `-` resolver mismatch, but that is out of scope for this triage.
