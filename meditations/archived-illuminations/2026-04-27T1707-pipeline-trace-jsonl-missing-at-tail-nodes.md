---
date: 2026-04-27
status: archived
description: Tail nodes (memory-writer, memory-reflector) cannot find ~/.ralph/runs/<run_id>/pipeline.jsonl — either trace is being deleted/never-written, or path convention drifted; either way tail-node evidence reconstruction silently degrades.
archived_at: 2026-04-27
reason: Trace persists - real bug is runId slice mismatch plus unresolved projectKey literal in prompt
---

## Core Idea

The `illumination-to-implementation` pipeline's tail nodes (memory-writer, memory-reflector, and any future post-run reflector) assume `~/.ralph/runs/<run_id>/pipeline.jsonl` exists and contains the per-node trace from the run that just finished. In run `00135639-ed28-4452-be6f-7a58f545da4f` that file did not exist on disk at memory-writer time, so the memory file was distilled from $context variables alone and the "Learnings from the run" section had no node-by-node retry/duration evidence to draw on. Either trace persistence is silently disabled/relocated, or it is intentionally ephemeral and the tail-node prompts are lying about what they can read. Pick one and align the contract.

## Why It Matters

- Tail-node value collapses without the trace. Memory-writer's job is to capture *struggles* — retries, fix cycles, tool-node failures — and those live in `pipeline.jsonl`, not in `$context`. A pipeline that runs cleanly looks identical to one that thrashed for 40 minutes if the JSONL is missing.
- The miss is silent. No node failed; the agent prompt just falls back to context vars and produces a thinner memory file. There is no preflight check that the trace exists, no warning surfaced to the user, no failure that would trigger investigation.
- This run is the second tail-node-evidence gap observed in recent sessions (cf. `2026-04-13-illumination-pipeline-session.md` for prior trace-format friction). The pattern is "tail nodes assume an artifact that the runtime no longer guarantees" — which means the runtime contract for `pipeline.jsonl` needs to be either reaffirmed (and enforced) or formally retired (and tail-node prompts updated to stop asking for it).
- Future memory-reflector improvements (e.g. spotting nodes with high retry counts, flagging tools that repeatedly emit `success: false`, mining `tmux_tester` cycle counts) all depend on a reliable trace. Building those features on top of an unreliable substrate guarantees rework.

## Revised Implementation Steps

1. **Investigate where the trace went.** Reproduce a clean pipeline run end-to-end and check whether `~/.ralph/runs/<run_id>/pipeline.jsonl` is written, when, and whether anything (cleanup hook, `--resume` logic, daemon shutdown) deletes or moves it before tail nodes execute. Write findings into a short note before changing anything — do not assume the cause.
2. **Decide the contract.** Either: (a) trace persistence is a guarantee — fix the runtime so the file exists for the lifetime of the run plus a known retention window; or (b) trace is best-effort — update memory-writer and memory-reflector prompts to stop describing it as authoritative and to fall back gracefully on `$context` only.
3. **Add a preflight check at tail-node entry.** Whichever contract wins, the first thing memory-writer (and any other reflector) should do is `stat` the expected JSONL path and emit a structured warning when missing — visible in the pipeline output, not buried in agent reasoning. A silent fallback is worse than a noisy one.
4. **Add a smoke test.** A new pipeline smoke or unit test asserts that after a multi-node run completes, the JSONL exists at the documented path and is parseable line-by-line. This locks the contract from regressing again.
5. **Document the path convention.** Whatever directory and filename the runtime actually uses goes into the pipeline runtime spec (or memory-writer's own agent rubric) so the next prompt author does not have to guess.

## Provenance

- Source memory: `memory/2026-04-27-pipeline-show-two-open-seams.md`
- Pipeline run id: `00135639-ed28-4452-be6f-7a58f545da4f`
- Surfaced by: memory-reflector
