# Validator / Runtime Defaults Parity — Design

**Date:** 2026-04-20
**Status:** Draft
**Source illumination:** `meditations/illuminations/2026-04-20T1800-validator-and-runtime-disagree-on-defaults.md`

## Context

The runtime already treats `default_<varname>` as a generic mechanism for seeding context keys on any node. `extractDefaults()` in `src/attractor/transforms/variable-expansion.ts:86-98` walks every attribute, matches `/^default[A-Z]/`, strips the prefix, and lowercases / snake-cases the remainder. Whatever key comes out is written to context iff nothing upstream has produced it.

The validator does not agree:

- `AgentNodeSchema` (`src/attractor/core/schemas.ts:12-33`) is `.strict()` and lists exactly four `default*` keys: `defaultRefinements`, `defaultChatNotesPath`, `defaultTestResult`, `defaultTestSummary`.
- `GateNodeSchema` (`src/attractor/core/schemas.ts:51-55`) is `.strict()` and lists one: `defaultRefinements`.
- `ToolNodeSchema` (`src/attractor/core/schemas.ts:43`) is also `.strict()` with refines layered on top and lists **no** `default*` fields at all. A tool-node attribute like `default_archive_reason_short` is therefore rejected by the validator today, even though runtime happily seeds `$archive_reason_short`. The illumination's claim that tool nodes "pass" due to a weaker strict mode is incorrect; the gap exists on all three kinds and the fix covers all three. The bug surfaces hardest on agent + gate because those are where `illumination-to-implementation.dot` exercises it, but tool is fixed in the same change to avoid building a second-class path.
- `src/attractor/tests/schemas.test.ts:270-285` pins this floor: `defaultArchiveReasonShort` on an agent node is asserted to produce `unrecognized key 'default_archive_reason_short'`.

Net effect: `pipeline validate` rejects attributes the engine happily resolves. The gap is hit today by `pipelines/illumination-to-implementation.dot`, which carries `default_refinements` on agent and gate nodes and `default_archive_reason_short` on a tool node. Every new structured-output field authors add (`scope_changed`, `archive_reason_short`, `test_render`, …) forces an engine PR solely to quiet lint.

This is the exact false-floor flagged by illumination `2026-04-19T1200` (which introduced the fenced-code-block skip to keep runtime/validator in agreement on a different axis). Same shape of bug, different axis.

## Goal

The validator recognises any attribute matching `/^default_[a-z][a-z0-9_]*$/` on `agent`, `gate`, and `tool` nodes as a valid default-seed declaration. Unknown non-`default_` keys keep failing as they do today. One rule replaces the whitelist.

Runtime behaviour does not change — `extractDefaults()` is already generic.

## Non-goals

- No new engine capability. `extractDefaults()` stays untouched.
- No semantic validation of the seeded key (we do not check that `default_archive_reason_short` corresponds to a real downstream consumer). That is a separate producer/consumer lint, tracked elsewhere.
- No value-type validation beyond "string". DOT attribute values are strings at the parser layer; coerced types happen node-side.
- No `.dot` migration — the spec is purely additive for all existing pipelines.
- No change to how `ToolNodeSchema` validates its non-default fields. The tool node gets the same generic `default_*` acceptance, nothing more.

## Design

### Mechanism: validator-side filtering, not schema-shape expansion

Two realistic zod strategies exist:

1. **Replace `.strict()` with `.passthrough()` + `.superRefine`** that rejects non-`default_` extraneous keys. Keeps the rule inside zod. Con: every call site that introspects the schema shape (including `describeKind`/`formatAllowedAttrs`) still only sees the declared fields, so the generic rule has to be described separately in hint text anyway.

2. **Keep `.strict()`, filter `unrecognized_keys` diagnostics in `validateNode`.** When zod emits an `unrecognized_keys` issue on an agent/gate/tool node, drop any key matching `/^default[A-Z]/` from the diagnostic set before surfacing. Remove the four explicit `default*` fields from the schemas.

We choose **(2)**. Rationale:

- `validateNode` already post-processes zod issues into `Diagnostic[]` (`schemas.ts:145-172`). One extra filter step fits the shape of that function.
- Schemas stay declarative and documented — `defaultRefinements` etc. vanish from the shape because they are no longer special.
- `describeKind()`/`formatAllowedAttrs` output gets an explicit trailing note rather than a stale whitelist.
- Zero risk of a non-string value accidentally type-checking: DOT attrs are always strings at the parse layer, and the filter drops the diagnostic without consulting the value.

### Changes to `src/attractor/core/schemas.ts`

1. Remove `defaultRefinements`, `defaultChatNotesPath`, `defaultTestResult`, `defaultTestSummary` from `AgentNodeSchema` (`:29-32`).
2. Remove `defaultRefinements` from `GateNodeSchema` (`:54`).
3. Add constant `DEFAULT_SEED_KEY_RE = /^default[A-Z]/` (camelCase form, since zod issues report camelCase keys).
4. Add helper `isDefaultSeedKey(camelKey: string): boolean` used by both the filter and tests.
5. Extend `validateNode` (`:145-172`): inside the `unrecognized_keys` branch, for kinds `"agent" | "gate" | "tool"`, filter the zod-reported `keys` array (which is camelCase — see `schemas.ts:148`, read *before* the `camelToSnake` conversion at `:150`) to exclude names matching `DEFAULT_SEED_KEY_RE` before emitting diagnostics. If every extraneous key was a default-seed, emit no diagnostic for that issue.
6. Extend `formatAllowedAttrs` (`:120-129`): append a trailing block for `agent | gate | tool`:
   > `Default seeds (any name): default_<varname>  — seeds $varname when no upstream node has produced it.`
7. No change to `describeKind`'s implementation. Its output shrinks naturally on agent + gate because the schema shape no longer declares the four whitelisted fields; `formatAllowedAttrs` picks up the shrinkage plus the appended seed-rule line from step 6.

### Changes to `src/attractor/transforms/variable-expansion.ts`

None. `extractDefaults()` at `:86-98` is the source of truth and already generic.

### Changes to tests

- `src/attractor/tests/schemas.test.ts`:
  - Invert `:270-285` — `defaultArchiveReasonShort` on an agent node is now **accepted** (zero diagnostics).
  - Add `default_anything_goes` on a gate node → accepted.
  - Add `default_new_field` on a tool node → accepted.
  - Regression cases: `default_refinements`, `default_chat_notes_path`, `default_test_result`, `default_test_summary` on agent nodes → still accepted (no behaviour change for existing pipelines).
  - Negative cases: `bogus_key` on agent, gate, tool → still rejected with `unrecognized key 'bogus_key'`.
  - Edge case: `defaulted` (single-word, no camel-hump after `default`) on agent → rejected. The regex requires an uppercase after `default`, so `defaulted` is not a seed.
- `src/attractor/tests/variable-expansion.test.ts` (or the existing suite that covers `extractDefaults`):
  - `{ defaultScopeChanged: 'false' }` → `{ scope_changed: 'false' }`.
  - `{ defaultArchiveReasonShort: 'Declined at approval gate' }` → `{ archive_reason_short: 'Declined at approval gate' }`.
  - `{ default: 'x' }` → no extraction (no varname after prefix). (Pins the regex boundary.)
  - `{ defaulted: 'x' }` → no extraction (the runtime regex requires `key[7] === key[7].toUpperCase()`, i.e. the character after `default` must be uppercase). Aligns with the validator edge case above.
- `pipelines/illumination-to-implementation.dot` (smoke): no change. After the fix, `pipeline validate pipelines/illumination-to-implementation.dot` emits zero new errors and stops flagging `default_refinements` on agent + gate nodes.
- Wider smoke: run `pipeline validate` against every file under `pipelines/` that ships with the repo. Expect no regressions.

### Documentation

- `docs/superpowers/specs/2026-04-08-attractor-pipeline-engine-design.md` (the canonical attractor engine spec — currently documents only Graph-level defaults like `default_max_retries` / `default_fidelity`; gains a node-level section covering per-node `default_<varname>` seeds). Grep confirms this is the only spec/docs file that talks about `default_*` attributes in attractor semantics. Paragraph text:

  > Any attribute on an `agent`, `gate`, or `tool` node whose snake_case name begins with `default_` is treated as a context seed. When the run reaches the node, if no upstream producer has written `$<name>` into context, the default value is inserted. The attribute is otherwise uninterpreted by the engine.

- `describeKind()` hint (via step 6 above) surfaces the same rule in `pipeline validate --explain` and the default error-hint output.

### Observability

No new logs, metrics, or engine-state changes.

## Acceptance criteria

1. `pipeline validate pipelines/illumination-to-implementation.dot` returns zero errors for every `default_*` attribute. Confirmed by running the smoke suite.
2. An agent node with `default_archive_reason_short="…"` validates cleanly and, at runtime, seeds `$archive_reason_short` when no upstream producer exists.
3. An agent node with `bogus_key="x"` still fails validation with `unrecognized key 'bogus_key'`.
4. A gate node with `default_custom_note="…"` validates cleanly (previously required `defaultRefinements` or nothing).
5. A tool node with `default_foo="bar"` validates cleanly.
6. The four previously-whitelisted agent fields (`default_refinements`, `default_chat_notes_path`, `default_test_result`, `default_test_summary`) continue to validate cleanly. No pipeline break.
7. `pipeline validate --explain` (or the error hint path) prints a line documenting the `default_<varname>` seed rule for `agent`, `gate`, and `tool` kinds.
8. `formatAllowedAttrs("agent")`, `formatAllowedAttrs("gate")`, and `formatAllowedAttrs("tool")` no longer list the four removed `default*` keys as first-class entries, and include the trailing seed-rule line.
9. `extractDefaults({ defaultScopeChanged: 'false' })` returns `{ scope_changed: 'false' }` under direct unit test.
10. `extractDefaults({ defaulted: 'x' })` returns `{}` — no seed extracted, validator-side behaviour matches.
11. A shared fixture table (`[['defaultRefinements', true], ['defaultScopeChanged', true], ['defaulted', false], ['default', false], ['defaultX', true], ['defualtTypo', false]]`) is exercised by two tests — one that feeds each row through `isDefaultSeedKey` (validator side) and one that feeds each row through a minimal `extractDefaults` harness (runtime side). Both must agree row-by-row. Failure on either side surfaces the runtime/validator drift risk before it ships.

## Risks & trade-offs

- **Diagnostic-level filtering hides real typos.** If an author writes `defualt_something` (typo), zod still flags it as unrecognized — good. If they write `defaultXOptional` intending an actual field name (`xOptional` with a default prefix), the validator now accepts it silently, and runtime will seed `$x_optional` that nothing consumes. Mitigation: unreferenced seeds already emit a soft producer/consumer lint in a later pipeline-validator pass (out of scope here). Documentation clarifies that the seed is uninterpreted.
- **`ToolNodeSchema` refines layered on top.** The two `.refine()` calls at `:44-49` run after the strict key check. Since the filter happens in `validateNode` (post-zod), the refine-level diagnostics for `script_command_conflict` and `tool_node_needs_command_or_script` are unaffected. Verified by existing tool-node tests.
- **Backwards compatibility with older `.dot` files.** Every pipeline that declares `default_refinements` today continues to validate. Every pipeline that previously needed an engine PR to add a new whitelist entry no longer does. Net positive.
- **`describeKind()` output is load-bearing for `pipeline validate --explain`.** Dropping the four explicit fields changes the enumerated shape shown to authors. The trailing seed-rule line compensates; behavior change surfaces in CLI output but not in any machine-parsed schema consumer.
- **Runtime/validator drift in the opposite direction.** If a future engine change narrows `extractDefaults()` (e.g., requires uppercase camelCase after `default` for some new reason), the validator filter will silently accept keys the engine drops. Mitigation: the helper `isDefaultSeedKey` and the runtime regex must stay in lockstep — add a shared test that exercises both with the same fixture table.
- **Schema doc drift.** `describeKind()` currently lists default fields in the order declared. Removing them reorders documentation output by one position. No tooling relies on the ordering; low risk.

## Files touched

| File | Change |
|---|---|
| `src/attractor/core/schemas.ts` | Remove four `default*` fields from `AgentNodeSchema`; remove `defaultRefinements` from `GateNodeSchema`; add `DEFAULT_SEED_KEY_RE` + `isDefaultSeedKey`; filter `unrecognized_keys` for agent/gate/tool; append seed-rule line in `formatAllowedAttrs` |
| `src/attractor/tests/schemas.test.ts` | Invert rejection assertion; add generic `default_*` acceptance tests on agent / gate / tool; regression tests for the four previously-whitelisted fields; negative test for `defaulted` |
| `src/attractor/tests/variable-expansion.test.ts` | New cases for `default_scope_changed`, `default_archive_reason_short`, `default` (bare), `defaulted` |
| `pipelines/illumination-to-implementation.dot` | No change; smoke-validated |
| `src/attractor/tests/default-seed-parity.test.ts` (new) | Shared fixture table run against both `isDefaultSeedKey` and a minimal `extractDefaults` harness; pins runtime/validator parity |
| `docs/superpowers/specs/2026-04-08-attractor-pipeline-engine-design.md` | New paragraph documenting per-node `default_<varname>` seed contract |

## Out of scope

- Producer/consumer lint that warns when a `default_<varname>` seeds a key no downstream node reads (future pipeline-validator pass).
- Type annotations for seed values beyond `string`.
- Migration of existing explicit-whitelist usages in already-shipped pipelines (they already use `default_refinements` etc. and continue to work).
- Any change to `extractDefaults()` runtime semantics.
