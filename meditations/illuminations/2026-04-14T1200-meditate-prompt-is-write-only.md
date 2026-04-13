---
date: 2026-04-13
status: open
description: The meditate agent's session prompt has no step for closing resolved illuminations — mark_implemented, mark_dispatched, and mark_archived are in the tool whitelist but the prompt never invokes them proactively, so every session adds one illumination and closes zero, making the corpus grow monotonically by design.
---

## Core Idea

The meditate agent's tool whitelist includes `mark_implemented`, `mark_dispatched`, and `mark_archived`. Its session prompt (`src/cli/agents/meditate.md`) has no step that says: "before writing a new illumination, verify whether any existing open illuminations have been resolved and close them." The prompt's sole write action is `write_illumination` at step 7. Every session is structurally write-only: it produces at least one new illumination and closes zero. The backpressure guard is a compensating control for this omission, but it is a pressure-relief valve, not a fix. The root cause is that the agent's prompt never asks it to balance production with closure.

`PROMPT_meditation.md` (in `src/cli/prompts/`) does have a weak version of this: "If the user reports that a fix has been shipped or an illumination has been resolved, call `mark_implemented`." That step is reactive — it depends on the user speaking up. The agent config (`src/cli/agents/meditate.md`) omits even that. In both cases the agent's closure behavior is user-driven, not autonomous. An unsteered session with no user input closes nothing.

## Why It Matters

The 11 open illuminations in the current corpus are all dated 2026-04-13 or 2026-04-14. Multiple illuminations describe the same gap: T0300 (no backpressure), T1100 (guard counts all files not open), T0800 (plans have no lifecycle) are all about the same cluster. The agent keeps producing refinements because it reads the corpus, sees the gap is still open, and writes another observation. It cannot close the loop itself because the prompt doesn't ask it to check whether any prior illumination has been implemented and mark it closed.

This is specifically consequential for the 11 current open files. Several of these describe features that do not yet exist, so they cannot be closed yet. But some describe gaps in the prompt itself — and once the prompt is fixed, the agent could close those illuminations autonomously in the following session. Without the proactive closure step, that loop never closes: the illumination about "mark_implemented has no caller" (T1000) will sit open forever unless a human explicitly triggers it.

The prompt also creates an asymmetry between the meditate agent and the illumination-to-plan pipeline. The pipeline explicitly calls `mark_dispatched` as a named pipeline node. The meditate agent has the same tool available but no equivalent node in its workflow. The pipeline was designed with lifecycle transitions as first-class steps; the meditate prompt treats them as optional.

## Revised Implementation Steps

1. **Add a proactive closure step to `src/cli/agents/meditate.md` as the new step 3**, inserted after `list_illuminations` and before `project_tree`. The text: "For each open illumination in the list, read its 'Revised Implementation Steps.' Identify which illuminations describe gaps that can be verified against the current codebase using `read_file` or `glob_files`. For each one you can verify: read the relevant source file. If the feature described now exists and the gap is closed, call `mark_implemented` with that illumination's filename. Do this before exploring for a new illumination." This makes each session a net-zero or net-positive operation on backlog, not always net-negative.

2. **Cap the closure verification pass at 3 illuminations per session.** If there are 11 open illuminations and the agent reads all of them before writing, the session cost (tokens, tool calls) scales with backlog size. Add a constraint: "Verify at most 3 open illuminations for closure per session, prioritizing the oldest." This bounds the cost and keeps the session focused on producing new insight, not exclusively on triage.

3. **Sync `PROMPT_meditation.md` with `src/cli/agents/meditate.md`.** The two files have diverged. `PROMPT_meditation.md` has a step 7 about `mark_implemented` that `meditate.md` lacks. Determine which file is actually used by `runMeditationSession` (it resolves `meditate.md` via `resolveAgent("meditate")`). The `PROMPT_meditation.md` file may be a legacy artifact or unused copy — confirm its role, then either delete it or merge its step 7 into `meditate.md`. Having two nearly-identical prompt files is a maintenance hazard: the next person editing the prompt will edit one and not the other.

4. **Write a unit test in `src/cli/tests/meditate.test.ts` that reads `src/cli/agents/meditate.md` and asserts it contains the string `mark_implemented`.** This is a prompt-contract test: it fails if someone edits the agent config and removes the closure step. It is trivially cheap to write and catches the regression the current corpus demonstrates has already happened (the step was in `PROMPT_meditation.md` and absent from `meditate.md`).

5. **After shipping the backpressure guard, run a meditate session with `--steer "verify open illuminations for closure and call mark_implemented on any that are resolved."** This is the manual trigger for the first autonomous closure pass. Expected outcome: the guard-related illuminations (T0300, T1100) move to `implemented`, reducing the open corpus from 11 to ~9. Confirm with `list_illuminations(status=implemented)`. This establishes the first real use of `mark_implemented` in the project's history and validates the closure workflow before it becomes fully autonomous.
