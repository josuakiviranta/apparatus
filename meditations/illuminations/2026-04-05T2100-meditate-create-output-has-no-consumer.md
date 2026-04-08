---
date: 2026-04-05
description: '`ralph meditate-create <project>` writes source meditations to `<project>/meditations/<slug>.md`.'
---

# `meditate-create` Output Has No Consumer

## Core Idea

`ralph meditate-create <project>` writes source meditations to `<project>/meditations/<slug>.md`. `ralph meditate <project>` runs an agent that reads meta-meditations exclusively from ralph's bundled package directory via `list_meta_meditations` and `read_meta_meditation` MCP tools. These two `meditations/` directories are never the same. A project's custom meditations are structurally invisible to the meditation agent: they live in a folder the agent can technically access, but the specialized tools that surface lenses don't serve them. The meditate-create workflow has no consumer.

## Why It Matters

`src/cli/lib/assets.ts:getMetaMeditationsDir()` always resolves to the ralph package root's `meditations/` directory. When the illumination MCP server is launched in `writeMcpConfig` (`meditate.ts`), it receives this path as its second argument. `list_meta_meditations` and `read_meta_meditation` therefore serve only ralph's bundled reflections — permanently, for every project.

A user who runs `ralph meditate-create my-project` and writes a meditation about "how this codebase handles async boundaries" expects that `ralph meditate my-project` will use it as a lens. That expectation is never met. The agent running meditate has no awareness that project-specific meditations exist.

`PROMPT_meditation.md` reinforces the gap: it instructs the agent to call `list_meta_meditations` without mentioning project-local meditations. Even if the agent tried `glob_files("meditations/*.md")`, it would return illuminations (from `meditations/illuminations/`) and miss the source meditations at `meditations/<slug>.md` — both because the prompt doesn't direct it there and because those files look identical in shape to what illuminations contain.

The illumination server (`src/cli/mcp/illumination-server.ts`) already receives `projectRoot` as its first argument. The fix is already threaded in — the wiring just isn't used.

## Revised Implementation Steps

1. **Update `illumination-server.ts` to merge project-local meditations into `list_meta_meditations`**. After listing files in the bundle `metaMeditationsDir`, also glob `<projectRoot>/meditations/*.md` (excluding `meditations/illuminations/`). Prepend a `[project]` label or use a namespace prefix so the agent can distinguish sources.

2. **Update `read_meta_meditation` in the illumination server** to check project-local files first (by filename match), then fall back to the ralph bundle. Filename collision should prefer the project-local version, giving projects the ability to override defaults.

3. **Pass `projectRoot` as the project meditations directory explicitly** in `writeMcpConfig` (`meditate.ts`). The server already receives `projectRoot` as `argv[2]` — confirm the illumination server uses it, or extend the argument list to pass a dedicated `projectMeditationsDir` if cleaner.

4. **Update `PROMPT_meditation.md`** to add one sentence after the `list_meta_meditations` step: "Project-specific lenses (marked `[project]`) are authored for this codebase specifically — treat them as higher-priority context than general lenses."

5. **Add a test in `src/cli/tests/illumination-server.test.ts`** that verifies `list_meta_meditations` returns filenames from both the bundle dir and a temp project dir containing `.md` files (excluding anything in an `illuminations/` subdirectory).
