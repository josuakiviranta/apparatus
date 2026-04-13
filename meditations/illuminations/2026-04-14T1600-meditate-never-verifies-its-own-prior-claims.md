---
date: 2026-04-13
status: open
description: PROMPT_meditation.md uses list_illuminations only as an anti-duplication filter, never as a trigger to verify whether prior illuminations' described conditions still exist in the codebase — so mark_implemented is structurally unreachable without explicit user prompting.
---

## Core Idea

`PROMPT_meditation.md` step 1 says: "Call `list_illuminations` to orient against prior observations — your illumination should build on, contradict, or deepen them." The orientation goal is avoiding duplicate insights. It is not checking whether prior insights are still true. The agent reads the open illumination list and proceeds to find new patterns. It never reads `src/cli/commands/meditate.ts` to ask: "does the backpressure guard described in T1100 exist yet?" It has `read_file` and `glob_files` — every tool needed to answer that question — but the workflow never poses it. `mark_implemented` is reachable only from step 7: "If the user reports that a fix has been shipped." User-reported closure is the only path. The agent cannot self-close.

## Why It Matters

This is the structural cause behind T1000 ("mark_implemented has no caller") and T1500 ("14 illuminations accumulated, none dispatched"). The explanation isn't that the tools are missing — `mark_implemented`, `mark_dispatched`, and `mark_archived` are all registered in the MCP server and listed in `meditate.md`'s tool whitelist. The explanation is that the workflow prompt never creates a trigger condition under which the agent would call them unilaterally.

Compare the two paths in `PROMPT_meditation.md`:

- **Write path (step 1–8):** Orient → explore → reflect → `write_illumination`. Fully specified. Every session takes this path.
- **Close path (step 7):** "If the user reports a fix has been shipped, call `mark_implemented`." Conditional on user input. No session has activated this path because no user has provided that input during a meditate session.

The open illumination list is being used as a genre constraint ("don't repeat this topic") not as a verification checklist ("is this still true?"). Fifteen sessions have read the same list of open illuminations and found new angles to observe — the T1100 angle on the guard, the T1300 angle on steer, the T1400 angle on gitignore. The codebase has not changed. The agent is finding new ways to describe the same unresolved conditions instead of checking whether those conditions have been resolved.

The `read_file` tool would answer the question in one call. `glob_files("src/cli/commands/meditate.ts")` plus `read_file` on the result would immediately reveal: no `countIlluminations` function exists. That's a closed-loop verification. Without a prompt instruction to make this call, the agent never makes it.

## Revised Implementation Steps

1. **Add a verification pass to `PROMPT_meditation.md` before step 8 (`write_illumination`).** Insert between steps 6 and 7: "Before writing a new illumination, check whether any open illuminations from the last 3 sessions describe a condition that can be verified in the codebase. Use `read_file` to open the relevant source file. If the condition described in the illumination no longer exists (fix has shipped), call `mark_implemented` on that illumination. Do this for all verifiable open illuminations before proceeding to `write_illumination`." This converts `list_illuminations` from an anti-duplication check into a verification trigger.

2. **Limit the verification scan to recent illuminations.** The full corpus is 15+ files. Reading all of them every session is expensive and not useful — illuminations about architectural patterns (T0400: backlog is a dependency graph) cannot be verified by reading a source file. Scope the verification step to illuminations from the last 7 days and those with concrete technical claims (e.g., "function X does not exist in file Y"). A heuristic: if the illumination's description contains a filename or function name, it is verifiable.

3. **Add one concrete example to the verification step.** The prompt should show: "Example: if an open illumination says 'countIlluminations does not exist in src/cli/commands/meditate.ts', call `read_file('src/cli/commands/meditate.ts')` and grep for `countIlluminations`. If found, call `mark_implemented` on that illumination." Agents follow examples more reliably than abstract instructions.

4. **Do not add a mandatory verification step for every open illumination.** That would make each session O(n) in corpus size. The verification step is bounded: check only illuminations with verifiable code claims, from the recent window. Illuminations about process failures (T1500: heartbeat schedules producer not consumer) require human judgment about whether the consumer has been scheduled — the agent cannot verify this from the filesystem alone. The new step should say "where verifiable via `read_file`," not "all open illuminations."

5. **Test the change with a steer.** After updating `PROMPT_meditation.md`, run `ralph meditate . --steer "Verify whether any open illuminations describe conditions that have been fixed in src/. Call mark_implemented on any that have."` With the updated workflow, this steer will have an explicit branch to follow (the new verification step). Without the update, this steer competes with the write mandate and step 8 wins — as T1300 documented.
