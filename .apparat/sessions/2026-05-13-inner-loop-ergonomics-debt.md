---
date: 2026-05-13
run_id: parallel-illumination-to-implementation-8df863b6
plan: docs/superpowers/plans/2026-05-13-inner-loop-ergonomics-debt.md
design: docs/superpowers/specs/2026-05-13-inner-loop-ergonomics-debt-design.md
illumination: .apparat/meditations/illuminations/2026-05-12T2324-inner-loop-ergonomics-debt.md
test_result: pass
---

# Inner-loop ergonomics debt

## What was implemented
`apparat pipeline show` now spawns the OS default opener (`open`/`xdg-open`/`start`) after writing the SVG, gated by `--open`/`--no-open` with TTY-aware default; `.claude/settings.local.json` allowlist rewritten to drop the dead `Bash(ralph:*)` grant and grant the verbs actually run daily (`apparat`, `git status/log/diff/show/branch`, `rg`, `node`/`tsx`/`vitest`, `open`, `mcp__illumination__*`). ADR-0018, SKILL.md row, and README paragraph updated.

## Key files
- `.claude/settings.local.json` — M (c1: allowlist rewrite)
- `src/cli/commands/pipeline/show.ts` — M (c2: auto-open + `--no-open` gate)
- `src/cli/program.ts` — M (c2: register `--open`/`--no-open` flags)
- `src/cli/tests/pipeline-show-no-open.test.ts` — A (c2: `--no-open` skips spawn)
- `docs/adr/0018-pipeline-show-opens-svg.md` — A (c3)
- `src/cli/skills/apparatus/SKILL.md` — M (c3: pipeline-show row auto-open hint)
- `README.md` — M (c3: pipeline-show paragraph)

## Decisions and patterns
- ADR-0018 chosen over the illumination's proposed `0016` because `0016` and `0017` are already taken (run-scoped MCP heartbeat, tsup NODE_ENV pin). Verifier caught the drift.
- `--no-open` is the TTY-aware default in headless contexts — protects `pipeline-show-annotation.test.ts` from spawning `open` in CI without changing the existing test signature.
- Spawn failure is non-fatal: log + exit 0. `pipeline show`'s job is to write the SVG; opening is a convenience, not a contract.
- Three parallel chunks (c1 allowlist, c2 auto-open + tests, c3 docs/ADR) — DAG scheduler ran them concurrently, then merge commits joined back to main. Zero conflicts.

## Final verification
- test_result: pass
- test_summary: Cycle 1 clean: npm run build green; vitest 1602 passed, 3 skipped (181 files). Phase 3 manual: `pipeline show .apparat/scenarios/static-multi-node/pipeline.dot --no-open` exited 0 and wrote the SVG without spawning an opener; `pipeline show --help` lists the new `--open` / `--no-open` flags; `pipeline validate` on the gate scenario exited 0 (parser shared with show is intact). 17 scenarios discovered, 1 included (floor sanity — diff was scoped to `pipeline show` + Claude allowlist + docs, zero engine surfaces), 0 failed, 16 skipped (diff-irrelevance).
