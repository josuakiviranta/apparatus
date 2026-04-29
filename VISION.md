# ralph-cli — Vision

## One-line

A per-folder agentic harness that gets the user's mental model out of their head and onto disk, so agents stay on the same wavelength across sessions.

## What it is

A per-folder agentic harness. Point ralph at any project folder; it stores the pipelines that orchestrate agents, the run history, and the mental model behind the work — so you can pick the project up weeks later and still feel on the same wavelength.

## Who it's for

Workflow designers first — people building reusable agentic systems for their own projects. Solo devs running long autonomous AI loops benefit. Tech leads orchestrating AI on real work benefit. But the harness is shaped for the person authoring pipelines, not just running them.

## Why it exists

Managing many projects with many agents exceeds working memory. Re-explaining the same context to an agent every session is exhausting. Pipelines, meditations, illuminations, and per-project state exist for one reason: **get the user's mental model out of their head and into ralph**, so agents can carry it from there.

When it works, talking to a ralph agent feels like talking to someone on your wavelength who is already focused on the same problem. That feeling is the goal.

## The shape

Pipelines are the **web**: a graph of agents and information flow, each agent doing one job, some iterating deeply ("spider" agents that eat their way through a backlog). The bundled `illumination-to-implementation` pipeline is the canonical example.

Each project folder gets its own bespoke web. Authoring and refining pipelines is cheap (`pipeline create`, `pipeline refine`).

## What it is not

- **Not a Claude Code replacement.** Claude is the muscle; ralph is the choreography.
- **Not multi-tenant.** Single human, single machine — cloud is a future, not a current goal.
- **Opinionated, but extensible.** The primitives are fixed; what you build inside them is yours.
