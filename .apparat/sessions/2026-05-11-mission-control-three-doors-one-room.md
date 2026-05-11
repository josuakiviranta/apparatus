---
date: 2026-05-11
run_id: illumination-to-implementation-09d3ed47
plan: docs/superpowers/plans/2026-05-11-mission-control-three-doors-one-room.md
design: docs/superpowers/specs/2026-05-11-mission-control-three-doors-one-room-design.md
illumination: .apparat/meditations/illuminations/2026-05-11T1510-mission-control-three-doors-one-room.md
test_result: pass
---

# Mission Control: three doors → one room

## What was implemented

Collapsed three mission-control verbs into one. `apparat status` now takes
positional zoom — `apparat status [project] [pipeline] [runId]` — leads with a
`running now:` block scanned across all projects, and every output ends with a
literal `zoom in: …` hint. `apparat watch` and `apparat pipeline list` are
deleted outright (no aliases). `PipelineApp` split into `<PipelineRunView>`
(live) + `<PipelineTraceView>` (read-only with `fs.watch` tail).

## Key files

NEW
- `src/cli/lib/mission-control.ts` — `MissionZoom` + `MissionState` + 4 projections (all / project / pipeline / run)
- `src/cli/lib/mission-control-render.ts` — 4 zoom-level formatters (info() emitters)
- `src/cli/lib/render-trace-view.ts` — Ink mount for `<PipelineTraceView>` driven by `renderRun`
- `src/cli/lib/pipeline-jsonl-tail.ts` — `fs.watch` tail adapter + line→event mapping
- `src/cli/components/PipelineRunView.tsx` — lifted live half of old `PipelineApp`
- `src/cli/components/PipelineTraceView.tsx` — read-only StaticItem renderer + live tail
- `src/cli/tests/{mission-control,status-command,pipeline-run-view,pipeline-trace-view,pipeline-jsonl-tail}.test.ts(x)`

MODIFIED
- `src/cli/commands/status.ts` — delegates to `mission-control` with positional zoom
- `src/cli/commands/pipeline/run.ts` — switched to `renderPipelineRunView`
- `src/cli/commands/pipeline.ts` — dropped `list` re-export
- `src/cli/lib/pipeline-resolver.ts` — comment swept of dead-verb references
- `src/cli/lib/replayTraceIntoApp.ts` — extracted `mapTraceLineToEvent` for tail-adapter reuse
- `src/cli/lib/runs-index.ts` — exports `summarizeRun(runsRoot, runId)`
- `src/cli/program.ts` — registers `status [project] [pipeline] [runId]`; drops `watch` + `pipeline list`
- `src/cli/components/HeartbeatWatch.tsx` — `heartbeat watch` shim no longer forwards to deleted `apparat watch`
- `README.md` — Mission Control section rewritten; `docs/superpowers/specs/2026-05-07-…` + `2026-05-08-…` marked superseded

DELETED
- `src/cli/commands/watch.ts`, `src/cli/components/WatchApp.tsx`, `src/cli/tests/watch-composition.test.tsx`
- `src/cli/commands/pipeline/list.ts`
- `src/cli/components/PipelineApp.tsx` + `src/cli/tests/PipelineApp.test.tsx`
- `src/cli/tests/pipeline-list-layer2.test.ts`, `pipeline-list-resolver-parity.test.ts`

## Decisions and patterns

- **Delete, don't alias.** User explicitly rejected the illumination's
  fallback step ("demote-to-aliases"); aliases re-introduce the verb names
  the simplification is trying to retire. Tracks ADR-0004 (source/CONTEXT
  as truth) and ADR-0002 ("location is the state" — terminal op is
  deletion, not gradual deprecation).
- **Positional zoom, zero flags.** Copy-paste continuation is the
  cognitive-ease lever; the literal `zoom in: …` hint at the bottom of
  every output is the contract. Modelled on the in-repo precedent
  `explain <pipeline> [nodeId]`.
- **Live runs in default view.** No `--live` toggle, no separate verb.
  `running now:` block scans `listAllRuns(runsDir(p.path))` across every
  project and filters on the existing `outcome: 'in-progress'` signal
  (`pipeline-end` absent in `pipeline.jsonl`).
- **Two views, one substrate.** `<PipelineRunView>` keeps `useInput` /
  SIGINT / `LiveFooter` / slash commands; `<PipelineTraceView>` is a
  StaticItem renderer that works over either a finished JSONL or an
  `fs.watch` tail without dragging in the live-side surface.
- **`heartbeat watch` shim survives but stops forwarding.** With top-level
  `watch` deleted, the shim's old "use `apparat watch` instead" pointer
  was broken — fixed by no longer forwarding.

## Gotchas and constraints

- **`pipeline-end` absence is the canonical live signal.** Confirmed at
  `runs-index.ts:59-60`. Future readers: do not invent a separate
  "is-running" flag; the absence is the truth.
- **Trace-view tail adapter is a true add.** No prior `fs.watch` of
  `pipeline.jsonl` existed in the tree (`pipeline-jsonl-tail.ts` is net
  new). Don't grep for prior tail code — there isn't any.
- **5 Claude-spawning scenarios silently skip in tester.** Out of 15
  scenarios, only 5 ran during tmux verification. The hard rule "must
  skip Claude sessions" leaves agent= node coverage to live runs only.
- **Two prior specs marked superseded, not deleted.** `2026-05-07
  pipeline-mission-control-fragmentation-design` and `2026-05-08
  pipeline-list-hides-half-the-roster-design` stay on disk with a
  superseded note; future doc passes should treat them as historical.

## Final verification

- test_result: pass
- test_summary: Cycle 1 clean: 1468 unit/integration tests pass in 15.27s. 5 of 15 scenarios INCLUDED (10 skipped because they invoke Claude per hard rule — must skip Claude sessions); all 5 included PASS. Live exercise of new `apparat status` shows level:all + level:project with running-now block, zoom-in hint, and `running now:` surfacing this very pipeline. Deleted `apparat watch` + `apparat pipeline list` correctly return exit 1 with `unknown command`. No fixes needed.
