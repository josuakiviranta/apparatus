---
date: 2026-05-01
description: runTwoPhaseClaudeSession and its two interface types in session.ts are dead exports — no command calls them; plan.ts and new.ts were never built.
---

## Findings

1. **What:** `runTwoPhaseClaudeSession`, `TwoPhaseSessionOptions`, and `TwoPhaseSessionResult` are exported dead code — no live CLI command imports or invokes them.
   - **Evidence:** `src/cli/lib/session.ts:104-146` defines all three; `grep -r runTwoPhaseClaudeSession src/` returns only the definition and `src/cli/lib/tests/session.test.ts` (tests of dead code). `src/cli/commands/` contains only `heartbeat.ts`, `implement.ts`, `meditate.ts`, `pipeline.ts` — no `plan.ts`, no `new.ts`.
   - **Why it matters (KISS lens):** A reader of `session.ts` sees a two-phase Claude spawn abstraction and must ask: "which command uses this?" The answer is none. The tests in `session.test.ts` (four `runTwoPhaseClaudeSession` call sites, lines 59/95/109/122) maintain coverage for code that ships in the bundle but is never executed in production. Every future editor of `session.ts` pays the cognitive tax of a public API that has no consumer.
   - **Suggested action:** Delete `runTwoPhaseClaudeSession`, `TwoPhaseSessionOptions`, and `TwoPhaseSessionResult` from `session.ts:104-146`. Delete the corresponding `describe("runTwoPhaseClaudeSession", ...)` block from `session.test.ts`. If `plan` or `new` commands are eventually built, implement inline and extract to `lib/` only when a third command warrants it (the existing design note says exactly this).

## Reading thread

- `2026-05-01T0050-pipeline-location-drift-vs-vision.md` — covers pipeline location drift; unrelated to session dead-code.
- `2026-05-01T0120-janitor-graph-validator-bloat.md` — covers graph.ts validator bloat; unrelated.