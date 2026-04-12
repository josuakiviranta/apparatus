# Design: Auto-Commit Illuminations on Write

**Date:** 2026-04-12
**Status:** Approved

## Problem

The `write_illumination` MCP tool in `illumination-server.ts` creates files under `meditations/illuminations/` using `mkdirSync`/`writeFileSync` but performs no git operations afterward. Newly created illuminations are untracked in git and vulnerable to loss from `git clean`, branch switches, worktree cleanup, or CI checkouts. The meditate agent has no Bash tool and cannot commit on its own.

The "filesystem as agent memory" pattern only holds if the filesystem is durable. In git-managed projects, durability means committed history — not just on-disk presence. Without auto-commit, illuminations have the appearance of persistence while being silently erasable.

## Solution

Add an auto-commit step inside the `write_illumination` tool handler in `illumination-server.ts`. After `writeFileSync` succeeds, run `git add` + `git commit` for the newly written file. The commit happens inside the server process, which already runs with the project's working directory.

## Architecture

### Data Flow

```
meditate agent
  → calls write_illumination MCP tool
    → mkdirSync (ensure directory)
    → writeFileSync (write illumination markdown)
    → execSync: git -C <projectRoot> add <filePath>        [NEW]
    → execSync: git -C <projectRoot> commit -m "..."       [NEW]
    → return success to agent
```

### Components

**illumination-server.ts — `write_illumination` handler**

After the existing `writeFileSync(filePath, content)` call, add:

```typescript
import { execSync } from "node:child_process";

try {
  execSync(`git -C "${projectRoot}" add "${filePath}"`, { stdio: "ignore" });
  execSync(
    `git -C "${projectRoot}" commit -m "meditate: add illumination ${filename}"`,
    { stdio: "ignore" }
  );
} catch {
  // git not available, not a git repo, or nothing to commit (idempotent re-run).
  // The file is already written; commit failure must not break the tool call.
}
```

### Constraints

- **Fail-open:** If `git` is not on PATH, the project has no git repo, or the file is already committed (exit code 1 / "nothing to commit"), the catch block swallows the error silently. The file write is the primary operation; the commit is best-effort durability.
- **No new dependencies:** Uses `node:child_process` which is already available in the Node.js runtime.
- **No agent changes:** The meditate agent needs no new tool and no Bash access. The commit is transparent to the caller.
- **Idempotent:** Re-running `write_illumination` for the same path overwrites the file and commits the update. If the content is identical, `git commit` exits with "nothing to commit" which is caught and ignored.

## Files to Modify

| File | Change |
|------|--------|
| `src/cli/mcp/illumination-server.ts` | Add `execSync` git add + commit after `writeFileSync` in `write_illumination` handler |
| `src/cli/tests/illumination-server.test.ts` | Add test: mock `execSync`, verify it is called with correct `git -C` args after a successful `write_illumination` call |

## Non-Goals

- No changes to `list_illuminations` or any other MCP tool
- No retroactive commit of existing untracked illuminations (handle manually)
- No git push — commits stay local
- No configuration for commit message format
- No changes to the meditate agent prompt or tool whitelist

## Testing

- Unit: mock `execSync` and verify `write_illumination` calls `git add` then `git commit` with correct arguments after writing the file
- Unit: verify that when `execSync` throws (simulating no git), the tool still returns success (fail-open behavior)
- Unit: verify idempotent re-write does not throw even when "nothing to commit"
