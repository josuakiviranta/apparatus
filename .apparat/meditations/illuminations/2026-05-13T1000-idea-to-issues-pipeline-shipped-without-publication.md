---
date: 2026-05-13
description: A complete .apparat/pipelines/idea-to-issues/ pipeline (5 agents + topological-sort publish script) has zero references in README, CONTEXT.md, tests, or ADRs — a third undeclared-pipeline symptom on 2026-05-13 driven by over-build rather than over-cleanup, and it silently introduces GitHub Issues as a third work-substrate without a CONTEXT.md seam forcing the three substrates to agree.
---

## Core Idea

`.apparat/pipelines/idea-to-issues/` is a fully-shaped pipeline — DOT graph, five agents (`grill`, `write_prd`, `slice_to_issues`, `approve_breakdown`, `implement_from_issues`), one tool node, and a 70-line topological-sort publish script — and it has **zero references outside its own folder**: not in `README.md`, not in `CONTEXT.md`, not in any test under `src/cli/tests/`, not in any ADR, not in MEMORY.md. The only external mention is one survey datapoint in illumination `2026-05-12T2354-model-and-thinking-as-first-class-frontmatter.md` confirming its agents run `model: opus` like every other agent in the workspace. The operator has no surface that says "this pipeline exists and is invocable."

This is the third orphan-pipeline finding on 2026-05-13 (alongside T0900 `pipelines/smoke/` and T0931 `.apparat/scenarios/` 14-of-17), but with the polarity flipped: those two are *under-cleaned* leftovers from a rename — this is an *over-built* artefact shipped without publication ceremony.

## Why It Matters

`comprehensive-docs-are-agent-fuel.md` says docs are compressed context that lets a caller use a module correctly without reading its source. Here the inverse runs at full strength: a future operator (or a future agent invoked against this repo) cannot discover that `idea-to-issues` exists, what it accepts, or whether it is stable. The README's `## Commands` section lists `init`, `implement`, `meditate`, `pipeline run/validate/show/explain/trace`, `status` — and only the two implementation pipelines get a "where to look" callout. `idea-to-issues` is invocable via `apparat pipeline run .apparat/pipelines/idea-to-issues/pipeline.dot --project <folder>` but no operator surface advertises that string.

Worse, `idea-to-issues` silently introduces a **third work-substrate** alongside the two already canonicalised in CONTEXT.md:

| Pipeline | Work substrate (where the loop pulls its next unit from) |
| --- | --- |
| `illumination-to-implementation` | `<project>/.apparat/meditations/illuminations/` (one file = one unit) |
| `parallel-illumination-to-implementation` | chunked plan + `<plan_path>.dag.json` (one chunk = one unit) |
| `idea-to-issues` | **GitHub Issues** filtered by `--label needs-triage` + `## Blocked by` parsing (one issue = one unit) |

CONTEXT.md has glossary entries for **Illumination lifecycle**, **dag.json**, **batch_orchestrator**, **plan_scheduler** — but no "Work substrate" or "Work queue" abstraction that forces the three to agree on:

- how the next unit is selected (lowest-numbered eligible issue / `consume` reason / DAG topo-order)
- how a unit is marked done (`gh issue close` / `consume` `git rm` / `dag.json` mutation)
- how dependencies between units are expressed (`## Blocked by #<n>` body section / N/A / `blocked_by: ["c1", "c2"]` JSON)

This is the "concept implemented twice with no single seam forcing them to agree" smell from `deep-modules-hide-complexity.md`, except it is implemented **three times** now, one of those times in a pipeline no documentation acknowledges. The vision file says "the bundled `illumination-to-implementation` pipeline is the canonical example" of the web/spider pattern — but `idea-to-issues` is structurally the same shape (deep-loop eating a backlog) against a different substrate, and the vision has not been updated to name that as a pattern.

Concrete vocabulary `idea-to-issues` introduces with no CONTEXT.md home: **tracer-bullet vertical slice**, **AFK** / **HITL** label policy (`afk` = no human needed, `hitl` = architectural decision required), **needs-triage** label as the eligible-queue marker, **blocked-by topo-sort at publish time** (the `publish_issues.mjs` script resolves 0-based slice indices to real GitHub issue numbers in dependency order). A future agent reading any one of those four agent `.md` files cannot anchor those terms to a glossary.

## Revised Implementation Steps

1. **Decide whether `idea-to-issues` ships or retires.** Open one of the two doors. If it ships, steps 2–5 apply. If it retires, delete the folder + update MEMORY.md's "What This Project Is" if anything implies it survives. No middle ground — undocumented operational pipelines are the worst of both worlds.

2. **Add a `## Idea → Issues pipeline` section to README.md.** Mirror the shape of the existing `### Parallel illumination-to-implementation pipeline` section: one-paragraph summary, invocation block, requirements (needs `gh` CLI authenticated against the project's repo, `needs-triage` / `afk` / `hitl` labels must exist), and the explicit `pipeline run` command. The `## Where to look` bullet for `.apparat/pipelines/` should name `idea-to-issues` alongside the two implementation pipelines.

3. **Promote "work substrate" to CONTEXT.md.** Add a glossary entry that names the three substrates in use today (illuminations folder, chunked plan + dag.json, GitHub Issues) and the four decisions each must answer (select-next, mark-done, declare-dependency, declare-blocked). Cross-link from each of the three pipelines' agent files so the next pipeline a future operator authors picks a substrate consciously instead of inventing a fourth. Also surface the three new vocab items from `idea-to-issues` — `tracer-bullet vertical slice`, `AFK / HITL labels`, `needs-triage`.

4. **Add `pipeline-idea-to-issues-folder.test.ts` under `src/cli/tests/`.** Cover at minimum: (a) `pipeline validate` passes; (b) `pipeline explain` renders without unresolved placeholders; (c) the `publish_issues.mjs` topological sort handles a 3-issue chain `A -> B -> C` and rejects a cycle with exit 3. The other two project-local pipelines already have folder-level tests of this exact shape — this one is the gap.

5. **Write a one-paragraph ADR — `docs/adr/0016-publication-ceremony-for-new-pipelines.md`.** Codify the checklist any new pipeline (bundled or project-local) must clear before merge: README section, CONTEXT.md glossary entries for new vocabulary, `pipeline-<name>-folder.test.ts`, work-substrate declaration. The ADR is the seam that prevents the next polished-but-invisible pipeline from landing the same way. This pairs naturally with the `apparat sweep` / janitor work proposed in T0805 — the publication checklist is the *forward* hygiene, the sweep is the *backward* hygiene.

6. **Tier the agents per T2354 while you are in the folder.** `approve_breakdown.md` is a gate (no model), `write_prd.md` (≈50 lines, mechanical) and `slice_to_issues.md` (≈70 lines, mostly format work) are sonnet candidates; only `grill.md` and `implement_from_issues.md` clearly earn opus. Doing this in the same PR keeps the publication ceremony from being a pure docs ship — it also pays its way in token cost on first invocation.
