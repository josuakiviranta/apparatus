---
date: 2026-05-06
run_id: 167a0242
plan: docs/superpowers/plans/2026-05-06-meditate-pipeline-not-pipeline-run-callable.md
design: docs/superpowers/specs/2026-05-06-meditate-pipeline-not-pipeline-run-callable-design.md
illumination: .apparat/meditations/illuminations/2026-05-04T2342-meditate-pipeline-not-pipeline-run-callable.md
test_result: pass
---

# meditate pipeline self-sufficient under `pipeline run`

## What was implemented
The bundled `meditate` pipeline now acquires `vision` itself via a `read_vision` tool node (sibling `read-vision.mjs`, copied from janitor) instead of relying on the wrapper command to stuff the variable; `apparat pipeline run meditate --project foo` now works end-to-end with only declared `inputs=`. The bespoke `apparat heartbeat meditate <folder>` subcommand was removed in favor of the generic `apparat heartbeat pipeline meditate` path.

## Key files
- `src/cli/pipelines/meditate/pipeline.dot` — added `read_vision` tool node, `inputs="steer"`.
- `src/cli/pipelines/meditate/read-vision.mjs` — new (byte-for-byte copy from janitor).
- `src/cli/pipelines/meditate/agents/meditate.md` — frontmatter switched to `default_vision=""` + `read_vision.vision` consumption.
- `src/cli/commands/meditate.ts` — shrunk to thin `pipelineRunCommand` shim; `readVisionIfPresent` deleted.
- `src/cli/commands/heartbeat.ts` — `meditate <folder>` subcommand removed.
- `src/cli/tests/{meditate,heartbeat}.test.ts` — updated for new shape.
- `src/cli/tests/bundled-pipelines-self-sufficient.test.ts` — new contract test (7 cases) iterating every bundled pipeline.
- `CONTEXT.md` — glossary deprecation note for removed heartbeat-meditate.

## Decisions and patterns
- **File-copy reuse over shared helper** for `read-vision.mjs`, per ADR-0001. No abstraction yet — two callers is not enough.
- **No compat shim** for the removed `heartbeat meditate` subcommand or `--var vision=...`: single-cohort repo, breaking change documented in commit body.
- **Contract test parameterizes over `src/cli/pipelines/*/pipeline.dot`** so the next bundled pipeline that secretly depends on wrapper-stuffing fails CI on day one.
- **README ripple deferred** from this branch — README has unrelated init/skill-shim WIP that would muddy the diff. Working tree still carries it for the next session to land.

## Gotchas and constraints
- `vision` default is the empty string, not unset. The agent rubric must tolerate empty `<vision>` content; a future strict validator that rejects empty defaults would re-break this path.
- `read_vision.vision` namespacing depends on tool-node `produces_from_stdout=true` semantics; renaming the node breaks the agent's variable reference silently.
- The contract test only checks `validateGraph` + preflight with empty-string inputs. It does not execute pipelines — a node that crashes mid-run is still missed (acceptable: smoke-pipeline tests cover that).

## Final verification
- test_result: pass
- test_summary: Cycle 1 clean: build + 1290/1290 vitest passed (incl. new bundled-pipelines-self-sufficient.test.ts, 7 cases). All 14 scenarios validated; 4 tool-only scenarios driven live in tmux (tool, tool-runtime-vars, store, missing-caller-var) reached exit nodes / produced expected preflight failure. Touched-command exercise confirmed `apparat heartbeat meditate <folder>` subcommand removed and `apparat meditate` shim help text clean. No fixes required.
