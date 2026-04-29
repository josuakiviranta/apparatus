# Pipeline Subsystem

Umbrella specification for the `attractor` pipeline engine — the graph-driven workflow runtime that backs every `ralph pipeline *` command and every first-class command that has been rewritten as a pipeline shim (e.g. `ralph implement`).

Source of truth for implementation: `src/attractor/`. This spec documents behaviour, contracts, and invariants; individual module internals may evolve.

## Scope

A pipeline is a directed graph of typed nodes, authored as a Graphviz `.dot` file and executed by `runPipeline()` in `src/attractor/core/engine.ts`. The engine walks the graph from a single `start` node to a single `exit` node, dispatching each node to a type-specific handler, carrying a mutable `context` object between nodes, and emitting structured events to a JSONL tracer.

Pipelines are the preferred extension surface for new ralph behaviours. `ralph implement` itself is implemented as a pipeline; custom workflows live in `pipelines/*.dot` within a project.

## Commands

All pipeline commands register in `src/cli/commands/pipeline.ts`. See `specs/commands.md` for flag surface.

| Command | Purpose |
|---------|---------|
| `pipeline run <dot-file>` | Execute a pipeline to completion (or until `--max` or failure) |
| `pipeline validate <dot-file>` | Parse, schema-check, and heuristic-check a pipeline without running it |
| `pipeline create <project>` | Interactive Claude authoring session for a new `.dot` |
| `pipeline refine <name>` | Interactive refinement session for an existing `.dot` with prior-run digests |
| `pipeline list <project>` | Enumerate discoverable pipelines |
| `pipeline trace <runId>` | Inspect a completed run's JSONL trace (`--node-receive`, `--full`) |

## Pipeline File Format

Pipelines are written in standard Graphviz DOT. The parser is a thin wrapper over `@ts-graphviz/ast`; it lives in `src/attractor/core/graph.ts` and preserves source-location metadata on every node.

### Required nodes

Every pipeline must contain exactly one `start` node and exactly one `exit` node:

- `start` node — `shape="Mdiamond"`, `type="start"`
- `exit` node — `shape="Msquare"`, `type="exit"`

Missing, duplicate, or unreachable `start`/`exit` nodes are validation errors.

### Node attributes

Each node carries a `type=` attribute that selects a handler and a set of handler-specific attributes. Attributes are schema-validated per type (zod schemas in `src/attractor/core/schemas.ts`). Common attributes include:

| Attribute | Applies to | Meaning |
|-----------|------------|---------|
| `type` | all | Handler selector (see Node Types below) |
| `shape` | all | Visual + structural contract (validated per type) |
| `label` | all | Human-readable display name |
| `prompt` | agent nodes | Optional per-call steering text (pure prose; no `$var` substitution — inputs are injected via the auto-rendered Inputs block from agent frontmatter) |
| `tool_command` | tool nodes | Shell command to execute |
| `script_file` | tool nodes | Path to external script under `pipelines/scripts/` |
| `script_args` | tool nodes | Arguments appended to `script_file` invocation |
| `produces_from_stdout` | tool nodes | Context key to populate from stdout |
| `cwd` | tool nodes | Required working directory (`$project`, `$run_id` expanded) |
| `agent` | agent nodes | Agent name — resolved via project-local, user, then bundled registry |
| `headless_safe` | interactive nodes | Whether the node may run without a TTY |
| `default_<varname>` | any node | Seeds a variable if caller did not supply one (see Variable Expansion) |
| `retry_target`, `fallback_retry_target` | any node | Node IDs for retry routing on failure |
| `goal_gate` | before exit | Blocks exit until evaluator approves |

### Edge attributes

Edges carry `label`, optional `condition` (boolean expression over context), `weight` (deterministic tie-breaking), and source location. Conditions are evaluated by `src/attractor/core/conditions.ts`.

## Execution Model

`runPipeline(graph, opts)` in `src/attractor/core/engine.ts` is the runtime entry point.

### Loop

1. Initialise `context` with `graph.goal`, `$project`, `$run_id`, caller variables from `--var`, and any node-level `default_<varname>` seeds.
2. Start at the unique `start` node.
3. For each node: resolve handler via `buildHandlerMap()`, call `handler.execute(node, context, meta)`, receive an `Outcome` with status `success | retry | fail | partial_success`.
4. On `success`: select the next edge via condition evaluation; advance.
5. On `fail`: select a fail edge via `selectFailEdge()`; otherwise route to `retry_target` or `fallback_retry_target`; otherwise abort the run.
6. On `retry`: increment `nodeRetries[nodeId]`, re-execute up to the per-node retry cap.
7. On `partial_success`: recorded for fan-in aggregation (see Parallel / Fan-In).
8. Before transitioning into the `exit` node, enforce any `goal_gate` on the incoming edge.
9. Checkpoint after every state change (see Checkpoint and Resume).
10. Emit `pipeline-end` trace event with the final outcome.

### Run identity

Each run receives an 8-character UUID-derived `runId`. All per-run state lives under `~/.ralph/<projectKey>/runs/<runId>/`, which contains both `pipeline.jsonl` (tracer output) and `checkpoint.json` (engine state, written every transition). The directory name is the 8-hex `runId` minted at invocation time; the parent `<projectKey>` is `<basename>-<6 hex chars of sha256(absolute project path)>`. Cross-project collision is impossible because the project path participates in the key.

## Graph Validation

`validateGraph(graph, dotDir?)` in `src/attractor/core/graph.ts` returns a `Diagnostic[]`. `ralph pipeline validate` reports these; `ralph pipeline run` refuses to execute on any error-level diagnostic.

Checks performed:

| Rule | What it catches |
|------|-----------------|
| Structural | Exactly one `start`, exactly one `exit`; all nodes reachable from `start`; `exit` reachable from every node |
| Schema | Per-type zod schema over attributes (required keys, allowed values, shape match) |
| `cwd` required | Every `type="tool"` node must declare `cwd=` explicitly |
| `$project` preflight | If any attribute references `$project`, the run must be invoked with `--project <folder>` |
| Variable coverage | `scanUndeclaredCallerVars()` flags any `$name` or `${name}` used in the graph that is neither seeded by `default_<varname>` nor supplied by `--var` |
| `portability_heuristic` | Warns on hard-coded absolute paths and other patterns that would break when the pipeline runs elsewhere |
| `default_<varname>` on tool nodes | Validator permits the seed attribute on node types that actually read it |
| Producer declaration (gates) | Gate nodes must declare the upstream producer whose output they consume |

Each diagnostic carries a `SourceLocation` (line, column, optional span) so the CLI can render a code frame (see Source-Location Diagnostics).

## Node Types (Handlers)

All handlers live in `src/attractor/handlers/`. `runPipeline` dispatches via the `type` attribute.

| Type | Shape | Handler file | Purpose |
|------|-------|--------------|---------|
| `start` | Mdiamond | `start-exit.ts` | Entry node; seeds context |
| `exit` | Msquare | `start-exit.ts` | Terminal node; enforces `goal_gate` |
| `agent` / `codergen` / `ralph.implement` | component / box | `agent-handler.ts` | Spawns a Claude session via the `Agent` class; streams events |
| `tool` | parallelogram | `tool.ts` | Runs a shell command or `script_file`, captures stdout into context |
| `conditional` | diamond | `conditional.ts` | Branch selector based on edge `condition` expressions |
| `wait.human` | hexagon | `wait-human.ts` | Blocks for user input via the Interviewer |
| `parallel` | component | `parallel.ts` (`ParallelHandler`) | Fans out to multiple branches; writes per-branch outcomes to `parallel.results` |
| `parallel.fan_in` | tripleoctagon | `parallel.ts` (`FanInHandler`) | Reads `parallel.results`; rolls up to `success` / `partial_success` / `fail` |
| `store` | cylinder | `store.ts` | Writes context values to persistent storage |
| `ralph.meditate` | octagon | `ralph-meditate.ts` | Invokes the meditate command as a pipeline step |
| `stack.manager_loop` | house | `manager-loop.ts` | **Not yet implemented** — reserved for hierarchical sub-pipeline composition |

Adding a new node type requires: a handler module, registration in `buildHandlerMap()` in the engine, a zod schema in `core/schemas.ts`, and the corresponding row in this table.

### Agent Schema Descriptions

Agent nodes that declare `json_schema_file` have the full stringified schema (all `description` fields verbatim) injected above the agent instructions in the assembled prompt by `src/attractor/handlers/agent-handler.ts`. A schema `description` is therefore a prompt input, not just developer documentation — and it arrives with stronger framing (`IMPORTANT:` banner) than the agent instructions. Schema descriptions MUST NOT encode output shape (section names, bullet conventions, sentence/word/bullet counts, heading patterns, tier structure). Output shape lives in the agent instructions at `src/cli/agents/<agent-name>.md`. Descriptions state *what* the field is and MAY carry content rules that the instructions cannot enforce (shell-safety, append-vs-replace semantics, emit-when conditions). The lint test `src/cli/tests/pipeline-schema-descriptions.test.ts` enforces this — it fails loudly on banned shape vocabulary and on descriptions over 160 characters.

## Variable Expansion

`src/attractor/transforms/variable-expansion.ts` expands `$name` and `${name}` references in tool-node commands, script args, `cwd`, and edge conditions. Agent-node `prompt=` (steering) is **not** variable-expanded — agent inputs are injected automatically via the Inputs block rendered from agent frontmatter `inputs:` declarations.

### Syntax

- `$name` — simple reference (regex `/\$([a-zA-Z_]\w*(?:\.\w+)*)/g`)
- `${name}` — brace form
- `$name.field` — dotted path into structured context values
- Built-ins: `$project`, `$run_id`, `$goal`, `$chat.output`, `<nodeId>.choice`

### Fenced code block skip

Variable expansion respects triple-backtick code fences. Content inside a fenced block (```…```) is emitted verbatim — no `$` inside a fenced block is expanded. This is enforced by `splitFences()`, which segments the input into alternating fenced / unfenced ranges and only expands the unfenced ones. The same rule applies to both the runtime expander and the validator's undeclared-variable scan.

### Seeding with `default_<varname>`

A node may declare `default_<varname>="value"` to seed a variable when the caller did not supply one via `--var`. `extractDefaults()` converts the camelCase attribute (`defaultMaxIterations`) back to the snake-case variable key (`max_iterations`) before seeding. Runtime values from `--var` always win over defaults.

Validation rejects `default_<varname>` on node types that do not consume variables, to prevent silent no-ops.

### Gate choice namespacing

When a gate node resolves, its chosen label is exposed to downstream nodes under two keys: `<nodeId>.choice` (the canonical namespaced form) and a bare alias that matches the gate's own name. Downstream nodes should prefer the namespaced form to avoid collisions when multiple gates appear in one pipeline.

## Interviewer (Input Backend)

`src/attractor/interviewer/` provides the abstraction for human-in-the-loop nodes (`wait.human`, gates, overlay prompts).

```
Interviewer.ask(question: Question): Promise<Answer>
```

`Question` has a `kind` (`YES_NO | MULTIPLE_CHOICE | FREEFORM | CONFIRMATION`), a prompt string, and optional choices.

### Backends

| Backend | File | Selection |
|---------|------|-----------|
| `InkInterviewer` | `ink.ts` | Used when `process.stdin.isTTY` is true; emits `gate-ready` events for the Ink TUI overlay |
| `AutoApproveInterviewer` | `auto-approve.ts` | Used when stdin is not a TTY; picks the first/default choice |
| `ConsoleInterviewer` | `console.ts` | Plain readline-based fallback |
| `CallbackInterviewer` | `callback.ts` | Injectable for tests and programmatic drivers |
| `QueueInterviewer` | `queue.ts` | Pre-seeded answer queue for scripted runs |

Nodes that declare `headless_safe="false"` raise an error when dispatched against a non-TTY session; they cannot be auto-approved.

## Checkpoint and Resume

Covered in `specs/architecture.md` under "Checkpoint and Resume". In short:

- `src/attractor/checkpoint.ts` persists a `CheckpointState = { timestamp, currentNode, completedNodes, nodeRetries, context }` to `<logsRoot>/checkpoint.json`, where `<logsRoot>` defaults to `~/.ralph/<projectKey>/runs/<runId>/`. Tests can override the parent root via the `RALPH_RUNS_ROOT` env var.
- The engine writes the checkpoint at every state transition.
- `pipeline run --resume` loads the checkpoint and restarts from `currentNode`, preserving `completedNodes`, `nodeRetries`, and `context`.
- A fresh run gets a fresh `<runId>` directory and never overwrites a prior run. The engine garbage-collects older runs lazily at run-start, keeping the 50 newest per project (override with `RALPH_RUNS_KEEP=N`). Tool scripts called from tool nodes should still be idempotent because `--resume` may re-execute the node that failed within a single run.

## Tracer / Observability

`src/attractor/tracer/jsonl-pipeline-tracer.ts` writes one JSON object per line to `~/.ralph/<projectKey>/runs/<runId>/pipeline.jsonl`. It implements the `PipelineTracer` interface declared in `pipeline-tracer.ts`.

### Event types

| Event | Fields |
|-------|--------|
| `pipeline-start` | `runId`, `pipelineName`, `goal`, `nodes`, `timestamp` |
| `node-start` | `nodeReceiveId` (unique per execution), `nodeId`, `nodeKind`, `contextSnapshot`, `timestamp` |
| `node-end` | `nodeReceiveId`, `nodeId`, `success`, `contextUpdates`, `failureReason?` |
| `pipeline-end` | `runId`, `outcome`, `timestamp` |

`nodeReceiveId` is distinct from `nodeId` because a single node may execute more than once (retries, loops). The trace is append-only within a run and is created fresh when the run directory is initialised; the checkpoint file shares the same directory and is updated in place every transition.

### `pipeline trace` command

Reads the JSONL trace and prints a human-readable summary. `--node-receive <id>` filters to a single execution; `--full` dumps the raw JSONL.

## Source-Location Diagnostics

`src/cli/lib/code-frame.ts` renders a file:line:column header followed by a context excerpt (default ±2 lines) with a caret span underlining the offending column range.

Diagnostics are formatted by `formatDiag()` in `src/cli/commands/pipeline.ts` as:

```
<relPath>:<line>:<column> [rule-id] <message>
<optional hint>
<code frame with caret>
```

This format applies to both validator output and runtime errors whose cause can be traced back to a specific DOT source range. The underlying `SourceLocation` record is attached by the DOT parser to every `Node` and `Edge`, so most errors preserve precise location even through multiple graph transforms.

## External Scripts

Tool nodes can externalise logic to `pipelines/scripts/<name>.<ext>`:

```dot
mark_dispatched [type="tool",
                 cwd="$project",
                 script_file="pipelines/scripts/mark-dispatched.mjs",
                 script_args="--id $illumination_id",
                 produces_from_stdout="dispatch_result"]
```

`script_file` paths are resolved relative to the `.dot` file's directory. The script inherits the process environment, receives `script_args` (variable-expanded) on the command line, and runs in `cwd`. If `produces_from_stdout="key"` is declared, the script's stdout is assigned to `context[key]` after trimming. See `pipelines/scripts/mark-dispatched.mjs` for the canonical example.

## Portability Heuristic

The validator runs a `portability_heuristic` pass that warns on authoring patterns known to break when a pipeline is run outside the machine on which it was written. Typical hits:

- Hard-coded absolute paths (`/Users/...`, `/home/...`) in `tool_command`, `script_args`, or `prompt`
- Shell-inline path assumptions that should use `$project`
- Missing `cwd=` on a `type="tool"` node (also a structural error)

Warnings do not block execution but do surface prominently in `pipeline validate` output to steer authors toward portable constructs.

## Tmux Harness

There is no direct tmux integration in `src/attractor/`. Tmux-based debugging of the Ink TUI is driven out-of-band from tests and tooling documented in `docs/harness/tmux-drive.md`. Pipeline scripts that themselves invoke tmux (e.g. `tmux new-window -n test-$run_id`) rely on the same variable expander as everything else; no additional glue exists in the engine.

## Error Handling Summary

| Failure | Engine behaviour |
|---------|------------------|
| Node throws | Outcome = `fail`; fail edge selected, else retry target, else abort |
| Retry exhausted | Outcome escalates to `fail` |
| Goal gate denies | Exit blocked; fail edge or retry target taken |
| Interviewer unavailable for `headless_safe="false"` | Immediate abort with diagnostic |
| Validation error at `pipeline run` | Print diagnostics; refuse to execute |
| Checkpoint write error | Logged; run continues (next checkpoint attempt supersedes) |
| Ctrl-C | Current node allowed to finish its in-flight operation where possible; next run resumable with `--resume` |

## Extension Points

- **New node type:** add handler, register in engine, add zod schema, document in Node Types table.
- **New interviewer backend:** implement `Interviewer` interface in `interviewer/`, wire selection logic in `interviewer/index.ts`.
- **New attribute:** add to the relevant zod schema; if variable-expanded, add to the expander's attribute allowlist; if validator-relevant, teach `validateGraph` the rule.
- **New pipeline command:** register in `src/cli/commands/pipeline.ts`; document in `specs/commands.md`.
