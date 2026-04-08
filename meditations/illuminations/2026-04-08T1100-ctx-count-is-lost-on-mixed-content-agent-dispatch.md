---
date: 2026-04-08
description: "When a main agent assistant event contains both non-Agent content (text, Read, etc.) and an Agent tool dispatch in the same event, the ctx token count for that turn is silently suppressed."
---

# Ctx Count Is Lost on Mixed-Content Agent Dispatch

## Core Idea

When a main agent assistant event contains both non-Agent content (text, Read, etc.) and an Agent tool dispatch in the same event, the ctx token count for that turn is silently suppressed. The gate `if (nextMainAgentOpen && ...)` evaluates after the content loop closes the main agent block, so `nextMainAgentOpen` is `false` by the time ctx is checked. The count is never printed. This is a behavioral regression introduced in 0.0.25 — the old formatter emitted it.

## Why It Matters

This is not an obscure edge case. Real Claude sessions routinely dispatch subagents in the same event that contains preceding reasoning text or tool calls. Every time that happens, the user sees no `◈ ctx` line for that turn. The context window size is invisible at the moment it matters most — when the agent is offloading work to a subagent, which is exactly when ctx pressure is highest.

The regression is currently invisible because the scenario test silently dropped the assertion. The old run record (`2026-04-07T1627-stream-formatter-output-markers.md`) shows `PASS: '◈ ctx: 5,000 tokens'`. The updated test script (`scenario-tests/test-stream-formatter.sh`) no longer checks for `◈ ctx: 5,000 tokens` — the check was removed when the new markers were introduced, without documenting that the behavior changed. No unit test in `src/cli/tests/stream-formatter.test.ts` covers the mixed-content case (text + Agent in one event). The unit tests cover pure-Agent events and pure-text events, but not the combination.

The root cause is in `stream-formatter.ts` at the ctx gate (bottom of the main agent block): the ctx line is evaluated using `nextMainAgentOpen`, which is set to `false` when an Agent block is processed during the content loop. Using the post-loop state to gate a line that logically belongs to the pre-Agent part of the turn is the wrong ordering.

## Revised Implementation Steps

1. **Add a unit test that exposes the suppression.** In `src/cli/tests/stream-formatter.test.ts`, add a case: an event with text + Read + Agent in `content`, starting from `initialState()`. Assert that `◈ ctx:` appears in the output. This test will fail today.

2. **Fix the ctx gate ordering in `stream-formatter.ts`.** Capture `mainAgentOpenAtCtxCheck` before the content loop runs (or before the Agent block sets it to false), and use that captured value in the ctx gate instead of `nextMainAgentOpen`. The ctx line belongs to the main agent's turn — it should emit regardless of whether the turn ends with a subagent dispatch.

   ```ts
   // Before entering content loop, record whether main was open after the hasNonAgentContent check:
   const mainWasOpenForCtx = nextMainAgentOpen;
   // ...content loop runs, may set nextMainAgentOpen = false...
   // At ctx gate:
   if (mainWasOpenForCtx && typeof usage?.input_tokens === "number") { ... }
   ```

3. **Confirm the fixed unit test passes, then run the full test suite.** `npx vitest run src/cli/tests/stream-formatter.test.ts` then `npm test`. No regressions should appear — the fix only changes when the ctx line is emitted, not any other marker.

4. **Update the scenario test to restore the `◈ ctx: 5,000 tokens` check.** Re-add `check "◈ ctx: 5,000 tokens"` to `scenario-tests/test-stream-formatter.sh`. Build and run the scenario test to produce a fresh run record. Replace `scenario-runs/2026-04-07T1627-stream-formatter-output-markers.md` with the new result.

5. **Commit runner.ts first.** `src/daemon/runner.ts` has an unstaged change. Run `git diff src/daemon/runner.ts`, understand the change, commit it before touching stream-formatter. A clean working tree is non-negotiable before a precision fix like this.
