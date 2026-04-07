# Meditate

Meditation commands provide persistent, sandboxed Claude sessions with restricted write access for reflective project analysis.

## `ralph meditate <project-folder>`

Launches a sandboxed meditation Claude session.

### Startup Sequence

1. Validate project folder exists; exit if missing
2. Write PID lock file at `<project-folder>/.ralph-meditate.pid`
3. Write per-PID MCP config for the illumination server
4. Spawn Claude with strict `dontAsk` permissions:
   - `Read` — globally allowed
   - `Write` — restricted to `meditations/illuminations/` only
5. Claude runs as an interactive session with MCP illumination server attached

### Permission Model

Claude can read any file in the project but can only write to `<project-folder>/meditations/illuminations/`. This restriction is enforced both by Claude's `dontAsk` permission config and by the MCP illumination server's path validation.

### MCP Integration

The illumination server is spawned as a child process using stdio transport. It provides 5 MCP tools for reading the project, writing illuminations, and accessing meta-meditation lenses. See [mcp-illumination.md](mcp-illumination.md) for details.

### PID Management

- Lock file: `<project-folder>/.ralph-meditate.pid`
- Contains the meditation session's process ID
- Used by `ralph meditate kill <folder>` to send SIGTERM
- Prevents duplicate sessions on the same project

### Stopping

`ralph meditate kill <project-folder>` reads the PID from the lock file and sends SIGTERM.

## `ralph meditate create <project-folder>`

Creates a new meditation script via a non-interactive Claude session.

### Behavior

1. Builds kickoff arguments for a non-interactive Claude session
2. No PID lock file — session is short-lived
3. No permission restrictions — full access
4. Claude generates meditation topics based on the project
5. Result stored in the project's meditation directory

### Two-Phase Session

Similar to `plan` and `new` commands, `meditate create` uses a two-phase approach:
- Phase 1: Non-interactive kickoff to generate the meditation content
- Phase 2: (if applicable) Interactive resume for refinement
