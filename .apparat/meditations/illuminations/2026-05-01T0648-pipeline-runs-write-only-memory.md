---
date: 2026-05-01
description: Pipeline runs persist rich JSONL state under ~/.apparat/<projectKey>/runs/<runId>/ but the CLI exposes no `runs` list — `pipeline trace` requires a runId you can only discover by triggering --resume errors or shelling into the directory, making the per-run memory effectively write-only.
---

## Core Idea

Every `pipeline run` writes a UUID-prefixed directory under `~/.apparat/<projectKey>/runs/<runId>/` containing `pipeline.jsonl`, `checkpoint.json`, and per-node raw outputs — a structured agent memory that survives sessions and crashes. But ralph offers **no command to enumerate it**. `pipeline trace <runId>` requires a runId, `pipeline list` only walks `pipelines/*.dot`, and `--resume` lists runs only as a side-effect of failing. The persistent memory is real; the read interface is missing.

## Why It Matters

Treating the filesystem as agent memory (per `the-filesystem-as-agent-memory` lens) only pays off when the memory is *enumerable*. Current state forces three workarounds, all hostile:

1. `ls ~/.apparat/$(node -e "...derive key...")/runs/` — user must reproduce `deriveProjectKey()` in their head (`src/cli/commands/pipeline.ts:55`).
2. Trigger an intentional `--resume` ambiguity error to print the list (`pipeline.ts:82`).
3. Open `~/.ralph` and grep — but cross-project runs share that root and the `<basename>-<6 hex>` keys aren't human-greppable.

`gcOldRuns` keeps **50 runs by default** (`pipeline.ts:108`), so users routinely accumulate dozens of anonymous, unreachable artifacts. `findRunAcrossProjects` already walks the global root for `pipeline trace`, so the listing helper exists in spirit — it just isn't exposed.

This also blocks vision-aligned UX: the steer asks for "simpler pipeline running," and the project frames pipelines as web-of-agents whose work-product is the run trace. Making prior runs invisible breaks the audit/inspection promise the JSONL tracer was built for.

The duplication tax is concrete: `resolveResumeLogsRoot` (lines 80–106), `gcOldRuns` (lines 113–124), `listAllProjectRunsRoots` (lines 405–414), and `findRunAcrossProjects` (lines 419–429) each re-walk the same directory shapes with slightly different filters. A shared `enumerateRuns()` would collapse all four.

## Revised Implementation Steps

1. **Extract** `enumerateRuns(projectDir?: string): RunSummary[]` in `src/cli/lib/pipeline-resolver.ts` (or new `runs-store.ts`). One function reads run dirs, peeks `pipeline.jsonl` for `pipeline-start`/`pipeline-end` events, and returns `{ runId, projectKey, startedAt, endedAt, outcome, nodeCount, pipelineName }`. Reuse from `resolveResumeLogsRoot`, `gcOldRuns`, `listAllProjectRunsRoots`, `findRunAcrossProjects`.

2. **Add `ralph pipeline runs [list]` subcommand** in `program.ts` and `pipeline.ts`. Default: scoped to cwd's project (or `--project`), shows last 20 runs (`--all` to see global, `--limit N`). Columns: `runId · pipeline · startedAt · status · duration · nodes`.

3. **Add `ralph pipeline runs show <runId>`** as a friendlier alias for the existing `pipeline trace <runId>` — same code path, but discoverable from the `runs list` flow. Keep `trace` as the deeper inspection command.

4. **Update the multi-run `--resume` error message** in `pipeline.ts:99` to say `Run \`ralph pipeline runs list\` to choose one.` instead of inlining the list — same data, single source of truth.

5. **Surface in top-level help** (`program.ts:24`): add a "Inspecting runs" block to the after-help text alongside "Pipeline engine".

6. **Test**: one integration test that runs a smoke pipeline twice, asserts `runs list` shows both with correct status, and `runs show <runId>` returns the same JSON shape as `trace`.

7. **(Optional, deferred)** Once this lands, evaluate whether the project-key hashing scheme (`<basename>-<6 hex>`) still earns its keep — the only callers will be `enumerateRuns` and `pipeline run`, and a flat `~/.apparat/runs/<runId>/` with `project` recorded in the trace might be simpler. Don't tangle this with the runs-list ship.
