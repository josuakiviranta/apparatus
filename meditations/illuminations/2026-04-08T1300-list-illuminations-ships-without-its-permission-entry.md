---
date: 2026-04-08
description: The `list_illuminations` tool was built, tested, and wired into the meditation prompt, but never added to the Claude Code allow-list — so step 1 of every meditation session is silently denied in don't-ask mode.
---

## Core Idea

`list_illuminations` was shipped in 0.0.26 — code written, tests passing, MCP tool registered, `PROMPT_meditation.md` updated to call it as step 1. But `.claude/settings.local.json` was never updated to include `mcp__illumination__list_illuminations` in its `permissions.allow` list. In don't-ask mode, the tool is auto-denied the moment the meditation agent calls it. The orientation step — the one feature that lets the agent build on prior work — fails silently at the start of every session. This illumination was written without it.

## Why It Matters

This is not a theoretical gap. It is happening right now. The denial occurs at step 1, before the agent has explored a single file. The agent sees a denial error, notes that the tool failed, and continues — but continues blind. The entire value of `list_illuminations` is orientation: don't repeat what's already been said, build on it instead. When step 1 fails, every subsequent session risks producing redundant illuminations.

The `.claude/settings.local.json` currently allows only two MCP tools: `ctx_batch_execute` and `ctx_search`. All illumination MCP tools (`project_tree`, `read_file`, `list_meta_meditations`, `write_illumination`, etc.) are apparently allowed via a mechanism not reflected in this file — likely a global settings file or session-level approval. But `list_illuminations` is new and has never been approved. It falls through to auto-deny.

This reveals a deployment pattern gap. Every MCP tool in this project has two deployment requirements: (1) code + tests + build, and (2) permission entry in the allow-list. Prior tools were likely approved interactively during early development sessions and cached. `list_illuminations` was the first tool deployed after "don't ask mode" was established as the default. It has no cached approval and no explicit allow entry. It is stranded.

## Revised Implementation Steps

1. **Find the global Claude Code settings file.** Check `~/.claude/settings.json` (or the OS-appropriate equivalent). Verify which illumination tools appear there as approved. This explains why the other illumination tools work despite not appearing in `.claude/settings.local.json`.

2. **Add `mcp__illumination__list_illuminations` to the allow-list.** Either add it to `.claude/settings.local.json` alongside the existing entries, or add it to the global settings — whichever is the correct location for per-project MCP tool approvals in this setup.

   ```json
   "mcp__illumination__list_illuminations"
   ```

3. **Verify the fix by running a meditation session.** Trigger `ralph meditate` and confirm that step 1 (`list_illuminations`) returns the illumination list without a denial error. The orientation output should appear before `project_tree` is called.

4. **Establish a two-part MCP tool deployment checklist.** Add a note to `specs/mcp-illumination.md` or the development workflow: every new MCP tool requires (a) code + tests + build passing, AND (b) tool name added to the allow-list before the feature is usable in production. Mark `list_illuminations` as the first tool that missed step (b).

5. **Audit remaining illumination tools against the allow-list.** Confirm `write_illumination` is also in the approved list — without it, the meditation agent can't write anything. If it appears to work only because of a cached approval, that approval could expire or be lost on a new machine.