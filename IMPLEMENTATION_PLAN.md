# Plan: Prevent system sleep for the lifetime of every pipeline run

**Date:** 2026-05-13
**Originating design:** `docs/superpowers/specs/2026-05-13-prevent-system-sleep-design.md`
**Originating ADR:** `docs/adr/0021-prevent-system-sleep-during-pipeline-runs.md`

## Pre-flight context (read before starting)

- The design's headline claim is: one new helper file `src/lib/prevent-sleep.ts` + one new statement at the top of `pipelineRunCommand` in `src/cli/commands/pipeline/run.ts:44`. Every other production path (`apparat implement`, `apparat meditate`, `apparat heartbeat …`) re-enters this same function and inherits the hook.
- macOS branch is active. Linux and Windows branches are silent no-ops with TODO markers (B-shape extension stubs).
- No new test directory. Place the vitest test at `src/cli/tests/prevent-sleep.test.ts` per existing convention.
- `caffeinate -is -w <pid>` is built into macOS. `-i` blocks idle sleep, `-s` blocks system sleep, `-w <pid>` watches a PID and exits when it dies. No display blocking (operators want the screen to go black).
- Vitest with `vi.mock("node:child_process")` is the pattern in this repo; cross-check `src/cli/tests/daemon-client-socket-path.test.ts` for the existing seam test shape.

## Chunk 1: Helper + unit test — [x] DONE (e7827fc)

### Step 1.1 — Write the failing test

Create `src/cli/tests/prevent-sleep.test.ts`. Mirror the `vi.hoisted` + `vi.mock` pattern used in `src/cli/tests/agent.test.ts:11-22` — `vi.mock` is hoisted above plain `const` declarations, so the spawn-mock reference must come from `vi.hoisted()`:

```ts
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: spawnMock }));

const PLATFORM = process.platform;
function setPlatform(p: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", { value: p, configurable: true });
}

describe("preventSleep", () => {
  beforeEach(() => {
    vi.resetModules();
    spawnMock.mockReset();
    spawnMock.mockReturnValue({ unref: vi.fn(), on: vi.fn() });
  });

  afterEach(() => {
    setPlatform(PLATFORM);
  });

  it("spawns caffeinate -is -w <pid> on darwin", async () => {
    setPlatform("darwin");
    const { preventSleep } = await import("../../lib/prevent-sleep.js");
    preventSleep();
    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [cmd, args, opts] = spawnMock.mock.calls[0];
    expect(cmd).toBe("caffeinate");
    expect(args).toEqual(["-is", "-w", String(process.pid)]);
    expect(opts).toMatchObject({ stdio: "ignore", detached: true });
  });

  it("calls unref() on the spawned child on darwin", async () => {
    setPlatform("darwin");
    const unref = vi.fn();
    spawnMock.mockReturnValue({ unref, on: vi.fn() });
    const { preventSleep } = await import("../../lib/prevent-sleep.js");
    preventSleep();
    expect(unref).toHaveBeenCalledTimes(1);
  });

  it("attaches an error handler so an absent caffeinate does not crash the engine", async () => {
    setPlatform("darwin");
    const on = vi.fn();
    spawnMock.mockReturnValue({ unref: vi.fn(), on });
    const { preventSleep } = await import("../../lib/prevent-sleep.js");
    preventSleep();
    expect(on).toHaveBeenCalledWith("error", expect.any(Function));
  });

  it("is a silent no-op on linux", async () => {
    setPlatform("linux");
    const { preventSleep } = await import("../../lib/prevent-sleep.js");
    preventSleep();
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("is a silent no-op on win32", async () => {
    setPlatform("win32");
    const { preventSleep } = await import("../../lib/prevent-sleep.js");
    preventSleep();
    expect(spawnMock).not.toHaveBeenCalled();
  });
});
```

Run:

```
npx vitest run src/cli/tests/prevent-sleep.test.ts
```

Expected: 5 failures, all `Cannot find module '../../lib/prevent-sleep.js'`.

### Step 1.2 — Make it pass

Create `src/lib/prevent-sleep.ts`:

```ts
import { spawn } from "node:child_process";

// caffeinate is built into macOS; on a stripped-down VM where it's missing,
// spawn emits an 'error' event asynchronously. Without a listener, Node
// crashes the engine on unhandled-error. We attach a noop listener so the
// pipeline keeps running, sleep-vulnerable.
export function preventSleep(): void {
  if (process.platform === "darwin") {
    const child = spawn("caffeinate", ["-is", "-w", String(process.pid)], {
      stdio: "ignore",
      detached: true,
    });
    child.on("error", () => {});
    child.unref();
    return;
  }
  // TODO(linux): systemd-inhibit --what=sleep --who=apparat --why="pipeline run" \
  //              --mode=block sleep infinity (detached + unref).
  // TODO(win32): SetThreadExecutionState via native binding or noop.
}
```

Run again:

```
npx vitest run src/cli/tests/prevent-sleep.test.ts
```

Expected: 5 passing.

### Step 1.3 — Commit

```
git add src/lib/prevent-sleep.ts src/cli/tests/prevent-sleep.test.ts
git commit -m "prevent-sleep: add platform-stubbed sleep blocker (macOS active)

Caffeinate -is -w <pid> sidecar; linux/win32 silent no-op.
See docs/adr/0018 + docs/superpowers/specs/2026-05-13-prevent-system-sleep-design.md."
```

## Verification targets

- Smokes: None.
- Manual exercises: None at this chunk — helper is unused. Wire-up happens in Chunk 2.
- Lint: `npx vitest run src/cli/tests/prevent-sleep.test.ts` then `npx tsc --noEmit`.
- Surfaces touched: `lib`.

---

## Chunk 2: Wire into pipelineRunCommand + docs — [x] DONE (893ff2b)

**Note on test mocks:** `pipeline.test.ts` and `pipeline-headless.test.ts` previously stubbed `spawn()` with an object missing `unref()`. Once `preventSleep()` ran as the first statement of `pipelineRunCommand`, every test through that path crashed with `TypeError: child.unref is not a function`. Fix was a single-line addition (`unref: vi.fn()`) to each mock — bundled in the Chunk 2 commit. Future test files that mock `child_process` for `pipelineRunCommand` coverage must include `unref` on the spawn stub.

### Step 2.1 — Add the call site

Edit `src/cli/commands/pipeline/run.ts`. The current function entry reads:

```ts
export async function pipelineRunCommand(dotFile: string, opts: PipelineRunOptions = {}): Promise<void> {
  let loaded: LoadedPipeline;
  try {
    loaded = await loadPipeline(dotFile, { project: opts.project });
```

Change to:

```ts
export async function pipelineRunCommand(dotFile: string, opts: PipelineRunOptions = {}): Promise<void> {
  preventSleep();
  let loaded: LoadedPipeline;
  try {
    loaded = await loadPipeline(dotFile, { project: opts.project });
```

Add the import at the top of the file alongside the other `src/lib/` imports. Existing imports cluster around lines 3–32. Add:

```ts
import { preventSleep } from "../../../lib/prevent-sleep.js";
```

Pathing: `src/cli/commands/pipeline/run.ts` → `src/lib/prevent-sleep.ts` is three `..` segments. Cross-check against the existing import `import { newRunId, runsDir } from "../../lib/apparat-paths.js";` on line 22 (two `..`) — confirm depth before committing.

### Step 2.2 — Verify with a real run

In a separate terminal, while a pipeline is running:

```
pgrep -fl caffeinate
```

Expected: at least one line showing `caffeinate -is -w <PID>` where `<PID>` matches the engine PID (`pgrep -fl "apparat pipeline run"`).

After the pipeline exits (success or failure), re-run `pgrep -fl caffeinate`. Expected: no caffeinate process bound to the engine PID. The OS reaped it via the `-w` watch.

```
pmset -g assertions | grep -B1 -A3 caffeinate
```

Expected during a run: a `PreventUserIdleSystemSleep` (or similar) assertion attributed to `caffeinate`. After: no apparat-related assertion.

Repeat the same observation for:
- `apparat implement <folder>` — caffeinate sibling visible mid-run.
- `apparat meditate <folder>` — caffeinate sibling visible mid-run.
- `apparat heartbeat pipeline <name> --project <folder> --every 1` then wait for the first tick — caffeinate sibling visible for the duration of the tick.

If any of these does **not** show caffeinate, the seam claim is broken; investigate before committing.

### Step 2.3 — Update README

Edit `README.md`. Find the "## Stopping the loop" section (currently around line 211–213). Insert a new subsection immediately before it:

```markdown
## Sleep behaviour (macOS)

Every `apparat pipeline run` (and `apparat implement` / `apparat meditate` /
`apparat heartbeat`-scheduled run, all of which re-enter the same command)
blocks system sleep for the lifetime of the engine process. The macOS
`caffeinate -is -w <pid>` binary is spawned as a sibling and watches the
engine PID; when the engine exits, caffeinate exits and the no-sleep
assertion is released. Display sleep is not blocked — the screen can go
black while the system stays awake.

This is always on; there is no flag to disable it. macOS user logout
(Apple menu → Log Out) is still terminal: the per-user `launchd` reaps
the daemon. Lock the screen instead of logging out for overnight runs.

Linux and Windows have no sleep protection today; the seam is stubbed
for future expansion. See `docs/adr/0021-prevent-system-sleep-during-pipeline-runs.md`.
```

### Step 2.4 — Commit

```
git add src/cli/commands/pipeline/run.ts README.md
git commit -m "prevent-sleep: wire preventSleep() into pipelineRunCommand

Single CLI-layer seam covers apparat pipeline run, implement, meditate,
and heartbeat-spawned runs. README documents the always-on behavior
and the logout caveat."
```

### Step 2.5 — Run the full test suite

```
npx vitest run
npx tsc --noEmit
```

Expected: no new failures attributable to this change. Pre-existing diagnostics in `program.ts` / `pipeline-run-positional.test.ts` are unrelated to this work — flag them in the session-closure file if they surface but do not gate on them.

## Verification targets

- Smokes: None.
- Manual exercises:
  - `apparat pipeline run <pipeline> <project>` while `pgrep -fl caffeinate` is watched in a second tty. Caffeinate visible during run; gone after.
  - `apparat implement <folder>` — same.
  - `apparat meditate <folder>` — same.
  - `apparat heartbeat pipeline <name> --project <folder> --every 1` then attach via `apparat heartbeat logs <id> --follow`; observe caffeinate appearing per tick, vanishing between ticks.
  - `pmset -g assertions | grep -A2 caffeinate` shows held during run, released after.
- Lint: `npx vitest run` (full suite) plus `npx tsc --noEmit`.
- Surfaces touched: `cli/commands/pipeline`, `lib`, `docs`.

---

## Roll-back

Both chunks are independently revertable. Step 2.1's edit is a 1-line insert + 1-line import; revert with `git revert <sha>`. Chunk 1's helper is unused after revert and can either stay (dead code) or be removed in a follow-up commit.

## Open questions for the executor

None. Missing-`caffeinate` failure path is closed in-plan: helper attaches a noop `error` listener (the spawn doesn't throw synchronously on ENOENT; Node emits an async `error` event which would otherwise crash the engine if unhandled). Test asserts the listener is attached.
