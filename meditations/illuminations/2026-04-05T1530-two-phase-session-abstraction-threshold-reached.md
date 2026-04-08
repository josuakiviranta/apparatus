---
date: 2026-04-05
description: 'Three commands — `plan.ts`, `new.ts`, and `meditate-create.ts` — all implement the same two-phase Claude session pattern: non-interactive kickoff via `--output-format stream-json`, session ID capture from the stream, `→ [tool] tool_name` stdout indicators, then interactive resume with `--dangerously-skip-permissions`.'
---

# Two-Phase Session Abstraction: Threshold Reached

## Core Idea

Three commands — `plan.ts`, `new.ts`, and `meditate-create.ts` — all implement the same two-phase Claude session pattern: non-interactive kickoff via `--output-format stream-json`, session ID capture from the stream, `→ [tool] tool_name` stdout indicators, then interactive resume with `--dangerously-skip-permissions`. The async buffer-parsing loop and session handoff logic are copied verbatim across all three files. `MEMORY.md` already identified the extraction trigger — "extract to `lib/claude-session.ts` only when a third command needs it" — and the third command is present.

## Why It Matters

The duplication is not cosmetic. Each copy carries the same subtle behaviors: the `buffer += chunk.toString()` accumulation pattern handles multi-chunk JSON lines; the `msg.session_id && !sessionId` guard captures only the first ID seen; the `→ [tool] block.name` indicator gives the user a non-silent signal during the headless phase. Any bug in this logic — or any future change, like switching from `--dangerously-skip-permissions` to a tighter permission flag — must be applied in three places. Each copy will drift independently.

`meditate-create.ts:buildMeditateCreateKickoffArgs` is exported and tested. `plan.ts:runBrainstormKickoff` is private and has no direct test. `new.ts:runKickoffSession` is private and untested. The same logic exists at three different levels of test coverage because it was copied rather than shared. A single `lib/claude-session.ts` would have one test surface.

The `gene-transfusion` lens names exactly what happened here: the first implementation in `plan.ts` was the exemplar. It was transfused into `new.ts` and then `meditate-create.ts`. The transfusion worked — all three function. But the transfusion loop should now close: the internal exemplar becomes the abstraction, and future commands point at it instead of copying from it.

## Revised Implementation Steps

1. **Create `src/cli/lib/claude-session.ts`** with a single exported function:
   ```typescript
   export async function runTwoPhaseSession(opts: {
     cwd: string;
     kickoffArgs: string[];
     onText?: (text: string) => void;
     onToolUse?: (name: string) => void;
   }): Promise<string | null>
   ```
   The default `onText` writes to `process.stdout`. The default `onToolUse` writes `\n→ [tool] ${name}\n` to `process.stdout`. The function returns the session ID.

2. **Write tests for `runTwoPhaseSession` in `src/cli/tests/claude-session.test.ts`** before touching command files. The test should stub the `claude` binary via `RALPH_TEST_CMD` (or equivalent env override) and assert: session ID is returned, text blocks are forwarded, tool_use blocks emit the indicator, and `null` is returned gracefully when no session ID appears.

3. **Replace the private `runBrainstormKickoff` in `plan.ts`** with a call to `runTwoPhaseSession`, passing the BRAINSTORM_TRIGGER as the `-p` arg. Delete the local async function entirely.

4. **Replace the private `runKickoffSession` in `new.ts`** with a call to `runTwoPhaseSession`, passing the substituted kickoff prompt. Delete the local async function.

5. **Replace `runMeditateCreateKickoff` in `meditate-create.ts`** with a call to `runTwoPhaseSession`, passing the result of `buildMeditateCreateKickoffArgs(promptText)` as `kickoffArgs`. The exported `buildMeditateCreateKickoffArgs` and its tests remain unchanged.

6. **Verify that all existing tests still pass** after the refactor. The behavioral contract is identical — this is purely structural consolidation, with no change to what any command does.
