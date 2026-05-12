---
date: 2026-05-12
run_id: parallel-illumination-to-implementation-d1e37dba
plan: docs/superpowers/plans/2026-05-12-trace-inspector-shallow-out-of-process.md
design: docs/superpowers/specs/2026-05-12-trace-inspector-shallow-out-of-process-design.md
illumination: .apparat/meditations/illuminations/2026-05-11T1630-trace-inspector-shallow-out-of-process.md
test_result: pass
---

# trace-inspector-shallow-out-of-process

## What was implemented

Pure refactor: extracted the inline `--node-receive` formatter at `src/cli/commands/pipeline/trace.ts:31-86` into a new `src/cli/lib/node-receive-inspector.ts` module exporting `renderNodeReceive(snapshot, opts) → string[]` and `inspectCommand(runId, id, { full }) → string`. Three hand-rolled `apparat pipeline trace … --node-receive …` template literals (`PipelineRunView.tsx:196` no-`--full`, `PipelineRunView.tsx:234` with-`--full`, `failure-handoff.ts:49` with-`--full`) now call the shared builder. Zero user-visible behavior change; byte-parity enforced by existing assertions plus a new test.

## Key files

- A `src/cli/lib/node-receive-inspector.ts` (1d1300d, a1beea1 stub)
- A `src/cli/tests/node-receive-inspector.test.ts` (1d1300d)
- M `src/cli/commands/pipeline/trace.ts` (9c6867c — calls `renderNodeReceive`)
- M `src/cli/components/PipelineRunView.tsx` (4bd4503 — calls `inspectCommand` for live + failure recipe lines)
- M `src/cli/tests/pipeline-run-view.test.tsx` (733fbdc — pins live recipe omits `--full`)
- M `src/cli/lib/failure-handoff.ts` (7a2bcb1 — calls `inspectCommand` for stderr footer)

## Decisions and patterns

- Scope locked to steps 1+2 of the illumination during chat refinement. Steps 3 (`i` hotkey), 4 (recipe-line trim), 5 (inline failure snapshot), 6 (`--diff` flag) all deferred or rejected — user explicitly preserved the printed full command as the cross-session handoff "lingua franca".
- `inspectCommand({ full: true })` MUST emit `--full`; `inspectCommand({})` MUST omit it. Byte parity is pinned by `failure-handoff.test.ts:39/71`, `pipeline-failure-reason.test.ts:69`, `pipeline-failure-footer-scenario.test.ts:58` — do not touch those snapshot strings without a deliberate contract change.
- The drift the illumination flagged (`PipelineRunView.tsx:196` missing `--full` while `:234`/`failure-handoff.ts:49` include it) is preserved verbatim by the new builder — `:196` is the *live* `received context:` recipe and is intentionally `--full`-less; `:234` and `failure-handoff.ts:49` are post-run failure footers and intentionally include `--full`.
- Parallel-impl DAG produced two chunks (`c1` module + tests, `c2` template-literal migration); merged via `76a4e91` and `1abb967`.

## Gotchas and constraints

- Sibling drift surface flagged but out of scope: TUI failure-handoff JSX block (`PipelineRunView.tsx:222-239`) duplicates CLI `renderFailureFooter`. Unification is a separate larger refactor.
- README.md operator-recipe citations live at `:79`, `:92`, `:94` — re-grep before any future edit; this slice did not touch README, but planning step verified the lines were stable at HEAD.
- Step 3 (`i` hotkey) deferral has a hidden cost: `PipelineRunView.tsx:130` currently stores only `hasContext: boolean` in the `received-context` `StaticItem`. Implementing the hotkey requires plumbing the full `contextSnapshot` through the `StaticItem` data model.

## Learnings from the run

- Node `chat_session` failed once (chat_session-4423 ✗) then re-ran cleanly (chat_session-5285 ✓). One retry, no fixes propagated downstream — fail-then-succeed pattern, not a systemic issue. Pipeline run outcome shows `failure` because of this single retry, but the workflow re-entered chat_summarizer → verifier → explainer → approval_gate cleanly and tmux-tester passed cycle 1.
- tmux-tester needed **zero** fix cycles. Cycle 1 build + 1550/1553 tests green; `pipeline-failure-footer` scenario verified both inspect-command shapes end-to-end. Clean run on a pure-refactor scope is the expected outcome.

## Final verification

- test_result: pass
- test_summary: Cycle 1 clean: build green, 1550/1553 tests passed (3 skipped). pipeline-failure-footer scenario ran end-to-end and emitted both inspect-command shapes correctly — live `received context: apparat pipeline trace …--node-receive runner-b7a8` (no `--full`) and failure footer `inspect: …--node-receive runner-b7a8 --full`. Trace command (`apparat pipeline trace … --node-receive … --full`) rendered header + 4-key context snapshot + completed stages via extracted `renderNodeReceive`. No fixes needed.
