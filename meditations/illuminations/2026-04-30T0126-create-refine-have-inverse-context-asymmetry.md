---
date: 2026-04-29
status: open
description: pipeline create injects 200 lines of generic DOT cheatsheet but zero exemplars from the project's own pipelines/ folder; pipeline refine injects the current .dot exemplar but zero cheatsheet — the two authoring entry points have inverted context shapes and neither matches the gene-transfusion pattern that makes refinement work.
---

## Core Idea

`ralph pipeline create` and `ralph pipeline refine` are the two authoring touchpoints, and they carry **inverse** context shapes. Create injects ~200 lines of inline DOT cheatsheet and zero project exemplars. Refine injects one project exemplar (`current_dot`) and zero cheatsheet. T1100 already documented why exemplar-injection is the move that turned refine into a useful loop — yet create still hasn't adopted the pattern, and the 200-line cheatsheet duplicates `specs/pipeline.md` so it will drift.

## Why It Matters

**Create is gene-transfusion-blind.** The scaffolder at `src/cli/templates/pipeline-create/scaffolder.md:13-20` enumerates `~/.ralph/agents/` and `$pipelines_dir/*/[a-z]*.md` for the agent inventory but never opens a single `$pipelines_dir/*/pipeline.dot`. In ralph-cli, that means a new pipeline never sees `pipelines/illumination-to-implementation/pipeline.dot` — the project's canonical 20-node web with goal_gate, conditional routing, gates, tool-script externalisation, and chat-loop scope re-entry. Every `pipeline create` restarts from generic best-practices instead of matching the patterns the project has already validated. T0000 ("create is context-blind") flagged this two years ago at the agent-inventory layer; the deeper miss is the sibling-pipeline layer.

**Create over-trusts inline docs.** Lines 30–183 of `scaffolder.md` are a hand-maintained DOT reference: shape→type table, attribute table, validation rules, an annotated example pipeline. All of it is a duplicate of `specs/pipeline.md` (which is the source of truth, more recent, and more accurate — e.g. specs/pipeline.md mentions `parallel`, `parallel.fan_in`, `store`, `ralph.meditate` as live; the scaffolder cheatsheet says `component`/`tripleoctagon` are "Not yet implemented"). The cheatsheet has already drifted and will drift further. T2700 ("schema description overrides agent rubric") shows how strongly an injected wall of text dominates the agent's behaviour — yet here the wall is the entire authoring surface and it's stale.

**Refine is the asymmetric mirror.** `src/cli/templates/pipeline-refine/refiner.md` is 14 lines total — it injects `$current_dot` and `$trace_digest` and trusts the agent to know DOT. So a creator gets cheatsheet-without-exemplar; a refiner gets exemplar-without-cheatsheet. Neither matches the pattern from the gene-transfusion lens (`exemplar + tests`) or the gpt-5-prompting-guide lens (concise instructions paired with a working reference).

**Vision tie:** the vision describes pipelines as a project's bespoke web, with cheap authoring as the unlock. Authoring is only cheap if every new node inherits the existing web's vocabulary. Today, every new pipeline starts as a stranger to its siblings.

## Revised Implementation Steps

1. **Strip the 200-line cheatsheet from `scaffolder.md`.** Replace with a 5-line pointer instructing the agent to read `specs/pipeline.md` on demand if it needs DOT details. Source of truth becomes the spec; the template stays under 60 lines and never drifts.

2. **Inject sibling-pipeline exemplars into create.** Before drafting, the scaffolder should `ls $pipelines_dir/*/pipeline.dot` (mirror the inventory step that already exists for agents), summarise each by `goal=` + node count, ask the user which (if any) is the closest match, then inject that file's contents verbatim into the session as `$exemplar_dot`. If `$pipelines_dir` has no siblings, fall back to the `templates/blank/pipeline.dot` minimal example.

3. **Inject one sibling exemplar into refine.** Today `refiner.md` only sees the file under refinement. Add the same closest-sibling pick (by `goal=` text similarity or interactive prompt) so the agent has a second concrete reference for cross-pipeline conventions. Reuse the same selection helper from step 2.

4. **Auto-run `pipeline show` after a successful create.** The scaffolder ends with "validate, then describe the workflow" but never renders the SVG. After the validate-clean step, invoke `pipeline show` so the user gets a visual artifact in the same run. One CLI hop becomes zero.

5. **Add a `pipelines/smoke/pipeline-create/` smoke test.** Pipeline-create has no smoke coverage today (T2600 generalised this). The smoke should run the create pipeline against a fixture project containing one sibling exemplar and assert the agent picked it up. Without a smoke, the cheatsheet trim and exemplar injection will silently regress.

6. **Document the symmetry in `specs/pipeline.md` under "Authoring".** State the contract: create and refine both pair "thin instructions + at least one exemplar". Future authoring commands (e.g. agent-create) inherit the rule rather than repeat the asymmetric mistake.
