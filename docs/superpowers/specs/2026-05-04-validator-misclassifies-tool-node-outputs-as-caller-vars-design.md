# Design: Stop Listing Tool-Node Outputs and CLI-Injected Vars in `[required_caller_vars]`

**Date:** 2026-05-04
**Status:** draft (pending review)
**Originating illumination:** `.ralph/meditations/illuminations/2026-05-01T1424-validator-misclassifies-tool-node-outputs-as-caller-vars.md`

## 1. Motivation

`pipeline validate` exists so authors learn what a pipeline owes its caller before spending agent budget. The `[required_caller_vars]` info banner is the canonical operator surface for that question — "what `--var` keys must I pass at runtime?" Today, on the bundled `implement` pipeline, the banner lies in two distinct ways:

```
[required_caller_vars] This pipeline requires the following --var keys at runtime:
llm_model, max_iterations, record_base.sha, scenarios_dir
```

Two of those four entries are not caller-supplied:

1. `record_base.sha` is the `sha` field of the JSON the `record_base` tool node prints to stdout at runtime. The node already declares `produces_from_stdout="true"`, so the value materializes during the run and is consumed downstream by `scenario_author`. It cannot be supplied by `--var`; an attempted override would be overwritten the moment `record_base` finishes.
2. `max_iterations` is hardcoded into the launch path: `ralph implement` always passes `--var max_iterations=<n>` from `--max` (or `0`) at `src/cli/commands/implement.ts:34`. The operator never types this variable.

The cost is exactly the cost the broader validator-hardening thread has been paying down: when the banner lists noise, authors either pass irrelevant flags (instantly overwritten) or stop trusting the validator wholesale. The illumination cited the spider/web mental model — the web's external attachment points must be the actual external attachment points, not internal joints. This change brings the bundled pipeline into compliance with that contract.

`llm_model` is also misclassified (always injected from `--model` at `src/cli/commands/implement.ts:35`, never read by any agent body), but the chat refinement log explicitly defers `llm_model` to a separate illumination; this design retains it.

## 2. Decision summary

Single-file source change, scoped to the bundled implement pipeline. No engine code changes, no schema changes, no agent contract changes.

1. **Add `produces="sha"` to the `record_base` tool node** at `src/cli/pipelines/implement/pipeline.dot:7-10`. `ToolNodeSchema` already permits this attribute (`src/attractor/core/schemas.ts:44`: `produces: z.string().optional()`); the static `nodeProduces` builder at `src/attractor/core/graph.ts:194-198` already reads it. Net effect: `record_base.sha` is registered in `nodeProduces.get("record_base")`, so `isProduced("record_base.sha")` at `src/attractor/core/graph.ts:773-781` returns `true`, and the consumer-input loop at `src/attractor/core/graph.ts:796-803` stops adding it to `required`.

2. **Drop `max_iterations` from the digraph-level `inputs="..."`** at `src/cli/pipelines/implement/pipeline.dot:3`. After this edit, line 3 reads `inputs="llm_model,scenarios_dir"`.

3. **Add `default_max_iterations="0"` to the `implementer` agent node** at `src/cli/pipelines/implement/pipeline.dot:12`. The `default_*` silencing path at `src/attractor/core/graph.ts:801-802` (`const fallbackKey = toCamel("default_" + resolved.localKey); if (node[fallbackKey] !== undefined) continue;`) already excludes any consumer input covered by a `default_<localKey>=` attribute on the consumer node. Existing test coverage at `src/attractor/tests/illumination-pipeline-flow.test.ts:33` confirms the silencing behavior.

4. **Add one regression test** in the pre-existing file `src/attractor/tests/graph-required-caller-vars.test.ts` covering two cases on a single fixture pipeline:
   - A tool node with `produces_from_stdout="true"` AND `produces="sha"` feeding an agent that declares input `<tool>.sha` — the banner must NOT list `<tool>.sha`.
   - A digraph-level input declared but silenced by `default_<key>=` on the consumer agent node — the banner must NOT list that key.

5. **Defer `llm_model` cleanup** out of scope. Documented as an open follow-up; not edited in this design.

Out of scope (locked by upstream):

- `src/attractor/core/graph.ts` — verify-only. `nodeProduces` already reads `produces=` from tool nodes; no edit required. If verification surfaces a gap, the response is to elevate scope, not silently expand this design.
- Runtime stdout JSON shape validation (does `record_base` actually emit `{"sha": "..."}`?) — out. The illumination cited it as a future direction; this design only fixes static classification.
- `.ralph/pipelines` (project-local pipelines) — verified non-breaking. Auto-injection of `max_iterations` / `llm_model` lives only in `src/cli/commands/implement.ts:34-35`. `ralph pipeline run` (`src/cli/commands/pipeline.ts`) and the resolver (`src/cli/lib/pipeline-resolver.ts`) pass `--var` through unchanged. The `default_max_iterations="0"` attribute is local to the bundled pipeline node and does not propagate. Project-local pipelines that legitimately declare `inputs="max_iterations"` continue to require operator `--var`. Out.
- Agent `outputs:` schema changes; new validator rules; CLI flag changes. Out.

## 3. Architecture

### 3.1 Current shape (`src/cli/pipelines/implement/pipeline.dot`)

```dot
digraph implement {
  goal="Autonomous implementation loop"
  inputs="max_iterations,llm_model,scenarios_dir"

  start [shape=Mdiamond]

  record_base [type="tool",
               cwd="$project",
               tool_command="printf '{\"sha\":\"%s\"}\n' \"$(git rev-parse HEAD)\"",
               produces_from_stdout="true"]

  implementer [agent="implement", max_iterations="$max_iterations"]
  ...
}
```

`scenario_author` declares `record_base.sha` as a qualified input at `src/cli/pipelines/implement/scenario-author.md:14-16`. The banner lists `record_base.sha` because `nodeProduces.get("record_base")` is empty — `produces_from_stdout` keys are runtime-only and invisible to static analysis.

### 3.2 Target shape

```dot
digraph implement {
  goal="Autonomous implementation loop"
  inputs="llm_model,scenarios_dir"

  start [shape=Mdiamond]

  record_base [type="tool",
               cwd="$project",
               tool_command="printf '{\"sha\":\"%s\"}\n' \"$(git rev-parse HEAD)\"",
               produces_from_stdout="true",
               produces="sha"]

  implementer [agent="implement",
               max_iterations="$max_iterations",
               default_max_iterations="0"]
  ...
}
```

Three additive edits, all confined to one file. The `produces=` attribute pairs with the existing `produces_from_stdout="true"` — runtime keeps consuming stdout JSON, validator gains a static record of the keys that JSON should contain. `default_max_iterations="0"` engages an established silencing mechanism without adding new syntax.

### 3.3 Validator behavior pre/post

`pipeline validate src/cli/pipelines/implement/pipeline.dot`

**Before:**
```
[required_caller_vars] This pipeline requires the following --var keys at runtime:
llm_model, max_iterations, record_base.sha, scenarios_dir
```

**After:**
```
[required_caller_vars] This pipeline requires the following --var keys at runtime:
llm_model, scenarios_dir
```

Two items, both genuinely caller-supplied. `llm_model` retained pending its own follow-up illumination; the explainer's earlier "two items" framing matches this exactly.

## 4. Components & file edits

| File | Change |
|---|---|
| `src/cli/pipelines/implement/pipeline.dot` | (a) Drop `max_iterations` from line 3 `inputs=`. (b) Append `produces="sha"` to the `record_base` attribute block (lines 7-10). (c) Append `default_max_iterations="0"` to the `implementer` attribute block (line 12). |
| `src/attractor/tests/graph-required-caller-vars.test.ts` | Add one new `it(...)` case asserting that a tool node with `produces_from_stdout="true"` AND `produces="sha"` does NOT cause `<tool>.sha` to appear in the `required_caller_vars` info banner, and that a digraph-level input silenced by a consumer `default_<key>=` does NOT appear either. |

No other source file is touched. `src/attractor/core/graph.ts` is verify-only — confirm `nodeProduces` already reads tool-node `produces=` (it does, at lines 194-198), confirm `default_*` silencing already runs (it does, at lines 801-802), and confirm no extra branch is needed.

## 5. Data flow

The validator's diagnostic pipeline is unchanged in structure. The `nodeProduces` builder at `src/attractor/core/graph.ts:178-213` already merges these sources, in order:

1. Handler-type implicit productions (`tool` → `tool.output`, `store` → `store.path`, `wait.human` → `chat.output, choice`) — `src/attractor/core/graph.ts:184-186`.
2. Per-node gate `<id>.choice` for `wait.human` nodes — `src/attractor/core/graph.ts:188-190`.
3. Interactive nodes' implicit `chat.output` — `src/attractor/core/graph.ts:192`.
4. Explicit `produces=` attribute, comma-split — `src/attractor/core/graph.ts:194-198`. **This is the path the new `produces="sha"` activates.**
5. Agent-file `outputs:` block when `dotDir` is available — `src/attractor/core/graph.ts:200-211`.

After step 4 runs for `record_base`, `nodeProduces.get("record_base")` contains `tool.output` (from step 1) plus `sha` (from the new step-4 entry). `scenario_author`'s declared input `record_base.sha` resolves through `isProduced` (`src/attractor/core/graph.ts:773-781`) — the qualified-key branch reads `nodeProduces.get("record_base")?.has("sha")`, which is now `true`. The consumer-input loop at `src/attractor/core/graph.ts:796-803` skips it. Removed from `required`.

For `max_iterations`: dropping it from the digraph-level `inputs=` removes the candidate from the first loop at `src/attractor/core/graph.ts:785-787`. Adding `default_max_iterations="0"` on `implementer` ensures that when the consumer-input loop reaches `implementer`'s declared input `max_iterations`, the `default_*` short-circuit at `src/attractor/core/graph.ts:801-802` triggers and skips it. Removed from `required` via two redundant paths — the digraph-level removal alone would be enough, but the `default_*` addition guards against any future agent-rubric change that re-introduces a `max_iterations` input declaration.

`pipeline run` data flow is byte-identical before and after. `record_base` still prints `{"sha":"..."}`, `produces_from_stdout="true"` still parses it, the runtime context still receives `record_base.sha`. `implementer` still receives `max_iterations` from the CLI's `--var max_iterations=<n>` injection at `src/cli/commands/implement.ts:34`; the `default_max_iterations="0"` only matters when the var is *absent* — i.e., for the validator's static check. No runtime path observes the default in the bundled pipeline, because the CLI always supplies the value.

## 6. Blast radius / impact surface

Sourced from the verifier's `Blast radius:` paragraph and the explainer's `## Blast radius` block.

- **Size:** S
- **Files touched:** 2 — one source pipeline (`src/cli/pipelines/implement/pipeline.dot`), one test (`src/attractor/tests/graph-required-caller-vars.test.ts`). Plus optional doc ripple (see checklist).
- **Surfaces crossed:** validator + bundled pipeline only.
  - **Validator (`pipeline validate`):** banner output for the bundled `implement` pipeline shrinks from four entries to two. No new diagnostic rule, no rule renaming, no new severity. Other pipelines unaffected.
  - **Pipeline engine (run path):** unaffected. `record_base` still prints stdout JSON; `produces_from_stdout="true"` still parses it; downstream agents still consume `record_base.sha`. The `default_max_iterations="0"` is unobserved at runtime because `--var max_iterations` is always present.
  - **Agents:** unaffected. `scenario-author.md` continues to declare `record_base.sha` as a qualified input; `implement.md` continues to consume `max_iterations`. No agent rubric or input/output schema is edited.
  - **CLI:** unaffected. `ralph implement` still injects `max_iterations` and `llm_model` from `src/cli/commands/implement.ts:34-35`. `ralph pipeline validate` and `ralph pipeline run` are not edited.
  - **Schema (`ToolNodeSchema`):** unaffected. `produces` is already optional on tool nodes (`src/attractor/core/schemas.ts:44`).
  - **Project-local pipelines (`.ralph/pipelines/`):** unaffected. Auto-injection of `max_iterations` lives only in `src/cli/commands/implement.ts`; the bundled `default_max_iterations="0"` is local to the bundled `implementer` node and does not propagate to project-local pipelines. Project-local pipelines that genuinely declare `inputs="max_iterations"` continue to require operator `--var`.
  - **Build:** unaffected — no `tsconfig`, `tsup`, or bundling concern.
- **Breaking change:** no.
  - `ToolNodeSchema` already permits `produces=` — no new validation gate is introduced.
  - The `default_*` silencing mechanism is established (`src/attractor/core/graph.ts:801-802`), exercised by `src/attractor/tests/illumination-pipeline-flow.test.ts:33`.
  - The bundled pipeline is the canonical implement pipeline; no third-party copy is on a long-term support contract.
  - Validator output narrows (fewer entries listed). No author who currently relies on the noisy banner is doing something the runtime supports.
- **Spec / docs ripple checklist:**
  - [ ] `docs/adr/0003-attractor-pipeline-runtime.md` (or whichever ADR documents the `record_base` worked example) — verify the worked example still matches the new attribute set; update verbatim only if the ADR quotes the `record_base` block.
  - [ ] `README.md` tool-node attribute table — verify `produces=` is documented as a valid tool-node attribute alongside `produces_from_stdout=`. If absent, add a one-line entry citing the schema.
  - [ ] No CONTEXT.md update — no domain-language change.
- **Test ripple checklist:**
  - [ ] `src/attractor/tests/graph-required-caller-vars.test.ts` — one new `it(...)` case per §4 above.
  - [ ] `src/attractor/tests/illumination-pipeline-flow.test.ts` — verify existing `default_*` silencing case at line 33 still passes against the structural test the new design touches; no edit expected.
  - [ ] No smoke-test pipeline rewrite expected — the bundled implement pipeline is exercised by existing scenario coverage; a single banner-format check is captured by the new unit test.

## 7. Trade-offs

### 7.1 Explicit `produces=` over blanket exemption for `produces_from_stdout` nodes

The illumination's "Suggested action" listed two options: (1) explicit-schema (add `produces=`), (2) blanket-exempt any `produces_from_stdout="true"` node from required-caller checks for `<thatNode>.<anyKey>`.

**Chose (1) because:** explicit-schema is the option the illumination preferred and the chat refinements ratified. Blanket exemption hides typos: a consumer that asks for `record_base.misspelled_key` would silently slip past the validator. Explicit `produces="sha"` keeps validation honest — only the keys the author declares get exempted, and a typo on either side is caught. The cost (one new attribute on one node) is minimal because `ToolNodeSchema` already permits `produces=` and the builder already reads it.

### 7.2 `default_max_iterations="0"` over deletion of the consumer's `max_iterations="$max_iterations"` line

The `implementer` node currently has `max_iterations="$max_iterations"` (line 12) AND, post-fix, `default_max_iterations="0"`. An alternative is to delete `max_iterations="$max_iterations"` entirely and rely solely on the default.

**Chose retention because:** the agent's runtime input *is* `max_iterations`, supplied by the CLI's `--var` injection. Deleting the per-node attribute would force the agent to read the default (`0`) regardless of CLI input — that breaks the contract documented in `src/cli/commands/implement.ts:34` (`max_iterations: String(options.max ?? 0)`), where `--max N` directly drives the loop cap. Keeping the per-node `$max_iterations` reference preserves CLI control; adding `default_*` only changes static-validation behavior.

### 7.3 Defer `llm_model` cleanup

`llm_model` is in the same noise category — always CLI-injected (`src/cli/commands/implement.ts:35`, `--model` flag), never read by any agent body. The agent path reads `node.llmModel` from per-node attributes or stylesheet, not from `$llm_model` in the digraph inputs (`src/attractor/handlers/agent-handler.ts`).

**Deferred because:** the chat log explicitly narrowed scope ("Let's just drop the `max_iterations` for now"). `llm_model` is more entangled — possibly the entire `inputs=` declaration is dead, but that requires a separate decision (drop vs. wire to the per-node attribute path). Keeping that decision in its own illumination prevents this design from carrying two unresolved scope questions.

### 7.4 No engine-side change to `nodeProduces`

The illumination's Finding 2 framed the bug as a builder gap — `nodeProduces` is built from "static schemas" but `produces_from_stdout` is opaque. With explicit `produces=` declarations, the gap closes without engine code: the builder already reads `produces=` (`src/attractor/core/graph.ts:194-198`), so no refactor is needed.

**Accepted because:** the gap is now an authoring discipline, not a builder limitation. Tool-node authors who use `produces_from_stdout` are expected to also declare `produces=` enumerating the keys their stdout JSON will carry. This design migrates the one bundled pipeline that needed it; future pipelines inherit the convention. If repeat offenders show up, a follow-up could add a validator warning ("`produces_from_stdout="true"` without `produces=` may produce false-positive required-caller-vars"), but that's not necessary for shipping this fix.

## 8. Constraints

- The pipeline edit and the test addition land in a single commit so the diff tells one story (illumination → fix).
- `npx tsc --noEmit` must pass after the change. The pipeline edit is pure `.dot` syntax (no TypeScript surface); the test edit follows the existing `it(...)` style in the same file.
- `npx vitest run` must pass with the new test case. Existing cases in `src/attractor/tests/graph-required-caller-vars.test.ts` and `src/attractor/tests/illumination-pipeline-flow.test.ts:33` continue to pass.
- `ralph pipeline validate src/cli/pipelines/implement/pipeline.dot` must produce a `[required_caller_vars]` banner containing exactly `llm_model, scenarios_dir` — two items, alphabetized, no `record_base.sha`, no `max_iterations`.
- `ralph implement` runtime behavior is unchanged: the implement loop still receives `max_iterations` from `--max` (or `0`), `record_base` still prints stdout JSON, `scenario_author` still consumes `record_base.sha`.
- Any deviation in run-path output (success or failure) on existing pipelines indicates an unexpected coupling and must be investigated before merge.

## 9. Open questions

- **`llm_model` follow-up:** is the digraph-level `inputs="llm_model,..."` declaration entirely dead (drop), or does it want to be wired to the per-node `llmModel` attribute (keep + reroute)? Out of scope for this design; flagged as a separate illumination.
- **Validator hint for `produces_from_stdout` without `produces=`:** worth a `pipeline_authoring` info-level diagnostic suggesting that authors who use `produces_from_stdout="true"` should also declare `produces=` to avoid future false positives? Possibly — but not in this design's scope.

No design-level question is open at draft time; the verifier's three rubric criteria pass and the chat refinements lock scope to the four edits in §2.

## 10. Verification approach

### 10.1 Static checks

Run after the change, in order:

- `npx tsc --noEmit` — expected: clean. The pipeline file is `.dot` syntax; the test edit follows the existing pattern in `src/attractor/tests/graph-required-caller-vars.test.ts`.
- Repo-wide grep for `record_base.sha` inside `src/cli/pipelines/implement/pipeline.dot` — expected: zero hits. The pipeline file should reference only `produces="sha"` on `record_base`, not the qualified key.
- Positive-existence grep for `produces="sha"` inside `src/cli/pipelines/implement/pipeline.dot` — expected: exactly one hit, on the `record_base` block.
- Positive-existence grep for `default_max_iterations` inside `src/cli/pipelines/implement/pipeline.dot` — expected: exactly one hit, on the `implementer` block.
- Repo-wide grep for `max_iterations` inside `src/cli/pipelines/implement/pipeline.dot` — expected: exactly two hits (the per-node attribute on `implementer` and the new `default_max_iterations="0"`). The line-3 `inputs=` should no longer contain it.

### 10.2 Tests

- `npx vitest run src/attractor/tests/graph-required-caller-vars.test.ts` — full file passes, including the new case.
- `npx vitest run src/attractor/tests/illumination-pipeline-flow.test.ts` — full file passes; the line-33 `default_*`-silencing assertion still holds.
- `npx vitest run` — entire suite passes. No other test exercises the bundled `implement/pipeline.dot` shape directly.

### 10.3 Smoke

- `ralph pipeline validate src/cli/pipelines/implement/pipeline.dot` — expected output includes `[required_caller_vars] This pipeline requires the following --var keys at runtime: llm_model, scenarios_dir`. No `record_base.sha`. No `max_iterations`.
- `ralph implement <some-project> --max 3 --scenarios scenarios/` (in a tmux session, given the launch guard at `src/cli/commands/implement.ts:23-28`) — runs end-to-end. `record_base` produces stdout JSON; `scenario_author` consumes `record_base.sha`; the implement loop respects `--max 3`. No behavioral regression vs. current main.
- `npm run build` — `tsup` produces the same `dist/` shape as before. The pipeline file is bundled-as-asset; no entry list change.

## 11. Summary

Three additive edits to `src/cli/pipelines/implement/pipeline.dot` plus one new regression test in `src/attractor/tests/graph-required-caller-vars.test.ts`. `produces="sha"` on the `record_base` tool node teaches the validator about the runtime stdout key that downstream agents already consume; dropping `max_iterations` from the digraph-level `inputs=` and adding `default_max_iterations="0"` on `implementer` removes the CLI-injected variable from the operator-facing banner via an existing silencing mechanism. The user-visible win is signal-time honesty: `pipeline validate` on the bundled `implement` pipeline reports `[required_caller_vars] llm_model, scenarios_dir` instead of `llm_model, max_iterations, record_base.sha, scenarios_dir`. No engine code changes, no schema changes, no runtime semantics change, no agent contract changes. `llm_model` cleanup is deferred to a follow-up illumination.
