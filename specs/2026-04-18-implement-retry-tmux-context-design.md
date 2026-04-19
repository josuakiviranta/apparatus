# Implement-Retry Tmux Context Injection Design

**Date:** 2026-04-18
**Status:** Approved (scoped)
**Source illumination:** `meditations/illuminations/2026-04-19T1000-implement-retry-is-blind-to-tmux-test-output.md`

## Overview

The `illumination-to-implementation.dot` pipeline has a tmux-verified retry path. After `tmux_tester` runs `npm run build && npm test` and produces `test_result` + `summary`, a human-gated `tmux_confirm_gate` decides between committing and retrying. The Retry choice currently routes back to the `implement` node — whose prompt references only `$plan_path`. The machine-readable failure summary that the human just reviewed is live in the engine context but never reaches the agent. The agent restarts from the plan alone and must rediscover which tests failed by re-running the suite. When the rediscovered failure differs from the tmux-captured one (flaky order, environment differences, partial fix), the retry fixes the wrong thing.

The fix is a scoped `.dot` edit that adds a dedicated `implement_retry` node receiving `$test_result` and `$summary` in its prompt. The existing `implement` node remains unchanged for the first-pass path. The same `.dot` edit bundles a fix for a second defect surfaced during review: the `mark_archived` node has no outgoing edge and is therefore a dead end in the Decline branch of `approval_gate`.

No engine changes. No schema changes. No new scripts. One `.dot` file edit, verifiable by re-reading the file.

## What This Fixes

### Primary: blind retry after tmux failure

Observed state (`pipelines/illumination-to-implementation.dot`):

- Line 38: `implement [agent="implement", max_retries=1, retry_target="implement", prompt="Read the implementation plan at $plan_path. …"]` — prompt references only `$plan_path`.
- Line 44: `tmux_tester [... produces="test_result, summary", ...]` — these variables exist in engine context after tmux runs.
- Line 91: `tmux_confirm_gate -> implement [label="Retry"]` — routes post-tmux back into the plan-only prompt.
- Line 82: `implement -> implement [condition="agent.success=false"]` — engine self-retry that runs *before* tmux; at that point `$test_result` is still empty (no tmux run yet), so pre-tmux retry is correctly unaffected by this design.

After the change: the Retry edge from `tmux_confirm_gate` routes to a new node `implement_retry`, whose prompt contains `$test_result` and `$summary` interpolations. Post-tmux retries start from the tester's structured output instead of a plan re-read.

### Bundled: dangling `mark_archived` node

`mark_archived` (line 18) has no outgoing edge in the file. The Decline branch of `approval_gate` (line 68: `approval_gate -> mark_archived [label="Decline"]`) currently terminates without a declared successor. The fix adds `mark_archived -> done`.

Bundled into the same diff because:
- Both defects live in the same `.dot` file.
- Both are one-edge changes with no code impact.
- Splitting into two PRs would add process overhead with zero review benefit.

## What This Does NOT Do

- **No engine changes.** No new DSL, no new attributes, no variable interpolation semantics are added. Everything used (`$var` interpolation, `produces=`, `condition=`, `label=`) already exists.
- **No schema changes.** Neither `schemas/verifier.json`, `schemas/tmux-test-result.json`, nor any other schema is touched.
- **No new scripts.** `scripts/mark-dispatched.mjs` is the only script the pipeline calls; it is unchanged.
- **No change to the `implement` node's first-pass behavior.** On first run and on the pre-tmux engine self-retry, the path through `implement` is byte-for-byte identical to today.
- **No numeric iteration counter.** An earlier proposal to add a `tmux_agent_iteration` counter was rejected: the DSL has no integer vars and no expression evaluation inside variable values. Multi-iteration behavior is handled by the existing human-gated loop (`tmux_confirm_gate -> implement_retry -> launch_tmux -> tmux_tester -> tmux_confirm_gate`). `$test_result` stays populated on subsequent laps because `tmux_tester` re-produces it every time.

## Architecture

### Node addition: `implement_retry`

A new node parallel to `implement`, differing in three ways:

1. Its prompt references `$test_result` and `$summary` in addition to `$plan_path`.
2. It has no `retry_target` / `max_retries` self-loop. The retry semantics belong to the human gate, not the engine. If the agent fails inside `implement_retry`, that failure surfaces to `review_gate` for human decision — same surface the first-pass `implement` would reach.
3. It is the only successor of the Retry edge from `tmux_confirm_gate`.

Declaration shape:

```dot
implement_retry [agent="implement",
                 prompt="Read the implementation plan at $plan_path.\n\nThe previous implementation attempt was tested in a tmux window. Prior run result: $test_result\n\nPrior test summary:\n$summary\n\nPrioritize fixing the specific failures reported above. Implement using red/green TDD:\n1. Inspect the failing tests or build errors cited in the summary\n2. Write or update tests that reproduce the specific failure\n3. Implement the fix to make those tests pass\n4. Commit after each passing chunk\n\nDo NOT push — a separate pipeline node handles that.\nDo NOT modify files outside the scope of the plan."]
```

Two properties worth noting:

- **No `default_` attributes.** The node is only ever reached from `tmux_confirm_gate`, which can only be reached from `tmux_tester`, which always `produces` both variables. The variables are therefore guaranteed to be defined when `implement_retry` runs. Adding `default_test_result=""` would be defensive without cause.
- **`agent="implement"`.** Same agent as the first-pass node. Only the prompt differs. No new agent type is introduced.

### Edge changes

Three edge-level changes:

| # | Change | Before | After |
|---|---|---|---|
| 1 | Retarget Retry edge | `tmux_confirm_gate -> implement [label="Retry"]` | `tmux_confirm_gate -> implement_retry [label="Retry"]` |
| 2 | Add retry-loop continuation | (none) | `implement_retry -> review_gate` |
| 3 | Fix dangling Decline branch | `mark_archived` has no outgoing edge | `mark_archived -> done` |

Edge change #2 (`implement_retry -> review_gate`) routes the retry node's output back into the same gate `implement` feeds (line 83: `implement -> review_gate`). This preserves the existing human-review surface: reviewer sees the retry's commit, chooses Approve / Tmux / Retry again. The gate labels and downstream routing do not change.

Edge change #3 closes the Decline branch so the graph has no unreachable-from-exit nodes. This is independent of the primary fix but matches the same patching scope.

### What the `implement` node is NOT used for after this change

After the change, `implement` (line 38) runs only:

1. The first-pass implementation after `mark_dispatched -> implement`.
2. The engine self-retry `implement -> implement [condition="agent.success=false"]` (no tmux output to inject — correct to leave empty).
3. The pre-tmux `review_gate -> implement [label="Retry"]` human choice (also pre-tmux, no `$test_result` yet).

All three are pre-tmux paths. `implement_retry` handles the one post-tmux path. The split mirrors the existing `cover-letter`-style convention used elsewhere in the project: when a node's prompt must change based on upstream structured output, duplicate the node rather than conditionally branching prompt text.

## Components

### 1. The `implement_retry` node declaration

Placed adjacent to the existing `implement` node declaration (around line 38-39), under the Phase-2 comment header, to keep the file's reading order intact.

Exact attributes (matching the table above):

- `agent="implement"` — reuses the existing agent type.
- `prompt="..."` — includes `$plan_path`, `$test_result`, `$summary` interpolations, instructs the agent to prioritize the tester's reported failures, forbids `git push` and out-of-scope file edits (same guardrails as `implement`).
- No `max_retries`, no `retry_target`, no `default_*` — explicitly omitted for the reasons given in "Architecture → Node addition".

### 2. Three edge edits

In the Phase-2 routing block (lines 79-93):

- Change `tmux_confirm_gate -> implement [label="Retry"]` to `tmux_confirm_gate -> implement_retry [label="Retry"]` (line 91).
- Add `implement_retry -> review_gate` after the existing `implement -> review_gate` edge (after line 83).

In the Phase-1 routing block (lines 60-65):

- Add `mark_archived -> done` after the existing Decline edge (after line 68).

### 3. Validation after the edit

After the `.dot` edit, a human reading the file must be able to confirm, without running the pipeline:

- Grep for `implement_retry` returns three hits: the node declaration, the retargeted Retry edge source, and the `implement_retry -> review_gate` edge.
- Grep for `implement -> ` (with trailing space) still returns the first-pass and engine-self-retry edges; the Retry edge from `tmux_confirm_gate` no longer points at `implement`.
- Grep for `mark_archived -> ` returns one hit pointing at `done`.
- `ralph pipeline validate pipelines/illumination-to-implementation.dot` succeeds. (This uses the existing validator — no changes to validator code are needed.)

## Data Flow

### Phase 2 routing (annotated)

```
mark_dispatched
       │
       ▼
  implement ──── (agent.success=false) ──┐
       │                                 │
       │  success                        └──> implement (engine self-retry, no tmux output yet)
       ▼
  review_gate
    │
    ├── Approve ──> commit_push ──> memory_writer ──> done
    ├── Retry   ──> implement    (pre-tmux human retry — no tmux output yet)
    └── Tmux    ──> launch_tmux ──> tmux_tester ──> tmux_confirm_gate
                                                         │
                                                         ├── Commit ──> commit_push ──> memory_writer ──> done
                                                         │
                                                         └── Retry  ──> implement_retry
                                                                              │
                                                                              ▼
                                                                         review_gate   (loop re-enters the gate)
```

### Variable visibility at each entry into the agent

| Entry point | `$plan_path` | `$test_result` | `$summary` |
|---|:---:|:---:|:---:|
| First-pass `implement` (from `mark_dispatched`) | ✅ | empty | empty |
| Engine self-retry `implement` (`agent.success=false`) | ✅ | empty | empty |
| Pre-tmux human retry `implement` (from `review_gate` Retry) | ✅ | empty | empty |
| `implement_retry` (from `tmux_confirm_gate` Retry) | ✅ | ✅ | ✅ |

The existing prompt on `implement` does not interpolate the empty columns, so those paths are unchanged. `implement_retry` is the only node that interpolates `$test_result` / `$summary`, and it is only reachable after `tmux_tester` produces them.

### Phase 1 Decline branch (corrected)

```
approval_gate
    │
    └── Decline ──> mark_archived ──> done
```

## Constraints

- **Single file edited.** Only `pipelines/illumination-to-implementation.dot` changes.
- **No engine / validator / schema code modified.** The change is data-layer only.
- **No new variables introduced.** `$test_result` and `$summary` already exist as products of `tmux_tester`.
- **`implement` first-pass behavior must be byte-identical.** Attribute order, prompt text, and `max_retries` / `retry_target` values on line 38 are not touched. Reviewers should confirm via `git diff` that the `implement` line is unchanged.
- **`implement_retry` must not carry a retry_target.** The human gate is the retry controller; adding engine retry on top would cause compounded re-execution that the author-contract does not describe.
- **No push from `implement_retry`.** Same rule as `implement`. `commit_push` remains the only push site.
- **Gate.** `npm run build && npm test` green and `ralph pipeline validate pipelines/illumination-to-implementation.dot` succeeds before handoff.

## What This Excludes

- **Refactoring `implement` to share prompt fragments with `implement_retry`.** The DSL has no include mechanism. Duplicating the shared preamble in the prompt string is intentional; a later prompt-templating feature is out of scope.
- **Adding `default_test_result=""` / `default_summary=""` on `implement` itself.** The original illumination proposed this (Approach A). It was rejected because the only post-tmux re-entry now goes through `implement_retry`, and the first-pass / pre-tmux paths never reference those variables.
- **Adding a `tmux_agent_iteration` counter.** The DSL lacks numeric counters and expression evaluation in variable values. Multi-iteration behavior is handled by the human-gated loop.
- **Changing `tmux_confirm_gate`'s label or question.** The gate's prompt already surfaces `$test_result` and `$summary` to the human; no human-facing text changes.
- **Changing `review_gate`'s successors.** The pre-tmux `review_gate -> implement [Retry]` edge stays pointed at `implement`. The retry-vs-retry distinction lives at `tmux_confirm_gate`, not at `review_gate`.
- **Updating `pipelines/illumination-to-implementation.dot`'s `goal=` or `inputs=`.** Contract is unchanged.
- **Any change to the dangling-edge validator.** A separate illumination (`2026-04-19T1200-pipeline-validate-misses-non-exit-dead-end-nodes.md`) covers the validator work that would have caught `mark_archived`'s dangling state at authoring time. This spec fixes the instance; the validator fix is its own ticket.
