---
date: 2026-05-06
run_id: d1b60972
plan: /Users/josu/Documents/projects/apparatus/docs/superpowers/plans/2026-05-06-pipeline-show-couples-to-agent-frontmatter.md
design: /Users/josu/Documents/projects/apparatus/docs/superpowers/specs/2026-05-06-pipeline-show-couples-to-agent-frontmatter-design.md
illumination: .apparat/meditations/illuminations/2026-05-06T1427-pipeline-show-couples-to-agent-frontmatter.md
test_result: pass
---

# pipeline-show-couples-to-agent-frontmatter

## What was implemented

Concentrated agent metadata projection inside `agent-loader.ts`: added an `AgentMetadata` type plus `extractAgentMetadata()`, and widened `loadAgent` to return `AgentConfig & { metadata: AgentMetadata }`. `annotate-show.ts` now consumes `metadata` directly and dropped its local `AgentMeta` interface, so a future agent-frontmatter shape shift surfaces as a loud loader-level error instead of silently emptying `apparat pipeline show` labels.

## Key files

- M `src/cli/lib/agent-loader.ts` — added `AgentMetadata` + `extractAgentMetadata()`, widened `loadAgent` return
- M `src/cli/lib/agent.ts` — type-source updates for the metadata projection
- M `src/cli/lib/annotate-show.ts` — drop local `AgentMeta`, consume `metadata` directly; narrow try/catch to true load failures
- A `src/cli/tests/agent-metadata-extraction.test.ts` — isolated unit tests for metadata extraction
- A `docs/superpowers/specs/2026-05-06-pipeline-show-couples-to-agent-frontmatter-design.md`
- A `docs/superpowers/plans/2026-05-06-pipeline-show-couples-to-agent-frontmatter.md`

Single squashed feature commit: `47d28b4 feat(agent-loader): concentrate metadata projection via AgentMetadata`.

## Decisions and patterns

- **Additive return type.** `loadAgent` now returns `AgentConfig & { metadata: AgentMetadata }` — pipeline-engine consumers (`graph-validator.ts`, `agent-prep.ts`, handlers) keep working off the `AgentConfig` superset. No barrel re-export, no breaking change.
- **Narrow the silent catch.** The previous `} catch { /* skip silently */ }` in `annotate-show.ts:69-71` could swallow `Object.keys(undefined)` from a frontmatter rename. After the migration, the catch only swallows true load failures; metadata-shape mismatches now throw at the loader.
- **Scope held to annotate-show coupling.** Out-of-scope: refactoring `graph-validator.ts` (~30 `.inputs`/`.outputs` accesses), `agent-prep.ts`, `interactive-agent-handler.ts`, `looping-agent-handler.ts`. Production diff stayed at 3 files + 1 new test.

## Gotchas and constraints

- `description` is never read by the annotator — illumination's example list overstated this. Future readers shouldn't add `description` to `AgentMetadata` without a real consumer.
- The metadata extraction is the **only** place that should know the agent frontmatter field names going forward. New consumers must go through `loadAgent(...).metadata`, not reach into `cfg.inputs` / `cfg.outputs` directly.
- ADR-0001 (agent loading single tier) and ADR-0009 (parser/validator split) frame this change — extending the same direction. Future agent-shape work should keep the loader as the single authority.

## Final verification

- test_result: pass
- test_summary: Cycle 1 clean: build + 1306/1306 tests passed; live-drove `apparat pipeline show` on 7 scenarios (static-multi-node, agent-json-vars, agent-implement, chat-only, conditional, gate, json-schema-stream) — all exit 0 with expected node/edge counts; live-drove `apparat pipeline run` on `tool` (exit 0) and `missing-caller-var` (expected exit 1 with clear error). Diff hot path (annotate-show.ts via `pipeline show`) verified across multiple agent metadata shapes. No fixes needed.
