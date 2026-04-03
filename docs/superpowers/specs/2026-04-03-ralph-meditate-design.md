# ralph meditate — Design Spec

**Date:** 2026-04-03
**Status:** Approved

## Overview

`ralph meditate` runs a restricted Claude session against a project folder. Claude reads project files and meditation files, then writes a single structured "illumination" — a human-readable insight file — to `meditations/illuminations/`. It cannot implement, browse the web, or write anywhere else. Designed for async reflection: run it on a schedule, read the illuminations in the morning.

## Command Interface

```
# One-shot (no cron):
ralph meditate <project-folder>

# Scheduled:
ralph meditate <project-folder> --every <N>  [--until <datetime>]

# Manage schedule:
ralph meditate stop <project-folder>
ralph meditate status <project-folder>
```

**Flags:**
- `--every N` — interval in minutes (positive integer). Registers a cron job. **Default: 60 minutes.** Clean cron `*/N` syntax works best for values that divide 60 (1, 2, 5, 10, 15, 20, 30, 60); ralph warns for other values.
- `--until <datetime>` — ISO 8601 datetime string (e.g. `2026-04-04T20:00`). Optional. Cron self-removes when current time >= until.
- No `--every` flag → one-shot run, no cron registered.

**Subcommands:**
- `stop <project-folder>` — removes cron entry and `.meditate.json` sentinel
- `status <project-folder>` — reads sentinel, prints interval and end time (from `.meditate.json`); reports "no active schedule" if sentinel missing

## Architecture

### Scheduling: Crontab + Sentinel File

When `--every N` is passed, ralph:
1. Writes `.meditate.json` to the project folder root
2. Adds a cron entry to the user's crontab via `crontab -l | ... | crontab -`

**Sentinel file** (`.meditate.json`):
```json
{
  "every": 30,
  "until": "2026-04-04T20:00:00",
  "cronId": "ralph-meditate-<project-name>"
}
```

**Cron entry format:**
```
*/30 * * * * ralph meditate /abs/path/to/project &>>/abs/path/to/project/.meditate.log
# ralph-meditate-<project-name>
```

`&>>` redirects both stdout and stderr to `.meditate.log` so the full stream output (thinking blocks, tool calls, assistant text) is captured for scheduled runs.

The comment line is the anchor used by `stop` to find and remove the entry cleanly.

**End-time enforcement:** Each scheduled run first checks `until` in the sentinel. If `Date.now() >= until`, it removes the cron entry and sentinel, then exits without invoking Claude.

**Error log:** `stderr` from cron runs is appended to `.meditate.log` in the project folder. Silent during normal runs; inspectable when something goes wrong.

### Permission Enforcement

The meditation Claude session is invoked with hard permission constraints — not prompt-based guidance, but CLI-enforced restrictions:

```
claude \
  --print \
  --output-format stream-json \
  --permission-mode dontAsk \
  --allowedTools "Read" \
  --allowedTools "Write(/abs/path/to/project/meditations/illuminations/**)" \
  --add-dir /abs/path/to/project \
  -p "<meditation prompt>"
```

Two separate `--allowedTools` flags are passed — one per rule. The illuminations path is always an absolute path resolved at invocation time from the project folder argument.

What this enforces:
- `Read` — allowed anywhere in the working directory (project folder)
- `Write` — allowed **only** at the absolute path of `meditations/illuminations/`
- `Bash`, `WebFetch`, `Edit`, `Agent`, all MCP tools — **auto-denied** by `dontAsk` mode
- No internet access: `WebFetch` denied, `Bash` denied (no curl/wget escape)

`dontAsk` mode auto-denies any tool not in the allow list without prompting. The illuminations path is resolved to an absolute path at invocation time.

### Output Format

Follows loop.sh style. Header printed to stdout before Claude starts:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Mode:    meditate
Project: /path/to/myproject
PID:     12345 (kill 12345 to stop)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Stream-json output is piped through a `jq` filter matching loop.sh's pattern, with two additions: thinking blocks are shown, and Read tool calls include the file path:

```jq
if .type == "assistant" then
  .message.content[]? |
  if .type == "text" then .text
  elif .type == "thinking" then .thinking
  elif .type == "tool_use" and .name == "Read"
    then "→ [tool] Read: \(.input.file_path)"
  elif .type == "tool_use"
    then "→ [tool] \(.name)"
  else empty end
else empty end
```

For scheduled runs, the cron entry redirects all output (`&>>`) to `.meditate.log`, so the full stream is captured there instead of a terminal.

## Project Folder Layout

Ralph ensures these paths exist before invoking Claude (creates if missing):

```
<project-folder>/
  meditations/
    illuminations/    # Claude writes here only
  .meditate.json      # present only when cron is active
  .meditate.log       # stderr from cron runs, appended
```

Ralph appends `.meditate.json` and `.meditate.log` to the project's `.gitignore` automatically (same pattern as prompt bootstrap in `prompts.ts`).

## ralph new Integration

`ralph new` now scaffolds `meditations/` and `meditations/illuminations/` as part of the new project structure, and adds the following entries to the generated `.gitignore`:

```
meditations/illuminations/
.meditate.json
.meditate.log
```

This means new projects come pre-configured to ignore AI-generated illuminations and meditate runtime files. For existing projects, `meditate` adds these entries lazily to `.gitignore` on first run (same pattern as prompt bootstrap in `prompts.ts`).

## Illumination Output

One file per meditation run. Claude chooses the filename — descriptive, timestamp-prefixed (e.g. `2026-04-03T14:32-loop-coupling.md`).

**Required structure** (enforced by `PROMPT_meditation.md`):
- **Core Idea** — what the insight is, stated plainly
- **Why It Matters** — connection to project goals or current pain points
- **Revised Implementation Steps** — concrete, ordered steps a developer could act on

Files are intended for human review. The human judges which illuminations are worth acting on.

## New Files

```
src/cli/
  commands/meditate.ts          # run, stop, status logic
  prompts/PROMPT_meditation.md  # bundled meditation prompt
  tests/meditate.test.ts        # unit tests
```

`assets.ts` gains `getMeditationPromptPath()` — same pattern as `getKickoffPromptPath()`.

## Code Reuse Note

The stream-json output rendering (jq filter + header) is similar to loop.sh but needs the thinking + Read-path extensions. Implement inline in `meditate.ts` for now — extract to `lib/stream-output.ts` only if a third command needs the same pattern.
