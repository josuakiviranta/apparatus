---
id: spec-2026-04-12-meditate-tool-whitelist-gap
type: spec
created: 2026-04-12
status: draft
tags: [meditate, mcp, illumination, tools, whitelist, agent-config]
---

# Meditate Agent Tool Whitelist Gap

## Problem

The meditate agent's prompt instructs it to "Call `list_illuminations` with no arguments" in step 1 to orient itself against prior illuminations. The tool is registered in the MCP illumination server (`src/cli/mcp/illumination-server.ts`, tool 7 of 8) and documented in `specs/mcp-illumination.md`. However, `mcp__illumination__list_illuminations` is absent from the `tools:` whitelist in `src/cli/agents/meditate.md`.

The agent runs in `dontAsk` mode, so absent tools are auto-denied — step 1 fails silently every session. The agent compensates by enumerating `meditations/illuminations/` via `project_tree` and reading files individually, costing ~10 extra tool calls to reconstruct information a single `list_illuminations` call would provide.

The same divergence exists in `src/cli/prompts/PROMPT_meditation.md`, which references the tool in its instructions but omits it from its Tools Available section.

## Goal

Align the meditate agent's tool whitelist with the MCP server registration and prompt instructions so `list_illuminations` is available at session start.

## Non-Goals

- Changes to the MCP illumination server tool set
- Changes to meditate agent prompt logic beyond tool availability
- Auditing other agents for similar whitelist gaps (separate task)

## Design

### Data flow

```
Agent starts (dontAsk mode)
    ↓
Step 1: calls mcp__illumination__list_illuminations
    ↓
MCP server returns: "filename — description" per illumination
    ↓
Agent has orientation context for deduplication
    ↓
Proceeds to observation/writing steps with full prior-art awareness
```

### Components

**`src/cli/agents/meditate.md`**

Add `list_illuminations` as the first entry in the `tools:` list, reflecting its role as the session-orientation tool:

```yaml
tools:
  - mcp__illumination__list_illuminations
  - mcp__illumination__read_file
  - mcp__illumination__glob_files
  - mcp__illumination__project_tree
  - mcp__illumination__write_illumination
  - mcp__illumination__mark_implemented
  - mcp__illumination__list_meta_meditations
  - mcp__illumination__read_meta_meditation
```

**`src/cli/prompts/PROMPT_meditation.md`**

Add `list_illuminations` to the Tools Available section. This file mirrors the agent body and must stay in sync — the drift that caused this gap originated from `list_illuminations` being added to the server after the agent config was written.

## Error Handling

No changes needed. If `list_illuminations` returns an empty list (no illuminations yet), the agent proceeds to step 2 normally — this is already handled by the prompt instructions.

## Testing

### Chunk 1 — Whitelist verification (unit)

Add a test that parses `src/cli/agents/meditate.md` and asserts the `tools:` list contains `mcp__illumination__list_illuminations`.

### Chunk 2 — Smoke test

Run `ralph meditate` on this project. The agent should call `list_illuminations` in step 1 and receive illumination summaries without a permission error. Confirm the output contains existing illuminations with descriptions.

## Constraints

- Both `meditate.md` and `PROMPT_meditation.md` must be updated together — they are manual duplicates and any tool change must touch both files
- The `mark_implemented` tool (8th server tool) was added after the illumination was written; ensure the final whitelist includes all 8 server tools

## Backwards Compatibility

No breaking changes. Adding a tool to the whitelist is purely additive — existing sessions that never called `list_illuminations` are unaffected.
