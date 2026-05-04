---
date: 2026-05-04
run_id: 2fd4103a-42be-42e7-b627-c5067321cd0a
plan: docs/superpowers/plans/2026-05-04-model-flag-dead-in-implement-pipeline.md
design: docs/superpowers/specs/2026-05-04-model-flag-dead-in-implement-pipeline-design.md
illumination: .ralph/meditations/illuminations/2026-05-04T2048-model-flag-dead-in-implement-pipeline.md
test_result: pass
---

# Model flag dead in implement pipeline

## What was implemented

Removed the `--model <name>` CLI surface from `ralph implement` end-to-end. The flag accepted a value, injected `llm_model` into the variable bag, and was silently ignored — the bundled implement pipeline never read the bag entry, and `agent-handler.ts:65` resolves the model only from the parsed DOT attribute `node.llmModel`. Loud breaking change: `ralph implement --model X` now exits 1 with `error: unknown option '--model'`.

## Key files

- M `src/cli/commands/implement.ts` — drop `model?: string` from `ImplementOptions` and the bag-injection ternary.
- M `src/cli/program.ts` — drop `.option("--model <name>", …)` and inline `model?: string` from action callback.
- M `README.md` — strip `[--model <name>]` from synopsis (line 27) and delete description sentence (line 30).
- M `docs/adr/0003-scenario-tests-in-implement-pipeline.md` — prepend status note flagging the removal; sealed body untouched.

(Single feat commit `61e9880`; no test changes — snapshot at `graph-required-caller-vars.test.ts:216` already pinned `llm_model` out of the implement-pipeline banner under prior commit `8d9c12c`.)

## Decisions and patterns

- Chose Option B (delete) over Option A (wire through). Operator-confirmed in `chat_session` round 1: "let's remove the lie." Carrying a documented-but-broken flag forward is worse than a loud error today; multi-model testing is acknowledged future work, deliberately deferred (re-add the ~10-line wiring when needed).
- Left `agent-handler.ts:65` `node.llmModel` resolution untouched — other pipelines may legitimately set `llm_model="…"` as a per-node DOT attribute. Removal scoped strictly to the CLI-surface lie.
- Left `pipeline.dot` and `graph-required-caller-vars.test.ts:216` snapshot untouched — both already correct after the prior `inputs=` cleanup (`8d9c12c`, today). Mirrors the truth-over-drift posture from CONTEXT.md / ADR-0004.
- No deprecation path. Loud unknown-option error is the contract going forward.

## Gotchas and constraints

- The `llm_model` *DOT attribute* path remains live — do NOT assume "model selection is gone" from `ralph implement`. A future pipeline node with `llm_model="claude-haiku-4-5"` will still resolve via `agent-handler.ts:65`.
- Snapshot test at `src/attractor/tests/graph-required-caller-vars.test.ts:216` *already* asserts `llm_model` is absent from the implement-pipeline `inputs=` banner. Inverting it (Option A) would have required a snapshot update; sticking with B kept the test untouched, which is the right signal.
- ADR-0003's body still references the older shape (with `llm_model` in inputs=) but is sealed — only a status note was prepended. Future readers must read the status note before trusting the example.

## Learnings from the run

- Pipeline trace at `~/.ralph/ralph-cli-0c42de/runs/2fd4103a*/` not found on disk at write time (closest run dirs: `f6b021e5`, `48dee40e`). Memory grounded in git log + provided context-bag values only; per-node retry/duration data unavailable for this session.

## Final verification

- test_result: pass
- test_summary: Cycle 1 clean: build green, 1259/1259 vitest tests pass (134 files), targeted exercise of removed --model flag confirms loud breaking change works as designed (`error: unknown option '--model'`, exit 1) and `ralph implement --help` no longer references it. No fixes required.
