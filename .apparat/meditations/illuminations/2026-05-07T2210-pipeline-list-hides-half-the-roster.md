---
date: 2026-05-07
description: `pipeline list` enumerates only `<project>/.apparat/pipelines/` — the bundled tier (implement/janitor/meditate) is runnable by name yet invisible to listing, so a freshly `apparat init`-ed project reports "no workflows found" while three are reachable, and the resolver+listing are duplicate two-tier knowledge with no shared seam.
---

## Core Idea

`apparat pipeline list` walks `<project>/.apparat/pipelines/` only. The resolver (`src/cli/lib/pipeline-resolver.ts:resolvePipelineArg`) walks **both** tiers — project-local folder, project-local flat, then bundled fallback. So `apparat pipeline run janitor` works on a brand-new project, but `apparat pipeline list` on the same project says "No workflows found" and points the user at a non-existent `pipeline create`. The two-tier inventory promised in `CONTEXT.md §Project-local layout` and in `VISION.md §The shape` is implemented in the runtime resolver and contradicted in the discovery surface — the human sees only half the roster.

## Why It Matters

Concrete observations:

- **Discovery void after `init`.** `apparat init my-app && cd my-app && apparat pipeline list` returns `No workflows found in .../pipelines/.\nCreate one with: apparat pipeline create <name>` (`src/cli/commands/pipeline/list.ts:23-28`). Yet `apparat pipeline run meditate --project .` resolves through `resolveBundledPipeline` (`src/cli/lib/assets.ts:34-41`) and runs. The CLI's two surfaces disagree about what exists.
- **Bundled inventory is a tribal-knowledge artefact.** The names `implement`, `janitor`, `meditate` (`src/cli/pipelines/{implement,janitor,meditate}/pipeline.dot`) are advertised in three drift-prone channels: `README.md` body, `program.ts addHelpText` (`src/cli/program.ts:18-46`), and `src/cli/skills/apparatus/pipelines.md`. None of them is queryable; all of them rot out of step with `src/cli/pipelines/`.
- **Shallow-module symptom.** The resolver's two-tier walk and `pipelineListCommand`'s one-tier walk are the same concept implemented twice — exactly the parallel-implementation drift the `deep-modules-hide-complexity` stimulus warns against. There is no seam (`listAllPipelines(project)`) forcing them to agree. When a fourth bundled pipeline lands, only the resolver picks it up automatically; `list` stays mute until someone remembers to update it (which today is "never," since `list` doesn't even iterate bundled).
- **Crosses the existing CRUD illumination without overlapping.** `2026-05-07T1938-authoring-loop-cold-and-templates-empty.md` covers C/U/D verbs and the `pipeline fork` move. This is the **R** for tier 1 — bundled — which the prior illumination explicitly scoped *out* ("the prior illumination covered the R … list, show, trace, runs, replay"). It did not. `list` is half-blind on R.
- **Vision-aligned.** `VISION.md` says pipelines live in two tiers and a project can fork from bundled. Forking presupposes you can *see* the bundled inventory. Today the operator types `apparat pipeline run <something-they-half-remember>` and reads the error — the bundled fallback's error message ("Bundled pipeline not found: …") is the closest thing apparat has to a catalogue.
- **Daemon side-effect.** `apparat heartbeat list` shows scheduled tasks, some of which point at bundled pipeline names that `pipeline list` never surfaces. A scheduled `janitor` heartbeat is invisible to anyone reading the project's pipelines via `list`.

The fix is small and concentrates change at one seam: hoist the resolver's two-tier walk into a shared inventory function and have `list` render it. Same depth as the deep-module move recommended by the stimuli — caller learns one symbol (`pipeline list`), gets the whole roster.

## Revised Implementation Steps

1. **Add `listAllPipelines(project): Pipeline[]` in `src/cli/lib/pipeline-resolver.ts`.** Returns `{ name, origin: "bundled" | "local-folder" | "local-flat", absPath, goal, inputs, hasFork }`. `hasFork` is true for a bundled entry whose name also exists project-local — the seam where fork-detection lives. One iteration over `getPipelinesDir(project)` + one over `getBundledPipelinesDir()`. ~30 lines.
2. **Rewrite `pipelineListCommand` to render that inventory.** Group by origin (`Local` then `Bundled`), mark forks (`janitor (forked → local)` / `janitor (bundled)`), keep `--brief` (TBD from the mission-control plan) shape stable for scripts. Fix the lying `apparat pipeline create <name>` hint while in the file (also called out in `2026-05-07T1938-authoring-loop-cold-and-templates-empty.md` — this rewrite is the natural moment to drop it).
3. **Surface caller-var contracts inline.** The current `requires: …` line prints names only. Read each pipeline's agent frontmatter (`src/cli/lib/agent-loader.ts`) and pull descriptions from `inputs:` / `outputs:` blocks. One indented line per declared input keeps `list` glanceable. If no description, omit — never lie.
4. **Make `program.ts addHelpText` and `pipelines.md` link to the inventory instead of paraphrasing it.** The help block (`src/cli/program.ts:18-46`) hand-lists `meditate`, `implement`, `pipeline workflow.dot`. Replace with a one-line `Run 'apparat pipeline list' to see available pipelines (bundled + local).` Eliminates one of the three drift channels.
5. **Test that bundled+local enumeration matches resolver behaviour.** A vitest case under `src/cli/tests/pipeline.test.ts`: for every name returned by `listAllPipelines`, `resolvePipelineArg(name, project)` must succeed. Closes the seam — drift between the two surfaces becomes a red test, not a silent UX bug.
6. **Stretch: `--origin bundled|local|all` flag** for scripted querying. Default `all`. Scripts that today grep `Pipelines in …/` can pin `--origin local` and keep working; new scripts get the unified view.
