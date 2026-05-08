---
date: 2026-05-09
run_id: 5c59f36d
plan: docs/superpowers/plans/2026-05-08-static-multi-node-agent-filename-mismatch.md
design: docs/superpowers/specs/2026-05-08-static-multi-node-agent-filename-mismatch-design.md
illumination: .apparat/meditations/illuminations/2026-05-08T2301-static-multi-node-agent-filename-mismatch.md
test_result: pass
---

# static-multi-node agent filename mismatch

## What was implemented
Bundled `static-multi-node` scenario was unrunnable (DOT ids `node_a/b/c` vs sibling files `node-a/b/c.md`). Renamed siblings to underscored slugs, deleted 15 structural `pipeline-smoke-*-folder.test.ts` files, and replaced them with a runtime scenario-discovery + execution phase inside the `tmux-tester` node of `illumination-to-implementation`.

## Key files
- M `.apparat/pipelines/illumination-to-implementation/tmux-tester.md` — Phase 2 now globs `.apparat/scenarios/*/pipeline.dot` and drives `apparat pipeline run` per scenario; agent impersonates human via `send_input`.
- R `.apparat/scenarios/static-multi-node/{node-a,node-b,node-c}.md` → `{node_a,node_b,node_c}.md` (loadAgent joins literally — bug was a slug, not a contract gap).
- R `.apparat/scenarios/tmux-tester/` → `.apparat/scenarios/meditate-observer/` (reconciliation: only reachable agent in that folder's pipeline.dot is `meditate-observer`; duplicate `tmux-tester.md` removed as dead code).
- D 15 × `src/cli/tests/pipeline-smoke-*-folder.test.ts` (structural file-existence + validateGraph passed while scenario was unrunnable).

## Decisions and patterns
- **Rename-now over self-heal.** Pre-renamed the static-multi-node siblings rather than relying on the new tmux-tester loop to catch+fix on first run; scenario must be runnable when the new logic lands.
- **Dropped resolver/validator options.** Verifier's option B (resolver hyphen↔underscore normalization) and option C (validator diagnostic for missing sibling) both rejected — live runtime execution is the only safety net; preflight diagnostics and resolver tolerance kept off the table to avoid disturbing the `graph-validator-byte-identical` snapshot.
- **Agent plays human for all interactive scenarios.** No skiplist, no interactive/non-interactive split. Plausible defaults: `Proceed` for gates (first non-Decline), `/end` for chat (canonical terminator per `src/cli/lib/slash-commands.ts:19`).
- **Self-skip rule** on folder basename `tmux-tester` or presence of `tmux-tester.md` — defensive against recursion if a future scenario re-introduces a tmux-tester variant.
- **Convention pin deferred.** Hyphen vs underscore in `CONTEXT.md` / `pipelines.md` left for a future pass; design-writer surfaced a recommendation at `review_gate` but no edit landed this session.

## Gotchas and constraints
- DOT identifier syntax forbids bare hyphens in unquoted node ids; `agent-loader.ts:29-39` joins the agent attribute literally onto `<folder>/<agent>.md`. Authors copying a starter who use hyphenated DOT-quoted ids will silently desync siblings — the new live test catches it on first run rather than at file-existence check time.
- `bundled-pipelines-self-sufficient.test.ts` is the **bundled-tier** live-run suite (under `src/cli/pipelines/`) and is intentionally untouched. The deleted 15 covered the **scenarios** tier; their replacement is the runtime scan inside the `tmux-tester` node, not another `*.test.ts` file.
- `missing-caller-var` scenario's PASS condition is `exit ≠ 0` (designed-failure). Phase 2 prose currently treats `exit ≠ 0` as fail — tmux-tester noted this as a candidate refinement (`goal=` line says "fails fast at startup when --var omitted"). Future work may need a goal-aware PASS/FAIL classifier or a scenario rename.
- `chat-only` / `chat-end-to-end` exit signal is the literal `/end` slash-command, not a free-text affirmative. The `Plausible defaults` list in the design doc still says "one-line affirmative continuation" — should be updated to `/end` when convention pin lands.

## Final verification
- test_result: pass
- test_summary: Cycle 1 clean: build OK, vitest 1331/1331 passed, tsc clean. All 14 discovered scenarios passed live execution in tmux (static-multi-node node_a→node_b→node_c reached success — confirms the rename fix; gate answered with Proceed; chat-only and chat-end-to-end ended via /end; meditate-observer ran 268s and emitted four-field summary). 0 fixes needed.
