---
date: 2026-05-18
description: Apparatus generates rich runtime data (JSONL traces, sessions, harness logs, triage notes) but treats all of it as write-only — no reader synthesizes patterns across runs, making the self-improvement loop incomplete.
---


## Core Idea

apparatus accumulates a large corpus of runtime signal — `pipeline.jsonl` traces per run, `~55` session files in `.apparat/sessions/`, triage chat-notes in `.apparat/meditations/illuminations/.triage/`, and tmux harness scratchpads under `~/.apparat/harness/`. Every write path is implemented and working. No read path exists that synthesizes across this corpus. The self-improvement loop has a missing feedback edge: the system cannot observe its own history to evolve its pipelines, prompts, or harness patterns.

The operator note that anchors this session puts it plainly: *"We should think feature that lets use mine the pipeline runs and gathered context in reasoning-memory, claude memory and harness folders and supports by suggesting harness scripts and best practices and pipeline compressions to let the pipelines and system evolve more reliable and faster harness iterations and development with these harness data."*

## Why It Matters

`runs-index.ts` already parses every `pipeline.jsonl` into structured `RunSummary` records — outcome, duration, failed node, pipeline name. This logic exists for `pipeline list <name>` (Layer 2 zoom). It is never read by any agent. The `meditate` pipeline's `read_vision` + `read_notes` nodes feed the analyst agent, but neither supplies run history. The analyst is therefore blind to which nodes fail repeatedly, which pipelines run slow, and what validation-failure classes recur.

`.apparat/sessions/` holds ~55 session files written by `memory-writer` after each implementation cycle. Each records what was built, key decisions, and gotchas. Nothing reads across them. A human reading five consecutive sessions would immediately spot recurring patterns (e.g., "validator and runtime disagreed on defaults" appears in at least two sessions). An agent with the same view could surface these as compression or spec candidates.

The triage chat-notes (`.apparat/meditations/illuminations/.triage/*/chat-notes.md`) are structured — "What the user raised" / "Conclusions reached" / "Open questions" — and rich. They record the actual friction points in development sessions. They have never been read as a corpus.

This is a locality failure: three related data sources (runs, sessions, triage notes) that could drive pipeline evolution are scattered with no seam forcing them to agree or be read together.

## Revised Implementation Steps

1. **Add `read-runs.mjs` to `src/cli/pipelines/meditate/`** — a tool-node script that reads `.apparat/runs/` via the same logic as `runs-index.ts`, groups by pipeline name, and emits a compact JSON digest: last N runs per pipeline with outcome, duration, and failed node. Output key: `runs_digest`. Keep it small — the analyst needs signal, not raw JSONL.

2. **Wire `read_runs` into `meditate/pipeline.dot`** — insert a `[type="tool", script_file="read-runs.mjs", produces_from_stdout=true]` node between `read_notes` and `meditate`. The meditate agent then receives `$runs_digest` alongside `$read_vision.vision` and `$read_notes.notes`.

3. **Update `meditate.md` prompt** — add a `<read_runs_runs_digest>` input block and a short instruction: treat run history as signal for spotting flaky nodes, slow pipelines, and validation-failure hotspots. The analyst already knows how to reason across context; it just needs this input declared.

4. **Add a stimulus lens `pipeline-run-patterns-as-signal.md`** — a lens that teaches the meditate analyst to interpret run data specifically: "a node that fails in >30% of runs is a compression candidate or needs a retry wrapper; a pipeline with avg duration >20min is a parallel-scheduling candidate; a recurring `validation-failure` on the same node points at a schema mismatch in the agent's prompt."

5. **Later (separate pipeline): `mine` bundled pipeline** — a heavier agent that reads `sessions/` and `.triage/*/chat-notes.md` across all projects, extracts recurring gotchas and open questions, and produces a structured report: harness patterns to promote to `docs/harness/`, recurring failure modes to convert to stimuli, and pipeline node sequences that appear redundant across multiple runs (compression candidates). This is the "suggest harness scripts and best practices" half of the note — keep it out of meditate to preserve meditate's reflective simplicity.
