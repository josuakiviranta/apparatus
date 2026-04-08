---
date: 2026-04-08
description: The last three illuminations diagnosed problems that commit 44a9585 already solved — plan/new/meditate-create inline parsers are gone, the build is not broken, and claude-session.ts is unnecessary; only meditate.ts::runMeditationSession still writes raw stdout.
---

## Core Idea

Illuminations T2100, T1900, and T1300 diagnosed a codebase that no longer exists. Commit `44a9585` resolved all three problems simultaneously: `streamEvents` was added to `stream-formatter.ts` (T2100's build break is gone), `plan.ts`, `new.ts`, and `meditate-create.ts` were rewritten to use `output.stream(streamEvents(..., {onSessionId}))` (T1900's inline parsers are gone, T1300's renderOnce-before-stream concern is moot for these commands). A developer arriving today and reading the last three illuminations would spend time solving problems that are solved.

Only one gap remains: `meditate.ts::runMeditationSession` still uses `child.stdout.on("data", ...)` with a manual readline buffer and direct `process.stdout.write(block.text)`. It is the only command that bypasses `output.stream(streamEvents(...))`.

## Why It Matters

The `IMPLEMENTATION_PLAN.md` is marked COMPLETED with a tag of 0.0.29 and a note that "259 tests pass, build succeeds." The plan's stated goal was "Route all non-interactive Claude command output through stream-formatter." `meditate.ts` runs a non-interactive Claude session — it is squarely in scope by description. But the plan's specific command list named only `plan`, `new`, and `meditate-create`. The completion declaration matches the list, not the goal.

The consequence is a split output system. Every other command routes through `output.ts` → Ink → `StreamOutput` → `StreamLine`, producing formatted markers (▶▶▶ MAIN AGENT, → [tool], ◈ ctx). `meditate.ts` writes `block.text` directly to stdout. The header is rendered via Ink's `renderOnce`; then the rest of the session is raw bytes. The visual difference is invisible in tests (the tests mock the child process) but visible in the terminal.

The `proof-of-work-proof-of-usage` lens applies directly: the plan completion is proof of work (marked done, tests pass). The test suite doesn't catch this because `meditate.test.ts` mocks `spawn` — it never runs the inline parser at all. The coverage is locally complete but contractually blind to the actual output path (as illumination T1900 diagnosed for a different set of files).

## Revised Implementation Steps

1. **Disregard illuminations T2100, T1900, and T1300 as implementation guides.** They describe a state that commit `44a9585` already resolved. Read T1700 (`meditate-output-bypasses-stream-formatter-entirely`) instead — it correctly identified the remaining gap and is still accurate.

2. **Replace the raw stdout handler in `meditate.ts::runMeditationSession`.** The change is ~20 lines removed, 1 line added. Delete the entire `child.stdout.on("data", ...)` block (lines 109–128 in the current file). Replace with:
   ```ts
   await output.stream(streamEvents(child.stdout as NodeJS.ReadableStream));
   ```
   Add `import { streamEvents } from "../lib/stream-formatter.js";` to the imports.

3. **Move `await exitPromise` after `output.stream()`.** The current code uses `await new Promise<void>((res) => child.on("close", async (code) => { ... res(); }))` — this is the exit handler that also calls `cleanupMcpConfig`. Extract the cleanup into the finally/off block and await exit after stream completes, matching the pattern in `loop.ts` and `plan.ts`.

4. **Update `meditate.test.ts` to assert that `output.stream` is called.** The existing tests mock `spawn` but don't verify the output path. Add an assertion that `out.stream` was called once per `runMeditationSession` invocation, using the same mock pattern as `loop.test.ts` and the three command test files.

5. **Do not add `onSessionId`.** `meditate.ts` has no interactive resume phase — it is a single non-interactive run. No session ID is needed. The `streamEvents` call requires no options object.

6. **Run `npm run build && npx vitest run` to verify.** The build must be clean and the test count should increase by at least the new `output.stream` assertion. This is the only remaining step before `meditate` matches the rest of the codebase.
