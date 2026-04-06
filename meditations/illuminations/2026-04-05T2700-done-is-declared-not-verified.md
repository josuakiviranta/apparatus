# "Done" Is Declared, Not Verified

## Core Idea

Every output-producing command in ralph — `meditate`, `meditate-create`, and the planned `run-scenarios` — announces completion based on process exit, not artifact existence. The subprocess exiting 0 and the artifact being written are two different events. The commands conflate them. A user sees "Done: scenario-runs/2026-04-05T1942-auth-flow.md" and finds nothing there.

## Why It Matters

The pattern is consistent across all three commands. In `meditate.ts`, the session resolves in the `close` handler — no check that a file appeared in `meditations/illuminations/`. In `meditate-create.ts` (`src/cli/commands/meditate-create.ts`), the kickoff resolves when `close` fires with the session ID; no check that a `meditations/<slug>.md` was written before the interactive resume opens. In the planned `run-scenarios.ts` (Task 7 of `docs/superpowers/plans/2026-04-05-run-scenarios.md`), the code is:

```typescript
await runScenarioSession(absPath, prompt);
console.log(`Done: scenario-runs/${outFile}`);
```

The "Done" message is emitted unconditionally. Claude can exit 0 for multiple reasons: it finished the task, the user hit Ctrl-C (SIGINT propagation), a permission error stopped tool execution mid-flight, or the stream-json session timed out. In all cases, the process exits and the close handler fires. The artifact may or may not exist.

This is the `proof-of-work` vs `proof-of-usage` distinction made concrete. Process exit is proof that something ran. The report file is proof that something was produced. Only one of those is useful to the next step. The `2026-04-05T2100` illumination showed that meditate-create's output has no consumer downstream; this is the prior problem — the caller doesn't know whether the output was produced at all.

The risk compounds in `run-scenarios` specifically because its output feeds a human workflow: the user is meant to paste the report path into a subsequent `ralph implement` session. If the file doesn't exist, that handoff fails silently. The command looked done. The user pastes a path. Claude 404s.

## Revised Implementation Steps

1. **In `run-scenarios.ts` Task 7, add an artifact check after `runScenarioSession` returns.** Replace the unconditional `console.log("Done: ...")` with:

   ```typescript
   await runScenarioSession(absPath, prompt);
   if (existsSync(outPath)) {
     console.log(`Done: scenario-runs/${outFile}`);
   } else {
     console.error(`Warning: session completed but no report was written to scenario-runs/${outFile}`);
     console.error(`Check that claude had write access and the scenario prompt instructed it to write the file.`);
   }
   ```

2. **Apply the same pattern to `meditate.ts`.** Before the session starts, record `beforeCount = readdirSync(join(absPath, "meditations", "illuminations")).length`. After `runMeditationSession` resolves, compare `afterCount`. If equal, emit a warning: "Session completed but no new illumination was written." This surfaces the case where Claude exits cleanly but produces nothing — a real edge case when the model decides the task is already complete.

3. **Apply the same pattern to `meditate-create.ts`.** Before spawning, count files in `join(absPath, "meditations")` (excluding `illuminations/` subdirectory). After `runMeditateCreateKickoff` resolves, compare. If no new file appeared, warn before opening the interactive session — the interactive resume will have nothing to build on.

4. **Add a test for the failure case in `run-scenarios.test.ts`.** Using `RALPH_TEST_CMD` pointing to a stub that exits 0 without writing anything, assert that the warning message is written to stderr and the success message is NOT written to stdout. This test will catch regressions if the artifact check is ever removed.

5. **Do not throw on missing artifact — warn and continue.** These commands are fire-and-forget session runners. A hard failure after an expensive Claude session is the wrong tradeoff. The warning gives the user signal; the exit code 0 preserves composability in scripts that chain commands.
