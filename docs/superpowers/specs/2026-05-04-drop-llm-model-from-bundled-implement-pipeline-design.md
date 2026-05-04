# Design: Drop `llm_model` from Bundled `implement` Pipeline `inputs=`

**Date:** 2026-05-04
**Status:** draft (pending review)
**Originating illumination:** `.ralph/meditations/illuminations/2026-05-04T1648-drop-llm-model-from-bundled-implement-pipeline.md`

## 1. Motivation

`pipeline validate` exists so authors learn what a pipeline owes its caller before spending agent budget. The `[required_caller_vars]` info banner is the canonical operator surface for "what `--var` keys must I pass at runtime?" After the just-shipped 2026-05-04 cleanup (`docs/superpowers/specs/2026-05-04-validator-misclassifies-tool-node-outputs-as-caller-vars-design.md`), the bundled `implement` pipeline still lies on one entry:

```
[required_caller_vars] This pipeline requires the following --var keys at runtime:
llm_model, scenarios_dir
```

`llm_model` is not caller-supplied in any meaningful sense:

1. It is auto-injected by `ralph implement` whenever `--model` is passed: `...(options.model ? { llm_model: options.model } : {})` at `src/cli/commands/implement.ts:35`.
2. No node prompt or attribute under `src/cli/pipelines/implement/` reads `$llm_model`. Repo-wide `Grep` for `\$llm_model` scoped to `src/cli/pipelines/implement` returns zero matches.
3. The agent handler resolves the model from the per-node `llmModel` attribute, not from the variable bag: `if (node.llmModel) config = { ...config, model: node.llmModel as string }` at `src/attractor/handlers/agent-handler.ts:65`.

The cost is the cost the broader validator-hardening thread keeps paying down: when the banner lists noise, operators either pass an irrelevant `--var llm_model=...` (instantly overwritten by the auto-injection) or stop trusting the validator wholesale. The illumination cited the spider/web mental model — the web's external attachment points must be the actual external attachment points, not internal joints.

The just-shipped fix paid this same tax for `max_iterations` and `record_base.sha` in commit `e64ae2a` and explicitly deferred `llm_model` to a follow-up illumination. This design *is* that follow-up.

## 2. Decision summary

Single-line edit, scoped to the bundled implement pipeline. No engine code changes, no schema changes, no agent contract changes, no CLI changes.

**The edit (`src/cli/pipelines/implement/pipeline.dot:3`):**

Before:
```
  inputs="llm_model,scenarios_dir"
```

After:
```
  inputs="scenarios_dir"
```

That is the entire change.

Out of scope (locked by upstream refinements):

- **CLI auto-injection at `src/cli/commands/implement.ts:33-36`** — the `...(options.model ? { llm_model: options.model } : {})` line is left untouched. The variable bag will continue to carry an unread `llm_model` whenever `--model` is passed; the digraph just stops advertising it. Removing the injection would force a separate decision about the `--model` flag and is deferred. Surfaced as a separate follow-up: see §9.
- **Retroactive edits to sealed-history docs** — the 2026-05-04 design doc, ADR-0003, and any prior plan that quotes the older `inputs=` shape are dated history. Per illumination step 6, those are not retro-edited.
- **Snapshot-style guard test** — optional, not required. `src/attractor/tests/graph-required-caller-vars.test.ts` already covers the digraph-input → required-caller-var rule generically; a one-line guard against re-introducing `llm_model` on this specific pipeline is a nice-to-have, not a blocker. Plan-writer may decide.

## 3. Architecture

### 3.1 Current shape (`src/cli/pipelines/implement/pipeline.dot:1-13`)

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

  implementer [agent="implement", max_iterations="$max_iterations", default_max_iterations="0"]
```

The `implementer` node carries no `llm_model="$llm_model"` attribute. `agent-handler.ts:65` reads `node.llmModel`, not the variable bag. There is no consumer of `$llm_model` anywhere in the implement pipeline.

### 3.2 Target shape

```dot
digraph implement {
  goal="Autonomous implementation loop"
  inputs="scenarios_dir"

  start [shape=Mdiamond]

  record_base [type="tool",
               cwd="$project",
               tool_command="printf '{\"sha\":\"%s\"}\n' \"$(git rev-parse HEAD)\"",
               produces_from_stdout="true",
               produces="sha"]

  implementer [agent="implement", max_iterations="$max_iterations", default_max_iterations="0"]
```

One token removed from line 3. Everything else byte-identical.

### 3.3 Validator behavior pre/post

`pipeline validate src/cli/pipelines/implement/pipeline.dot`

**Before:**
```
[required_caller_vars] This pipeline requires the following --var keys at runtime:
llm_model, scenarios_dir
```

**After:**
```
[required_caller_vars] This pipeline requires the following --var keys at runtime:
scenarios_dir
```

One item, genuinely caller-supplied (`--scenarios <dir>` → `scenarios_dir` variable, `src/cli/commands/implement.ts:33`).

## 4. Components & file edits

| File | Change |
|---|---|
| `src/cli/pipelines/implement/pipeline.dot` | Edit line 3 `inputs="llm_model,scenarios_dir"` → `inputs="scenarios_dir"`. |

No other source file is touched. No test file edit is required (see §6 test ripple).

## 5. Data flow

The validator's diagnostic pipeline path that matters: the digraph-level `inputs="..."` declaration is read by the graph builder and merged into the candidate set for `[required_caller_vars]`. After the edit, `llm_model` is no longer a candidate, so the consumer-input loop at `src/attractor/core/graph.ts:785-787` no longer enumerates it as a required caller var. The banner shrinks by one entry.

`pipeline run` data flow is byte-identical before and after:

- The variable bag at `src/attractor/core/engine.ts:142` carries injected vars regardless of `inputs=` declaration. `--var` injections (whether from CLI auto-injection or operator override) are preserved.
- `src/cli/commands/implement.ts:35` continues to inject `llm_model` when `--model` is passed. The bag will carry an unread key. No node references `$llm_model`, so this has no observable effect.
- `agent-handler.ts:65` continues to resolve the model from `node.llmModel` (per-node DOT attribute) or from the bundled stylesheet. The variable bag is not in the model-resolution path.

The only observable behavior change is validator output: one fewer entry in the operator-facing banner.

## 6. Blast radius / impact surface

Sourced from the verifier's `Blast radius:` paragraph and the explainer's `## Blast radius` block.

- **Size:** S
- **Files touched:** 1 — `src/cli/pipelines/implement/pipeline.dot` only.
- **Surfaces crossed:** bundled pipeline only.
  - **Validator (`pipeline validate`):** banner output for the bundled `implement` pipeline shrinks from two entries to one. No new diagnostic rule, no rule renaming, no new severity. Other pipelines unaffected.
  - **Pipeline engine (run path):** unaffected. The variable bag at `src/attractor/core/engine.ts:142` carries injected vars regardless of `inputs=` declaration. No node attribute or prompt under `src/cli/pipelines/implement/` references `$llm_model` (verified by `Grep` returning zero matches).
  - **Agents:** unaffected. `agent-handler.ts:65` resolves the model from the per-node `llmModel` DOT attribute, not from the variable bag. No agent rubric or input/output schema is edited.
  - **CLI:** unaffected. `ralph implement` auto-injection at `src/cli/commands/implement.ts:35` is left in place. `--model` flag remains documented in `README.md`. `ralph pipeline validate` and `ralph pipeline run` are not edited.
  - **Schema:** unaffected. No DOT-attribute schema is touched. `inputs=` is already an established graph-level attribute.
  - **Project-local pipelines (`.ralph/pipelines/**/pipeline.dot`):** unaffected. No project-local pipeline declares `llm_model` (verifier confirmed). Pipelines that legitimately want `llm_model` as a caller-supplied input continue to work — they declare it themselves.
  - **Build:** unaffected — no `tsconfig`, `tsup`, or bundling concern.
- **Breaking change:** no.
  - `--model` flag stays — README docs unchanged.
  - Variable bag still carries injected vars regardless of `inputs=` declaration — operator overrides via `--var` continue to work for any future pipeline that declares `llm_model`.
  - Validator escape-hatches (`default_<key>=`, qualified keys) continue to protect any future consumer.
  - No third-party copy of the bundled pipeline is on a long-term support contract; this is the canonical implement pipeline.
- **Spec / docs ripple checklist:**
  - [ ] `README.md` — verify no example output of the implement pipeline's `[required_caller_vars]` banner is quoted verbatim. If found, update; if absent, no edit.
  - [ ] `docs/adr/0003-attractor-pipeline-runtime.md` — sealed history per illumination step 6; do **not** retro-edit.
  - [ ] `docs/adr/0004-*` — sealed history per illumination step 6; do **not** retro-edit.
  - [ ] `docs/superpowers/specs/2026-05-04-validator-misclassifies-tool-node-outputs-as-caller-vars-design.md` — sealed history; do **not** retro-edit. The `llm_model` retention statement in §1, §2.5, §3.3 is dated and should remain as-shipped.
  - [ ] `docs/superpowers/plans/` — any in-flight plan that quotes the prior `inputs=` shape: sealed history; do **not** retro-edit.
  - [ ] No CONTEXT.md update — no domain-language change.
- **Test ripple checklist:**
  - [ ] `src/attractor/tests/graph-required-caller-vars.test.ts` — existing coverage of the digraph-input → required-caller-var rule is generic and continues to pass. **No edit required.**
  - [ ] *Optional* one-line snapshot guard against re-introducing `llm_model` to the bundled pipeline's banner. Plan-writer may decide; not a blocker.
  - [ ] Full suite (`npx vitest run`) must pass with zero new failures.

## 7. Trade-offs

### 7.1 Drop the digraph input only — not the CLI auto-injection (option a vs. option b)

The illumination posed two implementation options:

- **(a) Leave the injection alone.** The runtime variable bag carries an unread `llm_model`; the validator stops listing it because the digraph no longer declares it as an input. One-line `.dot` edit.
- **(b) Drop the injection too.** Smaller runtime surface; eliminates the dead bag entry; touches `src/cli/commands/implement.ts:33-36` and forces a parallel decision about whether `--model` should drive the implement pipeline at all (currently it doesn't — see §9).

**Chose (a) because:** the user explicitly scoped this illumination to the validator banner fix, with the safety walkthrough confirming option (a) is the minimum change that fixes the lie. Option (b) would force a separate decision about the `--model` flag's intended role and would expand the diff to a CLI surface — a different blast-radius profile. Deferring (b) keeps this design's blast radius S and its diff one-line, matching the user's stated preference for "minimum change that fixes the validator banner lie."

### 7.2 No retroactive edits to sealed-history docs

Multiple shipped specs, plans, and ADRs quote the prior `inputs="llm_model,..."` shapes. Retro-editing them would change the historical record of what was shipped on which date.

**Chose retention because:** per illumination step 6 and the chat refinement log, sealed-history docs are dated artifacts of the moment they shipped. The 2026-05-04 design doc explicitly retained `llm_model` and documented `llm_model` as a follow-up; the *current* design is that follow-up, and rewriting the prior doc to claim it dropped `llm_model` would break the audit chain illumination → design → plan → commit.

### 7.3 No snapshot guard test

A one-line snapshot assertion against the bundled implement pipeline's banner could prevent re-introduction of `llm_model`.

**Chose to defer because:** `src/attractor/tests/graph-required-caller-vars.test.ts` already exercises the digraph-input → banner rule generically. A bundled-pipeline-specific snapshot is a regression net for a one-line `.dot` edit that requires conscious effort to undo. The cost (one new `it(...)` case) is small but the value is small too. Plan-writer may decide whether to add it; the design does not mandate it.

### 7.4 No engine-side change

The illumination mentioned no builder gap to close; `agent-handler.ts:65` and `src/attractor/core/engine.ts:142` already behave correctly. The validator already exempts produces / default / qualified keys via the path the prior 2026-05-04 fix exercised.

**Accepted because:** the gap is purely an authoring artifact — the bundled pipeline declares an input that no node reads. Closing it requires only deletion at the source. No engine refactor needed; no validator escape-hatch needed.

## 8. Constraints

- The pipeline edit lands in a single commit so the diff tells one story (illumination → design → fix).
- `npx tsc --noEmit` must pass after the change. The edit is pure `.dot` syntax with no TypeScript surface.
- `npx vitest run` must pass with zero new failures. No test edit is required.
- `ralph pipeline validate src/cli/pipelines/implement/pipeline.dot` must produce a `[required_caller_vars]` banner containing exactly `scenarios_dir` — one item, no `llm_model`.
- `ralph implement` runtime behavior is unchanged: the implement loop still receives whatever `--max` and `--scenarios` and `--model` the operator passes; auto-injection at `src/cli/commands/implement.ts:33-36` is unmodified.
- Any deviation in run-path output (success or failure) on existing pipelines indicates an unexpected coupling and must be investigated before merge.

## 9. Open questions

- **`--model` flag dead in `implement` today.** Verification done in the chat session uncovered that `--model` does not currently influence model selection in the bundled `implement` pipeline: the `implementer` node at `src/cli/pipelines/implement/pipeline.dot:13` carries no `llm_model="$llm_model"` attribute, and `agent-handler.ts:65` reads only `node.llmModel`. The CLI's `--model` injection at `src/cli/commands/implement.ts:35` therefore writes to a variable bag entry no node consumes. This is informational for design/plan writers; it must **not** expand the present scope. A separate follow-up illumination should decide whether to (a) drop the auto-injection, (b) wire `llm_model="$llm_model"` onto the `implementer` node so `--model` actually takes effect, or (c) keep both as documented future-extension scaffolding.

No design-level question is open at draft time; the verifier's three rubric criteria pass and the chat refinements lock scope to the one-line edit in §2.

## 10. Verification approach

### 10.1 Static checks

Run after the change, in order:

- `npx tsc --noEmit` — expected: clean. `.dot` syntax has no TypeScript surface.
- Repo-wide `Grep` for `\$llm_model` inside `src/cli/pipelines/implement/` — expected: zero hits (unchanged from pre-edit; the absence is what justifies the edit).
- Targeted `Grep` for `inputs="scenarios_dir"` inside `src/cli/pipelines/implement/pipeline.dot` — expected: exactly one hit, on line 3.
- Targeted `Grep` for `llm_model` inside `src/cli/pipelines/implement/pipeline.dot` — expected: zero hits.

### 10.2 Tests

- `npx vitest run src/attractor/tests/graph-required-caller-vars.test.ts` — full file passes; no new case required.
- `npx vitest run` — entire suite passes with zero new failures. No other test exercises the bundled `implement/pipeline.dot` shape directly.

### 10.3 Smoke

- `ralph pipeline validate src/cli/pipelines/implement/pipeline.dot` — expected output includes `[required_caller_vars] This pipeline requires the following --var keys at runtime: scenarios_dir`. No `llm_model`.
- `ralph implement <some-project> --max 3 --scenarios scenarios/` (in a tmux session, given the launch guard at `src/cli/commands/implement.ts:23-28`) — runs end-to-end. No behavioral regression vs. current main.
- `ralph implement <some-project> --max 3 --scenarios scenarios/ --model claude-opus-4-7` — runs end-to-end. The `--model` flag is currently dead in the implement pipeline (see §9), but the auto-injection at `src/cli/commands/implement.ts:35` still writes the variable bag entry without erroring.
- `npm run build` — `tsup` produces the same `dist/` shape as before. The pipeline file is bundled-as-asset; no entry list change.

## 11. Summary

One-line edit to `src/cli/pipelines/implement/pipeline.dot:3`: drop `llm_model` from `inputs="llm_model,scenarios_dir"` so it reads `inputs="scenarios_dir"`. The validator banner shrinks from two entries to one — `scenarios_dir` is genuinely caller-supplied via `--scenarios`, and the spurious `llm_model` (auto-injected by the CLI from `--model` when present, never read by any agent body) stops being advertised. CLI auto-injection at `src/cli/commands/implement.ts:35` is left untouched per the chat-refinement scope decision; the variable bag will carry an unread key, the digraph just stops advertising it. No engine code changes, no schema changes, no agent contract changes, no test changes required. The user-visible win is signal-time honesty: the operator-facing banner now lists exactly the keys the operator can meaningfully supply. A separate follow-up illumination is flagged for the dead `--model` flag (see §9).
