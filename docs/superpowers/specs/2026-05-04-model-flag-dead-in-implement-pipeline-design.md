# Design: Remove the Dead `--model` Flag from `ralph implement`

**Date:** 2026-05-04
**Status:** draft (pending review)
**Originating illumination:** `.ralph/meditations/illuminations/2026-05-04T2048-model-flag-dead-in-implement-pipeline.md`
**Predecessor (sibling fix):** `docs/superpowers/specs/2026-05-04-drop-llm-model-from-bundled-implement-pipeline-design.md`

## 1. Motivation

`ralph implement --model <name>` is a public-contract lie. The CLI accepts the flag, the help text and README advertise it, but no node in the bundled `implement` pipeline reads the value. Operators who pass `--model claude-opus-4-7` for a long overnight loop silently get the agent's default model — and the default's bill.

Three anchors make the lie concrete:

1. **CLI accepts and injects** — `src/cli/commands/implement.ts:35`:
   ```ts
   ...(options.model ? { llm_model: options.model } : {}),
   ```
   The variable bag receives `llm_model` whenever `--model` is passed.

2. **No node reads `$llm_model`** — `src/cli/pipelines/implement/pipeline.dot` (full file, 34 lines). Line 3 reads `inputs="scenarios_dir"` (post-`8d9c12c`). Line 13 declares the implementer node with only `agent`, `max_iterations`, `default_max_iterations` — no `llm_model="..."` attribute. Repo-wide `Grep` for `\$llm_model` inside `src/cli/pipelines/implement/` returns zero hits.

3. **Agent handler resolves model from a different surface** — `src/attractor/handlers/agent-handler.ts:65`:
   ```ts
   if (node.llmModel) config = { ...config, model: node.llmModel as string };
   ```
   Single resolution path. It reads the parsed DOT attribute on the node, not the variable bag. The bag entry that `implement.ts:35` writes has no consumer.

The just-shipped sibling fix (`docs/superpowers/specs/2026-05-04-drop-llm-model-from-bundled-implement-pipeline-design.md`, commit `8d9c12c`) removed `llm_model` from the validator banner. That doc explicitly flagged the dangling CLI flag as a follow-up at §9 ("`--model` flag dead in `implement` today"). This design *is* that follow-up. The validator no longer lies about the input; this fix stops the CLI from lying about the flag.

## 2. Decision summary

Delete the `--model` surface end-to-end. No deprecation period. Loud breaking change.

**Edits (three files, four lines):**

1. `src/cli/commands/implement.ts` — drop `model?: string` from the `ImplementOptions` interface (currently line 8) and the `...(options.model ? { llm_model: options.model } : {})` injection (currently line 35).
2. `src/cli/program.ts` — drop the `.option("--model <name>", "LLM model override (e.g. claude-opus-4-6)")` line (currently line 86) and remove `model?: string` from the `.action` signature (currently line 88).
3. `README.md` — drop `--model <name>` from the `ralph implement` synopsis on line 27 and delete the description sentence on line 30 (`--model overrides the LLM model for the session.`).
4. `docs/adr/0003-scenario-tests-in-implement-pipeline.md` — add a one-paragraph status note at top stating the `--model` flag was removed on 2026-05-04 with a reference to this design doc; do **not** retro-edit the historical CLI synopsis at line 41 or the historical `inputs=` example at line 161 (sealed history per illumination step 6, mirroring the predecessor's stance).

After the edits, `ralph implement my-app --model claude-opus-4-7` exits with commander's `error: unknown option '--model'` — loud failure.

Out of scope (locked by upstream refinements):

- **`src/attractor/handlers/agent-handler.ts:65` — `node.llmModel` resolution.** Untouched. Per the chat-summarizer log, other pipelines may legitimately set `llm_model="..."` as a per-node DOT attribute; this fix removes only the CLI-surface lie. The handler's read of `node.llmModel` stays.
- **`src/cli/pipelines/implement/pipeline.dot`.** Untouched. The `inputs="scenarios_dir"` declaration is already correct after `8d9c12c`; no implementer-node attribute change is needed under Option B.
- **`src/attractor/tests/graph-required-caller-vars.test.ts:202-217`.** Untouched. The snapshot already asserts `llm_model` is **not** in the banner (`expect(info!.message).not.toContain("llm_model")` at line 216) — that assertion stays correct after this change.
- **Future multi-model testing.** The user explicitly acknowledged this need but deferred it ("Why not keep llm_model option if I want to test other models someday? Not for now though."). Re-adding ~10 lines of wiring later is preferred over keeping a dead flag now. No hedge for the future.

## 3. Architecture

### 3.1 Current shape

**`src/cli/commands/implement.ts:1-38` (lines that change shown verbatim):**

```ts
export interface ImplementOptions {
  max?: number;
  model?: string;          // line 8 — DELETE
  scenarios?: string;
}
// ...
await pipelineRunCommand("implement", {
  project: absPath,
  variables: {
    scenarios_dir: options.scenarios ?? "",
    max_iterations: String(options.max ?? 0),
    ...(options.model ? { llm_model: options.model } : {}),  // line 35 — DELETE
  },
});
```

**`src/cli/program.ts:81-90`:**

```ts
program
  .command("implement <project-folder>")
  .description("Run the implement pipeline — Claude reads prompts, writes code, commits, and pushes")
  .addHelpText("after", "...")
  .option("--max <n>", "Maximum iterations (0 = unlimited, default: 0)", parseInt)
  .option("--model <name>", "LLM model override (e.g. claude-opus-4-6)")  // line 86 — DELETE
  .option("--scenarios <path>", "Relative path under <project-folder> for scenario tests; ...")
  .action(async (projectFolder: string, options: { max?: number; model?: string; scenarios?: string }) => {
    //                                                                  ^^^^^^^^^^^^^^^ line 88 — DELETE
    await implementCommand(projectFolder, options);
  });
```

**`README.md:27,30`:**

```
ralph implement <project-folder> [--max N] [--model <name>] [--scenarios <path>]   ← line 27, drop "[--model <name>]"
...
--model overrides the LLM model for the session.                                    ← line 30, delete
```

### 3.2 Target shape

**`src/cli/commands/implement.ts`:**

```ts
export interface ImplementOptions {
  max?: number;
  scenarios?: string;
}
// ...
await pipelineRunCommand("implement", {
  project: absPath,
  variables: {
    scenarios_dir: options.scenarios ?? "",
    max_iterations: String(options.max ?? 0),
  },
});
```

**`src/cli/program.ts`:**

```ts
program
  .command("implement <project-folder>")
  .description("Run the implement pipeline — Claude reads prompts, writes code, commits, and pushes")
  .addHelpText("after", "...")
  .option("--max <n>", "Maximum iterations (0 = unlimited, default: 0)", parseInt)
  .option("--scenarios <path>", "Relative path under <project-folder> for scenario tests; ...")
  .action(async (projectFolder: string, options: { max?: number; scenarios?: string }) => {
    await implementCommand(projectFolder, options);
  });
```

**`README.md:27,30`:**

```
ralph implement <project-folder> [--max N] [--scenarios <path>]
```

(No `--model` description sentence.)

### 3.3 Runtime behavior pre/post

| Surface | Before | After |
|---|---|---|
| `ralph implement my-app` | works; default model | works; default model (unchanged) |
| `ralph implement my-app --max 3` | works | works (unchanged) |
| `ralph implement my-app --model claude-opus-4-7` | accepted; **silently ignored**; default model used | rejected: `error: unknown option '--model'`; exit 1 |
| `ralph implement my-app --scenarios src/tests/scenarios` | works (tmux required) | works (unchanged) |
| `pipeline validate src/cli/pipelines/implement/pipeline.dot` | banner: `scenarios_dir` | banner: `scenarios_dir` (unchanged) |
| `agent-handler` model resolution | `node.llmModel` only | `node.llmModel` only (unchanged) |

The only observable behavior change is the loud rejection of `--model`. Every other surface is byte-identical.

## 4. Components & file edits

| File | Change |
|---|---|
| `src/cli/commands/implement.ts` | Remove `model?: string` from `ImplementOptions` (line 8). Remove `...(options.model ? { llm_model: options.model } : {})` (line 35) and the trailing comma realignment. |
| `src/cli/program.ts` | Remove `.option("--model <name>", "LLM model override (e.g. claude-opus-4-6)")` (line 86). Remove `model?: string` from the `.action` callback's options type (line 88). |
| `README.md` | Edit line 27 synopsis to drop `[--model <name>]`. Delete line 30 description sentence. |
| `docs/adr/0003-scenario-tests-in-implement-pipeline.md` | Prepend a one-paragraph status note above §1 referencing this design doc and stating `--model` was removed on 2026-05-04. Do **not** retro-edit historical body text at lines 41 or 161. |

No other source file is touched. No test file edits are required (see §6 test ripple).

## 5. Data flow

`ralph implement` runtime path before:

1. `program.ts:88` callback collects `{ max, model, scenarios }` from commander.
2. `implement.ts:30-37` calls `pipelineRunCommand("implement", { project, variables: { scenarios_dir, max_iterations, llm_model? } })`.
3. Engine builds variable bag at `src/attractor/core/engine.ts:142`. Bag carries `llm_model` if present.
4. `implementer` node executes via `agent-handler.ts`. Handler at line 65 reads `node.llmModel` (the parsed DOT attribute on the node) — bag's `llm_model` is **never consulted**. Default model used.

After:

1. `program.ts` callback collects `{ max, scenarios }` from commander. Commander rejects `--model` with exit 1 before reaching the callback.
2. `implement.ts` calls `pipelineRunCommand` with `variables: { scenarios_dir, max_iterations }` — no `llm_model` key written.
3. Engine bag carries no `llm_model`. (Identical to current behavior in practice — the bag entry was unread.)
4. `agent-handler.ts:65` continues to read `node.llmModel`. Default model used. Identical resolution.

The data-flow change is purely on the rejection-at-CLI side. Everything downstream of the CLI parser is byte-identical to current behavior — because the variable bag entry was already a dead letter.

## 6. Blast radius / impact surface

Sourced from the verifier's `Blast radius:` paragraph and the explainer's `## Blast radius` block; verified by re-reading every cited line.

- **Size:** S
- **Files touched:** 4 (`src/cli/commands/implement.ts`, `src/cli/program.ts`, `README.md`, `docs/adr/0003-scenario-tests-in-implement-pipeline.md`).
- **Surfaces crossed:** CLI, public docs.
  - **CLI parser (commander):** `ralph implement --model X` shifts from "accepted, silently ignored" to "rejected with `error: unknown option '--model'`, exit 1." This is the breaking change.
  - **CLI command body (`implement.ts`):** the variable-bag write is removed; the bag stops carrying an unread key. Downstream behavior unchanged because no consumer existed.
  - **Pipeline engine (run path):** unaffected. `src/attractor/core/engine.ts:142` bag-construction code is not touched. The pipeline's `inputs="scenarios_dir"` declaration (post-`8d9c12c`) is already correct.
  - **Validator (`pipeline validate`):** unaffected. `[required_caller_vars]` banner already lists exactly `scenarios_dir` after the predecessor fix; this change does not touch the pipeline file.
  - **Agents:** unaffected. `agent-handler.ts:65`'s `node.llmModel` resolution path is preserved verbatim. Other pipelines that set `llm_model="..."` as a DOT node attribute continue to work.
  - **Project-local pipelines (`.ralph/pipelines/**/pipeline.dot`):** unaffected. `--model` was a flag on the bundled `implement` command only; project-local pipelines that want operator-supplied model selection use the `--var` mechanism (`ralph pipeline run X.dot --var llm_model=...`), which is unchanged.
  - **Schema:** unaffected. No DOT-attribute schema change.
  - **Build:** unaffected. No tsup entry, tsconfig, or asset-bundling concern.
- **Breaking change:** **yes.**
  - **Broken contract:** the public CLI flag `ralph implement --model <name>`, documented at `README.md:27,30` and `program.ts:86`. Scripts or shell aliases that pass `--model` will exit 1 with `error: unknown option '--model'` instead of silently being ignored. This is intentional — loud failure beats silent lie. No deprecation path. The flag never worked, so no operator was meaningfully relying on its behavior; the only people who notice are those whose scripts include the dead flag, and they get a clean error message pointing at it.
- **Spec / docs ripple checklist:**
  - [ ] `README.md:27` — strip `[--model <name>]` from `ralph implement` synopsis.
  - [ ] `README.md:30` — delete `--model overrides the LLM model for the session.`
  - [ ] `docs/adr/0003-scenario-tests-in-implement-pipeline.md` — prepend a one-paragraph status note above §1: "Status note (2026-05-04): The `--model <name>` flag shown in this ADR's CLI synopses was removed on 2026-05-04; see `docs/superpowers/specs/2026-05-04-model-flag-dead-in-implement-pipeline-design.md`. Historical CLI synopses and `inputs=` examples below are preserved as dated artifacts." Do **not** retro-edit body text at lines 41 (CLI synopsis) or 161 (`inputs=` example).
  - [ ] `docs/adr/0004-source-as-truth-no-behavioral-specs.md` and any other ADR — sealed history per illumination step 6; do **not** retro-edit. (Verifier flagged ADR-0004 as a relevant project-fit lens — its principle ("Source and Context as Truth, No Behavioral Specs") is the *justification* for this fix, not a doc to edit.)
  - [ ] `docs/superpowers/specs/2026-05-04-drop-llm-model-from-bundled-implement-pipeline-design.md` — sealed history; do **not** retro-edit. The §9 open question ("`--model` flag dead in `implement` today") is resolved by *this* design doc; the prior doc remains as-shipped.
  - [ ] `docs/superpowers/plans/` — any in-flight plan that references `--model` should be updated by its author when next touched. Not blocking.
  - [ ] CONTEXT.md — no domain-language change; no edit.
  - [ ] AGENTS.md — verifier flagged it for a review pass. `Grep` for `--model` in `AGENTS.md` during plan execution; if no match, no edit.
- **Test ripple checklist:**
  - [ ] `src/attractor/tests/graph-required-caller-vars.test.ts:202-217` — existing snapshot at line 216 already asserts `expect(info!.message).not.toContain("llm_model")`. **No edit required.** The assertion remains correct after this change because the pipeline file is untouched.
  - [ ] No new test required at the CLI surface. Commander's "unknown option" rejection is library-tested behavior; asserting it would test commander itself, not ralph.
  - [ ] Full suite (`npx vitest run`) must pass with zero new failures.
  - [ ] `npx tsc --noEmit` must pass — removing `model?: string` from two interfaces and one inline `.action` type may surface a stale reference; if `Grep` for `options.model` outside `implement.ts:35` returns matches, fix them in the same commit.

## 7. Trade-offs

### 7.1 Option B (delete) over Option A (wire)

The illumination posed two directions:

- **(A) Wire the flag.** Add `llm_model="$llm_model"` to the `implementer` node in `pipeline.dot`, restore `llm_model` to `inputs=`, drop the snapshot guard, add an integration test. ~10 lines net add. Reverses part of `8d9c12c`.
- **(B) Delete the flag.** Drop the CLI option, the bag injection, the README mentions, status note on ADR-0003. 4 lines net delete plus one prepended paragraph. No engine, pipeline, or test change.

**Chose (B) because:** the chat-summarizer log records the user's explicit, two-stage decision. First, "So option B simply remove dead code?" — confirming Option B does not touch the DOT-attribute path or the pipeline file. Then "Well let's remove the lie." — final approval. Rationale recorded in the log: *eliminating the public-contract lie now is preferable to carrying a documented-but-broken flag forward; loud failure beats silent lie; matches project's truth-over-drift stance (CONTEXT.md, ADR-0004).*

A future multi-model testing need is acknowledged in the log ("Why not keep llm_model option if I want to test other models someday? Not for now though.") but explicitly deferred: re-adding the wiring deliberately later is preferred over keeping a dead flag now. No hedge.

### 7.2 No deprecation period

Convention for breaking CLI changes might suggest a `--model is deprecated, will be removed` warning for one release. We do not do that here.

**Chose to skip because:** the flag never worked. A deprecation warning would imply "this used to do X, will stop doing X" — but it never did X. A user whose script passes `--model` was already silently getting the default. Loud failure on the next run is strictly better information than another release of silent fallthrough. The project's truth-over-drift posture (ADR-0004) treats silent no-ops as the bigger sin.

### 7.3 No retroactive edits to sealed-history docs

Multiple shipped specs and ADRs (notably ADR-0003 lines 41 and 161, and the predecessor design doc) quote the prior `--model` synopsis or `inputs=` shape. We add a status note to ADR-0003 but do not rewrite its body.

**Chose retention because:** illumination step 6 and the predecessor design's §7.2 establish the precedent — sealed-history docs are dated artifacts of the moment they shipped. Rewriting them to claim they always reflected the new shape would break the audit chain illumination → design → plan → commit. The status-note prepend is the lightest-touch way to flag drift without rewriting history.

### 7.4 No CLI-level test for the rejection

A test that runs `ralph implement my-app --model X` and asserts non-zero exit could pin the behavior.

**Chose to skip because:** commander's "unknown option" rejection is library behavior tested by commander itself. Adding a ralph-level test would be a smoke for "did we forget to re-add `--model`?" — a regression net for a change that requires conscious effort to undo. The cost is small but the value is small too. Plan-writer may add it; not mandated by the design.

## 8. Constraints

- The change lands in a single commit so the diff tells one story (illumination → design → fix).
- `npx tsc --noEmit` must pass after the change. Removing `model?: string` from two interface positions and one inline `.action` type may surface a stale `options.model` reference somewhere — if so, fix it in the same commit.
- `npx vitest run` must pass with zero new failures. No test edit is required; the existing snapshot at `src/attractor/tests/graph-required-caller-vars.test.ts:216` continues to hold.
- `ralph implement my-app --model X` must exit non-zero with commander's `error: unknown option '--model'` after the change.
- `ralph implement my-app` and `ralph implement my-app --max 3 --scenarios src/tests/scenarios` must run end-to-end identically to current main.
- `Grep` for `options.model` and `--model` across the repo after the edit:
  - `options.model` — expected: zero hits.
  - `--model` — expected: hits only inside dated/sealed-history files (predecessor design doc, ADR-0003 historical synopses, this design doc). Any live code or current-state doc reference is a residue and must be cleaned in the same commit.

## 9. Open questions

None. The verifier's three rubric criteria pass (still-relevant, accuracy, project-fit), the chat refinements lock scope to the four-line CLI deletion plus README/ADR ripple, and Option B is explicitly chosen with rationale recorded.

A genuinely deferred follow-up — *should the implement pipeline support operator-driven model selection at all?* — is acknowledged but explicitly punted to a future illumination per the chat log. This design does not pre-empt that decision.

## 10. Verification approach

### 10.1 Static checks

Run after the change, in order:

- `npx tsc --noEmit` — expected: clean.
- `Grep` for `options.model` repo-wide — expected: zero hits.
- `Grep` for `--model` repo-wide — expected: hits only inside sealed-history docs (this design, predecessor design, ADR-0003 historical synopses). Any live code or current-state doc reference fails the gate.
- `Grep` for `model?: string` repo-wide — expected: zero hits inside `src/cli/`.
- `Grep` for `llm_model` inside `src/cli/commands/implement.ts` — expected: zero hits.

### 10.2 Tests

- `npx vitest run src/attractor/tests/graph-required-caller-vars.test.ts` — full file passes; the snapshot at line 216 holds unchanged.
- `npx vitest run` — entire suite passes with zero new failures.

### 10.3 Smoke

- `ralph implement my-app --model X` → exits 1, message contains `unknown option '--model'`.
- `ralph implement my-app` → runs end-to-end (default model, identical to current main).
- `ralph implement my-app --max 3 --scenarios src/tests/scenarios` (in tmux) → runs end-to-end (identical to current main).
- `ralph implement --help` → no `--model` line in help text.
- `ralph pipeline validate src/cli/pipelines/implement/pipeline.dot` → banner unchanged: `[required_caller_vars] ... scenarios_dir`.
- `npm run build` → `tsup` produces the same `dist/` shape; no entry-list change.

## 11. Summary

Delete the four-line `--model` surface from `src/cli/commands/implement.ts` (interface field + bag-injection ternary), `src/cli/program.ts` (commander option + action-callback type), and `README.md:27,30`. Prepend a one-paragraph status note to `docs/adr/0003-scenario-tests-in-implement-pipeline.md` flagging the removal; leave that ADR's body and all other sealed-history docs untouched. The flag was dead — `agent-handler.ts:65` resolves the model from `node.llmModel` (per-node DOT attribute), never from the variable bag entry that `implement.ts:35` was writing. After the change, `ralph implement --model X` exits 1 with `error: unknown option '--model'`; everything else is byte-identical to current behavior. Loud failure replaces silent lie. Future multi-model testing is explicitly acknowledged and deferred — re-add the ~10 lines of wiring deliberately when the need is real, rather than keeping a dead flag as a hedge.
