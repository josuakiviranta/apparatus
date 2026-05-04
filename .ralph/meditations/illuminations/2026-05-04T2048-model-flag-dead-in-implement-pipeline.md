---
date: 2026-05-04
description: The `--model` flag on `ralph implement` is dead code — CLI injects `llm_model` into the variable bag but no node in the bundled implement pipeline reads it; agent-handler resolves model from the per-node DOT attribute, never the bag.
---

## Core Idea

`ralph implement --model <name>` silently does nothing. The CLI at `src/cli/commands/implement.ts:33-36` injects `llm_model` into the variable bag whenever `--model` is passed, but the bundled `src/cli/pipelines/implement/pipeline.dot` `implementer` node (line ~13) carries no `llm_model="$llm_model"` attribute, and `src/attractor/handlers/agent-handler.ts:65` resolves the model exclusively from `node.llmModel` (the parsed DOT attribute), never from the variable bag. The flag is documented in README and CLI help, but it does not influence model selection.

## Why It Matters

This is a public-contract lie. Operators who pass `--model claude-opus-4-7` reasonably expect the implement loop to use that model; instead it falls through to the agent's default. Two concrete risks:

1. **Trust erosion.** Same failure mode the just-shipped `inputs=` cleanup (commit `8d9c12c`, run `da562cfc`) was meant to repair: the system advertises a control surface that doesn't actually control anything. The `inputs=` fix removed `llm_model` from the validator banner; this leaves the CLI flag dangling in the opposite direction — flag exists, plumbing missing.
2. **Cost / latency surprises.** Users running long implement loops who pick a cheaper or faster model via `--model` will not get it. Bills and wall-clock will reflect the default, not the requested model.

The current illumination's chat-summarizer notes flagged this explicitly: "the `--model` CLI flag at `src/cli/commands/implement.ts:35` is dead code in the `implement` pipeline today." It was deliberately scoped out of the `inputs=` fix; this is the follow-up.

## Revised Implementation Steps

Two viable directions — pick one, do not combine.

**Option A — wire the flag (preferred if `--model` should remain a feature):**

1. Add `llm_model="$llm_model"` to the `implementer` node in `src/cli/pipelines/implement/pipeline.dot` (around line 13). Confirm the DOT parser surfaces it as `node.llmModel` — check `src/attractor/handlers/agent-handler.ts:65` resolution path.
2. Restore `llm_model` to `inputs=` on `pipeline.dot:3` (now `inputs="scenarios_dir"`) so the validator banner truthfully advertises the key. This reverses part of commit `8d9c12c` — call it out in the design doc.
3. Decide whether `llm_model` should be required or optional. If optional, use `default_llm_model="…"` on the node so operators who omit `--model` still pass the validator. Mirror whatever default `agent-handler.ts` falls back to today.
4. Drop the snapshot guard in `src/attractor/tests/graph-required-caller-vars.test.ts` that pins `llm_model` *out* of the banner — it becomes a tripwire pointing the wrong way.
5. Add an integration-style test that runs `ralph implement --model <fake>` and asserts the variable bag value reaches `agent-handler` (mock the SDK call, assert on the resolved model arg).

**Option B — remove the flag (preferred if model selection should be pipeline-internal only):**

1. Delete the `--model` option from `src/cli/commands/implement.ts` (the `option('--model …')` line and the conditional bag injection at lines 33-36).
2. Remove `--model` from README + `ralph implement --help` copy. Grep for `--model` and `llm_model` across `docs/` and `src/cli/` to find stragglers.
3. Add a one-line note to the migration / breaking-change log if one exists, since this is a public-flag removal.

**Decision aid for the verifier / human gate:** check `git log -- src/cli/commands/implement.ts` for the original intent behind `--model`. If the flag was added in anticipation of multi-model implement loops that never landed, B is honest. If it was added with working plumbing that later regressed (e.g. during the per-folder pipeline refactor in 2026-04-27), A is restoration.

## Provenance

- Source memory: `.ralph/sessions/2026-05-04-drop-llm-model-from-bundled-implement-pipeline.md`
- Pipeline run id: `da562cfc-267b-4e14-93fd-798029a31106`
- Surfaced by: memory-reflector
