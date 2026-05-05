# Triage Chat Notes

**Illumination:** `meditations/illuminations/2026-04-15T1100-pipelines-hard-code-their-birth-project.md`
**Run ID:** d8432fbe-c9ed-4383-8aa6-bff3e5d21de6
**Verdict:** Approved for design. All 5 original claims verified against main. Scope expanded to 6 items during triage.

---

## Confirmed problem

Ralph's pipeline authoring prompt (`src/cli/prompts/PROMPT_pipeline_create.md`) teaches DOT grammar but not variable-first design. Result: bundled pipelines (`pipelines/illumination-to-plan.dot`, `pipelines/smoke/agent-implement.dot`) hardcode ralph-cli's own folder conventions (`meditations/illuminations/`, `docs/superpowers/specs/`, `docs/superpowers/plans/`) and agent names (`agent="implement"`). LLM authors pattern-match the reference examples in the prompt, which themselves use literal `agent="reviewer"` — bad pattern propagates.

Adjacent spec `docs/superpowers/specs/2026-04-16-preflight-variable-check-design.md` catches `$undefined_variable` references (variables used but not defined). This illumination addresses the complementary gap: literals that should have been variables. Still open.

---

## Scope (6 items)

### 1. Portability section in `PROMPT_pipeline_create.md` — AGENT-facing
Teach variable-first design explicitly. Examples: receive inputs via context, never embed project-specific paths, never hardcode agent names available only in one project.

### 2. Digraph-level `inputs=` attribute — BOTH (agent emits, engine enforces, human reads as contract)
Pipelines declare required context keys. Decision: **hard fail** at pipeline load when a declared input is missing from context. Warning-only = ignored = dead feature. Contract must bite.

### 3. Audit bundled pipelines — HUMAN maintainer
Scrub ralph-specific literals out of every file in `pipelines/` (not only the two named in the illumination). Bundled pipelines double as the teaching gallery; a half-audit ships half-bad examples. Do this after #2 lands so `inputs=` can be added during the sweep.

### 4. Extend `pipelineValidateCommand` with portability heuristics — BOTH
Warn on hardcoded project-specific strings. Decision: **static rule list** in v1 (no plugin system — YAGNI). Initial rules:
- Substring match: `meditations/`, `docs/superpowers/`
- Cross-check: any `agent="name"` whose name is not in the local agent registry
- Emit as warnings (non-fatal) at `ralph pipeline validate` time

### 5. Parameterize pattern gallery examples — AGENT-facing
Rewrite the reference example in `PROMPT_pipeline_create.md` (lines 82-116) to use `$variables` instead of literals. Copy-paste target should reproduce correct habit, not wrong one.

### 6. NEW — Decouple shape/agent tables from prompt — BOTH
Added during triage. The prompt currently hand-curates:
- Shape → node-type table (lines 28-42)
- Per-handler attribute docs (lines 44-59)
- Validation rules list (lines 68-78)

Every new handler/node-kind/agent added to the engine requires a manual prompt edit. Guaranteed drift. Already stale: prompt lists `component`, `tripleoctagon`, `house` as grammar-only, pruned by hand if/when wired up.

**Decision:** Runtime injection. At `ralph pipeline create` launch, CLI reads handler registry + agent registry and composes the shape/attribute/agent tables dynamically, concatenating onto a static "portability + authoring principles" base prompt. Single source of truth = the engine registries. Zero drift.

Alternatives rejected:
- Build-time generation (tsup step) — works but couples docs pipeline to build
- Keep hand-curated (status quo) — guarantees drift on every engine PR

---

## Audience split

| Item | Consumer | Fix type |
|------|----------|----------|
| 1 Portability section | Agent | Prompt edit |
| 5 Parameterized examples | Agent | Prompt edit |
| 6 Runtime-injected tables | Agent (via launch-time composition) | CLI plumbing + prompt split |
| 2 `inputs=` contract | Both | Engine (graph loader + handler) |
| 4 Validator heuristics | Both | Engine (`pipelineValidateCommand`) |
| 3 Bundled pipeline audit | Human maintainer | Content sweep |

---

## Priority order for design doc / implementation plan

1. **#1 + #5** — pure prompt edits, highest leverage, zero engine risk. Fixes the teaching source.
2. **#6** — runtime injection of shape/agent tables. Structural fix that stops future drift. Do before #2 so new `inputs=` keyword can be auto-documented the same way.
3. **#2** — `inputs=` attribute with hard-fail enforcement. Requires grammar extension, handler changes, validation.
4. **#4** — portability heuristics in `pipelineValidateCommand`. Static rule list. Builds on #2 (warns about the same class of smells `inputs=` formalizes).
5. **#3** — audit all `pipelines/*.dot`. Last so the sweep can add `inputs=` declarations and pass the new validator.

---

## Resolved decisions (no open questions downstream)

- **`inputs=` enforcement:** hard fail on missing input at pipeline load (not warning).
- **Heuristic rule shape:** static rule list in v1. Substrings `meditations/`, `docs/superpowers/` + agent-registry cross-check. No plugin system.
- **Audit scope:** every `.dot` under `pipelines/`, not just the two named in the illumination.
- **Decoupling approach:** runtime injection from engine registries, not build-time generation.

---

## Out of scope

- Rebuilding the handler/agent registries themselves — use current API.
- Backwards compatibility shims for old pipelines missing `inputs=` — ship a one-time audit (item #3) instead.
- Plugin/extension mechanism for validator rules — revisit only when a second consumer exists.
- Parallel-execution shapes (`component`, `tripleoctagon`, `house`) — still not implemented; unrelated.
