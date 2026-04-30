# MCP Illumination Server

`src/cli/mcp/illumination-server.ts` is a Model Context Protocol server that grants Claude restricted write access during meditation sessions.

## Launch

Spawned by `ralph meditate` as a child process with stdio transport. Takes two positional arguments:
- `argv[2]`: `projectRoot` — absolute path to the target project
- `argv[3]`: `meditationsDir` — path to ralph-cli's bundled meta-meditation lenses

Validates `projectRoot` exists; exits with code 1 if missing.

## Server Identity

- Name: `"illumination"`
- Version: `"1.0.0"`
- Transport: `StdioServerTransport` (stdin/stdout)

## MCP Tools (10)

### `write_illumination`

Writes a file to the illuminations output directory.

- **Params:** `{ filename: string, description: string, content: string }`
- `description` is required — one sentence summarizing the core insight; auto-inserted into frontmatter
- `date` is auto-generated server-side (`YYYY-MM-DD`); not a param
- `content` is the markdown body only — frontmatter is prepended automatically
- **Path:** `<projectRoot>/meditations/illuminations/<filename>`
- **Creates** the directory if it doesn't exist
- **Restricted** to that single output directory — no writes elsewhere
- The illumination is removed by `consume` (see below) when the work it represents is implemented or declined.

### `list_illuminations`

Lists illuminations in `meditations/illuminations/`, with descriptions.

- **Params:** `{}` (no parameters)
- **Reads from** `<projectRoot>/meditations/illuminations/` only
- **Returns** one line per file: `<filename> — <description>` (sorted by filename)
- Files without frontmatter show `(no description)`
- Returns `"No illuminations found."` if the directory is empty or missing

### `read_file`

Reads a file within the project.

- **Params:** `{ path: string }`
- **Accepts** relative or absolute paths
- **Restricted** to files that resolve inside `projectRoot`

### `project_tree`

Recursive directory tree of the project or a subdirectory.

- **Params:** `{ path?: string }` (defaults to `projectRoot`)
- **Skips** noise directories: `node_modules`, `dist`, `.git`, etc.

### `glob_files`

Finds files matching a glob pattern within the project.

- **Params:** `{ pattern: string }`
- **Pattern** is relative to `projectRoot`
- **Restricted** to files inside `projectRoot`
- **Returns** list of matching file paths

### `list_meta_meditations`

Lists available meditation lens files.

- **Params:** none
- **Reads from** `meditationsDir` (ralph-cli's bundled lenses)

### `read_meta_meditation`

Reads a specific meditation lens file.

- **Params:** `{ filename: string }`
- **Reads from** `meditationsDir`

### `list_plans`

Lists implementation plans in `docs/superpowers/plans/`, optionally filtered by lifecycle status. Each entry shows the filename and the H1 title parsed from the plan body.

- **Params:** `{ status?: "pending" | "implemented" }`
- **Reads from** `<projectRoot>/docs/superpowers/plans/`
- **Returns** one line per file: `<filename> — <H1 title>` (sorted by filename); `(no description)` if no `# heading` is found in the body
- Returns `"No plans found."` if the directory is empty or missing
- Plans without frontmatter are skipped when `status` is provided

### `consume`

Consumes an illumination — deletes the file from `meditations/illuminations/` and commits the deletion.

- **Params:** `{ filename: string, reason: "implemented" | "declined" }`
- **Deletes** `<projectRoot>/meditations/illuminations/<filename>` from disk
- **Auto-commits** with message `meditate: consume <filename> (<reason>)` (best-effort; non-fatal if git unavailable)
- **Returns** `{ success: true, filename, reason }` on success, or `{ success: false, error }` if the file is missing
- Use `reason: "implemented"` after a successful implement loop + memory-write. Use `reason: "declined"` when the operator rejects an illumination at the gate. The reason lives only in the commit message; recoverable via `git log --grep`.

### `mark_plan_implemented`

Marks an implementation plan as implemented by flipping its frontmatter `status` from `pending` to `implemented`. Valid only from status `pending`. Used by the janitor agent and lifecycle-closing pipeline nodes.

- **Params:** `{ plan_filename: string }` — basename only (e.g. `2026-04-27-foo.md`); resolves under `docs/superpowers/plans/`
- **Modifies** frontmatter `status` field to `implemented` (only — no timestamp key is added)
- **Auto-commits** with message `meditate: mark plan <plan_filename> implemented` (best-effort; non-fatal if git unavailable)
- **Returns** `{ success, plan_filename, previous_status, new_status }` on success, or `{ success: false, error }` on rejection

## Path Restrictions

| Tool | Scope |
|------|-------|
| `write_illumination` | `<projectRoot>/meditations/illuminations/` only |
| `list_illuminations` | `<projectRoot>/meditations/illuminations/` (read-only) |
| `read_file` | Anywhere inside `projectRoot` |
| `glob_files` | Anywhere inside `projectRoot` |
| `project_tree` | Anywhere inside `projectRoot` |
| `list_meta_meditations` | `meditationsDir` (read-only) |
| `read_meta_meditation` | `meditationsDir` (read-only) |
| `consume` | `<projectRoot>/meditations/illuminations/` (delete + commit) |
| `list_plans` | `<projectRoot>/docs/superpowers/plans/` (read-only) |
| `mark_plan_implemented` | `<projectRoot>/docs/superpowers/plans/` (modify frontmatter + commit) |

## Dependencies

Dynamically imports `@modelcontextprotocol/sdk` and `zod` to avoid pulling the MCP SDK into the test bundle.

## Cleanup

Registers a SIGINT handler that calls `server.close()` and exits.
