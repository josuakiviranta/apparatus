# Meditate Path Restriction — Design

## Problem

`ralph meditate` currently grants Claude unrestricted `Read` and `Glob` access. Although internet
access and write access outside `meditations/illuminations/` are already blocked, Claude can read
any file the OS process can access — including files from other projects, `~/.ssh/`, etc. The goal
is to restrict file access to the project folder only.

Path-restricted `--allowedTools Read(path)` was already investigated (in the illumination MCP
design) and found unreliable via CLI flags. The same MCP pattern used to enforce write restrictions
is the correct approach here.

## Solution

Extend `illumination-server.ts` with three additional tools: `read_file`, `glob_files`, and
`project_tree`. All three enforce that operations stay within `projectRoot`. Remove native `Read`
and `Glob` from `--allowedTools` and replace with the MCP equivalents.

## Architecture

```
claude (meditate session)
  │
  ├── mcp__illumination__read_file(path)
  │     └── resolves path, validates within projectRoot, returns file contents
  │
  ├── mcp__illumination__glob_files(pattern)
  │     └── globs relative to projectRoot, returns matching paths
  │
  ├── mcp__illumination__project_tree(path?)
  │     └── recursive tree from projectRoot or subdirectory, skips noise folders
  │
  └── mcp__illumination__write_illumination(filename, content)   ← unchanged
        └── writes to meditations/illuminations/ only

--allowedTools: Read and Glob removed, replaced with MCP equivalents
```

## New Tools

### `read_file(path)`

| Parameter | Type | Description |
|---|---|---|
| `path` | `string` | Relative to project root, or absolute |

**Behaviour:**
- Resolve: if relative, join with `projectRoot`; if absolute, use as-is
- Validate: resolved path must start with `projectRoot + "/"` — rejects `../` traversal and paths
  outside the folder
- Read and return full file contents as `utf8` text
- On error: return `{type: "text", text: "Error: <message>"}` — never throws

### `glob_files(pattern)`

| Parameter | Type | Description |
|---|---|---|
| `pattern` | `string` | Glob pattern, relative to project root |

**Behaviour:**
- Run glob with `projectRoot` as the base directory using `fast-glob` (`fast-glob` npm package,
  works on Node 18+; add as a runtime dependency)
- Patterns beginning with `/` are rejected as absolute; patterns containing `..` segments are also
  rejected
- Return newline-separated list of matching paths (relative to `projectRoot`)
- On no matches: return `"No files matched pattern: <pattern>"`
- On error: return `"Error: <message>"`

### `project_tree(path?)`

| Parameter | Type | Description |
|---|---|---|
| `path` | `string` (optional) | Subdirectory to tree, relative to project root. Defaults to project root. |

**Behaviour:**
- Returns a full recursive tree of all files and folders under the given path, with paths relative
  to the given root (or `projectRoot` if no path given) — e.g. `project_tree("src/cli")` returns
  paths relative to `src/cli`, not to `projectRoot`
- Path-validated — must resolve within `projectRoot`
- Always skips: `.git/`, `node_modules/`, `dist/`, `build/`, `coverage/`, `.next/`, `.turbo/`,
  `__pycache__/`, `.cache/`
- Trailing `/` on directories, indented 2 spaces per level
- On empty: return `"Directory is empty"`
- On error: return `"Error: <message>"`

Example output:
```
src/
  cli/
    index.ts
    commands/
      meditate.ts
docs/
README.md
package.json
```

## Shared Path Safety

All three tools use the same guard:

```ts
function assertWithinRoot(resolved: string, projectRoot: string): void {
  if (!resolved.startsWith(projectRoot + "/") && resolved !== projectRoot) {
    throw new Error("Path is outside the project folder");
  }
}
```

Symlinks are not followed — `fs.realpath` is not called before the guard. A symlink inside
`projectRoot` pointing outside it would pass the check but resolve to an external path at read time.
This edge case is out of scope and acceptable for the meditation use case.

## Modified Files

### `src/cli/mcp/illumination-server.ts`

Add `read_file`, `glob_files`, and `project_tree` tool registrations alongside the existing
`write_illumination`. All share `projectRoot` already received as `process.argv[2]`.

### `package.json`

Add runtime dependency: `fast-glob` — used by `glob_files` and `project_tree` in the MCP server.
Works on Node 18+, unlike Node's built-in `fs.glob` which requires Node 22+.

### `src/cli/commands/meditate.ts`

`buildMeditationArgs` changes:
- Remove `--allowedTools Read` and `--allowedTools Glob`
- Add `--allowedTools mcp__illumination__read_file`
- Add `--allowedTools mcp__illumination__glob_files`
- Add `--allowedTools mcp__illumination__project_tree`

### `src/cli/prompts/PROMPT_meditation.md`

Replace instructions referencing native `Read`/`Glob` with instructions to use `read_file`,
`glob_files`, and `project_tree`.

## Permission Model (updated)

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
| `WebFetch` | No |
| `WebSearch` | No |
| All others | No (dontAsk default) |

## Tests

New test cases in `src/cli/tests/illumination-server.test.ts`:

**`read_file`**

| Test | Assertion |
|---|---|
| Valid relative path | Returns file contents |
| Valid absolute path within root | Returns file contents |
| Path with `../` traversal | Rejected with error message |
| Absolute path outside root | Rejected with error message |
| File not found | Returns error message |

**`glob_files`**

| Test | Assertion |
|---|---|
| Pattern with matches | Returns newline-separated relative paths |
| Pattern with no matches | Returns `"No files matched pattern: <pattern>"` |
| Pattern beginning with `/` | Rejected with error message |
| Pattern containing `..` | Rejected with error message |

**`project_tree`**

| Test | Assertion |
|---|---|
| Default (project root) | Returns indented tree, no `.git/`/`node_modules/` |
| Valid subdirectory path | Returns tree rooted at that subdirectory |
| Path outside root | Rejected with error message |
| Empty directory | Returns `"Directory is empty"` |
| Skipped folders present | Confirms `.git/`, `node_modules/`, `dist/` etc. absent |

**`meditate.ts`**

`buildMeditationArgs` test updated: assert `Read` and `Glob` absent, assert
`mcp__illumination__read_file`, `mcp__illumination__glob_files`, and
`mcp__illumination__project_tree` present.
