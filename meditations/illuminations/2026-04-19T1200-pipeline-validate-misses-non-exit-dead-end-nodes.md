---
date: 2026-04-18
status: done
description: `ralph pipeline validate` checks reachability from the start node but never checks reachability to the exit node, so any non-exit node with zero outgoing edges passes validation silently — the `mark_archived` dangling edge in illumination-to-implementation.dot is the concrete miss.
completed_at: 2026-04-18
resolution: Added reverse-BFS from exit in src/attractor/core/graph.ts, new `reaches_exit` error rule, 3 unit tests. Caught + fixed matching mark_archived dead-end in pipelines/illumination-to-plan.dot.
---

## Core Idea

`validateGraph()` in `src/attractor/core/graph.ts:261-525` runs a BFS from the start node to confirm every declared node is reachable (lines 274-286). It distinguishes exit nodes at line 266 — `const isExit = (n: Node) => n.shape === "Msquare" || n.id === "exit" || n.id === "end";` — and enforces that exit nodes have no outgoing edges. It does NOT run the complementary check: every non-exit node must have at least one outgoing edge (equivalently, a reverse-BFS from the exit must reach every non-exit node).

Concrete evidence of the gap: `pipelines/illumination-to-implementation.dot` declares `mark_archived` at line 18 as a reachable node (`approval_gate -> mark_archived [label="Decline"]` at line 68) with NO outgoing edge. The runtime effect is a hang or implicit-done when the user clicks "Decline" at the approval gate. But `ralph pipeline validate pipelines/illumination-to-implementation.dot` prints `✔ Pipeline valid (21 nodes, 28 edges)` — a false pass.

## Why It Matters

The validator's job is to catch authoring mistakes before they reach the engine. A non-exit node with zero outgoing edges is always a bug: the engine arrives, runs the node, and has nowhere to go. The only node that is allowed to be a sink is the single exit (shape=Msquare). Every other node must route somewhere, otherwise the pipeline has an unreachable exit from that subgraph.

This is structurally analogous to the forward-reachability check the validator already performs. Forward reachability confirms "every declared node can be reached" — preventing dead declarations. Backward reachability confirms "every declared node can reach the exit" — preventing dead ends. One without the other leaves a whole class of routing bugs undetectable by `validate`.

The cost of the missing check played out in real time during the 2026-04-19T1000 triage: an illumination about retry context discovered the `mark_archived` bug incidentally, not via validation. That means any other existing or future dangling-edge bug in a pipeline is only surfaced when the user hits the specific gate label at runtime. The user loses, silently.

## Revised Implementation Steps

1. **Add a `reachesExit` check to `validateGraph()` in `src/attractor/core/graph.ts`.** Reuse the existing `isExit` predicate (line 266) and the adjacency lookup already built for the forward BFS. Implement as reverse-BFS: enqueue the single exit node, traverse predecessors via the reverse adjacency, and collect the set of nodes that can reach the exit. For every node in `nodes` that is NOT the start sentinel and NOT in the reached set, push an error: `Node '<id>' has no outgoing edges and cannot reach the exit.`

2. **Handle the start node.** The start node (`shape=Mdiamond`) must itself reach the exit — if not, the whole pipeline is broken. Do not special-case it. The reverse-BFS naturally covers it. The existing forward-reachability check at lines 274-286 already rejects disconnected subgraphs from the other direction.

3. **Decide error vs warning.** Make it an error (pushes to the errors array, not warnings). A non-exit dead end is never a valid authoring choice — it is strictly a bug. No `--strict` flag needed.

4. **Add a unit test in `src/attractor/core/graph.test.ts`** (or the existing equivalent test file — check whichever is current) with two fixtures: (a) a minimal graph where a middle node has zero outgoing edges — expect validation to fail with the specific error message; (b) a minimal valid graph where every non-exit node routes to the exit — expect validation to pass. Keep the fixtures inline as dot strings, matching the style of existing validator tests.

5. **Re-run `ralph pipeline validate` against all pipelines in `pipelines/*.dot`** after the fix lands, not as part of the fix. If any existing pipeline fails the new check, that is a separate follow-on — those are real bugs the validator should have been catching. For `illumination-to-implementation.dot` specifically, the `mark_archived` dangling-edge fix is already bundled into the 2026-04-19T1000 triage scope, so the re-validation should pass for that file once both changes land.

6. **No new validator flag, no new config.** The check is always on. It is as foundational as the existing start-node and exit-node constraints. Authors who intentionally want a dead-end node do not exist — that is the definition of a bug.
