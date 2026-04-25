---
date: 2026-04-11
status: archived
description: T2300's state machine proposes `open → dispatched → implemented → archived` but specifies no actor for the dispatched→implemented transition — developers who ship a fix have no tool, no command, and no natural workflow path to close the loop, so illuminations will accumulate in `dispatched` indefinitely.
archived_at: 2026-04-24
reason: mark_implemented MCP tool already shipped in illumination-server.ts and whitelisted in meditate.md
---

## Core Idea

T2300 proposed a four-state lifecycle for illuminations: `open`, `dispatched`, `implemented`, `archived`. Its implementation steps only specify automation for one transition: a `mark_dispatched` pipeline node that advances `open → dispatched`. The `dispatched → implemented` transition has no prescribed actor. The developer who ships the fix cannot call any MCP tool, run any CLI command, or follow any discoverable step to mark the illumination resolved. The lifecycle is a one-way street that ends at `dispatched` and never reaches `implemented`.

## Why It Matters

After T2300's fixes land, the system will correctly route unexamined illuminations through the pipeline. But it creates a new accumulation problem one step later: `dispatched` illuminations will pile up with no exit. `list_illuminations(status="dispatched")` will grow without bound, mixing "fix in progress" with "fix shipped six weeks ago." The state machine has a hole exactly where the human enters — the moment a developer pushes a commit that resolves an illumination.

The illumination server at `src/cli/mcp/illumination-server.ts` has seven registered tools: `write_illumination`, `read_file`, `glob_files`, `project_tree`, `list_meta_meditations`, `read_meta_meditation`, `list_illuminations`. None of them modify an existing illumination file. The server is append-only. A developer wanting to mark T1620 as resolved must open the file in a text editor and manually update the frontmatter — a step that is invisible to the system, untracked in git (until T2200's auto-commit fix lands), and completely undiscoverable from the CLI.

The filesystem-as-agent-memory lens names the gap precisely: for persistent memory to be useful, state must be *explicitly written* at every meaningful transition — not just at creation and dispatch, but at resolution. Without a written `implemented` record, the memory has no way to distinguish "done" from "stuck." The illumination index becomes a record of what was once noticed, not a record of what was later resolved.

There is also a missed coupling point. The meditate agent is the only interface where a developer currently sits and reflects on the project. It has the tools to read and write illuminations. If a developer runs `ralph meditate` and says "I just shipped the T1620 fix," the agent could close the loop in that conversation — if a `mark_implemented` tool existed.

## Revised Implementation Steps

1. **Add a `mark_implemented` function and MCP tool to `src/cli/mcp/illumination-server.ts`.** The tool takes `filename` as input. It reads the illumination file, replaces `status: dispatched` with `status: implemented` (or adds it if absent), and appends `implemented_at: YYYY-MM-DD`. If auto-commit (T2200) is in place, the mutation is committed automatically. If the file is `status: open` (developer fixed something without going through the pipeline), accept that too — the transition `open → implemented` is valid. Add a unit test in `src/cli/tests/illumination-server.test.ts`.

2. **Add `mcp__illumination__mark_implemented` to the `tools:` whitelist in `src/cli/agents/meditate.md`.** Place it after `write_illumination`. The meditate agent is the natural completion interface — a developer can report a resolved fix in conversation and the agent will call the tool. No new command or workflow needed; the existing `ralph meditate` session handles it.

3. **Add a prompt instruction to `src/cli/prompts/PROMPT_meditation.md`.** After the existing task list, add: "If the user reports that a fix has been shipped or an illumination has been resolved, call `mark_implemented` with the illumination filename before ending the session." This makes the implemented-state reachable through natural language — the path is: developer ships fix → runs `ralph meditate` → says "T1620 is done" → agent calls `mark_implemented`.

4. **Do not add illumination awareness to the `implement` command.** The `implement` command could theoretically auto-detect which illumination a session resolves and mark it on commit. That coupling is non-trivial (matching session goal to illumination), fragile, and YAGNI. The meditate-agent path is sufficient and keeps the two systems loosely coupled.

5. **Update T2300's "Revised Implementation Steps" for step 2.** When `mark_dispatched` is added to the pipeline, also document that the reverse transition is handled by `mark_implemented` via the meditate agent — so future readers understand the full lifecycle before implementing any piece of it. The T2300 illumination is the canonical source for the state machine design; it should name both automation points.
