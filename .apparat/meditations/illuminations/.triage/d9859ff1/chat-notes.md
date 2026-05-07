# Chat round notes — 2026-05-07T19:20

## What the user raised
- Bloat concern on new commands: "Feels like a bloat at this moment" — questioning whether the proposed `pipeline runs` and `pipeline replay` subcommands are needed.
- Folding pushback: "What why fold ? Can we just skip these new commands? Whats the point and use of folding those ??" — rejected the idea of folding `runs`/`replay` into existing commands as a compromise; wanted to know whether they can simply be dropped.
- Trace usefulness: asked for a concrete situation where they would use `pipeline trace`. After hearing the forensic-only scenarios (failed-node context, weird LLM gate output, variable interpolation debugging) and that frequency is rare, said: "Bah sounds complicated leave pipeline trace out."

## Conclusions reached
- Drop the proposed `pipeline runs` subcommand entirely.
  - Came from: Bloat concern on new commands.
  - Rationale: User wants to avoid adding new CLI surface that adds cognitive load when the deepened `pipeline list` already surfaces the most recent run per pipeline, which covers the common post-mortem need.
- Drop the proposed `pipeline replay <runId>` subcommand entirely (no Ink-renderer reuse for replay).
  - Came from: Bloat concern on new commands; folding pushback.
  - Rationale: User explicitly rejected adding new commands, and rejected folding the replay behavior into existing commands as a compromise — wants to skip the work, not relocate it.
- Leave `pipeline trace` completely untouched in this scope. No Ink replay, no `--node-receive` demotion, no `--text` fallback rename, no auto-select-latest sweetener.
  - Came from: Trace usefulness ("Bah sounds complicated leave pipeline trace out").
  - Rationale: User judged the forensic use cases too rare to justify any churn on the trace command; current text-dump behavior is acceptable for the 1-in-20 forensic case.
- Final in-scope work is four modifications to existing surface only:
  1. Fix the lying `apparat pipeline create` hint in `src/cli/commands/pipeline/list.ts:16` and `:23` — replace with the real authoring path (no new `pipeline create` command).
  2. Deepen `pipeline list` into a per-pipeline status view (validity ✓/✗, schedule, last-run outcome + runId, SVG fresh/stale), with `--brief` retained for scripts.
  3. Auto-render SVG on `pipeline validate` success when source is newer than the colocated SVG.
  4. Surface heartbeat schedule inside the deepened `pipeline list` by reading daemon state.
  - Came from: Bloat concern + folding pushback + trace usefulness — taken together, the user's consistent direction was to tighten existing commands and add nothing new.
  - Rationale: Keeps the value (fix the broken hint, mission-control view of validity + schedule + last-run, no stale SVG drift) while honoring the user's "no new commands at this moment" preference.
- Out of scope (explicit drops from the original illumination's 7 steps):
  - Step 2 (`pipeline runs`) — dropped.
  - Step 4 (`pipeline replay <runId>` reusing `PipelineApp`) — dropped.
  - Step 7 (`--node-receive` → `--text` demotion) — dropped, since it was contingent on the Ink replay shipping.
  - Came from: All three pushbacks above.
  - Rationale: Each of these would either add a new command or churn `trace`; user opted out of both.

## Open questions (if any)
- None — scope is decided.
