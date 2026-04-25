---
status: pending
---

# Implement-Retry Tmux Context Injection Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Inject `$test_result` and `$summary` into a dedicated `implement_retry` node so post-tmux retries start from the tester's structured failure output instead of a plan re-read, and close the dangling Decline branch on `mark_archived`.

**Architecture:** Data-layer-only edit of `pipelines/illumination-to-implementation.dot`. Add one new node (`implement_retry`) parallel to the existing `implement` node, retarget the Retry edge from `tmux_confirm_gate`, add a `review_gate` successor for `implement_retry`, and add the missing `mark_archived -> done` edge. No engine, validator, schema, or script code is touched. The existing `implement` node is byte-identical afterward.

**Tech Stack:** Graphviz DOT (attractor pipeline DSL), `ralph pipeline validate <dotfile>` (CLI validator already wired at `src/cli/program.ts:187`), `npm run build && npm test` (vitest).

**Design doc:** [`specs/2026-04-18-implement-retry-tmux-context-design.md`](../../../specs/2026-04-18-implement-retry-tmux-context-design.md)

---

## Chunk 1: Edit `illumination-to-implementation.dot`

The entire change is one file. It is decomposed into five ordered edits plus baseline + final verification. Each edit is an independently greppable step so the executor can pause between steps and confirm state.

**Files:**
- Modify: `pipelines/illumination-to-implementation.dot`

**Preconditions (read-only, no edits yet):**

- [ ] **Step 1: Baseline — read the current file and confirm observed state**

Run:

```bash
cat pipelines/illumination-to-implementation.dot
```

Confirm (do NOT modify the file yet):

- Line 18 is the current `mark_archived [agent="implement", prompt="..."]` declaration (no outgoing edge declared anywhere in the file).
- Line 38 is the current `implement [agent="implement", max_retries=1, retry_target="implement", prompt="Read the implementation plan at $plan_path.\n\nImplement the plan using red/green TDD:\n1. Read the plan carefully\n2. For each chunk: write failing tests first, then implement to make them pass\n3. Commit after each passing chunk\n\nDo NOT push — a separate pipeline node handles that.\nDo NOT modify files outside the scope of the plan."]` declaration.
- Line 68 is `approval_gate -> mark_archived  [label="Decline"]`.
- Line 91 is `tmux_confirm_gate -> implement   [label="Retry"]`.

If any of the four lines above does not match verbatim, STOP — the file has drifted from the design-doc reference and the rest of this plan will insert at the wrong location. Re-read the design doc and locate equivalent anchors before continuing.

- [ ] **Step 2: Baseline validator run (confirm file parses today)**

Run:

```bash
./dist/cli/index.js pipeline validate pipelines/illumination-to-implementation.dot || npm run build && ./dist/cli/index.js pipeline validate pipelines/illumination-to-implementation.dot
```

Expected: validator exits 0 (the current validator does not catch the dangling `mark_archived` — that check is tracked separately in `meditations/illuminations/2026-04-19T1200-pipeline-validate-misses-non-exit-dead-end-nodes.md`, explicitly out of scope here).

If the validator exits non-zero for unrelated reasons, investigate before proceeding. A pre-existing failure means this plan's "validator passes after edit" gate is meaningless.

- [ ] **Step 3: Baseline test run**

Run:

```bash
npm run build && npm test
```

Expected: PASS (all vitest suites green). Capture the PASS/FAIL summary so it can be compared to the post-edit run. A broken baseline blocks the "no regressions introduced" claim.

---

**Edits (sequential, preserve exact attribute quoting and `\n` escapes):**

- [ ] **Step 4: Insert the `implement_retry` node declaration after line 38**

Use the Edit tool with `old_string` set to the existing `implement` node line and `new_string` set to the same line followed by the `implement_retry` declaration on a new line. Exact old/new pair:

`old_string`:

```
  implement [agent="implement", max_retries=1, retry_target="implement", prompt="Read the implementation plan at $plan_path.\n\nImplement the plan using red/green TDD:\n1. Read the plan carefully\n2. For each chunk: write failing tests first, then implement to make them pass\n3. Commit after each passing chunk\n\nDo NOT push — a separate pipeline node handles that.\nDo NOT modify files outside the scope of the plan."]
```

`new_string`:

```
  implement [agent="implement", max_retries=1, retry_target="implement", prompt="Read the implementation plan at $plan_path.\n\nImplement the plan using red/green TDD:\n1. Read the plan carefully\n2. For each chunk: write failing tests first, then implement to make them pass\n3. Commit after each passing chunk\n\nDo NOT push — a separate pipeline node handles that.\nDo NOT modify files outside the scope of the plan."]

  implement_retry [agent="implement", prompt="Read the implementation plan at $plan_path.\n\nThe previous implementation attempt was tested in a tmux window. Prior run result: $test_result\n\nPrior test summary:\n$summary\n\nPrioritize fixing the specific failures reported above. Implement using red/green TDD:\n1. Inspect the failing tests or build errors cited in the summary\n2. Write or update tests that reproduce the specific failure\n3. Implement the fix to make those tests pass\n4. Commit after each passing chunk\n\nDo NOT push — a separate pipeline node handles that.\nDo NOT modify files outside the scope of the plan."]
```

Notes for the editor:
- The `implement` line itself is UNCHANGED. Reviewers should see zero diff on that exact line.
- `implement_retry` carries `agent="implement"` (same agent type, different prompt) and intentionally has NO `max_retries` / `retry_target` / `default_*` attributes — see design §"Architecture → Node addition" for the rationale (human gate is the retry controller; variables are guaranteed non-empty on every entry).
- The blank line between the two declarations matches the file's existing vertical rhythm around other node declarations (e.g., lines 18–20, 28–30).

- [ ] **Step 5: Verify the node was inserted**

Run:

```bash
grep -n 'implement_retry' pipelines/illumination-to-implementation.dot
```

Expected: exactly ONE match at this point — the node declaration line. (Edges referencing `implement_retry` are added in later steps.)

- [ ] **Step 6: Retarget the Retry edge from `tmux_confirm_gate`**

Use the Edit tool on the routing block.

`old_string`:

```
  tmux_confirm_gate -> implement   [label="Retry"]
```

`new_string`:

```
  tmux_confirm_gate -> implement_retry [label="Retry"]
```

Notes:
- Preserve the surrounding two-space indentation that other edges in this block use.
- The single-space separator after the target name (`implement_retry [label=...`) is intentional — the widened target name absorbs the alignment padding used for the shorter `implement` target.

- [ ] **Step 7: Verify the retarget**

Run:

```bash
grep -n 'tmux_confirm_gate ->' pipelines/illumination-to-implementation.dot
```

Expected output (order may vary):

```
90:  tmux_confirm_gate -> commit_push [label="Commit"]
91:  tmux_confirm_gate -> implement_retry [label="Retry"]
```

The `implement_retry` target must appear on the Retry edge. If a line still reads `tmux_confirm_gate -> implement   [label="Retry"]`, the edit missed and must be re-applied before continuing.

- [ ] **Step 8: Add `implement_retry -> review_gate` edge**

Use the Edit tool to insert the new edge immediately after the existing `implement -> review_gate` edge (the line is `  implement -> review_gate` at roughly line 83).

`old_string`:

```
  implement -> implement           [condition="agent.success=false"]
  implement -> review_gate
```

`new_string`:

```
  implement -> implement           [condition="agent.success=false"]
  implement -> review_gate
  implement_retry -> review_gate
```

Notes:
- Both edges share the same target (`review_gate`) by design — the retry's output must re-enter the same human-review surface, preserving Approve / Tmux / Retry options downstream.
- Do NOT align-pad the new line; the existing `implement -> review_gate` edge has no padding, so the parallel declaration matches it.

- [ ] **Step 9: Verify the new edge**

Run:

```bash
grep -n 'implement_retry' pipelines/illumination-to-implementation.dot
```

Expected: exactly THREE matches — the node declaration, the retargeted Retry edge, and the new `implement_retry -> review_gate` edge.

```
<line>:  implement_retry [agent="implement", prompt="..."]
<line>:  tmux_confirm_gate -> implement_retry [label="Retry"]
<line>:  implement_retry -> review_gate
```

- [ ] **Step 10: Add `mark_archived -> done` edge**

Use the Edit tool to close the dangling Decline branch. Insert the new edge immediately after the block of chat/loop and plan-writing edges, alongside the other Phase-1 terminators.

`old_string`:

```
  // Chat loop
  chat_session -> chat_summarizer -> approval_gate
```

`new_string`:

```
  // Chat loop
  chat_session -> chat_summarizer -> approval_gate

  // Decline branch terminator
  mark_archived -> done
```

Notes:
- Placed in the Phase-1 routing block so it lives next to the other `approval_gate -> mark_archived [label="Decline"]` edge it completes.
- The short comment documents why a one-edge stanza exists on its own — future readers will look for a terminator for the Decline branch and find it here.

- [ ] **Step 11: Verify the Decline terminator**

Run:

```bash
grep -n 'mark_archived' pipelines/illumination-to-implementation.dot
```

Expected: exactly THREE matches — the node declaration, the inbound Decline edge, and the new outbound edge to `done`.

```
<line>:  mark_archived [agent="implement", prompt="..."]
<line>:  approval_gate -> mark_archived  [label="Decline"]
<line>:  mark_archived -> done
```

- [ ] **Step 12: Verify the `implement` node was not mutated**

Run:

```bash
grep -n '^  implement \[' pipelines/illumination-to-implementation.dot
```

Expected: exactly ONE match, and the line contents must be byte-identical to the baseline recorded in Step 1:

```
  implement [agent="implement", max_retries=1, retry_target="implement", prompt="Read the implementation plan at $plan_path.\n\nImplement the plan using red/green TDD:\n1. Read the plan carefully\n2. For each chunk: write failing tests first, then implement to make them pass\n3. Commit after each passing chunk\n\nDo NOT push — a separate pipeline node handles that.\nDo NOT modify files outside the scope of the plan."]
```

Any deviation here violates the design's "byte-identical `implement`" constraint — revert the accidental edit.

Also run:

```bash
grep -n 'implement -> ' pipelines/illumination-to-implementation.dot
```

Expected: exactly THREE matches — the engine self-retry, the forward edge to `review_gate`, and the pre-tmux human retry from `review_gate`:

```
<line>:  implement -> implement           [condition="agent.success=false"]
<line>:  implement -> review_gate
<line>:  review_gate -> implement         [label="Retry"]
```

No `tmux_confirm_gate -> implement` line should remain.

---

**Post-edit verification:**

- [ ] **Step 13: Re-run the pipeline validator**

Run:

```bash
npm run build && ./dist/cli/index.js pipeline validate pipelines/illumination-to-implementation.dot
```

Expected: exit 0. A validator failure at this stage means either (a) a syntax error crept in (unbalanced brackets, missing quote, stray backslash in the prompt string), or (b) a reachability check now fires on an unrelated node. In either case, diff against the baseline in Step 1 before making further edits.

- [ ] **Step 14: Run the full test suite**

Run:

```bash
npm run build && npm test
```

Expected: PASS — same pass/fail profile as the Step 3 baseline. No suites that were green before should be red now. If a vitest suite references the pipeline file (e.g. a smoke test that loads the DOT), confirm the new node count and edge count are still valid in its assertions; update the suite alongside this edit if so.

- [ ] **Step 15: Visual / diff sanity check**

Run:

```bash
git diff --stat pipelines/illumination-to-implementation.dot
git diff pipelines/illumination-to-implementation.dot
```

Expected: only `pipelines/illumination-to-implementation.dot` shows in `--stat` (one file, roughly +5 / –1 lines accounting for the new node declaration, the two new edges, the one retarget, and the one-line comment). The full diff should show:
- One added node block `implement_retry [agent="implement", prompt="..."]`.
- One changed edge line (`tmux_confirm_gate -> implement_retry [label="Retry"]` replaces `tmux_confirm_gate -> implement   [label="Retry"]`).
- One added edge `implement_retry -> review_gate`.
- One added comment + edge pair for `mark_archived -> done`.

No other lines should appear in the diff. If they do, investigate accidental whitespace churn before committing.

- [ ] **Step 16: Commit**

```bash
git add pipelines/illumination-to-implementation.dot
git commit -m "fix(pipeline): inject tmux test context into implement_retry and close mark_archived dead end

Add implement_retry node whose prompt references \$test_result and
\$summary, and retarget the tmux_confirm_gate Retry edge at it so
post-tmux retries start from the tester's structured failure output
instead of a plan re-read. The first-pass implement node is unchanged.

Bundle a one-line fix for the dangling mark_archived node: add
mark_archived -> done so the approval_gate Decline branch has a
declared terminator.

Spec: specs/2026-04-18-implement-retry-tmux-context-design.md
Illumination: meditations/illuminations/2026-04-19T1000-implement-retry-is-blind-to-tmux-test-output.md"
```

No `--no-verify`. If a pre-commit hook fails, diagnose and re-commit.

---

## Completion gate

Before handing off, the executor confirms ALL of the following:

- `grep -n 'implement_retry' pipelines/illumination-to-implementation.dot` returns exactly three hits (node, retargeted Retry edge, edge to `review_gate`).
- `grep -n 'mark_archived' pipelines/illumination-to-implementation.dot` returns exactly three hits (node, inbound Decline edge, outbound edge to `done`).
- `grep -n 'implement -> ' pipelines/illumination-to-implementation.dot` returns exactly three hits, none of them sourced from `tmux_confirm_gate`.
- The `implement` node declaration line is byte-identical to the baseline in Step 1.
- `./dist/cli/index.js pipeline validate pipelines/illumination-to-implementation.dot` exits 0.
- `npm run build && npm test` is green with the same pass profile as the Step 3 baseline.
- The commit exists on the current branch with the message shown above.

Any "no" answer blocks handoff — fix the underlying issue, do not paper over it with a follow-up commit that amends history.
