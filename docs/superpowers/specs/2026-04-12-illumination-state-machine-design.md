# Illumination State Machine — Design Spec

## Overview

Illumination files have no lifecycle state machine. `write_illumination` does not write a
`status` field, `list_illuminations` cannot filter by status, and the `illumination-to-plan`
pipeline has no `mark_dispatched` node. Illuminations cannot be tracked through
`open -> dispatched -> implemented -> archived` transitions. The pipeline re-processes the
same illumination on every run because there is no "already dispatched" marker.

Partial fixes exist: `mark_implemented` is already an MCP tool, and `list_illuminations` is
whitelisted in the meditate agent. But the fundamental gap — no status on write, no
dispatched transition, no status filtering — remains unaddressed.

This spec adds the missing state machine: a `status` field written on creation, a
`mark_dispatched` pipeline node, a `mark_archived` tool replacing destructive deletion,
and status filtering on `list_illuminations`.

## Architecture

### State Machine

```
  open ──────────────────────┐
    │                        │
    │ (pipeline dispatches)  │ (developer fixes directly)
    ▼                        │
  dispatched                 │
    │                        │
    │ (developer confirms)   │
    ▼                        ▼
  implemented ◄──────────────┘
    │
    │ (no longer actionable)
    ▼
  archived
```

Valid transitions:
- `open -> dispatched` — pipeline generated a plan
- `open -> implemented` — developer fixed without pipeline
- `dispatched -> implemented` — normal lifecycle completion
- `implemented -> archived` — historical record, no longer actionable
- `open -> archived` — stale illumination, no longer relevant

Invalid transitions (tools reject with descriptive error):
- Any state -> `open` (cannot re-open)
- `archived -> *` (terminal state)
- Same-state transitions (idempotent-safe rejection)

### Data Flow

```
write_illumination
  → writes frontmatter with status: open
  → file created in meditations/illuminations/

illumination-to-plan pipeline
  → list_illuminations(status="open")
  → verifier confirms issue exists
  → design_writer + plan_writer produce docs
  → mark_dispatched updates frontmatter: status → dispatched, plan_path → $path
  → pipeline skips already-dispatched illuminations on re-run

meditate session (developer reports fix)
  → mark_implemented updates frontmatter: status → implemented

mark_archived (manual or via pipeline false-path)
  → moves file to meditations/illuminations/archive/
  → updates frontmatter: status → archived
```

## Components

### 1. `write_illumination` — Status Field on Create (illumination-server.ts)

**Change:** Add `status: open` to the YAML frontmatter written by `write_illumination`.

Current frontmatter:
```yaml
---
date: 2026-04-13
description: ...
---
```

New frontmatter:
```yaml
---
date: 2026-04-13
status: open
description: ...
---
```

### 2. `list_illuminations` — Status Filter (illumination-server.ts)

**Input schema change:** Add optional `status` parameter.

```json
{
  "status": {
    "type": "string",
    "enum": ["open", "dispatched", "implemented", "archived"],
    "description": "Filter illuminations by lifecycle status. Omit to return all."
  }
}
```

**Behavior:**
1. Read all illumination files (existing logic)
2. Parse YAML frontmatter of each file
3. If `status` parameter provided, filter to matching files only
4. Files without a `status` field are treated as `open` (backward compatibility)
5. Return filtered list

### 3. `mark_dispatched` — Pipeline Node (illumination-to-plan.dot)

**New node** inserted between `design_writer` and `plan_writer` in the pipeline graph.

**MCP tool (illumination-server.ts):**

Input schema:
```json
{
  "filename": { "type": "string", "description": "Illumination filename" },
  "plan_path": { "type": "string", "description": "Path to the generated design doc" }
}
```

Behavior:
1. Resolve full path: `meditations/illuminations/{filename}`
2. Read file, parse YAML frontmatter
3. Validate `status` is `open` — reject if already `dispatched`, `implemented`, or `archived`
4. Set `status: dispatched`
5. Append `dispatched_at: YYYY-MM-DD` and `plan_path: {plan_path}`
6. Write file back, preserving body content unchanged
7. Return `{ success: true, filename, previous_status, new_status }`

**Pipeline node (illumination-to-plan.dot):**

```dot
mark_dispatched [handler="agent" model="sonnet"]
```

Prompt: "Call mcp__illumination__mark_dispatched with filename extracted from
`$illumination_path` and plan_path set to `$design_doc_path`."

Edge: `design_writer -> mark_dispatched -> plan_writer`

### 4. `mark_archived` — Replace Destructive Deletion (illumination-server.ts)

**New MCP tool** replacing the `delete_agent` node on the pipeline's false/decline paths.

Input schema:
```json
{
  "filename": { "type": "string", "description": "Illumination filename" },
  "reason": { "type": "string", "description": "Why the illumination is being archived" }
}
```

Behavior:
1. Resolve full path: `meditations/illuminations/{filename}`
2. Read file, parse YAML frontmatter
3. Validate status is not already `archived`
4. Set `status: archived`
5. Append `archived_at: YYYY-MM-DD` and `archive_reason: {reason}`
6. Create `meditations/illuminations/archive/` if it does not exist
7. Move file to `meditations/illuminations/archive/{filename}`
8. Return `{ success: true, filename, previous_status, new_status, archive_path }`

**Pipeline change:** Replace `delete_agent` node with `mark_archived` on false-path and
decline-path edges in `illumination-to-plan.dot`.

### 5. Backfill Existing Illuminations

Before deploying the tooling changes, manually add `status: open` to the frontmatter of
all existing illumination files that lack a status field. This establishes a clean baseline.

Files without a `status` field are treated as `open` by the filtering logic (component 2),
so this step is optional but makes the state explicit.

## Constraints

- **Frontmatter-only mutations.** All status tools modify only YAML frontmatter fields.
  The markdown body of illumination files is never touched.

- **No new CLI commands.** Status transitions happen through MCP tools invoked by agents
  (pipeline nodes, meditate sessions). No dedicated `ralph mark-dispatched` command.

- **Backward compatible.** Files without a `status` field are treated as `open`. No
  migration script required — the filtering logic handles the legacy case gracefully.

- **Idempotent-safe.** Same-state transitions return descriptive errors rather than
  silently succeeding.

- **No cascading state changes.** Each tool performs exactly one transition. Moving from
  `open` to `archived` requires a single `mark_archived` call, not chaining through
  intermediate states.

- **Archive preserves history.** `mark_archived` moves files to an `archive/` subdirectory
  rather than deleting them. Insights are preserved as historical record.

## Files Modified

| File | Change |
|------|--------|
| `src/cli/mcp/illumination-server.ts` | Add `status: open` to `write_illumination` frontmatter; add `status` filter to `list_illuminations`; add `mark_dispatched` tool; add `mark_archived` tool |
| `src/cli/agents/meditate.md` | Add `mark_dispatched` and `mark_archived` to tools whitelist |
| `meditations/illumination-to-plan.dot` | Add `mark_dispatched` node after `design_writer`; replace `delete_agent` with `mark_archived` on false/decline paths |
| `src/cli/tests/illumination-server.test.ts` | Add unit tests for `mark_dispatched`, `mark_archived`, status filtering, and `status: open` on write |
| `meditations/illuminations/*.md` | Backfill `status: open` in frontmatter of existing files |
