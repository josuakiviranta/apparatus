---
name: Validator/runtime defaults parity shipped
description: Generic default_<varname> acceptance on agent/gate/tool nodes; whitelist removed, diagnostics filtered, parity fixture pins runtime==validator
type: project
---

# Validator / Runtime Defaults Parity Shipped

**Run:** 8ee9cb51-5e29-4f96-b064-76da4e9764b5
**Illumination:** meditations/illuminations/2026-04-20T1800-validator-and-runtime-disagree-on-defaults.md
**Design:** specs/2026-04-20-validator-and-runtime-disagree-on-defaults-design.md
**Plan:** docs/superpowers/plans/2026-04-20-validator-and-runtime-disagree-on-defaults.md

## What was implemented

Validator now accepts any attribute matching `/^default[A-Z]/` on agent, gate, and tool nodes. Runtime `extractDefaults()` was already generic — the four-key whitelist in `AgentNodeSchema` + single-key whitelist in `GateNodeSchema` was the false-floor. Fixed by:

- Removing the four `default*` fields from `AgentNodeSchema` and the one from `GateNodeSchema`.
- Adding `DEFAULT_SEED_KEY_RE` + `isDefaultSeedKey` helper.
- Post-filtering zod `unrecognized_keys` diagnostics for kind ∈ {agent, gate, tool} to drop seed-shaped keys before emitting.
- Seed-rule trailing line in `formatAllowedAttrs` for the three kinds.
- Shared parity fixture test ensures runtime/validator never drift on the rule.
- `extractDefaults` characterising unit tests added.
- Engine spec doc paragraph documenting per-node seed contract.

## Key files

- `src/attractor/core/schemas.ts` — whitelist removal + helper + diagnostic filter + formatAllowedAttrs suffix
- `src/attractor/tests/schemas.test.ts` — inverted rejection, generic acceptance, regression-whitelist, `defaulted` negative
- `src/attractor/tests/default-seed-parity.test.ts` (new) — shared fixture table
- `src/attractor/tests/variable-expansion.test.ts` — extractDefaults suite
- `docs/superpowers/specs/2026-04-08-attractor-pipeline-engine-design.md` — per-node seed paragraph
- `pipelines/tests/illumination-to-implementation.artifacts.test.ts` — aligned to always-emit `archive_reason_short` contract (commit 2220b93)

## Decisions

- **Filter diagnostics, don't loosen zod shape.** Kept `.strict()` on all three schemas; dropped seed-shaped keys from `unrecognized_keys` issues inside `validateNode`. Rationale: `describeKind` stays declarative, schema shape documents only non-seed fields, seed-rule line carries the generic contract.
- **Tool node included.** Illumination claimed `ToolNodeSchema` was not `.strict()` — source disagreed; tool is also strict with refines layered. Fix covers all three kinds to avoid a second-class path.
- **Parity fixture is load-bearing.** Shared row table runs through `isDefaultSeedKey` + a minimal `extractDefaults` harness. Future runtime narrowing must surface here.

## Gotchas

- `camelToSnake` conversion happens after diagnostic filtering — filter reads zod-reported camelCase keys (`schemas.ts:148`), not snake. Getting the order wrong would let `default_foo` through the regex as `defaultFoo` but filter `default_foo` (snake) and miss.
- `ToolNodeSchema` refines (`script_command_conflict`, `tool_node_needs_command_or_script`) run after strict key check; post-zod filter does not touch those diagnostics.
- Removed `unrecognized!.hint!.toContain("default_refinements")` assertion from original rejection test — after whitelist removal, `default_refinements` is no longer a first-class field in hint text; the seed-rule line documents the generic contract instead.

## Learnings

tmux-tester surfaced 2 failures on first cycle in `pipelines/tests/illumination-to-implementation.artifacts.test.ts` — unrelated drift from an earlier verifier change (always-emit `archive_reason_short`) that had not aligned its pinned tests. Fixed inline (commit 2220b93) and rerun green. Pattern: artifact tests that snapshot pipeline-level field contracts can silently rot when upstream verifier nodes change their emit shape — the pinned schema assertion catches it loudly when any later change runs `npm test`.

## Final verification

- Build: ✅ clean (tsup 0.1.31).
- Tests: ✅ 88 files / 1046 tests green after one in-session fix.
- Commits landed on main:
  - `3e50045` helper
  - `08b6125` parity fixture
  - `f0e7b53` whitelist removal + diagnostic filter
  - `83c1a55` regression whitelist tests
  - `55c0e08` formatAllowedAttrs seed-rule suffix
  - `9f36415` extractDefaults unit coverage
  - `7b783f5` docs spec
  - `2220b93` artifact test realign (tmux-tester fix)
