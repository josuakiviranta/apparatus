---
date: 2026-05-11
description: `pipeline validate` checks `inputs:` refs against the graph's node set for agent nodes only — gate (`shape=hexagon`) `inputs:` are read for orphan-output bookkeeping but never validated against existing nodes, so a stale `$implement.done` in a gate prompt slips through validate-green and explodes at runtime as "Undefined variable $implement.done".
---

## Core Idea

`src/attractor/core/validators/inputs-refs.ts` has two rules that catch references to nonexistent producers — `unknown_source_node` (line 222) and `source_missing_output_key` (line 240) — but both live inside `checkInputsForNode`, which short-circuits at line 134 with `if (!node.agent) return;`. Gate nodes (`shape=hexagon`, no `agent=` attribute) never reach those checks. `checkMissingInputProducer` (line 263) likewise skips gates with `if (!node.agent) continue;` at line 275.

The validator *does* read gate inputs — `checkOrphanOutput` at lines 395–413 calls `resolveGate(id, { dotDir })` and folds gate `inputs:` into the `consumed` set so producer-side orphan warnings don't false-positive. But "consumed" bookkeeping is one-directional: it tells you the gate uses the key, not whether the named producer node exists in the graph.

Concrete incident, run `parallel-illumination-to-implementation-df1d9cf6`, 2026-05-11: `tmux_confirm_gate.md` was copy-pasted from the original `illumination-to-implementation` pipeline and kept `inputs: [implement.done, implement.reason]`. The parallel-impl pipeline has no `implement` node — it has `batch_orchestrator`. `apparat pipeline validate` returned `✔ Pipeline valid (19 nodes, 29 edges)` twice (before and after I rewired the routing). The bug fired only when the engine reached node 18 and tried to expand `$implement.done` in the gate prompt — pipeline failed with `Undefined variable $implement.done` after ~50 minutes of upstream work.

## Why It Matters

The validator's whole job is "tell me at edit time what would explode at run time." It already knows how to do this for agent nodes — `unknown_source_node` is a clean, well-tested rule. Gates are functionally identical for the input-resolution surface: they declare `inputs:` in frontmatter, those inputs render into the prompt body via the same `$node.key` syntax, and the engine resolves them through the same context lookup. Skipping gates is not a deliberate design choice — it's an oversight from when gates were treated as "thin prompts with no real input plumbing" before `resolveGate()` matured.

Cost of the gap, measured in this incident: ~50 minutes of LLM time across plan-writer (~8min), plan-scheduler (~1min), batch-orchestrator (16min over two iterations dispatching 4 subagent worktrees in parallel), merge-resolver (~4min), tmux-tester (still running when failure surfaced) — all spent before the gate node fired. None of that work was wasted (the c1–c5 chunks merged correctly), but the *correctness signal* was wasted: every node downstream of the bad gate ran without anyone noticing the gate's inputs were unresolvable.

Worse than the time, this fails the pipeline's *own value proposition*. README documents `pipeline validate` as the seam where structural errors surface ahead of run. If validate is silent on a class of errors users expect it to catch, every author of a new gate has to learn the same lesson the hard way — and the *parallel*-impl pipeline made the cost N× worse by paying for N subagent dispatches before the gate could even be reached.

Same shape as `deep-modules-hide-complexity.md`: the *interface* (`apparat pipeline validate <file>` returns green) makes a stronger guarantee than the *implementation* delivers. Gate input validation is a narrow, well-bounded extension — three to five lines of code reusing the existing `resolveInputDecl` + `graph.nodes.has(...)` primitives — that closes the gap without adding any new validator concept.

The 2026-05-11 fix already patched the symptom (`tmux_confirm_gate.md` now references `batch_orchestrator.done`). This illumination is about the *category* of bug, not the one instance — without the validator fix, the next gate copy-paste lands the same hole.

## Revised Implementation Steps

1. **Extract the gate-input iteration that `checkOrphanOutput` already does** into a helper `iterateGateInputs(graph, dotDir, callback)` that yields `(gateNodeId, declString, resolved)` for every parseable gate input. Single primitive shared by orphan-output, the new validation rule, and any future gate-input checks.

2. **Add `unknown_source_node` coverage for gates.** In `inputs-refs.ts` block D (line 44), add `checkGateUnknownSourceNode(ctx)` that walks `iterateGateInputs` and pushes `{ rule: "unknown_source_node", severity: "error" }` when `resolved.sourceNode !== undefined && !ctx.graph.nodes.has(resolved.sourceNode)`. Same diagnostic shape as the agent-side rule — operators see one error template, two surfaces.

3. **Add `source_missing_output_key` coverage for gates.** Same walk, but when `resolved.sourceNode` exists and is a `node.agent` or `node.type === "tool"` (with `producesFromStdout`), assert `resolved.localKey` is one of the producer's declared outputs. Reuse `tryResolveAgent` from `agent-resolver.ts` so the lookup matches what the engine does at run time.

4. **Write a regression test mirroring the `tmux_confirm_gate.md` incident.** Fixture: a 3-node graph `start → batch_orchestrator → my_gate`, where `my_gate.md` declares `inputs: [implement.done]`. Assert `pipeline validate` returns the new `unknown_source_node` diagnostic with the gate node's source location and `implement` named explicitly. Without this test, the rule rots silently the moment someone refactors the agent-side helper.

5. **Document gate-input rules in the validator output catalog.** Wherever `unknown_source_node` is described (CONTEXT.md or wherever the validator rules are catalogued), explicitly mention both surfaces — agent `inputs:` and gate `inputs:` — so authors don't have to read the source to know which file shapes are checked.

6. **Audit the existing bundled and project-local gates for the same class of stale reference.** `src/cli/pipelines/**/<gate>.md` and `.apparat/pipelines/**/<gate>.md` for any `inputs:` entry whose `sourceNode` isn't a node in the sibling `pipeline.dot`. Cheap one-pass grep + parse; surfaces any other silently-broken gate before the validator fix ships.
