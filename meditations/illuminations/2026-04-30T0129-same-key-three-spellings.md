---
date: 2026-04-29
status: open
description: v0.2.0 context-flow redesign collapsed five inline-prompt roles into one "Inputs" channel but produced a three-spelling rule for the same key — `verifier.illumination_path` in frontmatter and gate/tool attributes, `verifier_illumination_path` in agent body and rendered XML tag, never substituted in agent body — and the validator catches none of the cross-form mismatches.
---

## Core Idea

The v0.2.0 context-flow redesign was a real ergonomic win at the pipeline level (`.dot` files dropped ~50 lines of inline prompt) but it pushed ergonomic cost into the agent folder: a single context key now has **three written spellings** that authors must hold in their head at edit time, and the validator does not enforce alignment between them.

| Where it appears | Form | Substituted? |
|---|---|---|
| Agent frontmatter `inputs:` | `verifier.illumination_path` (dotted) | n/a — declarative |
| Gate `.md` body, tool `script_args`, tool `tool_command`, `cwd` | `$verifier.illumination_path` (dotted) | yes, by `expandVariables` |
| Auto-rendered Inputs block XML tag | `<verifier_illumination_path>` (underscored) | engine output |
| Agent `.md` body documentation (`# Procedure`, examples) | `$verifier_illumination_path` (underscored) | **no — pure documentation referencing the tag name** |
| Pipeline `prompt=` on agent nodes | nothing | no — D6: pure prose, never substituted |

Same value, four authored variants depending on file and attribute. Underscores win where the engine renders XML tags. Dots win where the engine substitutes. Agent bodies use the underscored form but the engine never resolves it — the form is purely a literal hint to the LLM that it should look in the corresponding XML tag.

## Why It Matters

Concrete evidence of the trap, all from one folder (`pipelines/illumination-to-implementation/`):

- `verifier.md:21` declares `inputs: [verifier.illumination_path, ...]` (dotted).
- `verifier.md:59` body refers to it as `$verifier_illumination_path` (underscored, never substituted).
- `pipeline.dot:17` tool node uses `script_args="$verifier.illumination_path $verifier.archive_reason_short"` (dotted, substituted).
- `approval_gate.md:16` body uses `Illumination: $verifier.illumination_path` (dotted, substituted by `wait-human.ts:24`).
- `change-explainer.md`, `design-writer.md`, `plan-writer.md`, `chat-refiner.md`, `chat-summarizer.md`, `memory-writer.md`, `memory-reflector.md` — all use the underscored `$verifier_illumination_path` form in their bodies (descriptive only).

The redesign spec (D3 in `docs/superpowers/specs/2026-04-29-pipeline-context-flow-redesign.md`) explicitly chose the underscore swap "because XML doesn't permit dots in tag names." That's a fine engine constraint but it surfaces as an authoring rule that no tool checks. Concretely:

1. **Author renames a producer node.** They rename `verifier` → `triage_verifier`. Pipeline.dot edge labels stay green (validator catches edge target mismatches). Frontmatter `inputs:` updates to `triage_verifier.illumination_path`. **Every agent body still says `$verifier_illumination_path`** — the LLM now reads `<triage_verifier_illumination_path>` from the Inputs block but the procedure narrative still references the old underscored name. No validator rule fires because agent bodies aren't var-scanned for documentation references.

2. **Author adds a new optional input.** They add `inputs: [foo.bar]` and forget to add `default_bar=""` on the consumer node. Validator's `missing_input_producer` rule fires — but only at the per-path layer; if the author hand-runs and `foo.bar` happens to be present, runtime passes. If absent, `renderInputsBlock` (`src/attractor/transforms/inputs-renderer.ts:21`) throws `missing input "foo.bar" — not in ctx.values and no node default "default_bar"`. The error message uses the snake_case fallback name, not the dotted form the author wrote. Three name forms in one error message.

3. **Author tries to interpolate a value into pipeline `prompt=`.** D6 says steering is pure prose. The validator's `steering_has_var_token` rule (per spec) is supposed to catch `prompt="…$foo…"`. But `STRING_ATTRS` in `variable-expansion.ts:111` still includes `"prompt"` for `scanUndeclaredCallerVars`, so an inadvertent `$foo` in steering surfaces as a "missing variable" error rather than the intended D6 error class. Two separate validators fight over the same line.

4. **Drift between spec and implementation.** Spec D9 mandates an `auto_inputs: true` opt-in flag with a cleanup PR to drop it; the cleanup shipped (no agent file declares the flag) but the spec still describes the flag as the migration switch. New authors reading the spec will hunt for a flag that no longer exists.

5. **`pipeline.md` (the user-facing umbrella) under-documents this.** It says agent `prompt=` is pure prose with no `$var` substitution, and that schema descriptions inject above instructions. It does not say agent bodies see XML tags rendered with underscores, that the dotted form lives in gates/tool attrs, or that agent body `$foo_bar` references are documentary not interpolated. The redesign spec carries the table; the umbrella spec doesn't. Authors will land in the umbrella first.

**Vision tie:** the project's vision is "get the user's mental model onto disk so agents stay on the same wavelength." Three spellings of the same name is the inverse of that goal — it forces the author's working memory to hold a translation table the runtime could enforce.

## Revised Implementation Steps

1. **Add a `body_var_consistency` validator rule.** For every agent `.md` body, scan `$<word>` references that look like input references (e.g. `$producer_localkey` matching the underscore-swap pattern), cross-check against the agent's declared `inputs:` (translated through `dot→underscore`). Warn (not error — bodies do contain non-var prose) when a body references `$verifier_illumination_path` and the frontmatter declares no input that renders to `<verifier_illumination_path>`. Catches step 1 above.

2. **Drop `prompt` from `STRING_ATTRS` in `variable-expansion.ts:111`.** Today its inclusion fights with the D6 "steering is prose" contract. Replace with a dedicated `steering_has_var_token` walker that fires the spec's intended error class for any `$` token in agent-node `prompt=` attributes. Eliminates step 3's confused error path.

3. **Document the three-spelling rule in `specs/pipeline.md` under a single "Variable forms" section.** A 6-row table: where each spelling lives, who substitutes it, and who only references it descriptively. Links to the redesign spec for rationale. This is the table the umbrella spec is missing.

4. **Reword `renderInputsBlock`'s missing-input error to use the dotted (frontmatter) form.** Today the message names `default_bar` (snake-case fallback); the author wrote `foo.bar` in frontmatter. Render the message as `missing input "foo.bar" (default_bar attribute also absent on consumer node)` — the form the author actually wrote leads.

5. **Reconcile the redesign spec with the shipped state.** D9 still describes `auto_inputs: true` as a live opt-in flag and a future cleanup PR. Mark `auto_inputs` removed in the spec (with the cleanup-PR sha) and rewrite D9 as historical context, so new authors aren't searching for a dead flag.

6. **Add `pipeline lint --strict-bodies` (or fold into existing lint lane per T2400).** Optional advisory pass: warn on agent body `$x` references that don't resolve to a declared input — most users won't enable it, but the explicit rule prevents the silent rename break in step 1.
