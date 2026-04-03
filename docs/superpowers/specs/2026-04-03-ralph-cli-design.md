# ralph CLI — Design Spec

Date: 2026-04-03

## Overview

`ralph` is a TypeScript CLI that wraps the agentic loop runner pattern into a portable, installable tool. It lets you drive AI-assisted planning and implementation on any project folder from the command line.

```
npm install -g ralph-cli
ralph <project-folder> plan
ralph <project-folder> implement [--max N]
```

## Architecture

### File Structure

```
ralph-cli/
├── src/cli/
│   ├── index.ts                  # CLI entry point, commander setup
│   ├── commands/
│   │   ├── plan.ts               # plan command
│   │   └── implement.ts          # implement command
│   ├── lib/
│   │   └── prompts.ts            # prompt resolution logic
│   └── prompts/
│       ├── PROMPT_plan.md        # bundled default (mirrors repo root)
│       └── PROMPT_build.md       # bundled default (mirrors repo root)
├── loop.sh                       # bundled at build time into dist/
├── package.json                  # bin: { "ralph": "./dist/index.js" }
├── tsup.config.ts                # bundles src/cli → dist/, copies assets
└── dist/                         # published artifact (not committed)
```

### Package

- **npm package name:** `ralph-cli`
- **binary name:** `ralph`
- **runtime:** Node.js (no Bun required for end users)
- **build tool:** tsup
- **arg parsing:** commander
- **distribution:** `npm install -g ralph-cli`

## Commands

### `ralph <project-folder> plan`

Starts an interactive Claude Code TUI session in the project folder for planning.

1. Run prompt bootstrap check (see below)
2. Resolve `<project-folder>` to absolute path; error if not found
3. Read `<project-folder>/PROMPT_plan.md`
4. Spawn `claude` with:
   - `cwd: projectFolder`
   - `stdio: 'inherit'` — full TUI passthrough
   - Initial prompt injected via `--append-system-prompt` flag
5. Process exits when user closes the session — no post-processing

### `ralph <project-folder> implement [--max N]`

Runs the agentic build loop using `loop.sh`.

1. Run prompt bootstrap check (see below)
2. Resolve & validate project folder
3. Resolve path to bundled `loop.sh` (in `dist/`)
4. Resolve path to `<project-folder>/PROMPT_build.md`
5. Execute `loop.sh <prompt-file-path> [max_iterations]` with:
   - `cwd: projectFolder`
   - `stdio: 'inherit'`
6. All git operations inside `loop.sh` run with `cwd: projectFolder` — targeting that repo's git

`loop.sh` is modified to accept an explicit prompt file path as argument (instead of hardcoded relative path), enabling it to work from any directory.

### `ralph <project-folder>` (no subcommand)

Alias for `ralph <project-folder> implement`.

## Prompt Bootstrap

Runs before every command. Ensures the project has prompt files before any Claude session starts.

**Algorithm:**

```
for each of [PROMPT_plan.md, PROMPT_build.md]:
  if <project-folder>/<file> does not exist:
    copy bundled default → <project-folder>/<file>
    append <file> to <project-folder>/.gitignore (create if needed)
    record as injected
```

If any files were injected:
- Print a notice listing what was injected and where
- Print: "Review and customize these prompts, then re-run your command."
- **Exit 0** — do not proceed with the requested command

If both files already exist → continue with the command normally.

**Example output on first run:**

```
Injected default prompts into /path/to/project:
  + PROMPT_plan.md
  + PROMPT_build.md
  + Added entries to .gitignore

Review and customize these prompts, then re-run your command.
```

## Error Handling

| Condition | Behavior |
|---|---|
| `<project-folder>` does not exist | Print error, exit 1 |
| `claude` not in PATH | Print "claude CLI not found. Install: npm install -g @anthropic-ai/claude-code", exit 1 |
| Git push fails in loop | Retry with `-u origin <branch>` (mirrors current loop.sh behavior) |
| `loop.sh` not executable | `chmod +x` it before calling |

## loop.sh Modification

The existing `loop.sh` is modified minimally: accept an explicit prompt file path as the first argument instead of deriving it from mode. The `plan` mode argument is removed (plan is now handled by the TUI command). Build is the only loop mode.

```bash
# New signature:
# Usage: ./loop.sh <prompt-file> [max_iterations]
PROMPT_FILE=$1
MAX_ITERATIONS=${2:-0}
```

This keeps `loop.sh` usable standalone while making it work correctly when called from any working directory by `ralph`.

## Asset Bundling

`tsup.config.ts` copies `loop.sh`, `PROMPT_plan.md`, and `PROMPT_build.md` into `dist/` alongside the compiled JS. At runtime, ralph resolves these assets relative to the location of `dist/index.js` using `import.meta.url` / `__dirname`.

## Development Workflow

```bash
npm install
npm run dev        # tsx watch src/cli/index.ts
npm run build      # tsup → dist/
npm link           # symlink ralph binary locally for testing
```
