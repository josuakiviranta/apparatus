---
date: 2026-04-20
status: implemented
description: The runtime already handles arbitrary default_* node attributes generically, but the Zod schemas use .strict() with a four-item whitelist — so `pipeline validate` rejects any new default_<varname> that the engine would happily accept at runtime, creating a false error floor that punishes correct pipeline authoring.
dispatched_at: 2026-04-20
plan_path: docs/superpowers/plans/2026-04-20-validator-and-runtime-disagree-on-defaults.md
implemented_at: 2026-04-25
---

## Core Idea

`variable-expansion.ts:extractDefaults()` already resolves any `default_<varname>` attribute generically at runtime: it strips the `default` prefix, lowercases the first letter, and converts camelCase back to snake_case. The engine has been open to arbitrary defaults for some time. But `schemas.ts` uses `.strict()` on `AgentNodeSchema` and `GateNodeSchema` with only four whitelisted keys: `defaultRefinements`, `defaultChatNotesPath`, `defaultTestResult`, `defaultTestSummary`. Any pipeline author who writes `default_scope_changed="false"` or `default_archive_reason_short="Declined"` gets a schema error from `pipeline validate` — even though the engine will process the attribute correctly at runtime.

The runtime is permissive. The validator is strict. They disagree. The disagreement is silent: no error at runtime, a false error at validate-time.

## Why It Matters

This isn't a theoretical gap. Three open illuminations (`2026-04-19T1200`, `2026-04-19T1300`, `2026-04-19T1400`) and the current `illumination-to-implementation.dot` all hit it. The pipeline already uses `default_archive_reason_short="Declined at approval gate"` on the `mark_archived` node — which passes because `ToolNodeSchema` does not currently use `.strict()` the same way, but any attempt to add the same pattern to agent or gate nodes fails validation. The recommended fix in `2026-04-19T1200` (generic `default_*` pass-through in schemas) has not been implemented. Meanwhile, every new structured output field (`scope_changed`, `archive_reason_short`, `test_render`) that a pipeline author wants to display in a gate label or seed with a default requires an engine PR just to pass lint — a round-trip that exists only because the schema whitelist never caught up with the runtime.

The `the-agentic-loop-is-a-graph` meditation names the shape of this: the graph's edge conditions and node attributes are the primary authoring surface. When the authoring surface has false floors — things that look like errors but aren't — authors learn to avoid the surface rather than use it correctly.

## Revised Implementation Steps

1. **Replace the four explicit `default*` fields in `AgentNodeSchema` with a generic passthrough.** In `src/attractor/core/schemas.ts`, remove `defaultRefinements`, `defaultChatNotesPath`, `defaultTestResult`, `defaultTestSummary` from `AgentNodeSchema`. Add a `.catchall(z.string())` after `.extend({...})` filtered to keys matching `/^default[A-Z]/`, OR replace `.strict()` with `.passthrough()` scoped only to the `default*` prefix. The simplest correct approach: add `z.record(z.string().regex(/^default[A-Z]/), z.string())` via a Zod `.and()` or use a preprocess step that strips matching keys before strict validation.

2. **Apply the same change to `GateNodeSchema`.** `GateNodeSchema` currently has only `defaultRefinements`. Replace it with the same generic passthrough. Gate labels frequently interpolate optional upstream produces (e.g. `$scope_changed`, `$test_render`) — they need defaults just as much as agent nodes.

3. **Update `extractDefaults` unit coverage.** `variable-expansion.ts` already has the correct generic logic. Add a test asserting `extractDefaults({ defaultScopeChanged: "false" })` returns `{ scope_changed: "false" }` and `extractDefaults({ defaultArchiveReasonShort: "Declined" })` returns `{ archive_reason_short: "Declined" }`. These were never tested because the schema rejection discouraged authors from writing the attributes.

4. **Update the pipeline spec and `formatAllowedAttrs` output.** `describeKind()` in `schemas.ts` drives the hint text shown on schema errors. After removing the explicit fields, the hint text won't list individual `default*` entries. Add a static note to the `formatAllowedAttrs` output for `agent` and `gate` kinds: "Any attribute named `default_<varname>` seeds `$varname` when no upstream node has produced it."

5. **Regression-test the four previously-whitelisted fields.** Confirm that `defaultRefinements`, `defaultChatNotesPath`, `defaultTestResult`, `defaultTestSummary` are still accepted after the refactor (the generic rule covers them). Run `pipeline validate` against `illumination-to-implementation.dot` and all smoke pipelines — zero new errors expected.
