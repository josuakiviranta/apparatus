# ralph CLI Implementation Plan

**Status: COMPLETE** — All chunks implemented and verified.

## What was built

A globally-installable TypeScript CLI (`ralph`) wrapping the agentic loop runner pattern:
- `ralph <project-folder> plan` — interactive Claude TUI session
- `ralph <project-folder> implement [--max N]` — headless loop via loop.sh
- `ralph <project-folder>` — alias for implement

## Architecture

- **CLI entry:** `src/cli/index.ts` (commander)
- **Commands:** `src/cli/commands/{plan,implement}.ts`
- **Lib:** `src/cli/lib/{assets,prompts}.ts`
- **Tests:** `src/cli/tests/{assets,prompts}.test.ts` (vitest, 11 tests)
- **Build:** tsup → `dist/` with bundled loop.sh and prompt files

## Key learnings

- **Asset path resolution bug (fixed):** The plan specified `join(__dirname, "..")` for asset paths, but tsup bundles into a single `dist/index.js` where `__dirname` = `dist/`. Going up one level would resolve to project root, not `dist/`. Fixed by detecting `basename(__dirname) === "dist"` to determine environment (production vs dev).

## Potential future work

- Add integration tests for plan/implement commands (currently only unit tests for lib)
- npm publish workflow
- Support custom prompt file names via CLI flags
