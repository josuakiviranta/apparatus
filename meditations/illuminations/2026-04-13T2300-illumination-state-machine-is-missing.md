---
date: 2026-04-11
status: open
description: Illumination files have no lifecycle state — there is no difference between a fresh observation and one already dispatched or implemented — so the illumination-to-plan pipeline will process the same illumination repeatedly, and meditate sessions will keep re-diagnosing already-resolved problems.
---

## Core Idea

`write_illumination` implements only the C in CRUD. Once written, an illumination file is permanently in the same state: "exists." The illumination-to-plan pipeline can delete a file (via `delete_agent`) but cannot mark one as dispatched, in-progress, or implemented. When the pipeline processes T1845 and generates a design doc and plan, the illumination file at `meditations/illuminations/2026-04-13T1845-decline-destroys-verified-illumination.md` remains byte-for-byte identical to how it looked the moment it was written. A future verifier pass will find the issue still present (until a developer ships the fix), and the pipeline will queue it again.

More critically: after a developer ships the T1845 fix directly — without the pipeline — the illumination file still describes the bug in present tense. The next verifier pass will route it to `explain_removal → remove_gate`, asking a human to confirm deletion of a file that was the original accurate diagnosis. The insight gets discarded; the record that "this was noticed, tracked, and fixed" is destroyed rather than archived.

## Why It Matters

The filesystem-as-agent-memory pattern requires the memory to be mutable — you must be able to mark things done, not just add new things. Without a status field, the illumination index is a write-append-only log that grows without bound and cannot be queried by state. Every meditate session that reads `list_illuminations` sees the full backlog — resolved and unresolved — as a flat undifferentiated list.

The seven 2026-04-13 illuminations are all still "open" even though T2200 has already been partially addressed (the current session adds its own illumination, proving the pipeline works enough to write files). When the T2100 fix lands (add `list_illuminations` to the tools whitelist), the agent will see all seven illuminations and cannot know which ones are actively being worked on versus freshly identified versus already shipped.

There is also a concrete idempotency gap in `illumination-to-plan.dot`. The pipeline has no guard against re-processing an illumination it already routed to design_writer. If two pipeline runs overlap, or the same illumination survives a failed run and gets picked up again, the researcher node will verify it again (another 50-subagent pass) and design_writer will produce a second spec file for the same insight. The pipeline is expensive and non-idempotent because illuminations have no "already dispatched" marker.

The `pipeline-interactive.test.tsx` test comment, the `IMPLEMENTATION_PLAN.md` note about nested Static, and the T1620 illumination all document the same bug — three independent records, none aware of the others. This is what happens when knowledge has no canonical identity: the same observation is made, written down, and filed separately three times by three different processes. A status field with a `dispatched_plan` link would collapse these three artifacts into one.

## Revised Implementation Steps

1. **Add a `status` field to the illumination frontmatter schema.** Valid values: `open` (default on write), `dispatched` (pipeline has generated a plan), `implemented` (developer confirmed fix is shipped), `archived` (accurate but no longer actionable). Update `write_illumination` in `src/cli/mcp/illumination-server.ts` to write `status: open` in the frontmatter of every new file.

2. **Add a `mark_dispatched` node to `illumination-to-plan.dot`.** Insert it between `design_writer` and `plan_writer`. Its prompt: "Update the frontmatter of `$illumination_path`: change `status: open` to `status: dispatched` and add `plan_path: $design_doc_path`." This creates the backward link from plan to illumination source, and prevents double-processing on retry. One-line frontmatter edit, no architectural change.

3. **Replace `delete_agent` on the false path with `mark_archived`.** Instead of deleting a stale illumination, move it to `meditations/illuminations/archive/` and update its status to `archived`. The insight that was once accurate is preserved as history. The `delete_agent` node that currently handles both the false path and the decline path is the wrong tool for both — it destroys rather than transitions.

4. **Update `list_illuminations` to filter by status.** Add an optional `status` parameter: `list_illuminations(status="open")`. The meditate agent's step 1 should call `list_illuminations(status="open")` to see only unresolved work. This is a one-function change in `src/cli/mcp/illumination-server.ts`.

5. **Manually annotate the seven 2026-04-13 illuminations now.** Before any code change, add `status: open` to each file's frontmatter as a baseline. This makes the current state explicit rather than implicit and provides a checkpoint for verifying the tooling once it ships.
