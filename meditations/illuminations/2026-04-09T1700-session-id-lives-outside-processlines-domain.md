---
date: 2026-04-08
description: The `processLine` function silently discards the system init message that carries `session_id`, making the closure-capture migration pattern prescribed by illumination 1300 silently broken for `plan.ts` — the resume step would receive null and drop the brainstorm session.
---

## Core Idea

Three prior illuminations (0300, 1100, 1300) have prescribed migrating `plan.ts::runBrainstormKickoff` to the `processLine`/`output.stream()` pattern from `loop.ts`. Illumination 1300 specifically says: "capture [session_id] in a variable closed over by the generator, and read it after `output.stream()` resolves." This prescription is mechanically wrong. `processLine` handles only `user` and `assistant` message types — for everything else it returns `{ events: [], nextState: state }` and discards the line. The claude CLI emits `session_id` in a system init message at the start of the stream: `{"type":"system","subtype":"init","session_id":"abc123",...}`. This message has `type: "system"`, hits the `event.type !== "assistant"` guard in `processLine`, and is silently dropped. The closure variable captured inside the generator remains null. After `output.stream()` resolves, `planCommand` reads null, and calls `claude` without `--resume`, abandoning the entire brainstorm session that Phase 1 just ran.

The gene transfusion pattern has a known limit here: `loop.ts` is the exemplar, and `loop.ts` does not need `session_id`. It runs an infinite loop and never resumes. The exemplar is structurally correct for `loop.ts`'s use case and incomplete for `plan.ts`'s.

## Why It Matters

This is the mechanical explanation for why `plan.ts` was not fully migrated in the 0.0.28 commit even though illumination 1100 named it as one of five half-migrated commands. The migration cannot be completed by naive replication of the `loop.ts` pattern — the passenger requires different handling. Any developer who reads illumination 1300's prescription and implements it exactly will produce code that compiles, passes unit tests (which typically mock the stream without a real system init message), and fails silently at runtime. The brainstorm output would display correctly in Ink, then the interactive resume would start a fresh session with no context.

`plan.ts` is currently using the old inline parser, which captures `session_id` from any message type via `if (msg.session_id && !sessionId) sessionId = msg.session_id;`. This is the one behavior the migration must preserve and the one behavior `processLine` cannot provide.

## Revised Implementation Steps

1. **Extend the `sessionStream` generator in the migration with a dual-read pass.** Before passing a line to `processLine`, also `JSON.parse` it once to check for `session_id`. If present, write it into a closure-captured variable. Then pass the line to `processLine` for event emission. This keeps `processLine` unchanged and handles session ID extraction outside its domain.

   ```typescript
   async function* brainstormStream(): AsyncGenerator<StreamEvent> {
     let state = initialState();
     for await (const line of rl) {
       try {
         const raw = JSON.parse(line);
         if (raw.session_id && !sessionId) sessionId = raw.session_id; // system init
       } catch {}
       const { events, nextState } = processLine(line, state);
       state = nextState;
       for (const e of events) yield e;
     }
     for (const e of flushState(state)) yield e;
   }
   ```

2. **Do not extend `processLine` to emit a `session_init` event.** The stream-formatter is a rendering pipeline; surfacing metadata like session IDs is a different concern. Keeping that extraction in the caller preserves the single-responsibility boundary.

3. **Add a test for the session ID extraction path.** In `src/cli/tests/plan.test.ts`, write a test that feeds a synthetic stream — a system init line followed by an assistant text line — through the brainstorm kickoff and asserts the returned `sessionId` is non-null and matches the value in the init message. This test is currently missing and is the reason the breakage is invisible to CI.

4. **Apply the same dual-read pattern to `new.ts::runKickoffSession`.** `new.ts` also captures `session_id` inline (illumination 2300 confirmed this). The same migration applies — dual-read on each line, `processLine` for events, separate capture for `session_id`.

5. **Document the invariant in a comment.** Above the dual-read loop, add: `// session_id arrives in the system init message (type: "system"), which processLine discards. Extract it here before passing to processLine.` This makes the two-pass intent visible and prevents a future refactor from removing the pre-parse step.
