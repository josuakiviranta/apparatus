---
date: 2026-05-07
description: Run state is split across two homes that never converge — interactive runs land in `<project>/.apparat/runs/`, daemon-scheduled runs land in `~/.apparat/logs/<taskId>/`, with different runId schemes and inspection commands — and the solo human has no cross-project glance answering "what is apparat doing on my machine right now?".
---

## Core Idea

apparat persists run state in two disjoint locations that the rest of the CLI never reconciles. Interactive `apparat pipeline run` writes `<project>/.apparat/runs/<runId>/pipeline.jsonl` with rich engine events (`runs.ts:127`, `apparat-paths.ts:runDir`). Daemon-scheduled runs of the *same pipeline* write `~/.apparat/logs/<taskId>/<runId>.log` with line-buffered stdout/stderr only (`daemon/state.ts:51-58`, `daemon/runner.ts:runTask`). The runId schemes differ — `randomUUID().slice(0,8)` for interactive vs full UUID for the daemon — so a runId surfaced by `heartbeat logs` cannot be passed to `pipeline trace`. Inspection is split too: `pipeline trace` only reads project-local; `heartbeat logs` only reads home-global. A solo developer juggling many projects has no command that answers *"what is apparat running on my machine right now, and what failed since yesterday?"* — VISION's exact stated pain point.

## Why It Matters

Concrete drift:

- Daemon spawns a fresh `apparat run` subprocess (`daemon/runner.ts:74-92`) which creates *its own* `<project>/.apparat/runs/<runId8>/pipeline.jsonl` while the daemon also writes a *separate* `~/.apparat/logs/<taskId>/<runIdFull>.log`. Same physical execution, two parallel logs, two different IDs, no cross-link. The pipeline JSONL is the rich one (engine events, contextSnapshot, validation failures); the daemon log is the lossy one (stdout/stderr lines only). `heartbeat logs --follow meditate:my-app` will *miss* validator diagnostics emitted via the structured tracer because they go to the project-local JSONL, not stdout.
- `~/.apparat/` is the only home-global apparat directory, and it holds *daemon* state exclusively (`tasks.json`, `pids/`, `logs/`). There is no `~/.apparat/projects.json`, no recent-runs index, no `apparat status` command. The solo human's working-memory pain point — "which projects am I orchestrating?" — has no surface.
- `runId` truncation (`runs.ts:127` slices to 8 chars) trades collision risk for log-path readability. Daemon doesn't truncate. The collision space is 4 billion vs 2^128, but more importantly: the *user* sees two formats and doesn't know which command takes which.
- The daemon-scheduled flow loses the live PipelineApp Ink renderer entirely — it's stdout/stderr capture only. `heartbeat watch` (`HeartbeatWatch.tsx`) is a daemon-task TUI; `pipeline run` is a different Ink app. Two TUIs for the same kind of work, neither aware of the other.
- Cross-project failure search is impossible without `find ~ -name 'pipeline.jsonl' -newer ...`. The user with five active projects cannot answer "did janitor fail anywhere this week?" except by walking each project's runs dir by hand.

Strategic compass — VISION.md:

> "Managing many projects with many agents exceeds working memory. ... When it works, running a pipeline feels like delegating to someone who already understands the shape of the problem."

Today, apparat *is* the thing exceeding working memory at the cross-project layer. The agent-implements-the-task delegation is solved within one project; the operator-manages-many-projects delegation is not.

`stimuli/the-filesystem-as-agent-memory.md` reading: the filesystem is indeed the substrate — but apparat has split the substrate into two trees with no index. The librarian rebalance the stimulus describes hasn't happened: `~/.apparat/` should hold a thin global index pointing at project-local detail, not its own redundant log copy.

`stimuli/deep-modules-hide-complexity.md` reading: `JsonlPipelineTracer` already produces the canonical record. Daemon should *write to that one tracer* (via a `--logs-root` already exposed at `runs.ts:PipelineRunOptions.logsRoot`) instead of layering a second, lossier log. One seam, two callers — the deep-module collapse is right there.

## Revised Implementation Steps

1. **Unify the runId scheme.** Pick one (probably the 8-char prefix — daemon's full UUID is invisible to anyone but the daemon). Update `daemon/runner.ts:runTask` to use `randomUUID().slice(0,8)` so `heartbeat logs <id>` and `pipeline trace <id>` accept the same shape. Add a single helper in `apparat-paths.ts` so the truncation rule has one home.
2. **Make daemon-scheduled runs land in `<project>/.apparat/runs/<runId>/` like interactive runs.** Use the existing `--logs-root` option (`PipelineRunOptions.logsRoot`) when the daemon spawns `apparat pipeline run`. The daemon's `~/.apparat/logs/<taskId>/<runId>.log` keeps only the orchestration breadcrumb (start/end + exit code), not the duplicated stream. Single canonical run record, regardless of who launched it.
3. **Add a global project registry.** Every CLI invocation that resolves `--project <folder>` appends the absolute path to `~/.apparat/projects.json` (dedup + last-seen timestamp). Read-only on subsequent invocations. Three lines, zero schema migration. This is the index `~/.apparat/` is currently missing.
4. **Add `apparat status` (cross-project glance).** Walks `~/.apparat/projects.json`, lists for each: registered heartbeat tasks (from `daemon-client.request("list_tasks")`), the last 5 runs from `<project>/.apparat/runs/` with outcome from each `pipeline.jsonl`'s last `pipeline-end`, and the failing node id when present. One command answers the working-memory question VISION names.
5. **Fold `heartbeat watch` into a single `apparat watch`** that shows both daemon tasks and recently-finished runs from every registered project. The two TUIs (HeartbeatWatch, PipelineApp) can stay distinct on the inside; the *operator* sees one dashboard. Reuses the same project registry from step 3.
6. **Cross-link runId in trace output.** `apparat heartbeat logs <task>` should print, on each completed run, `→ apparat pipeline trace <runId> --project <folder>` so the operator pivots from daemon log to engine trace with one paste. Three lines in `heartbeat.ts:logs` after step 1 lands.
7. **Document the partition in `CONTEXT.md` §"Project-local layout".** Today the doc lists `.apparat/runs/` as project-local but is silent on `~/.apparat/`. Add a sibling subsection naming `~/.apparat/` as the *operator-global* tier (orchestration state only — tasks, pids, projects index) so the partition is explicit. Mirrors the ADR-0008 partition principle one level up.
