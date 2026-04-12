---
date: 2026-04-11
status: open
description: The illumination-to-plan pipeline's interactive chat_session node will silently discard design_writer and plan_writer output due to the T1620 nested-Static bug — making the pipeline useless in practice until that 3-line fix lands first.
---

## Core Idea

The `illumination-to-plan.dot` pipeline contains a `chat_session [interactive=true]` node. When that node exits, the nested-Static bug described in T1620 causes all subsequent pipeline output to be silently discarded. The `design_writer` and `plan_writer` nodes run and write files to disk, but their terminal output never reaches the developer's screen. The pipeline appears to complete cleanly — no error, no crash — but the human-visible result of its most valuable work is gone. T1620's fix is three lines in `ChatUI.tsx`. Until those three lines land, the illumination processing system cannot function as designed.

## Why It Matters

The 10 illuminations written so far form an implicit dependency graph, and T1620 sits at the root. T2300 designs a status state machine. T0100 designs a `mark_implemented` transition. T2100 identified the missing `list_illuminations` tool in `meditate.md`. All of these are correct designs — but they all depend on the illumination-to-plan pipeline working well enough to actually deliver plans to developers. A pipeline that silently drops its own output after the interactive node is not a working pipeline.

The "agentic loop is a graph" lens names the failure precisely: the graph's phases are named, but the exit condition for the interactive node is broken. The pipeline moves to `design_writer → plan_writer → done` and those nodes execute — `src/cli/commands/pipeline.ts` calls `setChat(null)` and resolves the `onInteractiveRequest` promise correctly — but the parent `<Static>` in `PipelineDisplay.tsx` has already lost track of its item list after the child `<Static>` in `ChatUI.tsx` unmounted. The shell returns. The developer sees nothing after the chat ends.

The practical consequence: a developer who runs `ralph pipeline run pipelines/illumination-to-plan.dot`, chats with the agent in `chat_session`, types `/end`, and then watches the pipeline silently complete will have a design doc and implementation plan written to `docs/superpowers/specs/` and `docs/superpowers/plans/` — but no visible indication that anything was written. They will likely assume the pipeline failed or skipped those stages, and may re-run it. The pipeline is not broken; it is invisibly broken.

T0000 documented that the regression test for T1620 mocks `ChatUI` to avoid triggering the bug, and that the fix is three lines. T1945 documented that the pipeline cannot fix its own bugs. Neither named the cascading consequence: every other illumination fix — T2200's git tracking, T2300's status fields, T0100's `mark_implemented` — is being designed without the primary processing tool being operational. The state machine is being specified for a pipeline that cannot currently show developers the output of its own design stage.

## Revised Implementation Steps

1. **Fix T1620 now, manually, outside the pipeline.** In `src/cli/components/ChatUI.tsx`, replace the `<Static items={history.map(...)}>` call with `<Box flexDirection="column">{history.map((turn, i) => <TurnView key={i} turn={turn} />)}</Box>`. Remove the `Static` import from the ink import line if it is no longer used elsewhere in the file. This is a 3-line change. Do not use the illumination-to-plan pipeline to generate a plan for this — the fix is already fully specified in T1620 step 2 and T0000 steps 1-5. The pipeline is the wrong tool for a fix this small and already-specified.

2. **Remove the ChatUI mock from `pipeline-interactive.test.tsx`.** After the fix lands, delete the `vi.mock("../components/ChatUI.js")` block from `src/cli/tests/pipeline-interactive.test.tsx` and run `npx vitest run src/cli/tests/pipeline-interactive.test.tsx`. The test must pass with the real `ChatUI` component. If it passes, the fix is verified. Update the test comment to document that the real component is now used (per T0000 step 5).

3. **Run `ralph pipeline run pipelines/illumination-to-plan.dot` manually to confirm end-to-end visibility.** After the smoke test passes, run the illumination-to-plan pipeline against one of the existing illuminations. After typing `/end` in the chat session, verify that the terminal shows the `design_writer` and `plan_writer` output — or at minimum, that the shell does not return silently. This is the gate check that confirms the primary tool is operational.

4. **Process the illumination backlog in dependency order, not arbitrarily.** The correct implementation sequence is: T2200 (add git auto-commit for illumination writes) → T2300 (add status field + `mark_dispatched` to pipeline) → T2100 (add `list_illuminations` to `meditate.md` whitelist) → T0100 (add `mark_implemented` to illumination server + meditate agent). The verifier in `illumination-to-plan.dot` picks one illumination per run without regard for prerequisites — override its selection manually for the first four runs by specifying which illumination to process in the pipeline prompt, or by temporarily having only one illumination file present.

5. **Do not add new illuminations about the illumination system until T1620 is fixed and the pipeline is operational.** The backlog is already 10 items deep. Each new illumination about the illumination system increases the debt without adding capacity to pay it down. The next action is a 3-line code change, not another observation.