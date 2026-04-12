# Mark-Implemented Lifecycle Completion — Design Spec

## Overview

T2300's illumination lifecycle defines four states: `open`, `dispatched`, `implemented`,
`archived`. The current codebase only automates `open → dispatched` via a `mark_dispatched`
pipeline node. No tool, CLI command, or workflow exists for the `dispatched → implemented`
transition. Illuminations that have been resolved by a developer accumulate in `dispatched`
status indefinitely with no exit path.

This spec adds a `mark_implemented` MCP tool to `illumination-server.ts`, whitelists it in
the meditate agent, and adds a prompt instruction so developers can close the loop during
`ralph meditate` sessions. The meditate agent is the natural completion interface — developers
already use it to reflect on project state.

## Architecture

### Data Flow

```
Developer ships fix
  → runs `ralph meditate`
  → says "T1620 is done"

Meditate agent
  → calls mcp__illumination__mark_implemented({ filename: "T1620-..." })

mark_implemented tool
  → reads illumination file from meditations/illuminations/
  → validates current status is "dispatched" or "open"
  → updates frontmatter: status → "implemented", adds implemented_at date
  → writes file back
  → returns { success: true, filename, previous_status, new_status }

If auto-commit (T2200) is active
  → mutation is committed automatically
```

### Valid Transitions

```
open → implemented        (developer fixed without going through pipeline)
dispatched → implemented  (normal lifecycle completion)
```

Invalid transitions (tool rejects with descriptive error):
- `implemented → implemented` (already resolved)
- `archived → implemented` (terminal state)

## Components

### 1. `mark_implemented` — MCP Tool (illumination-server.ts)

**Input schema:**
```json
{
  "filename": { "type": "string", "description": "Illumination filename (e.g. T1620-some-bug.md)" }
}
```

**Behavior:**
1. Resolve full path: `meditations/illuminations/{filename}`
2. Read file, parse YAML frontmatter
3. Validate `status` is `open` or `dispatched` — reject otherwise
4. Set `status: implemented`
5. Append `implemented_at: YYYY-MM-DD` (current date, UTC)
6. Write file back, preserving body content unchanged
7. Return `{ success: true, filename, previous_status: "dispatched", new_status: "implemented" }`

**Error cases:**
- File not found → `{ success: false, error: "Illumination file not found" }`
- Invalid status → `{ success: false, error: "Cannot mark as implemented: current status is {status}" }`

### 2. Meditate Agent Whitelist (meditate.md)

Add `mcp__illumination__mark_implemented` to the `tools:` whitelist in
`src/cli/agents/meditate.md`, placed after `write_illumination`.

### 3. Prompt Instruction (PROMPT_meditation.md)

Add to `src/cli/prompts/PROMPT_meditation.md` after the existing task list:

> If the user reports that a fix has been shipped or an illumination has been resolved,
> call `mark_implemented` with the illumination filename before ending the session.

## Constraints

- **No implement-command integration.** The `implement` command could theoretically
  auto-detect which illumination a session resolves and mark it on commit. That coupling is
  non-trivial (matching session goal to illumination), fragile, and YAGNI. The meditate-agent
  path is sufficient and keeps the two systems loosely coupled.

- **Frontmatter-only mutation.** The tool modifies only YAML frontmatter fields (`status`,
  `implemented_at`). The markdown body of the illumination is never touched.

- **No new CLI command.** The existing `ralph meditate` session handles the workflow through
  natural language. Adding a dedicated `ralph mark-implemented` command is unnecessary — the
  MCP tool is the primitive, the agent is the interface.

- **Idempotent-safe.** Calling `mark_implemented` on an already-implemented illumination
  returns an error rather than silently succeeding, preventing accidental double-transitions.

## Files Modified

| File | Change |
|------|--------|
| `src/cli/mcp/illumination-server.ts` | Add `mark_implemented` function and MCP tool registration |
| `src/cli/agents/meditate.md` | Add tool to whitelist |
| `src/cli/prompts/PROMPT_meditation.md` | Add prompt instruction for marking resolved illuminations |
| `src/cli/tests/illumination-server.test.ts` | Add unit tests for `mark_implemented` |
