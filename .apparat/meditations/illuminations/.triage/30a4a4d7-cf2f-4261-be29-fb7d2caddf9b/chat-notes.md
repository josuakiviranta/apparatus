# Chat round notes — 2026-05-04T00:00Z

## What the user raised

- "Does this illumination support or does it not support about the idea of deep modules Matt Pocock explains in this video: https://www.youtube.com/watch?v=3MP8D-mdheA"
- "So the change is against the deep modules idea Matt is talking about?"
- "Hmm, should we change the modification to support deep modules and leave rest out? What would be the blast radius of this change and does it make sense?"
- "Did you verify your claims with subagents?"
- "launch subagents to verify your earlier claims"
- "So how would the system change after these changes? Anything how commands are used, outputs of pipelines or how system is wired right now between agents, pipelines validations or .apparat subfolder itself?"
- "And last question does these changes fullfill this idea: 'Deepening opportunities: modules whose interface is large relative to what they hide; a concept implemented twice with no single seam forcing them to agree; wrappers that expose internals instead of concealing them; manager/helper surfaces with little implementation behind them. Suggest collapsing toward a deeper module — smaller interface, more implementation behind it — to raise locality and leverage.'"
- "so can we leave out the parts that make modules 'shallow'?"

## Conclusions reached

- **Drop the `checkVariableCoverage` 10th-sibling extraction from scope.** The illumination's headline action — extracting the variable_coverage block as a 10th `check*` sibling — is decomposition/SRP framed as cleanup, not deepening. Subagent audit of the existing nine `check*` siblings (graph.ts:584, 678, 701, 757, 858, 929, 979, 1014, 1043) verified they are shallow on average: avg 52 lines, uniform 3–4 param signature `(graph|node, dotDir, diags)`, mostly thin loops. Adding a 10th replicates the shallow pattern; it does not fulfill the "smaller interface, more implementation behind it" criterion. Variable_coverage block stays **inline** in `validateGraph`.
  - Came from: user's two questions "is the change against deep modules?" + "can we leave out the parts that make modules shallow?"
  - Rationale: user explicitly wants the resulting work to fulfill Pocock/Ousterhout deep-modules definition, not Clean-Code SRP. The 10th sibling adds a parameter-heavy interface with thin behavior — the exact anti-pattern called out in the definition.

- **Keep `buildForwardAdj` consolidation in scope — it is the cleanest deep-module win in the illumination.** Three duplicate forward-adjacency builders at `graph.ts:172-176`, `graph.ts:825-839`, and `flow-analyzer.ts:42-54` already show drift in their guard clauses (`adj.has(e.from)` vs `fwd.has(e.from) && fwd.has(e.to)`). Adding `export function buildForwardAdj(graph: Graph): Map<string, string[]>` to `dot-common.ts` and routing all three callers through it hits the deepening criterion: *"a concept implemented twice with no single seam forcing them to agree"* → one seam.
  - Came from: user's "should we change the modification to support deep modules and leave rest out?" — confirming this piece is one of the kept parts.
  - Rationale: matches Pocock's locality (edge-semantics changes one place) + leverage (callers learn one name).

- **Add a `GraphTraversal` deep module bundling the three closures + their captured state.** Subagent closure-capture analysis (verified at `graph.ts:219`/`:225`/`:242`) found the three helpers form a knot: `hasDefault` captures only `toCamel` (clean), but `reachableWithout` captures `adj`, and `findQualifiedProducer` captures `nodes`, `resolveHandlerType`, AND `reachableWithout` itself (mutual recursion). **Naked promotion to module-level functions would force 5+ param signatures — making them shallower, not deeper.** The Pocock-aligned alternative: bundle the three into a `GraphTraversal` module/class with `adj` + `nodes` as internal fields, exposing three small methods (`hasDefault(node, var)`, `reachable(src, tgt, excl)`, `findQualifiedProducer(id)`). Hides BFS + node iteration + producer-matching behind a narrow interface. Variable_coverage block (still inline in `validateGraph`) calls into this module.
  - Came from: user's "leave out the parts that make modules shallow" combined with the closure-capture subagent finding that naked promotion would create the very shallowness the user wants to avoid.
  - Rationale: only this bundling fulfills the "smaller interface, more implementation behind it" definition; alone among the three pieces, it raises real depth (and as a side-effect, creates the testable seam the original illumination wanted).

- **No user-facing surface change.** Verified from pipeline context (public-contract subagent) + re-confirmed under the revised scope: `parseDot`, `resolveHandlerType`, `validateGraph`, `validateOrRaise` signatures unchanged; diagnostic messages at `graph.ts:301-314` byte-identical; no CLI, MCP, agent contract, pipeline schema, or `.apparat/` layout change. `apparat implement` / `apparat plan` / `apparat new` / `apparat <pipeline>` invocation, flags, exit codes, Ink TUI, `loop.ts`, daemon, stream formatter, bundled pipelines, project-local `templates/` — all untouched.
  - Came from: user's "how would the system change... commands, outputs of pipelines, how system is wired between agents, pipelines validations or .apparat subfolder?"
  - Rationale: design doc and plan must frame this as plumbing-under-the-floor, not a feature. End-user running any `apparat` command notices zero. Developer notices: stack traces in validator failures may surface a new file (`graph-traversal.ts`); easier to write unit tests for traversal logic later.

- **Doc ripple is minimal under the revised scope.** Subagent verified ADR-0003 has exactly one `graph.ts` reference (line 167, pointing to `checkRequiredCallerVars` at `graph.ts:763-786`). Survives the revised scope unchanged unless `checkRequiredCallerVars` line range slides; promoting closures + adding `buildForwardAdj` does not touch its body. No `flow-analyzer.ts` or `dot-common.ts` line citations exist anywhere in ADRs.
  - Came from: user's "does it make sense?" on the reduced scope, plus the verification dispatch.
  - Rationale: smaller blast-radius than the verifier originally claimed.

- **No new test files required.** Subagent verified the 17 (not 14) `variable_coverage` test cases in `graph.test.ts` exercise `validateGraph` end-to-end via `parseDot` + `validateGraph`; the helpers `hasDefault` / `reachableWithout` / `findQualifiedProducer` are never called directly in tests. Promoting them to a `GraphTraversal` module does not break those tests, and direct-helper unit tests are optional polish (can be added later when the seam is needed). `dot-common.test.ts` extends naturally for `buildForwardAdj` cases.
  - Came from: same reduced-scope verification.
  - Rationale: tightens the blast-radius framing — variable_coverage rule body unchanged, behavior tests unchanged.

## Open questions

- The existing nine sibling `check*` are themselves shallow (verified). A purist deep-module pass would un-extract them and re-bundle by domain (e.g., a `GraphValidator` class holding `dotDir` + `graph` + `diags` as state). Out of scope for this triage. Worth a future janitor pass — flagged for the user, not deferred to design_writer.
