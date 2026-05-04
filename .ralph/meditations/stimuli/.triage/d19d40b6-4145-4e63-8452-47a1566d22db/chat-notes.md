# Chat notes — d19d40b6-4145-4e63-8452-47a1566d22db

## Round 1 (2026-04-20)

### User raised: chat_summarizer agent mismatch

- User observation: node `chat_summarizer` in `pipelines/illumination-to-implementation.dot` line 30 is declared with `agent="implement"`, not its own dedicated agent file like the other refactored nodes (`verifier`, `design_writer`, `plan_writer`, `change-explainer`, etc).
- Verified against working tree:
  - Node decl: `chat_summarizer [agent="implement", default_refinements="", json_schema_file="schemas/chat-summarizer.json", produces="refinements, scope_changed", prompt="..."]`
  - Agent files present in `src/cli/agents/`: `chat-refiner.md`, `change-explainer.md`, `design-writer.md`, `memory-writer.md`, `plan-writer.md`, `verifier.md`, `tmux-tester.md`.
  - **No `chat-summarizer.md` exists.** `chat-refiner.md` exists but wired to `chat_session` node (line 28: `chat_session [agent="chat-refiner", ...]`), NOT to `chat_summarizer`.
- Rationale (user): other refactored nodes were each given a purpose-built agent markdown so prompt/tools/procedure stay colocated and auditable. Leaving `chat_summarizer` on `implement` breaks convention.

## Round 1b — rigorous verification of illumination + verifier claims

### Method
Compared verifier summary + explainer_render + illumination against `git show HEAD:pipelines/illumination-to-implementation.dot` AND the current working tree (uncommitted diff).

### Ground truth

**HEAD (commit `a50b032`, 70 lines):**
- `inputs="project, meditations_dir, specs_dir, plans_dir"` (old name)
- 20 nodes. Almost all agents: `agent="implement"` (verifier, explain_removal, mark_archived, explainer, chat_session, chat_summarizer, design_writer, plan_writer, implement, implement_retry, memory_writer).
- Includes `explain_removal`, `delete_file`, `implement_retry`, `launch_tmux`, `commit_push` nodes (removed in WIP).
- `chat_summarizer` produces `refinements, scope_changed, chat_notes_path` (three keys).
- Routing: `chat_session -> chat_summarizer -> approval_gate` (UNCONDITIONAL — scope_changed is a dead-end producer here too, but the edge is a single linear `-> approval_gate`, NOT `-> explainer`).
- No conditional edges on `chat_summarizer` at all.

**Working tree (uncommitted, 94 lines):**
- `inputs="project, illuminations_dir, specs_dir, plans_dir"` (renamed).
- 17 nodes. Dedicated agents: verifier→verifier, explainer→change-explainer, design_writer→design-writer, plan_writer→plan-writer, chat_session→chat-refiner, memory_writer→memory-writer. `mark_archived` converted to `type="tool"` script. Dropped: `explain_removal`, `delete_file`, `implement_retry`, `launch_tmux`, `commit_push`.
- `chat_summarizer` STILL `agent="implement"` (the odd one out — all other agent-type nodes were refactored).
- `chat_summarizer` produces `refinements, scope_changed` (two keys — dropped `chat_notes_path`).
- Routing: `chat_session -> chat_summarizer`, then conditional `chat_summarizer -> verifier [condition="scope_changed=true"]` and `chat_summarizer -> explainer [condition="scope_changed=false"]`. Steps 1–2 of illumination ALREADY PRESENT.

### Claim-by-claim audit

| Claim | Source | True? | Notes |
|---|---|---|---|
| "chat_summarizer produces `scope_changed`" | summary/explainer | ✅ | HEAD + WT both declare it. |
| "HEAD-committed routing: `chat_summarizer -> explainer` is unconditional" | summary + explainer | ❌ **FALSE in HEAD.** HEAD routing is `chat_summarizer -> approval_gate`. Explainer text mis-identifies HEAD. | In WT the unconditional edge was already replaced by two conditionals. Illumination was written against an intermediate state that never existed in HEAD. |
| "scope_changed has no consumer" (core claim) | summary | ✅ (spirit) | In HEAD, scope_changed is declared but unread. In WT, already has a consumer via the new conditional edge. So the bug described IS real in HEAD, but the fix was partially already done in WT before the illumination was written. |
| "verifier → remove_gate [preferred_label=false] edge already exists" | explainer | ✅ | Present in WT (line 52). NOT present in HEAD — HEAD has `verifier -> explain_removal [preferred_label=false]`. |
| "Fix is ~2 lines of DOT" | explainer | ⚠️ misleading | Steps 1–2 (conditional edges) ARE already in WT uncommitted. What the illumination proposes as "new" is partly done. |
| "steps 3 (gate label with $scope_changed), 4 (verifier re-entry rule), 5 (false-path test) are the remaining deltas" | explainer | ✅ | approval_gate label (WT line 26) does NOT include `$scope_changed`. `src/cli/agents/verifier.md` exists and Procedure §1 would need the re-entry rule check. No smoke test for the false-path yet. |
| "chat_summarizer uses its own agent" (user's new claim this round) | user | ❌ current state: NO, still `agent="implement"` in both HEAD and WT. | This is a 6th delta the illumination missed. |
| "WIP reconciliation: working tree contains steps 1–2" | explainer | ✅ | Confirmed via `git diff HEAD`. |
| "verifier agent swap (implement → verifier) is WIP" | explainer | ✅ | HEAD = `agent="implement"`, WT = `agent="verifier"`. Uncommitted. |
| "inputs rename meditations_dir → illuminations_dir is WIP" | explainer | ✅ | Confirmed. |

### Net assessment

1. **Illumination's core bug is real but mis-located.** "scope_changed has no consumer" is TRUE in HEAD (committed) where the edge is `-> approval_gate`, not `-> explainer` as the explainer claims. In the WT, the fix is already half-done.
2. **Explainer's "Currently implemented" section is factually wrong** about HEAD — says HEAD has `chat_summarizer -> explainer` unconditional; HEAD actually has `chat_summarizer -> approval_gate`. The explainer was written while reading the working tree and mistakenly labeled it HEAD.
3. **New 6th delta surfaced this round:** `chat_summarizer` still rides `agent="implement"` in both HEAD and WT — odd-one-out after the refactor. Needs its own `src/cli/agents/chat-summarizer.md` (new file) OR deliberate decision to keep it on the generic agent with a rationale. The current inline DOT `prompt=` already encodes the MERGE rules + scope_changed semantics, so extraction into an agent file is mostly cut-paste + procedure formalization.
4. **`chat-refiner.md` is the chat_session agent, NOT chat_summarizer** — no name collision, but adjacent names invite confusion. New agent file should be `chat-summarizer.md` to match node id.

### Recommended design-doc deltas (updated)

1. Conditional edges on chat_summarizer — ✅ already in WT, commit as step 1.
2. Reuse existing `verifier -> remove_gate [preferred_label=false]` false-path — ✅ already in WT.
3. `approval_gate.label` → append `Scope changed: $scope_changed` line. (remaining)
4. `src/cli/agents/verifier.md` Procedure §1 honors pre-seeded `$illumination_path` on re-entry. (remaining)
5. Smoke test covering `verifier(true) -> chat -> scope_changed=true -> verifier(false) -> remove_gate`. (remaining)
6. **NEW** — extract `chat_summarizer` prompt into `src/cli/agents/chat-summarizer.md`; set `chat_summarizer [agent="chat-summarizer", ...]`. Node prompt becomes thin. Restores convention parity with verifier/design-writer/plan-writer/change-explainer. (remaining)
7. **Correct explainer's "Currently implemented" section** in the forthcoming design doc: HEAD has `chat_summarizer -> approval_gate` unconditional — NOT `-> explainer`. The illumination's diagnosis of the bug stands; the specific edge it named was wrong.
