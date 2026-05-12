---
date: 2026-05-12
description: The pipeline tail runs two opus agents (memory-writer + memory-reflector) coupled by a write-only sessions/ file that has 48 entries and zero readers — collapse to one tail node and stop running opus for mechanical work that sonnet can do.
---

## Core Idea

Two open notes are actually the same architectural drift. `.apparat/notes.md` says:

> - [ ] We should think how to pipelines' agents frontmatters could decide which model to use. -> Faster pipeline runs + less token consumption.
> - [ ] We should get rid off memory-writer writing memories in .apparat session folder -> no one is reading these sessions so these are useless.

Survey of `pipelines/*/*.md` confirms **27/27 agents run `model: opus`** — no tiering, no sonnet, no haiku. And the tail node `memory-writer` exists only to produce a file at `$project/.apparat/sessions/YYYY-MM-DD-<slug>.md` (`memory-writer.md:49`) that one downstream agent reads once (`memory-reflector.md:22,47`) and never reads again — 48 files in `sessions/` today, zero grep hits anywhere else in `pipelines/` or `scenarios/`. The "session memory" is a write-only intermediate dressed as durable documentation, and both ends of the funnel pay the opus tax for it.

## Why It Matters

The tail of `illumination-to-implementation.dot` runs two opus agents back-to-back: `memory_writer -> memory_reflector -> done`. What each actually does:

- **memory-writer (opus, 171 lines of spec):** derive a filename, scan `apparat pipeline trace`, write a structured markdown file, `git add -A && git commit`, `git push`, call `consume_plan` + `consume`, emit JSON. Of those, only "scan trace and distill learnings" is reasoning — the rest is mechanical. The output that downstream cares about is one outputs field (`memory_path: string`).
- **memory-reflector (opus):** consume that file, decide whether to write zero or one illumination. Its hard rule (`memory-reflector.md:47`) is "Do not re-open the raw `pipeline.jsonl` trace; if the memory file lacks signal, that signal is gone for your purposes." So the trace gets distilled by one opus agent, dumped to disk, then re-read by another opus agent — and that disk file is the *entire reason* there are two nodes instead of one. It is glue, not artefact.

This is exactly the "shallow module" / "no single seam forcing them to agree" smell from the prior illumination `2026-05-12T1020-interaction-driver-record-is-noop-padded.md`: the interface (a 170-line spec for a markdown file format) is wider than the implementation (a struct memory-reflector reads once). Plus shallow control flow — the DAG pretends these are two independent concerns when they're one tail step.

The model question composes with this. Other clear over-tier hits surfaced in the survey:

- `illumination-to-implementation/task.md` — **16 lines total, opus.** Almost certainly sonnet work.
- `chat-summarizer.md` (61 L), `chat-refiner.md` (57 L) — short transform/summarize roles.
- `memory-writer.md` (171 L) — long but procedurally so. Trace-scan + commit/push + JSON emit is sonnet-shaped work.

Heavy reasoning agents (`verifier`, `design-writer`, `plan-writer`, `change-explainer`, `memory-reflector`, `implement`) earn opus. The flat-tier choice was a *type-system-style convenience* — same shape applied uniformly — not a per-node cost decision. Every clean run pays roughly 2× opus tokens at the tail for no observable user benefit, and every busy day on the meditate pipeline writes another file to a folder no one opens.

## Revised Implementation Steps

1. **Pass distilled learnings via `outputs`, not a file.** Add `outputs.learnings_summary: string` (or `learnings: string | null`) to `memory-writer`'s frontmatter and have it emit the structured trace digest there directly. `memory-reflector.md`'s input list flips from `memory_writer.memory_path` to `memory_writer.learnings_summary`. The session-file write becomes optional debug output only — not a contract.

2. **Collapse the tail into one node, default `model: sonnet`.** Replace `memory_writer -> memory_reflector` with a single `finalize` node that: (a) reads the trace and distills learnings; (b) commits + pushes; (c) calls `consume_plan` and `consume`; (d) decides whether to write zero or one illumination. The mechanical bulk drops the model floor to sonnet; the one reasoning sub-task ("does this run warrant a new illumination?") stays narrow enough that sonnet handles it — and if quality drops, the override lives on one node's frontmatter, not two. Mirror the change in `parallel-illumination-to-implementation/pipeline.dot` since it carries the same tail.

3. **Stop writing to `.apparat/sessions/` by default.** Delete the unconditional write in `memory-writer.md:49`. If the consolidated `finalize` node wants a debug artefact, gate it behind an opt-in (`debug_session_file=true` on the node, or a `--keep-session-file` flag on `apparat pipeline run`). Today the folder is dead-letter storage — 48 files, zero readers. New folder convention: keep `sessions/` if a future reader emerges, but stop adding to it from the pipeline. Update the janitor sweep (`scenarios/...janitor*`) to optionally GC stale entries.

4. **Tier the other obvious over-spec hits.** In one pass, change `model: opus` → `model: sonnet` on `task.md`, `chat-summarizer.md`, `chat-refiner.md`. Keep opus on `verifier`, `design-writer`, `plan-writer`, `change-explainer`, `implement`, and the new `finalize` node only if its reasoning sub-task is retained. Add a one-line ADR under `docs/adr/` (or whatever today's convention is — survey turned up no `docs/adr/` in the apparat workspace yet) recording the **tiering principle**: opus for "decide / design / verify under ambiguity"; sonnet for "summarize / transform / format / mechanical glue."

5. **Make the choice explicit in `chunk.dot` validation.** Extend the graph validator (the one that already enforces `outputs:` and `inputs:` per the recent pipeline-redesign chunks) to require every `agent=...` node to set `model:` explicitly — no implicit default. Forcing the author to pick a tier per node prevents the next "uniform opus" drift from happening silently. Surface the per-run total token estimate per tier on `apparat pipeline trace` so the tiering choice has visible feedback.

6. **Validate against this run.** Replay the most recent `illumination-to-implementation-*` run (`runs/parallel-illumination-to-implementation-df1d9cf6/` is a good candidate) through the collapsed tail offline. Confirm: same illumination decision, no commit/push regression, no `consume`/`consume_plan` regression, no session file written. The smoke is the existing `interaction-driver-escape` scenario plus a new `finalize-no-session-file` scenario asserting the dead folder stays dead.

## Provenance

- Source notes: `.apparat/notes.md` (two open items — model selection per agent, and remove session-folder writes).
- Source files surveyed: `pipelines/illumination-to-implementation/memory-writer.md`, `pipelines/illumination-to-implementation/memory-reflector.md`, `pipelines/illumination-to-implementation/pipeline.dot`, all `pipelines/*/*.md` frontmatter, `.apparat/sessions/` folder (48 files, no readers).
- Pipeline run id: `meditate-4ab00e87`
- Surfaced by: meditate
