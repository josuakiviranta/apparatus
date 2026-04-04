# Meditate Permissions Fix — Complete

All three bugs in `ralph meditate` have been fixed and tested.

## What was fixed

### Bug 1 — No real tool restriction
**Root cause:** `--permission-mode dontAsk` auto-approves all tool calls. `--allowedTools "Read"` only adds to an already-open list.
**Fix:** Added `--allowedTools "Glob"` and `--disallowedTools "ToolSearch"` to block tool expansion beyond the intentional set.

### Bug 2 — Write to illuminations blocked
**Root cause:** Absolute path `Write(/Users/.../**)` is invalid — Claude Code requires `//` prefix for absolute paths.
**Fix:** Use relative path `Write(meditations/illuminations/**)` which resolves correctly since subprocess runs with `cwd: absPath`.

### Bug 3 — Tool-use and thinking noise in stdout
**Root cause:** Stream parser printed `→ [tool]` lines and thinking blocks, flooding `.meditate.log` in cron mode.
**Fix:** Removed `tool_use` and `thinking` block printing. Only text content is emitted.

## Changes made

| File | Change |
|------|--------|
| `src/cli/commands/meditate.ts` | Extracted `buildMeditationArgs()` pure function; fixed allowedTools/disallowedTools; fixed Write path; cleaned output filter |
| `src/cli/tests/meditate.test.ts` | Added 7 tests for `buildMeditationArgs` covering tool lists, Write path format, and flag values |
| `src/cli/prompts/PROMPT_meditation.md` | Added "Tools available" section telling agent about Read, Glob, and Write constraints |
| `tsup.config.ts` | Dynamic prompt copying (supports PROMPT_meditation.md without hardcoding) |
| `.gitignore` | Added `.meditate.json` and `.meditate.log` |
