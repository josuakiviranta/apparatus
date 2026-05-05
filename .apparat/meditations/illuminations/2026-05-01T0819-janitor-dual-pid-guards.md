---
date: 2026-05-01
description: meditate.ts owns 5 inline PID utilities that duplicate the daemon's PID infrastructure, creating two independent single-instance guards for the same command — project-level and daemon-level PIDs coexist with no awareness of each other.
---

## Findings

1. **What:** `meditate.ts` defines 5 PID utility functions inline (`pidPath`, `writePid`, `readPid`, `removePid`, `isPidAlive`) that duplicate the daemon's PID infrastructure in `state.ts` / `runner.ts`.

   **Evidence:**
   - `src/cli/commands/meditate.ts:10–34` — five exported functions managing `<project>/.meditate.pid`
   - `src/daemon/state.ts:46–49` — `getPidFilePath(taskId)` → `~/.apparat/pids/<safeId>.pid`
   - `src/daemon/runner.ts:21–31` — `isSessionRunning(task)` reads daemon PID, calls `process.kill(pid, 0)` — identical logic to `isPidAlive()`
   - `src/daemon/runner.ts:33–42` — `killSession(task)` — mirrors `removePid()` + signal

   **Why it matters (KISS lens):** Two independent single-instance guards exist for the same command. When the daemon launches meditate, it writes `~/.apparat/pids/meditate:<project>.pid`; simultaneously, `meditateCommand` writes `<project>/.meditate.pid`. The manual-launch guard (`readPid` / `isPidAlive` at line 70–71) checks only the project PID — it cannot detect a daemon-launched meditate session. A reader tracking "is meditate already running?" must hold two state locations in their head; neither is authoritative.

   **Suggested action:** Remove the 5 inline PID utilities from `meditate.ts`. Delegate single-instance protection to the daemon by having `meditateCommand` query `daemon-client.request("is_running", ...)` before starting, or accept that the daemon's own dedup (it does not start a task already in `running` state) is sufficient and drop the project-level guard entirely.

2. **What:** The 5 inline functions are exported (public API), but their only callers are the three lines within `meditateCommand` itself — unnecessary surface area.

   **Evidence:**
   - `src/cli/commands/meditate.ts:10` `export function pidPath` — exported
   - `src/cli/commands/meditate.ts:14` `export function writePid` — exported
   - `src/cli/commands/meditate.ts:18` `export function readPid` — exported
   - `src/cli/commands/meditate.ts:25` `export function removePid` — exported
   - `src/cli/commands/meditate.ts:30` `export function isPidAlive` — exported
   - Callers: only `meditateCommand` (lines 70–71, 77, 89)

   **Why it matters (KISS lens):** Exporting internal helpers couples the module's internal state management to callers that will never use them (verified: no other file imports these five names). Readers must evaluate five exported functions as potentially load-bearing public contracts.

   **Suggested action:** If the project-level PID guard is kept short-term, un-export all five functions.

## Reading thread

- `2026-05-01T0512-command-surface-duplicates-pipeline-engine.md` — covers `implement`/`meditate` commands as bespoke wrappers around `pipeline run`; does NOT mention the PID duplication or dual-guard problem, so this is additive.
- `2026-05-01T0344-janitor-pipeline-run-monolith.md` — `pipelineRunCommand` monolith; different file and problem, no overlap.
