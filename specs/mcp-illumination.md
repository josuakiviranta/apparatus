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
- After lifecycle transitions, files may be moved by `mark_implemented` or `mark_archived` to sibling directories (see those tool sections).

### `list_illuminations`

Lists illuminations written to this project, with descriptions. Routes to a directory by `status`.

- **Params:** `{ status?: "open" | "dispatched" | "archived" | "implemented" }`
- **Reads from** (status determines source dir):

  | `status` arg | Source dir | Inline frontmatter filter |
  |---|---|---|
  | `"open"` | `meditations/illuminations/` | `status: open` |
  | `"dispatched"` | `meditations/illuminations/` | `status: dispatched` |
  | `"archived"` | `meditations/archived-illuminations/` | none (whole dir is archived) |
  | `"implemented"` | `meditations/implemented-illuminations/` | none (whole dir is implemented) |
  | none / no filter | union of all three dirs | none |

- **Returns** one line per file: `<filename> — <description>` (sorted by filename)
- Files without frontmatter show `(no description)`
- Returns `"No illuminations found."` if matched directories are empty or missing

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

### `mark_implemented`

Marks an illumination as implemented. Valid from status `open` or `dispatched`.

- **Params:** `{ filename: string }`
- **Modifies** frontmatter `status` field to `implemented`, adds `implemented_at` key
- **Moves** file from `meditations/illuminations/<filename>` to `meditations/implemented-illuminations/<filename>`
- **Auto-commits** with message `meditate: implement <filename>` (best-effort; non-fatal if git unavailable)
- **Returns** `{ success, filename, previous_status, new_status, new_path }` where `new_path` is the post-move location

### `mark_dispatched`

Marks an illumination as dispatched after a plan has been generated. Valid only from status `open`.

- **Params:** `{ filename: string, plan_path: string }`
- **Modifies** frontmatter `status` and `plan_path` fields in the illumination file

### `mark_archived`

Archives an illumination. Valid from any status except `archived`.

- **Params:** `{ filename: string, reason: string }`
- **Modifies** frontmatter `status` field to `archived`, adds `archived_at` and `reason` keys
- **Moves** file from `<projectRoot>/meditations/illuminations/<filename>` to `<projectRoot>/meditations/archived-illuminations/<filename>`
- **Auto-commits** with message `meditate: archive <filename>` (best-effort; non-fatal if git unavailable)
- **Returns** `{ success, filename, previous_status, new_status, archive_path }` where `archive_path` is the post-move location

## Path Restrictions

| Tool | Scope |
|------|-------|
| `write_illumination` | `<projectRoot>/meditations/illuminations/` only |
| `list_illuminations` | `<projectRoot>/meditations/{illuminations,archived-illuminations,implemented-illuminations}/` (read-only) |
| `read_file` | Anywhere inside `projectRoot` |
| `glob_files` | Anywhere inside `projectRoot` |
| `project_tree` | Anywhere inside `projectRoot` |
| `list_meta_meditations` | `meditationsDir` (read-only) |
| `read_meta_meditation` | `meditationsDir` (read-only) |
| `mark_implemented` | `<projectRoot>/meditations/illuminations/` → `implemented-illuminations/` (move) |
| `mark_dispatched` | `<projectRoot>/meditations/illuminations/` (modify frontmatter) |
| `mark_archived` | `<projectRoot>/meditations/illuminations/` → `archived-illuminations/` (move) |

## Dependencies

Dynamically imports `@modelcontextprotocol/sdk` and `zod` to avoid pulling the MCP SDK into the test bundle.

## Cleanup

Registers a SIGINT handler that calls `server.close()` and exits.
