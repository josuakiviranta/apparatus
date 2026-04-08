---
date: 2026-04-08
description: Five command files are half-migrated to Ink: UI chrome uses output.* but streaming content still writes directly to process.stdout — the exemplar for fixing this (loop.ts's sessionStream pattern) is already committed and only needs to be replicated.
---

## Core Idea

Every command file modified by the Ink migration (`meditate.ts`, `plan.ts`, `new.ts`, `run-scenarios.ts`, `meditate-create.ts`) was migrated in exactly half. The UI chrome calls — `output.step`, `output.info`, `output.warn`, `output.error`, `output.success`, `output.header` — were ported to Ink. The streaming sections were not. Each command's inline JSON parse loop still calls `process.stdout.write()` or `console.log()` directly, bypassing Ink entirely. Within a single command invocation, the terminal is now managed by two incompatible systems in alternating sequence.

This is not a theoretical concern. The sequence in `plan.ts` is: `await output.step(...)` (Ink renders, `setTimeout(0)`, unmount) → `runBrainstormKickoff()` (raw `process.stdout.write`) → `await output.step(...)` (Ink again). The terminal transitions from Ink-managed to raw and back. The open/close symmetry is: Ink opens a render context, closes it by timing assumption, then raw stdout proceeds without knowing whether the close completed. A signal-based close (`waitUntilExit()`) would guarantee the terminal is released before raw writes begin. `setTimeout(0)` does not.

## Why It Matters

`loop.ts` is the correct pattern, already written and committed: wrap the readline+`processLine` loop in an `AsyncGenerator<StreamEvent>`, pass it to `output.stream()`. The `sessionStream()` function in `loop.ts` is 15 lines. The exemplar exists. The five inline parsers in the remaining commands are not structurally different from the inline parser that was removed from `loop.ts`. They are copies of the same old pattern that `loop.ts` already replaced.

The migration created a gap: `loop.ts` speaks Ink natively, every other command speaks a mix. If a user runs `ralph implement`, output is fully unified. If they run `ralph meditate` or `ralph plan`, their terminal alternates between Ink-managed and raw output. The unification that was the stated goal of the migration (`docs/superpowers/specs/2026-04-08-ink-unified-output-design.md`) is present in one command and absent in four.

`run-scenarios.ts` has a variant of the same problem: `printScenarioList` calls `console.log` directly for the scenario list, then `promptSelection` uses readline directly, then `output.step` fires for each scenario. Unlike the other commands, `run-scenarios` has no streaming JSON loop — its raw writes are display logic, not stream forwarding. The fix there is simpler but still pending.

## Revised Implementation Steps

1. **Replicate the `sessionStream` pattern from `loop.ts` into `plan.ts::runBrainstormKickoff`.** Remove the manual buffer+JSON.parse loop. Replace with an `AsyncGenerator<StreamEvent>` using `readline.createInterface` + `processLine` + `flushState`. Call `await output.stream(brainstormStream())`. The `sessionId` extraction still happens inside the generator (read `session_id` from the same line-by-line parse, yield it via a side channel, or return it after the stream closes — see how `loop.ts` handles exit code for the pattern).

2. **Apply the same transformation to `new.ts::runKickoffSession`.** Identical structure to `plan.ts`. The session ID capture pattern is the same; the only difference is the prompt source. This was named in illumination 0300 as carrying a hidden passenger (the session ID return) — handle that by extracting `sessionId` into a captured variable inside the generator closure, then reading it after `output.stream()` resolves.

3. **Apply the same transformation to `meditate.ts::runMeditationSession`.** This one adds `--output-format stream-json` and a different `buildMeditationArgs` call, but the readline+`processLine` bridge is identical. Illumination 0700 noted the inline parser here is not a passthrough — it is a fork of an older formatter. The fix removes the fork entirely.

4. **Check `meditate-create.ts` for any remaining raw writes.** The file was listed as modified in `git status` but not yet read in this session. Before completing the streaming migration, confirm whether it contains an inline parser or only one-shot output calls.

5. **Fix `run-scenarios.ts::printScenarioList`.** Replace `console.log` calls with a formatted string passed to `output.info()`. The readline prompt in `promptSelection` is a different category — it's interactive input, not output — and can stay as-is unless the Ink migration spec explicitly requires it to move.

6. **Commit all five fixes together as one commit.** The migration spec named this as a single chunk ("Migrate remaining commands"). Committing piecemeal leaves the project in the two-system state longer than necessary. One commit completes the migration as defined.
