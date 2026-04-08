---
date: 2026-04-05
description: '`buildMeditationArgs` in `meditate.ts` contains six hardcoded `"mcp__illumination__*"` strings that must precisely match tool names registered in `illumination-server.ts` and the config key used in `writeMcpConfig`.'
---

# Tool Names Are Magic Strings Across Files

## Core Idea

`buildMeditationArgs` in `meditate.ts` contains six hardcoded `"mcp__illumination__*"` strings that must precisely match tool names registered in `illumination-server.ts` and the config key used in `writeMcpConfig`. These three locations are independently maintained with no compile-time link between them. If the server tool names or the MCP namespace key change in any one place, the meditate agent silently loses access to tools — the session runs to completion with a hallucinated or vacuous illumination.

## Why It Matters

The allowed tools list in `buildMeditationArgs` (`meditate.ts:85–93`) is a manual mirror of two other sources of truth:

1. The MCP server config key (`writeMcpConfig`, `meditate.ts:67`): `mcpServers: { illumination: { ... } }` — this key sets the namespace prefix `mcp__illumination__`.
2. The tool name strings in `illumination-server.ts` (inside the dynamic import block): `server.tool("read_file", ...)`, `server.tool("glob_files", ...)`, etc.

A rename in either source requires updating all six strings in `buildMeditationArgs`. TypeScript will not catch this — all three locations contain string literals. Tests will not catch this — no existing test verifies that the allowed-tools list matches the registered tool names. The failure mode is silent: claude spawns, the MCP server launches, every tool call returns "permission denied" (or "unknown tool"), and the agent produces an illumination that reflects whatever it could do without tools — typically a vague restatement of what it already knew.

This is the same fragility that produced the `isDevMode()` bug: `basename(__dirname) !== "dist"` was a string literal that needed to match runtime behavior but had drifted to `"cli"`. The ESM migration surfaced it only because someone looked. MCP tool name drift will surface only when a meditate session produces noticeably poor output — which is subtle enough to go unnoticed for a long time.

The `interactive-vs-non-interactive-agent-work` lens sharpens the stakes: meditate runs fully non-interactive. There is no human in the loop to notice that every `→ [tool] read_file` line is missing from the output. The session completes, an illumination is written, and the mismatch is invisible.

## Revised Implementation Steps

1. **Export tool name constants from `illumination-server.ts`** at module level (outside the `if (!isTestEnv)` block):
   ```typescript
   export const MCP_SERVER_NAME = "illumination";
   export const MCP_TOOL_NAMES = {
     writeIllumination: "write_illumination",
     readFile: "read_file",
     globFiles: "glob_files",
     projectTree: "project_tree",
     listMetaMeditations: "list_meta_meditations",
     readMetaMeditation: "read_meta_meditation",
   } as const;
   ```

2. **Add a helper that derives allowed tool names from the server name and tool names:**
   ```typescript
   export function mcpAllowedTools(serverName: string, tools: typeof MCP_TOOL_NAMES): string[] {
     return Object.values(tools).map((t) => `mcp__${serverName}__${t}`);
   }
   ```
   Export this from `illumination-server.ts` so it can be tested independently.

3. **Update `buildMeditationArgs` in `meditate.ts`** to import and use the constants:
   ```typescript
   import { MCP_SERVER_NAME, MCP_TOOL_NAMES, mcpAllowedTools } from "../mcp/illumination-server";
   ```
   Replace the six hardcoded `"--allowedTools"` pairs with `mcpAllowedTools(MCP_SERVER_NAME, MCP_TOOL_NAMES).flatMap((t) => ["--allowedTools", t])`.

4. **Update `writeMcpConfig` in `meditate.ts`** to use `MCP_SERVER_NAME` as the config key instead of the string literal `"illumination"`:
   ```typescript
   const config = { mcpServers: { [MCP_SERVER_NAME]: { type: "stdio", command, args: [...] } } };
   ```

5. **Add a unit test in `meditate.test.ts`** that asserts the allowed tools list in `buildMeditationArgs` contains exactly `mcpAllowedTools(MCP_SERVER_NAME, MCP_TOOL_NAMES)` — no more, no less. This test will fail if either source drifts and is the automated canary that the current code lacks.
