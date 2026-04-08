---
date: 2026-04-08
description: The gene transfusion fix for new.ts is not identical to the meditate.ts fix — runKickoffSession extracts session_id from the stream to enable interactive resume, and a wholesale replacement of its JSON parse loop would silently drop that extraction, breaking the new command's core handoff.
---

## Core Idea

`new.ts::runKickoffSession` has the same inline JSON parser that illumination 2300 prescribes replacing with `processLine`. But the two functions are not equivalent. `runMeditationSession` returns `Promise<void>` — it streams output and exits. `runKickoffSession` returns `Promise<string | null>` — it streams output AND extracts a `session_id` from the event stream, which `newCommand` uses to call `claude --resume <sessionId>` immediately afterward. That extracted ID is the bridge between the non-interactive kickoff phase and the interactive session the user sees.

The `processLine` function treats non-`assistant`, non-`user` events as transparent: it returns `{ output: "", nextState: state }`. Session ID events from Claude's stream-json format are emitted on non-assistant events. The inline parser captures them with:

```typescript
if (msg.session_id && !sessionId) sessionId = msg.session_id;
```

A developer who follows illumination 2300's "identical transformation" recipe and replaces the JSON parse loop wholesale with `processLine` calls will silently drop this extraction. `runKickoffSession` will return `null`. `newCommand` will call `claude --dangerously-skip-permissions` with no `--resume` flag — launching a brand-new interactive session instead of continuing from the kickoff context. The user gets a blank Claude TUI when they expected a continuation. No error. No warning. Just lost context.

## Why It Matters

The gene-transfusion lens says the key ingredient is the exemplar paired with tests. Here the exemplar (`loop.ts`) has no equivalent of the session-ID extraction, so there are no tests for this behavior in the transfusion checklist. `new.ts::newCommand` has a test for the `--resume` flag appearing in spawn args — but it does not verify that the session ID was actually extracted from stream output. The test checks structure, not the data flow that produces the value being tested.

This is precisely the failure mode the lens warns against: applying the pattern without confirming behavioral equivalence. Two functions that look structurally similar (spawn claude, stream-json, parse output, write to stdout) can have different contracts that survive a superficial transfusion test.

The danger is compounded by timing. If `runKickoffSession` returns `null`, `newCommand` opens an interactive session without `--resume`. The user never knows the session was disconnected — they just see a fresh Claude context in their project folder and assume something went wrong with the AI's memory. It will look like a prompt engineering problem, not a code bug.

## Revised Implementation Steps

1. **Read `newCommand` before touching `runKickoffSession`.** Confirm that `sessionId` returned from `runKickoffSession` is passed directly to `--resume`. This is the downstream consumer of the extraction. Understanding its use confirms what must be preserved.

2. **Separate the two concerns before replacing the loop.** In the new readline-based implementation, extract session_id as a first-class side-effect, not as part of the processLine data flow:

   ```typescript
   rl.on("line", (line) => {
     // session_id extraction — separate from output formatting
     try {
       const msg = JSON.parse(line);
       if (msg.session_id && !sessionId) sessionId = msg.session_id;
     } catch {}
     // output formatting via stream-formatter
     const { output, nextState } = processLine(line, state);
     state = nextState;
     if (output) process.stdout.write(output);
   });
   ```

   This parses each line twice. That is the correct tradeoff — it keeps `stream-formatter.ts` free of session-ID concerns, and keeps `runKickoffSession`'s contract intact.

3. **Do not extend `processLine` to return `sessionId`.** That would contaminate stream-formatter with new.ts-specific logic. The formatter's contract is output formatting, not session state extraction. Keep the concerns separate.

4. **Add a unit test for the session-ID extraction path.** In `src/cli/tests/new.test.ts`, write a stub that emits a JSON line with `{ session_id: "abc-123" }` alongside tool_use events, and assert that `runKickoffSession` returns `"abc-123"`. This test does not currently exist. It would have caught the silent drop described above.

5. **Only after step 4 is green: apply the processLine replacement and stream-formatter import.** The new regression test turns red immediately if session_id extraction breaks. This is the correct TDD order — write the test for the hidden passenger before refactoring the vehicle.

6. **Verify the end-to-end handoff separately from unit tests.** Run `ralph new test-project` against a stub command and confirm the interactive session opens with `--resume <id>` in the process args. Unit tests validate the extraction; this step validates the handoff.
