# Design: Collapse `status` + `watch` + `pipeline list` into one mission-control verb with positional zoom

**Date:** 2026-05-11
**Status:** draft (pending review)
**Originating illumination:** `.apparat/meditations/illuminations/2026-05-11T1510-mission-control-three-doors-one-room.md`

## 1. Motivation

Three verbs each answer half of *"what is apparat doing or what did it just do?"* and none of them surfaces work that is in flight right now.

- `apparat status` (`src/cli/commands/status.ts:31-58`) reads `readProjects()` + a 1500 ms `listTasksWithTimeout()` + `readLastRunOutcome(runsDir(p.path))` and prints a per-project block listing **only the last *finished* run** (`last run: ${last.runId} — ${last.outcome} at ${last.timestamp}` at `status.ts:52`). No way to spot a job in flight, no way to drill in.
- `apparat watch` (`src/cli/components/WatchApp.tsx:13-69`, registered at `src/cli/program.ts:246-250`) replays *one* selected project's last finished `pipeline.jsonl` through the full live `PipelineApp` (`WatchApp.tsx:52-62`). Tab cycles projects. There is no live tail of a currently-running pipeline — only a replay of the most recent completed trace.
- `apparat pipeline list [name]` (`src/cli/commands/pipeline/list.ts:17-47`, registered at `src/cli/program.ts:173-189`) lists bundled + local pipelines and, with a positional `<name>`, prints the per-pipeline runs table at `list.ts:75-93`.

Every overlap is hand-coded: each command stitches its own projection over `readProjects()` / `listAllRuns()` / `request("list_tasks")` / `readLastRunOutcome()`. The 2026-05-07 `pipeline-mission-control-fragmentation` work deepened `pipeline list` alone — the cross-cutting fragmentation across the three verbs survived. Adding one new field (cost, live runId, failed-node name) touches three renderers and three test files.

Two design defects compound the cognitive tax:

1. **`PipelineApp` does live + replay duty.** `WatchApp` mounts the full live runner just to drive a finished JSONL through `replayTraceIntoApp` (`WatchApp.tsx:52-62`). The component carries `useInput` SIGINT re-raise, `LiveFooter`, gate input, slash commands, TextInput (`PipelineApp.tsx:51-58`) — none of which apply to a finished run. Callers fake an event stream into a live shape just to view history.
2. **Operator question coverage is uneven.** None of the three commands cleanly answers *"is anything running right now?"* The `in-progress` outcome already exists in `src/cli/lib/runs-index.ts:59-60` (`if (!end) { … outcome: "in-progress" … }`), but no UX surfaces it. The user reads three command outputs and infers.

Strategic compass: `docs/VISION.md:9,15` ("A personal harness for one developer ... One developer, one machine") and `docs/adr/0002-consume-only-illumination-lifecycle.md` ("location is the state") frame apparat as a single-operator tool where surface count *is* tax. The chat refinement supersedes the illumination's step-3 demote-to-aliases plan ("Aliases re-introduce verbs the user wants to forget") and step-2/5 flag interface ("paste apparat status command in terminal and add copy paste project name after it … cognitive ease because I don't have to remember"). Liveness becomes a property of the zoom target, not a flag on the command ("if the goal is to simplify commands why apparat status can't list live pipeline runs?").

## 2. Decision Summary

1. **Collapse to one verb with positional zoom.** `apparat status [project] [pipeline] [runId]` — optional positional chain, modelled on the in-repo `explain <pipeline> [nodeId]` precedent at `src/cli/program.ts:221`. No flags (`--project`, `--live`, `--pipeline` all rejected). Each token paste deepens the zoom by one level.

2. **Delete `apparat watch` and `apparat pipeline list` outright — no aliases.** Drop both Commander registrations at `src/cli/program.ts:245-250` and `:173-189`. Drop the source modules `src/cli/commands/watch.ts`, `src/cli/commands/pipeline/list.ts`, and `src/cli/components/WatchApp.tsx`. Per chat refinement rationale: aliases re-introduce verbs the user wants to forget; supersedes illumination step 3.

3. **Default render leads with a `running now` block.** Scan every registered project's `listAllRuns(runsDir(p.path))` (`runs-index.ts:76`) and filter on the existing `outcome === "in-progress"` signal (`runs-index.ts:59-60`). One O(projects) walk, no new infra. Block omitted when no live runs exist.

4. **Every render ends with a literal `zoom in:` hint line** containing the exact next-deeper command to copy-paste. Each level shows the next zoom token:
   - `status` (no args) → `zoom in: apparat status <projectPath>`
   - `status <project>` → `zoom in: apparat status <projectPath> <pipelineName>`
   - `status <project> <pipeline>` → `zoom in: apparat status <projectPath> <pipelineName> <runId>`
   - `status <project> <pipeline> <runId>` → no zoom hint (leaf).

5. **Auto-tail on zoom.** When the zoom target has an in-progress run, render auto-tails the live `pipeline.jsonl`. Otherwise the view is static. Liveness is a property of the target, not a flag — direct expression of the no-`--live` refinement.

6. **Split `PipelineApp` into `<PipelineRunView>` (live + interactive) and `<PipelineTraceView>` (read-only `StaticItem` renderer).** Both consume the existing `StaticItem` types in `src/cli/components/PipelineApp.tsx:30-38`. `<PipelineTraceView>` mounts for finished runs and for live tailing of in-progress runs via an `fs.watch` JSONL adapter; `<PipelineRunView>` keeps the `useInput`, `LiveFooter`, `useApp`, slash-command surface for actually running pipelines (the `run.ts` path).

7. **Shared state module `src/cli/lib/mission-control.ts`.** One function `getMissionControlState(zoom)` returns the projected state for each zoom level. Three hand-coded projections collapse into one.

8. **Rewrite the broken `heartbeat watch` deprecation pointer at `src/cli/commands/heartbeat.ts:295-300`** to drop the dangling reference to the deleted `apparat watch` verb. Replace pointer with `apparat status`. The `heartbeat watch` shim itself is preserved (separate decision; out of scope here).

9. **Live-tail terminates on `pipeline-end`.** When the leaf-zoom view auto-tails an in-progress run, the command exits 0 the moment the `pipeline-end` event arrives — no manual `q`/Ctrl+C. Decided here (was an open question in earlier drafts) because the contract is already asserted in §8 behavior invariants and consistency between the two sections matters for planning.

10. **One atomic landing.** Staging would create an interim state where `status` answers "what's running" but the deleted verbs still appear in help text, or where the renderer split lands without the new state module behind it. One PR.

## 3. Architecture

### 3.1 Before / after

```
Before                                          After
──────                                          ─────
apparat status                                  apparat status
  status.ts:31  per-project block,                status.ts (rewritten)
                last run only                      0. listAllProjects()
                                                   1. scan in-progress runs
                                                      across all projects
apparat watch                                      2. render `running now:` block
  WatchApp.tsx:52  PipelineApp +                   3. per-project last-run lines
                   replayTraceIntoApp              4. zoom in: apparat status
                   on last finished JSONL              <projectPath>
                                                 (no more `watch`)
apparat pipeline list                           apparat status <projectPath>
  list.ts:31  local + bundled rosters             status.ts renderProject(zoom)
  list.ts:21  per-name runs table                   pipelines roster + recent runs
                                                   zoom in: apparat status
                                                       <projectPath> <pipelineName>
                                                 (no more `pipeline list`)

(PipelineApp does live + replay)                apparat status <proj> <pipeline>
                                                  status.ts renderPipeline(zoom)
                                                   recent-runs table for pipeline
                                                   zoom in: apparat status
                                                       <proj> <pipeline> <runId>

                                                apparat status <proj> <pipeline> <runId>
                                                  status.ts renderRun(zoom)
                                                   PipelineTraceView mounts on
                                                   pipeline.jsonl;
                                                   if in-progress → fs.watch tail
                                                   else → static replay
                                                   no zoom-in line (leaf)
```

### 3.2 New module: `src/cli/lib/mission-control.ts`

Pure state projector — one entry point, one discriminated-union zoom argument, one read-only return shape per zoom level:

```ts
import type { ProjectEntry } from "./projects-registry.js";
import type { RunSummary } from "./runs-index.js";
import type { Task } from "../../daemon/state.js";
import type { PipelineEntry } from "./pipeline-resolver.js";

export type MissionZoom =
  | { level: "all" }
  | { level: "project";  projectPath: string }
  | { level: "pipeline"; projectPath: string; pipelineName: string }
  | { level: "run";      projectPath: string; pipelineName: string; runId: string };

export interface MissionStateAll {
  level: "all";
  projects: ProjectEntry[];
  runningNow: RunSummary[];                 // cross-project, outcome === "in-progress"
  lastRunPerProject: Record<string, RunSummary | null>;
  tasks: Task[] | "daemon-offline";
  zoomHint: string;                          // "apparat status <projectPath>" or ""
}
export interface MissionStateProject {
  level: "project";
  project: ProjectEntry;
  pipelines: PipelineEntry[];
  recentRuns: RunSummary[];                  // listAllRuns(runsDir(project.path))
  tasks: Task[] | "daemon-offline";          // filtered to this project
  zoomHint: string;
}
export interface MissionStatePipeline {
  level: "pipeline";
  project: ProjectEntry;
  pipeline: PipelineEntry;
  runs: RunSummary[];                        // listRunsForPipeline(...)
  liveRun: RunSummary | null;
  zoomHint: string;
}
export interface MissionStateRun {
  level: "run";
  project: ProjectEntry;
  pipeline: PipelineEntry | null;            // pipeline may be resolvable from run
  run: RunSummary;
  tracePath: string;                         // <project>/.apparat/runs/<runId>/pipeline.jsonl
  isLive: boolean;                           // run.outcome === "in-progress"
  zoomHint: "";                              // leaf
}
export type MissionState =
  | MissionStateAll
  | MissionStateProject
  | MissionStatePipeline
  | MissionStateRun;

export async function getMissionControlState(zoom: MissionZoom): Promise<MissionState>;
```

The module owns the daemon-timeout pattern presently inlined at `status.ts:13-29` (lift verbatim — same `DAEMON_TIMEOUT_MS = 1500`, same `ListTasksResponse` shape). It owns the in-progress scan: a tight loop over `readProjects()` calling `listAllRuns(runsDir(p.path))` (`runs-index.ts:76`) and filtering on `outcome === "in-progress"`. It owns the zoom-hint string — formatting concentrated in one place.

Three hand-coded projections (`status.ts:39-56`, `WatchApp.tsx:13-69`, `list.ts:17-47`) collapse into one composable read. Per-zoom-level read, *not* a single fat state — the type discriminates on `level` so consumers and tests stay narrow.

### 3.3 Rewritten `src/cli/commands/status.ts`

```ts
// src/cli/commands/status.ts (sketch — full rewrite)
import { getMissionControlState } from "../lib/mission-control.js";
import { renderAll, renderProject, renderPipeline, renderRun }
  from "../lib/mission-control-render.js";
import * as output from "../lib/output.js";

export interface StatusOptions { project?: string; pipeline?: string; runId?: string }

export async function statusCommand(args: {
  project?: string; pipeline?: string; runId?: string;
}): Promise<void> {
  const zoom = resolveZoom(args);
  const state = await getMissionControlState(zoom);
  switch (state.level) {
    case "all":      await renderAll(state); break;
    case "project":  await renderProject(state); break;
    case "pipeline": await renderPipeline(state); break;
    case "run":      await renderRun(state); break;
  }
}
```

Positional registration in `program.ts:238-243`:

```ts
program
  .command("status [project] [pipeline] [runId]")
  .description("Mission control: in-progress runs, project rosters, pipeline runs, run traces — zoom by appending the next token")
  .action(async (project: string | undefined, pipeline: string | undefined, runId: string | undefined) => {
    await statusCommand({ project, pipeline, runId });
  });
```

Optional-positional chain modelled on `explain <pipeline> [nodeId]` at `program.ts:221`. Commander v12 accepts the chain natively — `status.ts:239` (`.command("status")`) already registers with zero positionals, so the substrate is clean.

### 3.4 Render shapes

Each render ends with a `zoom in:` line when not at the leaf. The literal-paste promise: copy the previous command, paste the next-token name shown immediately above.

**Level: all (no args)** — leads with `running now:` when any project has an in-progress run:

```text
Apparat status — 3 project(s)

running now:
  /Users/josu/foo  illumination-to-implementation  09d3ed47  started 18:32  (5m)
  /Users/josu/bar  janitor                         12abcd34  started 18:35  (2m)

  /Users/josu/foo
    last seen: 5/11/2026, 6:14:23 PM
    heartbeat tasks: meditate:foo, implement:foo
    last run: 09d3ed47 — success at 2026-05-11T17:55Z

  /Users/josu/bar
    last seen: 5/11/2026, 6:09:01 PM
    heartbeat tasks: (none)
    last run: (no runs yet)

zoom in: apparat status /Users/josu/foo
```

When no projects have in-progress runs, the `running now:` block is omitted entirely (no `(none)` placeholder — its absence is itself the signal).

**Level: project (one arg)** — pipelines roster + recent cross-pipeline runs:

```text
/Users/josu/foo — pipelines

  illumination-to-implementation  "Triage an illumination …"
  janitor                         "Sweep the runs/ folder"
  meditate                        "One-shot meditation"

recent runs:
  …  09d3ed47  illumination-to-implementation  18:32  (in-progress)
  ✓  ab123456  meditate                       17:55  (1.2s)
  ✗  77777777  janitor                        17:01  (0.4s) failed at: scan

zoom in: apparat status /Users/josu/foo illumination-to-implementation
```

The roster is `listAllPipelines(project)` (`src/cli/lib/pipeline-resolver.ts`). The runs table is `listAllRuns(runsDir(project.path))` (`runs-index.ts:76`).

**Level: pipeline (two args)** — per-pipeline runs table:

```text
/Users/josu/foo / illumination-to-implementation

recent runs:
  …  09d3ed47  18:32  (in-progress)
  ✓  ab123456  17:55  (1.2s)
  ✗  77777777  17:01  (0.4s) failed at: scan

zoom in: apparat status /Users/josu/foo illumination-to-implementation 09d3ed47
```

Reuses `listRunsForPipeline(runsRoot, name)` at `runs-index.ts:96-98`.

**Level: run (three args)** — auto-tail or static replay:

```text
/Users/josu/foo / illumination-to-implementation / 09d3ed47

(PipelineTraceView mounts pipeline.jsonl; live tail if in-progress, otherwise static)
```

Leaf — no `zoom in:` line.

### 3.5 PipelineApp split

`src/cli/components/PipelineApp.tsx` today owns both the live runner and the replay viewer. The split is along the `StaticItem` boundary already drawn at `PipelineApp.tsx:30-38`:

- **`src/cli/components/PipelineRunView.tsx` (new):** lifts the live half — `useInput` (SIGINT, gate input, slash commands), `LiveFooter`, `useApp().exit`, `TextInput` (`PipelineApp.tsx:51-58`), the live `inputBuffer`/`liveBlockIdRef`/`liveBodyCountRef` machinery. Consumed by the actual run path (`src/cli/commands/pipeline/run.ts`) and the in-session `implement` / `meditate` callers.

- **`src/cli/components/PipelineTraceView.tsx` (new):** lifts the read-only renderer — the `StaticItem` array, the `BodyLineView` / `StreamLine` / `BlockCloseView` mounts (`PipelineApp.tsx:30-48`). Accepts either a finished `pipeline.jsonl` (replay) or a live one (auto-tail). No `useInput`, no footer, no exit handling — the parent (`status`) owns those.

- **JSONL tail adapter (new):** `src/cli/lib/pipeline-jsonl-tail.ts`. Uses `fs.watch(tracePath, …)` to detect appends, parses new lines into the same `NodeEvent` shape `replayTraceIntoApp` already emits (`src/cli/lib/replayTraceIntoApp.ts`). Reuses `replayTraceIntoApp`'s line→event mapping (no duplicate parser).

`PipelineApp.tsx` itself can be deleted once both consumers migrate, or kept as a thin facade that mounts `PipelineRunView`. Default: delete to avoid dead surface, since the chat refinement endorses deletion-over-alias.

### 3.6 Data flow

```
apparat status                                  (zoom = {level: "all"})
  → statusCommand
    → getMissionControlState({ level: "all" })
        readProjects()                          src/cli/lib/projects-registry.ts:16
        listTasksWithTimeout()                  lifted from status.ts:13-29
        for each project:
          listAllRuns(runsDir(p.path))          src/cli/lib/runs-index.ts:76
          filter outcome === "in-progress"      runs-index.ts:59-60
          readLastRunOutcome(runsDir(p.path))   src/cli/lib/pipeline-status.ts:17-66
    → renderAll: header, running-now block, per-project blocks, zoom-in line

apparat status <projectPath>                    (zoom = {level: "project", projectPath})
  → getMissionControlState({ level: "project", … })
        find project in readProjects()
        listAllPipelines(project.path)          src/cli/lib/pipeline-resolver.ts
        listAllRuns(runsDir(project.path))      runs-index.ts:76
        listTasksWithTimeout() → filter args.includes(project.path)
    → renderProject: pipelines roster, recent runs, zoom-in line

apparat status <projectPath> <pipelineName>     (zoom = {level: "pipeline", …})
  → getMissionControlState({ level: "pipeline", … })
        resolve pipeline via listAllPipelines() match
        listRunsForPipeline(runsDir(...), name) runs-index.ts:96-98
        find liveRun = runs.find(r => r.outcome === "in-progress")
    → renderPipeline: runs table, zoom-in line

apparat status <projectPath> <pipelineName> <runId>   (zoom = {level: "run", …})
  → getMissionControlState({ level: "run", … })
        resolve project + pipeline as above
        summarize(runId, join(runsDir, runId))  runs-index.ts:48-74
        tracePath = join(runsDir, runId, "pipeline.jsonl")
        isLive = run.outcome === "in-progress"
    → renderRun:
        mount <PipelineTraceView tracePath isLive />
        isLive ? pipeline-jsonl-tail.ts feeds events
               : replayTraceIntoApp.ts feeds events (static)
```

Heartbeat-task project filter (`tasks.filter(t => t.args.includes(p.path))`) is preserved verbatim from `status.ts:42` — same matcher, same path-substring semantics. No new daemon endpoint; one `request("list_tasks")` call per command invocation.

### 3.7 Resolution & error handling

- **Unknown project token:** `getMissionControlState({ level: "project", projectPath })` rejects when no entry in `readProjects()` matches. `statusCommand` writes a single-line error to stderr (`project not registered: <token> (apparat status to see roster)`) and exits 1.
- **Unknown pipeline token:** same shape — `pipeline not found: <token> (apparat status <projectPath> to see roster)`.
- **Unknown runId token:** `summarize(runId, …)` already returns an `outcome: "crashed"` `RunSummary` with `startedAt: null` when `pipeline.jsonl` is missing (`runs-index.ts:50-51,54-55`). `renderRun` interprets that as "no such run" and emits the same error/exit-1 path.
- **Daemon offline:** `listTasksWithTimeout()` already returns `null` (`status.ts:24-26`); state module returns `tasks: "daemon-offline"`; the heartbeat line renders `(daemon offline)` exactly as today (`status.ts:46-50`).
- **Open deferral — global-unique runId shortcut:** `apparat status <runId>` skipping project+pipeline tokens. Default *no*; chat-summarizer flagged for design-writer. Decision below: not implemented in this design. Commander cannot disambiguate `<runId>` from `<projectPath>` at the first positional slot without a flag or a guessing heuristic — both violate the "no flags, no memorization" rationale. If wanted later, add a separate `apparat status --run <runId>` shortcut; not a blocker now.

### 3.8 `heartbeat watch` pointer rewrite

`src/cli/commands/heartbeat.ts:294-300` registers `hb.command("watch")` as a deprecation shim. Today's description points at `apparat watch` (also broken once `apparat watch` is deleted). The shim itself stays (a separate file's lifecycle); only the description-line wording flips to `apparat status` so the message keeps pointing at something that exists:

```ts
hb
  .command("watch")
  .description("Open a live TUI dashboard showing all tasks and streaming output (deprecated — see `apparat status`)")
  .action(async () => {
    const { renderWatch } = await import("../components/HeartbeatWatch");
    await renderWatch();
  });
```

The corresponding `src/cli/tests/watch.test.ts:13-18` deprecation-message assertion is deleted alongside the `apparat watch` verb removal; the `heartbeat watch` shim has its own test elsewhere — that test's expected description string is updated to match.

### 3.9 Surfaces unchanged

- `pipeline.jsonl` event shape, including the `pipeline-end` event at `src/attractor/tracer/jsonl-pipeline-tracer.ts:51-58`. Read-only consumer.
- `runs-index.ts` API (`listAllRuns`, `listRunsForPipeline`, `RunSummary`). New caller, no behavior change.
- `projects-registry.ts` API. New caller, no behavior change.
- Daemon `Task` shape and `list_tasks` action. No new endpoints, read-only consumer.
- `apparat pipeline {run,trace,show,validate,explain}`, `heartbeat *`, `meditate`, `implement`, `init`. Unchanged.
- Pipeline `.dot` syntax, agent rubric, prompt assembly. Unchanged.
- Run path (`src/cli/commands/pipeline/run.ts`) continues to mount the live renderer — now `<PipelineRunView>`. The behavior delta is internal: same `useInput`/`LiveFooter`/exit semantics, smaller component.

### 3.10 Files-touched buckets

| Bucket | Files | Treatment |
|---|---|---|
| Mission-control state | `src/cli/lib/mission-control.ts` | **New** — `getMissionControlState(zoom)` + the `MissionZoom`/`MissionState` discriminated unions |
| Mission-control render | `src/cli/lib/mission-control-render.ts` | **New** — `renderAll`, `renderProject`, `renderPipeline`, `renderRun`. Pure formatters over `MissionState`; zero IO |
| Status command | `src/cli/commands/status.ts` | **Rewritten** — positional `[project] [pipeline] [runId]`, delegates to mission-control |
| Status registration | `src/cli/program.ts:238-243` | Inline edit — three optional positionals, updated description, help text |
| Watch verb | `src/cli/commands/watch.ts` | **Deleted** |
| Watch UI | `src/cli/components/WatchApp.tsx` | **Deleted** |
| Watch registration | `src/cli/program.ts:13,245-250` | Inline edit — drop import, drop `program.command("watch")` block |
| Runs-index export | `src/cli/lib/runs-index.ts:48-74` | Inline edit — export `summarize` (or add `summarizeRun(runsRoot, runId)` wrapper) so `mission-control.ts` can resolve a single run by id |
| Pipeline-list verb | `src/cli/commands/pipeline/list.ts` | **Deleted** |
| Pipeline-list registration | `src/cli/program.ts:8,173-189` | Inline edit — drop import, drop `pipeline.command("list [name]")` block |
| Help text | `src/cli/program.ts:41,47,84` | Inline edit — drop `apparat heartbeat watch` deprecated-alias line, drop the `pipeline list` examples row, drop the "Cross-project status" `apparat watch` line; rewrite under one "Mission control" subsection |
| Heartbeat watch pointer | `src/cli/commands/heartbeat.ts:295-300` | Inline edit — description string flips `apparat watch` → `apparat status` |
| PipelineApp split | `src/cli/components/PipelineRunView.tsx` | **New** — live + interactive renderer |
| | `src/cli/components/PipelineTraceView.tsx` | **New** — read-only `StaticItem` renderer |
| | `src/cli/components/PipelineApp.tsx` | **Deleted** (or kept as a thin re-export of `PipelineRunView` if too many call-sites need migration in one commit; default delete — confirm during implementation) |
| JSONL tail adapter | `src/cli/lib/pipeline-jsonl-tail.ts` | **New** — `fs.watch` + line→event mapping |
| Tests — new | `src/cli/tests/mission-control.test.ts` | **New** — covers all four zoom levels against fixtures |
| | `src/cli/tests/pipeline-run-view.test.tsx` | **New** — port of relevant `PipelineApp.test.tsx` cases that exercise the live half |
| | `src/cli/tests/pipeline-trace-view.test.tsx` | **New** — replay + tail behavior |
| Tests — deleted | `src/cli/tests/watch.test.ts` | **Deleted** |
| | `src/cli/tests/watch-composition.test.tsx` | **Deleted** |
| | `src/cli/tests/pipeline-list-layer2.test.ts` | **Deleted** |
| | `src/cli/tests/pipeline-list-resolver-parity.test.ts` | **Deleted** |
| Tests — migrated | `src/cli/tests/pipeline.test.ts:354-421` | Inline edit — drop `pipelineListCommand` assertions; replace with `statusCommand` assertions for the equivalent zoom levels |
| | `src/cli/tests/pipeline-preflight.test.ts:119` | Inline edit — drop `pipeline-list` references; the preflight check itself is unaffected |
| | `src/cli/tests/PipelineApp.test.tsx` | Inline edit — split cases between the two new files; delete the file when empty |
| | `src/cli/tests/pipeline-app-integration.test.tsx` | Inline edit — update imports to `PipelineRunView`; assertions unchanged |
| | `src/cli/tests/LiveFooter.test.tsx` | No edit — `LiveFooter` itself unchanged |
| | `src/cli/tests/pipeline-headless.test.ts` | Inline edit if it mounts `PipelineApp` directly — switch to `PipelineRunView`; assertions unchanged |
| Docs | `README.md:97,112,114` | Inline edit — rewrite under one **Mission control** subsection covering `apparat status` positional zoom; drop `apparat watch` and `apparat pipeline list` references |
| | `CONTEXT.md` | Cosmetic edit only if any line mentions the deleted verbs (grep) |

### 3.11 LOC sanity check

| File | Approx LOC after change |
|---|---|
| `src/cli/lib/mission-control.ts` (new) | ~180 (one state projector + types) |
| `src/cli/lib/mission-control-render.ts` (new) | ~140 (four formatters) |
| `src/cli/commands/status.ts` (rewritten) | ~50 (was 58 — thin shim now) |
| `src/cli/components/PipelineRunView.tsx` (new) | ~220 (live half of today's 400-line PipelineApp) |
| `src/cli/components/PipelineTraceView.tsx` (new) | ~120 (static-renderer half) |
| `src/cli/lib/pipeline-jsonl-tail.ts` (new) | ~70 (`fs.watch` + parser reuse) |
| `src/cli/components/WatchApp.tsx` (deleted) | −74 LOC |
| `src/cli/commands/watch.ts` (deleted) | −7 LOC |
| `src/cli/commands/pipeline/list.ts` (deleted) | −114 LOC |
| `src/cli/components/PipelineApp.tsx` (deleted) | −400ish LOC (replaced by two narrower views) |
| `src/cli/program.ts` (edited) | −15 LOC (two registrations + help text gone, one positional added) |
| Test files (new − deleted) | net roughly flat |
| **Net new code** | small net add (~+200 LOC) — most of the new code is moved-and-narrowed from the deleted modules |

## 4. Components & file edits

### 4.1 `src/cli/lib/mission-control.ts` (new)

Owns the cross-projection. Each zoom level is a separate code path inside one function so callers branch on the discriminated `level` field. No shared "fat state" — the absence of cross-level fields keeps each level's surface minimal.

```ts
import { existsSync } from "fs";
import { join } from "path";
import { readProjects, type ProjectEntry } from "./projects-registry.js";
import { listAllRuns, listRunsForPipeline, type RunSummary } from "./runs-index.js";
import { readLastRunOutcome } from "./pipeline-status.js";
import { listAllPipelines, type PipelineEntry } from "./pipeline-resolver.js";
import { runsDir } from "./apparat-paths.js";
import { request } from "../../lib/daemon-client.js";
import type { Task } from "../../daemon/state.js";

const DAEMON_TIMEOUT_MS = 1500;

interface ListTasksResponse { type: "tasks"; data: Task[] }

async function listTasksWithTimeout(): Promise<Task[] | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), DAEMON_TIMEOUT_MS);
    request("list_tasks")
      .then((res) => { clearTimeout(timer);
        const r = res as ListTasksResponse; resolve(r?.data ?? []);
      })
      .catch(() => { clearTimeout(timer); resolve(null); });
  });
}

export type MissionZoom = /* see §3.2 */;
export type MissionState = /* see §3.2 */;

export async function getMissionControlState(zoom: MissionZoom): Promise<MissionState> {
  switch (zoom.level) {
    case "all":      return projectAll();
    case "project":  return projectOne(zoom.projectPath);
    case "pipeline": return projectPipeline(zoom.projectPath, zoom.pipelineName);
    case "run":      return projectRun(zoom.projectPath, zoom.pipelineName, zoom.runId);
  }
}
```

`projectAll()` runs the daemon RPC and the cross-project in-progress scan in parallel (`Promise.all`). The scan is `readProjects().map(p => listAllRuns(runsDir(p.path)).filter(r => r.outcome === "in-progress"))` flattened. Today's per-project last-run line (`status.ts:51-55`) is preserved verbatim via `readLastRunOutcome`.

`projectOne()` validates the projectPath against `readProjects()`, then composes `listAllPipelines(project.path)` + `listAllRuns(runsDir(project.path))` + filtered tasks.

`projectPipeline()` matches `listAllPipelines(project.path)` on `e.name === pipelineName`, then `listRunsForPipeline(runsDir(project.path), pipelineName)`. The live-run pointer is `runs.find(r => r.outcome === "in-progress") ?? null`.

`projectRun()` resolves the run via `summarize(runId, join(runsDir(project.path), runId))` — `summarize` is today a private helper at `src/cli/lib/runs-index.ts:48-74`; the implementation adds one `export` (or a `summarizeRun(runsRoot, runId)` wrapper) so `mission-control.ts` can call it without duplicating the JSONL walk. Same parser path the current Layer-2 view at `list.ts:75-93` uses indirectly through `listRunsForPipeline`.

### 4.2 `src/cli/lib/mission-control-render.ts` (new)

Pure formatters. Each takes a `MissionStateX` and a writer (`output.info`); zero IO inside. The zoom-hint formatter is one helper:

```ts
function zoomHint(parts: string[]): string {
  return `zoom in: apparat status ${parts.join(" ")}`;
}
```

Tests assert the literal hint strings for each level (the user's "exact words to paste" promise is testable bytes).

### 4.3 Rewritten `src/cli/commands/status.ts` (full)

```ts
import { resolve } from "path";
import * as output from "../lib/output.js";
import { getMissionControlState, type MissionZoom } from "../lib/mission-control.js";
import {
  renderAll, renderProject, renderPipeline, renderRun,
} from "../lib/mission-control-render.js";

export interface StatusArgs {
  project?: string;
  pipeline?: string;
  runId?: string;
}

export async function statusCommand(args: StatusArgs = {}): Promise<void> {
  const zoom = toZoom(args);
  const state = await getMissionControlState(zoom);
  switch (state.level) {
    case "all":      await renderAll(state); break;
    case "project":  await renderProject(state); break;
    case "pipeline": await renderPipeline(state); break;
    case "run":      await renderRun(state); break;
  }
}

function toZoom(args: StatusArgs): MissionZoom {
  if (!args.project) return { level: "all" };
  const projectPath = resolve(args.project);
  if (!args.pipeline) return { level: "project", projectPath };
  if (!args.runId)    return { level: "pipeline", projectPath, pipelineName: args.pipeline };
  return { level: "run", projectPath, pipelineName: args.pipeline, runId: args.runId };
}
```

### 4.4 `src/cli/program.ts` (edited)

Three coordinated edits:

```ts
// drop these imports (top of file):
- import { pipelineListCommand } from "./commands/pipeline/list.js";
- import { watchCommand } from "./commands/watch.js";

// drop the pipeline.command("list [name]") block at :173-189
// drop the program.command("watch") block at :245-250
// drop the addHelpText lines mentioning `apparat watch` (:41,84)
//   and `pipeline list` (:47)
// rewrite the new help block to one "Mission control" subsection (see §4.5)

// update status registration (was :238-243):
program
  .command("status [project] [pipeline] [runId]")
  .description("Mission control — in-progress runs at the top; zoom in by appending the next token shown in the output")
  .addHelpText("after", `
Examples:
  apparat status                                # all projects + running now
  apparat status /Users/josu/foo                # one project: pipelines roster + recent runs
  apparat status /Users/josu/foo meditate       # one pipeline: runs table
  apparat status /Users/josu/foo meditate <id>  # one run: trace (auto-tails if in-progress)
`)
  .action(async (project, pipeline, runId) => {
    await statusCommand({ project, pipeline, runId });
  });
```

### 4.5 Help-text "Mission control" subsection

Replace the three current sections (`Background scheduling` mentions of `heartbeat watch` at `:41`, the `pipeline list` example at `:47`, the `Cross-project status` block at `:82-84`) with one consolidated:

```text
Mission control (one verb, zoom by appending tokens):
  apparat status                                # all projects, running-now block at top
  apparat status <projectPath>                  # zoom into one project's pipelines + recent runs
  apparat status <projectPath> <pipelineName>   # zoom into one pipeline's runs table
  apparat status <projectPath> <pipelineName> <runId>   # zoom into one run's trace
                                                # live tails if the run is in-progress
```

The exact wording is a chat-summarizer deferral ("README/CONTEXT 'Mission control' wording") — the line shape above is the design's recommendation; the implementing session can tighten phrasing without re-architecting.

### 4.6 `src/cli/components/PipelineRunView.tsx` (new)

Lifts the live half of `PipelineApp.tsx`:

- Props: `pipelineName, pid, goal?, nodes, runId, tracePath, onReady`. Same shape as today's `PipelineApp` (`PipelineApp.tsx:18-26`).
- Owns: `useApp`, `useInput`, `inputBuffer`, `liveBlockIdRef`, `liveBodyCountRef`, `frozenCountRef`, `blockSeqRef`, `traceAppendedRef`, `staticCloseSeen`, `doneDispatched`, `LiveFooter`, slash-command surface (`PipelineApp.tsx:50-90`+).
- Renders: `<Static>` + body lines + `<LiveFooter>` exactly as today.

### 4.7 `src/cli/components/PipelineTraceView.tsx` (new)

Lifts the read-only half:

- Props: `tracePath, runId, isLive`. No `onReady`, no `pid`, no nodes (derived from events).
- Owns: a `StaticItem[]` state seeded by either `replayTraceIntoApp` (static) or the new `pipeline-jsonl-tail` adapter (live).
- Renders: `<Static>` of `StaticItem`s using the existing `BodyLineView`, `StreamLine`, `BlockCloseView` (`PipelineApp.tsx:40-48`) — extracted to a tiny shared module if needed, or inlined.
- No `useInput`, no `useApp`, no `LiveFooter`, no `TextInput`. The parent (`status`) decides exit semantics — typically just printing to stdout and letting the process end naturally.

### 4.8 `src/cli/lib/pipeline-jsonl-tail.ts` (new)

```ts
import { existsSync, readFileSync, watch } from "fs";
import type { NodeEvent } from "./pipelineEvents.js";
import { mapTraceLineToEvent } from "./replayTraceIntoApp.js";  // existing line→event mapper

export interface TailHandle { stop(): void }

export function tailPipelineJsonl(
  tracePath: string,
  onEvent: (ev: NodeEvent) => void,
): TailHandle {
  let offset = 0;
  let pending = "";

  function readNew(): void {
    if (!existsSync(tracePath)) return;
    const text = readFileSync(tracePath, "utf8");
    if (text.length <= offset) return;
    const chunk = pending + text.slice(offset);
    offset = text.length;
    const lines = chunk.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const ev = mapTraceLineToEvent(line);
      if (ev) onEvent(ev);
    }
  }

  readNew();  // seed with whatever is already on disk
  const watcher = watch(tracePath, () => readNew());
  return { stop: () => watcher.close() };
}
```

`mapTraceLineToEvent` is the existing per-line parser inside `replayTraceIntoApp.ts` — extract it to module scope so the tail adapter can call it without duplicating the JSON-line → `NodeEvent` mapping. If extraction is non-trivial, the implementing session can inline the parser into the tail adapter and consolidate later; the design's invariant is *one* parser, not two.

## 5. Data flow

### 5.1 `apparat status` (no args, default)

```
apparat status
  → src/cli/commands/status.ts statusCommand({})
    → toZoom({}) → { level: "all" }
    → getMissionControlState({ level: "all" })
        readProjects()
        listTasksWithTimeout()                       (1500 ms, daemon-offline fallback)
        for each project:
          listAllRuns(runsDir(p.path))               in-progress filter
          readLastRunOutcome(runsDir(p.path))        last-finished outcome
    → renderAll(state):
        if state.runningNow.length > 0:
          output.info("running now:")
          for r in runningNow: output.info("  <projPath>  <pipeName>  <runId>  …")
        for project in projects:
          output.info("  <p.path>")
          output.info("    last seen: …")
          output.info("    heartbeat tasks: …")
          output.info("    last run: …")
        output.info("zoom in: apparat status <first-project.path>")
```

### 5.2 `apparat status <projectPath>`

```
apparat status /Users/josu/foo
  → toZoom → { level: "project", projectPath: "/Users/josu/foo" }
  → getMissionControlState:
        readProjects() — assert matching entry exists
        listAllPipelines(project.path)               local + bundled roster
        listAllRuns(runsDir(project.path))           all runs, all pipelines
        listTasksWithTimeout() → filter args.includes(project.path)
  → renderProject:
        header: "<project.path> — pipelines"
        roster lines (name + goal — reused from list.ts:95-113 renderEntry shape)
        "recent runs:" table (glyph + runId + pipeline + ts + duration)
        zoom in: apparat status <project.path> <first-pipeline.name>
```

### 5.3 `apparat status <projectPath> <pipelineName>`

```
apparat status /Users/josu/foo illumination-to-implementation
  → toZoom → { level: "pipeline", … }
  → getMissionControlState:
        listAllPipelines(project.path) — match e.name === pipelineName
        listRunsForPipeline(runsDir(project.path), pipelineName)
  → renderPipeline:
        header: "<projectPath> / <pipelineName>"
        runs table (same glyphs as `list.ts:83-91`)
        zoom in: apparat status <projectPath> <pipelineName> <newest-runId>
```

### 5.4 `apparat status <projectPath> <pipelineName> <runId>`

```
apparat status /Users/josu/foo illumination-to-implementation 09d3ed47
  → toZoom → { level: "run", … }
  → getMissionControlState:
        summarize(runId, join(runsDir(project.path), runId))
        tracePath = <runsRoot>/<runId>/pipeline.jsonl
        isLive   = run.outcome === "in-progress"
  → renderRun:
        mount <PipelineTraceView tracePath isLive />
          isLive ? tailPipelineJsonl(tracePath, onEvent)
                 : replayTraceIntoApp(tracePath, onEvent)
```

Leaf — no `zoom in:` line.

## 6. Blast radius / impact surface

- **Size:** **M.** Source: upstream verifier blast paragraph (Files touched ~28; surfaces crossed CLI commands / Ink components / lib / tests / docs) cross-checked against §3.10 above.
- **Files touched:** ~28 across:
  - **CLI commands:** `src/cli/commands/status.ts` (rewrite), `src/cli/commands/heartbeat.ts:295-300` (description rewrite). Deletes: `src/cli/commands/watch.ts`, `src/cli/commands/pipeline/list.ts`.
  - **Ink components:** `src/cli/components/PipelineRunView.tsx` (new), `src/cli/components/PipelineTraceView.tsx` (new). Deletes: `src/cli/components/WatchApp.tsx`, `src/cli/components/PipelineApp.tsx` (or kept as re-export).
  - **Lib:** `src/cli/lib/mission-control.ts` (new), `src/cli/lib/mission-control-render.ts` (new), `src/cli/lib/pipeline-jsonl-tail.ts` (new). Edits: `src/cli/lib/replayTraceIntoApp.ts` (extract `mapTraceLineToEvent` to module scope).
  - **Registration / help text:** `src/cli/program.ts` (drop two registrations, edit help text at `:41,47,84,178-180`, edit status registration at `:238-243`).
  - **Tests:** new (`mission-control.test.ts`, `pipeline-run-view.test.tsx`, `pipeline-trace-view.test.tsx`); deletes (`watch.test.ts`, `watch-composition.test.tsx`, `pipeline-list-layer2.test.ts`, `pipeline-list-resolver-parity.test.ts`); migrations (`pipeline.test.ts:354-421`, `pipeline-preflight.test.ts:119`, `PipelineApp.test.tsx`, `pipeline-app-integration.test.tsx`, `pipeline-headless.test.ts`).
  - **Docs:** `README.md:97,112,114` rewrite under one Mission control subsection; `CONTEXT.md` cosmetic only if grep surfaces deleted-verb mentions.
- **Surfaces crossed:** CLI commands, Ink components, lib (state + render + tail adapter), tests, docs.
- **Breaking changes (enumerated):**
  - [ ] **`apparat watch` verb deleted, no alias.** Broken contract: the help-text line at `program.ts:84` ("Live cross-project dashboard") and any user muscle memory. Mitigation: explicit chat-confirmed deletion-over-alias decision (rationale: aliases re-introduce verbs the user wants to forget). README + help text point at `apparat status`. No deprecation period.
  - [ ] **`apparat pipeline list` (and `apparat pipeline list <name>`) deleted, no alias.** Broken contract: scripts grepping `pipeline list` output and the `program.ts:47` example line. Mitigation: same rationale. `apparat status <projectPath>` (Layer-1 equivalent) and `apparat status <projectPath> <pipelineName>` (Layer-2 equivalent) cover both modes.
  - [ ] **`apparat status` no-arg output shape changes.** Same fields as today + a `running now:` block at top + a `zoom in:` line at bottom. Scripts that grep `status` output by exact byte shape will break. No mitigation flag — the chat refinement rejected `--brief`-style toggles ("if the goal is to simplify commands why apparat status can't list live pipeline runs?"). Single-operator, single-machine vision applies (no rollout cohort to coordinate).
  - [ ] **`heartbeat watch` description text references `apparat status` instead of `apparat watch`.** Internal-only — the existing test at `src/cli/tests/watch.test.ts` (the top-level one) is deleted; any `heartbeat-watch.test.ts` description-string assertion is updated to the new wording.
  - [ ] **`PipelineApp` component split (`PipelineRunView` + `PipelineTraceView`).** Internal break for 5 known consumers: `src/cli/commands/pipeline/run.ts` (switches to `PipelineRunView`), `src/cli/tests/PipelineApp.test.tsx` (split), `src/cli/tests/pipeline-app-integration.test.tsx` (`PipelineRunView`), `src/cli/tests/pipeline-headless.test.ts` (`PipelineRunView`), `src/cli/tests/LiveFooter.test.tsx` (unchanged — `LiveFooter` itself stable). Not externally visible.
- **Spec / docs ripple checklist:**
  - [ ] `README.md:97,112,114` rewrite under a `Mission control` subsection. Exact wording deferred per chat-summarizer.
  - [ ] `CONTEXT.md` cosmetic — grep for `apparat watch` and `pipeline list` references; if any, replace with `apparat status`.
  - [ ] No new ADR. Upstream verifier grounds this decision in ADR-0012 (cluster pattern) and ADR-0004 (`docs/adr/0004-source-and-context-as-truth.md` — "source is truth"); ADR-0002 ("location is the state — terminal operation is deletion, not gradual deprecation") covers the deletion-over-alias policy. Reusing existing principles, not coining new ones.
  - [ ] `docs/superpowers/specs/2026-05-07-pipeline-mission-control-fragmentation-design.md` is superseded for the cross-verb surface (`pipeline list` deepening is replaced by `apparat status <projectPath>`). Add a one-line "Superseded by 2026-05-11-mission-control-three-doors-one-room-design.md for the cross-verb surface" header.
  - [ ] `docs/superpowers/specs/2026-05-08-pipeline-list-hides-half-the-roster-design.md` — same supersession note.
- **Test ripple:**
  - [ ] **New:** `src/cli/tests/mission-control.test.ts` (state projector — all four levels, daemon-offline fallback, unknown-project / unknown-pipeline / unknown-run error paths, `running now` filter), `src/cli/tests/pipeline-run-view.test.tsx`, `src/cli/tests/pipeline-trace-view.test.tsx`.
  - [ ] **Deleted:** `src/cli/tests/watch.test.ts`, `src/cli/tests/watch-composition.test.tsx`, `src/cli/tests/pipeline-list-layer2.test.ts`, `src/cli/tests/pipeline-list-resolver-parity.test.ts`.
  - [ ] **Migrated:** `src/cli/tests/pipeline.test.ts:354-421` (`pipelineListCommand` cases → `statusCommand` zoom-level cases), `src/cli/tests/pipeline-preflight.test.ts:119` (drop `pipeline list` reference). `src/cli/tests/PipelineApp.test.tsx` cases split into the two new files; `src/cli/tests/pipeline-app-integration.test.tsx` and `src/cli/tests/pipeline-headless.test.ts` updated to mount `PipelineRunView`.

## 7. Trade-offs

### 7.1 Delete vs. alias

Aliases (illumination step 3) were rejected in chat round 1 with the exact rationale: *"Aliases re-introduce verbs the user wants to forget."* Project-fit grounded in `VISION.md:9,15` ("A personal harness for one developer ... One developer, one machine"), `CONTEXT.md:187-190` (janitor "KISS lens" against YAGNI), and `docs/adr/0002-consume-only-illumination-lifecycle.md` ("location is the state — terminal operation is deletion, not gradual deprecation"). One developer, one machine, no rollout cohort to coordinate. The `heartbeat watch` precedent commits (209929e / ebbb5c8 / fd609d8) used the same deprecation-alias pattern but flagged "Will be removed in a future release" — this design shortens that half-life to *now* for the same reasons.

The cost (script breakage, muscle memory) is real but bounded by the single-operator scope. Deferred only as an open question if a real consumer surfaces during review (§9).

### 7.2 Positional zoom vs. flags

Flags (illumination steps 2 + 5: `--project`, `--live`, `--pipeline`) were explicitly rejected: *"I like zoom in continuation commands like apparat status then if I want to zoom in to some project I would just paste apparat status command in terminal and add copy paste project name after it … cognitive ease because I don't have to remember multiple command names or flags."* Positional progression preserves copy-paste continuation; flags force the user to memorize names. Commander v12 supports the optional-positional chain natively (`explain <pipeline> [nodeId]` at `program.ts:221` is the in-repo precedent), so this is a substrate-fit change, not a workaround.

### 7.3 Always-on `running now` vs. `--live`

User rejected a live-mode toggle in chat round 1: *"if the goal is to simplify commands why apparat status can't list live pipeline runs?"* The `in-progress` outcome is already detected at `runs-index.ts:59-60`; surfacing it costs O(projects) on every `status` invocation, which is negligible. The block is omitted (no `(none)` placeholder) when empty, so the no-flag default stays terse.

### 7.4 Auto-tail on zoom vs. explicit verb

Liveness is a property of the zoom target, not the command. Confirmed by user in chat round 1 ("Confirmet"). The `<PipelineTraceView>` component decides — same renderer either way. Avoids the parallel `--live` / `--replay` flag tree.

### 7.5 PipelineApp split now vs. defer

The split was preserved from illumination step 4 and not pushed back on in chat ("implicit — not pushed back on; preserved from illumination step 4"). Cost: ~3 internal call-site updates and a test reshuffle. Benefit: auto-tail-on-zoom needs a renderer that works over either a finished JSONL or a live tail without dragging in `useInput` / `LiveFooter` / `TextInput`. Doing the split inline avoids a "thin wrapper that internally fakes a live shape" middle state — the same shallow-reuse the illumination called out as the existing problem.

### 7.6 Global-unique runId shortcut: defer

Chat-summarizer flagged `apparat status <runId>` (skipping project + pipeline tokens) as an open deferral with default "no". Decision here: not implemented. Commander cannot disambiguate `<runId>` from `<projectPath>` at the first positional slot — a hash-shape heuristic would re-introduce the "have to remember the shape" tax the design is trying to remove. A separate `--run <runId>` flag could be added later if a real need surfaces.

### 7.7 Atomic vs. staged

Staging would mean a window where `status` answers "what's running" but `apparat watch` and `apparat pipeline list` are still registered, or where `PipelineApp` is split but `WatchApp` still imports it. One developer, one machine — no rollout cohort. Land as one PR.

## 8. Constraints

- After the change:
  - `npx tsc --noEmit` passes.
  - `npx vitest run` passes — including new `mission-control.test.ts`, new `pipeline-{run,trace}-view.test.tsx`, migrated `pipeline.test.ts` + `pipeline-preflight.test.ts`, and the three view consumers (`pipeline-app-integration`, `pipeline-headless`, `LiveFooter`).
  - `apparat status` produces a `running now:` block when any registered project has an in-progress run, omits the block when none exist, and always ends with a `zoom in:` line.
  - `apparat status <projectPath>` resolves the project against `readProjects()`, prints pipelines roster + recent runs, ends with `zoom in:` showing the next pipeline token.
  - `apparat status <projectPath> <pipelineName>` prints the runs table from `listRunsForPipeline()`, ends with `zoom in:` showing the newest runId.
  - `apparat status <projectPath> <pipelineName> <runId>` renders `<PipelineTraceView>` over the run's `pipeline.jsonl`; auto-tails if in-progress, static otherwise; no `zoom in:` line.
  - `apparat watch --help` fails (unknown command). `apparat pipeline list --help` fails (unknown command).
- Repo-wide grep invariants post-merge:
  - `src/cli/commands/watch.ts` does not exist.
  - `src/cli/commands/pipeline/list.ts` does not exist.
  - `src/cli/components/WatchApp.tsx` does not exist.
  - `src/cli/program.ts` does not match `program.command("watch")` or `pipeline.command("list`.
  - `src/cli/lib/mission-control.ts` exists and exports `getMissionControlState`.
  - `src/cli/components/PipelineRunView.tsx` and `src/cli/components/PipelineTraceView.tsx` exist.
  - Help text contains the literal `Mission control` substring.
  - `src/cli/commands/heartbeat.ts` does not match `\`apparat watch\``.
- Behavior invariants:
  - `apparat status` issues at most one `request("list_tasks")` IPC call per invocation. Daemon-offline degrades to `"daemon-offline"` in state and `(daemon offline)` on the heartbeat-tasks line, never bumps exit code.
  - `apparat status <projectPath> <pipelineName> <runId>` on an in-progress run keeps the process alive only until the `pipeline-end` event arrives, then exits 0. (Live-tail terminates naturally; no manual `q`/SIGINT needed for finished runs.)
  - `PipelineRunView` retains today's exit semantics (`useApp().exit`, `useInput` Ctrl+C re-raise) — the run path's behavior is byte-identical from the operator's seat.

## 9. Open questions

- **`PipelineApp.tsx` delete vs. keep as re-export:** Default delete (per refinement's deletion-over-alias preference). If the 5 internal consumers can't all migrate in one PR cleanly, keep a thin `PipelineApp = PipelineRunView` re-export with `@deprecated` JSDoc and a follow-up commit to remove. Decided in implementation. **Delete criterion:** drop `PipelineApp.tsx` once `src/cli/tests/PipelineApp.test.tsx` is fully migrated (its cases split into `pipeline-run-view.test.tsx` + `pipeline-trace-view.test.tsx`) and `npx vitest run` is green without the old file.
- **`apparat status <runId>` shortcut:** Deferred per chat-summarizer ("default no, unless trivially supported"). Decided here: not supported. Reopen only on demonstrated need.
- **Project-token shape (absolute path vs. registered short name):** Today `readProjects()` stores absolute paths. The positional `<project>` token is `resolve()`d, so absolute or `.`-relative both work, but a project with a configured short alias would not. Out of scope — apparat has no project-alias system today; `cd $proj && apparat status .` is the recommended shorthand.
- **`zoom in:` wording:** The literal `zoom in: apparat status …` line is the design's recommendation. Final phrasing is the same chat-summarizer deferral as the README "Mission control" subsection. Implementing session can tighten; the contract is *literal copy-paste of the next command* on the last line of non-leaf renders.

## 10. Verification approach

### 10.1 Static checks

- `npx tsc --noEmit` — clean.
- Grep — invariants from §8 (no `commands/watch.ts`, no `commands/pipeline/list.ts`, no `WatchApp.tsx`, no `program.command("watch")`, no `pipeline.command("list`, presence of `Mission control` in help text, presence of `mission-control.ts`, `PipelineRunView.tsx`, `PipelineTraceView.tsx`).
- Grep — `request\("list_tasks"` post-merge: exactly two call sites — existing `src/cli/commands/heartbeat.ts` (heartbeat list/watch UIs) and new `src/cli/lib/mission-control.ts`. The old call at `src/cli/commands/status.ts:18` is gone.

### 10.2 Tests

- `npx vitest run src/cli/tests/mission-control.test.ts` — new, passes. Cases:
  - `level: "all"` with zero registered projects: returns empty `projects`, empty `runningNow`, `zoomHint === ""`.
  - `level: "all"` with one project, one in-progress run: `runningNow.length === 1`, `zoomHint` ends with that project's path.
  - `level: "all"` with daemon offline: `tasks === "daemon-offline"`.
  - `level: "project"` with unknown projectPath: rejects / returns sentinel; `statusCommand` writes error + exits 1.
  - `level: "pipeline"` with unknown pipelineName: same.
  - `level: "run"` with unknown runId: same.
  - `level: "run"` with in-progress run: `isLive === true`, `tracePath` exists.
  - `level: "run"` with finished run: `isLive === false`.
  - `zoomHint` strings match the literal formats in §3.4 byte-for-byte.
- `npx vitest run src/cli/tests/pipeline-trace-view.test.tsx` — replay path emits the same `StaticItem`s as today's `PipelineApp.test.tsx` replay cases; live-tail path appends new `StaticItem`s when fixture writes to the JSONL.
- `npx vitest run src/cli/tests/pipeline-run-view.test.tsx` — live SIGINT, gate input, slash commands, `LiveFooter` mount — ported from today's `PipelineApp.test.tsx`.
- `npx vitest run src/cli/tests/pipeline.test.ts` — passes after migrating the `:354-421` block to `statusCommand` zoom-level cases.
- `npx vitest run src/cli/tests/pipeline-preflight.test.ts` — passes after the `:119` `pipeline-list` reference is dropped.
- Full `npx vitest run` — passes.

### 10.3 Smoke

- `apparat status` with no registered projects — prints "No projects registered yet." (preserved from today's `status.ts:33-34`), no `running now:` block, no `zoom in:` line (no project to zoom into).
- `apparat status` with multiple projects, one of them running a pipeline — `running now:` block lists that run; `zoom in:` line points at a real project path that the user can copy.
- `apparat status <projectPath>` for a registered project — pipelines roster + recent runs + `zoom in:` next-pipeline hint.
- `apparat status <projectPath> <pipelineName>` for a known pipeline — runs table + `zoom in:` next-runId hint.
- `apparat status <projectPath> <pipelineName> <runId>` for a finished run — static `PipelineTraceView` replay; process exits 0 after rendering.
- `apparat status <projectPath> <pipelineName> <runId>` for an in-progress run — live tail of `pipeline.jsonl`; appends new blocks as the run advances; exits on `pipeline-end`.
- `apparat watch` — Commander error "unknown command". `apparat pipeline list` — same. (Sanity check that the deletions landed and no help text still advertises them.)
- `apparat heartbeat watch` — help text reads "(deprecated — see `apparat status`)".
- `apparat status` with the daemon stopped — heartbeat-tasks line says `(daemon offline)`; the rest renders normally; exits 0.

### 10.4 Negative cases

- `apparat status <nonexistent-project>` — `mission-control.ts` returns sentinel; `statusCommand` writes `project not registered: <token>` to stderr and exits 1. Does *not* fall through to a partial render.
- `apparat status <project> <nonexistent-pipeline>` — same shape: stderr error + exit 1.
- `apparat status <project> <pipeline> <nonexistent-runId>` — same shape (the `summarize()` "crashed-with-no-jsonl" outcome maps to the error path in `renderRun`).
- `apparat status <project> <pipeline> <runId>` where `pipeline.jsonl` is malformed (mid-line truncation) — `mapTraceLineToEvent` skips bad lines (already today's behavior in `replayTraceIntoApp.ts`); the trace renders what it can.
- Daemon socket missing, daemon refuses to spawn — `listTasksWithTimeout()` returns null within 1500 ms; `state.tasks === "daemon-offline"`; render continues. Listing must never exit non-zero on daemon trouble.
- In-progress run completes mid-tail — `tailPipelineJsonl` sees the `pipeline-end` line, emits it as a `NodeEvent`; `renderRun` decides to exit 0.

## 11. Summary

Three verbs (`apparat status` at `src/cli/commands/status.ts:31-58`, `apparat watch` at `src/cli/components/WatchApp.tsx:13-69`, `apparat pipeline list [name]` at `src/cli/commands/pipeline/list.ts:17-47`) each project a fragment of the same underlying substrate (`projects-registry` + `runs-index` + `pipeline-status` + daemon `list_tasks`), none of them surfaces in-flight runs, and `PipelineApp` (`src/cli/components/PipelineApp.tsx`) carries live-runner machinery into pure replay. This design collapses the surface to one verb — `apparat status [project] [pipeline] [runId]` — with positional zoom (modelled on `explain <pipeline> [nodeId]` at `program.ts:221`), a default `running now:` block that scans every project's `listAllRuns()` for `outcome === "in-progress"` (`runs-index.ts:59-60`), a literal `zoom in:` hint line on every non-leaf render so the next command can be copy-pasted, auto-tail on zoom (the `<PipelineTraceView>` renderer reads either a finished JSONL via `replayTraceIntoApp` or a live one via a new `fs.watch` adapter), and a clean split of `PipelineApp` into `<PipelineRunView>` (live + interactive) and `<PipelineTraceView>` (read-only StaticItem renderer). `apparat watch` and `apparat pipeline list` are deleted, not aliased — per the chat refinement's "aliases re-introduce verbs the user wants to forget" rationale, grounded in `VISION.md:9,15`, ADR-0002 ("location is the state — terminal operation is deletion"), and ADR-0004. A new `src/cli/lib/mission-control.ts` owns the cross-projection; the three hand-coded projections collapse into one. The `heartbeat watch` deprecation pointer at `src/cli/commands/heartbeat.ts:295-300` flips from the deleted `apparat watch` to `apparat status`. Blast radius is **M** — ~28 files across CLI commands, Ink components, lib, tests, and docs — with three deliberate breaking changes (no aliases for the deleted verbs; new `status` no-arg output shape; internal `PipelineApp` split). README rewrite under one **Mission control** subsection; CONTEXT.md cosmetic; no new ADR. Open deferrals: global-unique runId shortcut (not supported), `PipelineApp.tsx` delete-vs-thin-reexport, exact `zoom in:` wording — none block landing.
