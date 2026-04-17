---
date: 2026-04-17
status: open
description: The remove_gate→delete_file path in illumination-to-implementation.dot is the only terminal path that hard-deletes an illumination instead of transitioning it — breaking the audit trail and allowing the same topic to be re-generated and re-triaged by future meditate sessions with no memory that it was already evaluated.
---

## Core Idea

The illumination lifecycle defines four states: `open`, `dispatched`, `implemented`, `archived`. Every terminal path in `illumination-to-implementation.dot` transitions the illumination into one of these states — except one. When the verifier returns `preferred_label=false` and the user confirms deletion at `remove_gate`, the pipeline routes to `delete_file [type="tool", tool_command="rm $illumination_path"]` and then `done`. The file is gone. No MCP lifecycle tool is called. The illumination is not archived; it is erased. From `list_illuminations`'s perspective, it never existed.

The other three terminal paths all honor the state machine: `mark_dispatched` advances the illumination to `dispatched`; `mark_archived` (via the `Decline` branch at `approval_gate`) sets `status: archived` with a reason; the `preferred_label=empty` path leaves everything unchanged because there was nothing to process. `delete_file` is the only outlier — it exits the state machine by destroying its subject.

## Why It Matters

The filesystem-as-agent-memory principle — documented in `meditations/the-filesystem-as-agent-memory.md` — says state written to disk survives context resets, model swaps, and session boundaries. The illumination state machine embodies this: `mark-dispatched.mjs` in `pipelines/scripts/` explicitly checks for `status: dispatched` and returns `idempotent: true` rather than failing, because the file is the memory. The `delete_file` path discards that memory instead of updating it.

The concrete consequence: the meditate session (`ralph meditate`) operates independently of the pipeline. It generates illuminations from fresh observation, without querying what the pipeline has already processed. If the pipeline hard-deletes an illumination because the verifier found it stale, the next meditate session may observe the same gap in the codebase and generate an equivalent illumination. The pipeline's verifier will evaluate it again, the user will face the same `remove_gate` again, and there is no record that this exact triage has played out before. The system has no tombstone for "we looked at this and decided not to act."

The `archived` state solves this exactly. An illumination with `status: archived` and `reason: "Invalid per verifier: ..."` will be skipped by the verifier on future runs (the verifier prompt explicitly filters on `status: open` only). It persists as a queryable record. It can be re-opened if circumstances change. Archiving is recoverable; deletion is not.

There is also a secondary benefit: the `rm $illumination_path` node is the concrete idempotency violation identified in illumination `2026-04-17T2000`. Replacing deletion with archival eliminates that node entirely, dissolving the `rm -f` repair from T2000 as a free side-effect.

## Revised Implementation Steps

1. **Replace `delete_file` with an `archive_invalid` agent node in `pipelines/illumination-to-implementation.dot`.** Change the node definition from `delete_file [type="tool", tool_command="rm $illumination_path"]` to `archive_invalid [agent="implement", prompt="Call mcp__illumination__mark_archived with filename from $illumination_path (basename only) and reason: 'Invalid per verifier: $explanation'. Return the JSON result."]`. Update the edge: `remove_gate -> archive_invalid [label="Yes"]` and `archive_invalid -> done`. Remove the `delete_file` node entirely.

2. **Verify the verifier prompt already skips archived illuminations.** The verifier node's prompt says "SKIP any file with `status: dispatched`, `status: archived`, or any other non-open value." This is already correct — archived illuminations will be filtered out on future runs. No change needed to the verifier prompt.

3. **Update `remove_gate` label to reflect the new action.** The current label reads "Remove this illumination?". With deletion replaced by archival, the label should read "Archive this illumination as invalid?" — so the user understands the file will persist in archived state, not disappear.

4. **Add a comment in the `.dot` file explaining why hard-delete is not used.** A one-line `// archive instead of delete to preserve audit trail` above the `archive_invalid` node is sufficient. Future pipeline authors reading this file will understand the pattern without having to re-derive the reasoning.

5. **Confirm `mark_archived` is idempotent.** The `archive_invalid` node will now appear on a `--resume` path (if the original archival call completed but the engine crashed before advancing the checkpoint). Check whether `mcp__illumination__mark_archived` exits 0 when called on an already-archived file. If it does not, add idempotency handling analogous to `mark-dispatched.mjs`: detect `status: archived` and return a no-op success response.
