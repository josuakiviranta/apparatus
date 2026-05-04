# Chat Notes — 2026-04-19T1400-scope-changed-has-no-routing-consumer

## Summary of illumination

`chat_summarizer` produces `scope_changed` (boolean) into context, but no downstream edge reads it. The chat loop routes `chat_session -> chat_summarizer -> explainer` unconditionally (pipelines/illumination-to-implementation.dot:67). When a chat round materially changes scope (new/removed files or behavior), the verifier never re-runs. Result: `$summary` and `$explanation` — shown verbatim at `approval_gate` (line 26) and passed to `design_writer` as authoritative context (line 32) — describe the *original* illumination, not the refined scope. Approval gate can then display a stale verifier verdict beside fresh refinement bullets that contradict it.

## Scope of fix (agreed)

Pure pipeline-graph change plus minimum collateral edits. No new nodes, agents, or schemas.

1. **Replace line 67** with two conditional edges:
   - `chat_summarizer -> verifier  [condition="scope_changed=true"]`
   - `chat_summarizer -> explainer [condition="scope_changed=false"]`
2. **False-path**: existing `verifier -> remove_gate [condition="preferred_label=false"]` (line 52) and `remove_gate -> mark_archived` (line 58) already route re-verify failure to archive. No new edges needed.
3. **`approval_gate` label** (line 26): add `Scope changed: $scope_changed`. Depends on the default-vars-whitelist fix (2026-04-19T1200) OR a stopgap `defaultScopeChanged` on `GateNodeSchema`.
4. **`src/cli/agents/verifier.md`**: honor pre-seeded `$illumination_path` from context; skip the `$illuminations_dir/illuminations/*.md` enumeration on re-entry. Preserves illumination identity across re-verify.
5. **Smoke test**: exercise `verifier(true) -> chat -> scope_changed=true -> verifier(false) -> remove_gate -> mark_archived`. Confirm `design_writer` is never reached.

## Verifier verdict

Valid. All cited code exists as claimed: `chat_summarizer.produces="refinements, scope_changed"` (line 30), unconditional edge (line 67), gate embeds `$explanation` (line 26), `design_writer` embeds verifier explanation (line 32). Verifier `produces` already includes `preferred_label, summary, explanation` (line 10) — re-execution overwrites stale context cleanly. Conditional edge syntax matches pattern used at lines 52–54 and 79.

## Open questions / caveats

- Step 4's `verifier.md` edit (seeded `$illumination_path`) should be re-checked against current enumeration behavior when plan is written — directional intent sound, wording TBD.
- If default-vars-whitelist fix has not landed when this ships, step 3 needs the `defaultScopeChanged` stopgap, otherwise gate label will fail variable resolution.

## Decision

No scope changes. Proceed to design doc as summarized above.
