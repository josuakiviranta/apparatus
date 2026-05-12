---
date: 2026-05-12
run_id: parallel-illumination-to-implementation-df12c8e4
plan: docs/superpowers/plans/2026-05-12-pipeline-write-consume-pairing.md
design: docs/superpowers/specs/2026-05-12-pipeline-write-consume-pairing-design.md
illumination: .apparat/meditations/illuminations/2026-05-12T1033-pipeline-write-consume-pairing.md
test_result: pass
---

# pipeline-write-consume-pairing

## What was implemented

Asymmetric, success-gated GC at pipeline tail: on green outcome, `run.ts` finally block now deletes `.apparat/runs/<run_id>/` plus the matching `.triage/<run_id>/chat-notes.md`; on red, both are preserved for debugging. Quantity-based `APPARAT_RUNS_KEEP` cap (pipeline START) is untouched.

## Key files

- `src/cli/commands/pipeline/runs-gc.ts` — new success-aware helper (`cleanupRunArtifacts`).
- `src/cli/commands/pipeline/run.ts` — wired helper into the finally block, keyed on `result.status === "success"`.
- `src/cli/commands/pipeline/trace.ts` — ADR-0015 hint line when run dir is missing on a successful run.
- `src/cli/tests/post-tail-gc.test.ts` — new unit tests for the helper.
- `src/cli/tests/pipeline-run-runid.test.ts`, `src/cli/tests/pipeline-runs-gc.test.ts`, `src/cli/tests/pipeline-trace-command-validation.test.ts` — extended.
- `docs/adr/0015-asymmetric-gc-pipeline-tail-success.md` — new ADR codifying the rule, cites ADR-0002 + `memory-writer.md:145`.
- `README.md` — retention paragraph reworded around success-gated tail GC vs quantity cap.

## Decisions and patterns

- **Asymmetric on `result.status`, not on exit code.** The finally block already has `result.status` from line 225 — no plumbing through `onPipelineEnd` was needed. Engine-level outcome plumbing was considered (and noted in the verifier blast radius) but the cheaper read-from-result path was preferred.
- **`APPARAT_RUNS_KEEP` keeps its keep-last-N contract on the failure side.** Green runs are always deleted at tail; red runs fall through to the existing quantity cap on the next run's START. No new env var, no contract conflict.
- **Trace command degrades gracefully.** `apparat pipeline trace <runId>` on a consumed (green) run prints an ADR-0015 hint line instead of an opaque exit-1; the hint cites the ADR by number so a reader can find the rule fast.
- **Scope held at S.** Lifecycle frontmatter, validator artefact-flow rule, `consume_design` MCP, and retroactive cleanup of the 93+18 already-accumulated dirs were all explicitly dropped during chat_session. The shipped change is a narrow extension of the existing success-gated `consume` seam from `memory-writer.md:145`.

## Gotchas and constraints

- Green-tail GC permanently removes `.apparat/runs/<run_id>/pipeline.jsonl`; the trace file is gone for successful runs. If you need to inspect a green run after the fact, you cannot — by design. The ADR-0015 hint is the only signal a reader gets.
- `.triage/<run_id>/chat-notes.md` is keyed on `<run_id>`, not on the chat-summarizer's hardcoded path at `chat-summarizer.md:22`. The hardcode was left as-is (cleanup happens at the current path, no repath); future moves of that path must update the GC keying.
- The rule is forward-looking. The 93 run dirs and 18 triage dirs already on disk before this commit are untouched. Anyone cleaning those up is doing a separate chore — not this rule.

## Learnings from the run

- `design_writer` retried once (`design_writer-6f97` ✗ → `design_writer-f401` ✓ in the trace). Worth a future memory-mining pass to check whether the first failure was content-related or transient.
- `batch_orchestrator` ran twice (`-ec68` → `merge_resolver-561f` → `-a4ec`), which is the expected DAG conflict-resolution path for a 4-chunk plan; not a retry, but worth noting that 4 sibling chunks merged cleanly with one resolver pass.
- Tester reported one flake: `src/attractor/tests/tool-handler.test.ts:320` failed once in the suite but passes in isolation; file is not in the diff. Pre-existing flake, not introduced here.

## Final verification

- test_result: pass
- test_summary: One cycle. Build green; 1568/1572 tests pass; 1 failure in src/attractor/tests/tool-handler.test.ts:320 is a flake — passes in isolation, file unrelated to diff (touches only run.ts, runs-gc.ts, trace.ts, README.md, ADR-0015). 3 representative tool-scenarios driven through tmux (tool, pipeline-failure-footer, tool-runtime-vars): success runs GC'd their .apparat/runs/<run_id>/ at tail, failure run preserved its dir, and `apparat pipeline trace` emits the ADR-0015 hint on the consumed run.
