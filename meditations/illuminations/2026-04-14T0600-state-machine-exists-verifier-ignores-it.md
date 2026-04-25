---
date: 2026-04-12
status: dispatched
description: The lifecycle state machine was implemented and wired into the pipeline, but the verifier's entry glob bypasses status filtering entirely — dispatched illuminations will be re-processed and duplicate plans generated on every subsequent pipeline run.
dispatched_at: 2026-04-25
plan_path: docs/superpowers/plans/2026-04-25-state-machine-exists-verifier-ignores-it.md
---

## Core Idea

The `illumination-to-plan.dot` verifier opens with: `"Run glob on meditations/illuminations/*.md to list all illumination files."` This glob returns every file regardless of status. The state machine (`open → dispatched → implemented → archived`) was implemented correctly in `illumination-server.ts` and wired into the pipeline body (the `mark_dispatched` and `mark_archived` nodes exist), but the pipeline's entry point still reads raw filenames from disk. An illumination with `status: dispatched` will be selected, re-verified with 50 subagents, and routed to `design_writer` again — generating a second plan for work already in flight.

## Why It Matters

The state machine was the T2300 fix. Its purpose was exactly this: prevent the pipeline from re-processing illuminations that already have plans. But the entry point ignores the state the machine writes. The `list_illuminations` tool that supports `status` filtering exists, is registered, and works — it is simply not used by the verifier.

There are two further gaps in the same commit:

**The archive is unqueryable.** `markArchived` in `illumination-server.ts` moves files to `meditations/illuminations/archive/`. But `listIlluminations` calls `readdirSync(dir)` on the top-level illuminations directory and filters for `.md` files — it never descends into `archive/`. Calling `list_illuminations(status="archived")` always returns "No illuminations found." The archived history that T2300 wanted to preserve is invisible to every tool.

**State mutations are not committed.** `writeIllumination` calls `execSync` to auto-commit the new file. The three mutation functions (`markDispatched`, `markImplemented`, `markArchived`) write their frontmatter changes to disk but never commit. After a pipeline run that dispatches an illumination, `git status` shows a dirty tree. A developer who pushes before manually committing loses the state transition from the history. The auto-commit pattern is inconsistently applied within a single module.

## Revised Implementation Steps

1. **Fix the verifier prompt in `illumination-to-plan.dot`.** Replace `"Run glob on meditations/illuminations/*.md"` with `"Call mcp__illumination__list_illuminations with status: open to get the list of unprocessed illuminations."` If the result is empty, return `preferred_label: empty`. This makes the state machine's filter the actual gate, not a suggestion.

2. **Add git commit to `markDispatched`, `markImplemented`, and `markArchived` in `illumination-server.ts`.** Each function already has the file path and project root available. After the `writeFileSync` call, add the same `execSync` try/catch block that `writeIllumination` uses. The pattern is four lines; copy it. `markArchived` should stage both the deleted original and the new archive path before committing.

3. **Fix `listIlluminations` to read the archive subdirectory when `status="archived"`.** When `status === "archived"`, change `dir` to `join(projectRoot, "meditations", "illuminations", "archive")` before calling `readdirSync`. The simplest fix: add a branch at the top of the function that swaps the directory based on the requested status. All other status values continue reading from the main illuminations directory.

4. **Update the unit test in `src/cli/tests/illumination-server.test.ts`.** Add a test that: (a) dispatches an illumination, (b) calls `list_illuminations(status="open")` and verifies it is absent, (c) calls `list_illuminations(status="dispatched")` and verifies it appears. Add a parallel test for `mark_archived` that verifies the file appears in `list_illuminations(status="archived")`. These tests will fail before the fixes above and pass after — confirming the state machine's filters are actually respected end-to-end.
