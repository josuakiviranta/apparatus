---
date: 2026-04-08
description: The `renderOnce` helper in `output.ts` unmounts Ink after a single `setTimeout(0)` tick — an untested timing assumption that the smoke tests in `output.test.ts` cannot catch, because no test ever asserts that text actually reached stdout.
---

## Core Idea

`output.ts` splits Ink renders into two strategies: long-running components (`spinner`, `stream`) call `waitUntilExit()` after the component calls `exit()` — a robust, API-guaranteed pairing. One-shot components (`step`, `info`, `warn`, `error`, `success`, `header`) use `renderOnce`, which calls `render(el)`, waits `setTimeout(resolve, 0)`, then `inst.unmount()`. The comment explains the choice: "One-shot components don't call exit(), so waitUntilExit() would hang." The `setTimeout(0)` is meant to give Ink one event loop tick to flush its frame. This is an implicit contract with Ink's scheduler, not a guarantee from its API.

`output.test.ts` tests all five one-shot functions as smoke tests: "resolves without throwing." No test captures stdout or asserts that any text was written. `ui.test.tsx` correctly tests the Ink components via `ink-testing-library`'s `lastFrame()`, but that is one layer below — it tests the React component tree, not the async function that wraps it.

## Why It Matters

The test architecture has a gap between the component layer and the orchestration layer. `ui.test.tsx` verifies that `<Step text="Starting..." />` renders `"❯ Starting..."`. `output.test.ts` verifies that `output.step("Starting...")` does not throw. Neither test verifies that `renderOnce` flushed the frame to stdout before `unmount()` was called.

In the current implementation this probably works — Ink's reconciler runs synchronously before I/O callbacks, and one `setTimeout(0)` is enough to yield to it. But the `renderOnce` pattern is fragile in two directions:

1. **Test environment with fake timers.** If any test ever enables `vi.useFakeTimers()`, `setTimeout(0)` will not yield at all. The `output.test.ts` tests would still pass (the function resolves), but in production the screen would be blank.

2. **Ink internals change.** If Ink ever defers its reconciler tick (e.g. as part of concurrent rendering), `setTimeout(0)` no longer guarantees the frame has been committed before `unmount()`. This is an implicit dependency on Ink scheduler behavior that no test would catch.

The open-close lens frames this precisely: `render()` opens, `unmount()` closes, but the close is timed by assumption rather than by signal. `waitUntilExit()` is signal-based; `setTimeout(0)` is time-based. One of these is correct under change; the other is not.

The fact that `output.ts` is currently untracked (not yet committed) means this is the right moment to fix the pattern before it gets locked in across all commands during the Ink migration.

## Revised Implementation Steps

1. **Change one-shot Ink components to call `exit()` themselves.** In `ui.tsx`, components used by `renderOnce` (Step, Info, Warn, Error, Success, Header) should call `const { exit } = useApp()` and invoke `exit()` inside a `useEffect` that runs after the first render. This makes them self-closing.

2. **Replace `renderOnce` with `waitUntilExit()`.** Once components call `exit()`, `renderOnce` becomes:
   ```typescript
   async function renderOnce(el: React.ReactElement): Promise<void> {
     const { waitUntilExit } = render(el);
     await waitUntilExit();
   }
   ```
   This uses the same API-guaranteed open/close pairing that `stream` and `spinner` already use. Remove the `setTimeout` entirely.

3. **Update `ui.test.tsx` for one-shot components.** The self-exiting components still work with `ink-testing-library` — `lastFrame()` captures the frame before exit. No test changes needed for correctness; existing tests continue to pass.

4. **Add a stdout-capture test for at least one `output.*` function.** In `output.test.ts`, use `process.stdout.write` spy or capture to assert that calling `output.step("foo")` actually writes something containing `"foo"` to stdout. This closes the gap between "function resolves" and "output was produced."

5. **Commit `output.ts` and `output.test.ts` before beginning command migrations.** The `renderOnce` fix is small. Landing the infrastructure with a verified, robust render pattern prevents the timing assumption from propagating into every command during the migration.
