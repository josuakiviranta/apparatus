---
date: 2026-04-18
status: open
description: mark_archived already exists in illumination-to-implementation.dot and is wired to the approval_gate Decline branch — routing remove_gate→Yes through it instead of delete_file is a two-line diff, not a new archive_invalid node as T1700 and T1300 both prescribe.
---

## Core Idea

`mark_archived` is already declared in `pipelines/illumination-to-implementation.dot` and wired on the true path: `approval_gate -> mark_archived [label="Decline"]`. Its prompt calls `mcp__illumination__mark_archived` using `$illumination_path` and `$summary` — both produced by the `verifier` node and available throughout the false path's execution context. The false path currently routes `remove_gate -> delete_file -> done`. Replacing that with `remove_gate -> mark_archived -> done` takes two line edits and one node declaration removal. No new node is needed.

T1700's implementation step 2 — the current de facto guide for the false-path cluster — proposes creating `archive_invalid [agent="implement", prompt="Call mcp__illumination__mark_archived ... reason: 'Invalid per verifier: $explanation' ..."]`. T1300 repeats the same prescription. Both were written by agents verifying illuminations against source code (`.ts` files) without reading the current `.dot` file state. The node they propose adding already exists under a different name, using `$summary` instead of `$explanation` as the reason text.

## Why It Matters

A developer acting on T1700 tomorrow will add a new node, wire it, leave `mark_archived` untouched on the Decline path, and commit a graph with two near-identical archival nodes — both calling `mcp__illumination__mark_archived`, both reaching `done`, differing only in which context variable populates the reason field. The duplicate exists not because two different archive behaviors are needed, but because the implementation guide was written without reading the graph.

Beyond the wasted work, the structural consequence is real: a pipeline graph with `mark_archived` (Decline path) and `archive_invalid` (false path) implies two distinct archival intents. Future authors will treat them as different behaviors. Someone will be careful not to confuse them. The distinction will accrete comments. In six months no one will remember they were the same operation.

The `idempotency-run-it-twice` lens applies here in a different register: when the pipeline re-runs after the false-path fix, it will encounter `mark_archived` whether the illumination was declined by a human or rejected by the verifier. One node, one behavior, same result regardless of entry path. A graph that achieves idempotency through shared nodes rather than parallel copies is structurally healthier than one that duplicates nodes to preserve separate entry-point identities.

There is also a verification gap to name: the illumination pipeline's `verifier` node reads `.ts` files, specs, and frontmatter to check technical claims. It does not read `.dot` pipeline graph files. Illuminations that propose graph changes are verified against code but not against the pipeline they intend to modify. T2100's "replace delete_file with archive_invalid" was technically correct as a standalone claim — `delete_file` uses `rm` and should use `mark_archived` instead — but missed the existing node because no verification step checked the graph's current node inventory.

## Revised Implementation Steps

1. **Read the current routing section of `illumination-to-implementation.dot` before writing any plan.** Confirm: `mark_archived` node declaration exists, `approval_gate -> mark_archived [label="Decline"]` is wired, and no `mark_archived -> done` edge is explicit. Determine whether the engine treats leaf nodes as implicitly terminal or requires an explicit `-> done` edge (check whether the existing Decline path reaches `done` in a live trace before assuming).

2. **Change `remove_gate -> delete_file [label="Yes"]` to `remove_gate -> mark_archived [label="Yes"]`.** One line in the routing section. If `mark_archived -> done` is absent and the engine requires it, add it; if the Decline path already works without it, leave it out.

3. **Delete the `delete_file` node declaration.** It is now unreachable. Leaving a dead node in the graph is misleading — future readers will wonder what path reaches it.

4. **Decide: `$summary` or `$explanation` in the archive reason.** The current `mark_archived` prompt uses `$summary` (verifier's human-readable verdict). `$explanation` is the verifier's technical walk-through of why the claim no longer holds. For the false path, `$explanation` is arguably more informative as the archive reason. If you prefer it: update the single `mark_archived` prompt string — one field change on one existing node. Do not fork the node.

5. **Archive T2100 and T2000 together after the diff lands.** T2000 is superseded by T2100 (T1300 documents this). T2100 is superseded by the simpler routing fix described here. Archive both with reasons that document the chain: T2000 → T2100 → routing change on existing node. This removes all three from the verifier's eligible pool and closes the false-path cluster (along with T1500's `explain_removal` removal and T1100's `remove_gate → No → approval_gate` reroute, which remain valid and should be applied in the same commit).
