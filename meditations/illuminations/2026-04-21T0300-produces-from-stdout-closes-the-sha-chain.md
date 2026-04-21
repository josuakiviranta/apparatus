---
date: 2026-04-21
status: open
description: Six illuminations (T2800–T0200) diagnosed tmux_tester's context blindness through analysis; the entire chain collapses to two JSON-emitting scripts + produces_from_stdout=true — no handler changes required.
---

## Core Idea

T0200 identified that `produces=` on tool nodes is a schema promise the handler never fulfills — tool output always lands in `tool.output`. But this is a red herring for the SHA bookend: `produces_from_stdout=true` already flattens the last stdout line as JSON into named context keys. A script that emits `{"pre_sha":"abc123"}` with `produces_from_stdout=true` injects `pre_sha` into pipeline context with no handler changes. The T2800–T0200 chain — six illuminations of analysis — converges to two scripts, two tool nodes, and a rubric update.

## Why It Matters

`tmux_tester` currently re-derives changed surfaces from `git log --stat` inside the session — a heuristic that already picked the wrong smoke this session (ran `tool.dot` for a schema/agent-handler change). Three illuminations (T2900, T3000, T3100) proposed fixes at the rubric layer and the plan-writer layer, but all three are no-ops until the upstream pipeline injects ground-truth context. The actual fix is in `illumination-to-implementation.dot`: two tool nodes bookending `implement` that capture `pre_sha` before and compute `changed_files` + `touched_surfaces` after.

`ToolNodeSchema.produces` (in `src/attractor/core/schemas.ts:44`) documents a contract the handler in `src/attractor/handlers/tool.ts` never delivers. Leaving it misleads future pipeline authors into writing broken nodes exactly as T0100 did. It should be removed from the schema — or implemented (3-line handler addition: store `stdout.trim()` under the named key) — as a distinct cleanup step that does not block the SHA bookend.

## Revised Implementation Steps

1. **Write `pipelines/scripts/capture-pre-sha.mjs`**: emit `{"pre_sha":"$(git rev-parse HEAD)"}` to stdout. One line of Node.js using `execSync`. No args needed — always runs in `cwd="$project"`.

2. **Write `pipelines/scripts/compute-changed-surfaces.mjs`**: accept `$pre_sha` as first arg, run `git diff --name-only $pre_sha HEAD`, categorize paths into coarse surface labels (`engine`, `agent`, `pipeline`, `schema`, `handler`, `test`, `spec`), emit `{"changed_files":"path1,path2,...","touched_surfaces":"engine,schema"}`. One file ≈ 30 lines.

3. **Edit `illumination-to-implementation.dot`**: insert `capture_pre_sha` node (type=tool, `script_file="scripts/capture-pre-sha.mjs"`, `produces_from_stdout=true`, `cwd="$project"`) on the `mark_dispatched → implement` edge; insert `compute_changed_surfaces` node (type=tool, `script_file="scripts/compute-changed-surfaces.mjs"`, `script_args="$pre_sha"`, `produces_from_stdout=true`, `cwd="$project"`) on the `implement → review_gate` success path.

4. **Update `src/cli/agents/tmux-tester.md` Phase 2**: replace the git-log inference block with: read `$changed_files` and `$touched_surfaces` from context; use `touched_surfaces` to select the smoke subset; fall back to `git diff --name-only HEAD~3 HEAD` only when both vars are empty (resume-without-SHA case).

5. **Remove `produces` from `ToolNodeSchema`** in `src/attractor/core/schemas.ts` (or implement it: in `tool.ts` `buildUpdates`, add `if (node.produces) updates[node.produces] = stdout.trim()`). Either way, the schema and handler must agree. Do not leave a documented attribute that silently does nothing.
