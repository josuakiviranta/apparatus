---
date: 2026-05-11
description: apparat status, watch, and pipeline list [name] all answer "what is apparat doing/what did it do?" with three shallow projections over the same substrate — collapse to one mission-control state module with zoom levels (project, live) so adding a field doesn't touch three renderers.
---

## Core Idea

Three commands — `apparat status`, `apparat watch`, `apparat pipeline list [name]` — answer the same operator question: *what is apparat doing, and what did it just do?* Each stitches its own slice of `projects.json` + `~/.apparat/runs/<runId>/pipeline.jsonl` + daemon `list_tasks` and renders with its own bespoke code path. The data layer has already deepened (`projects-registry.ts`, `runs-index.ts`, `pipeline-status.ts`, `daemon-client`) but the three verbs are shallow surfaces over it — adding one column (e.g. token spend per run, currently-running runId, failed-node name) means editing three renderers and three test files. The user-facing tax is cognitive: three verbs to remember, three almost-identical projections, none of which composes with the others.

## Why It Matters

Pulling on the steer (pipeline ergonomics + intuitive observability + deep modules): observability today fails the deep-module test in two places.

**1. Three shallow surfaces over one deep substrate.** `src/cli/commands/status.ts:32-58` reads `readProjects() + listTasksWithTimeout() + readLastRunOutcome(runsDir(p.path))` and prints a flat per-project block. `src/cli/components/WatchApp.tsx:18-37` reads `readProjects() + runsDir + readLastRunOutcome(runsRoot)` and feeds *one* selected project's last `pipeline.jsonl` into a replayed `PipelineApp`. `src/cli/commands/pipeline/list.ts:24-46` reads `listAllPipelines(project) + listRunsForPipeline(runsRoot, name)` and prints the project-scoped roster + runs table. Every overlap is hand-coded; the only thing they share is the substrate modules, not a single `getMissionControlState()` function. The 2026-05-07 `pipeline-mission-control-fragmentation` illumination deepened `pipeline list` alone — it never collapsed the cross-cutting surface.

**2. `PipelineApp` is doing live + replay duty.** `WatchApp` mounts the full live runner component just to feed a finished JSONL trace through `replayTraceIntoApp`. The component carries `useInput` SIGINT re-raise, `LiveFooter`, gate input, slash commands, TextInput — none of which apply to a finished run. The interface (`{ emit, done }`) looks small, but the implementation is wide enough that replay pulls in dead-weight state and no-op effects. That's shallow-reuse, not depth: callers have to fake an event stream into a live-runner shape to view history.

**3. Operator question coverage is uneven.** None of the three answers "what is running *right now*" cleanly: `status` shows `last run`, `watch` replays the *last finished* run (not the live one), `pipeline list <name>` shows recent-runs glyphs but doesn't tail. The in-progress (`…`) glyph in `runs-index.ts` exists but no UX wraps it with live tailing. A user wanting "is anything happening on my machine?" has to read three command outputs and infer.

This compounds with the vision: solo developer, many projects, many agents — the whole point is to *not* re-orient every session. Three doors into the same room is the opposite of that.

## Revised Implementation Steps

1. **Extract `src/cli/lib/mission-control.ts`** — one function `getMissionControlState({ scope: "all" | { project } })` returns `{ projects: ProjectEntry[], tasks: Task[] | "daemon-offline", runs: RunSummary[] (cross-project or one-project), currentlyRunning: RunSummary[] }`. Move the daemon-timeout pattern from `status.ts` into it. Make `runs-index.ts` re-exportable across scopes (it currently only walks one project's `runsDir`).

2. **Make `status` the canonical mission-control verb.** Add `--project <path>`, `--live`, `--pipeline <name>` filters. `apparat status` (no flags) = today's cross-project dump. `apparat status --project .` = the `pipeline list` Layer-1 + recent-runs table. `apparat status --live` = today's `WatchApp` rebuilt against the shared state module, with currently-running runs surfaced first.

3. **Demote `apparat watch` and `apparat pipeline list [name]` to thin aliases** that forward to `status --live` and `status --project --pipeline` respectively. Both already lean on the same substrate; the alias keeps muscle memory + scripts alive while collapsing the renderers. Mirrors the `apparat heartbeat watch → apparat watch` deprecation pattern already in use (see `2026-05-09-two-run-homes-no-cross-project-view.md`).

4. **Split `PipelineApp` into `<PipelineRunView>` (live + interactive — Ctrl+C, gates, TextInput, slash commands) and `<PipelineTraceView>` (read-only StaticItem renderer).** Both consume the same `StaticItem` types from `pipelineEvents.ts`. `WatchApp` (now `status --live`) mounts `<PipelineTraceView>` for finished runs. Live tailing of in-progress runs mounts `<PipelineTraceView>` with a JSONL `fs.watch` feed. The shared seam is the renderer, not the component.

5. **Add a `pipeline.jsonl` tailer adapter** (`src/cli/lib/replayTraceIntoApp.ts` already isolates the replay-into-emit pattern) so `getMissionControlState({ scope: "all" })` can label runs as `in-progress` and `--live` can stream them to the trace view. This closes the "what's running right now" gap without a new verb.

6. **Single test surface.** One `mission-control.test.ts` exercises the shared state module against fixtures; the three command tests collapse to thin shape-of-output assertions. The current `status.test.ts`, `watch.test.ts`, `pipeline-list-layer2.test.ts` triplet shrinks accordingly.

7. **README + CONTEXT.md** — collapse the three command paragraphs under one "Mission control" subsection. The current README has `status`, `watch`, and `pipeline list` in three non-adjacent sections — physical proximity in docs is itself an ergonomics signal.
