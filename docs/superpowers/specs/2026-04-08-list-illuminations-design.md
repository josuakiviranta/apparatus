# list_illuminations MCP Tool Design

## Problem

The `meditate` command gives the agent no way to orient itself before writing. It cannot see what has already been illuminated, so it may write redundant insights or miss gaps in coverage. There is also no `description` field on illumination files — the only signal is the filename slug.

## Solution

Two coordinated changes:

1. Add a `description` param to `write_illumination` and auto-inject YAML frontmatter into every new illumination file.
2. Add a `list_illuminations` MCP tool that returns all illuminations with their descriptions — enabling fast orientation at session start.

---

## Section 1 — `write_illumination` changes

**Current signature:** `{ filename: string, content: string }`

**New signature:** `{ filename: string, description: string, content: string }`

`write_illumination` now prepends a frontmatter block before writing:

```yaml
---
date: 2026-04-08
description: <agent-supplied description>
---
```

- `date` is auto-generated server-side: `new Date().toISOString().slice(0, 10)` → `YYYY-MM-DD` (same format as meditation lens files)
- `description` is required; if missing the tool returns an error and no file is written
- The agent supplies `content` as the markdown body only — no frontmatter. The server assembles the final file.

**Implementation location:** `src/cli/mcp/illumination-server.ts` — `writeIllumination()` exported function + MCP tool registration.

---

## Section 2 — `list_illuminations` tool

New exported function `listIlluminations(projectRoot: string): string`:

- Scans `<projectRoot>/meditations/illuminations/*.md`, sorted by filename (timestamp-first sort order)
- For each file, reads only the frontmatter block (stops reading at the closing `---` — no full-file read needed)
- Extracts `description`; if absent or no frontmatter present: `(no description)`
- If directory is empty or missing: returns `"No illuminations found."`

**Output format — one line per file:**

```
2026-04-08T0900-scenario-runs-are-stale-evidence.md — Scenario run records go stale after code changes
2026-04-08T1100-ctx-count-is-lost-on-mixed-content.md — ctx token count suppressed on mixed agent dispatch
2026-04-05T0900-meditation-agent-is-blind-to-its-own-outputs.md — (no description)
```

**MCP tool registration:**

| Field | Value |
|-------|-------|
| Name | `list_illuminations` |
| Description | `"List all illuminations written to this project, with descriptions. Call this at the start of a session to orient yourself before writing new insights."` |
| Params | none |
| Path scope | `<projectRoot>/meditations/illuminations/` (read-only) |

**Implementation location:** `src/cli/mcp/illumination-server.ts` — new exported `listIlluminations()` + tool registration.

---

## Section 3 — `PROMPT_meditation.md` update

Two additions:

1. **Session start instruction** — call `list_illuminations` before writing anything, to orient on what has already been covered and avoid repeating insights.

2. **`write_illumination` instruction** — `description` is now required. It must be a single sentence summarizing the core insight (not a restatement of the filename; the actual takeaway).

No changes to `PROMPT_meditate_create.md` — that command creates meditation scripts, not illuminations.

---

## Section 4 — Backfill existing illuminations

Existing illumination files have no frontmatter. A subagent will be dispatched during implementation to add frontmatter to all existing files:

- `date`: `2026-04-08`
- `description`: derived from the file's `# Title` and opening of `## Core Idea` — a one-line summary of the actual insight

**Files to backfill (7 total):**
- `2026-04-05T0900-meditation-agent-is-blind-to-its-own-outputs.md`
- `2026-04-05T1045-basename-dirname-is-a-fragile-contract.md`
- `2026-04-05T1200-phase-boundaries-must-be-explicit-in-prompts.md`
- `2026-04-05T1400-private-env-detection-is-an-untested-assumption.md`
- `2026-04-05T1530-two-phase-session-abstraction-threshold-reached.md`
- `2026-04-08T0900-scenario-runs-are-stale-evidence.md`
- `2026-04-08T1100-ctx-count-is-lost-on-mixed-content-agent-dispatch.md`

This is a pure file-edit task, independent of code changes — safe to parallelize.

---

## Affected Files

| File | Change |
|------|--------|
| `src/cli/mcp/illumination-server.ts` | Add `description` param to `writeIllumination()`, add `listIlluminations()`, register `list_illuminations` tool |
| `src/cli/prompts/PROMPT_meditation.md` | Add `list_illuminations` call at session start; require `description` in write instruction |
| `src/cli/tests/illumination-server.test.ts` | Add tests for frontmatter injection, `listIlluminations()`, `(no description)` fallback |
| `meditations/illuminations/*.md` (7 files) | Backfill frontmatter (subagent task) |
| `specs/mcp-illumination.md` | Update to document new tool and `description` param |
