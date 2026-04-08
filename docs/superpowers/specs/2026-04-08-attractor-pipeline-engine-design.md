# Attractor Pipeline Engine — Design Spec

**Date:** 2026-04-08
**Status:** Draft

---

## Table of Contents

1. [Overview and Goals](#1-overview-and-goals)
2. [DOT DSL Schema](#2-dot-dsl-schema)
3. [Architecture](#3-architecture)
4. [Pipeline Execution Engine](#4-pipeline-execution-engine)
5. [Node Handlers](#5-node-handlers)
6. [State and Context](#6-state-and-context)
7. [Human-in-the-Loop](#7-human-in-the-loop)
8. [Validation and Linting](#8-validation-and-linting)
9. [Model Stylesheet](#9-model-stylesheet)
10. [Transforms and Extensibility](#10-transforms-and-extensibility)
11. [Condition Expression Language](#11-condition-expression-language)
12. [Checkpoint and Resume](#12-checkpoint-and-resume)
13. [Pipeline Command](#13-pipeline-command)
14. [runLoop() Refactor](#14-runloop-refactor)
15. [Breaking Changes](#15-breaking-changes)
16. [Testing Strategy](#16-testing-strategy)
17. [Definition of Done](#17-definition-of-done)

---

## 1. Overview and Goals

### 1.1 Problem Statement

Agentic coding workflows — meditate, implement, test, review — often require multiple Claude Code sessions chained together with conditional logic, human approvals, and loop-back retry. Without a structured orchestration layer, developers either write fragile shell scripts or build ad-hoc state machines that are difficult to visualize, version, or debug.

This spec describes adding a DOT-graph pipeline engine (Attractor) as a first-class feature of ralph-cli. Users define agentic workflows as `.dot` files and run them with `ralph pipeline run <dotfile>`. Ralph commands (`meditate`, `implement`, `run-scenarios`) are available as native pipeline node types. The engine lives in `src/attractor/` and is bundled into the existing ralph binary — no new package, no new binary.

### 1.2 Why DOT Syntax

DOT is chosen as the pipeline definition format for the same reasons as the upstream Attractor spec:

- **DOT is inherently a graph description language.** Workflow pipelines are directed graphs. DOT maps the structure directly rather than encoding it in YAML or JSON.
- **Existing tooling.** DOT files can be rendered to SVG/PNG with Graphviz, giving pipeline authors immediate visual feedback.
- **Declarative and version-controllable.** A `.dot` file is a complete, self-contained workflow definition that can be diffed and reviewed in pull requests.
- **Constrained extensibility.** A defined attribute schema keeps the format simple while allowing rich per-node configuration.

### 1.3 Goals

- Express multi-step agentic workflows as DOT graphs
- Run `ralph meditate`, `ralph implement`, and `ralph run-scenarios` as pipeline nodes with typed context passing
- Support checkpoint/resume so a pipeline can restart from the last completed node
- Keep existing commands fully functional as standalone CLI commands

### 1.4 Non-Goals

- Shipping attractor as a separate npm package (may happen later, not now)
- Implementing the full Unified LLM SDK spec
- HTTP server mode or WebSocket event streaming (the upstream §9.5/§9.6 server-mode event stream)
- `full` fidelity mode — requires in-memory LLM session reuse, incompatible with ralph's Claude Code subprocess model (see Section 2.6)

---

## 2. DOT DSL Schema

### 2.1 Graph-Level Attributes

Declared inside the `digraph` block, before any node or edge declarations:

| Attribute | Type | Description |
|---|---|---|
| `goal` | string | Human-readable goal, substituted as `$goal` in node prompts |
| `label` | string | Display name for the pipeline |
| `model_stylesheet` | string | Multi-line CSS-like block controlling Claude Code model selection per node class (see Section 9) |
| `default_max_retries` | int | Default retry limit for all nodes (overridden per-node) |
| `retry_target` | node ID | First-tier fallback when a node fails and has no explicit `retry_target` |
| `fallback_retry_target` | node ID | Second-tier fallback, tried after `retry_target` is exhausted (goal gate and failure routing) |
| `default_fidelity` | string | Default fidelity level for codergen nodes (see Section 2.6); defaults to `compact` |

### 2.2 Node Attributes

| Attribute | Type | Handler(s) | Description |
|---|---|---|---|
| `shape` | string | engine | Controls shape-to-handler mapping (see Section 5) |
| `type` | string | registry | Explicit handler override; takes priority over `shape` |
| `label` | string | all | Display label; used as prompt fallback for codergen nodes |
| `prompt` | string | codergen, ralph.* | Prompt text passed to Claude Code; `$goal` and `$project` are substituted |
| `goal_gate` | bool | engine | If true, engine verifies this node succeeded before allowing exit |
| `max_retries` | int | engine | Maximum retries on RETRY or FAIL outcome (default 0) |
| `retry_target` | node ID | engine | First-tier fallback node after retry exhaustion or goal gate failure |
| `fallback_retry_target` | node ID | engine | Second-tier fallback node, tried after node `retry_target` is empty |
| `tool_command` | string | tool | Shell command to execute; `$goal` and `$project` are substituted |
| `timeout` | int | all | Timeout in seconds for handler execution |
| `fidelity` | string | codergen | Fidelity level for context carryover (see Section 2.6); `full` not supported in v1 |
| `class` | string | stylesheet | CSS-like class name; merges in model_stylesheet properties |
| `auto_status` | bool | engine | If true, engine auto-generates `success` outcome when handler writes no status — **recognized but no-op in v1**; ralph handlers always return explicit outcomes |
| `allow_partial` | bool | all | When true, `RETRY` outcome on exhaustion becomes `partial_success` instead of `fail` — **recognized but no-op in v1** (see Section 4.4); deferred to v2 |

### 2.3 Edge Attributes

| Attribute | Type | Description |
|---|---|---|
| `label` | string | Human-readable edge label; also used for preferred_label matching |
| `condition` | string | Boolean expression gating edge eligibility (see Section 11) |
| `weight` | number | Priority among unconditional edges; lower value wins (omitted = lowest priority) |
| `loop_restart` | bool | When true, fully restarts the pipeline from the start node: clears context, retry counters, and creates a fresh run directory |
| `fidelity` | string | Fidelity level override for the target node when this edge is traversed; takes highest precedence over node-level and graph-level fidelity settings (see Section 2.6). Valid values: `truncate`, `compact`, `summary:low`, `summary:medium`, `summary:high` |
| `thread_id` | string | Assigns edge target to a named execution thread for `full` fidelity session reuse — **v1 not supported** (`full` fidelity is a non-goal; see Section 1.4); parser recognizes but ignores |

### 2.4 Supported DOT Subset

- `digraph { ... }` wrapper (required)
- Graph attribute block: `graph [key=value, ...]`
- Node declarations: `node_id [attr=value, attr="multi word value"]`
- Edge declarations: `A -> B` and `A -> B [label="...", condition="..."]`
- Chained edges: `A -> B -> C` produce individual edges for each pair
- Default attribute blocks: `node [shape=box]` and `edge [weight=1]` apply to subsequent declarations
- Subgraph blocks: contents are flattened (wrapper discarded)
- Comments: `//` line comments and `/* */` block comments stripped before parsing
- Quoted and unquoted attribute values both accepted
- Multi-line attribute blocks within `[...]` supported

**Not supported:** strict digraphs, undirected graphs, HTML labels, external subgraph references.

### 2.5 Attribute Naming Convention

DOT attributes use `snake_case` (e.g. `loop_restart`, `goal_gate`, `tool_command`). The graph parser converts these to camelCase in the TypeScript `Node` and `Edge` types (e.g. `loopRestart`, `goalGate`, `toolCommand`).

### 2.6 Fidelity Levels

Fidelity controls how much prior session context is synthesized and passed to the next Claude Code invocation. All fidelity modes except `full` use fresh Claude Code subprocess invocations with a synthesized preamble string.

| Mode | Context Carried | Notes |
|---|---|---|
| `full` | Full conversation history | **Not supported in v1** — requires in-memory LLM session reuse |
| `truncate` | Minimal (graph goal + run ID only) | Lowest token cost |
| `compact` | Structured bullet summary of completed stages, outcomes, key context values | **Default** |
| `summary:low` | Brief textual summary with minimal event counts | ~600 tokens |
| `summary:medium` | Moderate detail: recent stage outcomes, active context values | ~1500 tokens |
| `summary:high` | Detailed: many recent events, tool call summaries, comprehensive context | ~3000 tokens |

**Resolution precedence (highest to lowest):**
1. Edge `fidelity` attribute (on the incoming edge)
2. Target node `fidelity` attribute
3. Graph `default_fidelity` attribute
4. Default when unset: `compact`

The preamble transform (Section 10.3) synthesizes context carryover text at execution time for all non-`full` modes before invoking `runLoop()`.

---

## 3. Architecture

### 3.1 File Layout

```
src/
├── cli/
│   ├── commands/
│   │   └── pipeline.ts          NEW — ralph pipeline run / validate
│   └── lib/
│       └── loop.ts              MODIFIED — returns LoopResult, accepts AbortSignal
│
├── attractor/
│   ├── types.ts                 NEW — shared types (Node, Edge, Graph, Outcome, Context)
│   ├── core/
│   │   ├── graph.ts             NEW — DOT parser + schema validator
│   │   ├── engine.ts            NEW — traversal, edge selection, retry, goal gate
│   │   └── conditions.ts        NEW — edge expression evaluator
│   ├── handlers/
│   │   ├── registry.ts          NEW — handler map, register/lookup
│   │   ├── codergen.ts          NEW — default box handler, wraps runLoop()
│   │   ├── tool.ts              NEW — shell handler, exit code -> Outcome
│   │   ├── wait-human.ts        NEW — hexagon handler, interviewer-based pause
│   │   ├── conditional.ts       NEW — diamond no-op, engine drives edge selection
│   │   ├── ralph-implement.ts   NEW — type="ralph.implement"
│   │   ├── ralph-scenarios.ts   NEW — type="ralph.run-scenarios"
│   │   └── ralph-meditate.ts    NEW — type="ralph.meditate"
│   ├── interviewer/
│   │   ├── index.ts             NEW — Interviewer interface + factory
│   │   ├── console.ts           NEW — ConsoleInterviewer (stdin readline)
│   │   ├── auto-approve.ts      NEW — AutoApproveInterviewer (always picks first)
│   │   ├── callback.ts          NEW — CallbackInterviewer (delegate to function)
│   │   └── queue.ts             NEW — QueueInterviewer (pre-filled queue, for tests)
│   ├── stylesheet/
│   │   └── index.ts             NEW — model_stylesheet parser and resolver
│   ├── transforms/
│   │   └── variable-expand.ts   NEW — $goal/$project substitution transform
│   └── checkpoint/
│       └── index.ts             NEW — save/restore checkpoint.json
│
└── daemon/                      UNCHANGED
```

**No tsup changes.** `src/attractor/` is imported by `src/cli/commands/pipeline.ts` and bundled automatically into the existing `dist/cli/index.js` entry. No new binary.

### 3.2 Core Types

```typescript
// src/attractor/types.ts

export type StageStatus =
  | "success"
  | "partial_success"
  | "fail"
  | "retry"
  | "skipped";

export interface Outcome {
  status: StageStatus;
  preferredLabel?: string;
  suggestedNextIds?: string[];
  contextUpdates?: Record<string, unknown>;
  notes?: string;
  failureReason?: string;
}

export interface Context {
  values: Map<string, unknown>;
  get(key: string): unknown;
  getStr(key: string): string;
  set(key: string, value: unknown): void;
  applyUpdates(updates: Record<string, unknown>): void;
  snapshot(): Record<string, unknown>;
  clone(): Context;
}

export interface Node {
  id: string;
  shape: string;
  type?: string;                 // explicit handler override
  label?: string;
  prompt?: string;
  toolCommand?: string;
  timeout?: number;
  goalGate?: boolean;
  maxRetries?: number;
  retryTarget?: string;
  fallbackRetryTarget?: string;  // second-tier failure routing
  fidelity?: string;
  llmModel?: string;             // resolved from model_stylesheet llm_model
  llmProvider?: string;          // resolved from model_stylesheet llm_provider (no-op v1)
  reasoningEffort?: string;      // resolved from model_stylesheet reasoning_effort
  attrs: Record<string, string>;
}

export interface Edge {
  from: string;
  to: string;
  label?: string;
  condition?: string;
  weight?: number;
  loopRestart?: boolean;
}

export interface Graph {
  id: string;
  goal?: string;
  nodes: Map<string, Node>;
  edges: Edge[];
  defaultMaxRetries?: number;
  retryTarget?: string;
  fallbackRetryTarget?: string;  // second-tier graph-level failure routing
  defaultFidelity?: string;
  modelStylesheet?: string;
}

export interface Handler {
  execute(
    node: Node,
    context: Context,
    graph: Graph,
    logsRoot: string
  ): Promise<Outcome>;
}
```

---

## 4. Pipeline Execution Engine

### 4.1 Execution Loop

The engine traverses the graph node-by-node until it reaches a terminal node (shape=Msquare) or the pipeline fails:

1. Resolve start node (shape=Mdiamond or id matching `start`/`Start`)
2. Call `handler.execute(node, context, graph, logsRoot)`
3. Merge `outcome.contextUpdates` into context
4. Write `{logsRoot}/{node.id}/status.json`
5. Save checkpoint
6. Select next edge (see Section 4.3)
7. Advance to next node; repeat from step 2
8. On terminal node: check goal gates; emit pipeline outcome

### 4.2 Goal Gate Enforcement

Nodes with `goal_gate=true` are tracked throughout execution. Before the engine allows exit via a terminal node:

1. All goal-gate nodes must have reached `success` or `partial_success`
2. If any goal-gate node has not succeeded, the engine cascades through retry targets:
   - node `retry_target` → node `fallback_retry_target` → graph `retry_target` → graph `fallback_retry_target`
3. If no target exists at any level and goal gates are unsatisfied, pipeline outcome is `fail`

### 4.3 Edge Selection Algorithm

When a node completes, the engine selects the next edge in this priority order:

1. Edges whose `condition` expression evaluates to true against the current outcome and context
2. Edge whose `label` matches `outcome.preferredLabel` (see label normalization below)
3. Edge whose `to` is in `outcome.suggestedNextIds`
4. Lowest `weight` among unconditional edges (lower value = higher priority; edges with no `weight` set are lowest priority)
5. Lexical tiebreak on target node ID

**Label normalization for `preferred_label` matching:** Before comparing `outcome.preferredLabel` against edge labels, both sides are normalized by:
- Stripping leading accelerator prefixes matching the pattern `X `, `X) `, or `X - ` (where X is any single character or digit), e.g. `[Y] Yes` → `Yes`, `1) Approve` → `Approve`, `Y - Confirm` → `Confirm`
- Case-insensitive comparison after stripping

This ensures that when `wait.human` nodes present choices formatted with keyboard accelerators (e.g. `[Y] Yes`, `1) No`), the handler's `preferred_label` output (the bare word) still matches the full edge label.

### 4.4 Retry Logic

Per-node `max_retries` attribute (default 0 = no retry). On `status: "retry"` or `status: "fail"` outcome:

1. Increment `nodeRetries[nodeId]`
2. If retries remaining: wait with exponential backoff + jitter, re-execute the node
3. If retries exhausted: outcome becomes `fail` and normal edge selection runs — the engine selects the next edge using the standard algorithm (Section 4.3) with `outcome=fail`. If the graph has an explicit outgoing edge matching `outcome=fail`, that edge fires. If no matching edge exists, the pipeline fails. **The `retry_target` node attribute is NOT automatically invoked at retry exhaustion for non-terminal nodes.**

**Goal gate enforcement (terminal nodes only):** When a terminal `Msquare` node is reached and a `goal_gate=true` node in the completed path did not reach `success`, the engine cascades: node `retry_target` → node `fallback_retry_target` → graph `retry_target` → graph `fallback_retry_target` → pipeline fail. This is the only path where `retry_target` is automatically invoked by the engine.

Retryable errors: network failures, claude CLI unavailable. Non-retryable: invalid prompt file, auth errors.

Backoff schedule: base 1s, multiplier 2x, max 30s, jitter ±20%.

**`allow_partial` (v1 not supported):** The upstream spec defines a node attribute `allow_partial=true` that causes retry exhaustion to emit `PARTIAL_SUCCESS` instead of `fail`, allowing a pipeline to continue past a partially-successful node. This attribute is recognized by the parser in v1 but has no effect — retry exhaustion always yields `fail`. `allow_partial` support is deferred to v2.

Traversal of an edge with `loop_restart=true` terminates the current run, clears all context and retry counters, creates a fresh run directory, and re-launches the pipeline from the start node — equivalent to a full pipeline restart.

### 4.5 Error Handling

| Error | Behavior |
|---|---|
| Handler throws | Caught by engine, converted to `status: "fail"` Outcome |
| Node fails with no matching outgoing edge | Cascade: node `retry_target` → node `fallback_retry_target` → graph `retry_target` → graph `fallback_retry_target` → pipeline fail |
| `goal_gate=true` node did not succeed at exit | Same cascade as above; pipeline fails if all levels empty |
| Invalid DOT file | `validate` prints diagnostics; `run` aborts before execution starts |
| AbortSignal fired (SIGINT) | Engine checkpoints current node state, then exits cleanly |

---

## 5. Node Handlers

### 5.1 Handler Registry

```typescript
// src/attractor/handlers/registry.ts

export interface HandlerRegistry {
  register(type: string, handler: Handler): void;
  lookup(node: Node): Handler;
}
```

**Precedence rule:** `type` attribute takes priority over `shape`. If a node declares `type="ralph.implement"`, the registry resolves the `ralph.implement` handler regardless of `shape`. If no `type` is set, the registry falls back to the shape-to-handler mapping. If neither matches, the engine throws a validation error before execution begins.

The default registry is created inside `engine.ts` and pre-populated with all built-in handlers. Callers can extend it via `registry.register()` before calling `engine.run()`.

Custom handlers can be registered by type string: `registry.register("org.myhandler", myHandler)`.

### 5.2 Shape-to-Handler Mapping

| DOT Shape | Handler | Description |
|---|---|---|
| `Mdiamond` | start | No-op, returns success immediately |
| `Msquare` | exit | No-op, engine performs goal gate check |
| `box` (default) | codergen | Calls `runLoop()` with node prompt via Claude Code |
| `hexagon` | wait.human | Pauses pipeline for human input via Interviewer |
| `diamond` | conditional | No-op pass-through; engine evaluates edge conditions to select outgoing edge |
| `parallelogram` | tool | Executes shell command (`node.toolCommand`); exit code → Outcome |
| `component` | parallel | Fan-out across child nodes concurrently with isolated context clones |
| `tripleoctagon` | parallel.fan_in | Barrier join — waits for all parallel branches to complete |
| `house` | stack.manager_loop | Child pipeline supervisor loop (observe/steer/wait cycles) |
| `circle` | ralph.implement | Ralph-native: calls `runLoop()` directly; resolved via `type="ralph.implement"` |
| `octagon` | ralph.meditate | Ralph-native: calls meditate logic directly; resolved via `type="ralph.meditate"` |
| `square` | ralph.run-scenarios | Ralph-native: calls run-scenarios logic directly; resolved via `type="ralph.run-scenarios"` |

### 5.3 Codergen Handler

The default handler for `box` nodes. Translates the attractor "CodergenBackend" concept to Claude Code:

1. Expands `$goal` and `$project` in `node.prompt`
2. Writes expanded prompt to `{logsRoot}/{node.id}/prompt.md`
3. Calls `runLoop({ promptFile, cwd, model: node.llmModel, signal })` from `loop.ts`
4. Writes session output to `{logsRoot}/{node.id}/response.md`
5. Returns `Outcome` derived from `LoopResult`

If `node.prompt` is empty, uses `node.label` as fallback. Writes a temporary prompt file under `logsRoot` for the Claude Code invocation.

### 5.4 Tool Handler

The tool handler maps to the `parallelogram` shape.

Executes `node.toolCommand` as a shell command:

1. Expands `$goal` and `$project` in the command string
2. Spawns the command via child process
3. Non-zero exit code → `status: "fail"`; exit code 0 → `status: "success"`
4. Stdout/stderr written to `{logsRoot}/{node.id}/response.md`

**Ralph-specific fix vs. upstream spec:** The upstream attractor tool handler ignores exit codes and only pipes stdout to context. Ralph's `tool.ts` maps exit codes to outcomes, enabling exit-code-based routing for CI-style shell commands.

### 5.5 Wait.Human Handler

See Section 7 (Human-in-the-Loop).

### 5.6 Conditional Handler

The `conditional` handler maps to the `diamond` shape. It is a no-op pass-through — the handler returns `success` immediately without executing any LLM call or tool. The engine's edge selection algorithm then evaluates the outgoing edge conditions against the current context to determine the next node. Use conditional nodes to branch on context values without adding an execution step.

### 5.7 Parallel Handler

Maps to `component` shape. Fan-out: spawns all outgoing-edge target nodes as concurrent branches. Each branch receives an **isolated clone** of the current context. Branches run concurrently, bounded by the graph-level `max_parallel` attribute (default: 4). Branch context changes are NOT merged back into the main context; only the handler's `contextUpdates` are applied. Results are stored in `context["parallel.results"]` as an array keyed by branch node ID. Execution continues when all branches complete (join policy: `wait_all`).

### 5.8 Fan-in Handler

Maps to `tripleoctagon` shape. Waits for all parallel branches launched by a preceding `parallel` node to complete, then consolidates results. The handler reads `context["parallel.results"]`, determines an aggregate outcome (`success` if all branches succeeded; `partial_success` if at least one succeeded; `fail` if all failed), and exposes the consolidated results for downstream edge conditions. Returns `success` or `partial_success` or `fail` accordingly.

### 5.9 Ralph-Native Handler Types

Registered automatically when the pipeline engine initializes. Nodes reference them via `type="..."`.

**`type="ralph.implement"`**

Calls `runLoop()` directly with the node's resolved prompt and project path. Writes to context on completion:

```typescript
contextUpdates: {
  "implement.sessionId": string,
  "implement.iterations": number,
  "implement.success": "true" | "false"
}
```

**`type="ralph.run-scenarios"`**

Calls the run-scenarios logic directly. Returns `status: "fail"` if any scenario fails. Writes to context:

```typescript
contextUpdates: {
  "scenarios.passed": "true" | "false",
  "scenarios.total": string,
  "scenarios.failed": string
}
```

**`type="ralph.meditate"`**

Calls the meditate logic directly. Writes to context:

```typescript
contextUpdates: {
  "meditate.sessionId": string,
  "meditate.illuminations": string   // count as string
}
```

### 5.10 Manager Loop Handler

Maps to `house` shape. Supervises a child pipeline specified by `stack.child_dotfile` node attribute. The handler runs an observe/steer/wait loop:
- **observe**: ingests child pipeline telemetry (stdout, checkpoint state) into context under `stack.child.*` keys
- **steer**: optionally injects an intervention prompt into the child (if guard condition is met)
- **wait**: sleeps for `manager.poll_interval` seconds (default: 45) before the next cycle

The loop terminates when any of the following is true:
- `stack.child.*` signals completion (exit node reached)
- `manager.max_cycles` is exceeded (default: 1000) — returns `fail`
- A configured stop-condition guard expression evaluates to true

Context keys set by this handler:

| Key | Value |
|-----|-------|
| `stack.child.status` | Last observed child pipeline status |
| `stack.child.current_node` | Child's current node ID |
| `stack.child.outcome` | Child's final outcome on completion |

**Note:** v1 implementation of the manager loop handler integrates with `ralph implement` (the `circle` shape handler) as the canonical child pipeline runner. Full cross-pipeline DOT file supervision is deferred to v2.

---

## 6. State and Context

### 6.1 Context Store

Context is a key-value store (string keys, any value) accessible to all handlers during execution:

- Handlers read context via `context.get(key)` / `context.getStr(key)` (missing keys return `""`)
- Handlers return `contextUpdates` in their `Outcome`; the engine merges these after each node
- Context is snapshotted into `checkpoint.json` after each node completes
- On resume, context is restored from the checkpoint before continuing

### 6.2 Built-In Context Variables

#### Engine-managed keys (set automatically on every node execution)

These keys are written by the engine before each node handler runs and after each handler returns. Condition expressions and edge selectors may reference them.

| Key | Description |
|---|---|
| `outcome` | Outcome status of the last completed handler: `success`, `retry`, `fail`, `partial_success` |
| `preferred_label` | Preferred edge label returned by the last handler; used in edge selection step 2 |
| `graph.goal` | Mirrored from the graph-level `goal` attribute at pipeline start |
| `current_node` | ID of the currently executing node |
| `last_stage` | ID of the last completed stage (set after handler returns) |
| `last_response` | Truncated text of the last LLM response (codergen nodes only; empty string otherwise) |
| `internal.retry_count.<node_id>` | Per-node retry counter; incremented on each RETRY outcome, reset to 0 on `loop_restart` edge traversal |

#### Standard context keys (set by engine after each node)

| Key | Set By | Value |
|-----|--------|-------|
| `last_stage.<node_id>` | engine | Outcome object of the completed node (`{ status, notes, failureReason }`) |
| `tool.output` | tool handler | Stdout of the last tool command execution |
| `parallel.results` | parallel handler | Array of branch outcomes keyed by node ID |
| `stack.child.status` | manager_loop handler | Last observed child pipeline status |
| `stack.child.current_node` | manager_loop handler | Child's current node ID |
| `stack.child.outcome` | manager_loop handler | Child's final outcome on completion |

#### Handler-set keys (written by specific ralph handlers)

| Key | Set By | Value |
|---|---|---|
| `$goal` | engine at start | Graph-level `goal` attribute |
| `$project` | `--project` flag | Absolute path to project folder |
| `implement.sessionId` | ralph.implement | Claude Code session ID |
| `implement.iterations` | ralph.implement | Loop iteration count |
| `implement.success` | ralph.implement | `"true"` or `"false"` |
| `scenarios.passed` | ralph.run-scenarios | `"true"` or `"false"` |
| `scenarios.total` | ralph.run-scenarios | Total scenario count |
| `scenarios.failed` | ralph.run-scenarios | Failed scenario count |
| `meditate.sessionId` | ralph.meditate | Claude Code session ID |
| `meditate.illuminations` | ralph.meditate | Illumination count |

### 6.3 Artifact Storage

After each node execution, the engine writes:

```
{logsRoot}/{node.id}/
    status.json      — Outcome object (status, notes, failureReason)
    prompt.md        — Expanded prompt sent to Claude Code (codergen nodes)
    response.md      — Claude Code output (codergen, tool nodes)
```

---

## 7. Human-in-the-Loop

### 7.1 Interviewer Interface

The `wait.human` handler (hexagon shape) pauses the pipeline and delegates to an `Interviewer` to collect human input. The Interviewer is an interface — multiple implementations exist for different contexts:

```typescript
// src/attractor/interviewer/index.ts

export type QuestionType = "YES_NO" | "MULTIPLE_CHOICE" | "FREEFORM" | "CONFIRMATION";

export interface Question {
  text: string;
  type: QuestionType;
  choices?: string[];   // for MULTIPLE_CHOICE; derived from outgoing edge labels
}

export interface Answer {
  value: string;
}

export interface Interviewer {
  ask(question: Question): Promise<Answer>;
}
```

### 7.2 Interviewer Implementations

| Implementation | Description |
|---|---|
| `ConsoleInterviewer` | Prints question and choices to terminal, reads user input from stdin |
| `AutoApproveInterviewer` | Always selects the first choice; used in automation/CI pipelines |
| `CallbackInterviewer` | Delegates to a provided function; used for testing with custom logic |
| `QueueInterviewer` | Reads from a pre-filled answer queue; used in unit tests |

### 7.3 Wait.Human Handler Protocol

The `wait.human` handler derives question choices from the outgoing edge labels of the current node:

```dot
human_gate [shape=hexagon, label="Accept meditation?"]
human_gate -> implement [label="Yes"]
human_gate -> meditate  [label="Redo"]
```

**Execution flow:**

1. Handler collects outgoing edge labels → choices `["Yes", "Redo"]`
2. Calls `interviewer.ask({ text: node.label, type: "MULTIPLE_CHOICE", choices })`
3. User (or automation) provides an answer
4. Handler returns `Outcome { status: "success", preferredLabel: answer.value }`
5. Engine uses `preferredLabel` to select the matching outgoing edge

Edge `label` values are normalized for `preferredLabel` matching using the same rule as Section 4.3: leading accelerator prefixes (`[X] `, `X) `, `X - `) are stripped, then comparison is case-insensitive. The handler returns the bare answer value (e.g. `"Yes"`); the engine strips any accelerator from the edge label (e.g. `"[Y] Yes"` → `"Yes"`) before comparing.

### 7.4 CLI Resume Pattern

When running interactively, the engine uses `ConsoleInterviewer` by default. The hexagon node does not require a checkpoint-based `--resume` flow — the engine pauses execution in-process, awaits stdin, then continues. This simplifies the protocol compared to the suspend/resume checkpoint approach described in the early design spec.

However, if the process is killed while waiting at a hexagon node, the checkpoint records `currentNode` as the hexagon node ID. On `ralph pipeline run <dotfile> --resume`, the engine restores state and re-enters the hexagon handler, which re-prompts the user.

---

## 8. Validation and Linting

### 8.1 Lint Rules

| Rule | Severity | Check |
|------|----------|-------|
| `start_node` | ERROR | Exactly one start node (shape=Mdiamond or id matching `start`/`Start`) |
| `terminal_node` | ERROR | Exactly one exit node (shape=Msquare or id matching `exit`/`end`) |
| `reachability` | ERROR | All nodes reachable from start (no orphans) |
| `edge_target_exists` | ERROR | All edge targets exist as declared nodes |
| `start_no_incoming` | ERROR | Start node has no incoming edges |
| `exit_no_outgoing` | ERROR | Exit node has no outgoing edges |
| `condition_syntax` | ERROR | Edge `condition` expressions parse without errors |
| `stylesheet_syntax` | ERROR | `model_stylesheet` attribute parses without errors |
| `type_known` | WARNING | Node `type` values are recognized handler names |
| `fidelity_valid` | WARNING | Node and edge `fidelity` values are valid modes |
| `retry_target_exists` | WARNING | `retry_target` and `fallback_retry_target` reference existing nodes |
| `goal_gate_has_retry` | WARNING | Nodes with `goal_gate=true` have at least one retry path configured |
| `prompt_on_llm_nodes` | WARNING | `codergen`/`box` nodes have a non-empty `prompt` or `label` |
| `loop_restart_target` | WARNING | Edges with `loop_restart=true` are not also the only exit path |

`validate_or_raise()` throws on any error-severity violation.

### 8.2 Warning-Severity Violations (logged, do not block)

See lint rules table above.

### 8.3 Lint Result Format

Each lint result includes: rule name, severity (`error` | `warning`), node or edge ID, and human-readable message.

---

## 9. Model Stylesheet

### 9.1 Overview

The `model_stylesheet` graph attribute controls Claude Code invocation options per node class. It uses a CSS-like syntax where selectors target nodes by shape, class, or ID.

The upstream attractor spec defines three recognized properties: `llm_model`, `llm_provider`, and `reasoning_effort`. Ralph-cli maps these to Claude Code flags as described in Section 9.4.

### 9.2 Syntax

```
model_stylesheet = "
  box              { llm_model: claude-opus-4-6 }
  .fast            { llm_model: claude-haiku-4-5-20251001 }
  #review          { llm_model: claude-opus-4-6; reasoning_effort: high }
"
```

### 9.3 Recognized Properties

The grammar is exhaustive — only these three properties are recognized:

| Property | Upstream Type | Ralph-cli Mapping |
|---|---|---|
| `llm_model` | model identifier string | Passed as `--model <value>` to Claude Code |
| `llm_provider` | provider key (`anthropic`, `openai`, etc.) | **No-op in v1** — ralph-cli uses Claude exclusively; recognized for schema compatibility |
| `reasoning_effort` | `low` \| `medium` \| `high` | **No-op in v1** — recognized and parsed but not passed to Claude Code; mapping to extended thinking flags is deferred to v2 |

### 9.4 Selectors and Specificity

| Selector | Matches | Specificity |
|---|---|---|
| `*` | all nodes | lowest |
| `box`, `hexagon`, etc. | nodes by shape | low |
| `.classname` | nodes with matching `class` attribute | medium |
| `#node-id` | node with exact ID | highest |

Later declarations of equal specificity override earlier ones. Explicit node attributes override all stylesheet rules.

### 9.5 Default

If no `model_stylesheet` is declared and no node has an explicit `llm_model` attribute, `runLoop()` is called without `--model`, using the claude CLI's default model.

---

## 10. Transforms and Extensibility

### 10.1 AST Transform Interface

Transforms are functions that receive a parsed `Graph` and return a modified `Graph`. They run after parsing, before validation.

```typescript
export type Transform = (graph: Graph) => Graph;
```

Transforms are applied in registration order. The engine applies all registered transforms before calling `validateOrRaise()`.

### 10.2 Built-In Transform: Variable Expansion

The variable expansion transform replaces `$goal` and `$project` tokens in `node.prompt` and `node.toolCommand` attributes at graph-parse time, using:
- `$goal` → `graph.goal`
- `$project` → value of `--project` CLI flag

This runs before validation so that validators see the expanded values.

### 10.3 Built-In Transform: Preamble Synthesis

The preamble transform synthesizes context carryover text for codergen nodes that do not use `full` fidelity. It runs **at execution time** (not at parse time), after a node completes and before the next node is invoked, because it depends on runtime context and completed-stage outcomes.

For each fresh-session fidelity mode, the preamble prepends a synthetic summary to the node's prompt:

- `compact`: structured bullet list of completed stages, their outcomes, and key context values
- `summary:low/medium/high`: progressively more detailed textual summary
- `truncate`: minimal (graph goal and run ID only)

The synthesized preamble is appended to the temporary prompt file that `runLoop()` receives.

### 10.4 Registering Custom Transforms

```typescript
engine.addTransform((graph) => {
  // modify graph.nodes or graph.edges
  return graph;
});
```

---

## 11. Condition Expression Language

### 11.1 Grammar

Edge conditions use a minimal boolean expression language:

```
ConditionExpr  ::= Clause ( '&&' Clause )*
Clause         ::= Key Operator Literal
Key            ::= 'outcome'
                 | 'preferred_label'
                 | 'context.' Path
Operator       ::= '=' | '!='
Literal        ::= any string (unquoted or single-quoted)
```

- `=` performs case-sensitive string equality
- `!=` performs case-sensitive string inequality
- `&&` is the only supported conjunction (no OR, no NOT)
- Missing context keys resolve to empty string `""`
- An empty condition string is always true (unconditional edge)

### 11.2 Examples

```
outcome=success
outcome=fail
context.scenarios.passed=true
preferred_label=Yes
outcome=success && context.implement.success=true
```

---

## 12. Checkpoint and Resume

### 12.1 `logsRoot` Computation

```
logsRoot  = ~/.ralph/runs/<slug>-<timestamp>/
slug      = basename of .dot file, lowercased, spaces→hyphens
            e.g. "coding-pipeline.dot" → "coding-pipeline"
timestamp = compact ISO-8601 UTC: "20260408T130000Z"
```

The resolved `logsRoot` is passed to every `Handler.execute()` call.

### 12.2 CheckpointState Interface

```typescript
// src/attractor/checkpoint/index.ts

export interface CheckpointState {
  timestamp: string;              // ISO-8601
  currentNode: string;            // node ID to resume from
  completedNodes: string[];       // node IDs that reached a terminal outcome
  nodeRetries: Record<string, number>;
  context: Record<string, unknown>;
}

export function saveCheckpoint(logsRoot: string, state: CheckpointState): Promise<void>;
export function loadCheckpoint(logsRoot: string): Promise<CheckpointState | null>;
```

### 12.3 Checkpoint File Format

Written to `{logsRoot}/checkpoint.json` after each node completes:

```json
{
  "timestamp": "2026-04-08T13:00:00Z",
  "current_node": "implement",
  "completed_nodes": ["start", "meditate"],
  "node_retries": {},
  "context": {
    "meditate.sessionId": "abc123",
    "meditate.illuminations": "3"
  }
}
```

### 12.4 Run Directory Layout

```
~/.ralph/runs/<pipeline-slug>-<timestamp>/
├── checkpoint.json          — serialized engine state after each node completes
├── manifest.json            — pipeline metadata (name, goal, start time, dotfile path)
├── artifacts/
│   └── {artifact_id}.json   — file-backed artifacts produced during execution
└── {node_id}/
    ├── status.json          — Outcome object (status, notes, failureReason)
    ├── prompt.md            — Expanded prompt sent to Claude Code (codergen nodes)
    └── response.md          — LLM or tool output
```

`manifest.json` schema:

```json
{ "name": "pipeline-slug", "goal": "...", "startTime": "ISO-8601", "dotfile": "path/to/file.dot" }
```

### 12.5 Resume Behavior

On `ralph pipeline run <dotfile> --resume`, the engine:
1. Finds the most recent matching run directory
2. Loads the checkpoint, restores context
3. Skips all `completedNodes`
4. Continues from `currentNode`

If the last completed node used a live Claude Code session (`ralph.implement`, `ralph.meditate`), the session cannot be restored — the node re-runs from scratch with the same inputs.

---

## 13. Pipeline Command

### 13.1 CLI Surface

```
ralph pipeline run <dotfile> [--project <folder>] [--resume]
ralph pipeline validate <dotfile>
```

- `run` — parses, validates, applies transforms, executes the pipeline
- `validate` — parses and validates only; exits 0 on success, prints diagnostics on failure
- `--project` — sets `$project` in context and variable substitution
- `--resume` — resumes from the last checkpoint in the most recent matching run directory

### 13.2 Example Pipeline

```dot
digraph coding_pipeline {
  goal="Ship quality code"

  start       [shape=Mdiamond]
  meditate    [type="ralph.meditate"]
  human_gate  [shape=hexagon, label="Accept meditation?"]
  implement   [type="ralph.implement"]
  scenarios   [type="ralph.run-scenarios", goal_gate=true]
  done        [shape=Msquare]

  start      -> meditate
  meditate   -> human_gate
  human_gate -> implement   [label="Yes"]
  human_gate -> meditate    [label="Redo"]
  implement  -> scenarios
  scenarios  -> done        [condition="outcome=success"]
  scenarios  -> implement   [condition="outcome=fail", loop_restart=true]
}
```

---

## 14. runLoop() Refactor

### 14.1 Current Signature

```typescript
export async function runLoop(options: LoopOptions): Promise<void>
```

### 14.2 New Signature

```typescript
export interface LoopOptions {
  promptFile: string;
  cwd: string;
  max?: number;
  model?: string;
  signal?: AbortSignal;                  // NEW — caller owns cancellation
  onSessionId?: (id: string) => void;    // NEW — wires existing hook
}

export interface LoopResult {
  success: boolean;
  iterations: number;
  sessionId?: string;
  exitReason: "completed" | "maxReached" | "aborted" | "error";
  errorMessage?: string;
}

export async function runLoop(options: LoopOptions): Promise<LoopResult>
```

### 14.3 Changes to loop.ts

| Change | Detail |
|---|---|
| Return type | `Promise<void>` → `Promise<LoopResult>` |
| Signal handlers removed | `process.on("SIGINT/SIGTERM")` removed from `runLoop()` — caller registers its own |
| `process.exit(0)` on signal | Replaced by `AbortSignal` check; child killed, function returns `{ exitReason: "aborted" }` |
| `process.exit(1)` on pre-flight | Replaced by `throw new Error(message)` — caller handles |
| `onSessionId` wired | Passed through to `streamEvents()` callback |

**Standalone CLI behavior is preserved.** `implement.ts` wraps `runLoop()` in try/catch and registers its own AbortController signal handler. End users see no behavior change.

---

## 15. Breaking Changes

### BC-1: `runLoop()` return type changes from `void` to `LoopResult`

**Affects:** `implement.ts` (the only consumer).

**Migration:** `implement.ts` ignores the return value today — no functional change. The `process.exit(0)` call after `runLoop()` is removed (it was unreachable anyway).

### BC-2: `runLoop()` pre-flight failures throw instead of calling `process.exit(1)`

**Affects:** `implement.ts`.

**Migration:**

```typescript
// implement.ts — after change
try {
  const result = await runLoop({ promptFile, cwd: absPath, max: options.max });
  if (!result.success) process.exit(1);
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}
```

### BC-3: SIGINT/SIGTERM signal handlers removed from `runLoop()`

**Affects:** Signal handling when `ralph implement` runs standalone.

**Migration:** `implement.ts` registers its own AbortController:

```typescript
const ac = new AbortController();
process.on("SIGINT", () => ac.abort());
process.on("SIGTERM", () => ac.abort());
const result = await runLoop({ ..., signal: ac.signal });
```

End-user behavior is identical.

### BC-4: `run-scenarios` must exit with code 1 when any scenario fails

**Affects:** `run-scenarios.ts` internal logic. Currently always exits 0.

**Migration:** Track aggregate failure count. Exit 1 if any scenario status is `fail`.

This fixes a correctness bug. **Any CI scripts that wrap `ralph run-scenarios` and treat exit 0 as "done" will now receive exit 1 when scenarios fail.** Review usages before upgrading.

### BC-5: `loop.test.ts` — 2 test blocks need updating

**Migration:** Remove `vi.spyOn(process, "exit")` blocks and `.rejects.toThrow("process.exit")` assertions. Replace with assertions on thrown Error messages or returned `LoopResult`.

### BC-6: `meditate-create.test.ts` — 1 assertion needs updating

**Migration:** Replace `expect(exitSpy).toHaveBeenCalledWith(1)` with `expect(...).rejects.toThrow(...)`.

### What Is NOT Changing

- `ralph implement`, `ralph meditate`, `ralph plan`, `ralph run-scenarios`, `ralph new`, `ralph heartbeat` — all work exactly as before
- Daemon and runner — zero changes
- tsup config — no new entries needed
- The `--allowedTools` MCP whitelist in meditate — unchanged

---

## 16. Testing Strategy

### 16.1 Unit Tests (new, in `src/attractor/`)

- `graph.test.ts` — DOT parsing, schema validation, attribute extraction, chained edges, defaults
- `engine.test.ts` — edge selection priority, retry logic, goal gate enforcement, loop_restart
- `conditions.test.ts` — expression parsing and evaluation for all operators
- `stylesheet.test.ts` — stylesheet parsing, selector specificity, node model resolution
- `checkpoint.test.ts` — saveCheckpoint / loadCheckpoint round-trip
- `interviewer.test.ts` — QueueInterviewer, AutoApproveInterviewer behavior

### 16.2 Integration Tests (new, in `src/cli/tests/`)

- `pipeline.test.ts` — full pipeline run with mock handlers, checkpoint save/restore, goal gate fail path

### 16.3 Existing Tests Requiring Updates

- `loop.test.ts` — remove `process.exit` spy blocks (2 blocks); adjust for `LoopResult` return type
- `meditate-create.test.ts` — replace `exitSpy` assertion with error boundary check

### 16.4 Existing Tests Unaffected

All other command tests, daemon tests, smoke tests — zero changes needed.

---

## 17. Definition of Done

This section defines how to validate that this implementation is complete and correct. An implementation is done when every item is checked off.

### 17.1 DOT Parsing

- [ ] Parser accepts the supported DOT subset (digraph with graph/node/edge attribute blocks)
- [ ] Graph-level attributes (`goal`, `label`, `model_stylesheet`) are extracted correctly
- [ ] Node attributes are parsed including multi-line attribute blocks (attributes spanning multiple lines within `[...]`)
- [ ] Edge attributes (`label`, `condition`, `weight`) are parsed correctly
- [ ] Chained edges (`A -> B -> C`) produce individual edges for each pair
- [ ] Node/edge default blocks (`node [...]`, `edge [...]`) apply to subsequent declarations
- [ ] Subgraph blocks are flattened (contents kept, wrapper removed)
- [ ] `class` attribute on nodes merges in attributes from the model stylesheet
- [ ] Quoted and unquoted attribute values both work
- [ ] Comments (`//` and `/* */`) are stripped before parsing

### 17.2 Validation and Linting

- [ ] Exactly one start node (shape=Mdiamond or id matching `start`/`Start`) is required
- [ ] Exactly one exit node (shape=Msquare or id matching `exit`/`end`) is required
- [ ] Start node has no incoming edges
- [ ] Exit node has no outgoing edges
- [ ] All nodes are reachable from start (no orphans)
- [ ] All edges reference valid node IDs
- [ ] Codergen nodes (shape=box) have non-empty `prompt` attribute (warning if missing)
- [ ] Condition expressions on edges parse without errors
- [ ] `validateOrRaise()` throws on error-severity violations
- [ ] Lint results include rule name, severity (error/warning), node/edge ID, and message

### 17.3 Execution Engine

- [ ] Engine resolves the start node and begins execution there
- [ ] Each node's handler is resolved via the type/shape-to-handler mapping (type takes precedence)
- [ ] Handler is called with `(node, context, graph, logsRoot)` and returns an `Outcome`
- [ ] Outcome is written to `{logsRoot}/{node_id}/status.json`
- [ ] Edge selection follows the 5-step priority: condition match → preferred label → suggested IDs → weight → lexical
- [ ] Engine loops: execute node → select edge → advance to next node → repeat
- [ ] Terminal node (shape=Msquare) stops execution
- [ ] Pipeline outcome is "success" if all goal_gate nodes reached `success` or `partial_success`, "fail" otherwise

### 17.4 Goal Gate Enforcement

- [ ] Nodes with `goal_gate=true` are tracked throughout execution
- [ ] Before allowing exit via a terminal node, the engine checks all goal gate nodes have status `success` or `partial_success`
- [ ] If any goal gate node has not succeeded, the engine cascades through retry targets: node `retry_target` → node `fallback_retry_target` → graph `retry_target` → graph `fallback_retry_target`
- [ ] If no target exists at any level and goal gates are unsatisfied, pipeline outcome is "fail"

### 17.5 Retry Logic

- [ ] Nodes with `max_retries > 0` are retried on RETRY or FAIL outcomes
- [ ] Retry count is tracked per-node and respects the configured limit
- [ ] Backoff between retries works (exponential with jitter)
- [ ] After retry exhaustion at a non-terminal node: outcome becomes `fail` and normal edge selection runs; an explicit `outcome=fail` outgoing edge fires if present, otherwise pipeline fails. The `retry_target` attribute is NOT automatically invoked.
- [ ] Goal gate enforcement at terminal `Msquare` nodes: if a `goal_gate=true` node did not succeed, cascade fires: node `retry_target` → node `fallback_retry_target` → graph `retry_target` → graph `fallback_retry_target` → pipeline fail
- [ ] Traversal of an edge with `loop_restart=true` terminates the current run, clears all context and retry counters, creates a fresh run directory, and re-launches from the start node (verified with a new run ID and empty checkpoint state)

### 17.6 Node Handlers

- [ ] **Start handler:** Returns `success` immediately (no-op)
- [ ] **Exit handler:** Returns `success` immediately (no-op; engine checks goal gates)
- [ ] **Codergen handler:** Expands `$goal`/`$project` in prompt, calls `runLoop()`, writes prompt.md + response.md, returns LoopResult as Outcome
- [ ] **Wait.human handler:** Presents outgoing edge labels as choices to the Interviewer, returns Outcome with `preferredLabel` set
- [ ] **Conditional handler:** No-op pass-through for `diamond` nodes; returns `success` immediately; engine evaluates edge conditions
- [ ] **Tool handler:** Executes `tool_command` via shell for `parallelogram` nodes; non-zero exit = fail; stdout written to response.md
- [ ] **Parallel handler:** Fan-out for `component` nodes; spawns branches with isolated context clones; stores results in `context["parallel.results"]`
- [ ] **Fan-in handler:** Aggregates for `tripleoctagon` nodes; consolidates `parallel.results` into aggregate outcome
- [ ] **Manager loop handler:** Observe/steer/wait supervisor for `house` nodes; sets `stack.child.*` context keys
- [ ] **Ralph-native handlers:** `ralph.implement`, `ralph.meditate`, `ralph.run-scenarios` work as specified in Section 5.9

### 17.7 State and Context

- [ ] Context is a key-value store accessible to all handlers
- [ ] Handlers can read context and return `contextUpdates` in the Outcome
- [ ] Context updates are merged after each node execution
- [ ] Checkpoint is saved after each node completion (`currentNode`, `completedNodes`, context, retry counts)
- [ ] Resume from checkpoint: load checkpoint → restore state → continue from `currentNode`
- [ ] Artifacts are written to `{logsRoot}/{node_id}/` (`prompt.md`, `response.md`, `status.json`)

### 17.8 Human-in-the-Loop

- [ ] Interviewer interface works: `ask(question) -> Answer`
- [ ] Question supports types: `YES_NO`, `MULTIPLE_CHOICE`, `FREEFORM`, `CONFIRMATION`
- [ ] `AutoApproveInterviewer` always selects the first option (for automation/testing)
- [ ] `ConsoleInterviewer` prompts in terminal and reads user input from stdin
- [ ] `CallbackInterviewer` delegates to a provided function
- [ ] `QueueInterviewer` reads from a pre-filled answer queue (for unit testing)
- [ ] If process is killed at a hexagon node, checkpoint records the node; `--resume` re-prompts

### 17.9 Condition Expressions

- [ ] `=` (equals) operator works for string comparison
- [ ] `!=` (not equals) operator works
- [ ] `&&` (AND) conjunction works with multiple clauses
- [ ] `outcome` variable resolves to the current node's outcome status string
- [ ] `preferred_label` variable resolves to the outcome's preferred label
- [ ] `context.*` variables resolve to context values (missing keys → empty string)
- [ ] Empty condition always evaluates to true (unconditional edge)

### 17.10 Model Stylesheet

- [ ] Stylesheet is parsed from the graph's `model_stylesheet` attribute
- [ ] Selectors by shape name work (e.g. `box { llm_model: claude-opus-4-6 }`)
- [ ] Selectors by class name work (e.g. `.fast { llm_model: claude-haiku-4-5-20251001 }`)
- [ ] Selectors by node ID work (e.g. `#review { llm_model: claude-opus-4-6 }`)
- [ ] Specificity order: universal < shape < class < ID
- [ ] Stylesheet properties are overridden by explicit node attributes
- [ ] `llm_model` resolves to `--model` flag passed to Claude Code via `runLoop()`
- [ ] `llm_provider` is recognized and parsed but is a no-op in v1 (ralph-cli uses Claude exclusively)
- [ ] `reasoning_effort` is recognized and parsed but is a no-op in v1 (mapping to extended thinking flags is deferred to v2)

### 17.11 Transforms and Extensibility

- [ ] AST transforms can modify the `Graph` between parsing and validation
- [ ] Transform interface: `(graph: Graph) => Graph`
- [ ] Built-in variable expansion transform replaces `$goal` and `$project` in prompts and tool commands
- [ ] Built-in preamble transform synthesizes context carryover text at execution time for non-`full` fidelity modes

### 17.12 runLoop() Refactor

- [ ] `runLoop()` returns `LoopResult` instead of `void`
- [ ] `LoopOptions` accepts `signal?: AbortSignal` and `onSessionId?: (id: string) => void`
- [ ] `SIGINT`/`SIGTERM` handlers removed from `runLoop()` body
- [ ] Pre-flight failures throw `Error` instead of calling `process.exit(1)`
- [ ] `implement.ts` wraps `runLoop()` in try/catch and registers its own AbortController
- [ ] End-user behavior of `ralph implement` is unchanged

### 17.13 Breaking Change Migrations

- [ ] BC-1: `implement.ts` updated (ignores LoopResult — no functional change)
- [ ] BC-2: `implement.ts` has try/catch around `runLoop()`
- [ ] BC-3: `implement.ts` registers own AbortController for SIGINT/SIGTERM
- [ ] BC-4: `run-scenarios.ts` exits 1 when any scenario fails
- [ ] BC-5: `loop.test.ts` — 2 process.exit spy blocks removed
- [ ] BC-6: `meditate-create.test.ts` — exitSpy assertion replaced
