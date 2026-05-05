---
date: 2026-05-05
description: memory-writer (and downstream reflector) cannot locate pipeline.jsonl by run_id under ~/.ralph/*/runs/, silently degrading session memory to artifact+git-log only.
---

## Core Idea

The illumination-to-implementation pipeline ends with `memory_writer` + `memory_reflector` reading per-run telemetry, but the trace file (`pipeline.jsonl`) is not deterministically locatable from a `run_id`. In run `5595c462-8d25-4c44-acf6-ed655fa688f0`, memory-writer logged: *"`pipeline.jsonl` for `run_id=5595c462-…` was not present under `~/.ralph/*/runs/5595c462-*/`. Cross-project `find` for `5595c462*` returned nothing."* Memory was reconstructed from artifacts + `git log` only; per-node retry counts, durations, and failure modes were lost.

This is a silent observability regression: every memory file written from now on may be missing the structured signal those nodes were designed to surface, and the only sign is one prose paragraph buried in `## Learnings from the run`.

## Why It Matters

- **Reflector inputs degrade in lockstep.** Memory-reflector's procedure §2 says *"Do not re-open the raw `pipeline.jsonl` trace; if the memory file lacks signal, that signal is gone for your purposes."* If memory-writer can't find the trace, reflector can't recover it either — illumination quality drops to whatever prose memory-writer reconstructs.
- **Self-reinforcing blindspot.** A clean run with no tmux fix cycles + no retries documented looks identical to a run whose trace was missing. Skip-fast signals can't distinguish "smooth run" from "trace lost" — exactly the failure mode that triggered this illumination.
- **Likely path mismatch, not absence.** Pipeline context surfaced `implement.iterations=3` and `tmux_tester.iterations=1` — those numbers must have been recorded somewhere upstream for the engine to populate context. So the trace exists; memory-writer just looked in the wrong place. Candidate causes: (a) trace lives under the project-local `.ralph/runs/` rather than `~/.ralph/*/runs/`; (b) run-id directory is named with a different prefix (e.g. parent-folder hash from heartbeat — note the side-fix `4ef368d fix(heartbeat): … derive id from parent folder` landed in this same session range and may have shifted the convention); (c) the `pipeline.jsonl` writer flushes only on terminal nodes and the in-flight memory-writer reads before flush.
- **Heartbeat fix (`4ef368d`) is suspicious.** The commit changed how heartbeat derives its id from the parent folder; if memory-writer's lookup was hardcoded to the old scheme, every run after that commit silently loses trace correlation.

## Revised Implementation Steps

1. **Reproduce.** Run any short pipeline end-to-end (`.ralph/scenarios/chat-only/` or similar), capture `$run_id` from the start node, then immediately `find ~/.ralph .ralph -name 'pipeline.jsonl' -path "*${run_id}*"`. If zero hits → confirmed; if hits → record the actual on-disk path scheme.
2. **Audit the writer side.** Grep for `pipeline.jsonl` writes in `src/attractor/core/` and `src/cli/commands/heartbeat.ts`. Determine the canonical directory layout post-`4ef368d` — is the run-id used in the path, or is it the parent-folder-derived id?
3. **Audit the reader side.** Grep memory-writer agent prompt + any helper code for the glob pattern it uses to locate the trace. If it still hardcodes `~/.ralph/*/runs/<run_id>/pipeline.jsonl`, update to whatever the writer actually produces, and pass the resolved path through pipeline context (`$trace_path`) instead of having memory-writer guess.
4. **Wire `trace_path` into pipeline context.** Engine knows where it wrote the trace; expose it as a first-class context value at the start node so memory-writer + reflector both consume it deterministically. This eliminates the glob-and-pray pattern entirely.
5. **Add a reflector skip-fast signal for missing trace.** If `$trace_path` is unset or unreadable when memory-reflector runs, surface that as its own log line and bias toward writing an illumination (the absence is itself signal — current logic treats it as a clean run).
6. **Backfill scenario test.** Add an assertion in one `pipeline-smoke-*-folder.test.ts` that after a run completes, `pipeline.jsonl` exists at the path the engine advertises in context — fails loudly if writer/reader paths diverge again.

## Provenance

- Source memory: `.ralph/sessions/2026-05-05-agent-handler-two-paths-one-execute.md`
- Pipeline run id: `5595c462-8d25-4c44-acf6-ed655fa688f0`
- Surfaced by: memory-reflector
