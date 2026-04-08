---
date: 2026-04-08
description: Illumination 1530 already prescribed `lib/claude-session.ts` for the three-command inline-parser problem; illuminations 1100 and 1700-session-id are its two missing amendments — together they form the complete implementation, but no session has synthesized all three into one actionable path.
---

## Core Idea

Illumination 1530 (2026-04-05) correctly identified that `plan.ts`, `new.ts`, and `meditate-create.ts` all duplicate the same two-phase Claude session pattern, named `lib/claude-session.ts` as the extraction target, and wrote a complete 6-step implementation prescription. That illumination was correct and is still correct. In the four days since, six subsequent illuminations have re-diagnosed the inline parsers in these same three files without ever referencing 1530. They addressed symptoms — scattered `process.stdout.write`, duplicated `session_id` capture, missing stream-formatter delegation — while 1530's structural fix sat unread.

Two things have changed since 1530 was written: (1) `output.ts` now exists, so the `onText` and `onToolUse` callbacks in 1530's proposed interface should delegate to `output.stream()` instead of writing raw stdout; (2) the session_id capture must use the dual-read pattern from illumination 1700-session-id because `processLine` discards the system init message where `session_id` arrives. These are the only two amendments needed. The extraction target, function signature shape, and replacement plan from 1530 remain valid.

## Why It Matters

The six post-1530 illuminations (2300, 1100, 0300, 1700, 1700-session-id, and this session's observations) each diagnosed one command or one symptom in isolation. A developer reading any one of them would repair one file. A developer reading 1530 would extract all three and test once. But 1530 is buried — it predates the Ink migration and is separated from the recent diagnosis threads by 80+ illumination files. No recent illumination has pointed back at it.

The consequence: if the repair work starts from the most recent illumination (1700-session-id), the developer will add a dual-read to `plan.ts`, then later add it to `new.ts`, then later to `meditate-create.ts` — three partial fixes instead of one extraction. The inline parser in each file will be patched rather than removed. The `lib/claude-session.ts` module, which 1530 said should exist when three commands share this pattern, will continue to not exist.

## Revised Implementation Steps

1. **Read illumination 1530 before writing any code.** It is at `meditations/illuminations/2026-04-05T1530-two-phase-session-abstraction-threshold-reached.md`. Its 6 steps are the scaffolding for what follows. The two amendments below complete it.

2. **Create `src/cli/lib/claude-session.ts` per 1530's interface**, but replace the `onText`/`onToolUse` raw-stdout callbacks with an `AsyncGenerator<StreamEvent>` that can be passed to `output.stream()`. The generator yields `StreamEvent` objects (same type as `stream-formatter.ts` emits), using `processLine` + `flushState` from `stream-formatter.ts`. The exemplar is `loop.ts::sessionStream`.

   ```typescript
   export async function runTwoPhaseSession(opts: {
     cwd: string;
     kickoffArgs: string[];
   }): Promise<string | null> {
     let sessionId: string | null = null;
     async function* kickoffStream(): AsyncGenerator<StreamEvent> {
       // readline + processLine loop here
       // dual-read each line: check raw.session_id BEFORE passing to processLine
     }
     await output.stream(kickoffStream());
     return sessionId;
   }
   ```

3. **Apply the dual-read pattern from illumination 1700-session-id inside `kickoffStream`.** Before passing any line to `processLine`, attempt `JSON.parse` and check for `session_id`. Write it to the closure-captured variable. Then pass the line to `processLine` for event emission. Do not add session_id handling to `processLine` itself.

4. **Write tests for `runTwoPhaseSession` in `src/cli/tests/claude-session.test.ts` before modifying any command file.** Use a synthetic stream: a system init line (`{"type":"system","subtype":"init","session_id":"abc123"}`), an assistant text line, and a result line. Assert: the returned session ID is `"abc123"`, and `output.stream` was called with a generator that yields the text event. This test suite replaces the need for per-command parser tests in `plan.test.ts`, `new.test.ts`, and `meditate-create.test.ts`.

5. **Replace the inline parsers in `plan.ts`, `new.ts`, and `meditate-create.ts`** with calls to `runTwoPhaseSession`. Each call is ~3 lines. The private async functions (`runBrainstormKickoff`, `runKickoffSession`, `runMeditateCreateKickoff`) are deleted. The exported `buildMeditateCreateKickoffArgs` in `meditate-create.ts` remains — it is tested separately and used to construct the `kickoffArgs` argument.

6. **Handle `meditate.ts` separately.** It is a single-phase session, not two-phase, and does not need `claude-session.ts`. Its fix is the standalone `output.stream()` migration described in illumination 1100 step 3. Confirm it has no `session_id` capture before deleting its inline parser.
