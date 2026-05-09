# Chat round notes — 2026-05-09T2200

## What the user raised

- Concrete before/after rendering: "give me example how the output looks currently and how it would look like after the implementation? Talk normally."
- Clarification on `raw outputs:` line: "What are these raw outputs in after implementation?" (Confirmed once explained as the on-disk per-attempt model output that `JsonlPipelineTracer.onValidationFailure` already records.)
- Real workflow shape: "What I'm looking for from this failure output is broad bird eye view and commands that reveal the context. Then I usually just copy and paste these for claude agent to fix the pipeline or create a plan that can be runned to fix the error if it comes from source code. Based on this usage how well does the suggested output match and help iterating?"
- Pushback on `pipeline why` shape: "Hmm creating markdown files seems bloat risk. Any other ways to get this context? Programmatically stdout to terminal that agent can also run in order to get context?"
- Final pick among alternatives: "Alt A sounds good option for now at least."

## Conclusions reached

- **Failure footer = bird's-eye line + named recipe of existing commands.** Footer renders one summary line (`✗ failed at <nodeId> (agent: <relPath>): <reason>`) followed by labelled, copy-pasteable shell commands that use already-existing primitives (`cat <agentFile>`, `cat <latestRawOutputPath>`, `apparat pipeline trace <runId> --node-receive <receiveId> --full`). No new rollup document is produced.
  - Came from: Real workflow shape + pushback on `pipeline why` shape.
  - Rationale: User's loop is "footer → copy commands → paste into Claude → Claude runs commands and reads output → Claude fixes." The footer's job is to *announce the right primitives at the moment of need*, not to manufacture a structured artifact. Existing primitives + Claude's Bash already cover it.

- **Drop the `apparat pipeline why <runId>` command from this illumination's scope.** Step 3 of the illumination's "Revised Implementation Steps" is removed.
  - Came from: Pushback on `pipeline why` shape ("creating markdown files seems bloat risk") + Alt A choice.
  - Rationale: The composer command and its rollup-doc rendering logic are net new surface that exists only to glue together commands the user can already run. Footer-as-recipe (Alt A) achieves the same end with zero new command, zero new rendering format, zero on-disk artifacts.

- **Investigation commands and the resume command are visually separated in the footer.** Two blocks: one for "understand the failure" (agent file, latest raw output, full trace at receive), one for "retry after fix" (`pipeline run <dot> --resume <runId>`).
  - Came from: Real workflow shape (resume is post-fix, not part of context-gathering).
  - Rationale: Mixing investigation and retry commands creates noise during the "understand" phase. Separation makes the footer scan-friendly.

- **Latest attempt only in the footer's raw-output line.** When validation failed across N attempts, the footer references the latest attempt's raw-output path. Earlier attempts are not enumerated inline.
  - Came from: Real workflow shape (the failed final attempt is what Claude needs to diagnose).
  - Rationale: Listing all attempts is noise for the common case. The full per-attempt list is still reachable via the `pipeline trace --node-receive --full` command that the footer already names. (Implicitly accepted by user moving on with Alt A's example, which showed only the latest attempt.)

- **Footer remains the only failure-handoff surface in this illumination's scope.** Illumination steps 1, 2, 4, 5, 6, 7 stay in scope (deepen footer, inline raw-output paths from validation-failure events, single `resolveAgentFileForNode` helper, mirror handoff in Ink fail-frame, scenario test, README + spec ripple). Step 3 (`pipeline why`) is out.
  - Came from: Pushback on `pipeline why` shape + Alt A choice.
  - Rationale: The deepened footer + Ink mirror are both pure-presentation changes over data the tracer already records. They keep the implementation surface to *renderer + one resolver helper*, no new command, no new doc generator.

## Final agreed scope

- IN: Deepen `pipeline run` failure footer at `src/cli/commands/pipeline/run.ts:375-380` to render bird's-eye line + investigation-command block + retry-command block.
- IN: Inline the latest validation-failure `rawOutputPath` (from existing `validation-failure` events in `pipeline.jsonl`) as one of the named investigation commands.
- IN: Add `resolveAgentFileForNode(node, dotDir): string | null` helper (in `src/cli/lib/pipeline-status.ts` or a new `agent-paths.ts`) so the footer and Ink fail-frame share one resolver.
- IN: Mirror the same footer block in the live Ink fail-frame at `src/cli/components/PipelineApp.tsx:38-46` (BlockCloseView), so the human sees the handoff before Ink unmounts.
- IN: New scenario at `.apparat/scenarios/pipeline-failure-footer/pipeline.dot` driving a deliberate validation-failure and asserting (via tmux-tester) that the four-block footer contains agent path, latest raw-output path, and resume command.
- IN: Update `src/cli/tests/pipeline-failure-reason.test.ts:63-65` (currently asserts the old 2-line footer).
- IN: README "Inspecting a run" section + `docs/superpowers/specs/2026-05-06-pipeline-command-orchestration-monolith-design.md` §3.7 ripple.
- OUT: `apparat pipeline why <runId>` command (illumination step 3 dropped — Alt A footer-as-recipe replaces it).
- OUT: Any new rollup-doc / structured-markdown generator code.
- OUT: Inlining raw-output *contents* in the footer (paths only — Claude `cat`s them).

## Open questions

- None deferred from this round. Footer's exact line ordering (`agent file → raw → trace → resume` vs. another order) and label words (e.g. `inspect:` vs `trace:` vs `full:`) are renderer-implementation details, not scope decisions, and can be settled at design-doc time.
