---
date: 2026-05-07
description: apparat init seeds zero pipelines and ships no `pipeline new` command, so the human's first authoring step is hand-mkdir + 382-line reference read + iterate-validate-until-clean — and `pipeline list`'s empty-state message lies by suggesting an `apparat pipeline create` command that does not exist.
---

## Core Idea

`apparat init` carves out an empty `.apparat/pipelines/` and walks away. There is no `apparat pipeline new <name>`, no skeleton template, no "fork-from-bundled" command — the first step of authoring is `mkdir` followed by reading a 382-line `pipelines.md` reference and hand-typing a `pipeline.dot` plus 1–N sibling `.md` files until `pipeline validate` stops yelling. Worse, `pipeline list`'s empty-state literally tells the user `Create one with: apparat pipeline create <name>` — a command that does not exist (`src/cli/commands/pipeline/list.ts:16`, `:23`). The on-ramp lies, and the docs preach a stimulus (`start-every-project-with-thin-boilerplate-template`) that the tool itself ignores.

## Why It Matters

Running a pipeline has rich affordances — `init` scaffolds five folders + skill shim + git init, `pipeline run` resolves names + checkpoints + supplies `$project`/`$run_id`, `pipeline show` renders SVG without graphviz, `pipeline trace` filters by node. But the moment you want a *new* pipeline, the affordances stop. The `dist/templates/.gitkeep` placeholder hints at template infra that was scaffolded (Chunk 5 per memory) and never wired to a CLI verb. The skill shim's authoring section reads more like a checklist than a command (`pipelines.md` §1: "Pick a folder name → Create the folder → Write `pipeline.dot` → Write sibling files → Validate → Run") — every "do this" is manual filesystem work the engine could have done with a single name argument.

For a solo human juggling many projects (the vision: "Managing many projects with many agents exceeds working memory"), the cost is friction at the moment of highest creative intent: when a new orchestration idea arrives. Forking the bundled `meditate` or `janitor` to start hacking is currently `cp -R $(npm root -g)/apparat-cli/dist/pipelines/meditate .apparat/pipelines/my-meditate/` — a path the user has to assemble themselves. Combined with the prior illumination (`2026-05-07T2210-pipeline-list-hides-half-the-roster`), the listing surface and the creation surface are *both* blind to the bundled tier.

The mission-control plan (`docs/superpowers/specs/2026-05-07-pipeline-mission-control-fragmentation-design.md`) already calls out fixing the lying hint, but it does so by **removing** the suggestion rather than **fulfilling** it — leaving the user with the same hand-mkdir on-ramp, just without the false promise.

## Revised Implementation Steps

1. **Ship `apparat pipeline new <name> [--from <bundled-or-folder>] [--project <dir>]`.** Default scaffold: `<project>/.apparat/pipelines/<name>/pipeline.dot` containing `digraph <name> { goal="…" start[shape=Mdiamond] done[shape=Msquare] start->done }`, validate-clean on first save. With `--from meditate` it copies the bundled folder verbatim and renames the digraph + agent stems. Reuses `getBundledPipelinesDir` + the existing two-tier resolver — no new lookup machinery.
2. **Replace the lying hint in `list.ts:16,23`.** Point at the new `apparat pipeline new` once it ships; until then drop the line entirely rather than naming a non-existent command. Add a regression test that empty-state output passes `apparat <hint-command> --help` to itself.
3. **Seed one starter pipeline on `apparat init`** — opt-in via flag (`apparat init --with-starter` or `apparat init my-app starter`). The starter is the same minimal `start->done` graph `pipeline new` produces. New apparat-shaped projects then have a runnable example before the user authors anything; deletion is one folder rm.
4. **Wire the templates infra to a verb.** `dist/templates/.gitkeep` plus the templates spec from Chunk 5 are dead weight today. Either delete them (YAGNI) or back the `--from <template-name>` flag with `dist/templates/<name>/` lookup so the bundled tier and the template tier converge under one shared seam.
5. **Add a one-liner fork command** — `apparat pipeline fork <bundled-name> <new-name>`. This is sugar over `cp -R + sed digraph rename`; it exists because the spider/web mental model says project-local pipelines should be cheap to derive from bundled ones. If `pipeline new --from <bundled>` covers this completely, drop `fork` — but verify the rename mechanics don't differ.
6. **Ensure the deepened `pipeline list` (mission-control plan) shows the bundled tier and the just-created starter** — closes the "create → list it back → run it" loop in three commands the user can chain in their head.
