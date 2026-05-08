---
date: 2026-05-08
description: static-multi-node scenario broken: pipeline.dot declares agent="node_a" but folder ships node-a.md, so pipeline run fails — surfaces a wider hyphen/underscore convention gap between DOT ids and agent files.
---

## Core Idea

`apparat pipeline run .apparat/scenarios/static-multi-node/pipeline.dot` fails because the agent resolver looks for `node_a.md` (the DOT `agent="node_a"` value) while the folder ships `node-a.md` — and three other nodes match the same pattern. The narrow fix is a rename; the underlying point is that DOT identifier rules disallow hyphens in node ids, so authors who hyphenate filenames will silently desync agent attributes from sibling agent .md files. Either the resolver normalizes hyphen↔underscore on lookup, or the validator catches `agent="X"` referencing a missing `X.md`, or the convention is pinned to one separator and enforced.

## Why It Matters

- The static-multi-node scenario has been live but unrunnable; tmux-tester surfaced it during the `pipeline-list-hides-half-the-roster` run (memory file flags it as untouched-by-this-diff).
- This is a foot-gun for anyone copying `static-multi-node` as a template — DOT ids cannot use hyphens (`graphviz` parser rejects them), but the project's other conventions (folder names, illumination slugs, file slugs) lean hyphenated. The mismatch is silent today: validator treats a missing agent `.md` as a runtime miss rather than a preflight error.
- A separate signal: this scenario has no smoke vitest covering it, which is why the breakage went unnoticed until a manual `pipeline run` invocation. Whichever fix path is taken, a smoke test for `static-multi-node` would tighten the loop.

## Revised Implementation Steps

1. Reproduce: `apparat pipeline run .apparat/scenarios/static-multi-node/pipeline.dot --project .` — capture the exact "agent file not found" error and the lookup path the resolver tried.
2. Pick a direction (one, not all):
   - **Narrow:** rename `node-a.md|node-b.md|node-c.md` to `node_a.md|node_b.md|node_c.md` in `.apparat/scenarios/static-multi-node/` so files match the DOT ids verbatim. One commit, no code changes.
   - **Resolver normalization:** in the agent loader (search `src/cli/lib/` for the function that maps `agent="X"` → `X.md`), try `${agent}.md` first, then fall back to `${agent.replace(/_/g, "-")}.md`. Add a unit test that a DOT id `node_a` resolves both `node_a.md` and `node-a.md`.
   - **Validator hint:** in the pipeline validator (look for the rule set under `src/cli/lib/pipeline-validator*`), emit a diagnostic when `agent="X"` has no matching sibling `X.md` (and surface the hyphenated candidate in the hint when one exists).
3. Whichever path wins, add a smoke vitest for `.apparat/scenarios/static-multi-node/pipeline.dot` to `src/cli/tests/` so future drift becomes a red test rather than a silent runtime miss.
4. If a convention is pinned (e.g. "agent files mirror DOT ids verbatim, both underscore"), record it in `CONTEXT.md` next to the existing two-tier resolver discussion and in `src/cli/skills/apparatus/pipelines.md` so authors stop colliding with DOT id rules.

## Provenance

- Source memory: `.apparat/sessions/2026-05-08-pipeline-list-hides-half-the-roster.md`
- Pipeline run id: `3dbc24b8`
- Surfaced by: memory-reflector
