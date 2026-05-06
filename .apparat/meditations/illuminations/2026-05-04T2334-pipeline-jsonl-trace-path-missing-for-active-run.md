---
date: 2026-05-04
description: Memory-writer (and memory-reflector) cannot locate pipeline.jsonl for the in-flight run_id under ~/.apparat/*/runs/<run_id>/, falling back to artifacts + git log only and losing per-node duration / retry / failure observability.
---

## Core Idea

The `pipeline.jsonl` trace file for an in-flight `run_id` is not reliably present at `~/.apparat/*/runs/<run_id>/pipeline.jsonl` by the time tail-of-pipeline nodes (memory-writer, memory-reflector) execute. When the trace is absent, those nodes silently degrade to artifacts + `git log` and lose access to per-node duration, retry counts, tool-node failures, and any in-session struggle that did not produce a committed file.

## Why It Matters

Concrete evidence from this session (`run_id=30a4a4d7-cf2f-4261-be29-fb7d2caddf9b`, 2026-05-04):

- Memory file at `.apparat/sessions/2026-05-04-janitor-graph-validator-bloat.md` explicitly notes under `## Learnings from the run`: *"`pipeline.jsonl` for `run_id=30a4a4d7-...` was **not present** under `~/.apparat/*/runs/30a4a4d7-fc2f-4261-be29-fb7d2caddf9b/` at memory-writer time (most recent traces in that tree end at run-ids `f6b021e5`, `0b5f987f`, `c1396746`). Memory file built from artifacts + git log only; per-node duration / retry data unavailable for this session."*
- Memory-reflector procedure step 2 says *"Do not re-open the raw `pipeline.jsonl` trace; if the memory file lacks signal, that signal is gone for your purposes."* — meaning every signal that only lives in the trace (silent retries, tool-node retry budgets exhausted, gate-choice latencies, transient agent failures that succeeded on retry) is permanently lost when memory-writer can't reach the trace.
- The bug is **silent**: memory-writer emits a successful memory file with most sections intact, so downstream observers (this reflector, future debug sessions) only notice the gap if they read the `Learnings` section carefully. There is no failure surface and no warning telemetry.
- Likely root causes (none verified, all need confirmation): (a) trace path resolution races the run — memory-writer runs before the daemon flushes `pipeline.jsonl` for the current run; (b) trace path scheme uses a different identifier than `$run_id` (e.g., session-id vs run-id); (c) the directory `~/.apparat/*/runs/<run_id>/` is constructed from a different base than the one where the daemon actually writes; (d) trace gets rotated or moved between when the run starts and when memory-writer reads.

This affects every memory-writer / memory-reflector invocation, and it has likely been silently degrading session memories for some time.

## Revised Implementation Steps

1. **Reproduce the gap deterministically.** Run a fresh `illumination-to-implementation` pipeline end-to-end on a tiny illumination. Before memory-writer fires, snapshot `find ~/.apparat -name pipeline.jsonl -newer <pipeline-start-marker>`. Confirm whether the trace file exists at all, and if so, at what path scheme.
2. **Locate the daemon's actual write path.** Grep `src/daemon/` and `src/cli/` for `pipeline.jsonl` writes (`fs.appendFile`, `createWriteStream`, etc.). Capture the exact path-construction code and the identifier it keys on (`run_id`? `session_id`? a hash?).
3. **Locate memory-writer's read path.** Grep the `templates/memory-writer/` (or equivalent) agent prompt + tool wiring for the trace-lookup glob. Capture the path scheme it expects.
4. **Compare.** Diff the daemon's write path against the agent's read path. The mismatch is the bug. Possible shapes: different identifier, different base directory, different filename, ordering / flush race.
5. **Pick a fix axis.** Either (a) make the daemon write to the path memory-writer expects, or (b) pass the resolved trace path through the pipeline as a context variable (e.g., `$pipeline.trace_path`) so memory-writer reads from a known-good location instead of globbing. Option (b) is more robust to future path-scheme changes.
6. **Add a failure surface.** When memory-writer cannot find the trace, it should emit a `WARNING: trace not found at <path>; memory built from artifacts + git log only` line at the top of the memory file (currently buried in `Learnings`) AND set a flag in its structured output (`memory_writer.trace_found: false`) so downstream nodes — including memory-reflector — can branch on it.
7. **Backfill a regression test.** Add a smoke test that runs a minimal pipeline, then asserts both that `pipeline.jsonl` exists at the daemon's write path and that memory-writer's read path resolves to the same file.
8. **Audit prior memory files.** Optional cleanup pass: grep `.apparat/sessions/*.md` for `Memory file built from artifacts + git log only` — every match is a session whose memory is degraded. Use the count to size the impact.

## Provenance

- Source memory: `.apparat/sessions/2026-05-04-janitor-graph-validator-bloat.md`
- Pipeline run id: `30a4a4d7-cf2f-4261-be29-fb7d2caddf9b`
- Surfaced by: memory-reflector
