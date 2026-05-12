# Chat round notes — 2026-05-12T11:00

## What the user raised

- **Context-loss risk for unconsumed artefacts**: "even if something does not get consumed in the pipeline run immediately is there a risk to lose context?" — user wanted the codebase studied first before approving the illumination's blanket consume-seam rule.
- **Off-limits: institutional memory**: "at least meditations/illuminations and meditations/stimuli should not be touched." Don't add new auto-delete behavior to these.
- **Real trash exists**: "it is true that pipeline runs probably produce trash files that should be removed after the run is successfully over."
- **Failure preserves debugging context**: "if run have errors those files are useful to give claude for debugging." Keep trash on failed runs.
- **Scope tightening**: "Can we just focus on C and D -> those are real trash that should get cleaned." Drop specs, sessions, and the broad lifecycle-frontmatter generalization. Focus only on run artefacts and chat-notes.

## Conclusions reached

- **Scope drops from M to S.** Original illumination proposed a universal `lifecycle:` frontmatter system across ~45 surfaces (29 agent .md files, 10 validator files, MCP tool, ADR, 4 ADR touch points, 3 CONTEXT.md sections, ~5 test files, 3 new test suites). New scope is only the two trash categories below.
  - Came from: user scoping reply "Can we just focus on C and D"
  - Rationale: only categories C (`.apparat/runs/<run_id>/`) and D (`.triage/<uuid>/chat-notes.md`) are unambiguously trash. Everything else functions as institutional memory.

- **Specs (`docs/superpowers/specs/*-design.md`) stay untouched.** No `consume_design` MCP tool. No auto-deletion. No one-shot GC pass over the 32 existing specs.
  - Came from: user scoping reply (C+D only)
  - Rationale: agent studies showed no cross-run reader today, but the `the-filesystem-as-agent-memory.md` stimulus frames committed docs as memory that survives context resets. Permanent `git rm` is irreversible; specs may be needed for "why did we design it this way?" months later.

- **Sessions (`.apparat/sessions/*.md`) stay untouched.** Memory-writer actively reads prior sessions to mine patterns; deleting them destroys institutional memory.
  - Came from: user statement "meditations/illuminations and meditations/stimuli should not be touched" combined with C+D scoping
  - Rationale: same memory-protection logic the user gave for meditations applies to sessions — they are read cross-run by memory-writer/memory-reflector.

- **Illuminations and stimuli stay untouched.** No new behavior added. The existing `consume` seam in `memory-writer.md` (suppressed on `tmux_tester_test_result=fail`) keeps working as today.
  - Came from: user explicit statement "meditations/illuminations and meditations/stimuli should not be touched"
  - Rationale: institutional-memory protection; both are read cross-run by future pipelines.

- **Category C — `.apparat/runs/<run_id>/` cleanup on success, keep on failure.** After a successful pipeline tail (tmux_tester or equivalent green signal), GC the run directory: `checkpoint.json`, per-node `status.json`, `pipeline.jsonl`. On failure, keep everything for debugging.
  - Came from: user "pipeline runs probably produce trash files that should be removed after the run is successfully over" + "if run have errors those files are useful to give claude for debugging"
  - Rationale: asymmetric success/failure handling. Matches existing pattern at `memory-writer.md:262-267` where `consume_plan` and `consume` are gated on `tmux_tester_test_result != "fail"`.

- **Category D — `.triage/<uuid>/chat-notes.md` is run-scoped handoff trash.** Either repath under `.apparat/runs/<run_id>/chat-notes.md` so it dies with the run, or apply the same success-only GC at the existing path. Either way it gets cleaned on green tail, kept on red tail.
  - Came from: user C+D scoping
  - Rationale: agent study confirmed only same-run readers (chat-summarizer → verifier|explainer). No cross-run reader exists.

- **Asymmetric success/failure rule is the core mechanism, not a new frontmatter system.** No `lifecycle: { artefact, consume_via, ephemeral }` block on every agent .md. No validator artefact-flow rule. No `consume_design` MCP tool. The new work is just GC of run-scoped paths gated on terminal pipeline state.
  - Came from: user scoping C+D only
  - Rationale: scope shrinks from "build a new declarative system" to "extend the existing success-gated cleanup pattern to two more paths." Smaller blast radius, fewer breaking changes, no new validator rules.

- **chat-summarizer.md hardcoded path issue is mooted by scope.** Original illumination flagged `chat-summarizer.md:22` hardcodes `.triage/$run_id/chat-notes.md` as a breaking change. If chat-notes is repathed, this must change atomically; if cleanup happens at the existing `.triage/` path, no repath needed.
  - Came from: scope reduction
  - Rationale: implementation can choose simpler path (clean at current location) if repath introduces coordination cost.

- **ADR-0015 still appropriate but narrower.** Codify "pipeline run artefacts under `.apparat/runs/<run_id>/` and chat-notes triage are deleted on green tail, preserved on red tail." Does NOT generalize to "every artefact has a consume seam." Cite ADR-0002 (`consume(filename, reason)`) and `memory-writer.md:262-267` as direct precedent for the success-gated pattern.
  - Came from: scoping reduction
  - Rationale: ADR captures the rule that actually got agreed, not the generalized one.

- **Parallel pipeline re-validation step is dropped from scope.** Without the new `lifecycle:` validator rule, there is nothing new to re-validate against the parallel pipeline. The parallel pipeline inherits the same run-scoped GC.
  - Came from: scope reduction
  - Rationale: validator rule was deleted from scope, so its consumer in step 7 is moot.

## Open questions

- **Where does the green/red signal come from in `parallel-illumination-to-implementation`?** The linear pipeline uses `tmux_tester.test_result`. The parallel pipeline has the same tail (verified earlier), so presumably same signal — but the design step should confirm there isn't an earlier failure mode (e.g. `merge_resolver` failing mid-fanout) that should also suppress cleanup. Deferred because: implementation detail for the design agent.
- **Does an existing janitor or run-folder GC already do part of this?** One earlier agent mentioned "the existing run-folder janitor"; janitor.md was confirmed read-only. The design step should resolve whether this is net-new code or extending an existing seam. Deferred because: requires a focused look at any existing GC code paths.
- **Cleanup of pre-existing accumulation (93 run dirs, 17 triage dirs)**: out of scope by the user's "focus on C and D" framing, which is forward-looking. If desired as a separate one-pass cleanup, it would be a sibling chore commit, not part of the rule itself. Deferred because: user did not ask for retroactive cleanup.
