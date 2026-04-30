---
date: 2026-04-30
description: Agent.kill() is never called externally — it and the this._child tracking field it depends on are dead code in src/cli/lib/agent.ts.
---

## Findings

1. **What:** `Agent.kill()` (the public instance method) is dead code — no caller exists anywhere in the codebase. The `private _child` field it reads is tracked solely to support this method.

   **Evidence:**
   - `src/cli/lib/agent.ts:449–456` — the only consumer of `this._child`:
     ```ts
     kill(): void {
       if (this._child?.pid) {
         try {
           process.kill(-this._child.pid, "SIGTERM");
         } catch {
           // Process may already be dead
         }
       }
     }
     ```
   - `src/cli/lib/agent.ts:108` — field declaration: `private _child: ChildProcess | null = null;`
   - Assignments: `this._child = child` / `this._child = null` appear at ~line 218 (`run()`), ~line 403 (`runInteractive()` close handler). Both exist only to keep `_child` current for `kill()`.
   - Grep across all of `src/` for `agent\.kill\b` or `\.kill()` on Agent instances: **zero results**. Every `child.kill()` call in the codebase operates on a `ChildHandle` or raw `ChildProcess`, not on the `Agent` instance.
   - `src/cli/tests/agent.test.ts:365` — only `kill` in the test suite is a mock of the spawned `ChildProcess.kill`, not `Agent.kill`.

   **Why it matters (KISS lens):** A reader of `agent.ts` must track `_child` as mutable state throughout `run()` and `runInteractive()` — two execution paths with different child lifetimes. That state only pays off if `kill()` can be called, which never happens. The field and its four assignment sites (two sets / two clears) are pure overhead that complicate mental model of an already 502-line file.

   **Suggested action:** Delete `Agent.kill()`, the `private _child` field, and all four assignment sites (`this._child = child`, `this._child = null`). Verify no tests break. The abort / kill semantics live entirely inside `runInteractive()`'s returned `ChildHandle.kill` closure — which captures the local `child` variable, not `this._child`.

## Reading thread

- `2026-05-01T0050-pipeline-location-drift-vs-vision.md` — covers pipeline location and resolver YAGNI; no overlap with agent.ts internals. Confirms this is a fresh area.
