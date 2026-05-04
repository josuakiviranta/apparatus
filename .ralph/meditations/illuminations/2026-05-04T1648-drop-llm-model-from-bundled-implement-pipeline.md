---
date: 2026-05-04
description: Bundled implement pipeline still declares llm_model as a caller input even though it is CLI-injected and read by no agent — same noise pattern just paid down for max_iterations and record_base.sha.
---

## Core Idea

`src/cli/pipelines/implement/pipeline.dot:3` still declares `llm_model` in `inputs="llm_model,scenarios_dir"` after the 2026-05-04 fix landed. `llm_model` is the same shape of noise as `max_iterations` was: always injected by `ralph implement` from `--model` at `src/cli/commands/implement.ts:35`, and no agent body reads it (agents resolve their model from per-node `llm_model=` or the stylesheet inside `src/attractor/handlers/agent-handler.ts:65`, not from the runtime variable bag). The validator banner therefore continues to list one entry that the operator can never meaningfully supply.

The just-shipped design (`docs/superpowers/specs/2026-05-04-validator-misclassifies-tool-node-outputs-as-caller-vars-design.md` §1, §2.5) explicitly defers this; the chat-summarizer refinement notes flag it as "dead caller-context for a follow-up illumination." This is that follow-up.

## Why It Matters

The `[required_caller_vars]` info banner is the canonical operator surface for "what `--var` keys must I pass at runtime?" Each lying entry costs trust on the same axis: operators either pass an irrelevant `--var llm_model=...` (instantly overwritten by the CLI's auto-injection) or stop reading the banner. Leaving one of three known-noise entries in place reproduces the exact failure the spider/web mental model was meant to prevent — the web's external attachment points must be the actual external attachment points.

The previous fix proved the pattern is cheap: zero engine code, three additive `.dot` edits, one regression test. Carrying the same edit through for `llm_model` is even smaller — there is no per-node consumer to gate, because no agent reads it at all.

Concrete evidence in this repo:

- `src/cli/commands/implement.ts:35` injects `llm_model` unconditionally from `options.model` (or the default).
- `src/attractor/handlers/agent-handler.ts:65` resolves the model from node attribute / stylesheet, not from `$llm_model`.
- Grep for `\$llm_model` across `src/cli/pipelines/implement/` returns zero matches (no agent prompt or node attribute consumes it).
- `pipeline validate src/cli/pipelines/implement/pipeline.dot` after the 2026-05-04 fix still prints `llm_model, scenarios_dir`. Target after this follow-up: `scenarios_dir` only.

## Revised Implementation Steps

1. Confirm with one grep pass that no node attribute or agent prompt under `src/cli/pipelines/implement/` references `$llm_model` or declares `llm_model` as a per-node input. If a reference is found, escalate scope — this illumination assumes none.
2. Edit `src/cli/pipelines/implement/pipeline.dot` line 3: change `inputs="llm_model,scenarios_dir"` to `inputs="scenarios_dir"`.
3. Decide handling of the unconditional `--var llm_model=...` injection at `src/cli/commands/implement.ts:35`. Two options, pick during implementation:
   - **a.** Leave the injection alone. The runtime variable bag will carry an unread `llm_model`; the validator stops listing it because the digraph no longer declares it as an input. Smaller diff, matches how the project handles other dead-but-injected scaffolding.
   - **b.** Drop the injection too. Smaller runtime surface, but adds a code-path edit to the design and risks regressing project-local pipelines that legitimately declare `inputs="llm_model"`. Confirm `src/cli/lib/pipeline-resolver.ts` and `ralph pipeline run` paths first.
4. Verify against the existing regression test in `src/attractor/tests/graph-required-caller-vars.test.ts`. The test covers `produces=` exemption and `default_<key>=` silencing on a fixture pipeline; it does not need to grow for this change because dropping a digraph input is the simplest path the validator already exercises. If a guard against re-introduction is wanted, add a one-line snapshot assertion against the bundled implement pipeline's banner.
5. Run `npm run build && npm test` plus a manual `node dist/cli/index.js pipeline validate src/cli/pipelines/implement/pipeline.dot`. Expected banner: `[required_caller_vars] scenarios_dir`.
6. Doc ripple: update any spec or README excerpt that quotes the `inputs="..."` line of the bundled pipeline (the 2026-05-04 design doc itself is sealed history; do not retroactively edit). ADR-0003's `record_base` worked example is unaffected.

## Provenance

- Source memory: `.ralph/sessions/2026-05-04-validator-misclassifies-tool-node-outputs-as-caller-vars.md`
- Pipeline run id: `74ca63f7-2f5b-414a-aa85-4a17f01d03e0`
- Surfaced by: memory-reflector
