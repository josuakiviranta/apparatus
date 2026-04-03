# ralph new — Project Scaffolding Command

**Date:** 2026-04-03
**Status:** Approved

## Overview

`ralph new <project-name>` scaffolds a new agentic project folder in the current working directory, initializes a git repo, and launches a Claude kickoff session to define the project's README and initial specifications.

## Command Signature

```
ralph new <project-name>
```

Creates `./project-name/` in cwd.

## Behavior

### 1. Conflict Check

If `./project-name/` already exists, print a warning and exit with a non-zero code. No overwrite, no merge.

### 2. Folder Structure

```
<project-name>/
├── .gitignore              # PROMPT-*.md, IMPLEMENTATION_PLAN.md
├── AGENTS.md               # empty
├── IMPLEMENTATION_PLAN.md  # empty
├── PROMPT_build.md         # empty
├── PROMPT_plan.md          # empty
├── README.md               # empty (Claude fills this in kickoff)
├── specs/                  # empty dir
└── src/
    └── tests/
        ├── integration/    # empty dir
        ├── scenarios/      # empty dir
        └── unit/           # empty dir
```

All files are language-agnostic and empty. No assumptions about runtime, framework, or tooling.

### 3. Git Init

Run `git init -b main` in the project folder.

### 4. Claude Kickoff Session

Two-phase session using the same mechanism as `plan.ts`:

- **Phase 1 (non-interactive):** Spawn `claude -p` with a bundled `PROMPT_kickoff.md` as system prompt, substituting `{{PROJECT_NAME}}` with the actual project name. Claude writes `README.md` and `specs/README.md`.
- **Phase 2 (interactive):** Parse session ID from stream-JSON output, resume as interactive TUI so the user can steer and refine.

## Bundled `PROMPT_kickoff.md`

```markdown
You are helping initialize a new software project called "{{PROJECT_NAME}}".

Your goal is to define what this project is before any code is written.

Do the following in order:
1. Ask the user to describe the project in a few sentences — what it does, who it's for, and any key constraints.
2. Write a succinct README.md in the project root: what it is, why it exists, how to use it (stub).
3. Write specs/README.md: a 2–3 sentence description of the project followed by a lookup table listing future spec files that will live in specs/*.md (leave the table empty for now — just the headers).

Keep both files short. Avoid filler. Do not write any code.
```

## Implementation

### New files

- `src/cli/commands/new.ts` — command implementation
- `src/cli/prompts/PROMPT_kickoff.md` — bundled kickoff prompt

### Modified files

- `src/cli/index.ts` — register `new` subcommand
- `src/cli/lib/assets.ts` — add `getKickoffPromptPath()` helper
- `tsup.config.ts` — copy `PROMPT_kickoff.md` to `dist/`

### Code reuse note

The two-phase Claude session logic (non-interactive kickoff → parse session ID → interactive resume) is currently in `plan.ts` and will be duplicated in `new.ts`. This is intentional — extract to `lib/claude-session.ts` only when a third command needs it.

## Error Handling

- Project folder already exists → warn + exit 1
- `claude` CLI not installed → same check/error as `plan` and `implement` commands
- `git init` failure → surface error, leave scaffolded folder in place
