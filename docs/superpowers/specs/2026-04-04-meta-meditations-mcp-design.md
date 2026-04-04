# Meta-Meditations via MCP Design

## Problem

`ralph meditate <folder>` runs Claude against a target project but provides no interpretive lenses. The agent reflects on code state alone — no themes, no patterns, no cross-cutting perspectives. ralph-cli itself has 23 curated meditation files (idempotency, dark-factory, TDD, hoarding knowledge, etc.) that were the design input for the meditate feature, but they never reach users or the agent.

Seeding meditation files per-project (e.g. via `ralph new`) was considered and rejected: meditations are ralph-cli's concern, not the project's. They should be a central, user-editable library that the agent can access regardless of which project is being meditated.

## Solution

Expose ralph-cli's own `meditations/` folder to the meditation agent via two new MCP tools on the existing illumination server: `list_meta_meditations` and `read_meta_meditation`. The agent browses the lens library through the same MCP channel it already uses to write illuminations.

The `meditations/` folder lives at the ralph-cli package root and is included in the npm package. Users can edit, add, or remove files at `~/.npm-global/lib/node_modules/ralph-cli/meditations/` to customize their lens library.

## Architecture

### Data Flow

```
ralph meditate <folder>
  └── spawns MCP server (illumination-server.ts)
        args: [projectRoot, metaMeditationsDir]
        └── agent calls list_meta_meditations  → reads metaMeditationsDir
        └── agent calls read_meta_meditation   → reads metaMeditationsDir/<filename>
        └── agent calls read_file / glob_files → reads projectRoot
        └── agent calls write_illumination     → writes to projectRoot/meditations/illuminations/
```

Two distinct scopes, both served by the same MCP server:
- **`metaMeditationsDir`** — ralph-cli's `meditations/` (lenses, read-only by agent)
- **`projectRoot`** — target project (subject + output destination)

### Directory Structure

```
ralph-cli/
  meditations/           ← user-editable lens library, ships with npm package
    idempotency-run-it-twice.md
    dark-factory-software-factory-pattern.md
    ... (23 files)
  dist/
    index.js
    illumination-server.js
    ...                  ← meditations/ NOT copied here, resolved at runtime
```

## Components

### `lib/assets.ts` — new export

```typescript
getMetaMeditationsDir(): string
```

Resolves ralph-cli's own `meditations/` directory relative to `__dirname`:
- Production (`dist/`): `path.join(__dirname, "../meditations")`
- Dev (`src/cli/lib/`): `path.join(__dirname, "../../../meditations")`

Returns the directory path. Does not throw — callers handle missing dir gracefully.

### `mcp/illumination-server.ts` — two new tools

Server bootstrap receives `meditationsDir` as second CLI argument (`process.argv[3]`). Resolution is lazy — tools catch errors rather than failing at startup.

**`list_meta_meditations`**
- No parameters
- Returns newline-separated list of `.md` filenames in `meditationsDir`
- If dir is missing or empty: returns explanatory message + instructions for creating meta-meditations (see Error Handling)

**`read_meta_meditation({ filename })`**
- Validates `filename` against existing `FILENAME_RE` (`/^[\w-]+\.md$/`) — blocks path traversal
- Reads `path.join(meditationsDir, filename)` — no `assertWithinRoot` needed (regex prevents `/` and `..`)
- If file not found: returns error message

### `commands/meditate.ts` — minor change

Pass `getMetaMeditationsDir()` as second argument when spawning the MCP server process.

### `src/cli/prompts/PROMPT_meditation.md` — updated instructions

Add section instructing the agent to:
1. Call `list_meta_meditations` to see available lenses
2. Call `read_meta_meditation` on whichever feel relevant to the project
3. Use selected lenses when forming the illumination
4. Proceed with code-only reflection if no meta-meditations are available

## Error Handling

### Missing or empty `meditations/` directory

Both `list_meta_meditations` (empty/missing dir) and `read_meta_meditation` (missing dir) return a message in this form:

> "No meta-meditations found. You can still proceed — reflect on the project code directly and write your illumination using write_illumination.
>
> To add meta-meditations: create `.md` files in the `meditations/` folder of your ralph-cli installation (e.g. `~/.npm-global/lib/node_modules/ralph-cli/meditations/`). Each file is a lens the agent will use to reflect on your project."

The meditation session continues normally. No crash, no `process.exit`.

### Invalid or missing filename in `read_meta_meditation`

- Filename fails `FILENAME_RE`: returns `Error: Invalid filename "...". Must match [\w-]+\.md`
- Filename valid but file doesn't exist: returns `Error: file not found`

Same error-return pattern used by the existing `read_file` tool.

## Testing

**`assets.test.ts`**
- `getMetaMeditationsDir()` resolves to a path ending in `meditations/`
- The resolved directory exists in the current repo

**`illumination-server.test.ts`**
- `list_meta_meditations` with valid dir containing `.md` files → returns filenames
- `list_meta_meditations` with missing dir → returns explanatory message with instructions
- `list_meta_meditations` with empty dir → returns explanatory message with instructions
- `read_meta_meditation` with valid existing filename → returns file content
- `read_meta_meditation` with valid filename that doesn't exist → returns error message
- `read_meta_meditation` with path traversal attempt (e.g. `../secrets.md`) → rejected by regex

## What Does Not Change

- `ralph new` — no meditation files seeded into new projects (not ralph-cli's job)
- `meditations/illuminations/` in target projects — output path unchanged
- MCP config generation and cleanup in `meditate.ts` — unchanged
- All existing MCP tools (`write_illumination`, `read_file`, `glob_files`, `project_tree`) — unchanged
- `package.json` `files` array — verify `meditations/` is included (or not excluded)
