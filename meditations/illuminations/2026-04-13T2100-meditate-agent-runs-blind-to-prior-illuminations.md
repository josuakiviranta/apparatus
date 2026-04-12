---
date: 2026-04-11
description: `list_illuminations` is implemented in the MCP server and referenced in step 1 of the meditate agent's prompt, but absent from the agent's `tools:` whitelist — every session starts with a denied call and must reconstruct orientation context that the tool would have provided for free.
---

## Core Idea

The meditate agent's prompt instructions open with "Call `list_illuminations` with no arguments to see what has already been written." The tool exists — it is the 7th registered tool in `src/cli/mcp/illumination-server.ts`, returning one `filename — description` line per illumination. But `mcp__illumination__list_illuminations` is absent from the `tools:` whitelist in `src/cli/agents/meditate.md`. The agent runs in `dontAsk` mode; absent tools are auto-denied, not deferred. Step 1 fails silently every time.

The same divergence exists in `src/cli/prompts/PROMPT_meditation.md`, which mirrors the agent body and also references the missing tool. The spec, the server, and the prompt all agree: this tool should be available. Only the whitelist disagrees.

## Why It Matters

`list_illuminations` output is compressed context — the "filesystem as agent memory" lens describes it precisely: agent memory that survives session resets lives on disk, and the tool is the index into that memory. Without it, a session must enumerate `meditations/illuminations/` via `project_tree`, identify files by filename, and read each one individually to extract descriptions. That costs context window tokens and time proportional to the number of existing illuminations. With five illuminations already written, the cost is already non-trivial; it grows with each future session.

The practical consequence is orientation failure. The meditate agent is specifically designed to "build on, contradict, or deepen prior observations rather than restate them." Without the index, an agent entering a sixth session on a day when five illuminations already cover pipeline bugs cannot see that coverage at a glance — it must rediscover it by reading files or risk writing duplicate content. In this session, the T1500–T1945 series was visible only because `project_tree` exposed the filenames and the files were read individually. That's ten extra tool calls replacing one.

The divergence has a traceable cause: `list_illuminations` was added to the MCP server after the agent config was written, and the whitelist was not updated. The spec document (`specs/mcp-illumination.md`) documents all 7 tools including `list_illuminations`. Both the prompt and the spec are current; only the agent config lags.

## Revised Implementation Steps

1. **Add `mcp__illumination__list_illuminations` to the `tools:` list in `src/cli/agents/meditate.md`.** Place it as the first entry — before `read_file` — to reflect its role as the session-orientation tool. The resulting list should read: `list_illuminations`, `read_file`, `glob_files`, `project_tree`, `write_illumination`, `list_meta_meditations`, `read_meta_meditation`.

2. **Verify the tool is also available in `src/cli/prompts/PROMPT_meditation.md` context.** This file appears to mirror the agent body; confirm it is either generated from `meditate.md` or updated in sync. If it is a manual duplicate, note that both files must be updated together whenever tools change — this is exactly the drift that caused the current gap.

3. **Smoke test the fix.** Run `ralph meditate` on this project. The agent should call `list_illuminations` in step 1 and receive the illumination summaries without a permission error. Confirm the output contains at least the five T1500–T1945 illuminations with descriptions.

4. **Audit the full tool list for other gaps.** The illumination server registers 7 tools. The current whitelist has 6. After adding `list_illuminations`, count again: `write_illumination`, `list_illuminations`, `read_file`, `glob_files`, `project_tree`, `list_meta_meditations`, `read_meta_meditation` — that's 7. If counts match, no further gaps. If they don't, identify the missing tool before closing.
