---
date: 2026-04-20
status: open
description: The tmux-tester rubric was edited to prefer `$verification_targets`, `$changed_files`, and `$touched_surfaces` over git-log inference, but no pipeline node produces those variables — making the rubric upgrade a silent no-op and leaving every run on the old fallback path; the detection gap is that `ralph pipeline validate` only scans `.dot` attribute strings, not rubric markdown, for unresolved `$var` references.
---

## Core Idea

`src/cli/agents/tmux-tester.md` was edited (it appears as modified in git status today) to add a preference clause in Phase 2 step 2: "read any `$verification_targets` / `changed_files` / `touched_surfaces` value already in your received context — upstream nodes may have supplied it, in which case prefer that over re-deriving from git." But `pipelines/illumination-to-implementation.dot` contains no node with `produces="changed_files"` or `produces="touched_surfaces"`, and plan-writer's JSON schema has no `verification_targets` field. The three variables the rubric now references are structurally absent from the pipeline.

At runtime, the agent reads empty context slots, silently falls back to `git log --stat` inference, and proceeds identically to before the edit. The rubric upgrade is a dead letter — the same wrong smoke selection that motivated T2800 will recur on the next run.

This is distinct from T2700 (schema description *actively overrides* rubric). Here the rubric passively references context that never arrives. The failure mode is degraded-but-silent: no crash, no validation error, no visible signal that the consuming side of a fix shipped without its producing side.

## Why It Matters

T2800 and T2900 were written and immediately reflected in a rubric edit, but neither fix's *pipeline side* has landed. The three-file contract for any verification improvement is:

1. **Producer** — a `.dot` node with `produces="changed_files, touched_surfaces"` (T2800's commit_push / tool-node change)
2. **Consumer** — the rubric `$var` reference (already done in tmux-tester.md)
3. **Schema** — `plan-writer.json` gains a `verification_targets` field; the `.dot` wires it to tmux_tester's context (T2900)

Applying the consumer-side edit first, ahead of the producer and schema, creates a visible change that does nothing. Worse: it masks the gap. A developer reviewing the git diff sees "tmux-tester.md updated to use structured context" and may assume the fix landed, when the actual runtime path is unchanged.

`ralph pipeline validate` prevents this class of bug for `.dot` attribute strings — it scans `prompt=`, `script_args=`, and `label=` for `$var` patterns and warns when the variable has no declared producer in the graph. But rubric markdown files are outside that scan. `src/cli/agents/tmux-tester.md` references `$verification_targets` in free prose; no tool notices that nothing in the pipeline produces it.

This gap will recur. Every future rubric that anticipates upstream context before the upstream producer ships creates the same silent pseudo-fix.

## Revised Implementation Steps

1. **Ship T2800(a) first.** Add a store-or-tool node near the top of `illumination-to-implementation.dot` that runs `git rev-parse HEAD` and stores `git_base_sha`. Extend `commit_push` (or add a thin tool-node after it) to emit `changed_files` via `git diff --name-only $git_base_sha..HEAD`. Emit `touched_surfaces` from `changed_files` using a lookup against a new `pipelines/surfaces.json` prefix map. Both must appear in `produces=` so the engine's preflight validator tracks them.

2. **Wire the new variables to tmux_tester.** In the `.dot`, add `changed_files` and `touched_surfaces` to the set of context values the `tmux_tester` node receives. They are already in context after step 1 — no new produces= declaration needed on tmux_tester's own node, just confirm the preflight checker can trace the path.

3. **Ship T2900(a) in the same PR.** Edit `src/cli/agents/plan-writer.md` step 4 to require a `## Verification targets` sub-section per chunk. Extend `pipelines/schemas/plan-writer.json` to add a `verification_targets` field (following the rubric-authority rule from T2700: schema description is a short pointer, semantics live in the rubric). Wire `verification_targets` from plan-writer output into tmux_tester's context in the `.dot`.

4. **Add rubric-variable scanning to `ralph pipeline validate`.** For each agent node in a `.dot`, resolve the agent's markdown rubric path via the agent registry. Parse the rubric for `\$[a-z_]+` patterns in prose sections (not code blocks). Emit a warning — not an error — for each pattern whose variable has no declared producer in the graph. This converts the current silent failure into a detectable advisory at authoring time. The warning level (not error) preserves authoring flexibility while surfacing the gap before a run.

5. **Write a lint test** that covers the new rubric scanner: fixture rubric references `$nonexistent_var`, corresponding `.dot` has no producer — scanner emits warning. Fixture rubric references `$changed_files`, `.dot` has a node with `produces="changed_files"` — no warning. Place under `src/cli/tests/commands/pipeline-validate.test.ts` where the existing validate-command tests live.
