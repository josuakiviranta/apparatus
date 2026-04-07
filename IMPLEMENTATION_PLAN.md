# Implementation Plan

All prior plan items (loop.ts module, stream-formatter observability) are complete.

## Completed

- **loop.ts module** (tag 0.0.16): Replaced loop.sh with TypeScript `runLoop()` in `src/cli/lib/loop.ts`. Uses `@clack/prompts` for UI, imports `stream-formatter.processLine()` directly. `implement.ts` simplified to call `runLoop()`. Dead code (`getLoopShPath`, `getStreamFormatterPath`) removed from assets.ts.
- **stream-formatter observability** (tag 0.0.15): `processLine()` renders tool calls, subagent boundaries, token counts with cache support, and `mainHeaderPrinted` dedup.
- **stream-formatter standalone fix** (tag 0.0.17): Fixed `import.meta.url` guard broken by tsup chunk splitting. Replaced with filename pattern test.

## Future Work

- **Smoke test loop.ts end-to-end**: Run `ralph <project> implement --max 1` against a real project to verify clack output, stream formatting, git push spinner, and clean exit.
- **Remove loop.sh**: Once loop.ts is validated in production, remove `loop.sh` from the repo and its copy step in `tsup.config.ts`.
- **`ralph new` command**: Brainstorm complete, plan pending.
