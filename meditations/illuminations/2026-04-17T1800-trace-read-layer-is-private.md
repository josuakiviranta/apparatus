---
date: 2026-04-17
status: open
description: listRecentTraces and digestTraceFile implement everything needed for a user-facing run-history command, but they're private to pipelineRefineCommand — leaving the trace read surface as trace-by-runId-only, which requires the user to have captured the runId during execution.
---

## Core Idea

`listRecentTraces()` and `digestTraceFile()` in `src/cli/commands/pipeline.ts` (lines ~442–490) implement the complete read layer for pipeline run history: scan `~/.ralph/runs/` by pipeline name, sort by mtime, read and summarise each JSONL trace. They exist only to feed the `refine` trigger. There is no user-facing `ralph pipeline runs <name>` command. The only external trace entry point is `ralph pipeline trace <runId>` — which requires knowing the runId in advance. If a developer missed the header output or the run crashed, the runId is not recoverable without manual filesystem inspection.

## Why It Matters

Ralph now has two divergent memory substrates under `~/.ralph/runs/`:

- **`<slug>/checkpoint.json`** — mutable, overwritten per run, keyed by pipeline name. Always findable.
- **`<runId>/pipeline.jsonl`** — append-only, keyed by a random 8-char UUID regenerated every run. Only findable if you already know the UUID.

The checkpoint is designed for resumption; the trace is designed for observability. But observability only works if you can find the trace. `listRecentTraces` solves this lookup internally — it scans all UUID dirs and filters by `pipelineName` from the first JSONL event — but it's locked behind the `refine` command path.

The failure-tip feature (commit `e242826`) now tells developers "use `refine` after a failed run." But a developer debugging *patterns across multiple failures* — nodes that consistently fail, context drift between runs, whether a recent change helped — has no tool. They must know runIds (captured during execution), or manually `ls ~/.ralph/runs/` and guess by timestamp. The read capability already exists in code; it just isn't a command.

One additional gap: `digestTraceFile` formats the trace path in its output but not the runId itself. A `runs` command would need to surface runIds so users can pivot to `ralph pipeline trace <runId> --node-receive <id>` for deep inspection. The current digest format is sufficient for `refine` context injection but insufficient for human navigation.

## Revised Implementation Steps

1. **Expose `listRecentTraces` and `digestTraceFile` as a `ralph pipeline runs <name>` command.** Add a `pipeline runs <name>` subcommand in `src/cli/program.ts` and `src/cli/commands/pipeline.ts`. The action calls `listRecentTraces(name, 10)`, then for each trace path: extract the runId (basename of the parent directory) and call `digestTraceFile`. Print runId + digest, newest first. No new logic — purely an external call to existing internals.

2. **Add runId to `digestTraceFile` output.** The current format omits the runId. Add it as the first line: `Run: <runId>` (basename of `dirname(tracePath)`). This makes the output of `pipeline runs` directly usable as input to `pipeline trace <runId>`.

3. **Add a `--limit` flag to `pipeline runs`.** Default 10. Callers who want fewer (like `refine`'s internal call at `REFINE_TRACE_COUNT = 3`) can pass it explicitly. This lets the public command and the internal call share a single implementation path with configurable depth.

4. **Test `listRecentTraces` and `digestTraceFile` directly.** They have no dedicated unit tests today — they are covered only implicitly through `pipelineRefineCommand` tests. Add two focused unit tests: one for `listRecentTraces` (assert it filters by name, sorts by mtime, respects limit), one for `digestTraceFile` (assert it handles unreadable files gracefully and includes runId in output after step 2).

5. **Consider a trace retention policy.** Run directories under `~/.ralph/runs/<uuid>/` accumulate indefinitely. `listRecentTraces` scans all of them on each call. For now the cost is acceptable (O(runs) directory read, O(N) filter). But a note in the spec for `pipeline runs` should flag this as a known accumulation pattern — a `--prune` flag or a max-age policy belongs in a future illumination when evidence of real accumulation pain exists.
