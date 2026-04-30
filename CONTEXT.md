# ralph-cli — Domain Language

## Glossary

### Agent loading

An agent is the file `<pipeline-folder>/<agent-name>.md` sitting next to its
`pipeline.dot`. There is **no global agent library**. Cross-pipeline reuse
is by file copy into the consuming pipeline's folder.

The runtime path is `loadAgent(name, pipelineDir)` in
`src/cli/lib/agent-loader.ts`. A missing file fails fast with
`Agent file not found: <path>`.

Excised on 2026-04-30 (see `docs/adr/0001-agents-live-next-to-pipeline.md`):
the old `agent-registry.ts` multi-tier resolver, the user-dir tier
(`~/.ralph/agents/`), the bundled-agents dir (`getBundledAgentsDir`), the
`ralph agent list/show` CLI subcommands, and the
`allowBundledFallback`/`RegistryOptions` shape. Stray
`~/.ralph/agents/` files on contributor machines are now inert.

All pipelines live in this repo (`pipelines/`, `src/cli/pipelines/`). A
pipeline is run against an external target project via `--project <folder>`
(positional refactor pending).
