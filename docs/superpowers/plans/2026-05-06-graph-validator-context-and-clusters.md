# `ValidationContext` + clustered `graph-validator.ts` Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor `src/attractor/core/graph-validator.ts` (1156 LOC, 41 rules in drifting shapes) into a ~40-LOC façade plus per-slice cluster modules under `src/attractor/core/validators/`, all rules taking a single `ValidationContext` bundle. Public API and byte-identical diagnostic output unchanged.

**Architecture:** Introduce `ValidationContext` (the closure state currently at `graph-validator.ts:186-236`) as the canonical rule signature, then incrementally lift inline rule blocks and rename existing `check*` helpers into per-slice modules. The byte-identical oracle test (`src/attractor/tests/graph-validator-byte-identical.test.ts`) is the structural guard — it asserts diagnostic-by-diagnostic equality on a fixture corpus, so any rule reorder, message edit, or missed rule fails immediately. Each chunk is structured so the byte-identical test stays green at every commit.

**Tech Stack:** TypeScript (NodeNext / ESM), Vitest, existing `@ts-graphviz/ast` parser, no new runtime deps.

**Source-of-truth design:** `docs/superpowers/specs/2026-05-06-graph-validator-context-and-clusters-design.md` (§3.4 rule-to-cluster table is authoritative; §6 surfaces / `Diagnostic` shape are frozen).

**Predecessor:** ADR-0009 (parser/validator split). This plan also produces ADR-0012.

**Deviation from design §2.7 (atomic landing):** This plan ships in chunked commits inside one branch/PR — every chunk preserves byte-identical output so the oracle test stays green per commit. Design §2.7 forbade staged *landings* (interim drift in `main`); chunked commits inside one PR are not that, and let reviewers walk the refactor incrementally.

**Oracle test = de-facto smoke:** No `pipelines/smoke/*.dot` covers the validator at this granularity. The byte-identical oracle test (`src/attractor/tests/graph-validator-byte-identical.test.ts`) runs `validateGraph` over the fixture corpus in `src/attractor/tests/fixtures/` and asserts diagnostic-by-diagnostic equality. Treat it as the smoke for this refactor — every chunk runs it before commit.

---

## Chunk 1: `ValidationContext` foundation

Goal of this chunk: introduce `src/attractor/core/validators/context.ts` carrying `ValidationContext`, `createValidationContext`, `RESERVED_VARS`, and the moved-verbatim `createGraphTraversal`. Update `graph-validator.ts` to consume the bundle for its own closure state but keep all inline rules / `check*` helpers on the legacy signatures. No cluster modules yet. Byte-identical test passes.

### Task 1.1: Create `validators/` directory and skeleton `context.ts`

**Files:**
- Create: `src/attractor/core/validators/context.ts`

- [x] **Step 1: Create the directory and empty file**

```bash
mkdir -p /Users/josu/Documents/projects/apparatus/src/attractor/core/validators
```

- [x] **Step 2: Write the `context.ts` module**

Path: `src/attractor/core/validators/context.ts`

```ts
import type { Graph, Node, Diagnostic } from "../../types.js";
import { buildForwardAdj, toCamel } from "../dot-common.js";
import { resolveHandlerType } from "../graph.js";
import { loadAgent } from "../../../cli/lib/agent-loader.js";
import { SYSTEM_INJECTED_VARS } from "../../handlers/agent-prep.js";

export const RESERVED_VARS = new Set<string>(["goal", "project", "run_id"]);
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

export function createGraphTraversal(
  graph: Graph,
  adj: Map<string, string[]>,
  resolveHandler: (node: Node) => string,
): GraphTraversal {
  const { nodes } = graph;

  function hasDefault(node: Node, varName: string): boolean {
    const key = toCamel("default_" + varName);
    return node[key] !== undefined;
  }

  function reachable(source: string, target: string, excluded: Set<string>): boolean {
    if (source === target) return true;
    const visited = new Set<string>();
    const queue = [source];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (visited.has(cur)) continue;
      visited.add(cur);
      if (cur === target) return true;
      for (const next of (adj.get(cur) ?? [])) {
        if (!excluded.has(next)) queue.push(next);
      }
    }
    return false;
  }

  function findQualifiedProducer(consumerId: string): string | undefined {
    for (const [id, node] of nodes) {
      if (id === consumerId) continue;
      if (resolveHandler(node) !== "tool") continue;
      if (!node.producesFromStdout) continue;
      if (!reachable(id, consumerId, new Set())) continue;
      return id;
    }
    return undefined;
  }

  return { hasDefault, reachable, findQualifiedProducer };
}

function buildNodeProduces(
  graph: Graph,
  dotDir: string | undefined,
): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const [id, node] of graph.nodes) {
    const produced = new Set<string>();
    const handlerType = resolveHandlerType(node);
    if (TYPE_PRODUCES[handlerType]) {
      for (const v of TYPE_PRODUCES[handlerType]) produced.add(v);
    }
    if (handlerType === "wait.human") {
      produced.add(`${id}.choice`);
    }
    if (node.interactive) produced.add("chat.output");
    if (typeof node.produces === "string") {
      for (const v of (node.produces as string).split(",").map(s => s.trim()).filter(Boolean)) {
        produced.add(v);
      }
    }
    if (node.agent && dotDir) {
      try {
        const agentConfig = loadAgent(node.agent as string, dotDir);
        if (agentConfig.outputs) {
          for (const key of Object.keys(agentConfig.outputs)) {
            produced.add(key);
          }
        }
      } catch {
        // Agent file unresolvable; do not crash the validator.
      }
    }
    out.set(id, produced);
  }
  return out;
}

export function createValidationContext(
  graph: Graph,
  dotDir: string | undefined,
): ValidationContext {
  const adj = buildForwardAdj(graph);
  const traversal = createGraphTraversal(graph, adj, resolveHandlerType);
  const callerInputs = new Set<string>(graph.inputs ?? []);
  const nodeProduces = buildNodeProduces(graph, dotDir);
  return { graph, dotDir, nodeProduces, traversal, callerInputs, diags: [] };
}
```

- [x] **Step 3: Type-check the new file in isolation**

Run: `npx tsc --noEmit`
Expected: clean — no errors. (The file is unused by any consumer yet.)

- [x] **Step 4: Commit**

```bash
git add src/attractor/core/validators/context.ts
git commit -m "feat(attractor/validators): scaffold ValidationContext bundle"
```

### Task 1.2: Wire `graph-validator.ts` through `createValidationContext` for its own state

**Files:**
- Modify: `src/attractor/core/graph-validator.ts:92-236`

The intent is purely structural: the inline `validateGraph` body keeps every rule it owns today, but its closure state (`callerInputs`, `traversal`, `nodeProduces`, `RESERVED_VARS`) is now sourced from the new context bundle. Per-rule logic is unchanged. Helpers (`checkOrphanOutput`, `checkRequiredCallerVars`, `checkGateHandlers`, etc.) are still called with their existing parameter lists, sourced from `ctx.*`.

- [x] **Step 1: Run the full validator test suite first to capture green baseline**

Run: `npx vitest run src/attractor/tests/graph-validator-byte-identical.test.ts src/attractor/tests/graph-validator-*.test.ts src/attractor/tests/graph-{gate-validation,inputs-flow,interactive-with-loop-forbidden,interactive-with-outputs-forbidden,orphan-output,outputs-conflict,outputs-derives-produces,outputs-schema-invalid,portability,produces-redundant-broad,required-caller-vars}.test.ts`
Expected: PASS (baseline). Note the count.

Then capture a CLI baseline so later chunks can `diff` against it:

```bash
npm run build
node dist/cli/index.js pipeline validate src/attractor/tests/fixtures/<good-fixture>.dot > /tmp/validator-baseline-good.txt 2>&1 || true
node dist/cli/index.js pipeline validate src/attractor/tests/fixtures/<broken-fixture>.dot > /tmp/validator-baseline-broken.txt 2>&1 || true
```

Pick any pre-existing fixtures under `src/attractor/tests/fixtures/`. Keep the two text files for later `diff` checks at chunk boundaries.

- [x] **Step 2: Replace local `createGraphTraversal` definition with import**

In `src/attractor/core/graph-validator.ts`:
- Delete lines 35-90 (the local `GraphTraversal` interface and `createGraphTraversal` function).
- Add import near the top:
  ```ts
  import { createValidationContext, RESERVED_VARS, type ValidationContext } from "./validators/context.js";
  ```
- Leave alone: `SYSTEM_VARS` at `:20`, `SUPPORTED_SCRIPT_EXTS` at `:26`, `INLINE_SCRIPT_PATTERNS` at `:28-33`, `isQualifiedKey` at `:22-24`. They are still referenced by inline rules and move out in later chunks.

- [x] **Step 3: Replace inline state-building (`graph-validator.ts:186-236`) with `createValidationContext`**

The body of `validateGraph` currently opens with `const diags: Diagnostic[] = [];` (`:93`), then computes closure state at `:186-236`. The intent: source closure state from `ctx`, but keep the local `diags` identifier so inline rules and helper call sites compile unchanged.

Concrete edit:
1. Find the line `const diags: Diagnostic[] = [];` (around `:93`). Leave it for now.
2. Find the block `:186-236` (from `const RESERVED_VARS = new Set([...])` through the closing `}` of the `for (const [id, node] of nodes)` loop that builds `nodeProduces`).
3. Replace that block with:

```ts
  const ctx = createValidationContext(graph, dotDir);
  const { traversal, nodeProduces, callerInputs } = ctx;
```

4. Above that replacement, change `const diags: Diagnostic[] = [];` to:

```ts
  // Reuse ctx.diags as the accumulator. Keep the local `diags` alias so
  // inline rules and the existing check* helpers compile without churn.
```

then immediately after the `createValidationContext` line add:

```ts
  const diags: Diagnostic[] = ctx.diags;
```

5. Move `for (const node of graph.nodes.values()) { diags.push(...validateNode(node)); }` (currently `:94-96`) so it executes AFTER `ctx` is created — `validateNode` order must match today's. Today it runs before any other rule; here it runs after `ctx` is built but before any cluster rule fires, which is the same emission order (no other rule runs between `:93` and `:94-96` today). Diagnostic emission order is unchanged.

6. The closing `return diags;` (currently `:568`) stays — it returns the same array that `ctx.diags` aliases.

No `null as never` placeholders. No `diagsLegacy` rename. The local `diags` identifier survives as an alias to `ctx.diags`.

- [x] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: clean. Any leftover `diags` reference (without `ctx.`) shows here as `Cannot find name 'diags'`.

- [x] **Step 5: Run validator tests**

Run: `npx vitest run src/attractor/tests/graph-validator-byte-identical.test.ts`
Expected: PASS — same diagnostic stream, same order.

Run: `npx vitest run src/attractor/tests/graph-validator-*.test.ts src/attractor/tests/graph-{gate-validation,inputs-flow,interactive-with-loop-forbidden,interactive-with-outputs-forbidden,orphan-output,outputs-conflict,outputs-derives-produces,outputs-schema-invalid,portability,produces-redundant-broad,required-caller-vars}.test.ts`
Expected: PASS (matches baseline count from Step 1).

- [x] **Step 6: Run full test suite**

Run: `npx vitest run`
Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add src/attractor/core/graph-validator.ts
git commit -m "refactor(attractor/core): graph-validator consumes ValidationContext for its closure state"
```

### Task 1.3: Confirm no public-surface drift

- [x] **Step 1: Verify rule-string set unchanged**

Run: `grep -oE 'rule:\s*"[^"]+"' src/attractor/core/graph-validator.ts | sort -u | wc -l`
Expected: `41` (matches pre-refactor count).

- [x] **Step 2: Verify import-site count of `validateGraph`**

Run: `grep -r 'from ".*graph-validator.js"' src/`
Expected: same hit set as before (no consumer rewrote its import).

- [x] **Step 3: Confirm `validateOrRaise` signature is byte-identical to ADR-0009**

Read `src/attractor/core/graph-validator.ts` end-of-file: `export function validateOrRaise(graph: Graph): void`. Unchanged.

## Verification targets

- Smokes: None — the validator's surface is unit-tested by the byte-identical oracle and 16 sibling tests; no `.dot` smoke pipeline exercises the validator end-to-end at this granularity.
- Manual exercises: `apparat pipeline validate <any.dot>` from a fresh build (`npm run build`) — exit code and stderr/stdout byte-identical to a pre-chunk baseline.
- Lint: `npx tsc --noEmit`; `npx vitest run src/attractor/tests/graph-validator-byte-identical.test.ts`; `npx vitest run src/attractor/tests/graph-validator-*.test.ts`.
- Surfaces touched: `attractor/core/graph-validator` (façade entry), `attractor/core/validators/context` (new).

**Chunk 1 review notes (2026-05-06):**
- `SYSTEM_VARS` is now exported from `validators/context.ts:8` but still locally redeclared at `graph-validator.ts:21`. The local copy will be removed when `inputs-refs.ts` adopts the shared export in Chunk 3 Task 3.4. Until then, the export is unused.
- The `loadAgent` empty-catch in `validators/context.ts:101-103` should gain a one-line "why" comment when ADR-0012 lands (Chunk 4 Task 4.1): partial/in-progress graphs are surfaced by `agent_missing_outputs` instead of crashing the validator.

---

## Chunk 2: Lift "leaf" clusters — `flow`, `types`, `scripts`, `variables`

Goal of this chunk: extract the four clusters whose rules don't depend on `dotDir` agent resolution (`flow`, `types`, `scripts`) plus `variables` (which depends on `traversal` + `callerInputs` + `nodeProduces` — all already on `ctx`). Replace each inline block in `graph-validator.ts` with a call to the cluster's `run(ctx)`. Byte-identical test stays green at every commit. The 11 already-extracted helpers are NOT touched in this chunk (they continue to be called with their legacy signatures, sourcing args from `ctx.*`).

### Task 2.1: `validators/flow.ts`

**Files:**
- Create: `src/attractor/core/validators/flow.ts`
- Modify: `src/attractor/core/graph-validator.ts:99-176`

- [x] **Step 1: Confirm baseline test green**

Run: `npx vitest run src/attractor/tests/graph-validator-byte-identical.test.ts`
Expected: PASS.

- [x] **Step 2: Write `flow.ts`**

Path: `src/attractor/core/validators/flow.ts`

Lift each named block from `graph-validator.ts:99-176` into a separate function. Source-line ranges (verify against the file before copying — line numbers drift if Chunk 1 added/removed lines):

| Function | Source lines | Rule strings emitted |
|---|---|---|
| `checkStartExitCount` | `:99-106` | `start_node`, `terminal_node` |
| `checkReachability` | `:109-126` | `reachability` |
| `checkStartNoIncoming` | `:129-130` | `start_no_incoming` |
| `checkExitNoOutgoing` | `:133-134` (verify) | `exit_no_outgoing` |
| `checkReachesExit` | `:136-162` | `reaches_exit` |
| `checkEdgeEndpoints` | `:165-167` | `edge_target_exists`, `edge_source_exists` |
| `checkConditionSyntax` | `:171-176` | `condition_syntax` |

Skeleton:

```ts
import type { Node } from "../../types.js";
import type { ValidationContext } from "./context.js";
import { parseConditionClauses } from "../conditions.js";

const isStart = (n: Node): boolean => n.shape === "Mdiamond" || n.id === "start" || n.id === "Start";
const isExit  = (n: Node): boolean => n.shape === "Msquare"  || n.id === "exit"  || n.id === "end";

export function run(ctx: ValidationContext): void {
  checkStartExitCount(ctx);
  checkReachability(ctx);
  checkStartNoIncoming(ctx);
  checkExitNoOutgoing(ctx);
  checkReachesExit(ctx);
  checkEdgeEndpoints(ctx);
  checkConditionSyntax(ctx);
}
```

Each function: copy the corresponding source range verbatim into a function body taking `(ctx: ValidationContext)`. Inside, destructure what the original block reads (`const { graph: { nodes, edges }, diags } = ctx;` etc.). Rewrite `nodes` / `edges` / `diags` references; do NOT alter message text, severity, location field order, or rule string spelling. The byte-identical test fails on a trailing space, comma, or punctuation drift.

- [x] **Step 3: Replace inline block in `graph-validator.ts:99-176` with `flow.run(ctx)`**

In `src/attractor/core/graph-validator.ts`:
- Add import: `import * as flow from "./validators/flow.js";` near the other imports.
- Delete lines 99-176 (everything from `const isStart = …` through the close of the condition-syntax block).
- Insert in their place:
  ```ts
  flow.run(ctx);
  ```

The inline references to `startNodes` (used later at `:238`'s variable_coverage block, `if (startNodes.length === 1)`) must continue to compile. Lift the two derivations as locals in the validator body just before `flow.run(ctx)`:

```ts
  const startNodes = [...nodes.values()].filter((n) => n.shape === "Mdiamond" || n.id === "start" || n.id === "Start");
  const exitNodes  = [...nodes.values()].filter((n) => n.shape === "Msquare"  || n.id === "exit"  || n.id === "end");
  flow.run(ctx);
```

`flow.ts` recomputes its own predicate locally; the validator keeps its own copy for the variable_coverage block. The two filter calls produce identical sets. **Cleanup later:** Task 2.4 lifts variable_coverage out of the validator; at that point delete the `startNodes` / `exitNodes` locals from `graph-validator.ts` (Task 2.4 Step 2 calls this out).

- [x] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [x] **Step 5: Run byte-identical test**

Run: `npx vitest run src/attractor/tests/graph-validator-byte-identical.test.ts`
Expected: PASS — diagnostic stream byte-identical.

- [x] **Step 6: Run full validator suite**

Run: `npx vitest run src/attractor/tests/`
Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add src/attractor/core/validators/flow.ts src/attractor/core/graph-validator.ts
git commit -m "refactor(attractor/validators): extract flow rules to validators/flow.ts"
```

### Task 2.2: `validators/types.ts`

**Files:**
- Create: `src/attractor/core/validators/types.ts`
- Modify: `src/attractor/core/graph-validator.ts:179-183`

- [x] **Step 1: Write `types.ts`**

```ts
import type { ValidationContext } from "./context.js";
import { KNOWN_TYPES, UNIMPLEMENTED_TYPES, resolveHandlerType } from "../graph.js";

export function run(ctx: ValidationContext): void {
  for (const node of ctx.graph.nodes.values()) {
    const t = resolveHandlerType(node);
    if (!KNOWN_TYPES.has(t)) {
      ctx.diags.push({ rule: "type_known", severity: "warning", message: `Unknown handler type "${t}" on node "${node.id}"`, location: node.sourceLocation });
    }
    if (UNIMPLEMENTED_TYPES.has(t)) {
      ctx.diags.push({ rule: "type_unsupported", severity: "error", message: `Node type "${t}" is declared but not yet implemented (node "${node.id}")`, location: node.sourceLocation });
    }
  }
}
```

- [x] **Step 2: Replace inline block at `graph-validator.ts:179-183` with `types.run(ctx)`**

Add import: `import * as types from "./validators/types.js";`
Replace the `for (const node of nodes.values()) { … type_known / type_unsupported … }` block with:

```ts
  types.run(ctx);
```

- [x] **Step 3: Type-check, byte-identical, full suite**

Run: `npx tsc --noEmit && npx vitest run src/attractor/tests/graph-validator-byte-identical.test.ts && npx vitest run src/attractor/tests/`
Expected: all PASS.

- [x] **Step 4: Commit**

```bash
git add src/attractor/core/validators/types.ts src/attractor/core/graph-validator.ts
git commit -m "refactor(attractor/validators): extract handler-type rules to validators/types.ts"
```

### Task 2.3: `validators/scripts.ts`

**Files:**
- Create: `src/attractor/core/validators/scripts.ts`
- Modify: `src/attractor/core/graph-validator.ts:328-404` and `:26-33`

The script cluster owns `SUPPORTED_SCRIPT_EXTS` (`graph-validator.ts:26`) and `INLINE_SCRIPT_PATTERNS` (`:28-33`). Move both into `scripts.ts`. Rules covered: `script_command_conflict`, `unsupported_script_extension`, `script_file_exists`, `inline_script_smell`.

- [ ] **Step 1: Write `scripts.ts`**

Lift the body verbatim from `graph-validator.ts:328-404`. Imports: `existsSync` from `fs`, `resolve as resolvePath, extname` from `path`, `expandVariables, extractDefaults, UndefinedVariableError` from `../../transforms/variable-expansion.js`, `resolveHandlerType` from `../graph.js`. The variable-expansion probe at `:383-390` moves verbatim.

```ts
import { existsSync } from "fs";
import { resolve as resolvePath, extname } from "path";
import type { ValidationContext } from "./context.js";
import { expandVariables, extractDefaults, UndefinedVariableError } from "../../transforms/variable-expansion.js";
import { resolveHandlerType } from "../graph.js";

const SUPPORTED_SCRIPT_EXTS = [".mjs", ".js", ".cjs", ".ts", ".mts", ".sh", ".bash", ".py"];
const INLINE_SCRIPT_PATTERNS: RegExp[] = [
  /\bnode\s+-e\b/,
  /\bpython[23]?\s+-c\b/,
  /\bbash\s+-c\b/,
  /<<\s*['"]?[A-Z]/,
];

export function run(ctx: ValidationContext): void {
  // body lifted verbatim from graph-validator.ts:328-404, with `diags` → `ctx.diags`,
  // `dotDir` → `ctx.dotDir`, `nodes` → `ctx.graph.nodes`.
}
```

- [ ] **Step 2: Replace inline block at `graph-validator.ts:328-404` with `scripts.run(ctx)`**

Add import: `import * as scripts from "./validators/scripts.js";`
Delete the inline script-rule block; insert `scripts.run(ctx);`.
Also delete the now-unused module-level `SUPPORTED_SCRIPT_EXTS` and `INLINE_SCRIPT_PATTERNS` constants in `graph-validator.ts:26-33` plus the now-unused imports of `existsSync`, `resolvePath`, `extname` (if no other rule still inline references them — verify with `grep` before deleting).

- [ ] **Step 3: Type-check, byte-identical, full suite**

Run: `npx tsc --noEmit && npx vitest run src/attractor/tests/graph-validator-byte-identical.test.ts && npx vitest run src/attractor/tests/`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add src/attractor/core/validators/scripts.ts src/attractor/core/graph-validator.ts
git commit -m "refactor(attractor/validators): extract script-handler rules to validators/scripts.ts"
```

### Task 2.4: `validators/variables.ts`

**Files:**
- Create: `src/attractor/core/validators/variables.ts`
- Modify: `src/attractor/core/graph-validator.ts:238-326` and `:744-839`

`variables.ts` lifts two inline blocks (`variable_coverage`, `portability_heuristic`) plus the already-extracted `checkRequiredCallerVars` helper (`:744`). All three share `ctx.traversal`, `ctx.nodeProduces`, `ctx.callerInputs`, `RESERVED_VARS`. The `VAR_RE` constant currently at `:188` moves to module scope in `variables.ts`.

- [ ] **Step 1: Write `variables.ts`**

```ts
import type { ValidationContext } from "./context.js";
import { RESERVED_VARS, SYSTEM_VARS } from "./context.js";
import { computeVarsInScope, computeVarsInAnyScope } from "../flow-analyzer.js";
// + any additional imports the lifted blocks need

const VAR_RE = /\$([a-zA-Z_][\w.]*)/g;

export function run(ctx: ValidationContext): void {
  checkVariableCoverage(ctx);
  checkPortabilityHeuristic(ctx);
  checkRequiredCallerVars(ctx);
}

function checkVariableCoverage(ctx: ValidationContext): void {
  // Lifted verbatim from graph-validator.ts:238-307.
}
function checkPortabilityHeuristic(ctx: ValidationContext): void {
  // Lifted verbatim from graph-validator.ts:310-326.
}
function checkRequiredCallerVars(ctx: ValidationContext): void {
  // Lifted verbatim from graph-validator.ts:744-839, with parameters
  // (graph, nodeProduces, dotDir, diags) sourced from ctx.*.
  // Delete the duplicate RESERVED_VARS local declaration at :750 — use the
  // imported one.
}
```

- [ ] **Step 2: Replace inline blocks in `graph-validator.ts`**

Add import: `import * as variables from "./validators/variables.js";`
- Replace `:238-326` (variable_coverage + portability_heuristic blocks) with `variables.runEarly(ctx);` (see split note below).
- Replace `checkRequiredCallerVars(graph, nodeProduces, dotDir, diags);` (currently at `:564`) with `variables.runLate(ctx);`.
- Delete the `function checkRequiredCallerVars(...)` definition at `:744-839`.
- Delete the local `const VAR_RE = …` at `:188` (verify with `grep '\bVAR_RE\b' src/attractor/core/graph-validator.ts` — Chunk 3 Task 3.4 will move the agent-inputs block which still uses `VAR_RE` at `:438`. If that block has not yet moved, leave the local declaration in place and add a TODO comment; delete it in Chunk 3 once `inputs-refs.ts` owns the constant).
- Delete the now-stale `const startNodes = …` and `const exitNodes = …` locals introduced in Task 2.1 Step 3 (they were only used by the variable_coverage block; verify with `grep '\bstartNodes\b\|\bexitNodes\b' src/attractor/core/graph-validator.ts` after the replacement).
- Delete the now-stale `const RESERVED_VARS = new Set([...])` at `:186` (its only consumers were the variable_coverage block and `checkRequiredCallerVars`; both move into `variables.ts` which imports `RESERVED_VARS` from `./context.js`). Verify with `grep '\bRESERVED_VARS\b' src/attractor/core/graph-validator.ts` — expected: zero hits after deletion.

**Order check (critical):** The byte-identical test asserts diagnostic order. Today, the call sequence within `validateGraph` is:

**Order check (critical):** The byte-identical test asserts diagnostic order. Today, `variable_coverage`/`portability` fire BEFORE script rules, and `required_caller_vars` fires AFTER inputs/outputs and dotDir-gated helpers. To preserve that, split `variables.ts` into two entry points called from different points in the orchestrator (and during this chunk, from different points in the still-inline validator body):

```ts
// validators/variables.ts
export function runEarly(ctx: ValidationContext): void {
  checkVariableCoverage(ctx);
  checkPortabilityHeuristic(ctx);
}
export function runLate(ctx: ValidationContext): void {
  checkRequiredCallerVars(ctx);
}
```

`runEarly` lands at the call site where `:238-326` lived (before script rules). `runLate` lands where `checkRequiredCallerVars(...)` was called (after inputs/outputs/dotDir helpers, before `checkGateHandlers`). This two-entry split is the contract carried into Chunk 3's orchestrator (`runAllValidators` calls `variables.runEarly` and `variables.runLate` at distinct points).

- [ ] **Step 3: Type-check, byte-identical, full suite**

Run: `npx tsc --noEmit && npx vitest run src/attractor/tests/graph-validator-byte-identical.test.ts && npx vitest run src/attractor/tests/`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add src/attractor/core/validators/variables.ts src/attractor/core/graph-validator.ts
git commit -m "refactor(attractor/validators): extract variable-coverage rules to validators/variables.ts"
```

## Verification targets

- Smokes: None.
- Manual exercises: `apparat pipeline validate <any.dot>` — diagnostic output byte-identical to pre-Chunk-1 baseline.
- Lint: `npx tsc --noEmit`; `npx vitest run src/attractor/tests/graph-validator-byte-identical.test.ts`; `npx vitest run src/attractor/tests/`.
- Surfaces touched: `attractor/core/validators/{flow,types,scripts,variables}` (new); `attractor/core/graph-validator` (callers).

---

## Chunk 3: Lift `gates`, `interactive`, `inputs-refs`, orchestrator, façade rewrite

Goal of this chunk: extract the remaining clusters, introduce `agent-resolver.ts` as the shared `tryResolveAgent` helper, add `validators/index.ts` orchestrator (`runAllValidators(ctx)`), and rewrite `graph-validator.ts` to a ~40-LOC façade. After this chunk, `wc -l src/attractor/core/graph-validator.ts` < 60 and every rule has been ported. Byte-identical test stays green at every commit.

### Task 3.1: `validators/agent-resolver.ts`

**Files:**
- Create: `src/attractor/core/validators/agent-resolver.ts`

- [ ] **Step 1: Write the helper**

Path: `src/attractor/core/validators/agent-resolver.ts`

```ts
import type { Node } from "../../types.js";
import type { AgentConfig } from "../../../cli/lib/agent.js";
import { loadAgent } from "../../../cli/lib/agent-loader.js";

export function tryResolveAgent(node: Node, dotDir: string | undefined): AgentConfig | undefined {
  if (!node.agent || !dotDir) return undefined;
  try {
    return loadAgent(node.agent as string, dotDir);
  } catch {
    return undefined;
  }
}
```

(Body matches `graph-validator.ts:735-742` verbatim modulo signature normalization.)

- [ ] **Step 2: Type-check (file unused yet — should still compile)**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/attractor/core/validators/agent-resolver.ts
git commit -m "feat(attractor/validators): add shared tryResolveAgent helper"
```

### Task 3.2: `validators/gates.ts`

**Files:**
- Create: `src/attractor/core/validators/gates.ts`
- Modify: `src/attractor/core/graph-validator.ts:1078-1148` and `:566`

- [ ] **Step 1: Write `gates.ts`**

Path: `src/attractor/core/validators/gates.ts`. Lift the body of `checkGateHandlers` (`graph-validator.ts:1078-1148`) verbatim, with parameter list normalized to `(ctx)`.

```ts
import type { ValidationContext } from "./context.js";
import { resolveGate } from "../../../cli/lib/gate-registry.js";

export function run(ctx: ValidationContext): void {
  if (!ctx.dotDir) return; // matches the `if (dotDir)` guard at graph-validator.ts:566
  // body lifted verbatim from :1078-1148; `graph` → `ctx.graph`, `dotDir` → `ctx.dotDir`,
  // `diags` → `ctx.diags`.
}
```

- [ ] **Step 2: Replace `:566` and delete `:1078-1148`**

Add import: `import * as gates from "./validators/gates.js";`
- Replace `if (dotDir) checkGateHandlers(graph, dotDir, ctx.diags);` (around `:566`) with `gates.run(ctx);` (the `dotDir` guard moves into `gates.run`).
- Delete the `function checkGateHandlers(...)` definition at `:1078-1148`.

- [ ] **Step 3: Type-check, byte-identical, full suite**

Run: `npx tsc --noEmit && npx vitest run src/attractor/tests/graph-validator-byte-identical.test.ts && npx vitest run src/attractor/tests/`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add src/attractor/core/validators/gates.ts src/attractor/core/graph-validator.ts
git commit -m "refactor(attractor/validators): extract gate rules to validators/gates.ts"
```

### Task 3.3: `validators/interactive.ts` (per-node helpers, NO standalone `run`)

**Files:**
- Create: `src/attractor/core/validators/interactive.ts`
- Modify: `src/attractor/core/graph-validator.ts` — helper definitions only

**Critical interleaving constraint:** Source `:412-419` runs a per-node loop that interleaves `checkAgentMissingOutputs`, `checkLoopRequiresDoneField`, `checkInteractiveWithOutputs`, `checkInteractiveWithLoop` together — diagnostics from those four helpers emit in a per-node round-robin. A standalone `interactive.run(ctx)` invoked AFTER `inputsRefs.run(ctx)` would reorder diagnostics and break byte-identical.

**Resolution:** `interactive.ts` exports per-node functions only. The orchestrator does NOT call a standalone `interactive.run` — instead, `inputs-refs.ts` (Task 3.4) imports the per-node functions and invokes them inside its `:412-419`-equivalent loop, preserving the round-robin order.

- [ ] **Step 1: Write `interactive.ts` with per-node exports**

```ts
import type { Node } from "../../types.js";
import type { ValidationContext } from "./context.js";
import { tryResolveAgent } from "./agent-resolver.js";

export function checkLoopRequiresDoneField(ctx: ValidationContext, node: Node): void {
  // body lifted verbatim from graph-validator.ts:997-1024
}
export function checkInteractiveWithOutputs(ctx: ValidationContext, node: Node): void {
  // body lifted verbatim from graph-validator.ts:1026-1043
}
export function checkInteractiveWithLoop(ctx: ValidationContext, node: Node): void {
  // body lifted verbatim from graph-validator.ts:1045-1076
}
```

Bodies copied verbatim from the source ranges. Replace `graph` → `ctx.graph`, `dotDir` → `ctx.dotDir`, `diags` → `ctx.diags`. No message-text edits.

- [ ] **Step 2: Delete the three helper definitions from `graph-validator.ts`**

Delete `function checkLoopRequiresDoneField` (`:997-1024`), `function checkInteractiveWithOutputs` (`:1026-1043`), `function checkInteractiveWithLoop` (`:1045-1076`).

The call sites at `:415-417` are still inline calls — they will be migrated by Task 3.4 when the surrounding `:412-419` loop moves into `inputs-refs.ts`. To keep `graph-validator.ts` compiling between this commit and Task 3.4, change the inline call sites at `:415-417` to:

```ts
      interactive.checkLoopRequiresDoneField(ctx, node);
      interactive.checkInteractiveWithOutputs(ctx, node);
      interactive.checkInteractiveWithLoop(ctx, node);
```

and add `import * as interactive from "./validators/interactive.js";` at the top.

- [ ] **Step 3: Type-check, byte-identical, full suite**

Run: `npx tsc --noEmit && npx vitest run src/attractor/tests/graph-validator-byte-identical.test.ts && npx vitest run src/attractor/tests/`
Expected: all PASS. The interleaving is preserved because the per-node loop and call order at `:412-419` are unchanged — only the function definitions moved.

- [ ] **Step 4: Commit**

```bash
git add src/attractor/core/validators/interactive.ts src/attractor/core/graph-validator.ts
git commit -m "refactor(attractor/validators): extract interactive-mode helpers to validators/interactive.ts"
```

### Task 3.4: `validators/inputs-refs.ts` (largest cluster, owns the interactive interleaving)

**Files:**
- Create: `src/attractor/core/validators/inputs-refs.ts`
- Modify: `src/attractor/core/graph-validator.ts:407-553`, `:556-563`, plus helper definitions `:571-733`, `:735-742`, `:841-910`, `:912-960`, `:962-995`

This cluster lifts the four discrete regions of the original validator:
- `:407-409` — first per-node loop calling `checkAgentOutputsConflict` only
- `:412-419` — second per-node loop interleaving `checkAgentMissingOutputs`, `interactive.checkLoopRequiresDoneField`, `interactive.checkInteractiveWithOutputs`, `interactive.checkInteractiveWithLoop` (gated by `if (dotDir)`)
- `:423-553` — third per-node loop (gated by `if (dotDir)`) emitting inputs_missing_frontmatter, steering_has_var_token, rendered_tag_collision, bare_input_*, unknown_source_node, source_missing_output_key
- `:556-563` — non-loop block (gated by `if (dotDir)`) calling `checkMissingInputProducer`, `checkInputTypeMismatch`, `checkOrphanOutput`, `checkOutputsSchemaShape`

**The interactive interleaving stays inside this cluster** — `inputs-refs.ts` imports `interactive`'s per-node functions (Task 3.3) and dispatches them inside the second per-node loop, preserving today's per-node round-robin emission order.

- [ ] **Step 1: Write `inputs-refs.ts` with all 16 rules + interactive dispatch**

```ts
import type { Node } from "../../types.js";
import type { ValidationContext } from "./context.js";
import { RESERVED_VARS, SYSTEM_VARS } from "./context.js";
import { tryResolveAgent } from "./agent-resolver.js";
import { resolveInputDecl } from "../../transforms/inputs-resolver.js";
import { outputsToZod } from "../../../cli/lib/outputs-to-zod.js";
import { resolveHandlerType } from "../graph.js";
import * as interactive from "./interactive.js";

const VAR_RE = /\$([a-zA-Z_][\w.]*)/g;

export function run(ctx: ValidationContext): void {
  // Loop 1 — :407-409 verbatim.
  for (const node of ctx.graph.nodes.values()) {
    checkAgentOutputsConflict(ctx, node);
  }

  // Loop 2 — :412-419 verbatim, including the per-node interactive dispatch.
  if (ctx.dotDir) {
    for (const node of ctx.graph.nodes.values()) {
      checkAgentMissingOutputs(ctx, node);
      interactive.checkLoopRequiresDoneField(ctx, node);
      interactive.checkInteractiveWithOutputs(ctx, node);
      interactive.checkInteractiveWithLoop(ctx, node);
    }
  }

  // Loop 3 — :423-553 verbatim (long inputs-decl block).
  if (ctx.dotDir) {
    for (const node of ctx.graph.nodes.values()) {
      checkInputsForNode(ctx, node);
    }
  }

  // Block 4 — :556-563 verbatim.
  if (ctx.dotDir) {
    checkMissingInputProducer(ctx);
    checkInputTypeMismatch(ctx);
    checkOrphanOutput(ctx);
    checkOutputsSchemaShape(ctx);
  }
}

// Internal helpers — bodies lifted verbatim from the cited source ranges, with
// parameters (graph, node, dotDir, nodeProduces, diags) sourced from ctx.*.

function checkAgentOutputsConflict(ctx: ValidationContext, node: Node): void {
  // body from graph-validator.ts:912-960
}
function checkAgentMissingOutputs(ctx: ValidationContext, node: Node): void {
  // body from graph-validator.ts:962-995
}
function checkInputsForNode(ctx: ValidationContext, node: Node): void {
  // body from graph-validator.ts:424-552 (the per-node body inside the
  // `for (const node of nodes.values())` loop at :423-553)
}
function checkMissingInputProducer(ctx: ValidationContext): void {
  // body from graph-validator.ts:841-910
}
function checkInputTypeMismatch(ctx: ValidationContext): void {
  // body from graph-validator.ts:688-733
}
function checkOrphanOutput(ctx: ValidationContext): void {
  // body from graph-validator.ts:571-663
}
function checkOutputsSchemaShape(ctx: ValidationContext): void {
  // body from graph-validator.ts:665-686
}
```

`tryResolveAgent` is imported from `./agent-resolver.js` (Task 3.1).

- [ ] **Step 2: Replace `:407-563` with a single call**

Add import: `import * as inputsRefs from "./validators/inputs-refs.js";`
Replace the entire `:407-563` region of `graph-validator.ts` with:

```ts
  inputsRefs.run(ctx);
```

This single call subsumes loops 1, 2, 3 and block 4 in their original interleaving.

- [ ] **Step 3: Delete the now-unused helper definitions in the validator**

Delete: `checkOrphanOutput` (`:571-663`), `checkOutputsSchemaShape` (`:665-686`), `checkInputTypeMismatch` (`:688-733`), local `tryResolveAgent` (`:735-742`), `checkMissingInputProducer` (`:841-910`), `checkAgentOutputsConflict` (`:912-960`), `checkAgentMissingOutputs` (`:962-995`). Also delete the local `const VAR_RE = …` at `:188` (Task 2.4 deferred this if `inputs-refs.ts` had not been written yet — now do it). Verify with `grep '\bVAR_RE\b' src/attractor/core/graph-validator.ts` — expected zero hits.

Also delete the `import * as interactive from …` line added in Task 3.3 Step 2 — `graph-validator.ts` no longer references `interactive` directly (the dispatch moved into `inputs-refs.ts`).

- [ ] **Step 4: Type-check, byte-identical, full suite**

Run: `npx tsc --noEmit && npx vitest run src/attractor/tests/graph-validator-byte-identical.test.ts && npx vitest run src/attractor/tests/`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/attractor/core/validators/inputs-refs.ts src/attractor/core/graph-validator.ts
git commit -m "refactor(attractor/validators): extract inputs/outputs reference rules to validators/inputs-refs.ts"
```

### Task 3.5: `validators/index.ts` orchestrator

**Files:**
- Create: `src/attractor/core/validators/index.ts`

- [ ] **Step 1: Write the orchestrator**

```ts
import type { ValidationContext } from "./context.js";
import { validateNode } from "../schemas.js";
import * as flow from "./flow.js";
import * as types from "./types.js";
import * as variables from "./variables.js";
import * as scripts from "./scripts.js";
import * as inputsRefs from "./inputs-refs.js";
import * as gates from "./gates.js";

export function runAllValidators(ctx: ValidationContext): void {
  for (const node of ctx.graph.nodes.values()) {
    ctx.diags.push(...validateNode(node));
  }
  flow.run(ctx);
  types.run(ctx);
  variables.runEarly(ctx);
  scripts.run(ctx);
  inputsRefs.run(ctx);   // dispatches interactive's per-node functions internally
  variables.runLate(ctx);
  gates.run(ctx);
}
```

The order matches the original `validateGraph` body:
1. per-node `validateNode` (`:94-96`)
2. flow rules (`:99-176`) → `flow.run`
3. type rules (`:179-183`) → `types.run`
4. variable_coverage / portability (`:238-326`) → `variables.runEarly`
5. script rules (`:328-404`) → `scripts.run`
6. agent outputs/inputs + interactive interleaving + dotDir-gated helpers (`:407-563`) → `inputsRefs.run` (interactive's per-node functions are dispatched inside `inputsRefs.run`'s second loop, preserving the round-robin emission order at `:412-419`)
7. `checkRequiredCallerVars` (`:564`) → `variables.runLate`
8. `checkGateHandlers` (`:566`) → `gates.run`

**`interactive` is NOT called standalone** — its three rules fire from within `inputs-refs.ts`'s second per-node loop. The orchestrator's import list omits `interactive` for that reason. (Per-node interactive functions remain exported from `interactive.ts` for `inputs-refs.ts` to call.)

- [ ] **Step 2: Type-check (orchestrator unused yet)**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/attractor/core/validators/index.ts
git commit -m "feat(attractor/validators): add runAllValidators orchestrator"
```

### Task 3.6: Rewrite `graph-validator.ts` as ~40-LOC façade

**Files:**
- Modify: `src/attractor/core/graph-validator.ts` (final form: façade only)

- [ ] **Step 1: Replace the file content**

Path: `src/attractor/core/graph-validator.ts`. Replace the whole file with the façade. **Important:** the body of `validateOrRaise` must produce a byte-identical thrown error message to the current implementation at `:1150-1156`. Open `:1150-1156` first, copy the body verbatim into the new façade, and only adjust whitespace if no `\n` boundary inside the message string changes. The example below is illustrative — the actual final form is "whatever today's `:1150-1156` says, transcribed":

```ts
import type { Graph, Diagnostic } from "../types.js";
import { createValidationContext } from "./validators/context.js";
import { runAllValidators } from "./validators/index.js";

export function validateGraph(graph: Graph, dotDir?: string): Diagnostic[] {
  const ctx = createValidationContext(graph, dotDir);
  runAllValidators(ctx);
  return ctx.diags;
}

// validateOrRaise body — copy verbatim from the original :1150-1156 to preserve
// the thrown error message text. The block below is a placeholder showing the
// expected shape; do NOT use it as-is without confirming the source text.
export function validateOrRaise(graph: Graph): void {
  const diags = validateGraph(graph);
  const errors = diags.filter(d => d.severity === "error");
  if (errors.length > 0) {
    throw new Error("Pipeline validation failed:\n" + errors.map(e => `  [${e.rule}] ${e.message}`).join("\n"));
  }
}
```

After writing, `diff` the new `validateOrRaise` body against the original. Whitespace inside the throw string (newlines, indentation, separators) must match. Wrapping the `throw new Error(...)` call across multiple lines is fine as long as the resulting string content is identical.

- [ ] **Step 2: Verify file size**

Run: `wc -l src/attractor/core/graph-validator.ts`
Expected: < 60 lines.

- [ ] **Step 3: Type-check, byte-identical, full suite**

Run: `npx tsc --noEmit && npx vitest run src/attractor/tests/graph-validator-byte-identical.test.ts && npx vitest run src/attractor/tests/`
Expected: all PASS.

- [ ] **Step 4: Run full repo test suite**

Run: `npx vitest run`
Expected: all PASS — no consumer (engine, CLI, MCP) sees a surface change.

- [ ] **Step 5: Smoke validate**

Run: `npm run build && node dist/cli/index.js pipeline validate src/attractor/tests/fixtures/<good-fixture>.dot` (use any `.dot` fixture under `src/attractor/tests/fixtures/`).
Expected: exit code 0, stderr/stdout byte-identical to a pre-refactor capture (capture in Chunk 1 Task 1.2 Step 1 baseline if not already; otherwise compare against a stash of `git stash; <capture>; git stash pop`).

- [ ] **Step 6: Commit**

```bash
git add src/attractor/core/graph-validator.ts
git commit -m "refactor(attractor/core): graph-validator becomes a façade over runAllValidators"
```

## Verification targets

- Smokes: None.
- Manual exercises: `apparat pipeline validate <good.dot>` and `apparat pipeline validate <broken.dot>` — exit codes and stderr/stdout byte-identical to pre-Chunk-1 baseline.
- Lint: `npx tsc --noEmit`; `npx vitest run src/attractor/tests/graph-validator-byte-identical.test.ts`; `npx vitest run src/attractor/tests/`; `npx vitest run`.
- Surfaces touched: `attractor/core/validators/{gates,interactive,inputs-refs,agent-resolver,index}` (new); `attractor/core/graph-validator` (façade rewrite).

---

## Chunk 4: ADR-0012 + final verification

Goal of this chunk: document `ValidationContext` and the cluster layout in ADR-0012, perform end-to-end verification, and confirm the constraints in the design's §8 hold.

### Task 4.1: Write ADR-0012

**Files:**
- Create: `docs/adr/0012-validation-context.md`

- [ ] **Step 1: Confirm ADR template / numbering**

Run: `ls docs/adr/`
Expected: latest ADR is 0009, 0010, or 0011 — confirm the next free integer is `0012`. If a higher-numbered ADR exists, use the next free integer and adjust references in this plan accordingly. (The design assumed 0012 was free; verify before writing.)

- [ ] **Step 2: Write the ADR**

Path: `docs/adr/0012-validation-context.md`. Use the same Markdown layout as `docs/adr/0009-parser-validator-split.md` (read it for the heading style and front-matter convention). Sections to include:

```markdown
# ADR-0012: ValidationContext bundle and clustered validators

**Status:** accepted
**Date:** 2026-05-06
**Predecessor:** ADR-0009 (parser/validator split)

## Context
[1-2 paragraphs: graph-validator.ts internal sprawl after ADR-0009; signature drift across 11 helpers + 24 inline blocks.]

## Decision
[The ValidationContext shape: `{graph, dotDir, nodeProduces, traversal, callerInputs, diags}`. One canonical rule signature `(ctx) => void` (or `(ctx, node)` per-node). Cluster modules under `src/attractor/core/validators/{flow,types,variables,scripts,inputs-refs,interactive,gates}.ts` plus `agent-resolver.ts` and `index.ts` orchestrator.]

## Rule-to-cluster mapping
[Reproduce or link the design doc §3.4 table — one row per rule string.]

## Alternatives considered
- Per-rule files (rejected: traversal helpers would duplicate)
- Cluster-first without context (rejected: signature drift would propagate)

## Consequences
- Every new rule has a one-paragraph "what does a rule receive" answer.
- 41 rule strings, diagnostic messages, and emission order pinned by `src/attractor/tests/graph-validator-byte-identical.test.ts`.
- Façade `graph-validator.ts` < 60 LOC; `validateGraph` / `validateOrRaise` signatures frozen.

## References
- Design doc: docs/superpowers/specs/2026-05-06-graph-validator-context-and-clusters-design.md
- Predecessor: docs/adr/0009-parser-validator-split.md
```

- [ ] **Step 3: Commit**

```bash
git add docs/adr/0012-validation-context.md
git commit -m "docs(adr): ADR-0012 ValidationContext + clustered validators"
```

### Task 4.2: Final constraints verification (design §8)

- [ ] **Step 1: Static checks**

Run: `npx tsc --noEmit`
Expected: clean.

Run: `wc -l src/attractor/core/graph-validator.ts`
Expected: < 60.

Run: `ls src/attractor/core/validators/`
Expected: `agent-resolver.ts context.ts flow.ts gates.ts index.ts interactive.ts inputs-refs.ts scripts.ts types.ts variables.ts` (10 files).

- [ ] **Step 2: Rule-string set count**

Run: `grep -roE 'rule:\s*"[^"]+"' src/attractor/core/validators/ | sort -u | wc -l`
Expected: `41` (matches pre-refactor).

Run: `grep -oE 'rule:\s*"[^"]+"' src/attractor/core/graph-validator.ts | sort -u | wc -l`
Expected: `0` (façade no longer emits diagnostics directly).

- [ ] **Step 3: Import-site check**

Run: `grep -r 'from ".*graph-validator.js"' src/`
Expected: same hit set as Chunk 1 Task 1.3 Step 2 — every test and consumer still imports `validateGraph` / `validateOrRaise` from the unchanged path.

- [ ] **Step 4: Test suite**

Run: `npx vitest run src/attractor/tests/graph-validator-byte-identical.test.ts`
Expected: PASS — the structural guard.

Run: `npx vitest run src/attractor/tests/`
Expected: PASS (16 validator-coverage tests + byte-identical + every other attractor test).

Run: `npx vitest run`
Expected: PASS (full repo).

- [ ] **Step 5: Smoke**

Run: `npm run build && node dist/cli/index.js pipeline validate <good.dot>`
Expected: exit 0, stdout/stderr byte-identical to pre-refactor.

Run: `node dist/cli/index.js pipeline validate <broken.dot>`
Expected: exit 1, diagnostic format and ordering byte-identical.

If a `pipeline run` fixture exists in the repo's smoke tests, also run: `node dist/cli/index.js pipeline run <broken.dot>` — `validateOrRaise` should throw with the byte-identical formatted error string.

- [ ] **Step 6: No-op verification commit (optional)**

If the constraints all pass, no further code changes are needed. If a final tidy commit is warranted (e.g., remove a leftover unused import), make it now:

```bash
git add -p
git commit -m "chore(attractor/validators): final tidy after ValidationContext refactor"
```

(Skip this step if there is nothing to tidy.)

## Verification targets

- Smokes: None — the validator's behaviour is asserted byte-for-byte by the oracle test on a fixture corpus.
- Manual exercises: `apparat pipeline validate <good.dot>` and `apparat pipeline validate <broken.dot>` (byte-identical to pre-refactor); `apparat pipeline run <broken.dot>` (`validateOrRaise` throws byte-identical message).
- Lint: `npx tsc --noEmit`; `npx vitest run src/attractor/tests/graph-validator-byte-identical.test.ts`; `npx vitest run src/attractor/tests/`; `npx vitest run`.
- Surfaces touched: `docs/adr/0012` (new); no source surface change in this chunk.

---

## Open questions surfaced (design §9 — not blockers)

- **`RESERVED_VARS` location.** This plan exports `RESERVED_VARS` from `validators/context.ts` and removes the duplicate at `graph-validator.ts:750`. Default per design §9.
- **Sub-split of `inputs-refs.ts` (`~360 LOC`).** Out of scope. Revisit when rule N+1 lands in that cluster.
- **`validators/` location (sibling vs nested under `core/`).** Plan keeps `core/validators/` per design §9 default and ADR-0009 §17.
