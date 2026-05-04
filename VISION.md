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

Pipelines live in two tiers:

- **Bundled** (`src/cli/pipelines/` in the ralph-cli npm package) — generic, cross-project pipelines like janitor and meditate.
- **Project-local** (`<project>/.ralph/pipelines/`) — pipelines a specific project owns, can fork from bundled, and can have meditation iterate on.

A target project declares itself ralph-shaped by having a `.ralph/` folder. That folder is the single home for everything ralph-touchable in the project: pipelines, meditations (illuminations + stimuli), memory, ADRs, CONTEXT.md, VISION.md, run state. Agents inside the project read everything from one place — no user-home boundary to cross.

See `.ralph/docs/adr/0007-ralph-folder-as-project-local-home.md` for the full layout.

## What it is not

- **Not a Claude Code replacement.** Claude is the muscle; ralph is the choreography.
- **Not multi-tenant.** Single human, single machine. No cloud, no teams, no shared state.
- **Opinionated, but extensible.** The primitives are fixed; the graphs you build with them are yours.
