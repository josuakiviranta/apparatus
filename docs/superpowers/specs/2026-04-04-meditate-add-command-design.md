# `ralph meditate add` — Design Spec

**Date:** 2026-04-04

## Problem

The `meditations/` folder is a library of short, structured insights (frontmatter + title + prose). Today there is no CLI-assisted way to add a new entry. Users must write the file manually, remembering the format.

## Goal

A command that launches an AI-assisted interactive session to help the user articulate and write a new meditation file in `<project-folder>/meditations/`.

## Command

```
ralph meditate add <project-folder>
```

Registered as a subcommand of `ralph meditate` in `index.ts`, alongside `stop`, `status`, `kill`.

## Meditation File Format

```markdown
---
source: <url or freeform>
date: YYYY-MM-DD
description: <one sentence>
---

# Title In Title Case

Body prose. Two to four paragraphs.
```

Filename: `kebab-case-slug.md` in `<project-folder>/meditations/`.

## Two-Phase Session (mirrors `plan` command)

### Phase 1 — Non-interactive kickoff

Spawns:
```
claude -p <PROMPT_meditate_create content> \
  --output-format stream-json \
  --dangerously-skip-permissions
```

in `<project-folder>`. Claude reads all `meditations/*.md` files (excluding `meditations/illuminations/`) to internalize the existing format and entries, then outputs a brief "ready" message. Session ID is captured from the stream-json output.

### Phase 2 — Interactive resume

Spawns:
```
claude --dangerously-skip-permissions --resume <sessionId>
```

with `stdio: inherit`. The user converses with Claude to articulate the insight. Claude writes the finished file to `meditations/<slug>.md` using its standard file-writing tools. No new MCP tooling required.

## Bundled Prompt: `PROMPT_meditate_create.md`

```
Read all files in meditations/ (excluding meditations/illuminations/) to understand the
existing format: frontmatter (source, date, description), # Title, prose body, kebab-case
filename.

Then say: "I've reviewed your meditations. What insight or practice do you want to document?"

When the user is ready, write the finished meditation to meditations/<slug>.md matching the
existing format exactly. Do not write any code. Do not create specs.
```

Resolved via `getMeditateCreatePromptPath()` in `assets.ts`.

## Files Changed

| File | Change |
|---|---|
| `src/cli/commands/meditate-add.ts` | New — `meditateAddCommand()`, mirrors `plan.ts` shape |
| `src/cli/prompts/PROMPT_meditate_create.md` | New bundled kickoff prompt |
| `src/cli/lib/assets.ts` | Add `getMeditateCreatePromptPath()` |
| `src/cli/index.ts` | Register `ralph meditate add <folder>` subcommand |
| `src/cli/tests/meditate-add.test.ts` | New test file |

No changes to `meditate.ts`, the illumination server, or existing prompts.

## Out of Scope

- Format validation / MCP write_meditation tool (not needed; Claude uses native file writing)
- Reading `meditations/illuminations/` during kickoff (AI-generated illuminations are not part of the curated library)
- `--edit` flag for modifying existing meditations
