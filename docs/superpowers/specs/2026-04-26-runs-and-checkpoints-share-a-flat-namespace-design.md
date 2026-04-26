# Runs and Checkpoints Share a Flat Namespace — Design

**Status:** Draft
**Date:** 2026-04-26
**Related:** `meditations/illuminations/2026-04-26T2000-runs-and-checkpoints-share-a-flat-namespace.md`, `specs/pipeline.md`, `specs/architecture.md`, `specs/commands.md`, `src/cli/commands/pipeline.ts`, `src/attractor/core/engine.ts`, `src/attractor/checkpoint.ts`

## Overview

`~/.ralph/runs/` is currently shared by two structurally different child directories that use two different keys:

- **Trace dir** — `~/.ralph/runs/<runId>/pipeline.jsonl`, keyed by an 8-char UUID minted per invocation. Built at `src/cli/commands/pipeline.ts:285-286`:
  ```ts
  const runsRoot = process.env.RALPH_RUNS_ROOT ?? join(homedir(), ".ralph", "runs");
  const tracePath = join(runsRoot, runId, "pipeline.jsonl");
  ```
- **Checkpoint dir** — `~/.ralph/runs/<slug>/checkpoint.json`, keyed by the lowercased graph name. Built at `src/cli/commands/pipeline.ts:276-277`:
  ```ts
  const slug = graph.name.replace(/\s+/g, "-").toLowerCase();
  const logsRoot = opts.logsRoot ?? join(homedir(), ".ralph", "runs", slug);
  ```

The two roots share a parent (`~/.ralph/runs/`) but never share a child directory, and neither carries any project scope. The split is documented at `specs/pipeline.md:83`:

> All per-run state lives under `~/.ralph/runs/<runId>/` (plus `~/.ralph/runs/<slug>/checkpoint.json` where `<slug>` is derived from the graph name — the slug and runId directory are distinct …)

This design replaces both roots with a single project-scoped, run-id-keyed layout:

```
~/.ralph/<project-key>/runs/<runId>/
  ├── pipeline.jsonl   # trace (was at ~/.ralph/runs/<runId>/)
  └── checkpoint.json  # checkpoint (was at ~/.ralph/runs/<slug>/)
```

One directory per run. Trace and checkpoint co-located. Cross-project collision impossible.

The illumination explicitly defers six behavioural decisions; this doc pins all six (with recommendations and rejected alternatives) so the implementation plan can land mechanically.

## Why now

Three concrete failures are live in shipped code:

1. **Cross-project collision.** Two projects that both invoke `illumination-to-implementation.dot` write to the same `~/.ralph/runs/illumination-to-implementation/checkpoint.json`. The second `--resume` reads the first project's state. Slug is derived from `graph.name`, which is identical across imports — `src/cli/commands/pipeline.ts:276`.
2. **Two-substrate observability gap.** A post-mortem documented at `meditations/illuminations/2026-04-26T2000-runs-and-checkpoints-share-a-flat-namespace.md:17` went looking for `~/.ralph/runs/e192f052-…/pipeline.jsonl` and found only the slug dir's `status.json`. The split is invisible at `ls` time and tooling that knows one key can't find the artifact under the other.
3. **Orphan accumulation.** No project context, no retention policy. `rmSync(logsRoot, …)` at `src/cli/commands/pipeline.ts:280-281` only cleans the slug dir on a fresh run; the per-runId trace dirs accumulate forever, mixed with stale checkpoints from any project that ever invoked `ralph` on that machine.

Fixing the layout advances the already-shipped `--resume` feature rather than introducing new surface. The companion illumination `2026-04-26T2100-checkpoint-write-skipped-when-node-fails-without-fail-edge.md` (resume-after-API-timeout) is unblocked by this change but tracked separately.

## Architecture

### One run, one directory

Every invocation produces one and only one directory:

```
~/.ralph/<project-key>/runs/<runId>/
  ├── pipeline.jsonl   # tracer output
  └── checkpoint.json  # engine state, written every transition
```

This is the only on-disk state ralph creates per run. Both files are owned by the run, both have the same lifetime, both are addressed by the same `<runId>`.

### Project-key derivation (decision 1 of 6)

**Pinned: hash-prefixed basename.** `<project-key> = <basename>-<hash6>` where `hash6` is the first six hex chars of `sha256(absolutePath(--project))`.

Examples:
- `--project ~/work/ralph-cli` → `ralph-cli-3f9a2c`
- `--project ~/other/ralph-cli` → `ralph-cli-d81e44`

**Rationale.**

| Option | Collision-safe? | Human-readable? | Stable across machines? |
|---|---|---|---|
| `basename(--project)` | No — `~/foo/work` vs `~/bar/work` collide | Yes | No (but neither is the alternative) |
| `sha256(absolutePath)` (full hex) | Yes | No | No (but doesn't need to be) |
| **`<basename>-<hash6>`** | **Yes (collision prob ≈ 1 / 16M for two paths sharing a basename)** | **Yes** | **No** |
| Encoded absolute path | Yes | No (very long, with `%2F` everywhere) | No |

The hash-prefixed basename keeps `ls ~/.ralph/` legible while making collision astronomically unlikely. Six hex chars (24 bits of entropy) is enough; the collision domain is "two project paths with the same basename on the same machine," which is bounded.

### `--resume` lookup (decision 2 of 6)

**Pinned: explicit `--resume <runId>` is required when more than one run exists for the project.** When zero or one runs exist for the project the bare `--resume` form auto-selects.

Behavioural matrix:

| Scenario | Behaviour |
|---|---|
| `--resume` (no arg), 0 runs for this project | Print "no checkpoint found" and start fresh, matching current `engine.ts:152-154` warning |
| `--resume` (no arg), 1 run for this project | Auto-select that run |
| `--resume` (no arg), N>1 runs for this project | Refuse to guess; print the list with mtimes and require `--resume <runId>` |
| `--resume <runId>` | Load that exact run; error if not found |

**Rationale.** The current model auto-finds the slug dir because there is exactly one per pipeline. Once the layout becomes per-runId, "latest mtime" is convenient but ambiguous when the user has parallel runs of the same pipeline open. The explicit form preserves the auto-find shortcut for the common case (one run) and forces disambiguation when the system can't infer intent — better than silently resuming the wrong run. `src/cli/program.ts` already wires `--resume` as an optional-value flag, so the variadic form costs no schema surface.

### Retention policy (decision 3 of 6)

**Pinned: keep the last 50 runs per project, garbage-collect older runs lazily on the next `pipeline run` invocation.** No background process, no separate command in v1.

Implementation: at the start of `pipelineRunCommand` (after project-key resolution, before logsRoot construction), list `~/.ralph/<project-key>/runs/`, sort by mtime descending, `rmSync` everything past index 50. Skipped on `--resume` to avoid GC'ing the run being resumed.

Manual escape hatches (build them only if asked):
- `RALPH_RUNS_KEEP=N` env var to override the cap (smoke tests already use a tmpdir via `process.env.RALPH_RUNS_ROOT` per `src/cli/commands/pipeline.ts:285`).
- `ralph pipeline runs prune` — deferred. Out of scope until manual GC is requested.

**Rationale.** The illumination flagged "orphan accumulation" as a concrete failure. A keep-N policy is the smallest change that bounds disk while preserving recent history for `pipeline runs`/`pipeline trace`. Time-based pruning (`mtime older than 30 days`) is rejected because `pipeline.jsonl` mtime drifts during long-running heartbeat pipelines and would prematurely GC the active run. Lazy GC at run-start is rejected for never running (no background process exists), but is acceptable here because every successful run already touches the parent dir.

### `pipeline trace <runId>` signature (decision 4 of 6)

**Pinned: scan all projects when `--project` is absent.** `pipelineTraceCommand` at `src/cli/commands/pipeline.ts:622-636` currently resolves `~/.ralph/runs/<runId>/pipeline.jsonl`. New behaviour:

1. If `--project <folder>` is supplied, resolve to `~/.ralph/<project-key>/runs/<runId>/pipeline.jsonl`.
2. Otherwise, walk `~/.ralph/*/runs/<runId>/pipeline.jsonl`. Pick the unique match. Error if 0 or >1 matches.

**Rationale.** `runId` is a UUID; cross-project collision in the 8-char prefix is possible but rare. The all-projects walk is O(number of projects ever run by ralph on this machine) — bounded by the retention policy and cheap (a single `existsSync` per project). Forcing `--project` on every `pipeline trace` invocation is hostile when the user is following a UUID from a chat log and doesn't remember which project produced it.

`listRecentTraces` at `src/cli/commands/pipeline.ts:573-596` is project-scoped already in spirit (it's only called from `refine`, which has `dotDir` context) and gets the same treatment: when given `tracesRoot`, scan one project; otherwise scan all projects.

### Heartbeat / cron cwd resolution (decision 5 of 6)

**Pinned: `--project` is required for any non-interactive run.** Heartbeat and cron entrypoints already pass `--project` (otherwise `$project` preflight at `specs/pipeline.md:96` rejects the run). This design adds an explicit assertion to `pipelineRunCommand`: if `process.stdin.isTTY === false` and `--project` is absent, exit 1 with the message *"Headless runs require --project; cwd is ambiguous when invoked from cron/daemon."*

**Rationale.** Today an interactive run without `--project` falls back to `process.cwd()` for path resolution. Under the new layout, `process.cwd()` is also the project-key seed — but `cwd` is undefined for cron-spawned processes (it depends on the cron invocation). The hard error closes a class of "the run wrote to `~/.ralph/<root>-3f9a2c/`" surprises. Interactive users see no behaviour change because a missing `--project` already defaults to `cwd` and that cwd is by definition the project they're in.

### Migration of existing data (decision 6 of 6)

**Pinned: no migrator. Fresh start on the upgrade that lands this change.**

On first `pipeline run` after upgrade, ralph prints a one-line notice:

> *"Layout changed in vX.Y.Z; previous runs at ~/.ralph/runs/ are preserved but unreachable from the new tooling. Delete with: `rm -rf ~/.ralph/runs/`"*

The notice fires once per machine (gated by the existence of `~/.ralph/runs/` *and* absence of `~/.ralph/.layout-v2`). After printing, ralph touches `~/.ralph/.layout-v2` and never warns again.

**Rationale.** The migrator would have to: parse every `pipeline.jsonl` to discover `pipelineName`, derive a project-key for each (impossible — the project that produced the run is not recorded in the trace), and decide what to do with slug-keyed checkpoints whose project provenance is also unrecoverable. The data the migrator needs does not exist on disk. Synthesising a fake project-key (`legacy-fffff0`) preserves data nobody will look at; the one-time notice is the honest answer.

The notice path means a user who *does* care about old traces can copy them aside before deletion. The bare warning at upgrade time is the one place where the change surfaces; tooling never reads from the legacy layout.

### Engine and tracer changes

**Engine** (`src/attractor/core/engine.ts:140-157`) — `opts.logsRoot` is already a parameter. The engine doesn't need to know about the layout change; it receives a different `logsRoot` value and continues calling `loadCheckpoint(opts.logsRoot)` and `mkdir(opts.logsRoot, { recursive: true })`. Zero engine code change.

**Tracer** (`src/attractor/tracer/jsonl-pipeline-tracer.ts`) — also already takes a path. Zero change.

**Checkpoint** (`src/attractor/checkpoint.ts`) — already path-parameterised. Zero change.

All change concentrates in `src/cli/commands/pipeline.ts`.

## Components

### Code edits

| # | File | Lines | Change |
|---|---|---|---|
| 1 | `src/cli/commands/pipeline.ts` | 276-282 | Replace slug-based `logsRoot` and its `rmSync` cleanup with: derive `projectKey` from `--project`, build `runsRoot = ~/.ralph/<projectKey>/runs`, build `logsRoot = <runsRoot>/<runId>`. Remove `rmSync` (per-run dirs do not collide; GC handled separately). |
| 2 | `src/cli/commands/pipeline.ts` | 285-286 | Replace `tracePath` construction with `join(logsRoot, "pipeline.jsonl")` so trace and checkpoint share the directory built in edit 1. |
| 3 | `src/cli/commands/pipeline.ts` | (new helper) | Add `deriveProjectKey(absoluteProjectPath: string): string` returning `<basename>-<hash6>`. Pure function; export for tests. |
| 4 | `src/cli/commands/pipeline.ts` | (new helper) | Add `gcOldRuns(runsRoot: string, keep: number)`. Called once per `pipelineRunCommand` invocation when `--resume` is absent. |
| 5 | `src/cli/commands/pipeline.ts` | 573-596 | `listRecentTraces`: when `tracesRoot` not supplied, walk `~/.ralph/*/runs/` instead of `~/.ralph/runs/`. |
| 6 | `src/cli/commands/pipeline.ts` | 622-636 | `pipelineTraceCommand`: resolve trace via project-scoped path; fall back to all-projects scan when `--project` absent. Error on 0 or >1 matches. |
| 7 | `src/cli/commands/pipeline.ts` | (new) | Headless `--project` guard: if `!process.stdin.isTTY && !opts.project`, exit 1 with the cron message above. |
| 8 | `src/cli/commands/pipeline.ts` | (new) | Layout-v2 first-run notice gated by `~/.ralph/.layout-v2`. |
| 9 | `src/cli/program.ts` | (commander wiring) | `--resume` accepts an optional `<runId>` arg. Today it's a boolean flag. |

### Test edits

| File | Line | Change |
|---|---|---|
| `src/cli/tests/pipeline.test.ts` | 174-182 | Assertion `logsRoot.includes(".ralph/runs/<slug>")` → `logsRoot.includes(".ralph/<projectKey>/runs/<runId>")`. Use the test's tmpdir-based `RALPH_RUNS_ROOT` to anchor. |
| `src/cli/tests/pipeline-failure-reason.test.ts` | 65 | Trace path assertion updated to the new layout. |
| `src/cli/tests/pipeline-headless.test.ts` | (new test) | Cover the headless `--project` guard. |
| (new) `src/cli/tests/pipeline-project-key.test.ts` | — | Cover `deriveProjectKey` (collision absent for distinct abs paths sharing a basename; identical for repeat calls; produces `<basename>-<6 hex>` shape). |
| (new) `src/cli/tests/pipeline-runs-gc.test.ts` | — | Cover `gcOldRuns` (keeps newest N, prunes older, leaves `--resume <runId>` target alone). |

Other test files in the grep result (`agent-handler*`, `engine*`, `tool-handler*`, `store*`, `ralph-handlers*`, `handlers.test.ts`) reference `~/.ralph/runs` only via injected `logsRoot` from `mkdtempSync` and need no edits.

### Documentation edits

| File | Line | Change |
|---|---|---|
| `specs/pipeline.md` | 83 | Replace the dual-substrate paragraph with the per-run, project-scoped layout. |
| `specs/pipeline.md` | 180 | `<logsRoot>/checkpoint.json` default is now `~/.ralph/<projectKey>/runs/<runId>/`. |
| `specs/pipeline.md` | 183 | The sentence *"a fresh run deletes the prior run directory before starting. Tool scripts must therefore be idempotent …"* becomes false under the new layout — fresh runs get a fresh `<runId>` dir and never overwrite a prior one. Rewrite to reference the lazy GC policy from this design instead, and keep the idempotency note as good practice (heartbeat/cron retries still re-enter nodes within one run). |
| `specs/pipeline.md` | 187, 198 | Tracer file path updated to the new layout; the "checkpoint lives alongside" sentence becomes literal — both files are in the same directory now. |
| `specs/architecture.md` | 136 | Run-state diagram updated. |
| `specs/commands.md` | 167 | `pipeline trace` and `pipeline runs` documentation updated for the new layout and the `--project` resolution rules. |
| `README.md` | 72 | Quickstart references to `~/.ralph/runs/` updated. |
| `src/cli/agents/memory-writer.md` | 30, 40 | `$run_id` template-var description includes the new path shape. |

## Constraints

- **Apples-to-apples with the approved explainer.** Anchors (`pipeline.ts:277`, `pipeline.ts:285-286`, `specs/pipeline.md:83`, `memory/2026-04-25-plans-have-no-lifecycle.md:38`) and before/after framing match what the user approved at the gate. Scope additions (the six pinned decisions) are explicit elaborations, not contradictions — the explainer's "Out: six deferred decisions" line is the contract that this design pins them.
- **No engine changes.** `engine.ts:140-157` is unchanged. The engine takes a `logsRoot` and writes to it; what's varying is what `pipeline.ts` passes in.
- **No new MCP tool, no new handler.** Path math only.
- **Tests anchor on `RALPH_RUNS_ROOT`.** Existing tests already inject a tmpdir via that env var (`pipeline.ts:285`). New tests follow the same pattern; no fixture mutates the user's real `~/.ralph/`.
- **Single-machine bounded.** Project-key collision is mathematically possible but practically impossible at single-user scale. If a multi-tenant install ever surfaces (out of scope today), the key derivation can be swapped without changing the layout shape.

## Out of scope (YAGNI)

- **`ralph pipeline runs prune` command.** Deferred. Lazy GC at run-start covers the bounded-disk requirement; an explicit prune subcommand adds CLI surface that nobody has asked for.
- **Migrator for legacy `~/.ralph/runs/`.** The data the migrator would need (project provenance per slug dir, project provenance per run-id dir) is not on disk. The one-line notice is the honest, low-cost answer; users who care can copy data aside.
- **Trace event with project-key.** Adding `projectKey` to `pipeline-start` events would make a future migrator possible but doesn't help today, and the migrator is out of scope. If a v3 layout ever lands and we want to migrate from v2, the trace can pick this up at that time.
- **Companion illumination T2100 (`checkpoint-write-skipped-when-node-fails-without-fail-edge.md`).** The two illuminations are independent fixes that compound: this one moves the file; T2100 ensures the file is written on failure paths. Bundling them widens the diff and couples the fixes' failure modes.
- **Cross-machine portability.** Project-key is sha256 of an absolute filesystem path. A repo cloned into different parents on different machines produces different keys. Acceptable — runs are not synced between machines, and `~/.ralph/` is a local cache.

## Open questions

These are surfaced rather than decided — implementation should resolve them in-line with the user, not in this spec.

1. **What happens to a `--resume <runId>` whose run has been GC'd?** The cleanest behaviour is: clear error, list of currently retained runs, exit 1. The alternative (auto-skip GC for the targeted run) is rejected because the GC happens at run-start *before* the resume target is known unless we plumb the `--resume` arg through. Recommendation: clear error.
2. **Six hex chars enough for the project-key hash?** 24 bits of collision space against ~10² distinct projects sharing a basename per machine is fine, but if the collision domain ever grows we'd want 8 chars. Recommendation: ship 6, revisit if anyone hits a collision.
3. **Should `pipeline runs list` (subcommand exists per `pipeline.ts` neighbourhood) display the project name alongside `<runId>`?** Today it groups by pipeline name; with the new layout it could also surface the human-readable project basename. Recommendation: yes, in the same edit that updates the listing path — costs nothing, improves grep-ability of the output.

## Files modified at implementation

| File | Lines touched (approx) |
|---|---|
| `src/cli/commands/pipeline.ts` | ~+80 / -15 (helpers + edits 1–8) |
| `src/cli/program.ts` | ~+3 (`--resume <runId>` arg) |
| `src/cli/tests/pipeline.test.ts` | ~+5 / -5 (assertion update) |
| `src/cli/tests/pipeline-failure-reason.test.ts` | ~+1 / -1 (path assertion) |
| `src/cli/tests/pipeline-headless.test.ts` | ~+15 (new headless guard test) |
| `src/cli/tests/pipeline-project-key.test.ts` | ~+40 (new file) |
| `src/cli/tests/pipeline-runs-gc.test.ts` | ~+60 (new file) |
| `specs/pipeline.md` | ~+10 / -8 (lines 83, 180, 187, 198) |
| `specs/architecture.md` | ~+3 / -3 (line 136) |
| `specs/commands.md` | ~+5 / -3 (line 167) |
| `README.md` | ~+1 / -1 (line 72) |
| `src/cli/agents/memory-writer.md` | ~+2 / -2 (lines 30, 40) |

Total: 12 files, ~+225 / -50 lines. Engine and handler code unchanged.
