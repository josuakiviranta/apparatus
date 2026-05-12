---
date: 2026-05-12
description: illumination-to-implementation writes to six durable destinations but only two have consume seams — specs/ (29 files), .triage/ chat-notes (15 dirs), sessions/, runs/ all accumulate forever; lift the fix from "collapse the tail" to a frontmatter `lifecycle:` declaration validated at graph load (every write needs its pair).
---

## Core Idea

`illumination-to-implementation/pipeline.dot` writes to six durable destinations but only two have consume seams. `plans/` and `meditations/illuminations/` get explicitly deleted via `consume_plan` + `consume` calls in `memory-writer.md` step 7. The other four — `docs/superpowers/specs/*-design.md`, `.apparat/meditations/illuminations/.triage/<uuid>/chat-notes.md`, `.apparat/sessions/*.md`, `.apparat/runs/*` — have no pair. They grow forever. Specs alone: 29 files. Chat-notes triage: 15 subdirs (oldest from 2026-05-06, today is 2026-05-12). The asymmetry is the root cause, not any individual folder.

## Why It Matters

The illumination shipped 10 minutes ago (`2026-05-12T1028-collapse-memory-tail-and-tier-pipeline-models.md`) treated this at the leaf — collapse `memory_writer + memory_reflector`, stop writing `.apparat/sessions/`. That fix is correct but partial. The same drift pattern repeats one layer up:

- `design_writer` (`pipeline.dot:25`) writes `docs/superpowers/specs/YYYY-MM-DD-<slug>-design.md` every run. No consume tool exists — `memory-writer.md` lists only `mcp__illumination__consume_plan` + `mcp__illumination__consume` in its `tools:`, no `consume_design`. 29 files accumulated since 2026-05-05.
- Grill-me / design-review workflows added a second file per work item (`...-design-review.md`, `...-review.md`). Now there are *two* spec files per illumination, both immortal — today's `2026-05-12-interaction-kinds-need-deep-drivers-design.md` ships with `2026-05-12-interaction-kinds-need-deep-drivers-design-review.md` alongside, and `2026-05-07-stimuli-rename-and-project-local-only-design.md` ships with `2026-05-07-stimuli-rename-review.md` alongside. The pattern is now structural, not incidental.
- `chat_session` + `chat_summarizer` (`pipeline.dot:31,33`) write `.apparat/meditations/illuminations/.triage/<uuid>/chat-notes.md`. The 15 dated subdirs show every chat exchange since 2026-05-06 still parked there. The pipeline reads them once between `chat_summarizer -> verifier|explainer` (`pipeline.dot:69-70`) and then never again — pure intra-run handoff dressed as durable storage.
- `.apparat/runs/` and `.apparat/sessions/` already filed (`2026-05-10-runs-folder-is-an-opaque-graveyard.md` and the just-shipped tail-collapse).

The stimulus `open-close-push-pull-lock-unlock.md` puts it bluntly: *Open needs close. Subscribe needs unsubscribe. Agents write what opens. You have to demand what closes.* The pipeline DAG is the API and right now it lets nodes subscribe (write artefacts) without forcing them to declare unsubscribe (consume path). The pipeline-redesign chunks 1–2 already taught the validator how to enforce `outputs:` / `inputs:` flow; this is the natural next axis on the same machinery. Today the janitor (`src/cli/pipelines/janitor/janitor.md`) is explicitly read-only — by design it cannot clean these up, so accumulation continues unbounded.

This also composes with the prior illumination's tiering proposal: tiering changes per-run *cost*, but pair-coverage changes per-run *durability footprint*. Both are needed. Cost without durability still leaks. The two illuminations are intended to land together.

## Revised Implementation Steps

1. **Add a `lifecycle:` block to agent frontmatter.** Three values: `artefact: <relative-path-glob>` declares one or more durable files this node writes (e.g. `docs/superpowers/specs/*-design.md` for `design_writer`); `consume_via: <node_id>` names the downstream node that must clean them up; `ephemeral: true` opts out (file lives under `.apparat/runs/<run_id>/` and is GC'd by the existing run-folder janitor). Mirror the existing `outputs:` / `inputs:` ergonomics — same parser, same validator pass.

2. **Extend the graph validator with an artefact-flow rule.** For every node N with `lifecycle.artefact:` and no `ephemeral: true`, there must be a graph path from N to its declared `consume_via` node, and that consume node must call a tool with `reason="implemented"` or `reason="declined"` on a path argument matching N's artefact glob. Re-use the flow analysis the redesign already uses for `inputs:` — do not duplicate. Failure mode: `validator: design_writer writes docs/superpowers/specs/*-design.md with no consume seam reachable from this node`.

3. **Ship a `consume_design` MCP tool symmetric to `consume_plan`.** Same shape as `.apparat/pipelines/illumination-to-implementation/consume.mjs` — `rm` + `git rm` + commit message `meditate: consume <filename> (<reason>)`. Wire it into `memory-writer.md` step 7c (or into the collapsed `finalize` node proposed in the prior illumination — they merge cleanly). Apply it when `tmux_tester.test_result != "fail"`, same gate as the plan and illumination consumes. Treat design-review files as a sibling pair: if `consume_design <slug>-design.md` succeeds, also try `<slug>-design-review.md` and `<slug>-review.md` best-effort.

4. **Move chat-notes under the run folder.** `.apparat/meditations/illuminations/.triage/<uuid>/chat-notes.md` does not deserve a permanent home — its only reader is the next node in the same run. Repath to `.apparat/runs/<run_id>/chat-notes.md` (already where the run trace lives), mark `lifecycle: ephemeral`, and let the existing runs-folder GC reclaim it. Drops the `.triage/` directory entirely. Update `chat-refiner.md` and `chat-summarizer.md` write paths; no validator change needed once step 1 lands.

5. **GC pre-existing accumulation in one pass.** Match each spec slug against `git log --oneline | grep "consume.*implemented"` to find specs whose plans already shipped. Delete those (likely ≥20 of 29). Delete all 15 `.triage/<uuid>/` directories — every chat-notes payload predates today and has no live reader. One commit, `chore(lifecycle): clean pre-protocol artefacts`. Anything ambiguous stays for human triage.

6. **Add ADR-0015 codifying the rule.** "Every durable pipeline artefact has a consume seam." Cite `docs/adr/0002-consume-only-illumination-lifecycle.md` as the precedent — that ADR established the pattern for illuminations; this one generalizes it to all node outputs. Use open/close/push/pull as the design rationale. Make it the rule future pipeline authors check before adding a node.

7. **Re-validate the parallel pipeline.** `pipelines/parallel-illumination-to-implementation/pipeline.dot` carries the same tail plus `batch_orchestrator`, `plan_scheduler`, and `merge_resolver` — each likely to add write surfaces of its own. Re-run the validator from step 2; expect new errors that surface its consume gaps the same way. The parallel pipeline is the canary because it fans out: any missing consume seam there leaks N× faster than in the linear pipeline.

## Provenance

- Source notes: `.apparat/notes.md` — anchored on the second open note ("get rid of memory-writer writing memories in `.apparat` session folder — no one is reading these sessions"). The prior illumination at 2026-05-12T1028 already addressed that note tactically; this illumination lifts it from "kill one folder" to "every write needs its pair" and applies the same lens to `specs/` and `.triage/` where the equivalent drift is already visible.
- Source files surveyed: `.apparat/pipelines/illumination-to-implementation/pipeline.dot`, `memory-writer.md`, `memory-reflector.md`, `consume.mjs`, `docs/superpowers/specs/` (29 files), `docs/superpowers/plans/` (20 files, oldest 2026-04-30), `.apparat/sessions/` (47 files), `.apparat/meditations/illuminations/.triage/` (15 subdirs), `src/cli/pipelines/janitor/janitor.md` (read-only by design, does not consume).
- Stimulus: `open-close-push-pull-lock-unlock.md`.
- Pipeline run id: `meditate-9666f5dd`.
- Surfaced by: meditate.
