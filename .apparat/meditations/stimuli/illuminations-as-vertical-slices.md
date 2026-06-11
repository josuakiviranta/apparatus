---
source: human-meditations
date: 2026-05-21
description: Agent that authors illuminations as vertical slices through every layer the concept touches — client, server, storage, math, tests — rather than horizontal illuminations that describe one layer in isolation, because the parallel-illumination-to-implementation pipeline traverses the illumination end-to-end and only vertical illuminations produce scenario-testable artifacts at the tail.
---

# Illuminations as Vertical Slices

The illumination is the unit of work that flows through `parallel-illumination-to-implementation`. It enters as a markdown file, becomes a design, becomes a plan, becomes a DAG of parallel implementation chunks, and exits through tmux-tester verification before the doc-drift-sync tail. The shape of the illumination determines the shape of everything downstream.

The wrong shape is **horizontal**: an illumination that scopes "all the storage tables for feature X" or "the server endpoints for feature Y" without touching the layers above or below. The plan_writer produces a horizontal plan. The batch_orchestrator dispatches chunks that complete a layer. The tmux_tester has nothing end-to-end to exercise, because no path through the stack was built. The pipeline finishes "green" with an unwired backend.

The right shape is **vertical**: an illumination that picks one narrow piece of behavior and follows it through every layer it touches — UI/client → API/server → storage → math → tests — at the smallest viable depth in each layer. The plan_writer produces a plan whose chunks are also vertical (or at least share a single integration target). The tmux_tester can verify a real scenario. The doc-drift-sync tail has something coherent to record.

## What Vertical Looks Like in Practice

Look at `2026-05-19T1010-ambient-match-tier-1-edge-discovery.md` for a working example. The illumination cuts a column:

- BLE GATT protocol in `lib/services/ble/tier1_protocol.dart` (transport)
- Sketch builder in `server/matching/sketch.py` + `lib/matching/sketch.dart` (data)
- Handshake in `lib/services/ble/tier1_handshake.dart` (wire)
- On-device inner product in `lib/matching/tier1_score.dart` calling Rust at `rust/skme/` (math)
- Notification surface in `lib/services/notifications/tier1_notification.dart` (UX)
- Integration test asserting one row in `copresence_evidence`, zero rows in `accepted_pairs` (scenario)

Every layer the Tier 1 concept touches is present at thin depth. Tier 2/3 and Heatmap accrual live in **sibling** illuminations that cut their own columns through the same ADR. The vertical column matters more than the layer completeness.

## The Sibling Pattern

Look at how `2026-05-19T1020-linger-trace-and-heatmap-aggregation-impl.md` handles UI:

> UI consumption — colour ramp, blending, gesture handling — is **scoped OUT** of this illumination and lives in `2026-05-19T1035-heatmap-ui-impl.md`. This file ends at "client has `{cell_id: brightness_scalar}` in memory."

This is the discipline: when a concept naturally spans more behavior than one vertical slice can carry, **split into siblings** rather than absorbing layers into one fat illumination. Each sibling is its own vertical column. The hand-off point between siblings is a concrete artifact (`{cell_id: brightness_scalar}` in memory) — the same artifact-gate pattern used everywhere else.

Two siblings cutting two columns are easier to ship, easier to verify, easier to parallelize through the pipeline than one illumination trying to be both the backend writer and the UI renderer.

## Why the Pipeline Amplifies This

`parallel-illumination-to-implementation` schedules chunks in parallel via `plan_scheduler` + `batch_orchestrator`. Parallelism only helps if the chunks have well-defined integration points. A horizontal illumination produces chunks that all converge on the same "wire it up" step at the end — sequential disguise wearing parallel clothing. A vertical illumination, split into well-defined siblings, produces chunks that can genuinely run independently because the seams between them are explicit.

The tmux_tester at the tail can only verify what the illumination claims. If the illumination claimed "the backend writes the row," tmux_tester verifies a row. If the illumination claimed "a user lingering for 20 minutes results in a cell aggregate visible at K=10," tmux_tester verifies the full path. The latter is what convinces you the feature works; the former is what convinces you the layer compiles.

## Risk-First Ordering Inside the Slice

Within a vertical illumination, sequence the implementation steps by **unknown risk**, not by layer depth. The Linger Trace illumination starts at the stationary-cell detector (the highest-unknown integration with the platform location stream) before the nightly aggregator (mechanical). The Tier 1 illumination starts at the GATT protocol definition (the highest-unknown iOS-background reliability question) before the inner-product math (well-specified by the ADR).

This is the tracer-bullet logic carried inside one illumination: surface the unknown-unknown early, fail fast if the layer can't speak to the layer below it.

## The Pure-Substrate Exception

Some illuminations are deliberately horizontal: `2026-05-21T0900-storage-cutover-firestore-to-sqlite.md` is the canonical example. It changes the substrate the same way across many features (Protocol seams, table renames, dependency drops). There is no vertical to cut into — it is the *floor* under every vertical column.

Pure-substrate illuminations get a different shape: they enumerate the symbols they fix (Protocol names, table names) and list the sibling illuminations that depend on them. Their job is to stabilize the seams so the vertical illuminations above can land cleanly. Recognise them, but do not pretend the pattern generalizes — they are the exception that proves the rule.

## How to Apply When Authoring Illuminations

- Before writing implementation steps, ask: *what is the smallest end-to-end path through every layer this concept touches?* If the answer is "this only touches one layer," check whether that's because it's substrate work or because the slice is wrong.
- Each illumination should end with a concrete artifact or scenario the tmux_tester can verify. If you cannot describe what tmux_tester runs, the illumination is layer-incomplete.
- When a concept spans more than one column, **split into siblings** with explicit scope-out lines and a named hand-off artifact. The Linger / Heatmap UI split is the template.
- Order implementation steps by unknown risk, not by layer depth. The riskiest seam goes first inside the illumination, just as the riskiest slice goes first across illuminations.
- When reviewing an illumination before it enters the pipeline, ask: *what would tmux_tester actually run at the tail?* If the answer is "it would run a unit test of one layer," push back. The pipeline is built to verify scenarios. Feed it scenarios.

## The Failure Mode Worth Naming

Horizontal illuminations slip through the pipeline because every gate they pass is internally consistent. The design-writer writes a coherent design of one layer. The plan-writer writes a coherent plan to build one layer. The batch_orchestrator merges coherent chunks of one layer. The tmux_tester runs and passes — because it tests what was built, which is one layer. The doc-drift-sync records progress.

Nothing in the pipeline knows that the user wanted a feature, not a layer. That knowledge has to live in the illumination itself, at authoring time, before the pipeline ever sees it. Vertical illuminations carry that knowledge; horizontal illuminations launder it away.
