---
date: 2026-05-09
run_id: e52dc56a
plan: ./docs/superpowers/plans/2026-05-09-pipeline-failure-handoff-is-shallow.md
design: ./docs/superpowers/specs/2026-05-09-pipeline-failure-handoff-is-shallow-design.md
illumination: .apparat/meditations/illuminations/2026-05-07T2141-pipeline-failure-handoff-is-shallow.md
test_result: pass
---

# Pipeline failure handoff is shallow

## What was implemented
Pipeline-run's 2-line failure footer (`✗ pipeline failed at node …` + `trace: …`) replaced with a recipe-shape footer: bird's-eye line (node id + agent file + reason), investigation block (trace + raw-output + `pipeline trace --node-receive --full` inspect command), blank-line separator, retry block (`pipeline run --resume`). Same FailureHandoff event mirrored inside the Ink fail frame so scrollback and post-exit stderr stay in lockstep.

## Key files
- `src/cli/lib/agent-paths.ts` (new) — `resolveAgentFileForNode(node, dotDir)` returning relative `.md` path for agent/gate, null for tool/start/exit/conditional/store
- `src/cli/lib/failure-handoff.ts` (new) — `FailureHandoff` type, pure `renderFailureFooter` formatter, `loadFailureHandoff` JSONL reader
- `src/cli/commands/pipeline/run.ts` — tracer wrapper now forwards `onValidationFailure`; footer uses `renderFailureFooter`; emits `failure-handoff` event before `done()`
- `src/cli/components/PipelineApp.tsx`, `src/cli/lib/pipelineEvents.ts`, `src/cli/lib/pipelineReducer.ts` — new `failure-handoff` NodeEvent + StaticItem mirroring the recipe block
- `.apparat/scenarios/pipeline-failure-footer/pipeline.dot` (new) + `src/cli/tests/pipeline-failure-footer-scenario.test.ts` (new)
- `src/cli/tests/failure-handoff.test.ts`, `src/cli/tests/agent-paths.test.ts`, `src/cli/tests/jsonl-validation-failure-forwarded.test.ts`, `src/cli/tests/pipeline-failure-reason.test.ts`, `src/cli/tests/pipeline-app-integration.test.tsx`
- `README.md` — recipe-shape paragraph in trace/resume area
- `docs/superpowers/specs/2026-05-06-pipeline-command-orchestration-monolith-design.md` — new §3.6 Failure-footer contract (verifier flagged §3.7 as nonexistent in originating illumination — §3 ended at §3.5; §3.6 is the right home)

## Decisions and patterns
- `pipeline why` command dropped during chat refinement — the user's loop is footer → copy commands → paste into Claude → Claude runs commands, so a composed rollup doc is bloat. Footer-as-recipe (Alt A) achieves the same end with zero new commands and zero on-disk artefacts.
- Investigation commands and the retry command separated into two visual blocks with a blank line — `resume` is post-fix, mixing it with context-gathering creates noise during the understand phase.
- Latest-attempt `rawOutputPath` only in the footer; earlier attempts are reachable via the named `pipeline trace --node-receive --full` inspect line.
- Paths only — never inline file contents. Claude `cat`s the path itself.
- Single resolver helper (`resolveAgentFileForNode`) shared by stderr footer and Ink BlockCloseView so the two render sites can never drift.
- Tracer-wrapper bug surfaced en route: `src/cli/commands/pipeline/run.ts:147-155` omitted `onValidationFailure`, making `engine.ts:251`'s optional-chain call a no-op — fixed in commit `25bcdc5` before the renderer landed because `loadFailureHandoff` depends on those JSONL events.
- `Graph.nodes` is `Map<string, Node>` (`src/attractor/types.ts:75`); the speculative `as unknown as Node[]` fallback in early failure-handoff drafts was dead code, dropped in `54f4965`. `nodeReceiveId` coercion uses a `typeof` guard so a missing field yields `null` instead of the literal string `"undefined"`.

## Gotchas and constraints
- The footer renderer drops bracketed lines on null fields — tool nodes (no `.md` sibling) get a footer without the `(agent: …)` clause and without the `raw output: …` line; verified by the new scenario's negative assertions.
- `loadFailureHandoff` must degrade gracefully — unreadable trace / missing events return a partial handoff and the footer never throws. The whole node-failure code path is already in an error context; throwing here would mask the real failure.
- The Ink event must be emitted **before** `done()` flushes the frame, otherwise the `failure-handoff` StaticItem races the block-close summary out of scrollback. Locked by `src/cli/tests/pipeline-app-integration.test.tsx`.
- README "Inspecting a run" section + monolith spec §3.6 are now the contract anchors. Future footer changes should update both.

## Final verification
- test_result: pass
- test_summary: Cycle 1 clean: build green, 147 test files / 1368 tests pass; 5 included scenarios (pipeline-failure-footer, tool, store, missing-caller-var, tool-runtime-vars) ran end-to-end with the new recipe-shape footer rendering exactly as designed (✗ failed at runner: …, trace:, inspect: apparat pipeline trace … --node-receive … --full, blank line, resume: apparat pipeline run … --resume); inspect + resume recipe commands verified working in-window.
