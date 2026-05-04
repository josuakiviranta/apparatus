---
date: 2026-05-04
run_id: da562cfc-267b-4e14-93fd-798029a31106
plan: docs/superpowers/plans/2026-05-04-drop-llm-model-from-bundled-implement-pipeline.md
design: docs/superpowers/specs/2026-05-04-drop-llm-model-from-bundled-implement-pipeline-design.md
illumination: meditations/illuminations/2026-05-04T1648-drop-llm-model-from-bundled-implement-pipeline.md
test_result: pass
---

# Drop llm_model from bundled implement pipeline

## What was implemented

Removed the dead `llm_model` key from `inputs="llm_model,scenarios_dir"` on
`src/cli/pipelines/implement/pipeline.dot:3`. The validator's
`[required_caller_vars]` banner now lists only `scenarios_dir` — the one
key operators actually supply via `--scenarios`. CLI auto-injection at
`src/cli/commands/implement.ts:35` was deliberately left in place
(option-(a) scope per the design).

## Key files

- `M src/cli/pipelines/implement/pipeline.dot` — `inputs=` shrunk to `scenarios_dir`.
- `M src/attractor/tests/graph-required-caller-vars.test.ts` — snapshot-style guard against re-introducing `llm_model`.
- `A docs/superpowers/specs/2026-05-04-drop-llm-model-from-bundled-implement-pipeline-design.md` — design doc.
- `A docs/superpowers/plans/2026-05-04-drop-llm-model-from-bundled-implement-pipeline.md` — implementation plan.

## Decisions and patterns

- **Option-(a) only.** Variable bag at `src/cli/commands/implement.ts:33-36`
  still injects `llm_model` from `--model`; only the `inputs=` declaration
  changed. The bag carries an unread key — harmless, validator no longer
  advertises it.
- **No retro-edits to sealed history.** Specs, plans, and ADR-0003 that
  quote prior `inputs=` shapes are dated history per the illumination's
  step-6 instruction.
- **Snapshot guard added** despite being marked optional in the design —
  cheap insurance against silent regression.
- **Surfaced separately (not in scope):** `--model` flag is dead in the
  `implement` pipeline today. `pipeline.dot:13` `implementer` carries no
  `llm_model="$llm_model"` attribute and `agent-handler.ts:65` reads only
  `node.llmModel`. Worth a follow-up illumination.

## Gotchas and constraints

- Banner text comes from validator code that reads `inputs=` literally —
  any future re-add of `llm_model` to `inputs=` reintroduces the lie. The
  new test in `graph-required-caller-vars.test.ts` is the tripwire.
- The variable bag and the `inputs=` declaration are independent surfaces.
  Removing a key from `inputs=` does NOT stop the runtime from carrying
  it; that's by design (escape hatch for `default_<key>=` and qualified
  refs). Don't conflate the two when reasoning about future cleanups.

## Final verification

- test_result: pass
- test_summary: Cycle 1 clean: build green, vitest 134 files / 1259 tests all passed, and `pipeline validate src/cli/pipelines/implement/pipeline.dot` shows the new banner `[required_caller_vars] ... scenarios_dir` with no `llm_model` — matching the design's intent. No fixes needed.
