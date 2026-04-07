# Implementation Plan

All core commands and infrastructure are complete.

## Completed

- **loop.ts module** (tag 0.0.16): Replaced loop.sh with TypeScript `runLoop()` in `src/cli/lib/loop.ts`.
- **stream-formatter observability** (tag 0.0.15): `processLine()` renders tool calls, subagent boundaries, token counts.
- **stream-formatter standalone fix** (tag 0.0.17): Fixed `import.meta.url` guard broken by tsup chunk splitting.
- **ralph new command**: Full implementation — scaffoldProject, buildKickoffPrompt, two-phase kickoff session.
- **ralph run-scenarios command**: Discovery, header parsing, interactive selection, Claude session execution, report output.
- **meditate.ts fixes**: RALPH_TEST_CMD override, exit code surfacing, tool-use progress indicators.
- **Scaffold correction** (tag 0.0.18): Removed TS-specific `src/tests/{integration,unit}/` and `meditations/illuminations/` from `ralph new` scaffold. Now language-agnostic per run-scenarios spec.
- **loop.sh removed** (tag 0.0.18): Deleted `loop.sh` and its copy step from `tsup.config.ts`. CLI uses `loop.ts` exclusively.

## Known Issues

- **`ralph heartbeat watch` broken**: ink ESM/top-level-await incompatible with tsup CJS output. Low priority — daemon infrastructure works, only the TUI watcher is affected.

## Future Work

- **CLI help consolidation**: Remove `meditate stop`/`meditate status` commands, redirect to `heartbeat stop`/`heartbeat pause`/`heartbeat resume` per CLI help readability spec.
- **Smoke test loop.ts end-to-end**: Run `ralph <project> implement --max 1` against a real project to verify clack output, stream formatting, git push spinner, and clean exit.
- **Update specs for loop.sh removal**: Historical specs reference loop.sh — update to reflect loop.ts as the sole engine.
