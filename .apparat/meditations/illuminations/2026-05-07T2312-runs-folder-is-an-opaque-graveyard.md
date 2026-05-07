---
date: 2026-05-07
description: .apparat/runs/ is a flat bag of 8-char UUIDs with no per-pipeline bucketing, no `pipeline runs` history command, no outcome filter, and an mtime-only GC that lets a crash-loop in one pipeline evict the only successful run of another — so the human can never answer "what has my janitor pipeline been doing this week?" without grepping checkpoint.jsons by hand.
---

## Core Idea

`<project>/.apparat/runs/` already holds gold — `checkpoint.json`, `pipeline.jsonl`, per-node `prompt.md` + `raw-attempt-N.txt` + `status.json` — for every recent run. But the dir is a **flat bag indexed by 8-char UUID** (`src/cli/commands/pipeline/run.ts:148` → `randomUUID().slice(0, 8)`) with no per-pipeline bucketing and no command that reads across runs. To answer "what failed yesterday?" or "show me the last 5 janitor runs" the human must `ls -lt .apparat/runs/` to see UUIDs, then `cat <id>/checkpoint.json | grep` to bucket each by pipeline name, then `cat <id>/pipeline.jsonl | tail` for outcome. The data is on disk; the seam is missing. On top of that, `gcOldRuns` (`src/cli/commands/pipeline/runs-gc.ts:43-58`) keeps the newest 50 by mtime regardless of pipeline or outcome — so a 4-min `meditate` crash-loop this morning evicts last week's only successful `illumination-to-implementation` run that the human still wanted to inspect.

## Why It Matters

Three prior pipeline-management illuminations (mission-control fragmentation, two-run-homes-no-cross-project-view, pipeline-failure-handoff-is-shallow) all touch the same shape — *the system has the data, the deep view that joins it doesn't*. They fix a single point in time: **mission-control** deepens the static pipeline list with last-run, **failure-handoff** deepens the post-failure footer, **two-run-homes** flags that scheduled runs land elsewhere. None of them give the human a **time-axis history view**. The runs dir on this very repo currently holds **70+ entries** spread across at least eight distinct pipeline names (meditate, janitor, illumination-to-implementation, smokes), and nothing in the CLI lets me ask "show me janitor runs only" without bash gymnastics.

Concrete waste:

- **No `pipeline runs` command.** `pipeline list` lists pipelines; `pipeline trace <runId>` inspects one run; nothing lists runs. The Skill reference (`src/cli/skills/apparatus/pipelines.md` §1 step 7) sends authors to `pipeline trace <runId>` but never tells them how to *find* a runId other than parsing the failure footer.
- **UUID is opaque.** A 32-bit-truncated UUID is short for typing, but identical for humans — `533e1a8c` vs `5836ed5f` (both real entries here, both janitor) carry zero hint about pipeline, time, or outcome. The runId is computed (`run.ts:148`) without ever consulting the pipeline name.
- **GC bucket is the whole project, not the pipeline.** `APPARAT_RUNS_KEEP=50` defends against unbounded growth but ignores composition: a 50-iteration `meditate` smoke-loop poisons history for every other pipeline that ran less recently. The vision frames apparat as "delegating to someone who already understands the shape of the problem"; an evictable history is amnesia, not delegation.
- **Useful runs ≡ noisy crashes.** Several runs in this dir have only `start/status.json` — they crashed before the first real node. They occupy a slot in the keep-50 window. A retention policy that distinguishes "had at least one successful node" from "instant crash" would cost nothing and double the effective history depth.
- **Daemon-scheduled runs split off.** `~/.apparat/logs/<taskId>/` (called out by *two-run-homes*) means even a perfect `pipeline runs <name>` on the project side misses scheduled runs. Until the schemas converge, the history view is a half-truth.
- **The pipeline-end JSONL event already carries outcome + duration.** `src/attractor/tracer/jsonl-pipeline-tracer.ts:51-58` emits `pipeline-end` with `outcome` and timestamps. A single read of the trailing line of every `pipeline.jsonl` would synthesize a runs table — no new tracer fields, no schema migration. The information is *in the file*, just not joined.

Strategic compass: VISION.md scopes apparat to **one human, one machine, many projects, many pipelines**. Time-axis history is what makes "many" tractable. Without it, the solo human reverts to memory ("I think the last janitor run was Tuesday?"). The `the-filesystem-as-agent-memory` lens applies inversely — the agent's filesystem memory is exemplary, but the *human's* index over that memory is missing. The `deep-modules-hide-complexity` lens applies: a single `pipeline runs` command would be a deep adapter over the existing JSONL fan-out — caller learns one symbol, gets a chronological projection that today requires multi-command grep.

## Revised Implementation Steps

1. **Add `apparat pipeline runs [<name>] [--limit N] [--failed] [--project <dir>]`** at `src/cli/commands/pipeline/runs.ts`. Walks `runsDir(project)` (`src/cli/lib/apparat-paths.ts`), reads each subdir's `pipeline.jsonl` trailing `pipeline-start` + `pipeline-end` events, and emits a fixed-shape table: `runId · started · pipeline · outcome · duration · failed-node?`. Optional `<name>` filters to one pipeline. `--failed` filters to non-success outcomes. Sorted by start time, newest first. No new tracer fields — pure read across existing JSONL.

2. **Bucket the GC by pipeline.** Replace the flat `gcOldRuns(runsRoot, 50)` (`src/cli/commands/pipeline/runs-gc.ts:43-58`) with `gcOldRunsPerPipeline(runsRoot, perPipelineKeep)`: group entries by pipeline name (read from `pipeline.jsonl` trailing line — fall back to "unknown" for crashed-at-start dirs), keep the newest K per group. Default K = 10 per pipeline; `APPARAT_RUNS_KEEP_PER_PIPELINE` overrides. Crashed-at-start entries get their own "unknown" bucket with K=5 so churn doesn't evict real history.

3. **Demote crash-at-start dirs to a stricter retention.** A run dir with no `pipeline-start` event in its `pipeline.jsonl` (or no `pipeline.jsonl` at all) is noise — keep at most 5 of those across the project, evict aggressively. The signal is already trivially detectable in the same scan that step 1 does.

4. **Compose the runId from pipeline-name + UUID prefix.** Change `run.ts:148` from `randomUUID().slice(0, 8)` to `<pipeline-name-slug>-<uuid8>` (e.g. `janitor-533e1a8c`). The runId stays globally unique, but `ls .apparat/runs/` becomes self-describing. Update `pipeline trace <runId>` to accept either form (back-compat with bare 8-char ids that exist on disk today).

5. **Print "previous runs" hint inside the failure footer.** When `pipeline-failure-handoff-is-shallow` lands its 4-line failure footer, append a fifth: `history: apparat pipeline runs <name> --failed --limit 5`. The human just hit a failure — the next thing they want to know is "is this regressing or is this new?". One command answers it.

6. **Make `pipeline runs` reach into both run homes.** Add a second walker that reads `~/.apparat/logs/<taskId>/pipeline.jsonl` (the daemon-scheduled side, called out in *two-run-homes-no-cross-project-view*) and merges its rows into the same table with a `source: scheduled|interactive` column. This is the missing-CRUD step on the run axis — once `pipeline runs` exists, the cross-home gap from *two-run-homes* collapses by extension rather than a separate command.

7. **Surface in `pipeline list`.** When the mission-control deepening lands (showing last-run outcome+runId per pipeline), make the `last-run` line a tappable hint: `last-run: <runId> ✓ (5m ago) — apparat pipeline runs <name>`. The list answers "what's the latest" and the runs command answers "what's the trend"; today neither exists.
