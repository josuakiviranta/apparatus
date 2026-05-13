---
date: 2026-05-13
description: ADR-0015 wired forward tail GC on green runs but explicitly deferred retroactive cleanup — today 32 .triage/ orphans, the ghost `.apparat/.apparat/`, `.mcp-meditate-*.json` orphans, and ~50 dead `.apparat/sessions/` files all share one missing primitive: an `apparat gc`/`apparat janitor sweep` operator surface; meanwhile the existing `janitor` pipeline is read-only by ADR, so its name is a lie.
---

## Core Idea

ADR-0015 (`docs/adr/0015-asymmetric-gc-pipeline-tail-success.md`) installed `gcRunScopedArtefactsOnSuccess` at the pipeline tail and **explicitly deferred** retroactive cleanup of pre-rule sediment to "a sibling `chore` commit at the operator's discretion." Three months in, that chore is the missing primitive. The last five illuminations all point at the same hole from different angles: 32 orphan `.triage/<run_id>/chat-notes.md` dirs (`.apparat/meditations/illuminations/.triage/*` and `.apparat/meditations/stimuli/.triage/*`), the ghost `.apparat/.apparat/` subtree, `.mcp-meditate-1777*.json` + `.mcp-meditate-1778*.json` orphans at the repo root, and ~50 unread `.apparat/sessions/*.md` files. There is no `apparat` surface to sweep any of it — only `rm -rf` from memory. And the pipeline literally named `janitor` (`src/cli/pipelines/janitor/janitor.md`) is read-only by ADR-0015's own description — it can `Grep` and read illuminations but cannot delete a single byte. The name is a lie.

## Why It Matters

The forward half of GC is solved: green-tail `gcRunScopedArtefactsOnSuccess` (`src/cli/commands/pipeline/runs-gc.ts:105`) keeps disk bounded for new runs. The backward half is doing what solo-developer side projects always do — accreting silently until someone (me, eventually) feels the friction. Evidence on disk today:

- **32 `.triage/<run_id>/chat-notes.md` dirs** — survived because they pre-date ADR-0015 (forward-only rule). Each is run-scoped scratch with no consumer.
- **Ghost `.apparat/.apparat/`** — the very symptom 2026-05-13T0736-meditate-no-project-orientation-and-mcp-orphans.md flagged this morning; a real run directory written underneath the apparat folder because `apparat meditate <path>` accepts any path.
- **`.mcp-meditate-1777197355164.json` + `.mcp-meditate-1778652214941.json`** at repo root — crash-leaked MCP config files. Same illumination noted these.
- **~50 `.apparat/sessions/*.md`** — illumination 2026-05-12T2255-doc-drift-tail-for-parallel-implementation.md recommended killing the memory-writer sessions write entirely. The writes still happen; the old payload still sits.
- **The `janitor` pipeline** — `src/cli/pipelines/janitor/janitor.md` declares only `Grep` + `mcp__illumination__*`. It is a *review* pipeline named janitor. A future operator will reach for it expecting sweep semantics and bounce.

Vision check: the spider/web model says agents are *apparatchiks* doing one job. A janitor that cannot sweep is not an apparatchik. It is decoration. And the solo-developer thesis — single human, single machine — only works if disk hygiene stays in-tool, because there is no shared CI sweeper coming to save us.

## Revised Implementation Steps

1. **Promote `gcRunScopedArtefactsOnSuccess` shape into an operator command.** Add `apparat gc` (or `apparat janitor sweep` — see step 5 for the naming call) that scans `<project>/.apparat/runs/*`, `<project>/.apparat/meditations/illuminations/.triage/*`, `<project>/.apparat/meditations/stimuli/.triage/*`, and root-level `.mcp-meditate-*.json`. Default is dry-run — print the list, exit. `--apply` actually deletes. Reuses `rmSync(..., { force: true })` exactly like the tail helper.

2. **Add a ghost-folder detector.** If the resolved project path's basename is `.apparat` (or contains `.apparat/.apparat/`), exit 1 with a one-line hint pointing at this illumination + 2026-05-13T0736. This is the preflight the previous illumination called for, surfaced through the new sweep command's pre-checks.

3. **Decide on `.apparat/sessions/` once.** Either (a) drop the memory-writer session-write per 2026-05-12T2255's recommendation and have `apparat gc` clean the residue, or (b) keep writing but rotate. Pick one, encode in `docs/adr/`, then have the sweep command act on the policy. Today both directions are open and the folder grows.

4. **One short test.** A vitest that seeds a temp project with one pre-rule `.triage/<runId>/`, one ghost subfolder, and one `.mcp-meditate-*.json`, runs `apparat gc --apply`, asserts the three paths gone and the legit `.apparat/runs/<active>/` survives. Lives next to `src/cli/tests/post-tail-gc.test.ts`.

5. **Fix the `janitor` name.** Two options, pick one in the same PR: (a) rename `src/cli/pipelines/janitor/` to `src/cli/pipelines/review/` and route the sweep command through a new bundled pipeline-or-CLI named `janitor`, or (b) keep the read-only pipeline as `janitor` and call the sweep `apparat gc` permanently (sweep is too imperative to be a multi-node pipeline anyway). Option (b) is cheaper and matches the deep-modules stimulus — one CLI subcommand, no graph, no agent prompt overhead, fully testable. Recommend (b).

6. **Update README + ADR.** ADR-0015 footnote pointing at the new `apparat gc` command closes the "operator's discretion" loop the original ADR left dangling. README's GC section now says: *forward sweep on green-tail, manual sweep on demand, red runs preserved both ways*.

7. **One-shot sweep of the current sediment.** After steps 1–5 land, run `apparat gc --apply` on this repo and commit the deletion. The 32 `.triage/` dirs + 2 `.mcp-*.json` + the ghost folder go away in one diff with a message that cites ADR-0015's deferred chore.
