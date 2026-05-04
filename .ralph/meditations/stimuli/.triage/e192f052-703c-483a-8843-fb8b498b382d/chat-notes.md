# Chat round notes — 2026-04-25T00:00Z

## What the user raised
- Backfill completeness: "all the plans already existing should be marked as done to not leave anything hanging without frontmatter or frontmatter with open status"
- Stage coverage scope: "does this illumination now discuss all the stages for plans or jus for pending stages?"

## Conclusions reached
- Step 2 (frontmatter backfill) must close out every existing plan — no file left without frontmatter, and no file left at `status: open`/`pending` if its feature already exists in the codebase. Backfill outcome: every plan in `docs/superpowers/plans/` ends up either `status: pending` (truly unimplemented) or `status: complete` (feature shipped).
  - Came from: backfill completeness topic
  - Rationale: user explicit — partial backfill defeats the queryability goal; an unstamped or stale-`open` plan is just as invisible as today's no-frontmatter state
- Illumination only covers a two-state lifecycle for plans (`pending` / `complete`). It does NOT mirror the full illumination state machine (`open` / `dispatched` / `implemented` / `archived`).
  - Came from: stage coverage question
  - Rationale: step 2 of the illumination explicitly enumerates only `pending` and `complete`; step 3's `list_plans` filter takes the same two states; nothing in the illumination proposes a `dispatched` (in-flight) or `archived` (rejected/abandoned) state for plans
- Open question for downstream design doc: should plans get `dispatched` (work started, not done) and `archived` (rejected/superseded) too, parallel to the illumination state machine, or is binary `pending`/`complete` enough? The illumination as written stops at binary; user did not push to expand, but flagged the gap.
  - Came from: stage coverage question
  - Rationale: user's phrasing ("just for pending stages?") signals awareness that the illumination's lifecycle is narrower than the illumination-side state machine — design doc should make the choice explicit, not silent

## Open questions (if any)
- (resolved in round 2 below) Full state-machine parity vs. binary — user picked binary `pending` / `implemented`.

# Chat round notes — 2026-04-25T00:01Z

## What the user raised
- State vocabulary: "We could use marks (pending / implemented) for plans"
- Transition trigger: "the question is where status will be changed from pending to implemented"
- Autonomy choice: "Agent should call it to make the pipeline autonomous"

## Conclusions reached
- Plan lifecycle is binary: `status: pending` and `status: implemented` (not `complete`). Vocabulary aligns with the illumination state machine's `implemented` terminal state, not a new word.
  - Came from: state vocabulary topic
  - Rationale: user explicit — match the existing `implemented` term used on the illumination side; avoid introducing `complete` as a parallel-but-different label
- Backfill (step 2) terminal label is `implemented` (not `complete`) for plans whose features ship in the codebase. Pending plans stay `pending`.
  - Came from: state vocabulary topic (consequence)
  - Rationale: follows directly from binary choice; keeps round 1's backfill completeness rule intact, just renames the terminal label
- Transition `pending` → `implemented` is performed by an **agent calling an MCP tool** (`mark_plan_implemented`), parallel to existing `markDispatched` / `markArchived` (both auto-commit on call). No human hand-edit step in the happy path. No separate verifier gate.
  - Came from: transition trigger + autonomy choice topics
  - Rationale: user explicit — "Agent should call it to make the pipeline autonomous." Hand-edit reproduces the orphan failure mode; verifier gate adds latency and a manual checkpoint that breaks autonomy
- The agent that calls `mark_plan_implemented` is the implementing agent itself (the spider — i.e., whatever pipeline / loop is actively shipping the plan's feature). Caller identity is not pinned to one specific agent file — any agent with the tool whitelisted can call it.
  - Came from: autonomy choice (caller identity follow-through)
  - Rationale: user said "agent" generically, scoped by autonomy goal; pinning to one specific agent would re-introduce a coordination point and break the autonomy property
- Tool surface (design doc target): `mark_plan_implemented(plan_filename)` in `src/cli/mcp/illumination-server.ts`, auto-commits the frontmatter flip on call, mirrors `markDispatched` exactly. Add to relevant agent tool whitelists.
  - Came from: transition trigger (concrete shape implied by autonomy + symmetry)
  - Rationale: user did not name the tool, but specified MCP-style autonomy + parity with existing illumination tooling; the symmetric shape is the only one consistent with both constraints

## Open questions (if any)
- None for this round. Transition trigger and vocabulary now both pinned by user.
