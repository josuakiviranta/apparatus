---
date: 2026-04-19
status: archived
description: `chat_summarizer` emits `scope_changed=true` when a chat round materially changes scope, but no edge condition routes on it — the verifier is never re-run, leaving `$summary` and `$explanation` stale for the rest of the pipeline.
archived_at: 2026-04-20
reason: Archive
---

## Core Idea

`chat_summarizer` produces `scope_changed` (boolean) into pipeline context. Every downstream edge ignores it. The graph routes `chat_summarizer -> explainer -> approval_gate` identically whether scope changed or not. When `scope_changed=true` — defined in the pipeline as "new files in/out, new behavior, removed behavior" — the verifier's `$summary` and `$explanation` describe the *original* illumination, not the refined scope. Design_writer and plan_writer both receive these stale fields as authoritative verifier context.

The graph named the signal correctly but never drew the edge.

## Why It Matters

The verifier exists to do exactly the check that scope change demands: re-read the codebase, re-evaluate relevance and project-fit for the new scope. It is read-only, static, fast. Its `$explanation` is shown verbatim in `approval_gate` and consumed by `design_writer` ("Verifier explanation: $explanation") and `plan_writer` ("Refinements..."). If a chat round adds a new file to scope or removes a behavior, the verifier's "explanation" now describes a different illumination than the one being approved.

Concretely in `pipelines/illumination-to-implementation.dot`: after a scope-changing chat round, `approval_gate` shows the *original* verifier explanation alongside *new* refinement bullets that contradict it. The human approves. `design_writer` gets both signals and must reconcile them with no guidance. The resulting design doc may quietly inherit a stale project-fit verdict ("this already exists at src/X") for a scope that no longer matches the original claim.

The `the-agentic-loop-is-a-graph` meditation names the principle: "Writing the edges forces you to think about when each phase is done." `scope_changed` was named because someone thought about this. The edge was never written.

## Revised Implementation Steps

1. **Add a conditional re-verification edge in `illumination-to-implementation.dot`.** Replace the unconditional `chat_summarizer -> explainer` edge with two conditional edges:
   ```dot
   chat_summarizer -> verifier  [condition="scope_changed=true"]
   chat_summarizer -> explainer [condition="scope_changed=false"]
   ```
   The verifier already picks the illumination from `$illumination_path` in context (set by the first verifier run). It will re-read the same file and re-check against current code — now with the refined scope implied by the illumination content and the written chat-notes. Its outputs (`preferred_label`, `summary`, `explanation`) overwrite the stale values in context.

2. **Handle the re-verification `preferred_label=false` case.** After a chat round, a re-verify that returns `false` means the chat refined the scope *away from viability* — the illumination now fails project-fit or technical accuracy under its new shape. The existing `verifier -> remove_gate [condition="preferred_label=false"]` edge already handles this. No new routing needed; the false-path is already plumbed.

3. **Add `$scope_changed` display to `approval_gate` label.** After any chat round, the human should see whether scope changed. Add one line to the label:
   ```dot
   label="...Scope changed: $scope_changed\n\n..."
   ```
   This makes the signal human-visible at the decision point. Requires the `default-vars-whitelist` fix (see 2026-04-19T1200) OR adding `defaultScopeChanged` to `GateNodeSchema` as a stopgap.

4. **Update `verifier.md` procedure to accept context-seeded `$illumination_path`.** The verifier currently globs `$illuminations_dir/illuminations/*.md` and picks an open one. On re-entry after a chat round, `$illumination_path` is already set. Add a rule: "If `$illumination_path` is non-empty in the injected context, skip enumeration and verify that file directly — it has already been selected." This prevents re-verification from accidentally picking a different illumination.

5. **Test the false-path.** Write a smoke pipeline or unit scenario that exercises: `verifier(true) -> chat -> scope_changed=true -> verifier(false) -> remove_gate`. Confirm the pipeline routes to `mark_archived` (via `remove_gate -> Archive`) and does not reach `design_writer`. The re-verification false-path is the highest-risk new route; it needs at least one explicit test.
