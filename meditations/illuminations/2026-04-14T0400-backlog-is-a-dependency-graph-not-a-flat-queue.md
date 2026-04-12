---
date: 2026-04-11
description: The 12 accumulated illuminations form a dependency graph where some fixes must land before others are actionable — the pipeline's non-deterministic verifier will process them as a flat set and generate plans in the wrong order, including plans for state-machine enhancements that are useless until the 3-line ChatUI fix is in place.
---

## Core Idea

The `verifier` node in `illumination-to-plan.dot` selects illuminations with no ordering constraint: it globs `meditations/illuminations/*.md` and picks one. With 12 files present, it might select any of them. Some illuminations describe enhancements to the illumination pipeline itself — a state machine, a `mark_implemented` tool, a researcher/summarizer split — that are only useful after the foundational ChatUI bug (T1620) is fixed and the pipeline can complete a run. Running the pipeline on the backlog without triage will produce plans in random order, including plans for features that sit on top of a broken foundation. Worse, three illuminations independently specify the same 3-line change to `ChatUI.tsx`; the pipeline will generate three identical plans for one action.

## Why It Matters

The "filesystem as agent memory" lens says memory must be mutable and queryable to be useful. The 12-file illumination corpus is a write-append-only log with no ordering metadata, no dependency links, and no canonical-vs-superseded distinction. The pipeline has no way to answer: "Which illumination should I process first?" It can only answer: "Which illumination exists?"

The dependency structure is real and consequential. `illumination-to-plan.dot` uses `<Static>` in `PipelineDisplay` for its output lines. T1620's fix (replace `<Static>` in `ChatUI.tsx` with `<Box>`) is the prerequisite for the pipeline being able to show the output of `design_writer` and `plan_writer` at all. If the state machine work from T2300+T0100 lands before T1620 lands, the developer will implement `mark_dispatched` in a pipeline that silently discards its own output after the chat node. The implementation will be unverifiable. The `approval_gate → design_writer → plan_writer` path will run, write files, and return silently — the same broken behavior that T0000 diagnosed.

The three-way duplication (T1620, T0000, T0200 all specifying the same ChatUI fix) will cost three full verifier runs — each spawning up to 50 subagents to read the codebase — before generating three implementation plans that call for the same change to the same line. At the current verifier reliability level (T1730 documents that it consistently fails with JSON parse errors), these are three wasted runs that may not even produce output.

The pipeline is designed as a triage tool, not a planning tool. But it cannot triage across illuminations — only within one at a time. The inter-illumination triage must happen once, manually, before the pipeline runs.

## Revised Implementation Steps

1. **Before running the pipeline, archive the superseded illuminations by hand.** Create `meditations/illuminations/archive/` and move the following into it:
   - `2026-04-13T1620-nested-static-breaks-pipeline-after-chat.md` — superseded by T0200, which is more complete.
   - `2026-04-14T0000-green-tests-hide-the-static-defect.md` — superseded by T0200, which specifies the same fix with test steps.
   - `2026-04-13T2100-meditate-agent-runs-blind-to-prior-illuminations.md` — superseded by T0300, which subsumes the `list_illuminations` whitelist gap and adds backpressure.
   This leaves 9 active files: T1500, T1730, T1845, T1945, T2200, T2300, T0100, T0200, T0300.

2. **Process the active backlog in dependency order, not pipeline-selection order.** The correct sequence is:
   - **Run 1:** T0200 (ChatUI fix — unblocks the pipeline itself; implement the 3-line change first)
   - **Run 2:** T0300 (backpressure + list_illuminations whitelist — prevents future runaway meditation)
   - **Run 3:** T1730 (researcher/summarizer split — fixes the verifier's core failure mode before heavy use)
   - **Runs 4–7:** T2300, T0100, T1845, T2200 in any order (state machine, mark_implemented, decline handling, git tracking — each independent after the pipeline works)
   - **Runs 8–9:** T1500, T1945 (headless scheduling safety and meta-observation — lowest urgency)

3. **Force the verifier to pick a specific illumination for the first four runs.** The current verifier prompt says "Pick ONE illumination." It will not pick T0200 unless directed. Override this by temporarily having only one illumination file present in the directory (move others to a staging area), or edit the verifier prompt for that run to name the target illumination path explicitly. Do not rely on the verifier's selection being deterministic.

4. **Add a `canonical_for` frontmatter field to the illumination schema alongside T2300's `status` work.** Value: path of the superseding illumination (for archived files) or a short action label (for active ones, e.g., `chatui-static-fix`). This makes the triage step scriptable in future: `list_illuminations(canonical_for=null, status=open)` returns only the actionable set. Without this, each session must re-derive the dependency structure from file content.

5. **Do not run the pipeline on T1945 or T1500 until runs 1–3 are complete and their fixes are shipped.** T1945 ("pipeline cannot fix its own bugs") is a meta-observation with no direct implementation steps — it describes a structural truth, not a fixable defect. T1500 ("headless scheduling bypasses gates") is valid but lower-priority than getting the pipeline operational. Processing these early produces plans for secondary concerns while the primary infrastructure is broken.
