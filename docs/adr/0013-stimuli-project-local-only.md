# ADR-0013: Stimuli are project-local only

**Status:** Accepted
**Date:** 2026-05-07
**Supersedes:** none (sharpens partition principle established by ADR-0010)

## Context

The 2026-04-26 split renamed `<project>/.apparat/meditations/stimuli/` into existence as the
project-local home for meditate-pipeline lens files (commit `v0.1.39`). The MCP server, the
`meta_meditations` helper surface, and the `META_MEDITATIONS_DIR` system-injected variable
remained from the pre-split design where the apparat-cli npm package would ship a curated
bundled lens library and the agent would read from it.

In practice the bundled path was dead in distribution — `package.json:files` did not include
`.apparat/`, so `npm pack` excluded the lens library. Every npm-installed apparat user got the
no-stimuli sentinel. Only the developer running apparat against itself in dev had stimuli at all.

The 2026-05-07 design (`docs/superpowers/specs/2026-05-07-stimuli-rename-and-project-local-only-design.md`)
committed to deleting the bundled-stimuli plumbing and aligning the surface name (`stimuli`) with
the directory name and `CONTEXT.md` glossary.

## Decision

Stimuli are read exclusively from `<project>/.apparat/meditations/stimuli/`. There is no bundled
fallback. Other projects that install apparat get an empty `stimuli/` directory from
`apparat init` and populate it themselves. Apparat's own 32 lens files are project-local content
for the apparat repo, not a shared bundle.

The MCP tools `list_meta_meditations` and `read_meta_meditation` rename to `list_stimuli` and
`read_stimulus`. The system-injected variable `META_MEDITATIONS_DIR` is removed from the
preamble. The MCP server resolves the stimuli directory internally from the project root via
`stimuliDir(projectRoot)`.

## Consequences

- Every project owns a curated lens library tailored to its own concerns. Apparat's lenses
  (e.g. `the-agentic-loop-is-a-graph.md`) no longer leak into other projects.
- A future cookbook-style command (`apparat stimuli import <bundle-name>`) could solve curated
  distribution if it ever becomes a real need. Out of scope here.
- The agent surface in `meditate.md` becomes self-describing: `list_stimuli` matches the
  directory, the glossary, and `CONTEXT.md`.
- New projects scaffolded by `apparat init` see `No stimuli found.` on first meditate. The
  agent still produces a useful illumination by reflecting on code only — degraded but
  functional.
