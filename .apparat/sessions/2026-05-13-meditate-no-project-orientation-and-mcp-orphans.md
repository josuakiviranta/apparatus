---
date: 2026-05-13
run_id: parallel-illumination-to-implementation-385ac7f5
plan: docs/superpowers/plans/2026-05-13-meditate-no-project-orientation-and-mcp-orphans.md
design: docs/superpowers/specs/2026-05-13-meditate-no-project-orientation-and-mcp-orphans-design.md
illumination: .apparat/meditations/illuminations/2026-05-13T0736-meditate-no-project-orientation-and-mcp-orphans.md
test_result: pass
---

# meditate no-project orientation and MCP orphans

## What was implemented
Project-shape preflight on `apparat meditate` (hard-refuse `.apparat`-internal folders; otherwise require VISION.md / CONTEXT.md / .apparat/ / .git/) plus run-scoped MCP config and a 60s heartbeat with `gcStaleRuns()` sweep on every `Agent.run` spawn — three-state semantics: fresh = skip, stale ≥5min = `rm -rf`, absent = preserve.

## Key files
- `src/cli/lib/pipeline-bootstrap.ts` — `assertApparatShape` + `gcStaleRuns` + heartbeat constants
- `src/cli/commands/meditate.ts` — preflight call before write
- `src/cli/lib/agent.ts` — writeMcpConfig signature now `{cwd, runId?, variables}`; roots `.mcp-*` at `<cwd>/.apparat/runs/<runId>/`; `gcStaleRuns(cwd)` fires once per spawn
- `src/cli/commands/pipeline/run.ts` — synchronous initial heartbeat before any await; 60s `.unref()`'d touch interval; `clearInterval` first in finally
- `src/attractor/core/engine.ts`, `src/attractor/handlers/looping-agent-handler.ts`, `src/attractor/handlers/registry.ts` — thread `runId` through `HandlerExecutionContext.meta`
- `.apparat/scenarios/meditate-rejects-internal-folder.md`, `.apparat/scenarios/meditate-sweeps-stale-mcp-configs.md` — new lock scenarios
- `docs/adr/0016-run-scoped-mcp-config-with-heartbeat.md` — extends ADR-0015
- `src/cli/skills/apparatus/SKILL.md` — Preflight discipline section
- `README.md` — preflight one-liner
- Deleted: `.apparat/.apparat/` ghost run; orphan `.mcp-verifier-1778665005965.json`, `.mcp-meditate-1777197355164.json` at repo root
- Salvaged: `.apparat/meditations/illuminations/2026-05-12T1028-collapse-memory-tail-and-tier-pipeline-models.md` (was buried in ghost folder)
- Tests: `src/cli/tests/meditate.test.ts`, `src/cli/tests/pipeline-bootstrap.test.ts`, `src/cli/tests/agent-run.test.ts`, `src/cli/tests/agent.test.ts`

## Decisions and patterns
- **Layered defense over single guard.** Preflight stops bad targets; run-folder scoping stops debris from reaching cwd; heartbeat sweep cleans crashed sessions; finally hook cleans live ones. Each layer holds independently.
- **Heartbeat at folder granularity, not per-file.** One `runs/<runId>/heartbeat` touched by the running pipeline; every agent inside the run inherits liveness. Matches ADR-0015 run-scoped scratch discipline.
- **Three-state semantics critical.** Absent heartbeat = preserve (completed run or pre-rule dir). Without this, sweeping would eat checkpoint.json + pipeline.jsonl on every clean run.
- **runId plumbing is additive.** `RunOptions.runId` optional; writeMcpConfig falls back to cwd root when absent. ~15 internal call sites compile unchanged.
- **Initial heartbeat synchronous (before any await).** Closes the brand-new-run-meets-sibling-sweep race. Runner now owns `mkdir(logsRoot)` instead of the engine.
- **gcStaleRuns(cwd) fires on every `Agent.run` spawn, not just meditate startup.** Janitor / illumination-to-implementation / any future pipeline inherits cleanup for free.
- **MCP configs are disposable receipts.** Once owning process dies, the file points at dead stdio — safe to delete on stale heartbeat.

## Gotchas and constraints
- `--mcp-config` already passed claude an absolute path, so relocating the file requires no claude-side change. Future callers must not assume cwd-relative.
- ENOENT must be swallowed during sweep (sibling sweepers may have already removed the folder). Mirrors existing `cleanupMcpConfig` pattern.
- Stale threshold is 5 min vs 60s touch interval — 5-cycle margin tolerates async-heavy agent work blocking the event loop briefly.
- Long-term growth of *completed* run folders is OUT OF SCOPE here — handled by sibling illumination `2026-05-13T0805-scratch-sediment-needs-an-apparat-sweep-command.md`.
- `.mcp-*-*.json` is gitignored, so `git status` never shows new orphans. Watch the filesystem, not git, when validating sweep behaviour.

## Final verification
- test_result: pass
- test_summary: Cycle 1: build green, 1596 tests passed, 17 scenarios validate clean, 5 scenarios driven end-to-end pass (agent-implement, tool, static-multi-node, conditional, store), preflight refusal verified for both internal-folder and non-shaped-folder paths. One janitorial gap fixed: orphan .mcp-meditate-1777197355164.json at repo root (gitignored, no commit) was missed by Chunk 4 cleanup commit 4d69b6c — deleted from filesystem.
