# Design: Prevent system sleep for the lifetime of every pipeline run

**Date:** 2026-05-13
**Status:** draft (pending review)
**Originating ADR:** `docs/adr/0021-prevent-system-sleep-during-pipeline-runs.md`

## 1. Motivation

A pipeline run is a long-haul operation that operators routinely leave running while away from the computer. `illumination-to-implementation` runs 17 nodes for an hour or more; `parallel-illumination-to-implementation` adds parallel batch orchestration and can run several hours. The engine process spawned by `pipelineRunCommand` at `src/cli/commands/pipeline/run.ts:43` is the single long-lived parent of every node child.

On macOS the default `pmset -g` profile lets the system enter S3/S4 sleep after a short idle. When the system sleeps mid-run the kernel suspends every user-process; in-flight `claude` HTTPS calls eventually time out, tool-node scripts freeze, and the engine resumes on wake into a half-broken state. The macOS-default `ttyskeepawake=1` does not save us because `claude` spends most of its time idle on an HTTPS read, which the kernel does not count as tty I/O.

The product expectation captured during the 2026-05-13 grill-with-docs session is **"I want to leave the computer and trust the pipeline finishes."** VISION.md is firm that apparatus is single-developer / single-machine, so changing macOS sleep policy for the duration of a run is in-bounds — there is no second user to surprise.

### What this design closes

- The "left it overnight, came back to a frozen run" failure that today requires the operator to `caffeinate apparat pipeline run …` by hand, **or** disable system sleep in System Settings, **or** ssh-keepalive a remote box. None of those are obvious from the README; all three are operator burden.
- The "I trust the daemon" follow-on for `apparat heartbeat`: today the daemon-spawned `apparat pipeline run` child has the same sleep vulnerability as any foreground run. Closing the foreground hole closes the daemon hole, because both paths go through `pipelineRunCommand`.

### What this design explicitly does **not** close

- macOS user **logout** (Apple menu → Log Out). The per-user `launchd` reaps the daemon and every child; no `caffeinate` survives that. A real solution is a `LaunchDaemon` plist running as root, which is out of scope (much bigger surface; conflicts with the single-machine VISION).
- Display sleep. Display is allowed to go black; system stays awake. This is deliberate — operators want the screen off while they're away.
- Linux and Windows. Stubbed silent no-ops today; explicitly designed for B-shape extension later.

## 2. Decision summary

A single new helper file plus one new line in `pipelineRunCommand`. No `.dot` schema change, no agent rubric change, no daemon change, no engine change.

1. **New file `src/lib/prevent-sleep.ts`** exports `preventSleep(): void`. On `process.platform === "darwin"` it spawns `caffeinate -is -w <self.pid>` as a detached, unref'd child. On `linux` and `win32` it returns silently — the B-shape extension points.

2. **One-line call as the first statement of `pipelineRunCommand`'s body** in `src/cli/commands/pipeline/run.ts` (currently `:44`). Covers four real callers of the seam:
   - `apparat pipeline run …` (commander → `pipelineRunCommand` direct).
   - `apparat implement <folder>` (`src/cli/commands/implement.ts:12` → `pipelineRunCommand("implement", …)`).
   - `apparat meditate <folder>` (`src/cli/commands/meditate.ts:46` → `pipelineRunCommand("meditate", …)`).
   - `apparat heartbeat` daemon ticks (`src/daemon/runner.ts:95` spawns a fresh `apparat pipeline run` child which re-enters `pipelineRunCommand`).

3. **Vitest unit coverage at `src/cli/tests/prevent-sleep.test.ts`** stubs `child_process.spawn` and asserts:
   - On `darwin`: one spawn call, command `caffeinate`, args `["-is", "-w", String(process.pid)]`, options include `{ stdio: "ignore", detached: true }`, returned child has `unref()` invoked.
   - On `linux` / `win32`: zero spawn calls; helper returns void.

4. **README "Stopping the loop" section** gains a short paragraph naming the always-on behavior and the one excluded case (full logout). Mirror language for `apparat heartbeat` notes the inherited coverage.

No new tests are added at the engine layer; the seam is the CLI command.

## 3. Architecture

### 3.1 Module shape

`src/lib/prevent-sleep.ts` is a depth-positive helper:

- **Interface:** one symbol, no args, no return value, no teardown. Caller writes one line and is done.
- **Implementation:** hides platform branch, `caffeinate` flag knowledge (`-i` idle, `-s` system, `-w` PID watch), `child.unref()` event-loop accounting, and the fact that teardown is handled by the OS via PID watch (not by the caller).
- **Seam test:** stub `child_process.spawn` once, assert call shape. One mock at one boundary.

The interface stays constant when Linux / Windows branches are added later. The implementation grows; the caller does not change.

### 3.2 Call site

`src/cli/commands/pipeline/run.ts:43` is the entry of `pipelineRunCommand`. Today:

```ts
export async function pipelineRunCommand(dotFile: string, opts: PipelineRunOptions = {}): Promise<void> {
  let loaded: LoadedPipeline;
  try {
    loaded = await loadPipeline(dotFile, { project: opts.project });
  ...
```

After:

```ts
export async function pipelineRunCommand(dotFile: string, opts: PipelineRunOptions = {}): Promise<void> {
  preventSleep();
  let loaded: LoadedPipeline;
  try {
    loaded = await loadPipeline(dotFile, { project: opts.project });
  ...
```

Placement rationale:

- **First line, not after preflight.** Fast-fail paths (lines 54, 66, 78, 95, 119, 128) exit the parent immediately; `caffeinate -w <pid>` watches the parent PID and self-exits when the parent dies. Worst case is two extra process spawns lasting <10ms total. Cheaper than the branching logic required to defer until "we know we're really going to run."
- **CLI layer, not engine layer.** Power management is a CLI/operator-product policy, not an engine-orchestration concern. CONTEXT.md treats the engine as pure orchestration; pushing `preventSleep()` into `runPipeline` would couple a product policy to the engine. `pipelineRunCommand` is the single CLI seam — its production callers are `pipeline.ts` (commander handler), `implement.ts:12`, `meditate.ts:46`, and the daemon-spawned `apparat pipeline run` child re-entering through commander. Every long-running operator-facing path goes through this one function; CLI-layer placement covers every real path with zero risk of bypass.
- **Single seam covers heartbeat.** `src/daemon/runner.ts:95` spawns `apparat pipeline run …` as a child process. That child re-enters `pipelineRunCommand` and inherits the hook. `src/daemon/runner.ts` stays power-management-blind.

### 3.3 Lifetime

```
pipelineRunCommand starts
├── preventSleep()
│   └── spawn caffeinate -is -w <parent-pid>   (detached, unref'd)
│       └── (sibling, NOT a child; lives independently)
├── ... engine work runs for hours ...
└── pipelineRunCommand returns (or process.exit / crash / SIGTERM)
    └── caffeinate watcher detects parent PID gone
        └── caffeinate exits; OS releases no-sleep assertion
```

The `caffeinate` sidecar is **not** a child of the engine in the `wait()` sense — `detached: true` plus `child.unref()` means the event loop is not held alive by it, and the engine does not block on its exit. The sidecar's lifetime is bounded by PID watch on the engine.

Edge case: if the engine is killed by `SIGKILL` (which cannot be trapped), `caffeinate -w` still detects the dead parent and exits. Verified by `man caffeinate`.

### 3.4 Failure modes

| Scenario | Behaviour |
|---|---|
| `caffeinate` binary missing | macOS without `caffeinate` would be a broken macOS; not a realistic case. Helper logs nothing and continues; the pipeline runs but is sleep-vulnerable. |
| Engine crashes (uncaught throw) | Process exits, parent PID gone, caffeinate self-exits. No orphan. |
| Engine `SIGKILL`'d externally | Same as crash. Caffeinate detects PID gone. |
| Engine hangs (deep-loop, no `done`) | Caffeinate stays alive, system blocked from sleeping until operator Ctrl-Cs. Pre-existing risk shape; not introduced here. |
| Linux/Windows operator runs the CLI | Helper returns silently. Pipeline runs without sleep protection. The native OS power policy applies. |
| Foreground `apparat pipeline validate` etc. | These commands do not call `preventSleep()` — different CLI handler. No side effect. |

## 4. Code anchors

- `src/cli/commands/pipeline/run.ts:43-46` — `pipelineRunCommand` entry, where the new `preventSleep()` line lands.
- `src/lib/daemon-client.ts:48-52` — daemon spawn that itself uses `{ detached: true, stdio: "ignore" }` plus `child.unref()`. Same pattern we mirror for the caffeinate sidecar.
- `src/daemon/runner.ts:94-99` — daemon-side spawn of `apparat pipeline run` child. No change needed; coverage inherited through `pipelineRunCommand`.
- `src/attractor/core/engine.ts` — `runPipeline` lives here; **not** touched.
- `src/lib/` — current siblings include `daemon-client.ts`, `failure-handoff.ts`, etc. `prevent-sleep.ts` slots in at the same tier.
- `src/cli/tests/prevent-sleep.test.ts` — vitest convention for `src/lib/*.ts` colocates tests under `src/cli/tests/` (e.g. `src/cli/tests/daemon-client-socket-path.test.ts`). No new test directory created.

## 5. Blast radius / impact surface

- **Size:** S.
- **Surfaces crossed:** CLI command (`pipeline/run.ts`), new helper file (`lib/prevent-sleep.ts`), README "Stopping the loop" paragraph, vitest unit test.
- **Breaking changes:** none. macOS operators who previously relied on "my Mac sleeps when idle during a pipeline run" lose that behavior — flagged as a CHANGELOG note (apparatus is single-operator; the affected operator is the one shipping this change).
- **Update checklist:**
  - [ ] `docs/adr/0021-prevent-system-sleep-during-pipeline-runs.md` — exists, status `Accepted`.
  - [ ] `README.md` — add paragraph under "Stopping the loop" or new "Sleep behaviour" subsection.
  - [ ] `src/cli/tests/` — no new tests; existing `pipeline-run-*` tests run unchanged.
  - [ ] `CONTEXT.md` — no glossary addition (`preventSleep` is a private helper, not domain vocabulary).

## 6. Open questions

- **Should the helper log a one-line stderr note on macOS** to make the always-on behavior discoverable in scrollback? Argument for: operators wonder why their Mac won't sleep, scroll back, see `[apparat] system sleep blocked for the duration of this pipeline run`, problem self-explains. Argument against: noisy for repeat operators. **Default: no log; document in README only.** Revisit if this confuses an operator in practice.
- **Should `apparat status` surface whether a no-sleep assertion is held?** Argument for: visibility ("apparat is keeping the system awake because run X is in flight"). Argument against: derivable from "is a run in flight" which `apparat status` already shows. **Default: no, not in scope.**

## 7. Verification targets

- Smokes: None — the change is product behavior, not pipeline-engine behavior; no `.apparat/scenarios/*.dot` fixture covers it.
- Manual exercises:
  - `apparat pipeline run …`: `pgrep -fl caffeinate` during the run shows a caffeinate child with the engine PID in args. After exit, `pgrep -fl caffeinate` does not show that PID.
  - `apparat implement <folder>`: same assertion. Caffeinate sibling spawned via the shared `pipelineRunCommand` seam.
  - `apparat meditate <folder>`: same assertion. Caffeinate sibling spawned via the shared seam.
  - `apparat heartbeat pipeline …` tick: the daemon-spawned `apparat pipeline run` child caffeinates for the run; between ticks no caffeinate process is alive.
  - `pmset -g assertions | grep -A2 caffeinate` shows the `PreventUserIdleSystemSleep` assertion held during a run, released after.
- Lint: `npx vitest run src/cli/tests/prevent-sleep.test.ts` plus `npx tsc --noEmit`.
- Surfaces touched: `cli/commands/pipeline`, `lib`.
