---
date: 2026-04-26
run_id: daecd079-827e-4f3b-88c6-7ca52abed6fd
plan: docs/superpowers/plans/2026-04-26-runs-and-checkpoints-share-a-flat-namespace.md
design: docs/superpowers/specs/2026-04-26-runs-and-checkpoints-share-a-flat-namespace-design.md
illumination: meditations/illuminations/2026-04-26T2000-runs-and-checkpoints-share-a-flat-namespace.md
test_result: pass
---

# Runs and Checkpoints Share a Flat Namespace

## What was implemented

Replaced the dual-key `~/.ralph/runs/<runId>/` (trace) + `~/.ralph/runs/<slug>/` (checkpoint) layout with a single project-scoped, run-id-keyed directory `~/.ralph/<projectKey>/runs/<runId>/{pipeline.jsonl, checkpoint.json}`. Trace + checkpoint co-locate, cross-project collision is impossible, and orphan accumulation is bounded by lazy keep-50 GC.

## Key files

Created:
- `src/cli/tests/pipeline-project-key.test.ts`
- `src/cli/tests/pipeline-runs-gc.test.ts`
- `src/cli/tests/pipeline-trace-lookup.test.ts`
- `src/cli/tests/pipeline-headless.test.ts`
- `src/cli/tests/pipeline-layout-notice.test.ts`
- `docs/superpowers/specs/2026-04-26-runs-and-checkpoints-share-a-flat-namespace-design.md`
- `docs/superpowers/plans/2026-04-26-runs-and-checkpoints-share-a-flat-namespace.md`
- `meditations/illuminations/2026-04-26T2000-runs-and-checkpoints-share-a-flat-namespace.md`

Modified:
- `src/cli/commands/pipeline.ts` — new helpers `deriveProjectKey`, `gcOldRuns`, `resolveResumeLogsRoot`, `findRunAcrossProjects`, `listAllProjectRunsRoots`, `maybePrintLayoutV2Notice`; rewritten `listRecentTraces`; new path math; headless guard.
- `src/cli/program.ts` — `--resume [runId]` variadic, `--project <folder>` on `pipeline trace`, refreshed help text.
- `src/cli/tests/pipeline.test.ts`, `src/cli/tests/pipeline-failure-reason.test.ts`, `src/cli/tests/pipeline-refine-tip.test.ts` — path-shape updates + `project: dir` plumbing for the new headless guard.
- `pipelines/smoke/missing-caller-var.dot` — `cwd="$project"` → `cwd="."` so the smoke surfaces its documented `Missing required inputs` preflight rather than the new `project_binding_missing` preflight.
- `specs/pipeline.md`, `specs/architecture.md`, `specs/commands.md`, `README.md`, `src/cli/agents/memory-writer.md` — documentation sweep.

Session commits (per-chunk): `d32ddba` Chunk 1 → `31a313e` 2 → `03729e6` 3 → `502fbf9` 4 → `d0429f4` 5 → `5178c7f` 6 → `6c23478` 7 → `eb374ec` 8 → `0b234ef` smoke fix from verifier.

## Decisions and patterns

- **Project key shape:** `<basename>-<sha256(absPath).slice(0,6)>`. Six hex chars covers the bounded "two paths sharing a basename on the same machine" collision domain; revisit if anyone hits a clash.
- **`RALPH_RUNS_ROOT` semantics shifted.** Previously pointed at the `runs/` parent; now points at the `~/.ralph` root. All injected-root tests updated; not a user-facing env var so the silent shift is acceptable.
- **GC is lazy, run-start, opt-out via `RALPH_RUNS_KEEP=N`.** No background daemon. `--resume` skips GC so the run you want to resume isn't pruned the moment you ask for it.
- **`--resume` is variadic `[runId]`.** 0 runs → fall through (engine warns + starts fresh); 1 run → auto-select; N>1 → list candidates with mtimes and exit 1; explicit runId → load exactly that, error if dir missing.
- **Headless guard fires before any path math.** `!process.stdin.isTTY && !opts.project` exits 1 with a cron-friendly message. Solves the "trace lands in cron's cwd" footgun without touching cron config.
- **Layout-v2 notice is best-effort.** Fails silently if the sentinel write loses; user sees the notice again next run. No migrator — design explicitly punted on this.
- **No `rmSync` cleanup of prior run dirs.** Each fresh run gets a fresh `<runId>` so collision is structurally impossible; the old `if (!opts.resume && existsSync(logsRoot)) rmSync(...)` is gone.

## Gotchas and constraints

- `pipeline.test.ts` resume tests must seed `<runId>` directories manually because `engine.runPipeline` is mocked at the file top — the engine never materialises the dir under test. Without the seed, `resolveResumeLogsRoot` reports zero runs and falls through to fresh.
- `findRunAcrossProjects` **throws** rather than exits when N>1 own the same runId. `pipelineTraceCommand` translates the throw into `output.error` + `process.exit(1)`. Direct callers must catch.
- `listRecentTraces` now takes an options bag `{ tracesRoot? }`; the second positional `limit` arg is unchanged. Callers that previously passed a third arg (`tracesRoot` as bare positional) will silently get cross-project scan — refactor opportunity if any such caller exists outside this PR.
- The smoke fix (`cwd="$project"` → `cwd="."`) is **smoke-specific intent**, not a general rule. Real pipelines should keep `cwd="$project"` because that's how project-scoped runs find their working tree. The smoke explicitly tests the missing-input preflight so it must NOT bind a real project.
- Tests rely on `process.env.RALPH_RUNS_ROOT` set per `beforeEach` and cleared in `afterEach`. Stray leakage between describes will route writes into the user's real `~/.ralph`. Always pair the set with the clear.

## Learnings from the run

`pipeline.jsonl` for run id `daecd079-827e-4f3b-88c6-7ca52abed6fd` is **not present** at `~/.ralph/ralph-cli-0c42de/runs/` nor anywhere else under `~/.ralph`. The trace was either never persisted or was collected under a different id than the one passed to memory-writer. Two evidence-grounded learnings remain visible from git + the ambient session state:

- **Verifier (tmux-tester) needed a single fix cycle**, captured in commit `0b234ef`. The first verification cycle exposed an order-of-preflight bug: the new `project_binding_missing` preflight (added in Chunk 6) fired before the documented `Missing required inputs` preflight in `missing-caller-var.dot` because the smoke pinned `cwd="$project"`. Cycle 2 swapped to `cwd="."` and re-verified green. Five agent-driven smokes (agent-implement, chat-only, chat-end-to-end, meditate-steer, tmux-tester) were deferred per the no-Claude-sessions / no-nested-tmux rule.
- **Run-id ↔ trace-dir mapping is not yet bulletproof.** This run's id (`daecd079-…`) does not match any directory under `~/.ralph/<projectKey>/runs/`. Worth a follow-up illumination to confirm the orchestrator's `run_id` always matches the engine's `randomUUID().slice(0, 8)` — a mismatch would make `pipeline trace <run_id>` unusable for any session that handed `run_id` out via context. (Possibly already covered by the new `2026-04-26T2100-checkpoint-write-skipped-when-node-fails-without-fail-edge.md` illumination — surface to next session.)

## Final verification

- test_result: pass
- test_summary: Cycle 1: 1148/1148 unit tests passed; 8 smokes ran clean (store, tool, tool-runtime-vars, conditional, static-multi-node, agent-json-vars, json-schema-stream, gate); missing-caller-var.dot tripped the new project-binding preflight before its documented missing-input preflight. Cycle 2: changed cwd from $project to '.' (commit 0b234ef), smoke now surfaces 'Missing required inputs' as documented; smoke.test.ts + pipeline-run-preflight.test.ts re-ran green (5/5). 5 agent-driven smokes (agent-implement, chat-only, chat-end-to-end, meditate-steer, tmux-tester) deferred per hard rule against opening Claude sessions / nested tmux.
