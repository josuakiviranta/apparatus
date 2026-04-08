---
date: 2026-04-06
description: 'T0800 amendment #5 says: "register a cleanup handler inside `runScenarioSession` that sets a shared `cancelled` flag; check `if (state.cancelled) break` in the outer loop." The function signature in the plan is `runScenarioSession(cwd: string, promptText: string): Promise<void>` — it accepts no state and returns nothing.'
---

# SIGINT Amendment Has No Data Structure

## Core Idea

T0800 amendment #5 says: "register a cleanup handler inside `runScenarioSession` that sets a shared `cancelled` flag; check `if (state.cancelled) break` in the outer loop." The function signature in the plan is `runScenarioSession(cwd: string, promptText: string): Promise<void>` — it accepts no state and returns nothing. There is no mechanism for the session to signal cancellation to its caller. A developer following the amendment will stall at this gap and invent a pattern. The simpler correct approach: register SIGINT once at the outer command level, kill the current child, call `process.exit(0)`. No shared state. No cross-function communication. No flag to reset between test runs.

## Why It Matters

Five of the six T0800 amendments specify exact code changes: replace string A with string B, add an env override, check `existsSync`. Amendment #5 describes a behavior ("cancel on SIGINT, stop the loop gracefully, print a completion summary") and an incomplete mechanism ("shared `cancelled` flag," "`state.cancelled`," "deregister in the close handler"). The data structure for `state` is never named. Its scope — module-level, closure, parameter — is never specified. The close handler is inside `runScenarioSession`, but the loop-break is in `runScenariosCommand`. A flag that crosses that boundary must be declared somewhere that both functions can see it. That somewhere is not in the plan.

The `every-action-needs-an-escape` principle is directly at stake here: run-scenarios is a 20-minute unattended loop. SIGINT is the escape. But designing the escape poorly produces a second problem: an escape mechanism that is itself hard to test, hard to reason about, and easy to break when refactoring. The amendment tries to preserve a graceful completion summary ("Completed: N/M scenarios.") on early exit — a legitimate goal that adds the coordination complexity. The value of that summary on a user-initiated interruption is low. The implementation cost is disproportionate.

The `meditate.ts` pattern is not the right template here. Meditate runs one session and exits; SIGINT kills the child, cleanup runs in the close handler, the process terminates naturally. Run-scenarios runs N sessions sequentially; there is no natural termination path after SIGINT unless the process calls `process.exit()` explicitly. The two cases have different shapes. Copying the meditate pattern into a loop without modification produces a process that kills the current child but continues to the next scenario.

## Revised Implementation Steps

1. **Strike the "shared cancelled flag" language from amendment #5.** Replace it with: "Register `process.once('SIGINT', () => { currentChild?.kill('SIGTERM'); process.exit(0); })` at the top of `runScenariosCommand`, before the scenario loop. Declare `let currentChild: ChildProcess | null = null` in the same function scope."

2. **Add an `onSpawn` callback parameter to `runScenarioSession`.** Change the signature to: `runScenarioSession(cwd: string, promptText: string, onSpawn?: (child: ChildProcess) => void): Promise<void>`. Call `onSpawn?.(child)` immediately after `spawn()`. This lets the outer loop capture the child reference without shared module-level state.

3. **In the for loop, pass the callback.** Replace `await runScenarioSession(absPath, prompt)` with `await runScenarioSession(absPath, prompt, (child) => { currentChild = child; })`. After each `await` completes, set `currentChild = null`.

4. **Drop the completion summary requirement from amendment #5.** "Completed: N/M scenarios." on a Ctrl-C exit adds no information — the user caused the stop. Remove this requirement so the SIGINT handler can call `process.exit(0)` cleanly without needing a counter visible from within the handler closure.

5. **Add one test for `onSpawn` callback.** In `run-scenarios.test.ts`, add a test that uses `RALPH_TEST_CMD` pointing to a stub that exits 0, calls `runScenarioSession` with an `onSpawn` callback, and asserts the callback received a truthy child object. This verifies the callback fires and provides an injection point for future SIGINT tests without requiring actual signal delivery.

6. **Apply this change to the plan before Task 7 executes.** The SIGINT mechanism must be decided before `runScenarioSession` is written, because the function signature depends on it. If Task 7 is written with the underspecified amendment, the developer will invent a pattern mid-implementation — and that pattern will be whatever occurs to them first, not the one that integrates cleanly with the test suite.
