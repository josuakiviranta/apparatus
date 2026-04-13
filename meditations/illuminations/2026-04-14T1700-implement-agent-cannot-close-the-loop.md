---
date: 2026-04-13
status: open
description: The implement agent has `mcp: []` and therefore structurally cannot call `mark_implemented` — the two agents that form the observe-implement loop are complementary halves with the closing tools missing from the closer.
---

## Core Idea

`src/cli/agents/meditate.md` has 9 illumination MCP tools: `list_illuminations`, `read_file`, `glob_files`, `project_tree`, `write_illumination`, `mark_implemented`, `mark_dispatched`, `mark_archived`, `list_meta_meditations`, `read_meta_meditation`. `src/cli/agents/implement.md` has `mcp: []`. The implement agent is the natural caller for `mark_implemented` — it is the agent that ships code — but `mcp: []` makes that call structurally impossible. T1000 observed that `mark_implemented` has no caller and proposed adding closure instructions to the meditate agent. The reason it has no caller is not a missing prompt instruction; it is a missing tool configuration in the agent that should hold the responsibility.

## Why It Matters

The open/close lens names the design flaw: the illumination state machine defines four states (`open → dispatched → implemented → archived`) as a symmetric lifecycle — every `open` should eventually `close`. The pair was designed into the schema. But the agent that opens the loop (meditate, with `write_illumination`) and the agent that closes it (implement, via shipping code) were given asymmetric tool access. Meditate has every lifecycle transition tool. Implement has none.

This is not an abstract gap. The corpus now has 17 open illuminations describing concrete code conditions. Six are about the backpressure guard, three about `mark_implemented` itself, two about heartbeat scheduling. If the implement agent were to run against `IMPLEMENTATION_PLAN.md` tomorrow and ship the backpressure guard, it would have no mechanism to record that closure — even if its prompt instructed it to. The tool call would fail: `mcp__illumination__mark_implemented` does not exist in its toolset.

T1600 observed that meditate never verifies prior claims because the workflow prompt never asks it to. That is the meditate-side failure. This is the symmetric implement-side failure: even if a future prompt said "after shipping, call `mark_implemented`," the implement agent cannot comply. The two halves of the loop are broken in different ways — the observer cannot verify, the implementer cannot close — and neither failure has been named together as a pair.

The filesystem-as-memory lens adds a second angle: the illumination corpus is the shared memory between the two agents. Meditate writes to it. Implement is supposed to update it. But implement's access to this shared memory is file-level only (it can read `.md` files) — not tool-level. There is no `list_illuminations(status=open)` available to the implement agent, so it cannot even query "what does the observer want me to build?" in a structured way. It navigates by `IMPLEMENTATION_PLAN.md` alone — a secondary artifact that must be manually populated from the corpus.

## Revised Implementation Steps

1. **Add the illumination MCP server to `implement.md`'s `mcp:` block.** Copy the three-field MCP entry from `meditate.md` (`name: illumination`, `command: node`, `args: [...]`). The same three environment variable substitutions apply (`ILLUMINATION_SERVER_PATH`, `PROJECT_ROOT`, `META_MEDITATIONS_DIR`). These are resolved at agent launch from the same `variables:` map already used by `runMeditationSession`. The implement command will need to pass the same variables — check `src/cli/commands/implement.ts` to confirm the `agent.run()` call includes them; add if absent.

2. **Add `mark_implemented` and `list_illuminations` to `implement.md`'s `tools:` whitelist.** The implement agent does not need `write_illumination`, `mark_dispatched`, or `mark_archived` — those are meditate-role transitions. It needs exactly two: `list_illuminations` (to query open illuminations at session start) and `mark_implemented` (to close them after shipping). Restricting to these two tools prevents the implement agent from accidentally writing illuminations or dispatching items — the open/close pair principle: grant only the close, not the open.

3. **Add a step to `implement.md`'s workflow:** "At session start, call `list_illuminations(status=open)` to see what the observer has identified. When you ship a feature that resolves an open illumination, call `mark_implemented` with that illumination's filename." Place this between step 0 (study specs and plan) and step 1 (choose implementation target). The implement agent already studies `IMPLEMENTATION_PLAN.md` and `specs/*`; illuminations become a third input — richer context with concrete code observations.

4. **Verify that `implement.ts` passes the required MCP variables.** Open `src/cli/commands/implement.ts` and confirm the `agent.run()` call passes `ILLUMINATION_SERVER_PATH`, `PROJECT_ROOT`, and `META_MEDITATIONS_DIR`. If not, add them — they are already resolved by `getIlluminationServerPath()` and `getMetaMeditationsDir()` from `src/cli/lib/assets.ts`.

5. **Write a unit test for the cross-agent closure case.** In `src/cli/tests/illumination-server.test.ts`, add a describe block: `"markImplemented called from implement session"`. The test: create a fixture illumination with `status: dispatched`, call `markImplemented(projectRoot, filename)`, assert `status: implemented` in frontmatter, assert `implemented_at` date is set, assert a git commit was made (mock `execSync`). This test already implicitly exists from T0700 but likely lacks the `execSync` assertion — add it. The new behavior being tested is not the function itself but the confirmation that the function is reachable from the implement agent's tool whitelist.
