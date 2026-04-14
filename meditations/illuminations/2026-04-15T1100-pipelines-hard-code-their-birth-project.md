---
date: 2026-04-14
status: open
description: The pipeline authoring prompt teaches DOT grammar but never teaches variable-first design — so every pipeline embeds the paths, agent names, and directory conventions of the project where it was born, making it unrunnable in any other project without manual surgery.
---

## Core Idea

ralph's T-series has identified the distribution problem (T2300, T0700), the manifest problem (T0300), the engine-sealing problem (T0200), and the authoring-context problem (T0000, T0100). But none of these fixes help if the pipelines themselves are not written portably. `illumination-to-plan.dot` — ralph's own production pipeline — hard-codes `meditations/illuminations/*.md`, `docs/superpowers/specs/`, `docs/superpowers/plans/`, and `agent="implement"`. These are ralph-cli's paths. Any other project that opts into this pipeline via T0700's preset mechanism will run it against the wrong directories. The pipeline cannot be reused without forking it. The authoring prompt (`PROMPT_pipeline_create.md`) teaches every node type, every attribute, every edge condition — but contains no guidance on parameterization as a portability discipline. It shows `$variable` syntax in one example but never states the rule: **every path, every agent name, every directory reference that differs between projects must be a variable, not a string literal.**

## Why It Matters

Read `PROMPT_pipeline_create.md`. The annotated reference example uses `agent="reviewer"` — a hardcoded name. The prompt section says `agent="name" — routes execution to a named agent from the agent registry`. No mention of: what happens when the consumer project calls that agent `"code-review"` instead of `"reviewer"`? The pipeline silently routes to the wrong agent or fails at runtime. T0800 (preflight variable check) only catches undefined `$variable` references. It cannot catch hardcoded names that don't match the local registry. The mismatch is invisible until runtime.

Look at the smoke pipeline `agent-implement.dot`: `agent="implement"` — ralph's own agent name. The smoke pipelines are testing ralph-cli internals, so this is appropriate. But they are also the only pipeline exemplars a first-time user or authoring agent can observe. When T0100's pattern gallery is built and T2300's bundled pipelines land, those pipelines will be written by someone working inside ralph-cli — where `agent="implement"` is correct. Distributed to a consumer project where that agent doesn't exist, every bundled pipeline will fail on the `agent=` attribute.

The gene transfusion lens makes the structural cost legible: the first transfusion is the expensive one, but only if it produces a reusable exemplar. A hardcoded exemplar is not an exemplar — it's a one-project artifact. The T-series builds rails to distribute pipelines across projects. Rails that carry non-portable cargo are rails to nowhere.

The fix is not infrastructure. It's discipline — and discipline lives in the authoring prompt.

## Revised Implementation Steps

1. **Add a Portability section to `PROMPT_pipeline_create.md`** immediately after the node attributes reference. State the rule explicitly: "Every path, agent name, and directory reference that is project-specific must be a `$variable`, not a string literal. A pipeline that hard-codes `agent=\"reviewer\"` cannot run in a project that registers the agent as `\"code-review\"`. Use `agent=\"$review_agent\"` instead and document that variable in the pipeline's `inputs` attribute." Two sentences. This is the rule no current documentation states.

2. **Add an `inputs` attribute to every bundled and smoke pipeline's `digraph` declaration.** The syntax (proposed in T0000) is `inputs="var1, var2, var3"`. For `illumination-to-plan.dot`, this would declare `inputs="run_id"`. For any future bundled pipeline using agent names, declare those names as inputs too: `inputs="review_agent, specs_dir, scenarios_dir"`. The `inputs` declaration forces the author to enumerate what the consumer project must provide — it is the portability contract made explicit.

3. **Audit and rewrite the bundled pipeline set before T2300 distribution ships.** Before `getBundledPipelinesDir()` makes ralph's own pipelines runnable from consumer projects, each pipeline must be reviewed for hardcoded values. For every hardcoded path or agent name found: replace with a `$variable`, add to `inputs=`, and document the expected value in a comment. This is a one-time migration — cheaper now than after distribution is live and consumer projects are reporting broken bundled pipelines.

4. **Update `pipelineValidateCommand`** to warn when a node attribute contains a string that matches a known project path pattern (`specs/`, `src/`, `docs/`, `tests/`, `pipelines/`) or matches a name from the local agent registry. These are signals that the author has hardcoded something project-specific. The warning message: `"Node 'X' attribute 'agent' appears to be hardcoded. Consider using $variable for portability."` This is heuristic, not exhaustive, but it catches the most common mistake at validate time rather than at distribution time.

5. **Add a "Portable by default" variant to T0100's Pattern Gallery.** Each named pattern (Observe-then-Fix, Test Gate, Agent Chain, etc.) should have its agent names and paths expressed as variables in the canonical form. When the authoring agent presents the gallery and the user picks a pattern, the generated DOT starts with parameterized stubs, not hardcoded names. The first pipeline a user ever writes through `pipeline create` teaches variable-first design as the baseline, not as an advanced technique.
