# Agent.kill Dead-Code Deletion Plan

**Status: SHIPPED** — tag v0.2.11, committed 2026-05-01.

All 13 steps completed. `Agent.kill()`, the `private _child` field, and its four assignment sites removed from `src/cli/lib/agent.ts`. Full test suite (135 files, 1258 tests) green before and after. Illumination consumed in a separate commit per ADR 0002.

Commits:
- `refactor(agent): drop dead Agent.kill() method and _child field`
- `consume: 2026-05-01T0055-janitor-dead-agent-kill`

Next steps: none for this chunk.
