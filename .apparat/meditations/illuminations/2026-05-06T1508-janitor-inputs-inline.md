---
date: 2026-05-06
description: validateGraph contains a ~90-line inline block handling 7 agent inputs: declaration rules that is not extracted to a check* delegate, unlike the 11 other check* siblings.
---

## Findings

1. **What:** `validateGraph` contains a ~90-line inline block (the `if (dotDir) { for (const node...) }` block starting after the script-file rules) that enforces 7 distinct validation rules for agent `inputs:` declarations, while 11 comparable topics are already extracted as `check*` delegates called from the orchestrator.

   **Evidence:** `src/attractor/core/graph-validator.ts` — the inline block (roughly lines 444–540 of `validateGraph`) handles:
   - `inputs_missing_frontmatter` — "Agent X is missing required `inputs:` declaration"
   - `steering_has_var_token` — steering text contains `$var` under auto_inputs
   - `rendered_tag_collision` — two input decls that map to the same XML tag
   - `bare_input_from_qualified_producer` — bare key cannot read qualified producer outputs
   - `bare_input_not_in_caller_inputs_or_system` — bare key not in digraph inputs nor system
   - `unknown_source_node` — qualified input references a non-existent graph node
   - `source_missing_output_key` — source node doesn't declare the requested key

   By contrast, the 11 extracted delegates begin at lines 571–1149:
   `checkOrphanOutput` (571), `checkOutputsSchemaShape` (665), `checkInputTypeMismatch` (688),
   `checkRequiredCallerVars` (744), `checkMissingInputProducer` (841), `checkAgentOutputsConflict` (912),
   `checkAgentMissingOutputs` (962), `checkLoopRequiresDoneField` (997),
   `checkInteractiveWithOutputs` (1026), `checkInteractiveWithLoop` (1045), `checkGateHandlers` (1078).

   **Why it matters (KISS lens):** `validateGraph` at ~479 lines is already the most complex function in the module. The inline block breaks the visual rhythm of the orchestrator: a reader scanning for "what does this function check?" must step into a 90-line embedded chunk to understand 7 rules for one topic, while 11 other topics are opaque one-liners. The topic has a natural name (`checkAgentInputDeclarations`) and a clean parameter boundary — `traversal`, `callerInputs`, `nodes`, `dotDir` — matching the existing check* calling convention. The per-session "declined" note in the prior janitor session (`2026-05-04`) covered only `checkVariableCoverage`; this block is a separate cohesion unit.

   **Suggested action:** Extract the inline block into `function checkAgentInputDeclarations(graph: Graph, traversal: GraphTraversal, callerInputs: Set<string>, dotDir: string, diags: Diagnostic[]): void`. Replace the inline block in `validateGraph` with a single call after the script-file rules, matching the pattern of the 11 existing delegates. No public surface change; no `.dot` file edits needed.

## Reading thread

- No prior illuminations found (`list_illuminations` returned empty — all previous candidates consumed). The closest prior session (`2026-05-04-janitor-graph-validator-bloat.md`) explicitly declined extracting `checkVariableCoverage` on "shallow pattern" grounds; that declination covered variable_coverage only and does not apply to the inputs: declaration block, which is a separate cohesion unit of comparable size to the existing extracted delegates.
