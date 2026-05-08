# Design: Close the implement no-op → tmux-tester pass collusion in `illumination-to-implementation`

**Date:** 2026-05-08
**Status:** draft (pending review)
**Originating illumination:** `.apparat/meditations/illuminations/2026-05-07T2148-implement-node-no-op-passes-verification.md`

## 1. Motivation

Two success signals collude to mask a planning-only run as a real ship:

1. The `implement` agent declares `done=true` from inside the agent's own JSON. There is no diff-presence check between the value the agent emits and the working tree it claims to have changed. The looping handler trusts the field as-is — `src/attractor/handlers/looping-agent-handler.ts:151`:

   ```ts
   const willBreak = parsed?.done === true;
   ```

   The agent's frontmatter at `.apparat/pipelines/illumination-to-implementation/implement.md:9-12` declares only:

   ```
   inputs:
     - plan_writer.plan_path
   outputs:
     done: boolean
   ```

   No pre-implement HEAD sha is captured, no diff guard runs, and the loop-break contract is "the agent said so."

2. `tmux_tester` is a project-health gate. Its outputs at `.apparat/pipelines/illumination-to-implementation/tmux-tester.md:15-18` are:

   ```
   outputs:
     test_result: {enum: [pass, fail]}
     test_summary: string
     test_render: string
   ```

   Green build + green tests on an unchanged tree trivially pass. The agent's *prose* (in `test_summary` / `test_render`) sometimes notices the gap, but only the structured `test_result` field gates downstream nodes; the prose is informational. The downstream gate at `.apparat/pipelines/illumination-to-implementation/tmux_confirm_gate.md:1-9` consumes only:

   ```
   inputs:
     - run_id
     - tmux_tester.test_render
   ```

   so the operator at `tmux_confirm_gate` sees one signal (`test_render`) and decides Commit vs. Retry on it alone.

The pipeline routing wires these together with no diff-presence node in between (`.apparat/pipelines/illumination-to-implementation/pipeline.dot:77-89`):

```
design_writer -> plan_writer -> implement
implement -> implement           [condition="implement.success=false"]
implement -> review_gate
review_gate -> memory_writer     [label="Approve"]
review_gate -> tmux_tester       [label="Tmux"]
review_gate -> implement         [label="Retry"]

tmux_tester -> tmux_confirm_gate
tmux_confirm_gate -> memory_writer [label="Commit"]
tmux_confirm_gate -> tmux_tester [label="Retry"]
```

`memory_writer` lands and pushes; if the pre-check at `memory-writer.md:128-135` finds `tmux_tester.test_result == "fail"`, it skips the consume calls — but a no-op masquerading as `pass` is exactly the case that pre-check does *not* catch.

**Reproduction.** Run `d9859ff1`, recorded at `.apparat/sessions/2026-05-07-pipeline-mission-control-fragmentation.md:3,46`:

> "Implement node was a no-op. implement reported done=true after one iteration but emitted zero source changes."

`tmux_tester.test_result=pass`, `test_summary` carried the literal phrase *"no in-scope diff was produced for the mission-control plan, so nothing required fixing"*, and the four planned files (`src/cli/commands/pipeline/list.ts`, `validate.ts`, `program.ts`, new `src/cli/lib/pipeline-status.ts`) were absent on disk post-run. The only post-plan commit was an unrelated illumination drop. The pipeline walked through `review_gate` → `tmux_tester` → `tmux_confirm_gate` → `commit_push` looking identical to a real ship.

This compounds with the shallow-handoff illumination from the same day (`2026-05-07T2141-pipeline-failure-handoff-is-shallow.md`): when implement silently no-ops, the operator only learns post-merge that nothing shipped.

## 2. Decision Summary

1. **Capture pre-implement HEAD sha** as `implement.pre_sha` on agent entry, written from inside the agent (`git rev-parse HEAD`). Reuse the existing Bash tool plumbing — no new dependency, no handler-side override.

2. **Agent-driven diff guard inside `implement`.** At exit, the agent runs `git diff --stat $implement.pre_sha HEAD` *and* `git status --porcelain`. If both are empty AND the agent's own loop iteration claimed non-trivial work, the agent emits `{ "done": false, "reason": "no_diff_produced" }` instead of `done=true`. The handler does NOT inspect the diff itself — that would be a public-contract violation per the verifier's MEDIUM-caution note. The check lives in the agent's prompt; the handler's only change is an additive `outputs:` schema extension.

3. **Plan-coverage signal in `tmux_tester`.** Read `plan_writer.plan_path` (already an injectable input), extract the file paths called out by the plan (existing convention), and compare against the diff range from `implement.pre_sha` to `HEAD`. Surface a new orthogonal output:

   ```
   tmux_tester.plan_files_touched: integer  # count of plan-listed paths actually present in the diff
   ```

   Keep `test_result` orthogonal — this is a *separate* signal, not a downgrade of build/test health. A plan touching zero files but green tests can still report `test_result=pass` AND `plan_files_touched=0`; the gate, not the tester, decides whether to commit.

4. **`tmux_confirm_gate` renders all three signals.** Extend the gate's `inputs:` (optional today per `src/attractor/core/schemas.ts:61`) and rewrite the gate body so the operator sees `implement.done`, `tmux_tester.test_result`, AND `tmux_tester.plan_files_touched` in the prompt. The pipeline stops asserting "all green" when one of the three signals contradicts the others.

5. **Memory-writer Warnings cross-check.** When `tmux_tester.test_summary` contains substrings like *"no in-scope diff"*, *"nothing to verify"*, or *"implement node committed only"*, append a `## Warnings` section to the memory file so memory-reflector sees the gap pre-distilled. Currently this prose is buried inside `test_summary` and the next memory-mining pass has to rediscover it.

6. **Backfill smoke test.** Add `src/cli/tests/pipeline-smoke-implement-noop-folder.test.ts` — drives an implement node configured to no-op and asserts the run terminates at `review_gate` with `implement.done=false` (and reason `no_diff_produced`), not at `commit_push` with `done=true`.

7. **Atomic landing.** One commit (or one PR) lands all six items. Staged would create an interim state where `implement` flips `done=false` on no-op but `tmux_confirm_gate` still renders only `test_render`, or where `plan_files_touched` is emitted but no consumer reads it — exactly the silent-collusion failure mode the design closes.

## 3. Architecture

### 3.1 Before / after diagram

```
Before                                              After
──────                                              ─────
implement.md frontmatter                            implement.md frontmatter
  inputs: [plan_writer.plan_path]                     inputs: [plan_writer.plan_path]
  outputs: { done: boolean }                          outputs:
                                                        done: boolean
                                                        pre_sha: string
                                                        reason: {enum: [no_diff_produced, ""]}

implement agent body                                implement agent body
  Step 1..N do work                                   Step 0c: capture pre_sha = `git rev-parse HEAD`
  Final JSON: { done: <self-attested> }               (BEFORE any work)
                                                      Step N+1: run `git diff --stat $pre_sha HEAD`
                                                                + `git status --porcelain`
                                                      If both empty AND iteration claimed work:
                                                        emit { done:false, reason:"no_diff_produced",
                                                               pre_sha:<…> }
                                                      Else:
                                                        emit { done:<self-attested>, reason:"",
                                                               pre_sha:<…> }

looping-agent-handler.ts:151                        looping-agent-handler.ts:151 (UNCHANGED)
  willBreak = parsed?.done === true                   willBreak = parsed?.done === true
                                                      (handler still trusts the field;
                                                       agent-side check produces the value)

tmux-tester.md frontmatter                          tmux-tester.md frontmatter
  inputs:  [project, run_id]                          inputs:  [project, run_id, plan_writer.plan_path,
                                                                implement.pre_sha]
  outputs:                                            outputs:
    test_result, test_summary, test_render              test_result, test_summary, test_render,
                                                        plan_files_touched: integer

tmux_confirm_gate.md frontmatter                    tmux_confirm_gate.md frontmatter
  inputs: [run_id, tmux_tester.test_render]           inputs: [run_id,
                                                              implement.done,
                                                              tmux_tester.test_result,
                                                              tmux_tester.test_render,
                                                              tmux_tester.plan_files_touched]

  body: just renders test_render                      body: renders three signals + test_render

memory-writer.md (no Warnings section emit)         memory-writer.md
                                                      Step 4a (new): if test_summary matches
                                                      no-op substrings, prepend `## Warnings` section
                                                      with the matching substring quoted.
```

### 3.2 Output-shape extensions (additive)

The verifier's public-contract subagent rated the output extensions LOW risk because `outputsToZod` is additive (`src/attractor/handlers/looping-agent-handler.ts:54`):

```ts
const zodSchema = (jsonSchema && config.outputs) ? outputsToZod(config.outputs) : null;
```

Adding `pre_sha`, `reason`, and `plan_files_touched` to the respective frontmatter blocks extends the per-node schema; existing consumers that only read `done` / `test_result` / `test_render` are unaffected.

`tmux_confirm_gate`'s `inputs:` are optional in the gate schema (`src/attractor/core/schemas.ts:58-62`):

```ts
export const GateMdFrontmatterSchema = z.object({
  type: z.literal("gate"),
  choices: z.array(z.string().min(1)).min(1, "gate choices: must declare at least one choice"),
  inputs: z.array(z.string().min(1)).optional(),
}).strict();
```

so listing additional context keys does not break validation. The gate renderer interpolates `$<input>` references, so the body change is mechanical.

### 3.3 Agent-driven diff guard, NOT handler-side override

The verifier called out MEDIUM caution against forcing `done=false` from a handler-side diff inspection: the handler must not override `parsed.done`. The agent owns the verdict; the handler trusts the field. Why this matters:

- The deep-loop contract documented in README.md:65-117 names `outputs: { done: boolean }` as the loop-break contract. Adding `pre_sha` is additive, but the *meaning* of `done` is "the agent says the work is finished." A handler-side diff guard would silently invert that meaning whenever a legitimate refactor produced no diff (e.g. all changes already on disk from a prior iteration that crashed mid-write).
- Centralising the check in the agent prompt keeps the policy where the agent operator can read it. Future tweaks (e.g. allow no-op when the plan is checkbox-only documentation) live in the prompt, not in TypeScript.
- The looping handler stays simple. `src/attractor/handlers/looping-agent-handler.ts:151` is unchanged.

### 3.4 `implement.md` agent body changes

Two new steps bracket the existing procedure:

**Step 0c — Capture pre_sha (new, runs before any code or plan reads):**

```bash
pre_sha=$(cd $project && git rev-parse HEAD)
```

The value is carried in the agent's working memory until the final JSON emit. (The frontmatter declares `pre_sha` as an output; the agent writes it on every iteration's final JSON.)

**Step N+1 — Diff guard (new, runs after the chunk is committed but before the final JSON):**

```bash
diff_stat=$(cd $project && git diff --stat $pre_sha HEAD)
porcelain=$(cd $project && git status --porcelain)
```

If `diff_stat` is empty AND `porcelain` is empty AND this iteration's agent narrative claimed non-trivial work, the agent emits:

```json
{ "done": false, "reason": "no_diff_produced", "pre_sha": "<sha>" }
```

Otherwise:

```json
{ "done": <self-attested>, "reason": "", "pre_sha": "<sha>" }
```

The prompt makes it explicit that the agent must *re-read* `$plan_writer.plan_path` before deciding `done=true` and confirm at least one chunk is now `[x]` — the existing step 4 already commits per chunk, so a real iteration always produces a commit and `git diff --stat $pre_sha HEAD` is non-empty by construction.

### 3.5 `tmux-tester.md` agent body changes

The tester gains two responsibilities, neither of which alters its existing build/test/smoke loop:

1. **Plan-file extraction.** At Phase 0 (before the cycles start), read `$plan_writer.plan_path` and extract file-path mentions. The plan convention is "back-tick-quoted relative paths under `src/`, `docs/`, or `.apparat/`" — already used by `plan_writer` and the post-mortem notes. A simple grep `\`[^\`]+\.(ts|md|dot|js|json)\`` against the plan body produces the candidate set.

2. **Diff cross-reference.** After Phase 1's build+test cycle settles, run:

   ```bash
   git diff --name-only $implement.pre_sha HEAD
   ```

   in `$project`. Count how many of the plan's candidate paths appear in the diff; emit as `plan_files_touched`. Zero is a real value, not a synonym for "skipped" — a plan that legitimately touches no files (e.g. a doc-only plan whose paths are not file mentions) would surface as `0` and the operator decides at the gate.

3. **Reporting in `test_render`.** Add a one-line "Plan coverage" entry to the existing markdown block:

   ```markdown
   ### Plan coverage
   plan_files_touched: 0  (out of 4 candidate paths in plan_writer.plan_path)
   ```

   `test_result` remains orthogonal: a plan-coverage zero does not flip `pass` to `fail`. The gate, not the tester, weights the signals.

### 3.6 `tmux_confirm_gate.md` body change

Replace the body at `.apparat/pipelines/illumination-to-implementation/tmux_confirm_gate.md:10-14`:

```markdown
Tests ran in tmux window test-$run_id.

$tmux_tester.test_render

Commit the fixes or give tmux-tester another pass?
```

with:

```markdown
Tests ran in tmux window test-$run_id.

### Signals
- implement.done: $implement.done   (reason: $implement.reason)
- tmux_tester.test_result: $tmux_tester.test_result
- tmux_tester.plan_files_touched: $tmux_tester.plan_files_touched

$tmux_tester.test_render

Commit the fixes or give tmux-tester another pass?
```

The frontmatter `inputs:` extend to `[run_id, implement.done, implement.reason, tmux_tester.test_result, tmux_tester.test_render, tmux_tester.plan_files_touched]`. The gate's choices remain `Commit` / `Retry`.

### 3.7 `memory-writer.md` Warnings section

Add Step 4a between Step 4 (compose memory) and Step 5 (commit). Pseudocode:

```
no_op_substrings = [
  "no in-scope diff",
  "nothing to verify",
  "implement node committed only",
  "no_diff_produced",
]

if any(s in $tmux_tester.test_summary for s in no_op_substrings):
  prepend `## Warnings` section to memory body, before `## What was implemented`,
  containing one bullet per matched substring with the surrounding sentence quoted.
```

The Warnings section is *separate* from the existing optional `## Learnings from the run` section. Learnings is for retry-loop pattern mining; Warnings is for "this run looks like a no-op even though we're closing it out." Memory-reflector reads Warnings first.

### 3.8 New smoke test

`src/cli/tests/pipeline-smoke-implement-noop-folder.test.ts` exercises the live engine path:

```text
1. Stand up a temp project with a plan_writer.plan_path that points at a fixture
   plan with one unchecked chunk.
2. Configure an `implement` agent stub that:
   - returns done=true if NOT injected with the diff-guard step,
   - returns done=false reason=no_diff_produced WITH the diff-guard step.
3. Drive `apparat pipeline run` against
   `.apparat/pipelines/illumination-to-implementation/pipeline.dot`.
4. Assert the run terminates at `review_gate` with implement.done=false,
   NOT at `commit_push` with done=true.
5. Assert tmux_tester.plan_files_touched=0 in the trace.
```

Companion edits to the two existing scenario tests:

- `src/cli/tests/pipeline-implement-folder.test.ts` — extend the existing `done=true` happy-path assertions to also assert `pre_sha` is non-empty in the trace, proving the new output is wired.
- `src/cli/tests/pipeline-smoke-tmux-tester-folder.test.ts` — extend the smoke to assert `plan_files_touched` appears in `test_render` and that the gate body interpolates all three signals.

### 3.9 Surfaces unchanged

- The `outputsToZod` helper, the `LoopingAgentHandler.execute` signature, and the loop-break check at `src/attractor/handlers/looping-agent-handler.ts:151`. Unchanged.
- Pipeline DOT routing (`pipeline.dot:77-89`) — same edges, same conditions.
- `implement` `inputs:` list — unchanged (`plan_writer.plan_path` only).
- `commit_push`, `review_gate`, `memory_reflector`, `verifier`, `explainer`, `chat_session`, `chat_summarizer`, `design_writer`, `plan_writer`. Untouched.
- Any pipeline outside `.apparat/pipelines/illumination-to-implementation/`. Untouched.
- `apparat pipeline {run, validate, list, trace, show}` CLI surface, exit codes, stdout/stderr formatting. Unchanged.
- Gate schema (`src/attractor/core/schemas.ts:58-62`). Unchanged — the design uses the existing optional `inputs:` field.

### 3.10 Files-touched buckets

| Bucket | Files | Treatment |
|---|---|---|
| Pipeline specs | `.apparat/pipelines/illumination-to-implementation/implement.md` | Inline edit — extend `outputs:` (add `pre_sha`, `reason`), insert Step 0c + Step N+1 in the body |
| Pipeline specs | `.apparat/pipelines/illumination-to-implementation/tmux-tester.md` | Inline edit — extend `inputs:` (add `plan_writer.plan_path`, `implement.pre_sha`), extend `outputs:` (add `plan_files_touched`), append plan-extraction + diff cross-ref steps |
| Pipeline specs | `.apparat/pipelines/illumination-to-implementation/tmux_confirm_gate.md` | Inline edit — extend `inputs:`, rewrite body to render three signals |
| Pipeline specs | `.apparat/pipelines/illumination-to-implementation/memory-writer.md` | Inline edit — add Step 4a (Warnings substring cross-check) |
| Pipeline DOT | `.apparat/pipelines/illumination-to-implementation/pipeline.dot` | No edit required — gate inputs change is in the `.md` frontmatter, not the `.dot` |
| Tests — new | `src/cli/tests/pipeline-smoke-implement-noop-folder.test.ts` | **New** — covers the no-op → `done=false` path |
| Tests — edited | `src/cli/tests/pipeline-implement-folder.test.ts` | Extend happy-path assertions to cover `pre_sha` |
| Tests — edited | `src/cli/tests/pipeline-smoke-tmux-tester-folder.test.ts` | Extend smoke to assert `plan_files_touched` in `test_render` and gate body interpolation |
| Handler | `src/attractor/handlers/looping-agent-handler.ts` | Currently unchanged. Open question §9 item 1 covers the optional handler-side belt-and-braces guard. |
| Docs | `README.md` deep-loop section (lines 65-117) | Inline edit — document the new `pre_sha` output and the no-op refusal contract |
| ADR | possibly new | Open question §9 item 2 |
| CONTEXT.md | possibly new term | Open question §9 item 3 |

### 3.11 LOC sanity check

| File | Approx LOC after change |
|---|---|
| `.apparat/pipelines/illumination-to-implementation/implement.md` | +~25 (frontmatter +3 lines, Step 0c +6, Step N+1 +12) |
| `.apparat/pipelines/illumination-to-implementation/tmux-tester.md` | +~30 (inputs +2, outputs +1, plan extraction +12, diff cross-ref +10, render addition +5) |
| `.apparat/pipelines/illumination-to-implementation/tmux_confirm_gate.md` | +~8 (inputs +4, body +4) |
| `.apparat/pipelines/illumination-to-implementation/memory-writer.md` | +~20 (Step 4a — substring set + match + section emit) |
| `src/cli/tests/pipeline-smoke-implement-noop-folder.test.ts` (new) | ~140 (fixture plan + agent stub + run + 3 assertions) |
| `src/cli/tests/pipeline-implement-folder.test.ts` (edited) | +~10 (`pre_sha` non-empty assertion) |
| `src/cli/tests/pipeline-smoke-tmux-tester-folder.test.ts` (edited) | +~15 (plan_files_touched assertion + gate-body assertion) |
| `README.md` (edited) | +~12 (deep-loop section sub-paragraph on `pre_sha`) |
| **Net new code/spec** | ~+260 LOC, all behind narrow surfaces |

## 4. Components & file edits

### 4.1 `.apparat/pipelines/illumination-to-implementation/implement.md` (edited)

Frontmatter `outputs:` becomes:

```yaml
outputs:
  done: boolean
  pre_sha: string
  reason: {enum: [no_diff_produced, ""]}
```

Body inserts:

**Step 0c** (between today's 0b and 0d):

> **Capture pre-implement HEAD sha.** Before any reads, dispatches, or edits, record the working-tree state:
>
> ```bash
> pre_sha=$(cd $project && git rev-parse HEAD)
> ```
>
> Carry this value through to the final JSON emit. This is the diff-guard reference.

**Step N+1** (after today's step 4, before today's step 9):

> **Diff guard before declaring done.** Before emitting JSON, run:
>
> ```bash
> cd $project
> git diff --stat $pre_sha HEAD
> git status --porcelain
> ```
>
> If both outputs are empty AND this iteration's narrative claimed non-trivial implementation work (a chunk was attempted, a file was supposed to be touched), emit:
>
> ```json
> { "done": false, "reason": "no_diff_produced", "pre_sha": "<sha>" }
> ```
>
> Refuse to mask a no-op as success. Otherwise emit `done=<self-attested>, reason="", pre_sha=<sha>`.

### 4.2 `.apparat/pipelines/illumination-to-implementation/tmux-tester.md` (edited)

Frontmatter:

```yaml
inputs:
  - project
  - run_id
  - plan_writer.plan_path
  - implement.pre_sha
outputs:
  test_result: {enum: [pass, fail]}
  test_summary: string
  test_render: string
  plan_files_touched: integer
```

New Phase 0 sub-step (before Phase 1):

> **Phase 0a — Plan-coverage candidate extraction.** Read `$plan_writer.plan_path` and extract back-tick-quoted file references matching `\`[^\`]+\.(ts|md|dot|js|json)\``. Store as the candidate set.

New Phase 1 tail sub-step:

> **Phase 1c — Diff cross-reference.** After Phase 1 settles, run:
>
> ```bash
> git diff --name-only $implement.pre_sha HEAD
> ```
>
> Count how many candidate paths appear in the diff. Emit `plan_files_touched: <count>` in the final JSON. Append a "### Plan coverage" line to `test_render`.

`test_result` semantics in Phase 4 remain unchanged — coverage is orthogonal.

### 4.3 `.apparat/pipelines/illumination-to-implementation/tmux_confirm_gate.md` (rewritten body)

Frontmatter:

```yaml
type: gate
choices:
  - Commit
  - Retry
inputs:
  - run_id
  - implement.done
  - implement.reason
  - tmux_tester.test_result
  - tmux_tester.test_render
  - tmux_tester.plan_files_touched
```

Body:

```markdown
Tests ran in tmux window test-$run_id.

### Signals
- implement.done: $implement.done   (reason: $implement.reason)
- tmux_tester.test_result: $tmux_tester.test_result
- tmux_tester.plan_files_touched: $tmux_tester.plan_files_touched

$tmux_tester.test_render

Commit the fixes or give tmux-tester another pass?
```

### 4.4 `.apparat/pipelines/illumination-to-implementation/memory-writer.md` (edited)

Insert between current Step 4 and Step 5:

> **4a. Warnings cross-check.** Define the no-op substring set:
>
> ```
> no_op_substrings = [
>   "no in-scope diff",
>   "nothing to verify",
>   "implement node committed only",
>   "no_diff_produced",
> ]
> ```
>
> If any substring appears in `$tmux_tester.test_summary` (case-insensitive), prepend a `## Warnings` section to the memory body (before `## What was implemented`), with one bullet per matched substring quoting the surrounding sentence. Memory-reflector reads `## Warnings` first; this is the channel for "this run looks like a no-op even though it landed."

The Step 7 pre-check (skip consume on `tmux_tester.test_result=fail`) is unchanged. Warnings is additive and runs on the success path too — exactly the case the original failure mode missed.

### 4.5 `src/cli/tests/pipeline-smoke-implement-noop-folder.test.ts` (new)

Smoke skeleton:

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { runPipelineForTest } from "./helpers/pipeline-runner.js"; // existing test helper

describe("pipeline-smoke: implement no-op refuses to mask success", () => {
  it("terminates at review_gate with implement.done=false reason=no_diff_produced", async () => {
    const project = mkdtempSync(join(tmpdir(), "noop-smoke-"));
    // Seed a plan with one unchecked chunk that the stub agent claims to address.
    writeFileSync(join(project, "PLAN.md"), "- [ ] Add foo to bar\n");
    // Stub implement agent: emits done=true WITHOUT writing anything.
    // Real diff guard in implement.md must flip done=false reason=no_diff_produced.
    const result = await runPipelineForTest({
      project,
      pipeline: ".apparat/pipelines/illumination-to-implementation/pipeline.dot",
      injectedAgentResults: {
        implement: { done: true, pre_sha: "<seeded-from-runner>" },
        // The diff guard step in implement.md should override this BEFORE the JSON
        // is parsed — the test verifies that override is honored.
      },
    });
    expect(result.terminalNode).toBe("review_gate");
    expect(result.context["implement.done"]).toBe("false");
    expect(result.context["implement.reason"]).toBe("no_diff_produced");
    expect(result.context["tmux_tester.plan_files_touched"]).toBe("0");
  });
});
```

(The test runner's `injectedAgentResults` shape is the existing seam used by sibling smoke tests.)

## 5. Data flow

### 5.1 implement node — happy path (real diff)

```
implement enters
  → agent runs Step 0c: pre_sha = git rev-parse HEAD
  → agent runs Steps 1..N: dispatches subagents, edits, commits, pushes
  → agent runs Step N+1: git diff --stat $pre_sha HEAD → non-empty
                          git status --porcelain → empty (already committed)
  → agent emits { done: <true|false based on plan>, reason: "", pre_sha: <sha> }
  → handler's evaluateAgentOutput parses, willBreak when done=true
```

### 5.2 implement node — no-op path (the failure mode this design closes)

```
implement enters
  → agent runs Step 0c: pre_sha = git rev-parse HEAD
  → agent reads plan, decides "looks done already" (the bug)
  → agent runs Step N+1: git diff --stat $pre_sha HEAD → empty
                          git status --porcelain → empty
  → agent overrides its own verdict:
    emits { done: false, reason: "no_diff_produced", pre_sha: <sha> }
  → handler's evaluateAgentOutput parses, willBreak=false (loops back per pipeline.dot:81)
  → next iteration runs again
```

If the agent loops infinitely (e.g. plan is genuinely unimplementable), the deep-loop runner's existing iteration cap or the operator-driven `review_gate` Retry path handles it — same surface as today.

### 5.3 tmux_tester node — coverage path

```
tmux_tester enters with $implement.pre_sha and $plan_writer.plan_path
  → Phase 0a: extract candidate paths from plan body
  → Phase 0: open/reuse test window
  → Phase 1: build + test
  → Phase 1c: git diff --name-only $implement.pre_sha HEAD
              count overlap with candidate set
  → Phases 2-3: scenario + targeted exercise (unchanged)
  → Phase 4: emit { test_result, test_summary, test_render, plan_files_touched }
```

### 5.4 tmux_confirm_gate render

```
gate enters with run_id, implement.{done,reason}, tmux_tester.{test_result,test_render,plan_files_touched}
  → renderer interpolates $-prefixed inputs into the body markdown
  → operator sees three independent signals + the test_render markdown block
  → operator picks Commit or Retry
```

### 5.5 memory_writer Warnings emit

```
memory_writer enters with all upstream context
  → Step 4 builds the memory file body in memory
  → Step 4a scans $tmux_tester.test_summary for no_op_substrings
    if any match: prepend `## Warnings` section
  → Step 5 commits, Step 6 pushes, Step 7 consumes (gated by test_result=fail check)
```

## 6. Blast radius / impact surface

- **Size:** **M** (per upstream verifier sizing).
- **Files touched:** ~8.
  - **New:** `src/cli/tests/pipeline-smoke-implement-noop-folder.test.ts`.
  - **Inline edits:** 4 pipeline specs (`implement.md`, `tmux-tester.md`, `tmux_confirm_gate.md`, `memory-writer.md`).
  - **Test edits:** `src/cli/tests/pipeline-implement-folder.test.ts`, `src/cli/tests/pipeline-smoke-tmux-tester-folder.test.ts`.
  - **Doc edits:** `README.md` deep-loop section (lines 65-117).
  - **Possibly new:** ADR (open question §9 item 2), CONTEXT.md term (open question §9 item 3).
- **Surfaces crossed:**
  - **Pipeline spec** — `illumination-to-implementation` agent frontmatter and bodies.
  - **Deep-loop handler contract** — `outputs:` extension, but the actual TypeScript at `src/attractor/handlers/looping-agent-handler.ts:151` is unchanged.
  - **Gate-render contract** — `tmux_confirm_gate` body uses three new `$<input>` interpolations; the gate schema accepts them via the optional `inputs:` field at `src/attractor/core/schemas.ts:61`.
  - **Memory-writer template** — new Warnings section ahead of the existing memory body.
  - **Scenario tests** — new smoke + two edits.
  - **Docs** — README deep-loop section.
- **Breaking changes:**
  - **None for additive output keys** (`outputsToZod` is additive — verifier-confirmed).
  - **None for gate inputs** (`inputs:` optional in `GateMdFrontmatterSchema:61`).
  - **MEDIUM caution carried into Open Questions** — the diff guard is agent-driven, not handler-side, exactly because forcing `done=false` from a handler diff-inspection would be a semantic break of the deep-loop contract. The design rejects that path.
  - The smoke fixture for `pipeline-implement-folder.test.ts` may need a re-recorded `pre_sha` value; addressed inline in the test edit.
- **Spec / docs ripple:**
  - [ ] `README.md` deep-loop section (lines 65-117) — document the new `pre_sha` output and the agent-side no-op refusal contract.
  - [ ] possibly new ADR — see §9 open question 2.
  - [ ] possibly new CONTEXT.md term `plan_files_touched` — see §9 open question 3.
- **Test ripple:**
  - [ ] **New** `src/cli/tests/pipeline-smoke-implement-noop-folder.test.ts`.
  - [ ] **Edit** `src/cli/tests/pipeline-implement-folder.test.ts` — assert `pre_sha` non-empty.
  - [ ] **Edit** `src/cli/tests/pipeline-smoke-tmux-tester-folder.test.ts` — assert `plan_files_touched` in `test_render` and three-signal interpolation in `tmux_confirm_gate`.
  - [ ] No edit required to `src/attractor/tests/schemas.test.ts` (gate `inputs:` is already optional and tested).

## 7. Trade-offs

### 7.1 Agent-driven diff guard vs. handler-side override

A handler-side diff guard (inspect the working tree inside `LoopingAgentHandler.execute` and force `parsed.done = false` on empty diffs) was rejected:

- **Public-contract risk** — the verifier's MEDIUM caution. The `done` field's documented meaning is "the agent says the work is finished." Inverting that meaning from outside the agent breaks the README.md:65-117 deep-loop contract for *every* agent that uses the looping handler, not just `implement`. The blast radius silently grows from one pipeline to the whole handler.
- **False positives** — a refactor that produces no diff because the changes were already on disk from a prior crashed iteration is legitimate. Only the agent has the context to disambiguate.
- **Policy locality** — pipeline operators who want to tweak the no-op heuristic (e.g. allow no-op for doc-only plans) should edit a `.md` file, not a TypeScript handler.

The agent-driven check has one downside: a malicious or buggy agent can lie about `pre_sha`, and the handler will trust it. Mitigation: §9 open question 1 — an optional belt-and-braces handler-side cross-check that is purely additive (verifies `pre_sha` is a valid sha format), not authoritative.

### 7.2 Plan-coverage signal in tmux_tester vs. new node

A new dedicated `plan_coverage` node between `implement` and `review_gate` was rejected:

- The cost is the same regardless (one `git diff --name-only` pass); routing is simpler if the existing tester carries it.
- A new node would require routing changes to `pipeline.dot` (out of scope per the verifier's blast-radius pin: 4 spec edits + DOT). The current design keeps the DOT untouched.
- Operationally, plan coverage is "did the verification confirm the right files moved" — semantically a verification concern, not a separate phase.

### 7.3 Warnings cross-check in memory-writer vs. memory-reflector

Putting the substring scan in `memory-reflector` was rejected:

- Reflector runs *after* memory-writer commits and pushes. The Warnings need to be in the file the reflector reads, not in the reflector's runtime context — otherwise the next memory-mining pass that walks `.apparat/sessions/*.md` from cold disk misses the signal.
- The scan is cheap and grounded in already-injected context (`$tmux_tester.test_summary`). No reason to defer.

### 7.4 Atomic vs. staged

Staging would split this into "diff guard" + "plan coverage" + "gate render" + "Warnings" + "smoke" five-way. Reasons to ship together:

- The collusion only fails when *both* `implement` and `tmux_tester` lie at once. Closing one without the other still allows the other to mask.
- The gate render relies on inputs the prior steps emit; landing the gate without the producers leaves dangling `$undefined` interpolations.
- The smoke test's assertions hit all four pieces simultaneously; partial landings would leave the test unstable.

## 8. Constraints

- After the change:
  - `npx tsc --noEmit` passes.
  - `npx vitest run` passes — including the new smoke and the two scenario test edits.
  - `apparat pipeline validate .apparat/pipelines/illumination-to-implementation/pipeline.dot` exits 0; the `.md` frontmatter changes are absorbed by the existing schema (the gate's `inputs:` is optional and additive).
  - A real `apparat pipeline run` of `illumination-to-implementation` against a fixture plan that the implement agent declines to write produces `implement.done=false`, `implement.reason=no_diff_produced`, and the run loops back per `pipeline.dot:81` instead of advancing to `review_gate`.
  - On the happy path (implement actually writes), `implement.pre_sha` is populated and `tmux_tester.plan_files_touched` matches the count of plan-listed files in the diff.
- Repo-wide grep invariants post-merge:
  - `.apparat/pipelines/illumination-to-implementation/implement.md` contains `pre_sha` and `no_diff_produced`.
  - `.apparat/pipelines/illumination-to-implementation/tmux-tester.md` contains `plan_files_touched` and `implement.pre_sha`.
  - `.apparat/pipelines/illumination-to-implementation/tmux_confirm_gate.md` contains `$implement.done` and `$tmux_tester.plan_files_touched`.
  - `.apparat/pipelines/illumination-to-implementation/memory-writer.md` contains `## Warnings` and the no_op_substrings list.
  - `src/cli/tests/pipeline-smoke-implement-noop-folder.test.ts` exists.
- Behaviour invariants:
  - Loop-break check at `src/attractor/handlers/looping-agent-handler.ts:151` is byte-identical to today.
  - The handler does NOT inspect the working tree; the agent does.
  - `commit_push` is unchanged.
  - `test_result` semantics in `tmux_tester` are unchanged — green build + green tests on an unchanged tree still produces `test_result=pass`. The new orthogonal `plan_files_touched` signal does the disambiguating, not `test_result`.

## 9. Open questions

- **Should the handler also belt-and-braces verify `pre_sha` looks like a sha?** Today the handler trusts arbitrary strings. A minimal additive validator in `outputsToZod` could enforce `/^[0-9a-f]{40}$/` on fields named `pre_sha` — but that's a generic schema concern, not an `implement`-specific concern. Default: ship without the handler-side validator; revisit if a real run produces a malformed `pre_sha`. The smoke test exercises the happy-path shape.
- **Does this design need a new ADR?** ADR-0003 set the precedent for adding new tool nodes (`commit_push`) with strict I/O schemas. ADR-0012 locks validator rule signatures. This design adds new agent outputs and gate inputs but does not introduce a new validator rule or a new node kind. Default: no new ADR — the change fits inside the existing precedents. Surface to the implementing session if reviewer disagrees.
- **Does CONTEXT.md need a new term `plan_files_touched`?** The term is local to the `illumination-to-implementation` pipeline; it does not show up in CLI surface, daemon IPC, or other pipelines. Default: no — keep the term scoped to the pipeline frontmatter and `tmux_confirm_gate` body. Revisit if `plan_files_touched` becomes a cross-pipeline signal.
- **What about a plan that legitimately has zero file mentions (e.g. a chat-only plan)?** Today's plan convention always names files. If a future plan does not, `plan_files_touched=0` is ambiguous. Mitigation lives in `tmux_confirm_gate`: the operator sees the three signals together and decides. The pipeline does not have to disambiguate at the gate; the operator does.
- **Should the diff-guard substring set be configurable?** A future plan-template tweak could change the prose tmux-tester emits on a no-op. Default: ship the four-substring set inline in `memory-writer.md`; lift to a config file only if a third pipeline starts needing the same scan.

## 10. Verification approach

### 10.1 Static checks

- `npx tsc --noEmit` — clean.
- `apparat pipeline validate .apparat/pipelines/illumination-to-implementation/pipeline.dot` — exits 0 with no error-severity diagnostics.
- Grep `pre_sha` against `.apparat/pipelines/illumination-to-implementation/implement.md` — at least 3 mentions (frontmatter, Step 0c, Step N+1).
- Grep `plan_files_touched` against the four pipeline specs — appears in `tmux-tester.md`, `tmux_confirm_gate.md`; absent from `implement.md` and `memory-writer.md`.
- Grep `## Warnings` against `.apparat/pipelines/illumination-to-implementation/memory-writer.md` — exactly one occurrence (the new step).

### 10.2 Tests

- `npx vitest run src/cli/tests/pipeline-smoke-implement-noop-folder.test.ts` — new, passes.
- `npx vitest run src/cli/tests/pipeline-implement-folder.test.ts` — passes after `pre_sha` assertion edit.
- `npx vitest run src/cli/tests/pipeline-smoke-tmux-tester-folder.test.ts` — passes after `plan_files_touched` + gate-body assertion edits.
- `npx vitest run` — passes.

### 10.3 Smoke

- Stand up a fixture project with a plan that lists 4 paths. Configure the `implement` agent stub to do nothing. Run `apparat pipeline run .apparat/pipelines/illumination-to-implementation/pipeline.dot`. Expect: run loops at `implement` until the iteration cap or operator-driven Retry path triggers; `implement.done=false`, `implement.reason=no_diff_produced` visible in the trace.
- Same fixture, but the stub agent actually writes one of the four paths and commits. Run again. Expect: `implement.done=true` (real ship), `tmux_tester.plan_files_touched=1`, `tmux_confirm_gate` body shows all three signals, operator can Commit cleanly.
- A plan with zero file mentions (degenerate case). Run. Expect: `plan_files_touched=0`, `test_result=pass` (unchanged tree builds cleanly), gate renders all three signals; operator decides.

### 10.4 Negative cases

- Agent emits malformed `pre_sha` (e.g. an empty string). The handler's existing `evaluateAgentOutput` validates it as a string; the diff guard step in the agent body is responsible for not emitting empty strings. Expect: smoke test catches a regression here.
- `tmux_tester` is unable to read `plan_writer.plan_path` (file deleted between nodes). Expect: tester emits `plan_files_touched=0` with a `test_render` warning line; gate still shows three signals.
- `tmux_tester.test_summary` is empty. The Warnings substring scan emits no Warnings section — exactly the no-op-on-no-signal contract.
- The chat refinement path (`approval_gate → chat_session → ...`) skips `tmux_tester` entirely (the existing `review_gate -> memory_writer [label="Approve"]` path). Expect: `tmux_tester.test_result` is empty per memory-writer's existing handling at `memory-writer.md:128-141` (`empty, or any non-"fail" value`); no Warnings emitted; consume calls fire normally.

## 11. Summary

The `illumination-to-implementation` pipeline has two collusive success signals: `implement.done` is self-attested with no diff-presence check (`.apparat/pipelines/illumination-to-implementation/implement.md:9-12`, trusted by `src/attractor/handlers/looping-agent-handler.ts:151`), and `tmux_tester.test_result` rates project health on whatever tree exists, so an unchanged tree trivially passes. The downstream `tmux_confirm_gate` consumes only `tmux_tester.test_render` (`.apparat/pipelines/illumination-to-implementation/tmux_confirm_gate.md:1-9`), so a planning-only run walks straight to `commit_push`. Run `d9859ff1` (`.apparat/sessions/2026-05-07-pipeline-mission-control-fragmentation.md:46`) is the clean reproduction. This design adds three orthogonal disambiguating signals: `implement.pre_sha` + `implement.reason=no_diff_produced` (agent-driven diff guard, not handler-side, to preserve the deep-loop public contract), `tmux_tester.plan_files_touched` (orthogonal coverage signal sourced from `plan_writer.plan_path` and the `pre_sha`-anchored diff range), and a richer `tmux_confirm_gate` body that renders all three signals so the operator decides on independent evidence rather than one self-attested field. A new `## Warnings` section in `memory-writer.md` cross-checks `tmux_tester.test_summary` against a four-substring no-op set so memory-reflector reads the gap pre-distilled. Backfill smoke `src/cli/tests/pipeline-smoke-implement-noop-folder.test.ts` plus extensions to `pipeline-implement-folder.test.ts` and `pipeline-smoke-tmux-tester-folder.test.ts` exercise all three pieces simultaneously. Blast radius: M — 4 pipeline specs + 3 tests + README ripple + possibly one ADR. Surfaces crossed: pipeline spec, gate-render contract, memory-writer template, scenario tests, README. Breaking changes: none — output extensions are additive (`outputsToZod`), gate `inputs:` are optional (`src/attractor/core/schemas.ts:61`), and the loop-break check is byte-identical. The agent-driven diff guard explicitly rejects the handler-side override path that the verifier flagged as MEDIUM caution.
