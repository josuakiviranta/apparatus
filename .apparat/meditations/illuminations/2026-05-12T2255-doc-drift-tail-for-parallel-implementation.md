---
date: 2026-05-12
description: Replace the parallel-implementation memory-writer + memory-reflector tail with a doc-drift checker that audits README.md / CONTEXT.md / docs/adr/ after each ship — kill the dead .apparat/sessions/ write entirely.
---

## Core Idea

After `parallel-illumination-to-implementation` ships code, the tail should answer one question: *did this change just invalidate any project doc?* — not *write another session file no one reads, then maybe spawn an illumination.* Replace `memory_writer -> memory_reflector` with a single `doc_checker` node that diffs the post-implementation tree against `README.md`, `CONTEXT.md`, and `docs/adr/*.md`, and either patches stale references or surfaces them. Drop the `.apparat/sessions/` write entirely. Keep the opportunistic `consume_plan` / `consume` calls but move them onto the new node.

## Why It Matters

`.apparat/notes.md` (open, verbatim):

> - [ ] In pipelines/parallel-illumination-to-implementation/ instead of using memory writer and memory reflector  in the tail there should be a node that checks that README.md and other documentations are up to date after the changes. We could get rid off the memory-writer node. No one reads .apparat/sessions folder so that is just burning tokens with memory_reflector node (and taking time).

Today's tail in `.apparat/pipelines/parallel-illumination-to-implementation/pipeline.dot:65-73` is:

```
tmux_confirm_gate -> memory_writer -> memory_reflector -> done
```

What each opus agent actually does:

- **memory_writer** (`memory-writer.md`, 171 lines, `model: opus`) — derives a filename, runs `apparat pipeline trace $run_id`, writes a structured markdown file to `$project/.apparat/sessions/YYYY-MM-DD-<slug>.md` (line 49), `git add -A && git commit && git push`, calls `consume_plan` + `consume`, emits one outputs field (`memory_path: string`). Only the trace-scan step is reasoning; the rest is mechanical.
- **memory_reflector** (`memory-reflector.md`, `model: opus`) — consumes the file memory_writer just wrote and decides 0 or 1 illumination. Hard rule at line 47: *"Do not re-open the raw `pipeline.jsonl` trace; if the memory file lacks signal, that signal is gone for your purposes."* The reflector exists *because* memory_writer dumps to disk first; the disk file is the entire reason there are two nodes.

The earlier illumination `2026-05-12T1028-collapse-memory-tail-and-tier-pipeline-models.md` already argued for collapsing the two into one finalize node that *still* emits reflection-on-illumination. This open note pushes further: kill the reflection arm entirely, replace with the question that actually pays its tokens — *"does any project doc now lie about behavior we just shipped?"*

Three reasons this is the right swap:

1. **`.apparat/sessions/` has 48 entries and zero downstream readers.** Grep across `pipelines/*` and `scenarios/*` for `sessions/` references hits nothing. Every commit to that folder is dead-letter storage; the project ships memory it never reads back.
2. **`README.md` / `CONTEXT.md` / `docs/adr/` have many readers.** Every fresh Claude session, every meditate, every grill-with-docs starts by reading these. `README.md:174-180` literally encodes the current tail shape ("verification + memory tail … memory_writer → memory_reflector") as user-facing prose — any pipeline structural change today silently invalidates it. `CONTEXT.md` glossary terms (e.g. *Session-closure file*) cross-reference each other; renaming one node bit-rots three entries.
3. **Doc-drift is exactly the texture agents handle well** — read diff, grep stale terms, propose patches. Same shape as `change-explainer.md` already does at the head of the pipeline (diff → plain-English summary), now mirrored at the tail (post-impl diff → doc-patch list). Reflector's "should I surface an illumination?" duty is already covered by the heartbeat-scheduled janitor (`src/cli/pipelines/janitor/janitor.md`), which scans the whole workspace continuously — running a second illumination-surfacing pass inline is redundant opus work while the bigger doc-drift wound stays open.

Composes with the prior illumination's model-tiering principle: this tail is `model: sonnet` work (mechanical with one bounded judgment step), not opus.

## Revised Implementation Steps

1. **Author `doc_checker.md` next to `pipeline.dot`** in `.apparat/pipelines/parallel-illumination-to-implementation/`. `model: sonnet`. Inputs: `capture_pre_sha.pre_sha`, `plan_writer.plan_path`, `design_writer.design_doc_path`, `verifier.illumination_path`, `tmux_tester.test_result`. Body: run `git diff --name-status $pre_sha HEAD`; classify each changed path against four drift surfaces (CLI command surface, agent frontmatter shape, CONTEXT.md glossary terms, ADR-referenced concepts); grep `README.md` / `CONTEXT.md` / `docs/adr/*.md` for the now-stale references; propose patches as inline edits; `git add -A && git commit -m "docs: post-impl drift sweep" && git push` if anything changed; emit `{ "drift_found": <bool>, "patched_paths": [...] }`. If `tmux_tester.test_result == "fail"`, skip the lifecycle calls (same hard gate `memory-writer.md` step 7 enforces today).

2. **Rewire the DOT.** In `pipeline.dot:65-73`, change `tmux_confirm_gate -> memory_writer -> memory_reflector -> done` to `tmux_confirm_gate -> doc_checker -> done`. Drop the `memory_writer`, `memory_reflector` node declarations. Drop `default_test_result=""`, `default_test_summary=""`, `default_illumination_path=""` defaults that only existed for the memory nodes. Move `consume_plan` + `consume` opportunistic calls (currently in `memory-writer.md` step 7) into `doc_checker.md` with identical semantics.

3. **Delete dead files in one commit.** Remove `memory-writer.md` and `memory-reflector.md` from `.apparat/pipelines/parallel-illumination-to-implementation/`. Write a one-line ADR under `docs/adr/0016-doc-drift-tail.md`: *"Pipeline tails maintain agent-facing docs; session-closure files retired in the parallel-impl pipeline."* Link the prior model-tiering illumination as related context.

4. **Update `README.md:174-180` and `CONTEXT.md`.** README: replace *"verification + memory tail (tmux_tester → tmux_confirm_gate → memory_writer → memory_reflector)"* with *"verification + doc-drift tail (tmux_tester → tmux_confirm_gate → doc_checker)"*. CONTEXT.md *Session-closure file* glossary entry: do not delete — 50+ existing files still bear the name — but mark *"Deprecated 2026-05-12; no new writes from parallel-impl tail."*

5. **Replay-validate against a recent run.** Pick `runs/parallel-illumination-to-implementation-7565cf19/` (the run that exposed `tmux-tester` self-skip-marker fragility per `2026-05-12T2243-tmux-tester-doc-only-scenario-discovery-fragility.md`). Run `doc_checker.md` offline against its diff. Confirm it would have flagged: (a) the new self-skip-marker convention landing without `README.md` mention, (b) the ADR-0007/0008 cross-references when ADR-0010 superseded them. If it misses both, sharpen the drift-classification rules in the prompt before shipping — do not weaken the test.

6. **Mirror to `illumination-to-implementation` only after one clean parallel run.** The linear `illumination-to-implementation/pipeline.dot` has the identical memory tail. Port the doc_checker via diff *after* the parallel variant has shipped one green run with no manual doc-patching afterward. Until then the linear pipeline keeps the prior `collapse-to-finalize` trajectory — running two un-validated tail rewrites in parallel risks both regressing in the same week.

7. **Re-evaluate janitor scope after doc_checker stabilises.** Today `src/cli/pipelines/janitor/janitor.md` scans for *both* KISS-lens bloat *and* indirectly for doc drift (when grilled by the operator). Once `doc_checker` catches drift inline at ship-time, janitor can shed the drift role and focus on the bloat lens it was originally written for — one less responsibility per agent.

## Provenance

- Source notes: `.apparat/notes.md` (note 3 — quoted verbatim in *Why It Matters*).
- Source files surveyed: `.apparat/pipelines/parallel-illumination-to-implementation/{pipeline.dot, memory-writer.md, memory-reflector.md}`, `README.md` (lines 174–180), `CONTEXT.md` (*Session-closure file* + *Documentation channels* entries), prior illumination `2026-05-12T1028-collapse-memory-tail-and-tier-pipeline-models.md`, prior illumination `2026-05-12T2243-tmux-tester-doc-only-scenario-discovery-fragility.md`.
- Stimuli weighed: `comprehensive-docs-are-agent-fuel.md` (docs are the agent's compressed-context substrate — keeping them accurate at ship-time pays the next session), `crud-is-a-checklist-not-a-menu.md` (shipping code without updating its docs is half a feature, just like create without delete).
- Pipeline run id: `meditate-ebe3418f`
- Surfaced by: meditate
