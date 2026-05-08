# Chat round notes — 2026-05-08T23:45Z

## What the user raised
- Confusion about whether `.apparat/scenarios/` was being executed by the `tmux-tester` node: "These must to be related .apparat/scenarios that tmux-tester is running ?"
- Architectural redirect on how scenarios should be exercised: "there should not be bundled scenario tests and instead tmux-tester node should in illumination-to-implementation pipeline should read .apparat/scenarios and run those"
- On interactive scenarios (chat / gate / meditate-steer): "Agent should be able to play human in these scenario tests. Shouldn't it?"
- On self-recursion of `tmux-tester`: "Well remove tmux-tester from scenarios if that really is the same thing as tmux tester node"
- On pre-fixing `static-multi-node`: chose option (a) — rename the three sibling files now, before the new tmux-tester logic lands.
- On pinning hyphen/underscore convention in `CONTEXT.md` / `pipelines.md`: "Don't know" — left open.
- On adding a standalone `apparat scenarios verify` command: "No bundled scenario tests" — declined.

## Conclusions reached

- **Delete the 14 `src/cli/tests/pipeline-smoke-*-folder.test.ts` structural smoke tests.**
  - Came from: "there should not be bundled scenario tests" + "No bundled scenario tests".
  - Rationale: User considers structural file-existence + `validateGraph()` checks to be the wrong layer — they passed for `static-multi-node` while the scenario itself was unrunnable. Live execution is the only signal that matters.

- **`tmux-tester` node (in `illumination-to-implementation`) gains a phase that discovers `.apparat/scenarios/` at runtime and drives `apparat pipeline run` against each scenario inside its tmux window.** Failures feed the existing red/green TDD loop; passes are reported as part of `test_summary` / `test_render`.
  - Came from: "tmux-tester node should... read .apparat/scenarios and run those".
  - Rationale: Substitutes runtime verification for compile-time structural checks. The class of bug `static-multi-node` exhibits (agent slug mismatch) only surfaces when the pipeline actually executes.

- **The agent plays the human for interactive scenarios** (chat, gate, meditate-steer, etc.). It uses the existing `send_input` harness to answer prompts and pick gate choices, the same way it already drives the test window.
  - Came from: "Agent should be able to play human in these scenario tests. Shouldn't it?"
  - Rationale: User does not want a skiplist or an interactive-vs-non-interactive split. The test loop should be capable of full coverage by impersonating the user where needed.

- **Rename the three sibling files in `.apparat/scenarios/static-multi-node/` from `node-a.md` / `node-b.md` / `node-c.md` to `node_a.md` / `node_b.md` / `node_c.md` as part of this work** (verifier's option A, pre-applied).
  - Came from: "(a)" in answer to "rename now vs. let tmux-tester catch and fix it".
  - Rationale: User wants the scenario in a runnable state when the new tmux-tester logic lands, not relying on the loop to self-heal it on first run.

- **Drop the resolver-normalization (verifier's option B) and validator-diagnostic (verifier's option C) directions.**
  - Came from: combination of "(a)" + "tmux-tester node should... run those".
  - Rationale: With live runtime execution as the safety net, neither preflight diagnostics nor hyphen↔underscore tolerance in the resolver is needed — drift gets caught by an actual failed run.

- **`.apparat/scenarios/tmux-tester/` should be removed *if* it is functionally the same as `illumination-to-implementation/tmux-tester.md`.** A `diff -q` shows the two files currently differ; verify during implementation whether the divergence is meaningful or stale, and either consolidate or document why the duplicate must stay. Scanner inside `tmux-tester` must skip itself in any case to avoid recursion.
  - Came from: "Well remove tmux-tester from scenarios if that really is the same thing as tmux tester node".
  - Rationale: User flagged self-recursion risk and dislikes duplicate definitions; the conditional ("if that really is the same thing") explicitly invites verification first.

## Open questions

- Should the hyphen/underscore convention be pinned in `CONTEXT.md` / `pipelines.md`? — User said "Don't know"; deferred to design-writer / plan-writer to recommend a default and surface in the design doc for review at `review_gate`.
- Resolution for the `.apparat/scenarios/tmux-tester/` duplicate: kept-with-justification vs. deleted vs. merged — depends on diff inspection deferred to implementation phase.
