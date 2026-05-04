# Chat round notes — 2026-05-04T00:00Z

## What the user raised
- Banner over-lists inputs: "only one thing in given example, these should be not required: llm_model, max_iterations." User flagged the explainer's post-fix `[required_caller_vars]` example still showing `llm_model` and `max_iterations` next to `scenarios_dir`, even though those two are CLI-supplied conveniences, not operator-typed inputs.
- `.ralph/pipelines` interaction: "Also study how this change would work with .ralph/pipelines." User wants confirmation the fix behaves sensibly for project-local pipelines, not just the bundled `implement`.
- Simplicity preference: "What is the simplest mechanism? I would just drop max_iterations and llm_model if those won't break anything." User explicitly chose dropping over adding new digraph-level optional-input syntax.
- Scope narrowing: "Let's just drop the max_iterations for now." User pulled `llm_model` out of this illumination's scope after I surfaced that it is currently dead caller-context (no `$llm_model` reference, no consumer).

## Conclusions reached
- The fix scope is two changes, both inside the original illumination's surface:
  1. Add `produces="sha"` to the `record_base` tool node in `src/cli/pipelines/implement/pipeline.dot` and teach `nodeProduces` to read it (the verifier's primary proposal — unchanged).
  2. Additionally, drop `max_iterations` from the digraph-level `inputs="..."` and add `default_max_iterations="0"` to the `implementer` node so `$max_iterations` at `pipeline.dot:12` still resolves cleanly under the validator at `src/attractor/core/graph.ts:518`.
  - Came from: "What is the simplest mechanism?" + "Let's just drop the max_iterations for now."
  - Rationale: `max_iterations` is always supplied by the CLI (`src/cli/commands/implement.ts:34`, `options.max ?? 0`) and never typed by the operator, so listing it in the operator-facing `[required_caller_vars]` banner is noise. `default_<key>` on the consumer node is the existing mechanism the validator already silences for at `graph.ts:285` — no new syntax needed.
- Post-fix banner for `pipeline validate` on `src/cli/pipelines/implement/pipeline.dot` is expected to read exactly:
  ```
  [required_caller_vars] This pipeline requires the following --var keys at runtime:
  llm_model, scenarios_dir
  ```
  (Three items collapses to two — `record_base.sha` removed via `produces=`, `max_iterations` removed via `default_*`. `llm_model` stays for now.)
  - Came from: user's "these should be not required: llm_model, max_iterations" combined with the deferred-scope decision.
  - Rationale: Drop only what the user signed off on; keep the explainer's "After" example honest by reflecting actual planned output.
- `llm_model` cleanup is **deferred** out of this illumination.
  - Came from: "Let's just drop the max_iterations for now."
  - Rationale: I surfaced that `llm_model` is dead — declared in `inputs=`, injected by `--model` flag at `src/cli/commands/implement.ts:35`, but never read by any agent (agents read `node.llmModel` from per-node attr or stylesheet at `src/attractor/handlers/agent-handler.ts:65`, never from caller context). User opted to keep this illumination tight rather than fold in a separate dead-code/feature-wiring decision. A follow-up illumination should triage whether to (b) drop the CLI plumbing or (c) wire it through.
- `.ralph/pipelines` interaction is non-breaking and requires no extra work.
  - Came from: user's "study how this change would work with .ralph/pipelines."
  - Rationale: Project-local pipelines under `<project>/.ralph/pipelines/<name>/pipeline.dot` are resolved at `src/cli/lib/pipeline-resolver.ts` and run via `ralph pipeline run`, which performs no auto-injection of `max_iterations` or `llm_model` (that is hardcoded only in `ralph implement` at `implement.ts:34-35`). So:
    - A project-local pipeline that declares `inputs="max_iterations"` legitimately requires the operator to pass `--var max_iterations=N`, and the banner correctly lists it. Static analysis stays authoritative.
    - The `produces=` attribute we add to tool nodes (Change 1) is purely additive and applies uniformly to bundled and project-local pipelines.
    - The `default_max_iterations="0"` we add (Change 2) is local to the bundled `implement/pipeline.dot` and does not propagate.
  - Conclusion: no special-casing, no extra ripple, no breaking change for `.ralph/pipelines/`.

## Open questions (if any)
- `llm_model` ultimate fate — drop, wire, or keep dead? Deferred to a separate illumination because the user explicitly narrowed this round's scope.
