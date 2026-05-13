# Design: Project-shape preflight + run-folder-scoped MCP config with heartbeat GC

**Date:** 2026-05-13
**Status:** draft (pending review)
**Originating illumination:** `.apparat/meditations/illuminations/2026-05-13T0736-meditate-no-project-orientation-and-mcp-orphans.md`
**Related ADR:** extends ADR-0015 (`docs/adr/0015-asymmetric-gc-pipeline-tail-success.md`); new ADR-0016 lands with this change.

## 1. Motivation

`apparat meditate <projectFolder>` writes durable side-effects (illuminations, runs, commits, MCP-config receipts) without proving its path argument is *apparat-shaped* and without sweeping debris from previous aborts. Two on-disk fingerprints in this repo today confirm both gaps:

- **Ghost run.** `.apparat/.apparat/runs/meditate-4ab00e87/checkpoint.json` carries `"project": "/Users/josu/Documents/projects/apparatus/.apparat"` — i.e. an operator typo / autocomplete slip pointed meditate at the project's own internal folder. The pipeline cheerfully created `.apparat/.apparat/meditations/illuminations/` and wrote (and committed) a buried illumination at `.apparat/.apparat/meditations/illuminations/2026-05-12T1028-collapse-memory-tail-and-tier-pipeline-models.md`. `list_illuminations` on the real project will never surface it.
- **MCP debris.** Two repo-root orphans survive: `.mcp-meditate-1777197355164.json` (Apr 26) and `.mcp-verifier-1778665005965.json` (May 13 11:36 — fresh, mtime today). The triage chat-notes flagged this same pattern two months ago; the gitignore line `.mcp-*-*.json` (added by `appendMeditateGitignore` at `src/cli/lib/pipeline-bootstrap.ts:40`) hides them from `git status` but does not delete them. They accumulate.

The only guard today is `existsSync` at `src/cli/commands/meditate.ts:21`:

```ts
const absPath = resolve(projectFolder);
if (!existsSync(absPath)) {
  await output.error(`Error: project folder not found: ${absPath}`);
  process.exit(1);
}
```

No basename `.apparat` refusal. No `VISION.md` / `CONTEXT.md` / `.git/` shape check. The pipeline trusts the path argument like an open-mode file write trusts a filename.

MCP-config writes live one level down at `src/cli/lib/agent.ts:199`:

```ts
const configPath = path.join(cwd, `.mcp-${this.config.name}-${Date.now()}.json`);
fs.writeFileSync(configPath, JSON.stringify({ mcpServers }, null, 2));
```

`cleanupMcpConfig` (`src/cli/lib/agent.ts:205-214`) runs from `run()`'s `finally` at `src/cli/lib/agent.ts:349-351`, covering the happy path. It does *not* cover SIGKILL, OOM, or the meditate harness's own PID-aliveness fence (which can leave a child reaped while the parent dies between `writeMcpConfig` and the `finally`).

The strategic compass: VISION's "solo-developer orchestration against any local project" + an explicit goal of running meditate + janitor overnight in parallel (refinement round 2) means both bugs are core ergonomics, not surface creep. ADR-0015 (Accepted 2026-05-12, asymmetric GC of run-scoped scratch paths) is the direct precedent for run-folder-scoped cleanup — this design *extends* that decision rather than reinventing it.

The `deep-modules-hide-complexity` lens (refinement round 2): a per-file-type GC for `.mcp-*` would be a shallow-module symptom. The deep move is one seam at one path layer — `runs/<runId>/` becomes the home for *all* run-scoped scratch — so any future per-run debris cooperates with the same heartbeat-driven GC for free.

## 2. Decision summary

Three landed pieces, all from the cumulative refinement log:

1. **Project-shape preflight in `meditateCommand`** (`src/cli/commands/meditate.ts:20-24`). Hard-refuse when `basename(absPath) === ".apparat"`. Otherwise require at least one of: `VISION.md`, `CONTEXT.md`, `.apparat/`, `.git/` at `absPath`. One if-block, two failure messages, both pointing at the parent.
2. **Relocate MCP configs into `runs/<runId>/`** (`src/cli/lib/agent.ts:199`). `RunOptions` (`src/cli/lib/agent.ts:79-91`) gains an optional `runId?: string`. When supplied, `writeMcpConfig` writes to `<project>/.apparat/runs/<runId>/.mcp-<name>-<ts>.json` instead of `cwd`. The `--mcp-config` flag at `src/cli/lib/agent.ts:155` already passes an absolute path, so the relocation is path-only — no flag plumbing.
3. **Heartbeat + `gcStaleRuns()`** (`src/cli/lib/pipeline-bootstrap.ts`, `src/cli/commands/pipeline/run.ts:221-222`). The pipeline runner touches `<project>/.apparat/runs/<runId>/heartbeat` synchronously before signal handlers register, then on a 60s interval until the `finally` block clears the interval. `pipeline-bootstrap.ts` gains `gcStaleRuns(projectFolder)` invoked once per `agent.run()` spawn. Three-state semantics: heartbeat fresh (< 5 min) = alive → skip; heartbeat stale (≥ 5 min) = crashed → `rm -rf runs/<runId>/`; heartbeat absent = completed → skip (preserve for debug, per ADR-0015).

Plus janitorial:

4. **Delete on-disk debris in the landing commit.** `rm -rf .apparat/.apparat/`; salvage the buried illumination at `.apparat/.apparat/meditations/illuminations/2026-05-12T1028-collapse-memory-tail-and-tier-pipeline-models.md` into `.apparat/meditations/illuminations/` under the same slug if it is still useful. `rm .mcp-meditate-1777197355164.json .mcp-verifier-1778665005965.json` at the repo root.
5. **Two new scenarios** (`.apparat/scenarios/meditate-rejects-internal-folder.md`, `.apparat/scenarios/meditate-sweeps-stale-mcp-configs.md`). The first asserts a non-zero exit + parent-folder suggestion; the second seeds a stale fixture run and asserts it is swept on the next spawn.
6. **ADR-0016 + SKILL.md preflight section.** ADR-0016 (`docs/adr/0016-run-scoped-mcp-config-with-heartbeat.md`) records the lifecycle decision; SKILL.md (`src/cli/skills/apparatus/SKILL.md`) gains a "Preflight discipline" section so future commands inherit the rule.

**Locked OUT of scope** (refinement bullets):

- Long-term growth of *completed* run folders. Handled by sibling illumination `.apparat/meditations/illuminations/2026-05-13T0805-scratch-sediment-needs-an-apparat-sweep-command.md`. Round-2 cross-reference, explicit.
- Changes to `cleanupMcpConfig`'s `finally` semantics (`src/cli/lib/agent.ts:349-351`). The finally still removes the live config on the happy path; heartbeat-driven GC is a *belt-and-suspenders* layer, not a replacement.
- Per-MCP-file mtime sweeping. Round-2 bullet "adopt heartbeat-on-the-folder as the GC discipline, NOT blanket mtime threshold" supersedes round-1's mtime-glob suggestion. One seam (folder heartbeat), not N seams (per-file mtimes).
- Daemon-side wiring of `runId` into spawned children. `--mcp-config` already takes an absolute path; the daemon's `runTask` flow inherits the relocation automatically when its caller threads `runId` through `RunOptions`. Daemon-side adoption is a one-line edit in a future cycle if needed; it is not blocking here.
- Other commands' preflight (`init`, `janitor`, future `pipeline create`). They inherit the rule via SKILL.md — wiring them is out of scope this cycle.
- Mission-control / `pipeline list` surfaces. Untouched.

## 3. Architecture

### 3.1 Two-layer defence

```
Layer A   Preflight       → refuse non-project paths before any side effect
Layer B   Run-folder      → all run-scoped scratch (MCP config, future files) lives at runs/<runId>/
          ├── Heartbeat   → liveness signal at runs/<runId>/heartbeat
          └── gcStaleRuns → on every agent.run() spawn, sweep stale folders
```

Layer A stops the *path-aimed* footgun (silent ghost notes). Layer B stops the *crash-leaked* debris (silent accumulation). They compose: a typo caught by Layer A never reaches Layer B; a crash that bypasses Layer A's check still gets swept by Layer B's heartbeat.

### 3.2 Project-shape preflight (Layer A)

Edited site: `src/cli/commands/meditate.ts:20-24`. New helper colocated in `src/cli/lib/pipeline-bootstrap.ts` (one export, ~15 LOC):

```ts
// src/cli/lib/pipeline-bootstrap.ts (new export)
const SHAPE_SIGNALS = ["VISION.md", "CONTEXT.md", ".apparat", ".git"];

export function assertApparatShape(absPath: string): void {
  if (basename(absPath) === ".apparat") {
    throw new ApparatShapeError(
      `${absPath} is an apparat-internal folder — did you mean ${dirname(absPath)}?`,
    );
  }
  const hasSignal = SHAPE_SIGNALS.some((s) => existsSync(join(absPath, s)));
  if (!hasSignal) {
    throw new ApparatShapeError(
      `${absPath} does not look like an apparat-shaped project root ` +
      `(no VISION.md / CONTEXT.md / .apparat/ / .git/). ` +
      `Did you mean its parent?`,
    );
  }
}

export class ApparatShapeError extends Error {}
```

Edited site:

```ts
// src/cli/commands/meditate.ts (after)
const absPath = resolve(projectFolder);
if (!existsSync(absPath)) { /* unchanged */ }
try {
  assertApparatShape(absPath);
} catch (err) {
  if (err instanceof ApparatShapeError) {
    await output.error(err.message);
    process.exit(1);
  }
  throw err;
}
```

Rationale: the helper is also the seam for SKILL.md's "preflight discipline" rule — `init`, `janitor`, future commands import the same helper rather than re-deriving the shape predicate. The `basename === ".apparat"` clause is a hard-refuse because the directory-exists-and-has-`.apparat/`-child rule would otherwise pass for nested `.apparat/` (the `.apparat/` *inside* `.apparat/` exists in the ghost-run scenario, so the existence test alone is insufficient).

### 3.3 Run-folder scoping of MCP configs (Layer B, part 1)

`RunOptions` gains an additive optional `runId`:

```ts
// src/cli/lib/agent.ts:79-91 (after)
export interface RunOptions {
  cwd: string;
  signal?: AbortSignal;
  variables?: Record<string, unknown>;
  resume?: string;
  interactive?: boolean;
  onSessionId?: (id: string) => void;
  onStdout?: (stdout: NodeJS.ReadableStream) => Promise<void>;
  message?: string;
  runId?: string;        // NEW — when provided, MCP config lands in runs/<runId>/
}
```

`writeMcpConfig` (currently a single method on `Agent` at `src/cli/lib/agent.ts:179-203`) gains a parallel signature shift. Today it takes `(cwd, variables)`; the run flow at `:220` calls it as `this.writeMcpConfig(options.cwd, options.variables)`. After:

```ts
// src/cli/lib/agent.ts (after)
writeMcpConfig(opts: { cwd: string; runId?: string; variables?: Record<string, unknown> }): string | null {
  if (this.config.mcp.length === 0) return null;
  // ... expand servers (unchanged) ...
  const targetDir = opts.runId
    ? path.join(opts.cwd, ".apparat", "runs", opts.runId)
    : opts.cwd;                            // back-compat for non-pipeline callers
  fs.mkdirSync(targetDir, { recursive: true });
  const configPath = path.join(targetDir, `.mcp-${this.config.name}-${Date.now()}.json`);
  fs.writeFileSync(configPath, JSON.stringify({ mcpServers }, null, 2));
  this._mcpConfigPath = configPath;
  return configPath;
}
```

Both `run()` (`:216-352`) and `runInteractive()` (`:371-?`) update their callers to pass `runId`. `run()` already absorbs `RunOptions` whole, so the change at the call site at `:220` becomes `this.writeMcpConfig({ cwd: options.cwd, runId: options.runId, variables: options.variables })`. `runInteractive` similarly.

`--mcp-config` is already passed as `this._mcpConfigPath` (`src/cli/lib/agent.ts:155`) — an absolute path — so the relocation is invisible to `claude`.

The `cleanupMcpConfig` finally hook at `:349-351` is **unchanged**. The live-path delete still runs on every happy-path exit; the new directory is created with `recursive: true` so the unlink against `runs/<runId>/.mcp-*` succeeds the same way it did against `cwd/.mcp-*`.

### 3.4 Heartbeat (Layer B, part 2)

Owner: `src/cli/commands/pipeline/run.ts`. Today the runner *computes* `logsRoot` at `:138-141` but does not create the directory — the actual `await mkdir(opts.logsRoot, { recursive: true })` lives one layer down in the engine at `src/attractor/core/engine.ts:168`. For the heartbeat to be writeable synchronously before `runPipeline(...)` is awaited, the runner must take ownership of the mkdir:

```ts
// src/cli/commands/pipeline/run.ts (insert after logsRoot is finalised at ~:141, before line :143)
mkdirSync(logsRoot, { recursive: true });                  // runner now owns the mkdir
writeFileSync(join(logsRoot, "heartbeat"), "");            // synchronous initial touch
const heartbeatTimer = setInterval(() => {
  try {
    utimesSync(join(logsRoot, "heartbeat"), new Date(), new Date());
  } catch {
    // ENOENT tolerated — folder may have been swept by a sibling in pathological races
  }
}, HEARTBEAT_INTERVAL_MS);
heartbeatTimer.unref();                                    // don't keep the event loop alive
```

The engine's `await mkdir(opts.logsRoot, { recursive: true })` at `engine.ts:168` is idempotent (`recursive: true`) and stays in place — it still covers callers that hit the engine without going through `pipeline/run.ts` (e.g. unit tests that bypass the runner). The runner's `mkdirSync` is the synchronous gate that lets the initial heartbeat land *before* any `await` and *before* any sibling sweep can possibly fire.

The interval is cleared in the existing `finally` block at `src/cli/commands/pipeline/run.ts:392-426`:

```ts
} finally {
  clearInterval(heartbeatTimer);
  process.off("SIGINT", onSignal);
  process.off("SIGTERM", onSignal);
  // ... existing finally body unchanged ...
}
```

The signal handlers at `:221-222` already cascade to `ac.abort()` (line 218), which kicks the agent's abort cascade at `src/cli/lib/agent.ts:251-261`. The interval is cleared *after* signal cleanup so a slow shutdown still has a fresh heartbeat to delay sibling sweeps.

Constants (colocated with `gcStaleRuns` in `pipeline-bootstrap.ts`):

```ts
export const HEARTBEAT_INTERVAL_MS = 60_000;       // 60s touch cadence
export const HEARTBEAT_STALE_MS = 5 * 60_000;      // 5min threshold — 5-cycle margin
```

5-cycle margin: the event loop is async-heavy in agent work (`claude` stdio, JSONL parsing). A single missed cycle is normal; five consecutive missed cycles is a crash. Round-2 thought-experiment confirmed this margin tolerates the worst-observed block without producing false-stale sweeps.

### 3.5 `gcStaleRuns()` (Layer B, part 3)

New export in `src/cli/lib/pipeline-bootstrap.ts` (~25 LOC):

```ts
export function gcStaleRuns(projectFolder: string): void {
  const runsRoot = join(projectFolder, ".apparat", "runs");
  if (!existsSync(runsRoot)) return;
  const now = Date.now();
  for (const name of readdirSync(runsRoot)) {
    const runDir = join(runsRoot, name);
    let stat;
    try { stat = statSync(runDir); } catch { continue; }
    if (!stat.isDirectory()) continue;
    const heartbeatPath = join(runDir, "heartbeat");
    let hbStat;
    try { hbStat = statSync(heartbeatPath); } catch {
      continue;   // heartbeat absent → completed run (or pre-rule dir) → preserve
    }
    if (now - hbStat.mtimeMs >= HEARTBEAT_STALE_MS) {
      try { rmSync(runDir, { recursive: true, force: true }); } catch { /* ENOENT tolerated */ }
    }
  }
}
```

Three-state semantics enforced by the `statSync(heartbeatPath)` arm:

| Heartbeat                | Interpretation       | Action     |
|--------------------------|----------------------|------------|
| Fresh (mtime < 5 min)    | Pipeline alive       | Skip       |
| Stale (mtime ≥ 5 min)    | Pipeline crashed     | `rm -rf`   |
| Absent (ENOENT)          | Completed (or pre-rule dir) | Skip — preserve for debug |

The absent → preserve rule is **what makes this design ADR-0015-symmetric.** Successful runs that ADR-0015's tail GC already swept have no heartbeat. Pre-rule run folders (created before this lands) also have no heartbeat. Both populations are safely ignored.

Call site: `Agent.run()` invokes `gcStaleRuns(options.cwd)` once per spawn — before `writeMcpConfig`, after the optional `runId` is observed:

```ts
// src/cli/lib/agent.ts:216 (after)
async run(options: RunOptions): Promise<RunResult> {
  const expandedPrompt = this.expandPrompt(options.variables);

  gcStaleRuns(options.cwd);                          // NEW — sweep before writing
  this.writeMcpConfig({ cwd: options.cwd, runId: options.runId, variables: options.variables });
  // ... unchanged from :222 ...
}
```

Round-2 lock: "Sweep on every `agent.run()` spawn, not just meditate startup." Putting the call inside `Agent.run` (rather than in `meditateCommand`) means *every* pipeline node — meditate, janitor, illumination-to-implementation, future pipelines — pays the same cheap sweep cost. The seam matches ADR-0015's "GC lives at the runner level" rule.

### 3.6 Logging

Per round-2 layered-defence bullet 5 (visible sweep log): `gcStaleRuns` returns the count of folders removed; the caller in `Agent.run` emits an `output.info` line when count > 0. Silent breakage stays visible.

```ts
const removed = gcStaleRuns(options.cwd);
if (removed > 0) {
  await output.info(`[apparat] swept ${removed} stale run folder(s) (no heartbeat for ≥ 5min)`);
}
```

(The exact `output` API surface inside the agent module is editorial — `process.stderr.write` is acceptable if `output.info` is awkward to thread.)

### 3.7 Files-touched buckets

| Bucket          | File                                                                                      | Treatment |
|---|---|---|
| CLI command     | `src/cli/commands/meditate.ts`                                                            | Edit — add `assertApparatShape` call at `:20-24` |
| Lib — bootstrap | `src/cli/lib/pipeline-bootstrap.ts`                                                       | Edit — add `assertApparatShape`, `ApparatShapeError`, `gcStaleRuns`, `HEARTBEAT_*` constants |
| Lib — agent     | `src/cli/lib/agent.ts`                                                                    | Edit — `RunOptions.runId?`, `writeMcpConfig` signature shift, `gcStaleRuns(cwd)` call in `run()` and `runInteractive` |
| Pipeline runtime| `src/cli/commands/pipeline/run.ts`                                                        | Edit — `mkdirSync(logsRoot)` ownership, synchronous initial heartbeat, `setInterval` + `clearInterval` |
| Engine — handler surface | `src/attractor/handlers/registry.ts`                                             | Edit — add optional `runId?: string` to `HandlerExecutionContext` |
| Engine — invocation     | `src/attractor/core/engine.ts`                                                    | Edit — populate `meta.runId` from in-scope `runId` at each handler invocation site |
| Engine plumbing | `src/attractor/handlers/looping-agent-handler.ts`                                         | Edit — pass `meta.runId` into `agent.run({ cwd, signal, variables, onStdout, runId })` at `:78` and `:117` |
| Tests — existing| `src/cli/tests/meditate.test.ts`                                                          | Edit — fixture upgrade: 8 cases seed `.apparat/` or `VISION.md` in tmpdir |
| Tests — existing| `src/cli/tests/pipeline-bootstrap.test.ts`                                                | Extend — `gcStaleRuns` 3-state coverage + `assertApparatShape` matrix |
| Tests — existing| `src/cli/tests/agent-run.test.ts`                                                         | Edit — signature pass-through; assert `runId` lands at `runs/<runId>/.mcp-*` |
| Scenarios       | `.apparat/scenarios/meditate-rejects-internal-folder.md`                                  | New |
| Scenarios       | `.apparat/scenarios/meditate-sweeps-stale-mcp-configs.md`                                 | New |
| Docs — ADR      | `docs/adr/0016-run-scoped-mcp-config-with-heartbeat.md`                                   | New — extends ADR-0015 |
| Docs — SKILL    | `src/cli/skills/apparatus/SKILL.md`                                                       | Edit — new "Preflight discipline" section after "Project shape" |
| Docs — README   | `README.md`                                                                               | Edit — one-liner near the meditate/run section explaining preflight refusal |
| Docs — CONTEXT  | `CONTEXT.md`                                                                              | Optional — add "apparat-shaped" domain term if not already present |
| Cleanup         | `.apparat/.apparat/` (recursive)                                                          | Delete (one-shot rm in landing commit) |
| Cleanup         | `.mcp-meditate-1777197355164.json`, `.mcp-verifier-1778665005965.json`                    | Delete (one-shot rm in landing commit) |

Total source files: ~7 (1 command + 2 libs + 1 runtime + 1 handler surface + 1 engine + 1 handler call site). Tests: 3 edited. Docs: 1 new ADR + 1 edited SKILL + 1 edited README. Scenarios: 2 new. **~16 files**, slightly above the verifier's ~14 estimate after the spec-review-loop pulled in two engine-side edits.

## 4. Components & key edits

### 4.1 `src/cli/lib/pipeline-bootstrap.ts` (edited)

Currently 49 LOC exporting `pidPath`, `writePid`, `readPid`, `removePid`, `isPidAlive`, `ensureMeditationDirs`, `appendMeditateGitignore`. After edit, adds three exports (`assertApparatShape`, `ApparatShapeError`, `gcStaleRuns`) plus two constants (`HEARTBEAT_INTERVAL_MS`, `HEARTBEAT_STALE_MS`). Cohesion is preserved — the file is the natural home for any "what should be true before/around a pipeline run" predicate.

The exports stay pure I/O + sync filesystem. No async, no Node-only ESM-specific globals. Mirrors the existing style of the file.

### 4.2 `src/cli/commands/meditate.ts` (edited)

Four-line addition after the `existsSync` guard. The `try/catch` narrowness keeps the failure surface separate from generic crashes — only `ApparatShapeError` exits with code 1; other errors bubble.

### 4.3 `src/cli/lib/agent.ts` (edited)

Two surfaces:

- **`RunOptions.runId?`** at `:79-91`. Optional, no default. ~15 internal call sites pass `cwd, signal, variables, onStdout, [resume, message, onSessionId]` today; all keep working byte-identically when they omit `runId`. The audited consumer list per the verifier blast paragraph: `src/attractor/handlers/looping-agent-handler.ts:78,117` (the load-bearing pipeline path), `src/cli/tests/agent-run.test.ts` ×9, `src/cli/tests/agent.test.ts` ×3, `src/attractor/tests/agent-handler.test.ts` ×1, plus the interactive harness. All internal.
- **`writeMcpConfig` signature shift** from `(cwd, variables)` to `({ cwd, runId?, variables })`. The single call site inside `run()` (`:220`) and the single call site inside `runInteractive()` are both in this file — no external callers.

`gcStaleRuns(options.cwd)` is called once per `run()` invocation before `writeMcpConfig`. The sweep is O(N) over `.apparat/runs/`'s direntries; with ADR-0015 + the upcoming sweep command bounding N, this is bounded by tens of entries even for a long-lived project.

### 4.4 `src/cli/commands/pipeline/run.ts` (edited)

Four insertion points:

1. After `logsRoot` is finalised at `:138-141`, before `tracePath` at `:142`: `mkdirSync(logsRoot, { recursive: true })`. Today the runner does not own the mkdir — the engine at `engine.ts:168` does, asynchronously. Taking ownership in the runner is the prerequisite for the synchronous initial heartbeat write (§3.4). The engine's existing `mkdir` stays in place; `recursive: true` makes it idempotent.
2. Immediately after: `writeFileSync(join(logsRoot, "heartbeat"), "")`. Synchronous initial touch, before any `await`.
3. Immediately after: `const heartbeatTimer = setInterval(...)` from §3.4. `heartbeatTimer.unref()` so the timer never blocks process exit.
4. In the `finally` at `:392-426`: `clearInterval(heartbeatTimer)` as the first statement, before signal-handler cleanup.

`runId` is already in scope at `:129` (`const runId = opts.runId ?? newRunId(loaded.graph.name)`). Engine-side plumbing (`HandlerExecutionContext.runId`) is detailed in §4.5 — one field addition + one engine assignment per handler invocation site.

### 4.5 `src/attractor/handlers/looping-agent-handler.ts` (edited)

Two call sites at `:78` and `:117` add `runId` to the `agent.run({...})` options:

```ts
let result = await agent.run({ cwd, signal, variables: iterVariables, onStdout, runId: meta.runId });
// ...
const retryResult = await agent.run({
  cwd, signal, variables: iterVariables, onStdout,
  resume: lastSessionId, message: corrective, runId: meta.runId,
});
```

`meta.runId` is **not currently** on `HandlerExecutionContext` — verified against `src/attractor/handlers/registry.ts:13-37` (today the surface carries `logsRoot, cwd, dotDir, signal, outgoingLabels, completedNodes, nodeRetries, onStdout, onInteractiveRequest, onIterationStart, onIterationEnd, onValidationFailure, onValidationRetryStart, projectDir`). The engine *has* `runId` in scope at `src/attractor/core/engine.ts:150-151` (it writes the value into `context["run_id"]`), but never threads it into the handler `meta` object. The plumbing required:

1. **Add `runId?: string` to `HandlerExecutionContext`** (`src/attractor/handlers/registry.ts:13-37`). Additive, optional — no existing consumer breaks.
2. **Populate it in the engine** where each handler is invoked. The handler call site reads from `runId` (a local variable in scope by `engine.ts:150`); the planner sets `runId` on the `meta` object at the same call site that already passes `logsRoot, cwd, dotDir`, etc. One field addition per handler-invocation site in `engine.ts`.

This is a small, contained engine edit — earlier §4.4 prose suggesting "no new plumbing in `engine.ts`" was inaccurate. The plumbing is one `HandlerExecutionContext` field and one assignment per invocation site; the planner should account for it.

Alternative considered and rejected: read `runId` from `ctx.values["run_id"]` (which the engine already writes at `:151`). Cheaper, no surface change — but couples the handler to the magic key `"run_id"`, and the existing handler surface convention is "everything the handler needs as typed fields on `meta`." The typed field is the cleaner seam.

### 4.6 Scenarios

**`.apparat/scenarios/meditate-rejects-internal-folder.md`:**

```
# Scenario: meditate refuses to write into an apparat-internal folder

## Setup
- Run `apparat init proj-smoke` (creates apparat-shaped project)

## Action
`apparat meditate proj-smoke/.apparat`

## Expect
- exit code is 1
- stderr contains "apparat-internal folder"
- stderr suggests `proj-smoke` (the parent) as the intended target
- no file under `proj-smoke/.apparat/.apparat/` exists
- no file under `proj-smoke/.apparat/meditations/illuminations/` was created
```

**`.apparat/scenarios/meditate-sweeps-stale-mcp-configs.md`:**

```
# Scenario: meditate sweeps stale run folders on the next spawn

## Setup
- Run `apparat init proj-smoke`
- Create fixture stale run: `mkdir -p proj-smoke/.apparat/runs/fixture-stale`
- Touch its heartbeat with mtime in the past:
  `touch -t 202401010000 proj-smoke/.apparat/runs/fixture-stale/heartbeat`
- Write fixture MCP config:
  `echo "{}" > proj-smoke/.apparat/runs/fixture-stale/.mcp-meditate-0.json`

## Action
Spawn any pipeline that invokes `agent.run` against `proj-smoke` (e.g. `apparat pipeline run meditate proj-smoke`)

## Expect
- exit code is 0 (sweep is non-fatal)
- `proj-smoke/.apparat/runs/fixture-stale/` no longer exists
- stderr contains "swept 1 stale run folder"
- a new `proj-smoke/.apparat/runs/<slug>-<uuid8>/heartbeat` exists (fresh run)
```

### 4.7 ADR-0016 (new)

`docs/adr/0016-run-scoped-mcp-config-with-heartbeat.md` — extends ADR-0015. Outline:

- **Context.** MCP configs leak to project root on SIGKILL/OOM. Existing `cleanupMcpConfig` covers only the happy path. Parallel pipelines (meditate + janitor overnight) make this an active failure mode, not a hypothetical.
- **Decision.** All run-scoped scratch lives at `<project>/.apparat/runs/<runId>/`. Liveness signal: a `heartbeat` file touched every 60s by the pipeline runner. GC sweeps stale-heartbeat folders (≥ 5 min) on every `agent.run()` spawn. Absent heartbeat = completed run (per ADR-0015 success-tail GC) or pre-rule dir; preserved.
- **Precedent.** ADR-0015 established run-folder-scoped cleanup at the runner level; this ADR extends the same path-key + same GC seam to MCP debris.
- **Considered alternatives.**
  - Per-file `.mcp-*` mtime threshold. Rejected (round 2): two seams (per-file + per-folder) instead of one.
  - Long timeout for finally-only cleanup. Rejected (round 2): does not handle SIGKILL/OOM; round-2 directive to "solve concurrency properly now".
  - Heartbeat per-file. Rejected: one liveness signal per run is the simpler unit.
- **Consequences.** Future scratch types (transcripts, partial outputs) cost nothing new — they live inside `runs/<runId>/`. The 5-min stale threshold tolerates pathological event-loop blocks (5-cycle margin vs 60s cadence).

### 4.8 SKILL.md preflight section (edited)

Insert after the existing "Project shape" section in `src/cli/skills/apparatus/SKILL.md` (currently at lines ~27-44):

```md
## Preflight discipline

Every command that writes durable side-effects to a `<project>` path must
**orient before writing**:

1. Refuse paths that are not apparat-shaped. Hard-refuse `basename === ".apparat"`
   (a typo or autocomplete slip pointed you at the project's internal folder).
2. Require at least one shape signal at the path: `VISION.md`, `CONTEXT.md`,
   `.apparat/`, or `.git/`. Otherwise refuse with "did you mean its parent?".
3. Sweep stale run folders (`runs/<runId>/` with heartbeat ≥ 5 min old) before
   writing new scratch. See ADR-0016.

The helper is `assertApparatShape(absPath)` from `src/cli/lib/pipeline-bootstrap.ts`.
Import it; do not re-derive the predicate.
```

### 4.9 Tests

**`src/cli/tests/pipeline-bootstrap.test.ts` extension** (the file already has 14 tests):

- `assertApparatShape` passes when `.apparat/` exists at path.
- `assertApparatShape` passes when `VISION.md` exists.
- `assertApparatShape` passes when `CONTEXT.md` exists.
- `assertApparatShape` passes when `.git/` exists.
- `assertApparatShape` throws `ApparatShapeError` with parent-hint when path basename is `.apparat`.
- `assertApparatShape` throws `ApparatShapeError` with parent-hint when no signal present.
- `gcStaleRuns` removes folder whose heartbeat is older than 5 min.
- `gcStaleRuns` preserves folder whose heartbeat is fresh.
- `gcStaleRuns` preserves folder with no heartbeat (completed run / pre-rule).
- `gcStaleRuns` is a no-op when `<project>/.apparat/runs/` does not exist.
- `gcStaleRuns` returns count of removed folders.
- `gcStaleRuns` tolerates ENOENT during the unlink (concurrent sweep simulation).
- `gcStaleRuns` ignores non-directory entries.

**`src/cli/tests/meditate.test.ts` fixture upgrade**: each `beforeEach` after `mkdtempSync` (`:24`) writes a shape signal — the simplest is `mkdirSync(join(tmpDir, ".apparat"), { recursive: true })`. The existing 8 cases run unchanged after that one-line seed. New cases:

- `meditate` exits 1 when called against an apparat-shape-less tmpdir (no signals seeded).
- `meditate` exits 1 when called against `<tmpDir>/.apparat` (basename refuse).
- Both new cases assert no illuminations or pid files are created.

**`src/cli/tests/agent-run.test.ts` signature pass-through**: add one case that calls `agent.run({ cwd, runId: "test-run-id", variables: {} })` against a fixture with `mcp:` configured, then asserts the MCP config landed at `runs/test-run-id/.mcp-*.json` rather than the cwd root.

## 5. Data flow

### 5.1 Layer A: preflight (happy path)

```
apparat meditate /path/to/proj
  → meditateCommand("/path/to/proj")
    → absPath = "/path/to/proj"
    → existsSync(absPath) === true
    → assertApparatShape(absPath)
        → basename === "proj" (not ".apparat") ✓
        → VISION.md exists ✓
        → returns
    → ensureMeditationDirs(absPath)
    → writePid(absPath, process.pid)
    → pipelineRunCommand("meditate", { project: absPath })
```

### 5.2 Layer A: preflight refusal (typo case)

```
apparat meditate /path/to/proj/.apparat
  → meditateCommand("/path/to/proj/.apparat")
    → existsSync(absPath) === true (the ghost dir exists)
    → assertApparatShape(absPath)
        → basename === ".apparat" — HARD REFUSE
        → throw ApparatShapeError("…did you mean /path/to/proj?")
    → output.error(message) + process.exit(1)
    → no .apparat/.apparat/ ever created
```

### 5.3 Layer B: heartbeat lifecycle (happy path)

```
apparat pipeline run meditate /path/to/proj
  → runId = "meditate-2f8a91c3" (newRunId from §3.5 of design 2026-05-10)
  → mkdirSync(.apparat/runs/meditate-2f8a91c3, { recursive: true })
  → writeFileSync(.apparat/runs/meditate-2f8a91c3/heartbeat, "")    ← initial sync touch
  → setInterval(utimesSync(heartbeat), 60_000).unref()
  → process.on(SIGINT/SIGTERM, onSignal)
  → engine runs nodes
    → looping-agent-handler at agent.run({ cwd, runId: "meditate-2f8a91c3", ... })
      → gcStaleRuns(cwd) — no stale folders, no-op
      → writeMcpConfig({ cwd, runId, variables })
        → writes .apparat/runs/meditate-2f8a91c3/.mcp-meditate-<ts>.json
      → spawn claude --mcp-config <abs path>
      → finally: cleanupMcpConfig() removes the file
  → finally: clearInterval(heartbeatTimer)
  → finally: gcRunScopedArtefactsOnSuccess (ADR-0015) removes the entire runs/<runId>/
    including the leftover heartbeat file
```

### 5.4 Layer B: crash recovery (next spawn)

```
[previous spawn SIGKILLed mid-run — runs/abc-<id>/ folder + .mcp-* survive,
 last heartbeat touch was 7 minutes ago]

apparat pipeline run meditate /path/to/proj
  → runId = "meditate-<new>"
  → mkdirSync(runs/meditate-<new>/) + heartbeat
  → engine starts; first node invokes agent.run({ cwd, runId, ... })
    → gcStaleRuns(cwd)
      → scan runs/
        → runs/abc-<old>/heartbeat: mtime 7min old → stale → rm -rf runs/abc-<old>/
        → runs/meditate-<new>/heartbeat: mtime 1s old → fresh → skip
      → returns 1
    → output.info("[apparat] swept 1 stale run folder (no heartbeat for ≥ 5min)")
    → continue with writeMcpConfig + spawn
```

### 5.5 Layer B: parallel pipelines (concurrent sweep)

Two pipelines run overnight (meditate + janitor). Each touches its own heartbeat. Neither sees the other as stale because both heartbeats are < 5 min old. If a third pipeline starts and finds a crashed `runs/old-<id>/`, both meditate and janitor may race to `rmSync` the same folder; the `try/catch` around `rmSync` (§3.5) tolerates the ENOENT from whichever loses the race. This mirrors the existing `cleanupMcpConfig` pattern at `src/cli/lib/agent.ts:208-210`.

## 6. Blast radius / impact surface

- **Size: M trending L** (verifier final pass; explainer Tier-2 §Blast radius confirms; spec review pulled the source count from 5 → 7 with engine plumbing). ~16 files: 7 source + 3 tests + 2 scenarios + 3 docs + 1 ADR.
- **Surfaces crossed:** CLI command (`meditate.ts`), lib (`pipeline-bootstrap.ts`, `agent.ts`), pipeline runtime (`pipeline/run.ts`), engine handler surface (`handlers/registry.ts`), engine invocation (`core/engine.ts`), engine handler call site (`looping-agent-handler.ts`), tests (3), scenarios (2), docs (`SKILL.md`, `README.md`, optionally `CONTEXT.md`), ADR (1 new). No Ink TUI change. No `.dot` schema change. No tracer schema change. No agent rubric change. No CLI commander / program.ts change.
- **Breaking changes:** **none for external consumers.**
  - `RunOptions.runId?` is additive — optional. ~15 internal call sites work unchanged when they omit it. Audited in the verifier blast paragraph: `looping-agent-handler.ts:78,117`, `agent-run.test.ts` ×9, `agent.test.ts` ×3, `agent-handler.test.ts` ×1, plus the interactive harness. All internal.
  - `HandlerExecutionContext.runId?` is additive — optional. All non-agent handlers ignore it. No external test break.
  - `writeMcpConfig` signature shift `(cwd, variables) → ({ cwd, runId?, variables })`. Single-method-on-`Agent`, two internal call sites in `agent.ts` itself. No external test break.
- **Spec / docs ripple checklist:**
  - [ ] `docs/adr/0016-run-scoped-mcp-config-with-heartbeat.md` — new, extends ADR-0015.
  - [ ] `src/cli/skills/apparatus/SKILL.md` — new "Preflight discipline" section after "Project shape" (currently at ~lines 27-44).
  - [ ] `README.md` — one-liner near the meditate/run section explaining preflight refusal.
  - [ ] `CONTEXT.md` — *optional* — add "apparat-shaped project" as a domain term if not already present (defer to implementer's read of CONTEXT.md current state).
- **Test ripple checklist:**
  - [ ] **Edit** `src/cli/tests/meditate.test.ts:24` (and all 8 fixture-using cases) — seed `.apparat/` in the tmpdir so existing cases still pass; add 2 new cases for refusal paths.
  - [ ] **Extend** `src/cli/tests/pipeline-bootstrap.test.ts` — add 6 `assertApparatShape` cases + 7 `gcStaleRuns` cases (see §4.9).
  - [ ] **Edit** `src/cli/tests/agent-run.test.ts` — signature pass-through; add 1 case asserting `runs/<runId>/.mcp-*` location.
- **Operator ripple** (one-shot, landing commit only):
  - [ ] `rm -rf .apparat/.apparat/` (salvage buried illumination first if still useful).
  - [ ] `rm .mcp-meditate-1777197355164.json .mcp-verifier-1778665005965.json` at repo root.

## 7. Trade-offs

### 7.1 Folder-shape signals vs project registry

**Folder-shape signals chosen.** Alternatives considered:

- *Per-project registry* (`~/.apparat/projects.json`): heavy mechanism, requires `apparat init` to mutate global state, and the typo case (`.apparat/.apparat`) still passes the "is this a known project?" check if the parent is registered.
- *Folder-shape signals* (the current proposal): zero global state, predicate is one stat call per signal, the basename `.apparat` hard-refuse closes the exact failure mode that already happened on disk.

Cost: signals are conventions, not rules; a deeply-custom project without VISION.md/CONTEXT.md/.git/.apparat could be refused. Mitigation: the error message names all four signals — adding `.apparat/` to make a project apparat-shaped is itself the canonical setup step.

### 7.2 Heartbeat at folder level vs per-file mtime

**Folder-level heartbeat chosen** (round 2 supersedes round 1). One liveness signal per run, not per scratch file. Adding new scratch file types (transcripts, partial outputs, future) costs nothing — they live inside `runs/<runId>/` and inherit the GC for free. Matches the deep-modules-hide-complexity lens explicitly cited in the chat refinement.

Cost: a single hung-but-still-alive pipeline that blocks the event loop for > 5 min could be falsely swept. Mitigation: 5-cycle margin (60s touch vs 5min threshold) covers all observed real-world async-heavy agent stalls; if it ever bites in practice, the threshold is one constant edit.

### 7.3 Sweep on every `agent.run()` vs sweep on `meditate` startup only

**Every spawn chosen** (round-2 layered-defence bullet 3). Putting the sweep inside `Agent.run` rather than `meditateCommand` means *every* pipeline node — meditate, janitor, illumination-to-implementation, future pipelines — cooperates with the cleanup. ADR-0015 already established "GC lives at the runner level"; this is the same seam.

Cost: O(N) sweep per node. With ADR-0015 bounding N, N is in the tens — sub-100ms.

### 7.4 Synchronous initial heartbeat vs async

**Synchronous chosen.** The race where a sibling sweep starts between `mkdirSync(runs/<runId>/)` and the first heartbeat touch would silently delete a brand-new run folder. Writing the heartbeat synchronously (one `writeFileSync` call) closes the gap before any `await` happens. Round-2 thought-experiment surfaced this race; the fix is one line of code.

### 7.5 ENOENT-tolerant sweeps vs locking

**ENOENT-tolerant chosen.** Locking adds a second seam (a `.lock` file plus crash-recovery for the lock itself). Tolerating ENOENT on `rmSync` mirrors the existing `cleanupMcpConfig` pattern (`src/cli/lib/agent.ts:208-210`) — one less mechanism, identical correctness for concurrent sweeps.

Cost: the second sweeper does the work of looking and finding nothing. Cheap.

### 7.6 Single PR vs split

**Single PR is the default.** The natural split would be (1) preflight, (2) heartbeat + gcStaleRuns, (3) MCP-config relocation. The relocation requires `runId` on `RunOptions` which the handler doesn't pass without the heartbeat plumbing — splitting introduces dead optional code mid-train. Single PR is simpler.

## 8. Constraints

After the change:

- `npx tsc --noEmit` passes.
- `npx vitest run` passes — including the extended `pipeline-bootstrap.test.ts`, the upgraded `meditate.test.ts`, and the extended `agent-run.test.ts`.
- `apparat meditate <unsuitable-path>` exits 1 with a parent-folder suggestion.
- `apparat meditate /path/to/proj/.apparat` exits 1 with "apparat-internal folder" + parent-folder suggestion.
- `apparat meditate <apparat-shaped-path>` runs unchanged.
- A pipeline run creates `<project>/.apparat/runs/<runId>/heartbeat` synchronously before any `await`.
- During a run, `<project>/.apparat/runs/<runId>/heartbeat` mtime advances at ≤ 60s intervals.
- `.mcp-<name>-<ts>.json` writes go to `<project>/.apparat/runs/<runId>/`, not `<project>/`.
- A `runs/<id>/` folder whose heartbeat mtime is ≥ 5 min old at the next `agent.run()` spawn is removed.
- A `runs/<id>/` folder with no heartbeat (completed run per ADR-0015, or pre-rule dir) is preserved.
- The two scenarios pass in CI.

Repo-wide grep invariants (post-merge):

- `grep -nR "\.mcp-" src` — only inside `src/cli/lib/agent.ts` and the test files that reference the glob; no other call site reproduces the path-join rule.
- `grep -nR "writeMcpConfig" src` — exactly two call sites (`Agent.run`, `Agent.runInteractive`), both in `agent.ts`.
- `grep -nR "assertApparatShape\|gcStaleRuns" src` — at least two importers each (`meditate.ts` + tests; `agent.ts` + tests).
- `grep -nR "HEARTBEAT_INTERVAL_MS\|HEARTBEAT_STALE_MS" src` — only inside `pipeline-bootstrap.ts` (source) and `pipeline/run.ts` (importer).

Behaviour invariants:

- No new tracer fields. `pipeline-start` / `pipeline-end` JSONL events byte-identical to today.
- No new CLI flag. No new env var. No new top-level command.
- Ink TUI untouched.
- ADR-0015's `gcRunScopedArtefactsOnSuccess` still removes the *entire* `runs/<runId>/` on green, including the heartbeat file (so completed-state semantics are preserved — heartbeat absent → preserve, but ADR-0015 has already removed the whole folder so there is nothing to preserve).

## 9. Open questions

### 9.1 Should `runs/<runId>/heartbeat` be a marker file or carry a payload?

Default: empty file, mtime is the signal. An alternative is to write the parent PID into the file so `gcStaleRuns` can additionally cross-check `isPidAlive(parentPid)` before deletion — a belt-suspenders-and-tie configuration. Round-2 bullet on simplicity preference suggests the mtime-only form is sufficient; PID cross-check is a follow-up if false-stale sweeps are ever observed in practice.

### 9.2 CONTEXT.md amendment

Verifier flagged "possibly" on whether the term "apparat-shaped project" rises to CONTEXT.md domain-glossary status. Default: defer to the implementing session's read of CONTEXT.md current state. If the term is already present (or the file already covers project-shape signals), skip the amendment.

### 9.3 Salvage of the buried illumination

`.apparat/.apparat/meditations/illuminations/2026-05-12T1028-collapse-memory-tail-and-tier-pipeline-models.md` is a real, committed illumination authored by the ghost run. The implementing session should review it; if its content is still useful, cherry-pick to `.apparat/meditations/illuminations/` under the same slug before `rm -rf .apparat/.apparat/`. If superseded by later work, delete with the rest.

### 9.4 Daemon-side `runId` threading

The daemon's `runTask` flow does not yet thread a pipeline-supplied `runId` into spawned children's `agent.run` calls. This design ships without daemon-side adoption — daemon-spawned runs land with `runId` undefined and MCP configs continue to land at `cwd` (matching today's behaviour). When the daemon wiring lands (one-line edit in `src/daemon/runner.ts` plus `injectRunArgs`), it inherits the relocation automatically. Tracked as a follow-up, not blocking here.

## 10. Verification approach

### 10.1 Static checks

- `npx tsc --noEmit` — clean.
- Grep `assertApparatShape` in `src/cli/lib/pipeline-bootstrap.ts` — present.
- Grep `gcStaleRuns` in `src/cli/lib/pipeline-bootstrap.ts` — present.
- Grep `RunOptions` in `src/cli/lib/agent.ts` — `runId?` field present.
- Grep `setInterval` in `src/cli/commands/pipeline/run.ts` — present, paired with `clearInterval` in the same file.
- Grep `path.join(cwd, ` `'`.mcp-` `'` in `src/cli/lib/agent.ts` — zero matches (the cwd-rooted write is gone; replaced by the runs-rooted form).

### 10.2 Tests

- `npx vitest run src/cli/tests/pipeline-bootstrap.test.ts` — passes (existing 14 + new ~13 cases).
- `npx vitest run src/cli/tests/meditate.test.ts` — passes (existing 8 with shape-signal seed + 2 new refusal cases).
- `npx vitest run src/cli/tests/agent-run.test.ts` — passes (existing ×9 + new MCP-relocation case).
- Full `npx vitest run` — passes.

### 10.3 Smoke

- `apparat pipeline run meditate <real-project>` — confirm `<real-project>/.apparat/runs/<slug>-<uuid8>/heartbeat` exists during the run and the `.mcp-*` file lands in the same folder, not at `<real-project>/`.
- `apparat meditate .apparat` (against this repo) — confirm exit 1, parent-folder suggestion, no `.apparat/.apparat/` created.
- `apparat meditate /tmp/no-shape-here` — confirm exit 1, no-shape-signals message.
- Synthesise a stale run: `mkdir -p /tmp/proj/.apparat/runs/fake; touch -t 202401010000 /tmp/proj/.apparat/runs/fake/heartbeat`; then run any pipeline against `/tmp/proj` and confirm the fake folder is removed at the next `agent.run()` and the sweep log line is emitted.

### 10.4 Negative cases

- `runs/<id>/` with a non-empty heartbeat file (payload accidentally written) — sweep still works (mtime is the signal, content is ignored).
- `runs/<id>/heartbeat` with mtime exactly at 5 min — boundary; off-by-one in either direction is benign (`≥` in §3.5 keeps the exactly-stale case in the rm bucket).
- Two pipelines spawn at the same wall-clock second; both call `gcStaleRuns`; both target the same crashed `runs/<old>/`. One wins, the other's `rmSync` throws ENOENT, caught and ignored.
- A pipeline blocks the event loop for 4 min (long claude call). Heartbeat does not advance during that window. At 4 min, mtime is fresh (< 5 min). At 6 min, mtime would be stale — but the resumed event loop fires the next interval immediately and refreshes the mtime. False-stale sweep avoided.
- Sibling pipeline spawn one tick after a brand-new run's `mkdirSync` but before its initial heartbeat write — IMPOSSIBLE because the initial heartbeat write is synchronous (§3.4); the spawn cannot interleave between mkdir and writeFileSync within the same tick.
- `gcStaleRuns` on a project that has never run a pipeline (`.apparat/runs/` does not exist) — returns 0, no error.

## 11. Summary

`apparat meditate <path>` accepts any folder without proving it is apparat-shaped — passing `.apparat/` produced a buried ghost run committed to this repo at `.apparat/.apparat/runs/meditate-4ab00e87/` with a real illumination in git history that the live `list_illuminations` will never surface. Crash-leaked `.mcp-*-*.json` configs accumulate at the project root because `cleanupMcpConfig` only covers the happy path; the gitignore hides them but does not delete them, and fresh fingerprints (`.mcp-verifier-1778665005965.json` mtime today) prove the pattern is actively recurring two months after the first triage flag. Both failures are missing-preflight + missing-cleanup symptoms.

This design ships three pieces tightly scoped by the cumulative refinement log: (1) **a project-shape preflight in `meditateCommand`** — hard-refuse `basename === ".apparat"`, otherwise require at least one of `VISION.md` / `CONTEXT.md` / `.apparat/` / `.git/`, one if-block at `src/cli/commands/meditate.ts:20-24` calling a new `assertApparatShape` helper in `src/cli/lib/pipeline-bootstrap.ts`; (2) **relocate `.mcp-*-*.json` writes into `<project>/.apparat/runs/<runId>/`** by adding an additive optional `runId` field to `RunOptions` (`src/cli/lib/agent.ts:79-91`) and shifting `writeMcpConfig`'s signature at `:199` — `--mcp-config` already passes an absolute path so the relocation is invisible to `claude`; (3) **a 60s heartbeat at `runs/<runId>/heartbeat` + a `gcStaleRuns()` helper invoked on every `agent.run()` spawn**, with three-state semantics — fresh = alive → skip, stale ≥ 5min = crashed → `rm -rf`, absent = completed (per ADR-0015) → preserve. The initial heartbeat is written synchronously before any `await` to close the brand-new-run-meets-sibling-sweep race; concurrent sweeps tolerate ENOENT mirroring the existing `cleanupMcpConfig` pattern at `src/cli/lib/agent.ts:208-210`; the 60s touch vs 5min stale threshold gives a 5-cycle margin against pathological event-loop blocks.

ADR-0015 (Accepted 2026-05-12, asymmetric GC of run-scoped scratch paths) is the direct precedent — this design extends the same path-key + same "GC lives at the runner level" rule to MCP debris. ADR-0016 (new) records the heartbeat lifecycle. The `deep-modules-hide-complexity` lens (round 2): one liveness signal per run, not per scratch file — future scratch types live inside `runs/<runId>/` and inherit the GC for free. SKILL.md gains a "Preflight discipline" section so `init`, `janitor`, and future commands inherit the orient-then-write rule rather than re-discovering it.

Plus janitorial: delete `.apparat/.apparat/` (salvage the buried illumination first if still useful) and the two repo-root orphan MCP files in the landing commit. Two new scenarios under `.apparat/scenarios/` (`meditate-rejects-internal-folder`, `meditate-sweeps-stale-mcp-configs`) lock the behaviour against regression.

Blast radius is **M trending L** — ~16 files: 7 source (`meditate.ts`, `pipeline-bootstrap.ts`, `agent.ts`, `pipeline/run.ts`, `handlers/registry.ts`, `core/engine.ts`, `looping-agent-handler.ts`) + 3 tests + 2 scenarios + 3 docs + 1 new ADR. The two engine files (`registry.ts`, `engine.ts`) were pulled in by the spec-review loop: the handler surface needs an additive `runId?: string` field and the engine must populate it from in-scope `runId` at each handler invocation site. No breaking changes for external consumers — `RunOptions.runId?` is additive and optional; `writeMcpConfig`'s two call sites are both inside `agent.ts`. No new tracer fields, no new CLI flag, no new env var, no new top-level command, no `.dot` schema change, no Ink TUI change, no agent rubric change. Sequencing defaults to a single PR — splitting introduces dead optional code mid-train. Long-term growth of *completed* run folders is explicitly out of scope; that concern is owned by sibling illumination `2026-05-13T0805-scratch-sediment-needs-an-apparat-sweep-command.md`.
