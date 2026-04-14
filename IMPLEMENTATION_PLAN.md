# Implementation Plan

No outstanding items. Last completed: Spec Sync + Handler Test Coverage (v0.1.20).

## Completed (v0.1.20)

- Fixed 4 spec inconsistencies: meditate.md PID path (`.ralph-meditate.pid` → `.meditate.pid`), MCP tool count (5 → 10), run-scenarios.md UI framework (`@clack/prompts` → readline), meditate kill subcommand (removed — handled via heartbeat)
- Updated mcp-illumination.md: added 3 missing lifecycle tools (`mark_implemented`, `mark_dispatched`, `mark_archived`), count 7 → 10
- Updated architecture.md: added entire attractor pipeline engine, Ink components, 10 missing lib modules, `chat.md` agent, `globals.d.ts`
- Added 11 new tests for `RalphMeditateHandler` (7) and `RalphScenariosHandler` (4) — previously zero coverage
- Added 7 edge-case tests for ParallelHandler, FanInHandler, ManagerLoopHandler
- Total: 61 test files, 736 tests, all passing
