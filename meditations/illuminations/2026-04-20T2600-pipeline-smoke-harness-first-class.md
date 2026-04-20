---
date: 2026-04-20
status: open
description: pipelines/smoke/ already exists but is undocumented as a first-class convention; every non-trivial pipeline should ship with a smoke test running it end-to-end with mock agents, and that expectation needs to be encoded in authoring commands, scaffolding, and validation lint-lane warnings — otherwise runtime-only bugs (agent output schema drift, conditional branch dead ends) continue to escape static validation.
---

## Core Idea

`pipelines/smoke/` already has 14 `.dot` files (`chat-only.dot`, `agent-implement.dot`, `gate.dot`, `conditional.dot`, `meditate-steer.dot`, `store.dot`, `static-multi-node.dot`, `json-schema-stream.dot`, `agent-json-vars.dot`, `tool-runtime-vars.dot`, `tmux-tester.dot`, `tool.dot`, `missing-caller-var.dot`, `chat-end-to-end.dot`) — but the convention is invisible: no spec, no lint rule, no scaffolding hook, no per-branch mock pattern.

Meanwhile the five "real" pipelines under `pipelines/*.dot` (`gate-test.dot`, `structured-output-test.dot`, `poc-implement.dot`, `illumination-to-plan.dot`, `illumination-to-implementation.dot`) have near-zero direct smoke coverage. Only `poc-implement.dot` plausibly maps to `smoke/agent-implement.dot`; the other four — including the two flagship production pipelines that `ralph implement` and `ralph meditate` lean on — ship with no end-to-end smoke harness at all. Coverage ratio: **~1/5 production pipelines** have a corresponding smoke test. That is the gap.

Smoke tests catch three classes of bug that static validation structurally cannot:

1. **Agent output schema drift.** An agent rubric promises `produces="scope_changed"` but the rubric's natural-language instructions permit skipping the field under some condition. The zod schemas in `src/attractor/core/schemas.ts` cannot read English; a smoke run with a mock whose output omits the field fires the downstream gate's `$scope_changed` interpolation as undefined.
2. **Conditional edge dead ends.** `remove_gate --Archive-->` vs `approval_gate --Decline-->` routing bugs only fire when a mock chooses a specific branch. The gate-choice-namespacing work (v0.1.26) added static checks on label shape, but it does not exercise a run down each branch.
3. **Tool-node script regressions.** A `script_file="scripts/mark-archived.mjs"` that throws on a valid input passes schema validation but fails smoke on the first archival run — exactly the class of bug the mark-archived shipping missed.

See `2026-04-15T0900-consumer-pipelines-have-no-test-harness.md` for the consumer-project-scope counterpart. This illumination is the ralph-cli-internal cousin: even *inside* this repo the smoke harness is implicit, under-documented, and not required for new pipelines.

## Why It Matters

Path-sensitive static validation (see `2026-04-20T1900-path-sensitive-var-flow-validator.md`) is the **static defense**; smoke tests with per-branch mocks are the **runtime defense**. Neither is sufficient alone. Static analysis cannot read natural-language agent rubrics and cannot model author intent around optional produces; runtime testing cannot enumerate pathological author mistakes cheaply. Together they form the real quality gate for the pipeline substrate that `ralph implement`, `ralph meditate`, and every consumer project now depend on.

Without this pairing, every regression in a production pipeline ships silently until a user runs it. The current state — 1/5 coverage, no convention documentation, no CI enforcement — means the smoke harness is running on institutional memory, not on engineering.

## Revised Implementation Steps

1. **Spec the smoke pattern.** Add `specs/pipeline-smoke-tests.md`:
   - Smoke pipelines live in `pipelines/smoke/<name>.smoke.dot`.
   - Mock agent outputs live alongside at `pipelines/smoke/<name>/<agent-node-id>.mock.json` (or a single `<name>.mock.json` for linear pipelines).
   - A `--mock <dir>` flag on `ralph pipeline run` short-circuits agent dispatch and returns canned structured outputs; tool nodes still execute (pure functions of their inputs).

2. **Extend `ralph pipeline run` with `--mock <dir>`.** In the runner (likely `src/attractor/core/run.ts` or equivalent), intercept agent-node dispatch: if `--mock` is set and `<dir>/<node-id>.json` exists, resolve with that payload instead of calling the agent. Tool nodes, gates, store nodes, and conditional edges execute normally.

3. **Coverage lint rule.** In the lint lane proposed by `2026-04-20T2400-split-validate-and-lint-lanes.md`, add a warning: `pipeline <name>.dot has no corresponding smoke test at pipelines/smoke/<name>.smoke.dot`. Warning, not error — matches the severity of other lint-lane guidance and unblocks experimental pipelines.

4. **Scaffold hooks.**
   - `ralph pipeline create <name>` offers to emit a smoke shell at `pipelines/smoke/<name>.smoke.dot` pre-wired to `--mock`.
   - `ralph pipeline scaffold-agent <name>` (see `2026-04-20T2100-agent-scaffold-command.md`) also emits a default `<name>.mock.json` with empty string values for every declared `produces` field — so the three-file-plus-mock pattern is visible from birth.
   - The mock generator can prefill fields by reading the node's declared `produces`/`consumes` (see `2026-04-20T2200-explicit-consumes-declarations.md`), reducing hand-authored fixture size to near-zero for well-declared nodes.

5. **CI integration.** `npm test` iterates every `pipelines/smoke/*.smoke.dot`, runs it with its sibling mock directory, and asserts zero `[syntax]`/`[validate]` diagnostics plus a terminal `exit` event in `~/.ralph/runs/<run-id>/`. Existing smoke tests stay green as the regression net.

6. **Per-branch smoke.** For pipelines with multiple conditional paths (e.g. a verifier routing Archive vs Dispatch), encode one mock per branch: `pipelines/smoke/<name>/archive.mock.json`, `dispatch.mock.json`. The smoke runner iterates all mocks and asserts each reaches `exit`. This is where conditional-edge dead ends get caught — static validation cannot reach this level of path enumeration, but authored mocks can.
