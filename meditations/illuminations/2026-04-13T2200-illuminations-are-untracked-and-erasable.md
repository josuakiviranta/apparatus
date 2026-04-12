---
date: 2026-04-11
description: The `write_illumination` MCP tool creates files but does not commit them; five of the six 2026-04-13 illuminations are untracked in git and a single `git clean -fd` would permanently erase all of them, defeating the filesystem-as-agent-memory guarantee.
---

## Core Idea

The `write_illumination` tool writes markdown to `meditations/illuminations/` but performs no git operation. The meditate agent has no Bash tool and cannot commit. The result: illuminations exist as filesystem files between sessions but are not in version control. Five of the six illuminations written on 2026-04-13 (T1620 through T2100) are currently untracked — `git status` shows them as `??`. They are one `git clean -fd` from permanent loss, and any CI job or worktree cleanup would silently destroy them.

## Why It Matters

The "filesystem as agent memory" pattern only holds if the filesystem is durable. In git-managed projects, durability means committed history — not just on-disk presence. An untracked file survives session resets but not branch switches, worktree deletions, CI checkouts, or any other git operation that discards untracked content. The current setup gives illuminations the *appearance* of persistence while exposing them to the same catastrophic loss as in-context state.

This matters acutely right now: T1620 through T2100 represent five precise, actionable diagnoses of the `illumination-to-plan` pipeline's failure modes. They are correct, well-specified, and unimplemented. They are also the only artifacts that would tell a future session what has already been analyzed. If they are lost before the pipeline is fixed, the next session will re-derive the same bugs from scratch — or miss them entirely and ship code that still contains them.

The illumination server lives at `src/cli/mcp/illumination-server.ts` and registers `write_illumination` as an MCP tool. It already has filesystem access and calls `mkdirSync`/`writeFileSync`. Adding `execSync("git add ... && git commit ...")` to the same tool handler is a trivial change. The meditate agent needs no new tool and no Bash access; the commit happens inside the server process, which runs with the same working directory as the project.

The one illumination that IS tracked (T1500, `2026-04-13T1500-headless-scheduling-bypasses-governance-gates.md`) was presumably committed manually by the developer after the session ended. That is the correct behavior — it is just not enforced or automated for any subsequent session.

## Revised Implementation Steps

1. **Add an auto-commit to `write_illumination` in `src/cli/mcp/illumination-server.ts`.** After `writeFileSync(filePath, content)` succeeds, call:
   ```ts
   import { execSync } from "node:child_process";
   execSync(`git -C "${projectRoot}" add "${filePath}" && git -C "${projectRoot}" commit -m "meditate: add illumination ${filename}"`, { stdio: "ignore" });
   ```
   Wrap in a try/catch — if the project root has no git repo or git is not on PATH, log a warning but do not throw. The file has already been written; a commit failure should not break the tool call.

2. **Handle the case where the file was already committed (idempotent re-run).** If git returns exit code 1 with "nothing to commit," catch that and treat it as success. This prevents the tool from erroring if the file already exists and is tracked.

3. **Add a unit test to `src/cli/tests/illumination-server.test.ts` that asserts the commit fires.** Mock `execSync` and verify it is called with the correct `git -C` arguments after a successful `write_illumination` call. This prevents a future refactor from silently removing the commit step.

4. **Commit the five untracked illuminations manually now.** Before the code change lands, run:
   ```bash
   git add meditations/illuminations/2026-04-13T1620*.md meditations/illuminations/2026-04-13T1730*.md meditations/illuminations/2026-04-13T1845*.md meditations/illuminations/2026-04-13T1945*.md meditations/illuminations/2026-04-13T2100*.md
   git commit -m "meditate: recover untracked illuminations from 2026-04-13 session"
   ```
   Do this before any worktree operations, branch switches, or `git clean` runs.

5. **Do not add `list_illuminations` separately — verify it is reachable from git history now.** Once the five illuminations are committed and the `write_illumination` auto-commit is in place, `list_illuminations` becomes meaningful: it reads the directory, and the directory is durable. The T2100 fix (add `list_illuminations` to the meditate agent's tools whitelist) should be applied in the same session as this fix so the agent can actually use the index it can now trust.
