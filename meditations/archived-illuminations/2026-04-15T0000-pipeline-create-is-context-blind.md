---
date: 2026-04-13
status: archived
description: ralph pipeline create teaches DOT syntax to the authoring agent but never tells it to read the target project first — producing generic pipelines that reference placeholder paths instead of real agents, real specs, and real conventions already present in the consumer project.
archived_at: 2026-04-26
reason: Steps 3 and 5 already shipped: Graph.inputs and three-tier pipeline-resolver fallback exist
---

## Core Idea

`ralph pipeline create` launches a Claude session with the full DOT grammar in its system prompt but no instruction to scan the project it's about to serve. The trigger in `pipelineCreateCommand` is `{promptContent}\n\nCreate a new pipeline named "{name}". Write it to: {dotPath}`. The agent knows shapes, edges, and attributes — but not what agents the project has registered, what its directory layout looks like, or what pipelines already exist nearby. It writes syntactically valid DOT for an imaginary project. The user then manually replaces every placeholder. `ralph new` already solved this exact problem: its `BRAINSTORM_TRIGGER` explicitly tells the kickoff agent to "Study specs/*.md and src/* in parallel using subagents to understand the project." Pipeline create has no equivalent.

## Why It Matters

Consumer projects — projects that install `ralph-cli` as a dependency and run `ralph pipeline create` — get the least value from the current authoring experience. They have no local exemplar pipelines (ralph new doesn't scaffold a `pipelines/` directory), no declaration of what agents are available, and a creation prompt that produces generic skeleton DOT. The agent might write `agent="reviewer"` when the project calls it `agent="code-review"`, or reference `specs/*.md` when the project stores specs in `docs/`. Every mismatch is friction the user absorbs manually.

By contrast, the `new.ts` `BRAINSTORM_TRIGGER` pattern proves the fix is a one-sentence addition: instruct the agent to read the project before designing. The DOT grammar in `PROMPT_pipeline_create.md` is already excellent. What's missing is the project-awareness step before the first node gets drawn.

A second gap: `scaffoldProject()` in `new.ts` creates `specs/`, `src/`, `scenario-tests/`, `scenario-runs/` — but no `pipelines/`. The first `pipeline create` in a newly scaffolded project has no local exemplar to transfuse from. The gene transfusion lens says the first transfusion is the expensive one; a thin starter pipeline in the scaffold makes every subsequent authoring session cheaper because the agent can match existing local style.

A third, quieter gap: the DOT format has no way to declare what `$variables` a pipeline expects at the graph level. Every pipeline's input contract is implicit — you must read every `$ref` in every node attribute to discover what the caller must provide. For consumer projects sharing pipelines across teams, this creates a discoverability hole.

## Revised Implementation Steps

1. **Add a project-scan trigger to `pipelineCreateCommand`** in `src/cli/commands/pipeline.ts`. Before the final `Create a new pipeline named...` instruction, append: `"First, study the project at ${project}: read pipelines/ (existing pipelines), specs/ or docs/, and list agents in ~/.ralph/agents/. Use subagents to do this in parallel. Then design and write the pipeline."` Mirror the `BRAINSTORM_TRIGGER` pattern already in `new.ts`.

2. **Scaffold a `pipelines/` directory and a `hello.dot` starter** inside `scaffoldProject()` in `src/cli/commands/new.ts`. The starter should demonstrate one `box` node and one `tool` node — thin enough to read in 10 seconds, rich enough to establish local style for subsequent create sessions.

3. **Add an `inputs` graph attribute to the DOT spec and engine parser** in `src/attractor/core/graph.ts`. Syntax: `inputs="var1, var2, var3"` on the `digraph` declaration. The engine ignores it at runtime (variables already resolve via `variableExpansionTransform`). Its value is discoverability — `ralph pipeline validate` can surface undeclared variables as warnings, and `ralph pipeline list` can display declared inputs alongside the goal.

4. **Update `PROMPT_pipeline_create.md`** to document the `inputs` attribute and instruct the agent to populate it whenever the pipeline uses `$variable` references. This costs nothing to enforce; it just becomes part of the authoring habit the creation session establishes.

5. **Add a `getBundledPipelinesDir()` function to `src/cli/lib/assets.ts`** (mirrors `getBundledAgentsDir()`) and a two-tier fallback in `pipeline-resolver.ts`: project-local first, bundled second. This completes the distribution story (already detailed in the 2300 illumination) and makes bundled starter pipelines runnable from consumer projects without manual copying.
