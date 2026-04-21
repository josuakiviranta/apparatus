---
date: 2026-04-21
status: open
description: buildPreamble dumps ALL ctx.values into every agent's system prompt regardless of what $var references appear in prompt=, making the apparent prompt= contract systematically incomplete and T0300's bookend fix simpler than it looks — but also turning long renders like explainer_render into unbounded preamble noise for every downstream agent.
---

## Core Idea

`buildPreamble` (`src/attractor/transforms/preamble.ts:12-21`) iterates every key in `ctx.values` and emits it verbatim into the agent's system prompt prefix — for every agent node whose `fidelity` is not `"full"` (the default is `"compact"`). This means every context variable produced by any upstream node is automatically visible to all downstream agents, whether or not the `prompt=` attribute references it. Pipeline authors who read only `prompt=` are reading half the contract.

## Why It Matters

**T0300 is simpler than its 5-step plan suggests.** Once `capture_pre_sha` and `compute_changed_surfaces` tool nodes inject `pre_sha`, `changed_files`, and `touched_surfaces` into pipeline context, the `tmux_tester` agent receives all three in its preamble automatically. The rubric's "read `$changed_files` from received context" instruction is already correct — it will find the variable under "Key context values:" in the preamble. No `prompt=` update to the `tmux_tester` node in `illumination-to-implementation.dot` is needed. T0300 steps 1–3 (the two scripts + `.dot` edit) are the only remaining work.

**The inverse problem is real and growing.** The preamble does not filter. By the time `tmux_tester` runs in `illumination-to-implementation.dot`, the context contains `explainer_render` (a multi-paragraph markdown render), `plan_path`, `design_doc_path`, `tool.output` (last script stdout), `agent.success`, `agent.iterations`, `illumination_path`, `summary`, `explanation`, and `refinements` — none of which `tmux_tester` uses. Every agent late in the pipeline processes this accumulated noise before reaching the signal. The longer and more complex the pipeline, the worse this becomes.

**The naming is inverted from intuition.** `fidelity="full"` returns an empty preamble (the prompt is self-contained); `fidelity="compact"` returns the full context dump. A pipeline author reading the schema descriptor "Fidelity tier hint for model selection" has no way to discover this behavior without reading `preamble.ts`.

## Revised Implementation Steps

1. **Complete T0300 now — only steps 1–3 remain.** Write `pipelines/scripts/capture-pre-sha.mjs` and `pipelines/scripts/compute-changed-surfaces.mjs`, then edit `illumination-to-implementation.dot` to insert the two bookend tool nodes around `implement`. Do not modify the `tmux_tester` node's `prompt=` attribute — the preamble already delivers the injected vars.

2. **Document the dual-channel delivery in `specs/pipeline.md`.** Add a section explaining that agents receive context through two channels: (a) explicit `$var` expansion in the `prompt=` string, and (b) the preamble header that dumps all `ctx.values`. Clarify when each channel is appropriate and what `fidelity=full` does (suppresses the preamble, not adds more context).

3. **Rename `fidelity` values to reflect their actual semantics.** `fidelity="compact"` should be `fidelity="with-context"` (preamble included) and `fidelity="full"` should be `fidelity="self-contained"` (no preamble). Or accept the current names but document them clearly — the current "full" name actively misleads.

4. **Add a `context_filter` attribute (optional, deferrable).** Allow agent nodes to specify a comma-separated list of context keys they care about — e.g. `context_filter="changed_files, touched_surfaces, plan_path"` — so the preamble emits only those keys. This is a YAGNI item for now, but the hook in `buildPreamble` is a one-line change when needed.

5. **Audit long-render keys for preamble impact.** `explainer_render`, `test_render`, and `memory_path` all accumulate multi-paragraph text in `ctx.values`. For nodes that don't use these downstream, consider whether the producing agent should write the render to a file and emit a path instead of inlining the content — keeping `ctx.values` key/short and the preamble scannable.
