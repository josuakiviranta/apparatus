# Meditate Illumination MCP Server — Design

## Problem

`ralph meditate` spawns a Claude subprocess in `--permission-mode dontAsk` to prevent it from
modifying project files. The subprocess must write illumination files to
`meditations/illuminations/`, but every attempt to grant write access via `--allowedTools
Write(path)` has failed. Investigation confirmed:

- No deny rules in user or project settings files
- The `//path` absolute path format is correct per docs, but path-restricted `Write(path)` rules
  appear unsupported or unrecognised when passed via the `--allowedTools` CLI flag
- The docs explicitly document path specifiers only for `Read` and `Edit`, not `Write`

The permission system cannot reliably enforce a write-path restriction via CLI flags. The fix
moves path enforcement into application code.

## Solution

A small stdio MCP server bundled with `ralph-cli` exposes a single tool — `write_illumination` —
with the path constraint baked into its implementation. Claude gets no `Write` permission at all;
it calls `write_illumination(filename, content)` and the server handles safe path resolution and
writes the file.

## Architecture

```
ralph meditate <folder>
  │
  ├── writes  <project-root>/.mcp.ralph-<pid>.json  (temp, removed on exit)
  │     └── mcpServers.illumination → node dist/mcp/illumination-server.js <project-root>
  │
  └── spawns  claude --print --permission-mode dontAsk
                     --allowedTools mcp__illumination__read_file
                                    mcp__illumination__glob_files
                                    mcp__illumination__project_tree
                                    mcp__illumination__write_illumination
                     --mcp-config <project-root>/.mcp.ralph-<pid>.json
                     -p "<meditation prompt>"
                          │
                          └── calls  write_illumination(filename, content)
                                       │
                                       └── MCP server validates filename, writes to
                                           <project-root>/meditations/illuminations/<filename>
```

## New Files

### `src/cli/mcp/illumination-server.ts`

Stdio MCP server. Receives project root as `process.argv[2]`.

**Tool: `write_illumination`**

| Parameter | Type | Description |
|---|---|---|
| `filename` | `string` | Filename only — no path components |
| `content` | `string` | Full markdown content of the illumination |

**Filename validation** (enforced before any write):
- Must match `/^[\w-]+\.md$/`
- Rejects slashes, `..`, colons, missing `.md` extension, or any path traversal attempt
- Claude is expected to use the format `YYYY-MM-DDTHHMM-kebab-slug.md` (no colons — safe for all
  filesystems and passes the regex)

**Behaviour:**
- Validates `projectRoot` at startup — exits with code 1 if missing, not a string, or not an
  existing directory (covers both absent arg and arg pointing to a file)
- Resolves write path: `<projectRoot>/meditations/illuminations/<filename>`
- Creates `meditations/illuminations/` if absent (idempotent)
- Returns `{type: "text", text: "Written to <resolved-path>"}` on success
- Returns `{type: "text", text: "Error: <message>"}` on failure — never throws unhandled
  rejections

**Shutdown:** `process.on("SIGINT")` calls `await server.close()` then `process.exit(0)`.

### `src/cli/tests/illumination-server.test.ts`

| Test | Assertion |
|---|---|
| Valid filename + content | File written, correct path returned |
| Filename with `/` | Rejected with error message |
| Filename with `..` | Rejected with error message |
| Filename with `:` | Rejected with error message |
| Filename without `.md` | Rejected with error message |
| Missing `process.argv[2]` | Process exits with code 1 |
| `process.argv[2]` is a file path, not a directory | Process exits with code 1 |
| `meditations/illuminations/` absent | Created automatically |

## Modified Files

### `tsup.config.ts`

Change `entry` from a single string to an array:

```ts
entry: ["src/cli/index.ts", "src/cli/mcp/illumination-server.ts"],
```

tsup compiles both entries and outputs:
- `dist/index.js` (existing)
- `dist/mcp/illumination-server.js` (new)

No additional `onSuccess` copy step needed for the MCP server — tsup bundles it directly.

### `src/cli/lib/assets.ts`

Add `getIlluminationServerPath()` returning the path to the compiled server file:
- Dev (tsx): `<dir>/../mcp/illumination-server.ts`
- Production: `<dir>/../../dist/mcp/illumination-server.js`

This function returns only the path. The executor (`node` vs `tsx`) is determined by the caller.

### `src/cli/commands/meditate.ts`

**`buildMeditationArgs(absPath, promptText, mcpConfigPath)` changes:**
- Remove `--allowedTools writePattern` and `--disallowedTools ToolSearch`
- Add `--allowedTools "mcp__illumination__write_illumination"`
- Add `--mcp-config <mcpConfigPath>`

**New helpers:**

`writeMcpConfig(projectRoot: string): string`
- Generates a unique config filename: `<projectRoot>/.mcp.ralph-<process.pid>.json`
- Detects dev vs prod (same `__filename` / `tsx` heuristic used in `assets.ts`):
  - Dev: `"command": "tsx"`, `"args": ["<illumination-server.ts path>", projectRoot]`
  - Prod: `"command": "node"`, `"args": ["<illumination-server.js path>", projectRoot]`
- Writes the JSON config and returns the file path

`cleanupMcpConfig(path: string): void`
- Calls `fs.rmSync(path, { force: true })` — ignores ENOENT

**Cleanup contract:**
- Always write a new config file with a PID-namespaced name (`.mcp.ralph-<pid>.json`) — no
  collision with user's own `.mcp.json` and no stale-file ambiguity across runs
- Remove on `child.on("close")`, `SIGINT`, and `SIGTERM`
- SIGKILL cannot be caught; the PID-namespaced name makes stale files inert and identifiable

**`.gitignore` for new projects (`new.ts`):**
- Add `.mcp.ralph-*.json` to the scaffold `.gitignore` so stale files from SIGKILL are not
  committed

### `src/cli/prompts/PROMPT_meditation.md`

Replace any direct `Write` tool instruction with:

> When you have completed your analysis and are ready to record the illumination, call
> `write_illumination` with a filename in the format `YYYY-MM-DDTHHMM-kebab-slug.md` (example:
> `2026-04-04T1430-the-thing-i-noticed.md`) and the full markdown content. Do not use the `Write`
> tool directly.

### `package.json`

Add runtime dependencies:
- `@modelcontextprotocol/sdk` `^1.0.0` — MCP server + stdio transport
- `zod` — input schema validation (runtime `dependency`, not devDependency)

Check whether `zod` is already present before adding.

## SDK Usage Pattern

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";

const server = new McpServer({ name: "illumination", version: "1.0.0" });

// Note: the tool() / registerTool() inputSchema accepts a raw shape object,
// NOT wrapped in z.object(). The SDK wraps it internally.
server.tool("write_illumination", "Write a meditation illumination file to the project", {
  filename: z.string().regex(/^[\w-]+\.md$/, "filename must match [\\w-]+\\.md"),
  content: z.string()
}, async ({ filename, content }) => {
  // resolve path, mkdir, writeFile
  return { content: [{ type: "text", text: `Written to ${resolvedPath}` }] };
});

const transport = new StdioServerTransport();
await server.connect(transport);
```

## Permission Model (final)

> **Updated:** Native `Read` and `Glob` have been replaced by path-restricted MCP equivalents.
> See `2026-04-04-meditate-path-restriction-design.md` for full details.

| Tool | Allowed |
|---|---|
| `mcp__illumination__read_file` | Yes — reads within project root only |
| `mcp__illumination__glob_files` | Yes — globs within project root only |
| `mcp__illumination__project_tree` | Yes — trees within project root only |
| `mcp__illumination__write_illumination` | Yes — writes to `meditations/illuminations/` only |
| `Read` | No |
| `Glob` | No |
| `Write` | No |
| `Bash` | No |
| `ToolSearch` | No (not in allowedTools list) |
| All others | No (dontAsk default) |

## `.mcp.ralph-<pid>.json` Format

```json
{
  "mcpServers": {
    "illumination": {
      "type": "stdio",
      "command": "node",
      "args": ["/abs/path/to/dist/mcp/illumination-server.js", "/abs/path/to/project-root"]
    }
  }
}
```

Written to `<project-root>/.mcp.ralph-<pid>.json` before spawn, removed after session exits.
PID-namespaced filename avoids collision with user `.mcp.json` and makes stale files from SIGKILL
inert and easy to identify.
