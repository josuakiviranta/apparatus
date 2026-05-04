# Agents live next to their pipeline; no global registry

**Status:** accepted (2026-04-30)

## Context

Pre-chunk-4 (`memory/2026-04-27-chunk-4-completion-per-folder-architecture.md`),
agents were resolved through a three-tier registry: `projectDir/<name>.md` →
`~/.ralph/agents/<name>.md` (user dir) → bundled-agents dir shipped with the
npm package. The registry was inspectable via `ralph agent list` /
`ralph agent show` and writable via copy-on-read into the user dir whenever
the bundled fallback fired.

Post-chunk-4, pipelines moved to folder form: `<folder>/pipeline.dot` plus
sibling `.md` agents. The pipeline runtime began passing
`allowBundledFallback: false`, so pipelines never reached the bundled tier.
The bundled-agents directory itself stopped shipping (no `src/cli/agents/`,
no `dist/cli/agents/`). The user dir was no longer written to by any
command — only manually populated leftovers from earlier versions remained.
The CLI surface (`ralph agent list/show`) and the registry's multi-tier
lookup persisted as a vestige.

## Decision

The agent registry is collapsed to a single tier: an agent is the file
`<pipeline-folder>/<agent-name>.md`, sibling to its `pipeline.dot`. No user
dir, no bundled fallback, no global library. The module formerly known as
`agent-registry.ts` is renamed `agent-loader.ts` with a single function
`loadAgent(name, pipelineDir): AgentConfig`. `parseAgentFile(content)` is
retained as a pure helper (string → AgentConfig). `RegistryOptions`,
`listAgents`, `agentExists`, the `userDir`/`bundledDir`/`allowBundledFallback`
options, the bundled-agents dir lookup in `assets.ts`, and the
`ralph agent list/show` CLI subcommands are deleted.

## Considered alternatives

- **(a) Surgical** — delete only the CLI surface, leave the dead multi-tier
  resolver as latent affordances. Rejected: preserves the fossil-creating
  ambiguity that motivated the cut.
- **(c) Keep user dir as a "global agent library" override** — usable for
  cross-pipeline agent reuse. Rejected: no authoring path writes there;
  pipelines as units of distribution don't need a library underneath them;
  cross-pipeline reuse is already solved by copying the `.md` into the
  consuming pipeline's folder.

## Consequences

- Cross-pipeline agent reuse is by **file copy**, not registry sharing. If
  two pipelines want the same agent, both folders contain a copy.
- Existing `~/.ralph/agents/` files on contributor machines become inert.
  Any external pipeline elsewhere on a machine that relied on user-dir
  resolution will fail at run time with `Agent file not found:
  <pipelineDir>/<name>.md` — opt-in to the new architecture, no migration
  path provided. (See VISION.md: pipelines are authored once and live in
  this repo; targets are external via `--project <folder>`.)
- The agent inventory is no longer inspectable via CLI. To survey what
  agents exist for a pipeline, `ls <pipeline-folder>/*.md`.
- A future need for shared agents would require redesigning and
  reintroducing a registry — supersede this ADR if that happens.
