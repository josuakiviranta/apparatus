---
date: 2026-04-18
status: open
description: When tmux_confirm_gate routes "Retry" back to the implement node, the agent receives only $plan_path — $test_result and $summary produced by tmux_tester are in the engine context but absent from the implement prompt, so the agent must rediscover failures from scratch.
---

## Core Idea

The `implement` node in `illumination-to-implementation.dot` has a retry path: `tmux_confirm_gate -> implement [label="Retry"]`. The `tmux_tester` node runs `npm run build && npm test`, captures results, and produces `test_result` and `summary` into pipeline context. When the human chooses "Retry" at `tmux_confirm_gate`, those variables are live in the engine context — but the `implement` node's prompt references only `$plan_path`. The agent has no access to the structured failure summary the tmux harness just captured. It restarts from the plan file alone.

## Why It Matters

The tmux path (`review_gate -> launch_tmux -> tmux_tester -> tmux_confirm_gate`) exists specifically to produce verified, machine-readable test results before a human decision. The `tmux_tester` agent reads the harness output and extracts a `summary` (e.g., "3 test files failed: pipeline-preflight.test.ts (2 failures), pipeline.test.ts (1 failure)"). That summary is the most precise failure description available — more targeted than anything the implement agent would discover by re-running tests on its own.

When the retry goes back to `implement`, the agent reads the plan, sets up a new session, and eventually runs `npm test` again to discover what's broken. It may fix the correct thing, or it may fix a different issue and miss the one that failed the first time. The tmux_tester's `summary` — which the human already reviewed and judged worth a retry — is lost.

The `implement` node declaration is:
```dot
implement [agent="implement", max_retries=1, retry_target="implement", prompt="Read the implementation plan at $plan_path.\n\nImplement the plan using red/green TDD:\n1. Read the plan carefully\n2. For each chunk: write failing tests first, then implement to make them pass\n3. Commit after each passing chunk\n\nDo NOT push — a separate pipeline node handles that.\nDo NOT modify files outside the scope of the plan."]
```

No `default_test_result`, no `$summary` reference. On first run this is correct — there are no test results yet. On retry it is a blind restart.

## Revised Implementation Steps

1. **Add `default_test_result=""` and `default_summary=""` to the `implement` node declaration** in `pipelines/illumination-to-implementation.dot`. These attributes ensure the variables are defined (as empty strings) on first invocation, so the prompt can reference them without the engine raising an undeclared-variable warning.

2. **Append a conditional paragraph to the `implement` node's prompt.** After the three TDD steps, add:

   ```
   \n\nPrior test run (if any):\nResult: $test_result\n$summary\n\nIf a prior run result is present above, prioritize fixing those specific failures before re-running the full suite.
   ```

   On first run, `$test_result` and `$summary` expand to empty strings, producing a harmless "Result: \n\n" block the agent will skip. On retry, they expand to the tmux_tester's structured output, directing the agent to the exact failing nodes.

3. **Verify no double-injection occurs for the engine's own retry loop.** The `implement -> implement [condition="agent.success=false"]` self-loop is the engine retry, triggered before tmux runs. At that point `$test_result` is still empty — no tmux output has been captured yet. The conditional paragraph will be inert. Only the human-triggered `tmux_confirm_gate -> implement [Retry]` path runs after tmux, so the injection is naturally scoped to the post-tmux case.

4. **No new node needed.** The fix is two `default_` attributes and four lines added to the existing prompt string — a single `dot` file edit. Verify by reading the updated node back and confirming `$test_result` and `$summary` appear in the prompt text. No new schema, no new script, no new edge.
