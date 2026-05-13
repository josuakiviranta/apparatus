---
date: 2026-05-13
description: ADR-0015 only GC's green-run scratch; its failure-preserve half (18 meditate triages + 4 parallel-implementation crash triages + 50+ sessions) has no reaper, and ADR-0015's own claim that "sessions are institutional memory" was contradicted by the operator within 24 hours — the asymmetric-GC ADR needs a second pass.
---

## Core Idea

ADR-0015 ("asymmetric GC pipeline tail success") cleanly handles the green-run half: success → `rmSync` of `.apparat/runs/<id>/` and `.apparat/meditations/illuminations/.triage/<id>/`. The other half — non-success → preserve forever — has no reaper. Failed runs accumulate without bound, and the same ADR's classification of `.apparat/sessions/` as "institutional memory" was contradicted by an open operator note (now marked picked) within 24 hours. The CRUD-as-checklist lens applies: ADR-0015 shipped create + read + a partial delete, never the delete for preserved-failures, and miscategorised one substrate.

## Why It Matters

The failure-preserve sediment is sitting on disk right now:

- `.apparat/meditations/illuminations/.triage/` — 18 directories. **4** of them are `parallel-illumination-to-implementation-*` (8a7fcaf4, d1e37dba, df12c8e4, df1d9cf6) — these are ADR-0015-correct preserves (the spider crashed, so the failure-half retains them). The other 14 are UUID-only meditate failures. Both kinds keep growing because nothing reaps the preserved half.
- `.apparat/meditations/stimuli/.triage/` — 13 more directories. ADR-0015 enumerates only the illumination triage path; the stimuli triage path is not even in scope of the ADR but exhibits the same accumulation.
- `.apparat/sessions/` — 50+ files (2026-04-13 → 2026-05-12). ADR-0015 classifies sessions alongside specs/illuminations/stimuli as "institutional memory that survives context resets" (cf. rejection of universal `lifecycle:` frontmatter). But the operator's own notes — both marked `[x]` and the existing illumination `2026-05-12T2255-doc-drift-tail-for-parallel-implementation.md` — call sessions dead. ADR-0015's rationale rotted in 1 day. A reader who consults the ADR today will draw a wrong conclusion about what to preserve.
- `.apparat/.apparat/` ghost (containing the 2026-05-12T1028 stranded illumination and a meditate-4ab00e87 run) — out of ADR-0015's scope because it's a path-typo bug, not a runs/.triage/ accumulation. But the **fix profile is the same**: an `apparat janitor sweep` operator surface.
- Two `.mcp-meditate-*.json` orphans (1777197355164, 1778663029267) sit at repo root. Same fix profile.

The stimulus `open-close-push-pull-lock-unlock` puts it directly: ADR-0015 built the close half for green, not for red. Red runs need a pair too — not "preserve forever," but "preserve for N days / N failures, then reap."

This connects three existing illuminations into one ADR-level fix:
- `2026-05-13T0805-scratch-sediment-needs-an-apparat-sweep-command.md` — proposed `apparat janitor sweep` operator surface.
- `2026-05-12T2255-doc-drift-tail-for-parallel-implementation.md` — kill memory-writer's `.apparat/sessions/` write.
- `2026-05-13T0736-meditate-no-project-orientation-and-mcp-orphans.md` — `.apparat/.apparat/` ghost + `.mcp-meditate-*.json` orphans.

Each is tactical. The deeper fix is to **revise ADR-0015** so the failure-preserve half has a documented reaper policy, and to **demote `sessions/` from "memory" to "trash"** in the same ADR pass.

## Revised Implementation Steps

1. Open `docs/adr/0016-failure-preserve-reaper-and-sessions-demotion.md`. Supersede the two clauses in ADR-0015 that misclassify: (a) add a reaper for `.apparat/runs/<id>/` and both `.triage/<id>/` paths on the failure-preserve half — policy: keep newest K failures per pipeline (default `APPARAT_FAILED_KEEP=5`), evict older; (b) reclassify `.apparat/sessions/` from "institutional memory" to "trash" and remove the memory-writer producer that writes there.
2. Implement the reaper next to the existing `gcOldRunsPerPipeline` in `src/cli/commands/pipeline/runs-gc.ts`. Run from the same `onPipelineStart` tracer hook but key the bucket on `(pipeline, outcome=failed)`. Add `.apparat/meditations/stimuli/.triage/` to the swept-paths list — ADR-0015 missed it and 13 dirs already sit there.
3. Ship `apparat janitor sweep` (or `apparat gc`) operator command per `2026-05-13T0805`. It must cover: `.apparat/.apparat/` ghost, root-level `.mcp-meditate-*.json` orphans, pre-rule failed-run accumulation. `--dry-run` mandatory. This is the manual-trigger pair for the automatic reaper from step 2.
4. Delete `.apparat/pipelines/illumination-to-implementation/memory-writer.md`'s `.apparat/sessions/` write and the corresponding `memory-reflector.md` read. One PR per `2026-05-12T2255`'s plan; the doc-drift checker that replaces it is its own step.
5. Hoist `.apparat/.apparat/meditations/illuminations/2026-05-12T1028-collapse-memory-tail-and-tier-pipeline-models.md` out of the ghost folder into `.apparat/meditations/illuminations/` before sweeping the ghost — there is a live illumination stranded in the buried path that `list_illuminations` cannot see.
6. Add a `pipeline validate` rule (or a new `apparat audit`) that fails when a new top-level `.apparat/<thing>/` directory is added in git without a corresponding ADR clause naming both its writer **and** its reaper. ADR-0015 set the precedent for "every preserve has a reaper"; codify it so the next substrate cannot land half-finished.
7. Update `README.md` and `CONTEXT.md` once steps 1–4 are in: `APPARAT_RUNS_KEEP` is greens-only and now paired with `APPARAT_FAILED_KEEP`; `.apparat/sessions/` no longer exists. Without doc updates, ADR-0015's stale prose stays canonical for the next reader.
