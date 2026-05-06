# Design: `ValidationContext` bundle + cluster `graph-validator.ts` rules into per-slice modules

**Date:** 2026-05-06
**Status:** draft (pending review)
**Originating illumination:** `.apparat/meditations/illuminations/2026-05-06T2211-graph-validator-context-and-clusters.md`
**Predecessor ADR:** ADR-0009 (parser/validator split)

## 1. Motivation

`src/attractor/core/graph-validator.ts` is 1156 lines. It emits 41 distinct `rule:` strings (verified by `grep -oE 'rule:\s*"[^"]*"' | sort -u | wc -l`). Of those, only 11 are extracted as named `check*` helpers; the rest are inline blocks scattered through the 478-line body of `validateGraph` (`src/attractor/core/graph-validator.ts:92-569`). The 11 helpers already drift across three signature shapes:

- `function checkGateHandlers(graph: Graph, dotDir: string, diags: Diagnostic[]): void` — `src/attractor/core/graph-validator.ts:1078`
- `function checkRequiredCallerVars(graph: Graph, nodeProduces: Map<string, Set<string>>, dotDir: string | undefined, diags: Diagnostic[]): void` — `src/attractor/core/graph-validator.ts:744`
- `function checkAgentOutputsConflict(node: Node, dotDir: string | undefined, diags: Diagnostic[]): void` — `src/attractor/core/graph-validator.ts:912`
- `function checkInteractiveWithOutputs(node: Node, dotDir: string, diags: Diagnostic[]): void` — `src/attractor/core/graph-validator.ts:1026`

Seven further extractions (`checkOrphanOutput:571`, `checkOutputsSchemaShape:665`, `checkInputTypeMismatch:688`, `checkMissingInputProducer:841`, `checkAgentMissingOutputs:962`, `checkLoopRequiresDoneField:997`, `checkInteractiveWithLoop:1045`) each pick their own subset of `(graph, node, dotDir, nodeProduces, diags)` — every helper takes a slightly different slice of the same closure state.

The inline rules (27 `diags.push` call sites grouped into ~24 distinct rule blocks across `graph-validator.ts:99-553` — some rules push multiple diagnostics per block) all share state through closure capture. The state lands at exactly:

- `RESERVED_VARS` — `src/attractor/core/graph-validator.ts:186`
- `callerInputs` — `src/attractor/core/graph-validator.ts:187`
- `traversal` (a `createGraphTraversal` bundle of `hasDefault` / `reachable` / `findQualifiedProducer`) — `src/attractor/core/graph-validator.ts:199`
- `nodeProduces` — built across `src/attractor/core/graph-validator.ts:202-236`
- `STRING_ATTRS` — imported at `src/attractor/core/graph-validator.ts:4`

Three forces converge:

1. **Locality is broken in two directions.** Adding rule N+1 means another inline block in a 478-line function or another differently-shaped helper. Per-rule atomization (one file per rule) duplicates the traversal helpers everywhere a rule needs reachability. Cluster-only refactors (just split the file by topic) propagate the existing signature drift into 6–8 sibling files.
2. **The shape, not the location, is load-bearing.** What the file lacks is a single answer to "what does a validation rule receive?" Every helper today picks a different subset of `(graph, node, dotDir, nodeProduces, diags)` and either does or does not have access to `traversal`, `callerInputs`, `RESERVED_VARS`. Defining the bundle first lets clustering be mechanical; clustering first preserves the bug class.
3. **ADR-0009 stopped at the file boundary.** The validator was extracted out of `graph.ts` (`docs/adr/0009-parser-validator-split.md:14-22`), but the ADR explicitly noted "no rule edits, no diagnostic-message edits, no signature changes" — the internals stayed tangled. ADR-0009 §28 calls out a pending follow-up: "If a future rule outgrows the average, that rule alone can move to its own file." This design is the next step: introduce the shape so future rules clearly belong somewhere.

The illumination (`2026-05-06T2211-graph-validator-context-and-clusters.md:18`) phrases the load-bearing decision precisely: "the **shape** of what each rule receives, not whether they live in the same file." This design follows that ordering — context first, then clustering.

## 2. Decision Summary

1. **Define `ValidationContext` carrying `{ graph, dotDir, nodeProduces, traversal, callerInputs, diags }`** in a new `src/attractor/core/validators/context.ts`. The bundle captures the closure state today resident at `src/attractor/core/graph-validator.ts:186-236`. One canonical rule signature: `(ctx: ValidationContext) => void` (graph-wide rules) or `(ctx: ValidationContext, node: Node) => void` (per-node rules).

2. **Lift the 24 inline rules out of `validateGraph`'s body into named functions taking `ValidationContext`.** Single extraction pass — do not normalize twice. The 11 already-extracted helpers are renamed/re-shaped to the same signature in the same pass.

3. **Cluster the 41 normalized rules into modules grouped by shared context slice** under `src/attractor/core/validators/`:
   - `flow.ts` — start/exit/reachability rules (start_node, terminal_node, reachability, reaches_exit, start_no_incoming, exit_no_outgoing, edge_target_exists, edge_source_exists, condition_syntax)
   - `types.ts` — handler-type checks (type_known, type_unsupported)
   - `variables.ts` — var-coverage + portability (variable_coverage, portability_heuristic, required_caller_vars)
   - `inputs-refs.ts` — agent inputs/outputs cross-checks (inputs_missing_frontmatter, steering_has_var_token, rendered_tag_collision, bare_input_*, unknown_source_node, source_missing_output_key, missing_input_producer, branch_incomplete_input, input_type_mismatch, orphan_output, outputs_schema_invalid, agent_missing_outputs, agent_outputs_empty, outputs_and_schema_file_conflict, produces_redundant_with_outputs)
   - `scripts.ts` — tool-handler script rules (script_command_conflict, unsupported_script_extension, script_file_exists, inline_script_smell)
   - `gates.ts` — wait.human gate rules (gate_handler_missing, gate_inline_md_conflict, gate_md_parse_error, gate_choice_edge_mismatch)
   - `interactive.ts` — interactive-mode constraints (interactive_with_outputs_forbidden, interactive_with_loop_forbidden, loop_missing_done_field)
   - `index.ts` — orchestration (`runAll(ctx)` — invokes each cluster's exported `run(ctx)` entry point in the same order the inline blocks fire today)

   Cluster count is emergent from the context slice. Small clusters (`types.ts` at 2 rules, `interactive.ts` at 3) stay separate when their context slice differs from neighbours; co-locating them with a larger cluster forces the larger module to import context fields it does not need.

4. **Keep `src/attractor/core/graph-validator.ts` as a thin façade** that exports `validateGraph`, `validateOrRaise`, and `Diagnostic` with byte-identical signatures. The body of `validateGraph` becomes:

   ```ts
   export function validateGraph(graph: Graph, dotDir?: string): Diagnostic[] {
     const ctx = createValidationContext(graph, dotDir);
     runAllValidators(ctx);
     return ctx.diags;
   }
   ```

   `validateOrRaise` is unchanged — it calls `validateGraph` and throws on errors (currently `src/attractor/core/graph-validator.ts:1150-1156`).

5. **Public API frozen.** `validateGraph(graph, dotDir?)` and `validateOrRaise(graph)` keep the signatures from ADR-0009 (`docs/adr/0009-parser-validator-split.md:22`). `Diagnostic` shape (`src/attractor/types.ts`) and rule string identifiers stay byte-identical — pinned by `src/attractor/tests/graph-validator-byte-identical.test.ts`.

6. **No CLI surface change.** No diagnostic message edits. No emission-order changes that the byte-identical test would catch.

7. **Atomic landing.** One PR — context module, cluster files, façade rewrite, and `runAll` orchestration land together. A staged path (extract context first; cluster later) leaves an interim state where some rules use the bundle and others still use the legacy signature — exactly the drift this design removes.

8. **ADR-0012 documents the bundle.** A new ADR records the `ValidationContext` shape and the cluster layout so a future rule author has a one-paragraph answer to "what does a rule receive, and where does it live?". ADR-0012 references ADR-0009 as predecessor.

## 3. Architecture

### 3.1 Before/after diagram

```
Before                                            After
──────                                            ─────
src/attractor/core/graph-validator.ts (1156 LOC)  src/attractor/core/graph-validator.ts (~40 LOC façade)
  ├─ createGraphTraversal (helper, 50–90)            ├─ validateGraph(graph, dotDir?)
  ├─ validateGraph (92–569)                          │     → createValidationContext(...)
  │    ├─ 24 inline rule blocks (closure state:      │     → runAllValidators(ctx)
  │    │    nodeProduces, traversal, callerInputs)   │     → return ctx.diags
  │    └─ calls 11 check* helpers                    └─ validateOrRaise(graph) — unchanged
  ├─ checkOrphanOutput (571)                      
  ├─ checkOutputsSchemaShape (665)                  src/attractor/core/validators/
  ├─ checkInputTypeMismatch (688)                     ├─ context.ts        ~80 LOC
  ├─ checkRequiredCallerVars (744)                    │   createValidationContext, ValidationContext type
  ├─ checkMissingInputProducer (841)                  │   (owns RESERVED_VARS, callerInputs, nodeProduces,
  ├─ checkAgentOutputsConflict (912)                  │    traversal, STRING_ATTRS access)
  ├─ checkAgentMissingOutputs (962)                   │
  ├─ checkLoopRequiresDoneField (997)                 ├─ flow.ts           ~140 LOC  (9 rules)
  ├─ checkInteractiveWithOutputs (1026)               ├─ types.ts          ~30 LOC   (2 rules)
  ├─ checkInteractiveWithLoop (1045)                  ├─ variables.ts      ~150 LOC  (3 rules)
  ├─ checkGateHandlers (1078)                         ├─ inputs-refs.ts    ~360 LOC  (15 rules)
  └─ validateOrRaise (1150)                           ├─ scripts.ts        ~100 LOC  (4 rules)
                                                      ├─ gates.ts          ~80 LOC   (4 rules)
17 validator tests (all import                        ├─ interactive.ts    ~80 LOC   (3 rules)
  from ../core/graph-validator.js or                  └─ index.ts          ~40 LOC   (runAll orchestrator)
  ../core/graph.js — both surfaces stay)
```

### 3.2 `ValidationContext` contract

```ts
// src/attractor/core/validators/context.ts

import type { Graph, Node, Diagnostic } from "../../types.js";

export interface GraphTraversal {
  hasDefault(node: Node, varName: string): boolean;
  reachable(source: string, target: string, excluded: Set<string>): boolean;
  findQualifiedProducer(consumerId: string): string | undefined;
}

export interface ValidationContext {
  /** The graph being validated. */
  graph: Graph;
  /** Pipeline directory for sibling-file resolution (agent files, gate .md). Optional —
   *  rules that need it gate on `if (!ctx.dotDir) return;` (matches today's `if (dotDir)` blocks). */
  dotDir: string | undefined;
  /** Per-node produced-key sets. Built once at context construction; rules read it. */
  nodeProduces: Map<string, Set<string>>;
  /** Reachability / default / qualified-producer lookups, sharing one closure over the graph. */
  traversal: GraphTraversal;
  /** Caller-supplied input variable names declared on the digraph (graph.inputs). */
  callerInputs: Set<string>;
  /** Diagnostic accumulator. Rules push into this; the façade returns it. */
  diags: Diagnostic[];
}

export function createValidationContext(
  graph: Graph,
  dotDir: string | undefined,
): ValidationContext;
```

`createValidationContext` performs the work currently inline at `src/attractor/core/graph-validator.ts:186-236`: it builds `callerInputs` from `graph.inputs ?? []`, constructs `traversal` via `createGraphTraversal(graph, buildForwardAdj(graph), resolveHandlerType)`, and walks `graph.nodes` to populate `nodeProduces` (including `TYPE_PRODUCES` lookup at `:191-194`, gate `${id}.choice` injection at `:212`, interactive `chat.output` at `:215`, explicit `node.produces` parsing at `:217-221`, and agent-frontmatter outputs derivation at `:223-234`).

`RESERVED_VARS` (the constant set `{goal, project, run_id}` at `:186`, `:750`) lives as a module-level `const` in `context.ts` and is exported alongside `ValidationContext` for rules that need it (`variables.ts`, `inputs-refs.ts`).

### 3.3 Single rule signature

```ts
// All rules take ValidationContext.
type GraphRule = (ctx: ValidationContext) => void;
type NodeRule  = (ctx: ValidationContext, node: Node) => void;
```

Per-cluster module exports a single `run(ctx)` entry point that internally iterates `graph.nodes` or `graph.edges` and dispatches to the cluster's rules. Example for `flow.ts`:

```ts
// src/attractor/core/validators/flow.ts
export function run(ctx: ValidationContext): void {
  checkStartExitCount(ctx);
  checkReachability(ctx);
  checkStartNoIncoming(ctx);
  checkExitNoOutgoing(ctx);
  checkReachesExit(ctx);
  checkEdgeEndpoints(ctx);
  checkConditionSyntax(ctx);
}

function checkStartExitCount(ctx: ValidationContext): void { /* lifted from :99-106 */ }
// …
```

The orchestrator in `index.ts` calls each cluster's `run(ctx)` in the same order the inline blocks fire today, preserving the diagnostic emission order pinned by the byte-identical test:

```ts
// src/attractor/core/validators/index.ts
import * as flow from "./flow.js";
import * as types from "./types.js";
import * as variables from "./variables.js";
import * as scripts from "./scripts.js";
import * as inputsRefs from "./inputs-refs.js";
import * as interactive from "./interactive.js";
import * as gates from "./gates.js";

export function runAllValidators(ctx: ValidationContext): void {
  // Per-node schema validation runs first today (graph-validator.ts:94-96).
  for (const node of ctx.graph.nodes.values()) {
    ctx.diags.push(...validateNode(node));
  }
  flow.run(ctx);
  types.run(ctx);
  variables.run(ctx);
  scripts.run(ctx);
  inputsRefs.run(ctx);
  interactive.run(ctx);
  gates.run(ctx);
}
```

The cluster-call order matches the inline-block sequence at `graph-validator.ts:94-566`. Order is contract: the byte-identical oracle test asserts diagnostic-by-diagnostic equality on a corpus of fixtures, so any reordering between clusters surfaces immediately as a test failure.

### 3.4 Mapping from today's code to clusters

| Cluster | Rules (rule strings) | Sourced from |
|---|---|---|
| `flow.ts` | start_node, terminal_node, reachability, start_no_incoming, exit_no_outgoing, reaches_exit, edge_target_exists, edge_source_exists, condition_syntax | `graph-validator.ts:99-176` (inline) |
| `types.ts` | type_known, type_unsupported | `graph-validator.ts:179-183` (inline) |
| `variables.ts` | variable_coverage, portability_heuristic, required_caller_vars | `graph-validator.ts:238-326` (inline) + `:744-839` (`checkRequiredCallerVars`) |
| `scripts.ts` | script_command_conflict, unsupported_script_extension, script_file_exists, inline_script_smell | `graph-validator.ts:328-404` (inline) |
| `inputs-refs.ts` (16 rules) | inputs_missing_frontmatter, steering_has_var_token, rendered_tag_collision, bare_input_from_qualified_producer, bare_input_not_in_caller_inputs_or_system, unknown_source_node, source_missing_output_key, missing_input_producer, branch_incomplete_input, input_type_mismatch, orphan_output, outputs_schema_invalid, agent_missing_outputs, agent_outputs_empty, outputs_and_schema_file_conflict, produces_redundant_with_outputs | `graph-validator.ts:421-553` (inline) + `checkOrphanOutput:571`, `checkOutputsSchemaShape:665`, `checkInputTypeMismatch:688`, `checkMissingInputProducer:841`, `checkAgentOutputsConflict:912`, `checkAgentMissingOutputs:962` |
| `interactive.ts` | interactive_with_outputs_forbidden, interactive_with_loop_forbidden, loop_missing_done_field | `checkInteractiveWithOutputs:1026`, `checkInteractiveWithLoop:1045`, `checkLoopRequiresDoneField:997` |
| `gates.ts` | gate_handler_missing, gate_inline_md_conflict, gate_md_parse_error, gate_choice_edge_mismatch | `checkGateHandlers:1078` |

`tryResolveAgent` (currently `graph-validator.ts:735-742`) is a small `(node, dotDir) => AgentConfig | undefined` helper used by 6+ rules. It moves to `src/attractor/core/validators/agent-resolver.ts` (private, 8 LOC) and is imported by `inputs-refs.ts`, `interactive.ts`, and `variables.ts`. Putting it on `ValidationContext` would be over-fitting — it's a pure function over `(node, dotDir)` with no context dependency.

### 3.5 Surfaces unchanged

- `validateGraph(graph, dotDir?)` and `validateOrRaise(graph)` signatures from ADR-0009.
- `Diagnostic` shape (`src/attractor/types.ts`).
- 41 rule string identifiers (pinned by `src/attractor/tests/graph-validator-byte-identical.test.ts`).
- Diagnostic emission order across the full corpus (pinned by the byte-identical test).
- Diagnostic message strings (pinned, same test).
- All existing imports of `validateGraph` and `validateOrRaise` from `src/attractor/core/graph-validator.js` keep working — file name and exports are unchanged.

### 3.6 Files-touched buckets

| Bucket | Files | Treatment |
|---|---|---|
| Validator façade | `src/attractor/core/graph-validator.ts` | **Rewritten** — ~40 LOC delegating to context + orchestrator |
| Context bundle | `src/attractor/core/validators/context.ts` | **New** — `ValidationContext`, `createValidationContext`, `RESERVED_VARS`, `GraphTraversal` re-export |
| Per-cluster rules | `src/attractor/core/validators/{flow,types,variables,scripts,inputs-refs,interactive,gates}.ts` | **New** — one module per cluster |
| Orchestrator | `src/attractor/core/validators/index.ts` | **New** — `runAllValidators(ctx)` |
| Agent resolver helper | `src/attractor/core/validators/agent-resolver.ts` | **New** — moves `tryResolveAgent` out of the validator file |
| ADR | `docs/adr/0012-validation-context.md` | **New** — documents `ValidationContext` shape and cluster layout, references ADR-0009 |
| Tests — existing | 16 test files at `src/attractor/tests/graph-{validator,gate-validation,inputs-flow,interactive-with-loop-forbidden,interactive-with-outputs-forbidden,orphan-output,outputs-conflict,outputs-derives-produces,outputs-schema-invalid,portability,produces-redundant-broad,required-caller-vars,validator-auto-inputs-fixture,validator-byte-identical,validator-inputs,validator-loop-done,validator-outputs}.test.ts` | No edits — all import from `../core/graph-validator.js` or `../core/graph.js`; signatures unchanged |
| Tests — new (optional) | `src/attractor/tests/unit/validators/{context,flow,inputs-refs,gates}.test.ts` | **Optional** — focused unit tests per cluster. Not required for landing this design (the byte-identical oracle test already covers behaviour); add per-cluster tests when a future rule needs targeted coverage. |

### 3.7 LOC sanity check

| File | Approx LOC after split |
|---|---|
| `graph-validator.ts` (façade) | ~40 |
| `validators/context.ts` | ~80 |
| `validators/flow.ts` | ~140 |
| `validators/types.ts` | ~30 |
| `validators/variables.ts` | ~150 |
| `validators/scripts.ts` | ~100 |
| `validators/inputs-refs.ts` | ~360 |
| `validators/interactive.ts` | ~80 |
| `validators/gates.ts` | ~80 |
| `validators/index.ts` | ~40 |
| `validators/agent-resolver.ts` | ~10 |
| **Total** | **~1110** |

Down from 1156 LOC. The split adds ~30 LOC of imports / re-exports across modules and saves ~80 LOC of duplicated parameter lists (the 11 helpers no longer each declare their own slice of the bundle). Net negative on raw LOC; substantial positive on locality and consistency.

`inputs-refs.ts` at ~360 LOC is the largest post-split file. It is also the one cluster the illumination explicitly flagged as the largest grouping (16 rules). A future split — separating "agent inputs declaration" (inputs_missing_frontmatter, steering_has_var_token, rendered_tag_collision, bare_input_*, unknown_source_node, source_missing_output_key) from "outputs cross-references" (orphan_output, outputs_schema_invalid, agent_missing_outputs, agent_outputs_empty, outputs_and_schema_file_conflict, produces_redundant_with_outputs, missing_input_producer, branch_incomplete_input, input_type_mismatch) — is plausible but out of scope. The present split delivers the standardized handle (`ValidationContext`); the further sub-cluster decision can be made when rule N+1 lands.

## 4. Components & file edits

### 4.1 `src/attractor/core/validators/context.ts` (new)

```ts
import type { Graph, Node, Diagnostic } from "../../types.js";
import { buildForwardAdj, toCamel } from "../dot-common.js";
import { resolveHandlerType } from "../graph.js";
import { loadAgent } from "../../../cli/lib/agent-loader.js";
import { SYSTEM_INJECTED_VARS } from "../../handlers/agent-prep.js";

export const RESERVED_VARS = new Set(["goal", "project", "run_id"]);
export const SYSTEM_VARS = new Set<string>(SYSTEM_INJECTED_VARS);

export interface GraphTraversal {
  hasDefault(node: Node, varName: string): boolean;
  reachable(source: string, target: string, excluded: Set<string>): boolean;
  findQualifiedProducer(consumerId: string): string | undefined;
}

export interface ValidationContext {
  graph: Graph;
  dotDir: string | undefined;
  nodeProduces: Map<string, Set<string>>;
  traversal: GraphTraversal;
  callerInputs: Set<string>;
  diags: Diagnostic[];
}

const TYPE_PRODUCES: Record<string, string[]> = {
  "tool": ["tool.output"],
  "store": ["store.path"],
  "wait.human": ["chat.output", "choice"],
};

export function createValidationContext(
  graph: Graph,
  dotDir: string | undefined,
): ValidationContext {
  const adj = buildForwardAdj(graph);
  const traversal = createGraphTraversal(graph, adj, resolveHandlerType);
  const callerInputs = new Set(graph.inputs ?? []);
  const nodeProduces = buildNodeProduces(graph, dotDir);
  return { graph, dotDir, nodeProduces, traversal, callerInputs, diags: [] };
}

// createGraphTraversal moved verbatim from graph-validator.ts:50-90.
// buildNodeProduces lifts the loop currently at graph-validator.ts:202-236.
```

`createGraphTraversal` moves verbatim from `src/attractor/core/graph-validator.ts:50-90` — no logic edits. `buildNodeProduces` lifts the loop currently inline at `src/attractor/core/graph-validator.ts:202-236` and returns the `Map<string, Set<string>>`.

### 4.2 `src/attractor/core/validators/flow.ts` (new)

Lifts the inline blocks at `src/attractor/core/graph-validator.ts:99-176` into named functions. Each function takes `ValidationContext` and pushes into `ctx.diags`. Example shape:

```ts
import type { ValidationContext } from "./context.js";

export function run(ctx: ValidationContext): void {
  checkStartExitCount(ctx);
  checkReachability(ctx);
  checkStartNoIncoming(ctx);
  checkExitNoOutgoing(ctx);
  checkReachesExit(ctx);
  checkEdgeEndpoints(ctx);
  checkConditionSyntax(ctx);
}

function checkStartExitCount(ctx: ValidationContext): void {
  const { graph: { nodes }, diags } = ctx;
  const isStart = (n: Node) => n.shape === "Mdiamond" || n.id === "start" || n.id === "Start";
  const isExit  = (n: Node) => n.shape === "Msquare"  || n.id === "exit"  || n.id === "end";
  const startNodes = [...nodes.values()].filter(isStart);
  const exitNodes  = [...nodes.values()].filter(isExit);
  if (startNodes.length !== 1) diags.push({ rule: "start_node", severity: "error", message: `Expected exactly 1 start node, found ${startNodes.length}` });
  if (exitNodes.length !== 1)  diags.push({ rule: "terminal_node", severity: "error", message: `Expected exactly 1 exit node, found ${exitNodes.length}` });
}
// …
```

The `isStart`/`isExit` predicates currently inline at `:99-100` move into `flow.ts` as module-level helpers (not on the context — they are pure functions on `Node`).

### 4.3 `src/attractor/core/validators/variables.ts` (new)

Lifts `graph-validator.ts:238-326` (variable_coverage + portability_heuristic) and `:744-839` (`checkRequiredCallerVars`) into the cluster. Both rules share `ctx.traversal`, `ctx.nodeProduces`, `ctx.callerInputs`, and `RESERVED_VARS` — exactly the slice the bundle exists to provide. The `VAR_RE` constant currently at `:188` becomes a module-level `const` in `variables.ts`.

### 4.4 `src/attractor/core/validators/inputs-refs.ts` (new)

Lifts the largest cluster: `graph-validator.ts:421-553` (inputs_missing_frontmatter, steering_has_var_token, rendered_tag_collision, bare_input_*, unknown_source_node, source_missing_output_key) plus the already-extracted `checkOrphanOutput:571`, `checkOutputsSchemaShape:665`, `checkInputTypeMismatch:688`, `checkMissingInputProducer:841`, `checkAgentOutputsConflict:912`, `checkAgentMissingOutputs:962`. Each helper is renamed (drops the `check` prefix) and re-shaped to take `ctx`. `tryResolveAgent` (currently `:735-742`) moves to the shared `agent-resolver.ts`.

### 4.5 `src/attractor/core/validators/scripts.ts` (new)

Lifts `graph-validator.ts:328-404`. The `SUPPORTED_SCRIPT_EXTS` constant (`:26`) and `INLINE_SCRIPT_PATTERNS` (`:28-33`) move to module-level in `scripts.ts`. The variable-expansion probe at `:383-390` moves verbatim; the `expandVariables` / `extractDefaults` / `UndefinedVariableError` imports relocate from the validator file to `scripts.ts`.

### 4.6 `src/attractor/core/validators/gates.ts` (new)

Lifts `checkGateHandlers:1078-1148` verbatim, re-shaped to `(ctx: ValidationContext) => void`. The `resolveGate` import (currently `:14`) moves to `gates.ts`.

### 4.7 `src/attractor/core/validators/interactive.ts` (new)

Lifts `checkInteractiveWithOutputs:1026`, `checkInteractiveWithLoop:1045`, and `checkLoopRequiresDoneField:997` — three rules that share `ctx.dotDir` + `tryResolveAgent` and gate on `node.interactive` / `cfg.loop`.

### 4.8 `src/attractor/core/validators/types.ts` (new)

Lifts `graph-validator.ts:179-183` (type_known, type_unsupported). `KNOWN_TYPES` and `UNIMPLEMENTED_TYPES` continue to be imported from `graph.js` per ADR-0009 §17.

### 4.9 `src/attractor/core/validators/index.ts` (new)

Orchestrator. Imports each cluster module and exposes `runAllValidators(ctx)` invoking `validateNode(node)` first (matching `graph-validator.ts:94-96`), then each cluster's `run(ctx)` in the order shown in §3.3.

### 4.10 `src/attractor/core/graph-validator.ts` (rewritten as façade)

```ts
import type { Graph, Diagnostic } from "../types.js";
import { createValidationContext } from "./validators/context.js";
import { runAllValidators } from "./validators/index.js";

export function validateGraph(graph: Graph, dotDir?: string): Diagnostic[] {
  const ctx = createValidationContext(graph, dotDir);
  runAllValidators(ctx);
  return ctx.diags;
}

export function validateOrRaise(graph: Graph): void {
  const diags = validateGraph(graph);
  const errors = diags.filter(d => d.severity === "error");
  if (errors.length > 0) {
    throw new Error("Pipeline validation failed:\n" + errors.map(e => `  [${e.rule}] ${e.message}`).join("\n"));
  }
}
```

`Diagnostic` continues to be re-exported from `../types.js` by every consumer that needs it. The current re-exports from `graph-validator.ts` (none beyond `validateGraph` / `validateOrRaise`) are unchanged.

### 4.11 `docs/adr/0012-validation-context.md` (new)

A short ADR documenting:

- The `ValidationContext` shape and its single rule signature.
- The cluster layout under `src/attractor/core/validators/` and the rule-to-cluster mapping (one row per rule, citing this design's §3.4).
- Why per-rule files were rejected (illumination §1: traversal helpers would duplicate).
- Why context-first beats cluster-first (signature drift would otherwise propagate).
- Reference to ADR-0009 as predecessor.

### 4.12 No test edits

The 16 existing validator-coverage tests at `src/attractor/tests/graph-*.test.ts` import `validateGraph` from `../core/graph-validator.js` — that import path is unchanged. The byte-identical oracle test at `src/attractor/tests/graph-validator-byte-identical.test.ts` is the structural guard: it asserts diagnostic-by-diagnostic equality between current `validateGraph` output and a frozen fixture corpus. Any change in rule string, message text, severity, or emission order surfaces here. New per-cluster unit tests are optional and explicitly out of scope for this design — adding them is sensible when rule N+1 lands and benefits from cluster-local coverage, not as part of this refactor.

## 5. Data flow

### 5.1 Before — closure-state spaghetti

```
validateGraph(graph, dotDir?)            (graph-validator.ts:92-569 + 11 helpers)
  ├─ for node: validateNode(node)         (line 94)
  ├─ inline: start/exit count             (line 105-106)
  ├─ inline: forward-BFS reachability     (line 110-126)
  ├─ inline: exit_no_outgoing             (line 130)
  ├─ inline: reverse-BFS reaches_exit     (line 136-162)
  ├─ inline: edge endpoints exist         (line 166-167)
  ├─ inline: condition syntax             (line 171-176)
  ├─ inline: type_known/unsupported       (line 179-183)
  ├─ build closure state:
  │     RESERVED_VARS (186), callerInputs (187),
  │     adj (198), traversal (199), nodeProduces (202-236)
  ├─ inline: variable_coverage            (line 238-307)
  ├─ inline: portability_heuristic        (line 310-326)
  ├─ inline: script rules                 (line 328-404)
  ├─ inline + helpers: agent outputs      (line 407-419, calls 4 check* helpers)
  ├─ inline + helpers: agent inputs       (line 421-553)
  ├─ if dotDir: 4 helpers                  (checkMissingInputProducer, checkInputTypeMismatch,
  │                                         checkOrphanOutput, checkOutputsSchemaShape)
  ├─ checkRequiredCallerVars               (line 564)
  └─ if dotDir: checkGateHandlers          (line 566)
```

Every inline block reads from the closure variables built at lines 186–236. Every helper picks its own subset via parameter list.

### 5.2 After — one shape, three reads

```
validateGraph(graph, dotDir?)             (graph-validator.ts façade, ~40 LOC)
  └─ ctx = createValidationContext(graph, dotDir)
       └─ builds: callerInputs, traversal, nodeProduces (encapsulated in context.ts)
  └─ runAllValidators(ctx)                 (validators/index.ts)
       ├─ for node: validateNode(node)
       ├─ flow.run(ctx)                    (validators/flow.ts: 9 rules)
       ├─ types.run(ctx)                   (validators/types.ts: 2 rules)
       ├─ variables.run(ctx)               (validators/variables.ts: 3 rules — reads ctx.traversal,
       │                                                                 ctx.nodeProduces,
       │                                                                 ctx.callerInputs)
       ├─ scripts.run(ctx)                 (validators/scripts.ts: 4 rules)
       ├─ inputsRefs.run(ctx)              (validators/inputs-refs.ts: 16 rules — reads ctx.dotDir,
       │                                                                       ctx.nodeProduces,
       │                                                                       ctx.traversal)
       ├─ interactive.run(ctx)             (validators/interactive.ts: 3 rules)
       └─ gates.run(ctx)                   (validators/gates.ts: 4 rules — reads ctx.dotDir)
  └─ return ctx.diags
```

Every rule receives the same shape. The bundle reads are visible at the destructure site (`const { graph: { nodes }, traversal, diags } = ctx;`), so a new contributor can see at a glance which slice each rule depends on. The closure-capture model is gone.

## 6. Blast radius / impact surface

- **Size:** **M** — 1 façade rewrite + 1 context module + 8 cluster modules + 1 orchestrator + 1 helper + 1 ADR. All within `src/attractor/core/` and `docs/adr/`. No public-API break.
- **Files touched:** 11 source files (1 rewritten, 10 new) + 1 ADR.
- **Surfaces crossed:**
  - **Validator core** — `src/attractor/core/graph-validator.ts` rewritten as façade; new `src/attractor/core/validators/{context,flow,types,variables,scripts,inputs-refs,interactive,gates,agent-resolver,index}.ts`.
  - **Tests** — none edited. The 16 existing validator-coverage tests at `src/attractor/tests/graph-*.test.ts` plus the byte-identical oracle test continue to work via the unchanged `validateGraph` import.
  - **CLI / pipeline / agents** — no surface crossed. `validateGraph` and `validateOrRaise` continue to be called from `src/cli/commands/pipeline-invocation.ts` (the upcoming pipeline-orchestration split) and `src/attractor/core/engine.ts` with unchanged call signatures.
  - **Docs** — new ADR-0012; no edits to README, CONTEXT.md, AGENTS.md, VISION.md, or the design docs from sister illuminations.
- **Breaking changes:** **no.**
  - `validateGraph(graph, dotDir?): Diagnostic[]` signature unchanged.
  - `validateOrRaise(graph): void` signature unchanged.
  - `Diagnostic` shape unchanged.
  - 41 rule string identifiers unchanged — pinned by `src/attractor/tests/graph-validator-byte-identical.test.ts`.
  - Diagnostic message text unchanged — same test.
  - Diagnostic emission order unchanged — same test.
- **Spec / docs ripple:**
  - [ ] **New** `docs/adr/0012-validation-context.md` — documents `ValidationContext` shape, cluster layout, cross-references ADR-0009.
  - [ ] No edits to existing ADRs. ADR-0009 §28 ("If a future rule outgrows the average, that rule alone can move to its own file") is honoured — this design moves *clusters*, not individual rules to per-rule files.
  - [ ] No README, CONTEXT.md, AGENTS.md, VISION.md change.
  - [ ] No edit to sibling design docs (`2026-05-06-pipeline-command-orchestration-monolith-design.md`, `2026-05-06-pipeline-show-couples-to-agent-frontmatter-design.md`, `2026-05-06-meditate-pipeline-not-pipeline-run-callable-design.md`, `2026-05-06-interactive-agent-predicate-duplicated-design.md`) — none reference the validator's internals.
- **Test ripple:**
  - [ ] **No edits** to the 16 existing validator tests — all import `validateGraph` from `../core/graph-validator.js` and that surface is unchanged.
  - [ ] **No edits** to the byte-identical oracle test. It is the structural guard.
  - [ ] **Optional** new per-cluster unit tests under `src/attractor/tests/unit/validators/` — explicitly deferred to the future-rule sessions that benefit from local coverage. Adding them as part of this design would be premature; the byte-identical test already covers behaviour.

## 7. Trade-offs

### 7.1 Context-first vs. cluster-first vs. per-rule files

- **Per-rule files** (one rule per `.ts`) — rejected per the illumination (`2026-05-06T2211:18`): "per-rule atomization (one file per rule) duplicates the traversal helpers across files." Each rule needing reachability would re-import or re-bundle its own traversal slice, defeating the point.
- **Cluster-first** (split file by topic, keep helper signatures as-is) — rejected because the existing 11 helpers already drift across three signature shapes (§1). Splitting without naming the bundle preserves the bug class in 6–8 sibling files.
- **Context-first then cluster** (this design) — adopted. The bundle is the load-bearing decision; clustering becomes mechanical once every rule reads from the same shape. This is exactly the deepening order the illumination prescribed.

### 7.2 Single context bundle vs. per-cluster context types

A variant would be `FlowContext` / `VariablesContext` / `GatesContext` — each cluster's rules take only the slice they need. Reasons rejected:

- The 11 already-extracted helpers cross slices today (`checkRequiredCallerVars` reads `nodeProduces` and `callerInputs`; `checkInteractiveWithOutputs` reads `dotDir`; `checkOrphanOutput` reads `dotDir` and walks all node attributes). Subdividing the bundle would force most rules to take a union, defeating the standardization.
- TypeScript can already enforce "rule reads only `ctx.dotDir`" via destructuring. Subdividing the type adds boilerplate without added safety.
- The cost of a slightly-too-wide bundle (rules ignoring fields they do not need) is far less than the cost of every rule taking a different parameter shape.

### 7.3 `tryResolveAgent` on context vs. as a pure helper

`tryResolveAgent(node, dotDir)` is called by 6+ rules across `inputs-refs.ts`, `interactive.ts`, and `variables.ts`. It could live on `ValidationContext` as a method or as a memoized cache. Reasons to keep it as a pure helper in `agent-resolver.ts`:

- It has no dependency on the rest of the context — only on `(node, dotDir)`. Putting it on the bundle creates the false impression that it shares state.
- A memoized version would cache `loadAgent` results. That is a worthwhile optimization but a separate decision (and `loadAgent` already memoizes — verified by reading `src/cli/lib/agent-loader.ts`).
- Pure helpers are testable in isolation; methods on a bundle are not.

### 7.4 Atomic vs. staged

A staged path — context module + 1 cluster first; cluster the rest later — lets each commit land independently green. Rejected:

- Each commit alone produces interim drift: some rules use `ValidationContext`; others still use the legacy parameter list. Reviewing a partial change forces reviewers to hold both shapes in mind.
- The byte-identical oracle test only passes when the orchestrator emits diagnostics in the same order as today. Doing the split in stages requires temporarily duplicating the orchestrator (one path through the new context, one through the legacy inline blocks) — or skipping the byte-identical test on intermediate commits, which is the wrong direction.
- The split is mechanical. The full refactor is one focused PR.

### 7.5 Cluster boundaries — "interactive" as its own cluster

`interactive.ts` (3 rules) could fold into `inputs-refs.ts` (rules also depend on `dotDir` + `tryResolveAgent`). Reasons to keep separate:

- The three interactive rules cluster around `node.interactive` / `cfg.loop` — a different gate than the input/output reference rules in `inputs-refs.ts`.
- `inputs-refs.ts` is already the largest cluster at ~360 LOC; merging adds 80 LOC to a file that the design notes is itself a future-split candidate.
- Symmetric concern with `types.ts` (2 rules): kept separate because the type-known/unsupported pair runs over `resolveHandlerType(node)` only — a slice neither `flow.ts` nor `variables.ts` reaches into.

### 7.6 ADR-0012 vs. inline doc in `validators/context.ts`

`ValidationContext` could be documented in a JSDoc block at the top of `context.ts`. An ADR is heavier. Reasons to write the ADR:

- The bundle shape is a project-level convention: "the way we add validation rules." A new contributor looking for that convention reads ADRs first.
- ADR-0009 explicitly invites a follow-up; ADR-0012 closes the loop with a citation chain.
- The ADR is short (~40 lines per the ADR-0009 template). The cost is small; the discoverability gain is real.

## 8. Constraints

After the change:

- `npx tsc --noEmit` passes.
- `npx vitest run src/attractor/tests/` passes — all 16 existing validator-coverage tests + the byte-identical oracle test.
- `npx vitest run` (full suite) passes.
- `apparat pipeline validate <good.dot>` and `apparat pipeline validate <broken.dot>` produce byte-identical stderr/stdout to the pre-split baseline.
- `wc -l src/attractor/core/graph-validator.ts` returns < 60 (façade-only).
- `src/attractor/core/validators/` exists and contains `context.ts`, `flow.ts`, `types.ts`, `variables.ts`, `scripts.ts`, `inputs-refs.ts`, `interactive.ts`, `gates.ts`, `agent-resolver.ts`, `index.ts`.
- Repo-wide grep `from "./graph-validator.js"` and `from "../core/graph-validator.js"` show *the same* hits as today — no test or consumer has rewritten its import.
- `docs/adr/0012-validation-context.md` exists and references ADR-0009.

Behaviour invariants:

- The byte-identical oracle test at `src/attractor/tests/graph-validator-byte-identical.test.ts` passes byte-for-byte.
- Running `validateGraph` on every fixture in `src/attractor/tests/fixtures/` produces the same `Diagnostic[]` (order, rule, severity, message, location).

## 9. Open questions

- **Should `RESERVED_VARS` be exported from `context.ts` or duplicated per-cluster?** Today `RESERVED_VARS` is re-declared inside `checkRequiredCallerVars:750` with the same `{goal, project, run_id}` content as the top-level constant at `:186`. The design centralizes it on `context.ts`. A future rule could plausibly want a different reserved-set; if so, refactor to per-cluster constants then. Default: one canonical `RESERVED_VARS` exported from `context.ts`.
- **Should the new `validators/` subdirectory move to `src/attractor/validators/` (sibling to `core/`)?** Reasons to nest under `core/`: validation is part of the core pipeline-graph contract; the parser also lives in `core/`. Reasons to lift: validators have their own cross-cutting deps (`agent-loader`, `flow-analyzer`, `gate-registry`) that the parser does not. ADR-0009 §17 keeps the validator file in `core/`; this design keeps the convention. Defer; revisit if the validator gains a non-pipeline consumer.
- **Should `inputs-refs.ts` (~360 LOC, 16 rules) be further split into `inputs-decl.ts` + `outputs-refs.ts`?** Out of scope. The present design earns the standardized shape; the further split is a separate decision driven by the next rule that lands there.

## 10. Verification approach

### 10.1 Static checks

- `npx tsc --noEmit` — clean. The façade re-exports `validateGraph` and `validateOrRaise` with their original signatures; TypeScript catches any missed export from cluster modules.
- `wc -l src/attractor/core/graph-validator.ts` — returns < 60.
- Grep for any rule string `rule:\s*"<name>"` — every rule string still appears exactly once across the cluster modules; the count returns 41 unique strings as today.
- Grep `from ".*graph-validator.js"` — same hit set as before the change.

### 10.2 Tests

- `npx vitest run src/attractor/tests/graph-validator-byte-identical.test.ts` — **the structural guard**. Asserts diagnostic-by-diagnostic equality on the fixture corpus. Any reordering, message edit, or missed rule fails here.
- `npx vitest run src/attractor/tests/graph-validator-*.test.ts` — passes unchanged (5 files).
- `npx vitest run src/attractor/tests/graph-{gate-validation,inputs-flow,interactive-with-loop-forbidden,interactive-with-outputs-forbidden,orphan-output,outputs-conflict,outputs-derives-produces,outputs-schema-invalid,portability,produces-redundant-broad,required-caller-vars}.test.ts` — passes unchanged (11 files).
- `npx vitest run` (full suite) — passes.

### 10.3 Smoke

- `apparat pipeline validate <good.dot>` — exit 0, identical stdout / stderr.
- `apparat pipeline validate <broken.dot>` — exit 1, identical diagnostic format and ordering.
- `apparat pipeline run <good.dot>` — `validateOrRaise` continues to throw with the identical formatted error string when `<broken.dot>` is supplied.

### 10.4 Negative cases

- A merge that lands `validators/context.ts` without `validators/index.ts` — `npx tsc --noEmit` catches the missing import in the façade.
- A merge that defines `runAllValidators` but invokes clusters in a different order — `graph-validator-byte-identical.test.ts` catches.
- A merge that drops `validateNode(node)` ahead of the cluster runs — byte-identical test catches: per-node schema diagnostics (e.g. `node_id_missing`) precede cluster diagnostics in the current ordering.
- A merge that forgets to re-include `gate-choice` injection (`:212`) when porting `buildNodeProduces` — byte-identical test catches via the `variable_coverage` cases that depend on it.

## 11. Summary

`src/attractor/core/graph-validator.ts` is a 1156-line file emitting 41 distinct rule strings, where 24 are inline blocks scattered through a 478-line `validateGraph` body and 11 are extracted helpers in three drifting signature shapes. Every rule today reads its slice of `(graph, node, dotDir, nodeProduces, traversal, callerInputs, diags)` via either closure capture or its own parameter list — the file lacks one canonical answer to "what does a validation rule receive?" This design defines `ValidationContext` carrying that bundle in a new `src/attractor/core/validators/context.ts`, lifts the 24 inline rules into named functions taking that context, and clusters all 41 normalized rules into per-slice modules under `src/attractor/core/validators/{flow,types,variables,scripts,inputs-refs,interactive,gates}.ts`. The current `graph-validator.ts` survives as a ~40-LOC façade exporting `validateGraph` and `validateOrRaise` with the byte-identical signatures from ADR-0009. The 41 rule string identifiers, the diagnostic message strings, and the diagnostic emission order are pinned by `src/attractor/tests/graph-validator-byte-identical.test.ts` — the structural guard that the cluster-call ordering preserves the existing user-visible behaviour. ADR-0012 documents the bundle shape and cluster layout, citing ADR-0009 as predecessor. Blast radius: M (~11 source files, 1 ADR, 0 test edits); breaking changes: zero. The pipeline `.dot` syntax, agent rubrics, MCP tools, public CLI surface, exit codes, and stderr/stdout formatting are byte-identical before and after.
