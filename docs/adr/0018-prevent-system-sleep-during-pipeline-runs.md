# ADR 0018 — Prevent system sleep for the lifetime of every pipeline run

**Status:** Accepted
**Date:** 2026-05-13
**Related:** ADR-0015 (asymmetric GC at pipeline tail), ADR-0016 (run-scoped MCP config with heartbeat)

## Context

A pipeline run is a long-haul operation. `illumination-to-implementation` traverses 17 nodes — verifier, chat refinement loop, approval gate, design-writer, plan-writer, implement deep-loop, tmux-tester, memory-writer — and typically runs for an hour or more. `parallel-illumination-to-implementation` adds parallel batch orchestration on top and can run several hours. The engine process spawned by `pipelineRunCommand` at `src/cli/commands/pipeline/run.ts:43` is the single long-lived parent of every node child, including subagent `claude` processes, tool-node scripts, and tmux sibling windows.

On macOS the default `pmset -g` profile lets the system enter S3/S4 sleep after a short idle (operator default observed: AC `displaysleep 10`, system `sleep 1`, battery much tighter). When the system actually sleeps mid-run the kernel suspends every user-process; in-flight `claude` HTTP calls eventually time out, tool-node scripts freeze, and the engine resumes on wake into a half-broken state. The macOS-default `ttyskeepawake=1` keeps the system awake while the tty has I/O, but `claude` spends most of its time idle on an HTTPS read (tens of seconds), which is not tty-I/O — so the keepawake heuristic does not save us.

The same engine process is spawned in two places:

- **Foreground.** Operator types `apparat pipeline run …`; the process is a child of the operator's tty.
- **Daemon-scheduled.** `apparat heartbeat` daemon ticks fire; the daemon spawns a fresh `apparat pipeline run …` child at `src/daemon/runner.ts:95`.

Both paths re-enter `pipelineRunCommand`; the daemon is power-management-blind.

The operator-product expectation, captured during a 2026-05-13 grill-with-docs session, is "I want to leave the computer and trust the pipeline finishes." VISION.md is firm that apparatus is single-developer / single-machine, so changing the macOS sleep policy for the duration of a run is in-bounds — there is no second user to surprise.

## Decision

A new `preventSleep()` helper at `src/lib/prevent-sleep.ts` is called as the **first line** of `pipelineRunCommand` at `src/cli/commands/pipeline/run.ts:43`. On macOS the helper spawns `caffeinate -is -w <self.pid>` as a detached, unref'd sibling child:

```ts
// src/lib/prevent-sleep.ts
import { spawn } from "node:child_process";

export function preventSleep(): void {
  if (process.platform === "darwin") {
    const child = spawn("caffeinate", ["-is", "-w", String(process.pid)], {
      stdio: "ignore",
      detached: true,
    });
    child.unref();
    return;
  }
  // linux / win32: silent no-op; see "Cross-platform" below.
}
```

`caffeinate -w <pid>` watches a specific PID and releases its no-sleep assertion when the watched process exits. The OS handles teardown; the engine writes no shutdown hook. `-i` blocks idle sleep, `-s` blocks system sleep. Display sleep is allowed (the screen may go black; system stays awake). The detached + unref'd shape keeps the sidecar process out of the engine's event-loop accounting.

**Always on, no opt-out.** No flag, no env var, no `--allow-sleep`. A pipeline run is, by product definition, the operator's stated intent to complete the work. Any escape hatch creates a footgun ("forgot the flag, lost the overnight run") and shallows the interface for nothing — the macOS sleep policy is reversible the instant the engine exits.

**Per-run, not daemon-lifetime.** The `caffeinate` sidecar's lifetime equals the engine's lifetime. The daemon process itself is **not** caffeinated; between heartbeat ticks the system is free to sleep normally. Long heartbeat intervals (operator default for janitor: `--every 720` = 12h) would otherwise pin the system awake for hours of no work.

**CLI-layer hook, not engine-layer.** The helper call sits in `pipelineRunCommand`, not inside `src/attractor/`. The engine stays pure orchestration — power management is a CLI / operator-product concern, not an engine concern. `pipelineRunCommand` is the single CLI seam: its production callers are commander's `apparat pipeline run` handler, `src/cli/commands/implement.ts:12`, `src/cli/commands/meditate.ts:46`, and the daemon-spawned `apparat pipeline run` child re-entering through commander. Every operator-facing long-running path goes through this one function — CLI-layer placement covers every real path with zero risk of bypass.

**Cross-platform stub.** The helper has linux and win32 branches stubbed as silent no-ops today. The interface (`preventSleep(): void`) is platform-agnostic; the implementation switches on `process.platform`. A future Linux branch shells out to `systemd-inhibit --what=sleep --who=apparat --why="pipeline run" --mode=block sleep infinity &` with a similar PID-watching shape (the parent's `child.unref()` keeps the assertion alive for the engine's lifetime). Windows is unlikely to be in scope (tmux requirement on `parallel-illumination-to-implementation` excludes native Windows), but the seam is consistent.

## Considered alternatives

- **Opt-in flag (`--no-sleep` / `APPARAT_NO_SLEEP=1`).** Rejected — the case the operator named ("leave the computer overnight") is the default expectation. Forcing the operator to remember a flag every time inverts the failure mode: the common path is the one that silently fails.
- **Opt-out flag (`--allow-sleep`).** Rejected — every additional surface area on a single-developer tool is a footgun that has to be re-explained later. The escape hatch is "kill the run, type the next command without the wrapper" — i.e. the operator already has full control via Ctrl-C.
- **Daemon-lifetime caffeinate (wrap the daemon process itself at `src/lib/daemon-client.ts:50`).** Rejected — pins the system awake between ticks. For a janitor on `--every 720`, the system would be awake for 11h 59m of every 12-hour cycle to do 30s of real work.
- **Engine-internal hook (call `preventSleep()` inside `runPipeline` in `src/attractor/`).** Rejected for now — couples the engine to a CLI-product policy. Cheap to revisit if a programmatic (non-CLI) embed caller ever materialises; today there is none.
- **Native macOS power-assertion via `IOKit` (`IOPMAssertionCreateWithName`).** Rejected — adds a native dep (or an electron-shaped npm package) for parity with a tool that ships with the OS. `caffeinate` is sufficient.
- **`caffeinate -d` (also block display sleep).** Rejected — the operator wants the screen to go black while they're away. Only `-i -s` are needed.

## Consequences

- Foreground and heartbeat-spawned pipeline runs both keep the system awake for their entire duration. The operator can lock the screen (Ctrl-Cmd-Q) or let display sleep elapse; system sleep is blocked.
- macOS only today. Linux operators get no protection until the `systemd-inhibit` branch lands; this is acceptable because Linux servers typically have no aggressive sleep policy and Linux laptops are not a primary apparatus target.
- A pipeline that hangs (deep-loop with no `done:true` and no `max_iterations` cap) blocks system sleep for the duration of the hang. Same risk shape as today's "you ran a pipeline that hangs" — the operator notices and Ctrl-Cs. No new failure surface.
- `caffeinate` is a built-in macOS binary; no new dependency, no install step, no upgrade story.
- If the engine crashes mid-run, the `caffeinate -w <pid>` watcher sees the gone PID and self-exits — no orphaned no-sleep assertion. Verified by `man caffeinate`: "Once it does, caffeinate exits shortly thereafter."
- The CLI-layer seam means `apparat pipeline validate`, `apparat pipeline trace`, `apparat pipeline show`, `apparat status`, and `apparat heartbeat list` do **not** invoke `preventSleep()`. They are short read-only ops and need no protection.
- A future programmatic embed of the engine (no CLI wrapper) would not inherit sleep protection. ADR-revisit triggered if such an embed materialises; the move is to push `preventSleep()` down into `runPipeline` at that point.
