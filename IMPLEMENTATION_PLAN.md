# Implementation Plan

All spec documentation tasks completed (2026-04-07).

## Completed — Update specs/

All 11 tasks from the specs update plan are done:

- [x] Task 1: Rewrite `specs/loop.md` — now documents `loop.ts` TypeScript module
- [x] Task 2: Update `specs/architecture.md` — ESM, 4 entry points, 7 commands, daemon/MCP structure
- [x] Task 3: Rewrite `specs/commands.md` — all 7 commands documented (plan, implement, new, meditate, meditate create, run-scenarios, heartbeat)
- [x] Task 4: Fix `specs/bootstrap.md` — scope corrected to implement-only
- [x] Task 5: Create `specs/stream-formatter.md` — pure functional module, subagent buffering, ctx growth gating
- [x] Task 6: Create `specs/meditate.md` — sandboxed sessions, PID management, MCP integration
- [x] Task 7: Create `specs/run-scenarios.md` — scenario discovery, execution, report writing
- [x] Task 8: Create `specs/heartbeat.md` — all 5 subcommands, daemon auto-start, known watch issue
- [x] Task 9: Create `specs/daemon.md` — process lifecycle, socket IPC, state schema, scheduler, runner
- [x] Task 10: Create `specs/mcp-illumination.md` — 5 MCP tools, path restrictions, launch config
- [x] Task 11: Create `specs/README.md` — project intro and spec index

## Known Issues

- `ralph heartbeat watch` crashes — ink ESM/top-level-await incompatible with tsup ESM output
- No `src/tests/scenarios/` directory exists yet (manual scenario tests not set up)
