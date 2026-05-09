# Design: Collapse the two run-state homes onto one tracer + add a cross-project operator view

**Date:** 2026-05-09
**Status:** draft (pending review)
**Originating illumination:** `.apparat/meditations/illuminations/2026-05-07T2037-two-run-homes-no-cross-project-view.md`

## 1. Motivation

apparat persists run state in two disjoint homes that the rest of the CLI never reconciles, and the operator has no command that answers "what is apparat doing on my machine right now?".

**Two homes, two ID shapes.** The same physical execution writes two parallel records:

- Interactive `apparat pipeline run` allocates `const runId = randomUUID().slice(0, 8)` at `src/cli/commands/pipeline/run.ts:127` and writes the rich engine trace to `<project>/.apparat/runs/<runId>/pipeline.jsonl` (path computed from `runDir(projectRoot, runId)` at `src/cli/lib/apparat-paths.ts:32-34`, mounted at `src/cli/commands/pipeline/run.ts:144`).
- Daemon-scheduled runs allocate `const runId = randomUUID()` at `src/daemon/runner.ts:54` and write line-buffered stdout/stderr only to `~/.apparat/logs/<taskId>/<runId>.log` (path computed from `getRunLogPath` at `src/daemon/state.ts:50-52`, written via `appendLogLine` at `:94-97`). The same daemon-scheduled run *also* spawns `apparat pipeline run` as a child (`src/daemon/runner.ts:69-74`), which then independently allocates its own 8-char runId and writes its own project-local JSONL.

The engine seam already accepts an injected runId: `const runId = opts.runId ?? randomUUID().slice(0, 8)` at `src/attractor/core/engine.ts:150` (commit `fb4baaa fix(engine,cli): unify run_id`). The daemon never followed — it spawns the child blind, with no `--runId` plumbing. Half-finished work sitting on a usable seam.

**Two inspection commands, one runId you can't translate.** `apparat heartbeat logs <task>` (`src/cli/commands/heartbeat.ts:268-291`) reads only home-global logs and prints a full UUID; `apparat pipeline trace <runId>` reads only project-local JSONL and expects an 8-char id. Pasting one into the other fails. The runId surfaced by the daemon log is unusable in the inspection command that holds the structured event data.

**No cross-project glance.** `~/.apparat/` (`getApparatHome()` at `src/daemon/state.ts:31-34`) holds daemon state exclusively — `tasks.json`, `pids/`, `logs/`. There is no `~/.apparat/projects.json`, no recent-runs index, no `apparat status` command. Subagents looking for `projects.json` and `apparat status` in `src/` returned zero matches. With five active projects, "did janitor fail anywhere this week?" requires walking each project's `.apparat/runs/` by hand; the validator diagnostics emitted via the structured tracer are silently lost from daemon stdout because they do not flow through `child.stdout` at `src/daemon/runner.ts:81-91`.

**Two distinct TUIs for adjacent work.** `HeartbeatWatch` at `src/cli/components/HeartbeatWatch.tsx:14-92` is a daemon-task TUI (`stream("watch", ...)` at `:23`); the live pipeline run is `PipelineApp` at `src/cli/components/PipelineApp.tsx:50` (component spans the rest of the ~317-line file). Two Ink apps watching adjacent state, neither aware of the other.

Strategic compass — `docs/VISION.md` frames the operator pain directly: *"Managing many projects with many agents exceeds working memory."* The agent-implements-the-task delegation is solved within one project; the operator-manages-many-projects layer is unsolved. The illumination targets that gap. ADR-0008's partition principle (Clause A apparat-defined + Clause B no pre-existing convention) accommodates `~/.apparat/` as the operator-global orchestration tier; ADR-0001's "no global registry" covers agent definitions, not an operator-state index of project paths the user already passed via `--project`, so a thin `projects.json` is consistent with both.

The illumination's stimulus reading: `JsonlPipelineTracer` is the deep module — it already produces the canonical record. Daemon should *write to that one tracer* (via the `--logs-root` already exposed at `PipelineRunOptions.logsRoot` `src/cli/commands/pipeline/run.ts:32-38`) instead of layering a second, lossier log. One seam, two callers — the deep-module collapse is right there.

## 2. Decision summary

Per `chat_summarizer.refinements`:

- **Steps 1–2 are the depth work** the stimulus `deep-modules-hide-complexity` calls for: collapse the daemon onto the engine's existing tracer seam.
- **Steps 3–7 are bundled feature scope** (operator payoff). The user accepted bundling after concrete before/after examples rather than splitting the illumination — "stop hunting" is the validated benefit.
- **Step 5 is flagged, not blocked.** `apparat watch` must reuse `HeartbeatWatch` and `PipelineApp` as Ink components, not wrap them in a shallow facade that re-introduces the same fragmentation one level up.

Decisions:

1. **Unify the runId scheme on the 8-char prefix.** Daemon adopts `randomUUID().slice(0, 8)` so `heartbeat logs <id>` and `pipeline trace <id>` accept the same shape. A single helper `newRunId()` in `src/cli/lib/apparat-paths.ts` (next to `runsDir` / `runDir`) owns the truncation rule.
2. **Route daemon-scheduled runs through the project-local tracer.** When the daemon spawns `apparat pipeline run` at `src/daemon/runner.ts:69-74`, it appends `--logs-root <project>/.apparat/runs/<runId>` and `--run-id <runId>` so the child reuses the daemon's runId and writes the engine trace to the same project-local tree as interactive runs. The home-global `~/.apparat/logs/<taskId>/<runId>.log` keeps only an orchestration breadcrumb (start, end, exit code, cross-link to the project-local trace) — not the duplicated stream.
3. **Add `~/.apparat/projects.json`.** Every CLI invocation that resolves `--project <folder>` appends the absolute path with a `lastSeen` timestamp; reads on subsequent invocations dedup. New module `src/cli/lib/projects-registry.ts` owns reads and writes.
4. **Add `apparat status`.** Walks `projects.json`, lists for each project: registered heartbeat tasks (via the existing `request("list_tasks")` at `src/cli/commands/heartbeat.ts:204`), the last 5 runs from `<project>/.apparat/runs/` with outcome from each `pipeline.jsonl`'s last `pipeline-end`, and the failing nodeId when present. New file `src/cli/commands/status.ts` + a new `StatusApp` Ink component (or a plain `output.info` table — see §3.7 trade-off).
5. **Fold `heartbeat watch` into `apparat watch`** — but as a *single Ink app reusing both `HeartbeatWatch` and `PipelineApp` as child components*, not as a shallow command facade. The two TUIs stay distinct on the inside; the operator sees one dashboard. Deprecate `apparat heartbeat watch` with a one-release alias that prints a deprecation notice and forwards to the new command.
6. **Cross-link runId in `heartbeat logs` output.** Print `→ apparat pipeline trace <runId> --project <projectRoot>` alongside each completed run line in `src/cli/commands/heartbeat.ts:268-291` so the operator pivots from daemon log to engine trace with one paste.
7. **Document the partition in `CONTEXT.md`.** Add a sibling subsection naming `~/.apparat/` as the *operator-global* tier (orchestration state only — `tasks.json`, `pids/`, `logs/` breadcrumbs, `projects.json` index). Mirrors ADR-0008's partition principle one level up.

**Locked OUT of scope** (per `chat_summarizer.refinements`):

- An agent-definition global registry. ADR-0001 still holds; `projects.json` is an operator-state index of project paths, not a registry of agents.
- Schema migration of existing `~/.apparat/logs/<taskId>/*.log` files. Old daemon logs keep their full-UUID filenames; new runs use the 8-char shape. No backfill, no rename.
- A new daemon RPC. `request("list_tasks")` at `src/lib/daemon-client.ts:60` already does the work; `apparat status` and `apparat watch` are new callers, not new endpoints.
- Trace-format changes. The `pipeline.jsonl` event shape (`pipeline-start`, `node-start`, `pipeline-end`, etc.) is byte-identical post-merge.

## 3. Architecture

### 3.1 Before / after diagram

```
Before                                                After
──────                                                ─────
daemon spawns pipeline run                            daemon spawns pipeline run --logs-root … --run-id …
  daemon/runner.ts:54: full-UUID runId                  daemon/runner.ts: 8-char runId via newRunId()
  daemon writes ~/.apparat/logs/<taskId>/<UUID>.log     daemon writes ~/.apparat/logs/<taskId>/<runId8>.log
    (line-buffered stdout/stderr only)                    (orchestration breadcrumb only — start/end/exit/trace path)
  child run.ts:127 allocates ITS OWN 8-char runId       child reuses parent runId via --run-id
  child writes <project>/.apparat/runs/<runId8>/        child writes <project>/.apparat/runs/<runId8>/pipeline.jsonl
    pipeline.jsonl                                        SAME runId as the daemon log

heartbeat logs <task>                                 heartbeat logs <task>
  log filename is full UUID                             log filename is 8-char runId
  no cross-link to pipeline trace                       prints daemon-authored `system`-stream lines:
                                                          - `Engine trace: <project>/.apparat/runs/<runId>/pipeline.jsonl` on start
                                                          - `→ apparat pipeline trace <runId> --project <root>` on close

heartbeat watch                                       apparat watch  (heartbeat watch deprecated alias)
  one-project daemon TUI                                cross-project Ink app composing
                                                        HeartbeatWatch + PipelineApp as children

(no command lists what's running across projects)     apparat status
                                                        walks ~/.apparat/projects.json
                                                        per project: tasks + last 5 runs + outcome + failed nodeId

(no operator-global tier doc)                         CONTEXT.md "Operator-global tier" subsection
                                                        ~/.apparat/ = tasks.json, pids/, logs/, projects.json
```

### 3.2 New module: `src/cli/lib/projects-registry.ts`

```ts
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { getApparatHome } from "../../daemon/state.js";

export interface ProjectEntry {
  path: string;       // absolute path
  lastSeen: number;   // epoch ms
}

const PROJECTS_FILE = "projects.json";

export function projectsFilePath(): string {
  return join(getApparatHome(), PROJECTS_FILE);
}

export function readProjects(): ProjectEntry[] {
  const p = projectsFilePath();
  if (!existsSync(p)) return [];
  try { return JSON.parse(readFileSync(p, "utf8")) as ProjectEntry[]; }
  catch { return []; }
}

/**
 * Idempotent: insert when absent, refresh `lastSeen` when present.
 * Never throws — a bad write is logged but does not fail the caller.
 */
export function recordProject(absPath: string): void {
  try {
    mkdirSync(getApparatHome(), { recursive: true });
    const list = readProjects();
    const idx = list.findIndex(e => e.path === absPath);
    const now = Date.now();
    if (idx === -1) list.push({ path: absPath, lastSeen: now });
    else list[idx] = { ...list[idx], lastSeen: now };
    writeFileSync(projectsFilePath(), JSON.stringify(list, null, 2) + "\n");
  } catch {
    // Operator-state index is best-effort; never fails the caller.
  }
}
```

`recordProject` is called from one place only: the existing `--project` resolution path (the cwd-or-flag normalisation that already runs in every pipeline command). The single call site is `src/cli/commands/pipeline/run.ts` near `:57` (`const project = loaded.projectRoot;`). Other entry points (`meditate`, `implement`) reach the same path via `pipelineRunCommand`; the registry hooks in once.

### 3.3 New helper in `src/cli/lib/apparat-paths.ts`

```ts
import { randomUUID } from "node:crypto";

/**
 * The canonical 8-char runId shape used by both interactive runs
 * (src/cli/commands/pipeline/run.ts:127) and the daemon
 * (src/daemon/runner.ts:54). One source of truth for the truncation rule.
 */
export function newRunId(): string {
  return randomUUID().slice(0, 8);
}
```

Two existing call sites are migrated:

- `src/cli/commands/pipeline/run.ts:127` → `const runId = newRunId();`
- `src/daemon/runner.ts:54` → `const runId = newRunId();`

The engine fallback at `src/attractor/core/engine.ts:150` is left as-is (`opts.runId ?? randomUUID().slice(0, 8)`); it executes only when no runId is injected, which is increasingly rare. Migrating it requires a cross-package import and is deferred — the substance is identical.

### 3.4 Daemon → child runId/logs-root plumbing

Today (`src/daemon/runner.ts:60-74`):

```ts
const cliPath = getRalphCliPath();
const fullArgs = cliPath.shell ? [] : [...cliPath.args, task.command, ...task.args];
// …
const child = spawn(cliPath.command, fullArgs, { stdio: ["ignore", "pipe", "pipe"], env, shell: cliPath.shell });
```

After:

```ts
const cliPath = getRalphCliPath();
// Resolve project root from task args (--project <path>) for --logs-root scoping.
const projectRoot = resolveProjectFromArgs(task.args);
const logsRoot = projectRoot ? join(runsDir(projectRoot), runId) : undefined;

const augmentedArgs = task.command === "pipeline" && task.args[0] === "run" && projectRoot
  ? injectRunArgs(task.args, runId, logsRoot!)
  : task.args;

const fullArgs = cliPath.shell ? [] : [...cliPath.args, task.command, ...augmentedArgs];
```

`resolveProjectFromArgs` and `injectRunArgs` are **new** helpers added in this design — both live alongside `runTask` in `src/daemon/runner.ts` (or a sibling `src/daemon/runner-args.ts` if `runner.ts` grows uncomfortable; implementer's call). `resolveProjectFromArgs(args: string[]): string | null` walks `args` looking for `--project <value>` and returns the absolute path or `null`; it tolerates the flag appearing anywhere in the array (Commander allows free interleaving). `injectRunArgs(args: string[], runId: string, logsRoot: string): string[]` returns a new array with `--run-id <runId> --logs-root <logsRoot>` appended, idempotent on existing flags (skip injection if already present so a manual `apparat heartbeat pipeline … -- --run-id foo` does not double-inject).

`pipeline run` already accepts `--logs-root` via `PipelineRunOptions.logsRoot` at `src/cli/commands/pipeline/run.ts:35`. A new `--run-id <id>` option must be added at the CLI registration site `src/cli/program.ts` and threaded through `pipelineRunCommand` → `runPipeline({ runId, ... })` (the engine accepts it at `src/attractor/core/engine.ts:150`).

For non-pipeline tasks (e.g. `meditate`, `implement` scheduled via heartbeat), no augmentation: those commands do not own a project-local trace today, and routing them is out of scope per refinement-bullet 1 (depth work is `pipeline run` only).

The home-global daemon log shrinks. `child.stdout`/`child.stderr` capture at `src/daemon/runner.ts:81-91` is preserved (it remains the only place stdout/stderr land for non-pipeline tasks), but the daemon adds two synthetic `system`-stream lines on `pipeline run` tasks:

```ts
appendLogLine(task.id, runId, {
  ts: startedAt,
  stream: "system",
  content: `Engine trace: ${join(logsRoot!, "pipeline.jsonl")}`,
});
// … on close:
appendLogLine(task.id, runId, {
  ts: endedAt,
  stream: "system",
  content: `→ apparat pipeline trace ${runId} --project ${projectRoot}`,
});
```

### 3.5 New command: `apparat status`

```ts
// src/cli/commands/status.ts
import { request } from "../../lib/daemon-client.js";
import { readProjects } from "../lib/projects-registry.js";
import { runsDir } from "../lib/apparat-paths.js";
import { readLastRunOutcome } from "../lib/pipeline-status.js";
import * as output from "../lib/output.js";
import type { Task } from "../../daemon/state.js";

export async function statusCommand(opts: { limit?: number } = {}): Promise<void> {
  const projects = readProjects();
  if (projects.length === 0) {
    await output.info("No projects registered yet. Run `apparat pipeline run …` in a project to register it.");
    return;
  }
  const tasks = await listTasksWithTimeout(); // 1500ms timeout, degrades on failure
  await output.info(`Apparat status — ${projects.length} project(s)\n`);
  for (const p of projects.sort((a, b) => b.lastSeen - a.lastSeen)) {
    const projTasks = (tasks ?? []).filter(t => t.args.includes(p.path));
    const lastRun = readLastRunOutcome(runsDir(p.path));
    await output.info(`  ${p.path}`);
    await output.info(`    last seen: ${new Date(p.lastSeen).toLocaleString()}`);
    await output.info(`    heartbeat tasks: ${projTasks.length === 0 ? "(none)" : projTasks.map(t => t.id).join(", ")}`);
    await output.info(`    last run: ${formatLastRun(lastRun)}`);
    await output.info("");
  }
}
```

`readLastRunOutcome` is **new infra in this design**. The 2026-05-07 mission-control design (`docs/superpowers/specs/2026-05-07-pipeline-mission-control-fragmentation-design.md`) specifies it inside `src/cli/lib/pipeline-status.ts` but that file is not yet in the repo (verified by `grep readLastRunOutcome src/`: zero matches). Whichever of the two designs lands first creates the file; the second one consumes the existing helper. Contract: `readLastRunOutcome(runsRoot: string): { runId: string; outcome: "success" | "failure"; timestamp: string } | null` — walks `<runsRoot>/<runId>/pipeline.jsonl` for the latest `pipeline-end` event and returns the parsed shape, or `null` when no run exists or no `pipeline-end` was recorded. Tolerates malformed lines (skips them) and missing files (returns `null`). Pure read, never throws.

The daemon-unavailable degradation pattern is the same as `pipeline list`: 1500 ms timeout, render `(daemon offline)` for the heartbeat-tasks line, exit 0.

Registration adds one new top-level command:

```ts
// src/cli/program.ts
import { statusCommand } from "./commands/status.js";
program
  .command("status")
  .description("Cross-project status: registered projects, scheduled heartbeats, and recent runs")
  .option("--limit <n>", "Max recent runs per project (default: 5)", "5")
  .action(async (opts) => { await statusCommand({ limit: Number(opts.limit) }); });
```

### 3.6 Folding `heartbeat watch` into `apparat watch`

The constraint from refinement-bullet 4: `apparat watch` MUST be a true Ink app that composes `HeartbeatWatch` and `PipelineApp` as child components. A wrapper that re-shells one or the other re-introduces the fragmentation the design is meant to remove.

Plan:

- New file `src/cli/components/WatchApp.tsx` exporting `WatchApp` — a single Ink root that renders both panes side-by-side or in a tab layout (decision deferred to implementing session; both layouts compose the same children).
- The existing `WatchApp` component inside `src/cli/components/HeartbeatWatch.tsx:14-87` is renamed to `HeartbeatPane` and exported. The `renderWatch` entry at `:89-92` is preserved as a deprecation shim that calls `apparat watch` and prints a one-line deprecation notice.
- `PipelineApp` is consumed as a *recently-finished-runs* viewer in this context — it already accepts a JSONL trace path and renders the run; in `WatchApp` it renders the latest completed run for the selected project.
- New file `src/cli/commands/watch.ts` registers `apparat watch` and calls `renderWatchApp()`.
- `apparat heartbeat watch` is preserved as a deprecation alias that prints `[apparat] heartbeat watch is deprecated; use apparat watch instead` to stderr and then calls `renderWatchApp()`. Removed in a follow-up release; the alias gives users one cycle to migrate.

The single-Ink-app constraint is the load-bearing detail. Reviewer: if the implementing session opts for a wrapper that simply shells out, the design is broken — surface a request to revisit.

### 3.7 `apparat status`: text vs. Ink

Two render shapes are plausible:

- **Plain `output.info` table** (chosen default). Status is a glance command; `output.info` keeps it scriptable, copy-pasteable into chat, and consistent with `pipeline list`.
- **Ink dashboard** (rejected). An Ink app for a one-shot non-streaming command is overkill and adds startup latency. `apparat watch` is the right home for a live dashboard.

If the implementing session discovers a strong reason for Ink (e.g. wide tables that benefit from terminal-aware column wrapping), it may switch — both shapes consume the same `readProjects()` + `request("list_tasks")` data flow.

### 3.8 Files-touched buckets

| Bucket | Files | Treatment |
|---|---|---|
| RunId helper | `src/cli/lib/apparat-paths.ts` | Inline edit — add `newRunId()` |
| RunId migration | `src/cli/commands/pipeline/run.ts:127`, `src/daemon/runner.ts:54` | Inline edit — call `newRunId()` |
| Daemon plumbing | `src/daemon/runner.ts:60-74` | Edit — resolve `projectRoot` from `task.args`, inject `--run-id` and `--logs-root` on `pipeline run` tasks; emit cross-link breadcrumb on close |
| CLI flag | `src/cli/program.ts` | Edit — add `--run-id <id>` option to `pipeline run` |
| Run command | `src/cli/commands/pipeline/run.ts` | Edit — accept `runId` option, thread to `runPipeline({ runId, ... })`; call `recordProject(project)` after project resolution |
| Projects registry | `src/cli/lib/projects-registry.ts` | **New** — `readProjects`, `recordProject`, `projectsFilePath` |
| Status command | `src/cli/commands/status.ts` | **New** — `statusCommand` reading registry + tasks + last runs |
| Pipeline status helper | `src/cli/lib/pipeline-status.ts` | **New (or shared with 2026-05-07 mission-control design — whichever lands first)** — `readLastRunOutcome` |
| Status registration | `src/cli/program.ts` | Edit — `program.command("status")` block |
| Heartbeat logs cross-link | `src/cli/commands/heartbeat.ts:268-291` | Edit — print `→ apparat pipeline trace <runId> --project <root>` per completed run line |
| Watch app | `src/cli/components/WatchApp.tsx` | **New** — Ink root composing `HeartbeatPane` + `PipelineApp` |
| Watch registration | `src/cli/commands/watch.ts` | **New** — `apparat watch` entry |
| Heartbeat watch refactor | `src/cli/components/HeartbeatWatch.tsx:14-92` | Edit — extract `WatchApp` → `HeartbeatPane`; preserve `renderWatch` as deprecation shim |
| Tests — new | `src/cli/tests/projects-registry.test.ts` | **New** — covers `recordProject` idempotency + `readProjects` malformed-file safety |
| Tests — new | `src/cli/tests/status.test.ts` | **New** — covers `statusCommand` with empty registry, daemon-offline, and a populated fixture |
| Tests — edited | `src/cli/tests/pipeline-runs-gc.test.ts` | Edit — runId fixtures now use the 8-char shape from `newRunId()`; gc behaviour unchanged |
| Tests — edited | `src/cli/tests/heartbeat.test.ts` (or whichever covers daemon spawn) | Edit — assert the daemon spawns the child with `--run-id` and `--logs-root` for `pipeline run` tasks; assert the cross-link breadcrumb appears in the home-global log |
| Spec ripple | `CONTEXT.md` | Edit — add "Operator-global tier" subsection naming `~/.apparat/` |
| Spec ripple | `README.md` | Edit — command table gains rows for `apparat status` and `apparat watch`; mark `apparat heartbeat watch` as deprecated alias |
| ADR | `docs/adr/0008-*.md` (or new ADR) | Optional — record the operator-global tier as the explicit Clause-A application of ADR-0008. Default: append a paragraph to the existing ADR rather than create a new one. |

Total: ~24 files. **New (5 modules + 2 test files + 1 new command file = 8 new):** `src/cli/lib/projects-registry.ts`, `src/cli/lib/pipeline-status.ts` (or shared with 2026-05-07 design), `src/cli/commands/status.ts`, `src/cli/commands/watch.ts`, `src/cli/components/WatchApp.tsx`, `src/cli/tests/projects-registry.test.ts`, `src/cli/tests/status.test.ts`. **Edited (~16 files):** daemon (`runner.ts`), CLI (`apparat-paths.ts`, `pipeline/run.ts`, `heartbeat.ts`, `program.ts`), TUI (`HeartbeatWatch.tsx`), tests (`pipeline-runs-gc.test.ts`, daemon-runner test), docs (`CONTEXT.md`, `README.md`, optional ADR-0008 paragraph). Surfaces crossed: daemon (1), CLI commands (3 new + 2 edited), CLI lib (3), TUI (1 new + 1 edited), tests (2 new + 2 edited), docs (2-3 edited).

## 4. Components & key edits

### 4.1 `src/cli/lib/apparat-paths.ts` (edited)

See §3.3. One new export `newRunId()`. ~5 LOC.

### 4.2 `src/cli/lib/projects-registry.ts` (new)

See §3.2. ~40 LOC. Three exports — `readProjects`, `recordProject`, `projectsFilePath`. Best-effort writes; reads tolerate missing/malformed file by returning `[]`.

### 4.3 `src/daemon/runner.ts` (edited)

Changes:

1. Line `:54`: `const runId = randomUUID()` → `const runId = newRunId()` (import from `../cli/lib/apparat-paths.js`).
2. Lines `:60-74`: resolve `projectRoot` from `task.args`; if `task.command === "pipeline" && task.args[0] === "run"` and `projectRoot` is non-null, inject `--run-id <runId>` and `--logs-root <runsDir(projectRoot)/<runId>>` into `task.args` before composing `fullArgs`.
3. Lines around `:96-99`: append synthetic `system`-stream breadcrumbs (`Engine trace: <path>` on start, `→ apparat pipeline trace <runId> --project <root>` on close) when augmentation was applied.

The augmentation is gated on `pipeline run` tasks only; `meditate` / `implement` heartbeat tasks see no behaviour change.

### 4.4 `src/cli/commands/pipeline/run.ts` (edited)

Changes:

1. Line `:127`: `const runId = randomUUID().slice(0, 8)` → `const runId = opts.runId ?? newRunId()` (so `--run-id` from the daemon takes precedence).
2. New option in `PipelineRunOptions`: `runId?: string`.
3. After `const project = loaded.projectRoot;` at `:57`, call `recordProject(project)` (best-effort; never throws).
4. Pass `runId` through to `runPipeline({ runId, ... })` at the existing call site (engine already accepts it at `src/attractor/core/engine.ts:150`).

The `--run-id` CLI flag is registered in `src/cli/program.ts` next to the existing `--logs-root` flag for `pipeline run`.

### 4.5 `src/cli/commands/status.ts` (new)

See §3.5. ~70 LOC. Composes `readProjects`, `request("list_tasks")` with timeout, `readLastRunOutcome`. Pure read — no IPC writes, no engine spawn.

### 4.6 `src/cli/components/WatchApp.tsx` (new)

See §3.6. ~80 LOC. Ink root that imports `HeartbeatPane` (renamed from `HeartbeatWatch`'s inner `WatchApp`) and `PipelineApp`, lays them out in a column or tab structure. Project selection drives which `PipelineApp` instance renders (the latest completed run's JSONL).

### 4.7 `src/cli/components/HeartbeatWatch.tsx` (edited)

The internal `WatchApp` component (`:14-87`) is renamed to `HeartbeatPane` and exported. The `renderWatch` function (`:89-92`) is rewritten as a deprecation shim: it prints `[apparat] heartbeat watch is deprecated; use apparat watch instead` to stderr and then renders the new composed `WatchApp` from `src/cli/components/WatchApp.tsx`. `apparat heartbeat watch` continues to work for one release; the alias is removed in a follow-up.

### 4.8 `src/cli/commands/heartbeat.ts:268-291` (edited)

The `logs` action prints log lines today via `console.log(`[${msg.stream}] ${msg.content}`)`. After the change, *system*-stream lines that match the cross-link breadcrumb shape (`→ apparat pipeline trace …`) are still printed verbatim — they were authored by the daemon in §3.4. No transformation is needed in the consumer; the cross-link is data, not formatting.

### 4.9 Tests

**`src/cli/tests/projects-registry.test.ts`** (new):

- `recordProject` adds a missing path with `lastSeen` set.
- `recordProject` is idempotent — second call updates `lastSeen`, does not duplicate.
- `readProjects` returns `[]` on missing file.
- `readProjects` returns `[]` on malformed JSON, does not throw.
- `recordProject` against an unwritable home directory does not throw.

**`src/cli/tests/status.test.ts`** (new):

- Empty registry → prints "No projects registered yet."
- Populated registry, daemon online → lists projects with task counts and last-run outcome.
- Populated registry, daemon offline (timeout) → renders `(daemon offline)` for tasks line, listing exits 0.
- Project with no runs → `last run: (no runs yet)`.

**`src/cli/tests/heartbeat.test.ts`** (or the existing daemon-runner test, whichever exists):

- Daemon spawning a `pipeline run` task with `--project` injects `--run-id <id>` and `--logs-root <runsDir>/<runId>` into the child's argv.
- Home-global log contains the `Engine trace:` breadcrumb on start and the `→ apparat pipeline trace` cross-link on close.
- Daemon spawning a `meditate` task does NOT inject `--run-id` or `--logs-root` (out-of-scope — only `pipeline run` is augmented).

**`src/cli/tests/pipeline-runs-gc.test.ts`** (edited):

- Fixture run dirs use the 8-char shape from `newRunId()`. GC behaviour is shape-agnostic, but the test's own runId factory should match the new helper to avoid drift.

## 5. Data flow

### 5.1 Daemon-scheduled `pipeline run` (after)

```
heartbeat fires task at scheduled time
  → src/daemon/runner.ts runTask
    → const runId = newRunId()                        (8-char)
    → resolveProjectFromArgs(task.args) → projectRoot
    → logsRoot = runsDir(projectRoot)/<runId>
    → augmentedArgs = injectRunArgs(task.args, runId, logsRoot)
    → spawn apparat pipeline run … --run-id <runId> --logs-root <logsRoot>
    → appendLogLine(taskId, runId, {stream: "system", content: "Engine trace: <logsRoot>/pipeline.jsonl"})
    → child runs:
        → src/cli/commands/pipeline/run.ts pipelineRunCommand
          → opts.runId = <runId>  (from --run-id)
          → opts.logsRoot = <logsRoot>  (from --logs-root)
          → const runId = opts.runId  (no new allocation — reuses parent's)
          → JsonlPipelineTracer writes <logsRoot>/pipeline.jsonl
    → child exits
    → appendLogLine(taskId, runId, {stream: "system", content: "→ apparat pipeline trace <runId> --project <projectRoot>"})
    → closeRun(taskId, runId, endedAt, exitCode)
```

The home-global log at `~/.apparat/logs/<taskId>/<runId8>.log` now contains:

```
{type: "run", id: "a1b2c3d4", taskId: "pipeline:…", startedAt: …}
{ts: …, stream: "system", content: "Engine trace: /work/.apparat/runs/a1b2c3d4/pipeline.jsonl"}
{ts: …, stream: "stdout", content: "[engine] node: start"}
…
{ts: …, stream: "system", content: "→ apparat pipeline trace a1b2c3d4 --project /work"}
{type: "run", id: "a1b2c3d4", taskId: "pipeline:…", startedAt: …, endedAt: …, exitCode: 0}
```

The project-local `<work>/.apparat/runs/a1b2c3d4/pipeline.jsonl` contains the full engine trace — same shape as interactive runs today.

### 5.2 `apparat status`

```
apparat status
  → src/cli/commands/status.ts statusCommand
    → readProjects()                     (~/.apparat/projects.json)
    → request("list_tasks")              (1500ms timeout, degrades to null)
    → for each project (lastSeen desc):
        readLastRunOutcome(runsDir(project.path))
        filter tasks where args includes project.path
        output.info(card)
```

### 5.3 `apparat watch`

```
apparat watch
  → src/cli/commands/watch.ts (new)
    → render(<WatchApp />)
      → HeartbeatPane subscribes to stream("watch", ...) — same as today's heartbeat watch
      → PipelineApp instance renders the selected project's latest completed run
        (reads <project>/.apparat/runs/<runId>/pipeline.jsonl)
      → useInput handles project switching + keyboard nav
```

### 5.4 `apparat heartbeat logs <id>` (cross-link path)

```
apparat heartbeat logs <id>
  → src/cli/commands/heartbeat.ts:268-291 (logs action)
    → request("stream_logs", { taskId: id })
    → for each msg.type === "log_line": console.log(`[${msg.stream}] ${msg.content}`)
      where {stream: "system", content: "→ apparat pipeline trace <runId> --project <root>"}
      lines are authored by the daemon in §5.1 — printed verbatim
```

## 6. Blast radius / impact surface

- **Size:** **M.** Verifier final pass: M. Explainer Tier-2 §Blast radius: M. Same envelope.
  - **Files touched:** ~24 — 8 new (5 modules: `projects-registry.ts`, `pipeline-status.ts`, `status.ts`, `watch.ts`, `WatchApp.tsx`; 2 new test files: `projects-registry.test.ts`, `status.test.ts`; 1 new ADR paragraph or new ADR if implementing session prefers) + ~16 edited (daemon: `runner.ts`; CLI: `apparat-paths.ts`, `pipeline/run.ts`, `program.ts`, `heartbeat.ts`; TUI: `HeartbeatWatch.tsx`; tests: `pipeline-runs-gc.test.ts`, `heartbeat.test.ts`; docs: `CONTEXT.md`, `README.md`, ADR-0008 paragraph). The `pipeline-status.ts` row is shared with the 2026-05-07 mission-control design — count it once total across the two designs.
  - **Surfaces crossed:** daemon (1 — `runner.ts`), CLI commands (`run.ts`, new `status.ts`, new `watch.ts`, `heartbeat.ts`), CLI lib (`apparat-paths.ts`, new `projects-registry.ts`), TUI (1 new + 1 edited Ink component), tests (2 new + 2 edited), docs (2-3 edited).
- **Breaking changes:** **yes — two, both deliberate.**
  - **Daemon log runId on disk becomes 8-char.** External scrapers of `~/.apparat/logs/<taskId>/<runId>.log` that pattern-match a full UUID would notice. No internal consumer relies on the UUID shape — the daemon's own readers (`listRuns` at `src/daemon/state.ts:108-115`, `readRunLogs` at `:117-125`) treat the runId as an opaque string. Old logs are not migrated; they keep their full-UUID filenames and remain readable.
  - **`apparat heartbeat watch` collapses into `apparat watch`.** Preserved as a deprecation alias for one release with a stderr notice. README and help text are updated. `apparat heartbeat watch` continues to function during the deprecation window.
- **Spec / docs ripple checklist:**
  - [ ] `CONTEXT.md` — add "Operator-global tier" subsection naming `~/.apparat/` as the orchestration-state home (`tasks.json`, `pids/`, `logs/` breadcrumbs, `projects.json` index). Mirrors ADR-0008's partition principle one level up.
  - [ ] `README.md` command table — add rows for `apparat status` and `apparat watch`; mark `apparat heartbeat watch` as deprecated alias.
  - [ ] `src/cli/program.ts` help text at `:33-42` — add `apparat status` and `apparat watch` to the "Background scheduling" or a new "Cross-project status" block; mark `apparat heartbeat watch` deprecated.
  - [ ] `docs/adr/0008-*.md` — append one paragraph documenting `~/.apparat/` as the explicit Clause-A operator-global tier (vs. creating a new ADR — operator-global isn't a new principle; it's an application of the existing partition).
  - [ ] No new ADR. ADR-0001 ("no global registry") is reinforced — `projects.json` is an operator-state index of paths, not a registry of agents or pipelines, and the design explicitly excludes agent-definition globals from scope.
- **Test ripple checklist:**
  - [ ] **New** `src/cli/tests/projects-registry.test.ts` — see §4.9.
  - [ ] **New** `src/cli/tests/status.test.ts` — see §4.9.
  - [ ] **Edit** `src/cli/tests/pipeline-runs-gc.test.ts` — runId fixtures use `newRunId()` shape.
  - [ ] **Edit** `src/cli/tests/heartbeat.test.ts` (or the daemon-runner test, whichever covers `runTask`) — assert daemon spawns child with `--run-id` and `--logs-root` for `pipeline run` tasks; assert cross-link breadcrumb in the home-global log.
  - [ ] **No edit** to `pipeline-show.test.ts`, `pipeline-trace*.test.ts`, `pipeline-failure-reason.test.ts` — those surfaces are unchanged.

## 7. Trade-offs

### 7.1 Daemon adopts 8-char vs. interactive adopts full UUID

**8-char chosen.** Reasons:

- The 8-char shape is human-shaped: shows up clean in trace paths (`<project>/.apparat/runs/a1b2c3d4/`), in CLI prompts, in copy-paste flows. Full UUIDs are visual noise.
- The daemon-side full UUID is invisible to anyone but the daemon. Migrating it is a pure win: collision space drops from 2^128 to 4 billion, but apparat is solo-developer tooling — the realistic concurrent-run ceiling is ~10, not 4 billion.
- Refinement-bullet 1 endorsed steps 1-2 as the depth work; the user did not push for a full-UUID retention.

**Cost:** External scrapers of daemon log filenames break (deliberate breaking change, mitigated by the deprecation in §6).

### 7.2 Daemon routes through `--logs-root` vs. parses child's own JSONL

**Daemon-injects-`--logs-root`** chosen. Reasons:

- The engine seam (`PipelineRunOptions.logsRoot` at `src/cli/commands/pipeline/run.ts:35` and `runPipeline({ runId, logsRoot, ... })` at the engine level) already accepts both pieces of state. The daemon plugs into the existing seam — the deep-module collapse the stimulus calls for.
- Parsing the child's own JSONL (alternative: daemon writes nothing, walks `<project>/.apparat/runs/` post-hoc to build its log) re-introduces a second lossy code path. The home-global log's job is now an *orchestration breadcrumb*, not a duplicate stream.
- Validator diagnostics emitted via the structured tracer (`onValidationFailure` at `src/attractor/tracer/jsonl-pipeline-tracer.ts:60-76`) flow through the project-local JSONL — exactly where `apparat pipeline trace --node-receive` reads them. They are no longer silently dropped from daemon-only logs.

**Cost:** The daemon must understand `task.command === "pipeline" && task.args[0] === "run"` as a special case for argv augmentation. Other commands (`meditate`, `implement`) are routed unchanged. This is a small concession; the alternative (a `--logs-root` injection on every command) requires those commands to also accept the flag.

### 7.3 `~/.apparat/projects.json` vs. discover via filesystem walk

**Explicit registry** chosen. Reasons:

- Filesystem walk (e.g. `find ~ -name '.apparat' -type d`) is slow, leaks user privacy (touches every directory), and depends on heuristics.
- The registry is essentially free — every CLI invocation already resolves `--project`. One idempotent write per invocation costs microseconds.
- The user accepted the registry shape in refinement-bullet 3 ("stop hunting" benefit walkthrough).

**Cost:** A new file to maintain. Mitigated: best-effort writes, malformed-file tolerance, no schema migration needed (additive fields only).

### 7.4 `apparat watch` as composed Ink app vs. shell-out wrapper

**Composed Ink app** chosen — refinement-locked (bullet 4). Reasons:

- Wrapping `heartbeat watch` and `pipeline run` as separate processes re-creates the fragmentation at the command layer. The stimulus `deep-modules-hide-complexity` calls out shallow facades as anti-patterns.
- A single Ink root with two child components shares input handling, project selection, and rendering loop — the operator sees one cohesive dashboard.
- Composition cost is ~80 LOC for `WatchApp.tsx` plus a rename/export in `HeartbeatWatch.tsx`.

**Cost:** The implementing session must take care that `HeartbeatPane` and `PipelineApp` do not assume a fullscreen Ink root; if they do, the composition needs a small refactor of their layout assumptions. Flagged as an open question.

### 7.5 `apparat status` as plain text vs. Ink

**Plain text** chosen as default. Status is a one-shot glance command, not a live dashboard — Ink is overhead. `apparat watch` is the home for the Ink experience. The implementing session may switch if terminal-width handling becomes painful.

### 7.6 Single PR vs. staged

**Single PR.** The depth work (steps 1-2) and the operator-payoff features (steps 3-7) are co-dependent in user experience: a runId unification without `apparat status` to demonstrate the cross-project glance leaves the breaking change unjustified to anyone reading the changelog. A staged PR train would bundle:

- **PR 1:** `newRunId()` helper + migrate two call sites (no behavioural change for users).
- **PR 2:** Daemon plumbing for `--run-id` + `--logs-root` + cross-link breadcrumb.
- **PR 3:** `projects.json` registry + `apparat status`.
- **PR 4:** `apparat watch` + `HeartbeatWatch` refactor.

But the user accepted bundled scope after operator-payoff examples (refinement-bullet 2). Default to single PR; the implementer may split if review bandwidth requires.

## 8. Constraints

After the change:

- `npx tsc --noEmit` passes.
- `npx vitest run` passes — including the new `projects-registry.test.ts`, `status.test.ts`, the migrated `pipeline-runs-gc.test.ts`, and the augmented daemon-runner test.
- `apparat pipeline run <pipeline> --project <root>` (interactive) — runId is 8-char, JSONL lands at `<root>/.apparat/runs/<runId>/pipeline.jsonl`, `recordProject(<root>)` was called before exit.
- `apparat heartbeat pipeline <pipeline> --project <root> --every 60` then daemon fires the task — child runs with the daemon's 8-char runId, JSONL lands at `<root>/.apparat/runs/<runId>/pipeline.jsonl`, home-global `~/.apparat/logs/<taskId>/<runId>.log` contains the orchestration breadcrumb (`Engine trace:` line on start, `→ apparat pipeline trace <runId> --project <root>` on close) but NOT a duplicated copy of every engine event.
- `apparat heartbeat logs <task>` — printed lines include the cross-link breadcrumb verbatim.
- `apparat status` — exits 0 on empty registry (with informational message), lists projects + tasks + last runs on populated registry, renders `(daemon offline)` for tasks line on daemon failure.
- `apparat watch` — renders the composed Ink app with both panes; `q` quits cleanly.
- `apparat heartbeat watch` — prints deprecation notice to stderr, renders the same `WatchApp` for one release.

Repo-wide grep invariants (post-merge):

- `grep -nR "randomUUID()" src/cli/commands/pipeline/run.ts src/daemon/runner.ts` — zero matches in those two files (replaced by `newRunId()`).
- `grep -n "newRunId" src/cli/lib/apparat-paths.ts` — present.
- `grep -nR "import.*projects-registry" src` — at least two importers (`pipeline/run.ts`, `commands/status.ts`).
- `grep -nR "apparat pipeline trace.*--project" src/daemon` — at least one match in the cross-link breadcrumb.
- `grep -nR "command(\"status\"" src/cli/program.ts` — one match.

Behaviour invariants:

- Old `~/.apparat/logs/<taskId>/<full-uuid>.log` files remain readable by `apparat heartbeat logs <task>`.
- `pipeline.jsonl` event shape is byte-identical (no new event kinds, no field changes).
- Daemon RPC surface is byte-identical (no new actions; `request("list_tasks")` is a new caller, not a new endpoint).
- `process.exit` codes unchanged for all existing commands.

## 9. Open questions

- **`apparat watch` layout — column vs. tabs.** The composed Ink app needs a layout choice. Column layout works on wide terminals; tab layout works on narrow ones. Decision deferred to the implementing session; both compose the same children.
- **`HeartbeatPane` and `PipelineApp` fullscreen assumptions.** Both components today assume they own the Ink root (e.g. `useInput` consumes `q` for quit). Composition may require lifting input handling into `WatchApp` and threading callbacks down. Flagged for the implementing session — if the lift is invasive, surface for design revisit before landing.
- **`apparat status --json` output.** Refinements did not name a JSON variant. A `--json` flag for scripting is a natural follow-up (e.g. `apparat status --json | jq '.projects[].lastRun'`). Not in scope for this design; tracked as a follow-up.
- **ADR-0008 paragraph vs. new ADR.** The operator-global tier is an application of ADR-0008's partition principle, not a new principle. Default: append a paragraph to ADR-0008. The implementing session may write a new ADR-0012 if the partition has surprising implications worth a dedicated record.
- **Stimulus alignment of step 5.** The illumination wording ("two TUIs can stay distinct on the inside") leaves ambiguity. This design resolves it: composed Ink app, not shell-out facade. Reviewer should validate the resolution against the stimulus `deep-modules-hide-complexity` before approving.

## 10. Verification approach

### 10.1 Static checks

- `npx tsc --noEmit` — clean.
- Grep `randomUUID\b` in `src/cli/commands/pipeline/run.ts` and `src/daemon/runner.ts` — zero hits.
- Grep `newRunId\b` in `src/cli/lib/apparat-paths.ts` — present.
- Grep `recordProject\b` in `src/cli/commands/pipeline/run.ts` — at least one call.
- Grep `command\("status"` in `src/cli/program.ts` — one match.
- Grep `apparat pipeline trace.*--project` in `src/daemon/runner.ts` — one match (the cross-link breadcrumb).
- Grep `command\("watch"` in `src/cli/program.ts` — one match (top-level `apparat watch`).

### 10.2 Tests

- `npx vitest run src/cli/tests/projects-registry.test.ts` — new, passes.
- `npx vitest run src/cli/tests/status.test.ts` — new, passes.
- `npx vitest run src/cli/tests/pipeline-runs-gc.test.ts` — passes after fixture migration.
- `npx vitest run src/cli/tests/heartbeat.test.ts` (or the daemon-runner test) — passes with new assertions on argv augmentation and breadcrumb lines.
- Full `npx vitest run` — passes.

### 10.3 Smoke

- Schedule a `pipeline run` heartbeat (`apparat heartbeat pipeline meditate --project my-app --every 30`). Wait for the daemon to fire it. Confirm:
  - `~/.apparat/logs/<taskId>/<runId>.log` exists, runId is 8-char, contains the `Engine trace:` and `→ apparat pipeline trace` breadcrumbs, contains stdout/stderr lines but no duplicated engine events.
  - `<project>/.apparat/runs/<runId>/pipeline.jsonl` exists with the full engine trace; runId matches the home-global log's runId.
- Run `apparat status`. Confirm `my-app` appears with the heartbeat task and the latest run outcome.
- Run `apparat watch`. Confirm `HeartbeatPane` shows the task and `PipelineApp` shows the latest completed run for the selected project; `q` quits cleanly.
- Run `apparat heartbeat watch`. Confirm deprecation notice prints to stderr, then the watch app renders.
- Run `apparat heartbeat logs <task>`. Confirm the cross-link breadcrumb appears alongside engine output, and pasting `apparat pipeline trace <runId> --project <root>` lands on the matching JSONL.

### 10.4 Negative cases

- Daemon offline during `apparat status` — schedule line renders `(daemon offline)`, command exits 0.
- `~/.apparat/projects.json` malformed — `readProjects()` returns `[]`, `apparat status` prints empty-registry message, no crash.
- Heartbeat task without `--project` — daemon does not augment argv (no `--logs-root` injection); behaviour matches today.
- Old daemon log file (full-UUID filename) still present — `apparat heartbeat logs <task>` reads it without modification.
- `apparat pipeline run` invoked outside a project (no `--project`, headless) — current behaviour preserved (`src/cli/commands/pipeline/run.ts:120-125` rejects); `recordProject` is not called because the project was never resolved.
- Two projects named `meditate` in two different folders, both scheduled — `apparat status` lists each project independently because the registry keys on absolute path.

## 11. Summary

apparat persists run state in two disjoint homes — interactive `apparat pipeline run` writes the rich engine trace to `<project>/.apparat/runs/<runId8>/pipeline.jsonl` (`src/cli/commands/pipeline/run.ts:127`, `:144`), daemon-scheduled runs write line-buffered stdout/stderr only to `~/.apparat/logs/<taskId>/<runIdFull>.log` (`src/daemon/runner.ts:54`, `src/daemon/state.ts:50-52`), with two different runId schemes that prevent operators from passing a runId from `heartbeat logs` to `pipeline trace`. The engine seam already accepts an injected runId at `src/attractor/core/engine.ts:150` (commit `fb4baaa`) but the daemon never followed — half-finished work. There is no `~/.apparat/projects.json`, no `apparat status` command, no cross-project glance answering "what is apparat doing on my machine right now?" — VISION.md's named operator pain. This design ships seven items, of which steps 1-2 are the depth work the stimulus `deep-modules-hide-complexity` calls for and steps 3-7 are bundled feature scope the user accepted after the operator-payoff walkthrough: (1) unify the runId on the 8-char prefix via a new `newRunId()` helper in `src/cli/lib/apparat-paths.ts`; (2) route daemon-scheduled `pipeline run` invocations through the project-local tracer by injecting `--run-id` and `--logs-root` at `src/daemon/runner.ts:60-74`, leaving the home-global log as an orchestration breadcrumb that cross-links the project-local trace; (3) add `~/.apparat/projects.json` via a new `src/cli/lib/projects-registry.ts` module written best-effort on every `--project`-resolving CLI invocation; (4) add `apparat status` as a new top-level command listing per-project tasks + last runs; (5) fold `apparat heartbeat watch` into `apparat watch` as a single Ink app composing `HeartbeatPane` (renamed from the existing inner `WatchApp`) and `PipelineApp` as child components — *not* a shell-out facade, the deep-module-collapse the stimulus requires; (6) cross-link runId in `apparat heartbeat logs` output via daemon-authored synthetic `system`-stream lines; (7) document the partition in `CONTEXT.md` as the operator-global tier, mirroring ADR-0008's partition principle. Two breaking changes, both deliberate: daemon log runId on disk becomes 8-char (external scrapers of `~/.apparat/logs/<taskId>/<runId>.log` notice — old logs remain readable; new runs use the new shape), and `apparat heartbeat watch` collapses into `apparat watch` (deprecation alias preserved for one release with a stderr notice). No new tracer fields, no new daemon RPC, no agent rubric change, no schema migration of existing daemon logs. Blast radius is **M** — ~24 files (3 new modules + 2 new test files + 1 new command + ~17 edited) across daemon, CLI commands, CLI lib, TUI, tests, and docs. Sequencing defaults to a single PR; the implementer may split into a four-PR train (helper → daemon plumbing → registry+status → watch) if review bandwidth requires. The `apparat watch` composition is the load-bearing detail flagged in `chat_summarizer.refinements` bullet 4: a wrapper that re-shells one component re-introduces the fragmentation; reviewer should validate the resolution against the stimulus before approving.
