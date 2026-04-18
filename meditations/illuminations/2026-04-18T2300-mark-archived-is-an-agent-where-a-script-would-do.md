---
date: 2026-04-18
status: open
description: mark_archived is an agent node calling one deterministic MCP function, while mark_dispatched is a script node doing the same kind of frontmatter mutation — the false-path cluster's archive node should be a script for the same reasons mark_dispatched is one, and unlike the script, the TypeScript markArchived implementation is not idempotent on resume.
---

## Core Idea

`mark_dispatched` in `illumination-to-implementation.dot` is `type="tool", script_file="scripts/mark-dispatched.mjs"` — a deterministic Node.js script that mutates frontmatter directly. `mark_archived` is `agent="implement"` — a full LLM invocation instructed to call `mcp__illumination__mark_archived`. Both operations do exactly one thing: rewrite the `status:` field in a markdown frontmatter block and record a timestamp. One does it as a 50ms script. The other spends a Claude API round-trip to do the same. The entire false-path cluster (T1100, T1500, T2100) proposes `archive_invalid [agent="implement"]`. None of them noticed that `mark_dispatched` is the template to follow, not the agent node on the approval Decline branch.

Compounding this: the TypeScript `markArchived` function (`src/cli/mcp/illumination-server.ts`) is not idempotent. If the pipeline resumes after `archive_invalid` ran but the checkpoint didn't advance, `markArchived` is called a second time on a file that was already moved to `illuminations/archive/`. It returns `{ success: false, error: "Illumination file not found" }` because `rmSync` already moved the file on the first call. The `mark-dispatched.mjs` script handles this explicitly — if `status === "dispatched"` and the plan path matches, it returns `{ idempotent: true }` and exits 0. `markArchived` has no equivalent guard.

## Why It Matters

The false path is the high-frequency path. Every illumination the verifier rejects or marks invalid passes through it. The approval Decline branch also routes to `mark_archived`. Making this an agent node means every rejection — even trivially invalid illuminations — burns one full LLM invocation to call a function that has no decision-making content. The agent cannot do anything more intelligent than the script: the filename comes from `$illumination_path`, the reason comes from `$summary`. Both are known at the time the node fires. There is no reasoning to perform.

The idempotency gap is a correctness issue specifically on `--resume`. The pipeline engine writes checkpoints. If `archive_invalid` completes the MCP call but the process dies before the checkpoint advances, a `--resume` will re-invoke the node. An agent node would attempt `mark_archived` again on a file that no longer exists at `$illumination_path`. It would get `{ success: false }` and depending on whether the agent treats that as a failure, the pipeline either hangs at that node or marks the run failed — blocking further progress on what was actually a completed operation.

The `dark-factory-software-factory-pattern` lens frames this concisely: the lights-out pipeline should not summon an LLM for work a 20-line script can do reliably. Every agent node is a point of non-determinism, cost, and latency. Reserve agent nodes for work that requires reasoning. State transitions do not.

## Revised Implementation Steps

1. **Create `pipelines/scripts/mark-archived.mjs`** following `mark-dispatched.mjs` exactly. Accept `<illumination-path> <reason>` as CLI args. Read the frontmatter. If status is already `archived`, check the `archive/` subdirectory — if the file exists there, return `{ marked_archived: ..., idempotent: true }` and exit 0. If status is anything else, call `markArchived` logic inline (rewrite frontmatter, move file, write to `archive/`). Mirror the exit code and JSON output conventions of `mark-dispatched.mjs`.

2. **Change `archive_invalid` (or `mark_archived` on the false path) to `type="tool"`** in `illumination-to-implementation.dot`. Replace `agent="implement", prompt="Call mcp__illumination__mark_archived..."` with `type="tool", script_file="scripts/mark-archived.mjs", script_args="$illumination_path $summary"`. The `$summary` variable is available in context from the `verifier` node's `produces=` — same as `$illumination_path`. No new context variable needed.

3. **Add an idempotency test to `mark-archived.mjs`** before shipping: run it against a fixture file twice, confirm the second call returns `{ idempotent: true }` and exits 0. This follows the same test pattern as `pipelines/scripts/tests/mark-dispatched.test.mjs`. The absence of this test is what allowed `markArchived` in the MCP server to ship without idempotency — the MCP path was never exercised on already-archived files in the test suite.

4. **Do not touch `markArchived` in `illumination-server.ts`** for this change. The MCP tool is used by interactive meditate sessions, where non-idempotency is acceptable (a human calling it twice is their own problem). The script layer handles the pipeline's needs. Keeping the two separate avoids coupling interactive and pipeline behaviors.

5. **Apply this as part of the false-path atomic diff** described in T1700 — same commit that removes `delete_file`, re-routes `remove_gate → mark_archived`, and deletes `explain_removal`. The script node replaces the agent node in a single `.dot` edit plus one new file. The total diff for the entire false-path cluster is then: one `.dot` file (5 routing changes) and one new 30-line `.mjs` script.
