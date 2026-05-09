---
date: 2026-05-09
run_id: cf417898
plan: docs/superpowers/plans/2026-05-09-two-run-homes-no-cross-project-view.md
design: docs/superpowers/specs/2026-05-09-two-run-homes-no-cross-project-view-design.md
illumination: .apparat/meditations/illuminations/2026-05-07T2037-two-run-homes-no-cross-project-view.md
test_result: pass
---

# Two run homes / no cross-project view — unified onto project-local tracer

## What was implemented

Daemon-scheduled pipeline runs now adopt the same 8-char runId scheme as interactive runs and write through the project-local `JsonlPipelineTracer` via injected `--run-id`/`--logs-root`. New `apparat status` command surfaces every project that ever ran `apparat pipeline run --project …` plus its registered heartbeat tasks; new `apparat watch` composes a single Ink dashboard, with `apparat heartbeat watch` retained as a deprecation alias. `~/.apparat/projects.json` is the operator-state index that backs both commands.

## Key files

- Created: `src/cli/lib/projects-registry.ts`, `src/cli/tests/projects-registry.test.ts`
- Created: `src/cli/commands/status.ts`, `src/cli/tests/status.test.ts`
- Created: `src/cli/commands/watch.ts`, `src/cli/components/WatchApp.tsx`, `src/cli/lib/replayTraceIntoApp.ts`
- Created: `src/cli/tests/watch.test.ts`, `src/cli/tests/watch-composition.test.tsx`, `src/cli/tests/replayTraceIntoApp.test.ts`
- Created: `src/cli/tests/pipeline-run-runid.test.ts`
- Created: `src/daemon/runner-args.ts`, `src/daemon/tests/runner-args.test.ts`, `src/daemon/tests/runner-augmentation.test.ts`
- Modified: `src/cli/lib/apparat-paths.ts` (`newRunId()` single source), `src/cli/tests/apparat-paths.test.ts`
- Modified: `src/cli/commands/pipeline/run.ts` (`--run-id`/`--logs-root` flags, opts.runId override)
- Modified: `src/cli/program.ts` (status + watch top-level registration)
- Modified: `src/cli/components/HeartbeatWatch.tsx` (deprecation forwarding)
- Modified: `src/daemon/runner.ts` (newRunId adoption + injectRunArgs + breadcrumb emit)
- Modified: `src/cli/tests/heartbeat.test.ts` (cross-link contract lock)
- Docs: `CONTEXT.md` operator-global tier paragraph; `README.md` status/watch commands; `docs/adr/0008-partial-revert-of-ralph-folder.md` operator-global tier paragraph

## Decisions and patterns

- **Single-source runId via `newRunId()`** in `apparat-paths.ts` — both interactive (`pipeline/run.ts`) and daemon (`runner.ts`) call it. Closes the half-built unification at engine seam (`fb4baaa`) that left daemon on full UUIDs.
- **Daemon stays a generic command runner** — `injectRunArgs` only augments the argv when the scheduled command is `apparat pipeline run`. Non-pipeline daemon tasks remain untouched.
- **Daemon log keeps only an orchestration breadcrumb** — heavy engine events flow through `JsonlPipelineTracer` into the project-local run dir; daemon stdout gets a one-line cross-link to the runId so `heartbeat logs` can deep-link into `apparat pipeline trace`.
- **`apparat watch` is a true compose, not a wrapper** — `WatchApp.tsx` renders a single Ink tree that consumes the same heartbeat-state hooks `HeartbeatWatch` did. The legacy `apparat heartbeat watch` forwards into the same component to avoid resurrecting two TUIs (this was the open facade-not-collapse risk flagged by chat_session).
- **`replayTraceIntoApp.ts`** isolates the JSONL-trace replay so `WatchApp` can stay declarative and tests can drive deterministic timelines via `ink-testing-library`.
- **No agent-definition global registry** — `~/.apparat/projects.json` is operator-state only (project paths the operator already passed via `--project`), preserving ADR-0001's "no global registry" for agent definitions.

## Gotchas and constraints

- Daemon log runId on disk is now 8-char. External scrapers of `~/.apparat/logs/<taskId>/<runId>.log` will see a different filename shape; not a migration, just a forward break.
- `apparat heartbeat watch` is now a deprecation alias — anything that hard-codes its help/output will see updated wording.
- `~/.apparat/projects.json` accumulates entries from every `--project` invocation, including vitest temp dirs (e.g. `/var/folders/.../apparat-pipeline-test-*`). `apparat status` does no GC; stale-temp-dir noise is a real follow-up but explicitly out of this plan's scope (see tester's "Remaining issues").
- `injectRunArgs` only fires when the scheduled command argv looks like `apparat pipeline run`. Custom wrappers around pipeline runs will not get the project-local routing automatically.

## Final verification

- test_result: pass
- test_summary: Cycle 1 clean: build green, 156 test files / 1411 tests pass. Phase 1c: 27 plan candidate paths matched in diff. Phase 2: 6 non-Claude scenarios all PASS (tool, tool-runtime-vars, store, pipeline-failure-footer, missing-caller-var fail-fast + with --var, plus validate on all 6); 9 agent-bearing scenarios skipped per hard rule. Phase 3: new `apparat status` lists projects + heartbeats + last run, `apparat watch --help` and legacy `apparat heartbeat watch --help` resolve cleanly. No fixes needed.
