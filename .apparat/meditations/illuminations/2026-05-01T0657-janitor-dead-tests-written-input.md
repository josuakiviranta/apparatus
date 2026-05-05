---
date: 2026-05-01
description: scenario_author.tests_written is declared as an implementation-tester input but never referenced in the agent procedure or used for routing — the tester re-discovers scenarios independently via ls.
---

## Findings

1. **What:** `scenario_author.tests_written` is a dead input on `implementation-tester` — injected into every run's context but never read by the agent or by any routing condition.

   **Evidence:**
   - `src/cli/pipelines/implement/scenario-author.md:19` — declares `outputs: tests_written: boolean`
   - `src/cli/pipelines/implement/implementation-tester.md:17` — declares `- scenario_author.tests_written` in its `inputs:` block
   - `src/cli/pipelines/implement/implementation-tester.md` (Phase 1 section) — procedure runs `ls $project/$scenarios_dir/*.md 2>/dev/null` and independently decides "If there are zero scenarios, emit `test_result="pass"` …" — `$scenario_author.tests_written` (or `$tests_written`) is never interpolated anywhere in the prompt body
   - `src/cli/pipelines/implement/pipeline.dot` (entire file) — no edge carries `condition="tests_written=..."` — the routing is purely on `test_result`

   **Why it matters (KISS lens):** Every agent node's declared inputs are injected into the agent's context at runtime. A reader of `implementation-tester.md` sees `scenario_author.tests_written` in the header and spends time looking for where it is used, finding nothing. The variable adds context budget overhead and implies a guard that doesn't exist, forcing a mental double-check on every maintenance pass.

   **Suggested action:** Remove `- scenario_author.tests_written` from `implementation-tester.md` inputs block (line 17). The tester's Phase 1 `ls` check already covers the zero-scenario early-exit; the flag provides no additional value. If a future optimisation to skip the node entirely is desired, wire a conditional edge out of `scenario_author` on `tests_written` in `pipeline.dot` — but that is a separate feature, not a reason to keep the dead input today.

## Reading thread

- `2026-05-01T0423-janitor-parallel-handler-yagni.md` — also a YAGNI in the implement pipeline area (ParallelHandler registered but no .dot consumes it). Different layer (engine vs. agent frontmatter) but the pattern is the same: speculative generality adding cognitive overhead.
- `2026-05-01T0255-bundled-pipeline-exemplars-disagree.md` — covers the bundled pipelines (meditate/janitor/implement) disagreeing on authoring conventions. This finding is narrower: a single dead input in one agent file, not a cross-pipeline style drift.
