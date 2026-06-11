---
source: https://www.youtube.com/watch?v=EJyuu6zlQCg
date: 2026-05-21
description: Agent that decomposes plans into thin vertical slices cutting through every integration layer — frontend, backend, persistence, infra — rather than horizontal slices that complete one layer across all features before moving down.
---

# Vertical Slices Over Horizontal Layers

When breaking a PRD into issues, the wrong move is to schedule "build all the backend, then all the frontend, then wire it up." That is a horizontal decomposition. It feels efficient because each layer is internally consistent, but it hides the only thing worth learning early: whether the layers can actually meet.

The right move is **thin vertical slices**: each issue cuts through every integration layer for one narrow piece of behavior. End to end, smallest viable path, real wiring. The next slice does the same for a different piece. The system grows in depth-first columns, not breadth-first rows.

## The Tracer Bullet Analogy

The reason is the tracer bullet. A horizontal plan defers contact between the parts; a vertical slice fires through all of them on day one. If the trajectory is wrong — auth doesn't hand off correctly, the data shape doesn't survive the serializer, the integration point you assumed exists doesn't — you find out immediately. Cheap to redirect now. Expensive once three more horizontal layers have been built on top of the wrong assumption.

This is why the first vertical slice should target the **highest-unknown** part of the system. New integration? Unfamiliar service? Two components that have never spoken before? That goes first. The first slice's job is not to deliver the most visible feature; it is to surface the most unknown unknowns.

## What This Looks Like as Issues

A PRD becomes a small list of vertical slices with explicit blocking relationships:

- **Slice 1** — the engine, or the riskiest seam, with tests. If this can't work, nothing downstream matters.
- **Slice 2** — an independent slice that doesn't depend on Slice 1; can run in parallel.
- **Slice 3** — depends on Slice 1's interface; runs after.
- **Slice 4** — depends on Slice 2; runs after.

The blocking graph matters because it's also a parallelism graph. Independent slices can be picked up by separate agents simultaneously. A horizontal plan has no such graph — every "frontend" issue secretly depends on every "backend" issue finishing first, even though nothing in the issue text says so.

## Why Agents Especially Need This

Agents will gladly produce a layer-complete-but-unwired backend, declare the issue closed, and move on. The output looks done. The scenario test that would expose the gap was never written, because there was nothing on the other end to integrate with. Three issues later, the wiring step discovers the backend's shape is wrong, and now there is rework across all three.

A vertical slice forces the integration to exist on the first commit. The scenario test that exercises the slice end-to-end is buildable immediately, because every layer the test traverses already exists in some thin form. The agent cannot declare done without the full path working.

## How to Apply

- When decomposing a PRD, the first question is *"what's the smallest end-to-end path through every layer this feature touches?"* — not *"which layer comes first?"*
- Sequence by **unknown risk**, not by layer depth. Highest unknown goes first.
- Each slice produces a demoable artifact: one user-visible behavior that runs from input to output through the real stack.
- Each slice ships with a scenario test that exercises the full path. If the test can't be written because one layer is missing, the slice isn't vertical enough.
- Encode blocking relationships explicitly. Slices that don't block each other run in parallel.

## When Horizontal Is Acceptable

Inside a single vertical slice, you may still order work layer-by-layer for a few hours — that's just intra-slice sequencing, not plan structure. The rule is about how the **plan** is decomposed, not how a single slice is implemented.

The other exception is a pure-substrate change: a migration, a dependency upgrade, a refactor with no user-visible behavior. Those have no vertical to slice into. Treat them as their own kind of work and don't force the vocabulary.

## Carrying It Forward

When an agent proposes a plan that reads "Phase 1: backend. Phase 2: frontend. Phase 3: integration," push back. That is a horizontal plan wearing phase-numbered clothing. Ask for the same work re-sliced as vertical columns ordered by risk. The plan will be uglier, less symmetric, and far more likely to surface the problem that actually kills the project.
