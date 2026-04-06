# The Sequential Scenario Loop Has No Exit

## Core Idea

`runScenariosCommand` runs selected scenarios in a `for-of await` loop with no SIGINT or SIGTERM handling — at either the loop level or inside `runScenarioSession`. When the user presses Ctrl-C during a long scenario run, Node exits, the Claude subprocess loses its piped stdio and dies via SIGPIPE, and none of the remaining scenarios execute. The user gets no summary of what completed. `meditate.ts` solved this exact problem with explicit signal registration and deregistration around each spawn. The plan doesn't carry that solution to the scenario runner.

## Why It Matters

The sequential loop is the most time-expensive operation in ralph. The design spec says scenarios run sequentially because they are "potentially expensive and stateful." A user selecting five scenarios is committing to a session that could run 15–25 minutes. That commitment needs a designed exit.

The `meditate.ts` pattern is already in the codebase:

```typescript
const cleanup = () => {
  child.kill("SIGTERM");
  removePid(absPath);
  cleanupMcpConfig(mcpConfigPath);
};
process.once("SIGTERM", cleanup);
process.once("SIGINT", cleanup);
// ...await session...
process.off("SIGTERM", cleanup);
process.off("SIGINT", cleanup);
```

Task 7 of `docs/superpowers/plans/2026-04-05-run-scenarios.md` defines `runScenarioSession` without this pattern. There's no cleanup registration, no child kill on interrupt, and no deregistration after the session resolves. The outer `runScenariosCommand` loop also has no post-await cancellation check — even if `runScenarioSession` were extended to set a cancellation flag, the loop would continue to the next scenario.

The practical consequence is not just process hygiene. When a scenario hangs — Claude confused by a malformed script, an API timeout, a prompt that produces no output — the user's only choice is to kill the terminal and start over. There is no "skip this scenario" path, no timeout, no per-scenario progress indication beyond the initial `Running: <name>...`. The entry was designed; the exit was not.

The 2600 illumination identified the missing `RALPH_TEST_CMD` override — the testing escape hatch. This is the runtime escape hatch. Both are missing from the same function.

## Revised Implementation Steps

1. **Inside `runScenarioSession`, register a SIGINT cleanup handler before spawning and deregister it after close.** The cleanup should call `child.kill("SIGTERM")` and set a shared `cancelled` flag. Deregister with `process.off` in the close handler before resolving. This mirrors the `meditate.ts` pattern exactly — copy the structure, not just the concept.

2. **Pass a cancellation signal into `runScenarioSession`.** The simplest form is a shared object reference: `const state = { cancelled: false }`. Pass it into `runScenarioSession`; the cleanup handler sets `state.cancelled = true`. After each `await runScenarioSession(...)` in the outer loop, check `if (state.cancelled) break`.

3. **Print a run summary after the loop.** Whether the run completes normally or is interrupted, emit: `Completed: N/M scenarios.` followed by the list of reports written. When interrupted, add: `Run cancelled. Remaining scenarios were not run.` This gives the user enough context to decide which scenarios to rerun, rather than requiring them to correlate timestamps in `scenario-runs/`.

4. **Consider a per-scenario timeout as a follow-up.** A `--timeout <seconds>` flag, defaulting to something like 300s (5 minutes), that sends SIGTERM to the child if the session exceeds the limit. This is the escape hatch for the "hung Claude session" case. Not required for v1, but the signal handler architecture from steps 1–2 is the prerequisite for it to be addable.
