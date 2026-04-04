# Meditate Path Restriction Implementation Plan

**Status:** ✅ COMPLETE (2026-04-04)

**Goal:** Restrict `ralph meditate` so Claude can only read files within the project folder, by replacing native `Read`/`Glob` tools with path-enforcing MCP tools.

**Architecture:** Extended `illumination-server.ts` MCP server with three new tools — `read_file`, `glob_files`, `project_tree` — each enforcing that paths resolve within `projectRoot`. Removed `Read` and `Glob` from `--allowedTools` in `buildMeditationArgs` and replaced with MCP equivalents. Updated `PROMPT_meditation.md` to reference the new tools.

## What Was Done

1. **Installed `fast-glob`** runtime dependency for glob pattern matching
2. **Added `assertWithinRoot`** — resolves paths and validates they're within project root (handles `..` traversal, prefix-match attacks)
3. **Added `readFile`** — path-restricted file reader (relative + absolute paths)
4. **Added `validateGlobPattern` + `globFiles`** — validates patterns are relative with no `..` segments, uses fast-glob with cwd restriction
5. **Added `projectTree`** — recursive directory listing with smart skip list (node_modules, .git, dist, etc.)
6. **Registered three MCP tools** in illumination server: `read_file`, `glob_files`, `project_tree`
7. **Updated `buildMeditationArgs`** — replaced native `Read`/`Glob` with `mcp__illumination__read_file`, `mcp__illumination__glob_files`, `mcp__illumination__project_tree`
8. **Updated `PROMPT_meditation.md`** — documented the three new MCP tools and updated task instructions

## Learnings

- **`assertWithinRoot` must resolve paths** — the implementation plan's original code did a simple string prefix check, but `/proj/../etc/passwd` starts with `/proj/` and would pass. Using `resolve()` normalizes `..` traversal before checking.
- **`@ts-expect-error` not needed for single-property schemas** — the deep type instantiation error only triggers with multi-property zod schemas passed to `server.tool()`. Single-property schemas (`{ path: z.string() }`, `{ pattern: z.string() }`) and optional schemas work fine without the directive.
- **Test count went from 77 → 107** — 30 new tests covering all path restriction logic

## No Remaining Work

All 10 tasks across 3 chunks are complete. The meditation session is now fully sandboxed to the project folder.
