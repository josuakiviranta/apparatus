# Implementation Plan

The rubric-prepend plan shipped on 2026-04-22 as **v0.1.32** (tag `0.1.32`, commit `929c4e0`).

**Shipped:**
- Engine layers agent rubric + node task (`rubric\n\n---\n\ntask`) with empty-rubric short-circuit. See `src/attractor/handlers/agent-handler.ts:62-72` and 4 new tests in `src/attractor/tests/agent-handler.test.ts`.
- `src/cli/agents/task.md` — procedure-less one-shot agent.
- `validateAgentConfig` accepts empty prompt (required for procedure-less agents).
- 28 pipeline nodes migrated off `agent="implement"` onto `task` or specialist agents across 11 pipeline files. Real spider uses preserved at `pipelines/illumination-to-implementation.dot:38` and `pipelines/poc-implement.dot:10`.

**Verification:**
- `npm test` → 1062/1062 green.
- All non-tmux smokes green after `agent-json-vars` schema fix (2026-04-22): `agent-implement`, `agent-json-vars`, `conditional`, `json-schema-stream`, `static-multi-node`.
- Composition spot-checks for `tmux-tester` (non-empty rubric, correct ordering) and `mark_archived` (task agent, no stray separator).

See memory entry `memory/2026-04-22-rubric-prepend-shipped.md` for detailed run notes.

---

## Open follow-ups

- **Janitor agent MCP server not registered in headless runs (discovered 2026-04-25).** `pipelines/janitor.dot` ran end-to-end during the lifecycle-orphan-plans verification, but the janitor agent reported `mcp__illumination__*` server is not registered in Claude settings, and Edit/Write are denied in dontAsk mode. Janitor completed all read steps (correctly identified T1400 + T1200 should flip to `implemented`) but could not invoke `mark_implemented`. Commit `7781b15 fix(agent-handler): auto-inject MCP infra vars + dev-mode tsx swap` was supposed to auto-inject MCP servers into agent sessions; either the injection isn't reaching headless `permissionMode: dontAsk` paths, or the agent's tool whitelist excludes the registered name. Repro: `ralph pipeline run pipelines/janitor.dot --project .`. Until fixed, every janitor run is investigation-only — lifecycle reconciliation must be done by hand.
- **Spec drift: T0300 status (discovered 2026-04-25).** `docs/superpowers/specs/2026-04-25-janitor-lifecycle-orphan-plans-design.md` claimed `meditations/illuminations/2026-04-14T0300-meditate-has-no-backpressure.md` is `open`. Actual status: `archived` (file still in top-level dir, frontmatter `status: archived`). Backfill of `illumination_source` on `2026-04-12-meditate-backpressure-guard.md` was still applied — janitor used it to surface a finding ("re-key plan to active illumination or archive plan"). No corrective action needed on the back-pointer; spec text was just stale.
- **Verification-matrix downstream wiring** (from `meditations/illuminations/2026-04-20T2900-verification-matrix-in-plan.md` parts (b) + (c)). Rubric now mandates the sub-block; still to do: (b) add structured `verification_targets` to `pipelines/schemas/plan-writer.json` and wire it into `tmux_tester`'s context + Phase 2, and (c) add `ralph pipeline trace --coverage`. Defer until a real run produces a matrix to dog-food against.
- **Plan-chunk verification-targets lint** (from T2900 part (a)(3)). A vitest that walks `docs/superpowers/plans/*.md` and asserts every `## Chunk` is followed by a `## Verification targets` block before the next chunk. Deferred because historical plans (2026-04-03…2026-04-21) predate the rubric and would all red-phase; needs a date-cutoff or backfill strategy first.

## Recently shipped

- **Janitor agent + pipeline (2026-04-25).** Read-only nightly agent that reconciles dispatched→implemented illumination lifecycle and surfaces doc-drift / dead-code as new illuminations. Single agent file `src/cli/agents/janitor.md` (sonnet, `permissionMode: dontAsk`, 9-tool whitelist: 8 illumination MCP + native `Grep`). One-node `pipelines/janitor.dot` (`headless_safe=true`, `inputs="project"`). Two contract tests: `src/cli/tests/janitor-agent.test.ts` (10 assertions covering frontmatter identity, tool whitelist, forbidden-tool exclusion, MCP server config, body rubric, lifecycle trigger, one-illumination cap, three-prior-readings rule, body headings, filename convention) + `pipelines/tests/janitor.artifacts.test.ts` (5 DOT shape assertions). README schedule example added beneath the meditate block. Verification: `npm test` 1110/1110 green, `npm run build` clean, `dist/agents/janitor.md` bundled, `pipeline validate` exit 0. Spec: `docs/superpowers/specs/2026-04-25-janitor-agent-design.md`. Schedule via `ralph heartbeat pipeline pipelines/janitor.dot --project . --every 720`.
- **State-machine lifecycle integrity (2026-04-25, v0.1.36).** Closes three gaps in the illumination state machine (illumination `2026-04-14T0600-state-machine-exists-verifier-ignores-it.md`):
  1. `pipelines/illumination-to-plan.dot:8` verifier step 1 now calls `mcp__illumination__list_illuminations` with `status: open` instead of globbing `*.md`, so dispatched items are no longer re-selected.
  2. `markImplemented`, `markDispatched`, and `markArchived` in `src/cli/mcp/illumination-server.ts` each append the `writeIllumination` `try/catch` git-commit pattern. `markArchived` stages both the deleted source path and the new archive path before committing so the rename is one commit (`meditate: archive <file>`). Fail-open on any git error.
  3. `listIlluminations` adds a one-line directory branch: when `status === "archived"`, `readdirSync` targets `meditations/illuminations/archive/`. All other status values (and unfiltered calls) keep reading the top-level dir.
  Verification: `npm test` 1076/1076 green; `npm run build` clean. New tests: 2 in `src/cli/tests/illumination-to-plan-pipeline.test.ts` (verifier prompt regression), 6 in `src/cli/tests/illumination-server.test.ts` (auto-commit × 3, archive-listing × 3, plus 2 fail-open). Test isolation note: auto-commit tests use `mockReset()` (not `mockClear()`) to avoid `mockImplementation` leaks from neighboring fail-open tests.
  Spec: `specs/2026-04-25-state-machine-exists-verifier-ignores-it-design.md`. Plan: `docs/superpowers/plans/2026-04-25-state-machine-exists-verifier-ignores-it.md`.
- **Plan-writer rubric: `## Verification targets` per chunk (2026-04-22, v0.1.35).** `src/cli/agents/plan-writer.md` step 4 now requires each chunk to close with a 5-row sub-block (Smokes / Scenario tests / Manual exercises / Lint / Surfaces touched), quoting the exact row structure and reminding the writer that `tmux_tester` consumes it verbatim. Implements part (a)(1) of illumination `2026-04-20T2900-verification-matrix-in-plan.md`. Schema and lint changes (parts (a)(2)/(a)(3)) are held back as open follow-ups above — their scope belongs with the downstream consumer work, not with the rubric formalisation. Verification: `npx vitest run` 1062/1062 green, `npx tsc --noEmit` clean.
- **Plan reviewer reference disambiguated (2026-04-22).** `plan-writer.md` and `pipelines/illumination-to-implementation.dot` no longer refer to a non-existent `plan-document-reviewer` subagent; both now explicitly dispatch the Task tool with `subagent_type: "general-purpose"` using the `plan-document-reviewer-prompt.md` template from the `superpowers:writing-plans` skill. Matches the skill's own guidance.
