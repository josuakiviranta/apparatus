---
date: 2026-05-01
description: pipeline validate flags tool-node stdout outputs (record_base.sha) as required caller --var inputs because produces_from_stdout keys are invisible to static analysis.
---

## Findings

### 1. `checkRequiredCallerVars` reports `record_base.sha` as a required caller var, but it is produced by a tool node at runtime

**What:** Running `pipeline validate` on `src/cli/pipelines/implement/pipeline.dot` prints `record_base.sha` inside the `[required_caller_vars]` banner alongside legitimate caller vars (`llm_model`, `max_iterations`, `scenarios_dir`). `record_base.sha` is not a caller variable — it is the `sha` field of the JSON that the `record_base` tool node prints to stdout (`{"sha":"<git-sha>"}`), captured because the node sets `produces_from_stdout="true"`. A user reading the validator literally would either pass a bogus `--var record_base.sha=xxx` (immediately overwritten by the tool node) or stop trusting the validator.

**Evidence:**
- `src/cli/pipelines/implement/pipeline.dot:7-10` — tool node declaration:
  ```
  record_base [type="tool",
               cwd="$project",
               tool_command="printf '{\"sha\":\"%s\"}\n' \"$(git rev-parse HEAD)\"",
               produces_from_stdout="true"]
  ```
- `src/cli/pipelines/implement/scenario-author.md:14-16` — agent declares `- record_base.sha` in `inputs:`.
- Verbatim validator output from current main:
  ```
  [required_caller_vars] This pipeline requires the following --var keys at runtime:
  llm_model, max_iterations, record_base.sha, scenarios_dir
  ```

**Why it matters:** The `[required_caller_vars]` banner is the canonical "what does the caller owe this pipeline?" surface (web/spider lens — the web's external attachment points). When it lies, operators learn to either pass irrelevant flags or distrust the validator wholesale. It also makes tool nodes second-class citizens of the static-analysis story: agent `outputs:` schemas are legible, but `produces_from_stdout` keys are opaque, so any consumer of those keys looks unwired.

**Suggested action:** Decide between explicit-schema and blanket-exemption fixes; explicit-schema is preferred because it doubles as runtime stdout validation:
1. Add a `produces=` attribute to tool nodes (`produces="sha"` or `produces="sha,branch"`) mirroring agent `outputs:`.
2. Populate `nodeProduces.get("record_base")` from that attribute in the static builder feeding `checkRequiredCallerVars`.
3. At runtime, validate the actual stdout JSON shape against the declared schema (catches the same drift class as the agent-side `outputs[scenario_paths]: unsupported fragment shape "string[]"` warning).
4. Fallback weaker fix if explicit schema is rejected: special-case `produces_from_stdout="true"` in `checkRequiredCallerVars` to skip required-caller checks for `<thatNode>.<anyKey>` references.
5. Add regression test `src/attractor/tests/graph-required-caller-vars.test.ts`: a `produces_from_stdout` tool node feeding an agent that consumes `<tool>.<key>` must NOT list `<tool>.<key>` in required caller vars.

### 2. Root cause sits in the per-input loop of `checkRequiredCallerVars`

**What:** The classification error happens because `nodeProduces` is built only from static schemas (`produces:` attribute, agent `outputs:`, gate handler choices). Tool nodes using `produces_from_stdout` declare their output keys nowhere statically, so `nodeProduces.get("record_base")` is empty (or missing `sha`). When the per-input loop resolves `record_base.sha` via `isProduced`, the lookup returns false and the key falls through into `required`.

**Evidence:**
- `src/attractor/core/graph.ts:737-796` — `checkRequiredCallerVars` definition and the per-input loop that adds unresolved `<node>.<key>` references to `required`.
- `src/attractor/core/graph.ts:776-784` — the loop that classifies each agent-declared input.
- `src/attractor/core/graph.ts:753-761` — `isProduced` resolution for the `<node>.<key>` form, which does `nodeProduces.get(node)?.has(key)` and returns false when the entry is missing.

**Why it matters:** The blind spot is structural, not cosmetic. Until `nodeProduces` learns about tool-node outputs, every `produces_from_stdout` consumer in any future pipeline will inherit the same false-positive. The bug is contained to one classifier today but propagates by construction.

**Suggested action:** Fix at the `nodeProduces` builder (the single source of truth for "what does this node yield?") rather than patching `checkRequiredCallerVars` alone, so future validators (graph linters, schema-drift checks) inherit the corrected map.

## Reading thread

- [2026-05-01T0820-pipeline-spec-drift-poisons-agents.md](./2026-05-01T0820-pipeline-spec-drift-poisons-agents.md) — same theme: spec/runtime drift between what is declared and what is produced.
- [2026-05-01T0120-janitor-graph-validator-bloat.md](./2026-05-01T0120-janitor-graph-validator-bloat.md) — adjacent validator territory; same module under audit.
