# ralph-cli — Vision

## One-line

Solo-developer tooling to orchestrate agents into graphs and run them against any local project.

## What it is

A personal harness for one developer (me) to author agent pipelines once and run them against any project on my machine. Pipelines are graphs of agents — each agent doing one job, some iterating until done. ralph is the engine that executes the graph; the project is the target the graph operates on.

## Who it's for

Me. One developer, one machine. Not multi-tenant, not for teams, not for end users at large. If others end up using it, that's a side effect, not a goal.

## Why it exists

Managing many projects with many agents exceeds working memory. Re-explaining context to an agent every session is exhausting. Pipelines exist to capture orchestration logic once and reuse it across projects.

When it works, running a pipeline feels like delegating to someone who already understands the shape of the problem.

## The shape

Pipelines are the **web**: a graph of agents and information flow, each agent doing one job, some iterating deeply ("spider" agents that eat through a backlog). The bundled `illumination-to-implementation` pipeline is the canonical example.

A pipeline is authored once and run against any target project via `--project <folder>`. The project is the working directory; the pipeline is the orchestration logic.

## What it is not

- **Not a Claude Code replacement.** Claude is the muscle; ralph is the choreography.
- **Not multi-tenant.** Single human, single machine. No cloud, no teams, no shared state.
- **Not per-project bespoke webs.** Earlier framing. Pipelines are cross-project; project-specificity is handled by runtime variables (`--var`), not by storing pipelines per-project.
- **Opinionated, but extensible.** The primitives are fixed; the graphs you build with them are yours.

## Open

Where pipelines should live (bundled in source, user-home library, somewhere else) and how authoring/iteration should work are still being designed. Current state of the codebase doesn't yet match this revised vision.
