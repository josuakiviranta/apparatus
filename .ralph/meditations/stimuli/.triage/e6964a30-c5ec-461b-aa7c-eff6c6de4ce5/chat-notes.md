# Chat Notes — implement-retry-is-blind-to-tmux-test-output

## Agreed Approach: Separate `implement_retry` Node (Approach B)

The illumination's original proposal used `default_test_result=""` + `default_summary=""` attributes on the existing `implement` node plus a conditional "Prior test run" paragraph in the prompt (Approach A). We rejected this in favor of a **separate retry node** pattern, matching the convention already established in `../job-post-worker/pipelines/cover-letter.dot` (where `write` and `write_retry` are distinct nodes — the retry node explicitly consumes judge outputs as raw material).

### Why Approach B over Approach A

- **Matches existing project convention.** Cover-letter pipeline uses a dedicated retry node; no `default_` sentinels, no conditional prose inside prompts.
- **Cleaner prompts.** Each node's prompt is focused on one scenario. `implement` stays clean for first-pass TDD. `implement_retry` is unambiguous about its purpose (fix specific failures from prior test run).
- **No sentinel strings.** Approach A's empty-string `default_test_result=""` + conditional "Prior test run (if any)" paragraph produces awkward "Result: \n\n" blocks on first run; B avoids this entirely because the retry node is only reachable after tmux has produced real values.
- **No engine changes needed.** User initially asked about a `tmux_agent_iteration=<number>` context variable with conditional content. Rejected because the pipeline DSL has no numeric counter primitive and no logic-engine for shaping variable values — edges have `condition=`, producers don't. Approach B needs zero engine features.

### Why we rejected the iteration counter idea

User proposal: `tmux_agent_iteration=<number>` + `tmux_agent_test_results="<found issues if iteration>0 and not pass>"`.

Two blockers:
1. Pipeline DSL has no numeric counters or increment-on-edge-traversal primitive. Adding one is a much larger scope than this illumination.
2. Conditional content inside a variable value requires expression evaluation the engine doesn't have. Only edges support conditions today.

`$test_result` already acts as an implicit iteration signal — empty = first run, `"fail"` = post-tmux retry. No counter needed.

## Concrete Pipeline Changes

Edit target: `pipelines/illumination-to-implementation.dot`.

### Add new node

```dot
implement_retry [agent="implement",
                 prompt="Read the implementation plan at $plan_path.\n\nPrior test run failed:\nResult: $test_result\n$summary\n\nFix those specific failures first, then re-verify with the tmux harness.\n\nDo NOT push — a separate pipeline node handles that.\nDo NOT modify files outside the scope of the plan."]
```

### Edge changes

- **Retarget:** `tmux_confirm_gate -> implement [label="Retry"]` → `tmux_confirm_gate -> implement_retry [label="Retry"]`
- **Add:** `implement_retry -> launch_tmux` (re-enter tmux loop directly — human already saw tmux output at tmux_confirm_gate, no need to re-route through review_gate)

### Edges unchanged

- `implement -> implement [condition="agent.success=false"]` — engine self-retry, pre-tmux, no test data exists yet. Plain `implement` is correct.
- `implement -> review_gate` — normal post-implement flow.
- `review_gate -> implement [label="Retry"]` — pre-tmux retry path, no test data yet. Plain `implement` is correct.

### Total diff

+1 node (`implement_retry`), +2 edges (`implement_retry -> launch_tmux`, `mark_archived -> done`), 1 edge retargeted (`tmux_confirm_gate -> implement_retry`). One `.dot` file.

## Node Responsibility Clarifications

| Node | Role | Edits code? | Runs tests? |
|------|------|-------------|-------------|
| `implement` | Initial TDD implementation from plan | yes | yes (inline TDD) |
| `launch_tmux` | Opens tmux window (tool) | no | no |
| `tmux_tester` | Drives window, captures results | **no** | yes (build + test) |
| `implement_retry` | Fixes failures reported by tmux_tester | yes | yes (inline verify) |
| `commit_push` | Pushes branch (tool) | no | no |

`tmux_tester` is read-only — its prompt explicitly says "Only build and test. Do NOT git push. Do NOT run interactive commands." `implement_retry` is the node that edits code in response to failures.

## Multi-Iteration Behavior (3rd, 4th retry, N)

No numeric cap needed. Loop is human-gated at `tmux_confirm_gate`:

```
implement_retry → launch_tmux → tmux_tester → tmux_confirm_gate
      ↑                                               │
      └────────── Retry (user clicks) ────────────────┘
```

Each pass:
1. `tmux_tester` overwrites `$test_result` + `$summary` via its `produces` clause (fresh values every run).
2. Next `implement_retry` invocation reads the newest values.
3. User keeps clicking "Retry" until tests pass (clicks "Commit") or aborts.

The `max_retries=1` attribute on the engine self-loop (`implement -> implement [agent.success=false]`) is bounded. The human tmux loop is unbounded by design — that's the point of the human gate.

## Pipeline Structure Sanity Check

Reviewed the full pipeline. Considered simplification candidates:

- Merge `launch_tmux` into `tmux_tester` — rejected (tool vs agent, different failure modes).
- Merge `chat_session` + `chat_summarizer` — rejected (different agent types: `chat` interactive vs `implement` + json_schema).
- Merge `design_writer` + `plan_writer` — rejected (staged artifacts, each runs own reviewer skill loop).
- Skip `review_gate`, auto-route `implement → tmux` — rejected (loses user's choice to commit without testing or retry without testing).
- Approach A (default_ attrs on `implement`) — rejected per reasoning above.

**Conclusion: pipeline is near-minimal.** Each node has one agent type and one artifact. Can't compress further without sacrificing clarity or removing human control points. Approach B adds exactly one node to the smallest place that needs it.

## Bundled Bug Fix: `mark_archived` Dangling Edge

`mark_archived` node at line 18 has **no outgoing edge**. Tracing all edges at lines 54–93: `approval_gate -> mark_archived [label="Decline"]` exists, but no `mark_archived -> done` (or any other outgoing edge) exists. When a user clicks "Decline" at the approval gate, the pipeline would either hang or implicit-done depending on engine behavior.

**Bundled into this scope** (per user decision 2026-04-18): same file, one-line fix, zero overlap with retry logic. Not worth a separate triage roundtrip.

**Fix:** add edge `mark_archived -> done` to `pipelines/illumination-to-implementation.dot`.

Adjacent illumination `2026-04-19T0800-mark-archived-script-will-write-the-wrong-reason.md` covers a different concern (the reason-string content written by the script) and remains a separate ticket.

## Summary for Next Stage

- **Scope:** One `.dot` file edit. One new node (`implement_retry`), two new edges (`implement_retry -> launch_tmux`, `mark_archived -> done`), one retargeted edge (`tmux_confirm_gate -> implement_retry`).
- **No schema changes, no new scripts, no engine features.**
- **Rationale anchored in existing cover-letter precedent.**
- **Bundled bug fix:** `mark_archived -> done` edge added in same change (trivial, same file, zero overlap with retry logic).
