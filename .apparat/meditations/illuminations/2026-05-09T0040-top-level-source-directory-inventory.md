---
date: 2026-05-08
description: Snapshot of the project's top-level directories — single src/ tree (attractor + cli + daemon + lib + types), pipelines split between bundled src/cli/pipelines/ and project-local .apparat/pipelines/, and docs/adr + docs/superpowers carrying decisions and specs.
---

## Core Idea

Apparatus has exactly one source root — `src/` — partitioned into five sibling packages: `attractor/` (graph engine + handlers + validators), `cli/` (commands, components, lib, bundled pipelines, MCP server, tests), `daemon/` (background scheduler/runner), `lib/` (the daemon client shim), and `types/` (ambient globals). Pipelines live in two distinct trees: bundled generic ones at `src/cli/pipelines/{implement,janitor,meditate}/` and project-local ones at `.apparat/pipelines/{idea-to-issues,illumination-to-implementation}/`. Operator scenarios sit at `.apparat/scenarios/`, ADRs at `docs/adr/`, design specs at `docs/superpowers/specs/`, and meditations (illuminations + stimuli) at `.apparat/meditations/`.

## Why It Matters

A reader landing on this repo cold sees no top-level map: `README.md` does not enumerate the source partitions, and `CONTEXT.md` is the only place where the engine/handlers/cli boundary is named. The split between `src/cli/pipelines/` (bundled, ships in npm) and `.apparat/pipelines/` (project-local, runs against this repo as a target) is load-bearing per VISION.md but invisible from a `ls src/`. Knowing the inventory is the precondition for every later illumination — every "where does X live" question routes through this five-folder decomposition.

## Revised Implementation Steps

1. Add a "Layout" section to `README.md` that names the five `src/` partitions and links to `CONTEXT.md` for the domain glossary.
2. Add a one-line header comment to each `src/<partition>/` index/entry file stating the partition's job (engine, cli surface, daemon, daemon-client, ambient types).
3. Document the bundled-vs-project-local pipeline split in `docs/adr/` (an ADR linking `src/cli/pipelines/` to `.apparat/pipelines/` and the resolver in `src/cli/lib/pipeline-resolver.ts`).
4. Cross-link `.apparat/scenarios/`, `.apparat/meditations/`, and `.apparat/sessions/` from a single `.apparat/README.md` so the project-local home is self-describing.
5. Confirm `docs/superpowers/specs/` and `docs/adr/` are the only doc surfaces for decisions/specs — fold any stragglers (e.g. `IMPLEMENTATION_PLAN.md` at root) into one of the two homes or delete them.
