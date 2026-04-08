# Attractor Pipeline Engine — Spec Compliance Review (Post-Warning-Fix)

**Reviewed:** `docs/superpowers/specs/2026-04-08-attractor-pipeline-engine-design.md`
**Upstream reference:** `https://github.com/strongdm/attractor/blob/main/attractor-spec.md`
**Date:** 2026-04-09
**Round:** Post-fix review — evaluates the 3 warning fixes and 4 prior notes

---

## 1. Overall Verdict

**Ready for implementation** — with two residual items that do not block implementation.

The three warning fixes (ISSUE-1, ISSUE-2, ISSUE-3) are all correct and complete. The prior three gap fixes (GAP-1, GAP-2, GAP-3) remain intact. Two small new issues were found, neither of which is a blocker. The four prior notes have been partially resolved.

---

## 2. Warning Fix Verification

### ISSUE-1 — Retry exhaustion vs. goal gate cascade (Sections 4.4, 17.5)

**Verified correct.** The spec now cleanly separates the two paths:

- Plain retry exhaustion at a non-terminal node: outcome becomes `fail`, normal edge selection runs, `retry_target` is NOT invoked automatically.
- Goal gate cascade at a terminal `Msquare` node: `node.retry_target` → `node.fallback_retry_target` → `graph.retry_target` → `graph.fallback_retry_target` → pipeline fail.

Both Section 4.4 body and Section 17.5 DoD bullet points capture this correctly. Matches upstream Section 3.4 and §11.5 DoD exactly.

### ISSUE-2 — Label normalization accelerator-strip rule (Section 4.3)

**Verified correct.** Section 4.3 now documents three strip patterns: `[X] `, `X) `, `X - ` with examples (`[Y] Yes` → `Yes`, `1) Approve` → `Approve`, `Y - Confirm` → `Confirm`). This matches upstream Section 3.3 verbatim. The case-insensitive comparison step is also present.

Minor wording observation (non-blocking): upstream also documents a "first character" fallback accelerator key used by the *wait.human handler* for keyboard shortcut display. This is distinct from the engine's label normalization for edge matching and is correctly absent from Section 4.3. No fix needed.

### ISSUE-3 — `loop_restart` full-pipeline restart semantics (Sections 2.3, 4.4, 17.5)

**Verified correct, with one residual precision issue (non-blocking).**

The spec now correctly says `loop_restart=true` terminates the current run, clears all context and retry counters, creates a fresh run directory, and re-launches from the start node. This matches upstream's intent.

Residual: upstream pseudocode shows `restart_run(graph, config, start_at=next_edge.target)` — restart begins at the edge's *target node*, not unconditionally the graph's start node. The local spec says "from the start node" unconditionally. In practice every `loop_restart` edge will target the start node, so this divergence will never manifest. The spec could say "from the edge's target node (typically the start node)" for strict upstream fidelity. Low risk; non-blocking.

---

## 3. New Issues Found

### NEW-1 — MEDIUM — Section 4.4 / 2.2: `allow_partial` behavior creates an implementation gap

**Problem:** Section 4.4 Retry Logic says "outcome becomes `fail`" at retry exhaustion, with no mention of `allow_partial`. Upstream behavior: when `allow_partial=true` on a node and retries are exhausted, the engine returns `PARTIAL_SUCCESS` instead of `FAIL`. Since `PARTIAL_SUCCESS` satisfies goal gates and triggers different edge selection, this is a behavioral difference, not just a schema gap.

A developer implementing Section 4.4 literally will always fail on retry exhaustion, missing the `allow_partial` branch entirely. The attribute is also absent from Section 2.2.

**Recommended fix:** Add one of: (a) add `allow_partial` to Section 2.2 and document the PARTIAL_SUCCESS branch in Section 4.4 retry exhaustion logic, or (b) add an explicit statement to Section 4.4 that `allow_partial` is not supported in v1 and retry exhaustion always yields `fail`. Either choice makes the behavior unambiguous.

### NEW-2 — LOW — Section 2.2: Stray `loop_restart` row in Node Attributes table

**Problem:** The last row of the Section 2.2 Node Attributes table documents `loop_restart` with handler "engine" and description "Edge attribute: marks edge as a loop restart (resets retry counter)." This is an edge attribute that belongs in Section 2.3, not in the node table. Its presence here (with the outdated "resets retry counter" description that ISSUE-3 fixed in Section 2.3) could cause an implementer to add `loop_restart` handling to node-level parsing code, and the stale description contradicts the corrected one in 2.3.

**Recommended fix:** Remove the `loop_restart` row from Section 2.2.

---

## 4. Status of Prior Notes (NOTE-4 through NOTE-7)

### NOTE-4: `auto_status` and `allow_partial` node attributes absent

**Still open.** Neither attribute appears in Section 2.2. `allow_partial` now has implementation impact (see NEW-1). `auto_status` remains a schema gap only. Recommend addressing both before implementation kickoff.

### NOTE-5: `fidelity` and `thread_id` edge attributes absent from Section 2.3

**Partially resolved.** `fidelity` is now present in Section 2.3 (added in the prior gap fixes round). `thread_id` remains absent. Since `thread_id` only matters for `full` fidelity, and `full` is v2-deferred, this is acceptable — but the spec should state the deferral explicitly rather than silently omitting the attribute. Recommend adding `thread_id` to Section 2.3 marked "v2 only."

### NOTE-6: `reasoning_effort` v1 mapping left TBD

**Still open (by design).** Section 9.3 and DoD 17.10 both say "v1 mapping TBD at implementation time." This is a deliberate deferral. The attribute must be parsed and stored; invocation behavior is TBD. The DoD item is technically unverifiable as written, but it does not block the implementation of any other system. Acceptable as-is if the team agrees to treat it as recognized-but-no-op in v1 (same as `llm_provider`).

### NOTE-7: `last_stage` / `last_response` misclassified as engine-set

**Resolved.** Section 6.2 now has two sub-tables: "Engine-managed keys" and "Handler-set keys." Both `last_stage` and `last_response` appear in "Handler-set keys," matching the upstream `Set By: Handler` classification exactly. Fix is correct and complete.

---

## 5. Final Recommendation

**Proceed to implementation planning.** The three warning fixes are correct and complete. No blocking issues remain. Before the first implementation task is assigned, make these two editorial fixes:

1. Section 4.4: Add explicit statement that `allow_partial` is not supported in v1; retry exhaustion always yields `fail`. (Prevents incorrect PARTIAL_SUCCESS branch being added by implementer.)
2. Section 2.2: Remove the stray `loop_restart` row. (Prevents parser confusion and resolves stale description.)

Optional but recommended: soften "from the start node" to "from the edge's target node (typically the start node)" in Sections 2.3 and 4.4.

---

## 6. Summary Table

| # | Severity | Section | Status | Description |
|---|----------|---------|--------|-------------|
| ISSUE-1 | WARNING | 4.4, 17.5 | **Fixed** | Retry cascade now correctly separated from goal gate cascade |
| ISSUE-2 | WARNING | 4.3 | **Fixed** | Accelerator-strip rule added to label normalization |
| ISSUE-3 | WARNING | 2.3, 4.4, 17.5 | **Fixed** (minor residual) | `loop_restart` now full-restart semantics; "start node" vs "target node" is non-blocking |
| NOTE-4 | NOTE | 2.2 | **Open** | `auto_status` absent (no-op); `allow_partial` absent and creates impl gap (NEW-1) |
| NOTE-5 | NOTE | 2.3 | **Partially resolved** | `fidelity` added; `thread_id` still absent (v2 deferral) |
| NOTE-6 | NOTE | 9.3, 17.10 | **Open by design** | `reasoning_effort` TBD; acceptable if treated as no-op in v1 |
| NOTE-7 | NOTE | 6.2 | **Resolved** | `last_stage`/`last_response` moved to handler-set sub-table |
| NEW-1 | MEDIUM | 4.4, 2.2 | **Open** | `allow_partial` absence makes retry exhaustion logic incomplete |
| NEW-2 | LOW | 2.2 | **Open** | Stray `loop_restart` row in Node Attributes table with stale description |
