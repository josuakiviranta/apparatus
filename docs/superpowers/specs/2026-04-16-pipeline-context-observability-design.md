# Pipeline Context Observability Design

**Date:** 2026-04-16
**Status:** Approved

## Problem

When a pipeline runs, downstream nodes receive context from upstream nodes via the preamble injected into their prompt. This context is invisible in the TUI — you can see `◈ ctx: N tokens` growing inside a node's stream, but you cannot tell what context that node received before it started, which upstream node produced it, or how large it is.

## Goal

Make the context each node receives from upstream visible and inspectable — in the TUI (a pointer per node) and via CLI (a command to read the full snapshot).

## Design

### Architecture

Five components, each with one responsibility:

```
src/attractor/tracer/
  pipeline-tracer.ts          # PipelineTracer interface
  jsonl-pipeline-tracer.ts    # JsonlPipelineTracer implements PipelineTracer

src/attractor/core/engine.ts  # adds traceWriter?: PipelineTracer to EngineOptions
                              # generates nodeReceiveId per node invocation
                              # calls tracer at boundaries, passes nodeReceiveId to onNodeStart

src/cli/lib/pipelineEvents.ts # start event gains nodeReceiveId: string + hasContext: boolean
src/cli/components/PipelineApp.tsx  # renders "received context:" line as new StaticItem kind

src/cli/commands/pipeline.ts  # creates JsonlPipelineTracer, passes to engine
                              # adds "trace" subcommand
                              # shows run trace path in pipeline header
```

Data flow:

```
engine generates nodeReceiveId
  → calls traceWriter.onNodeStart({ nodeReceiveId, node, ctx })
      → JsonlPipelineTracer appends node-start event to pipeline.jsonl
  → calls opts.onNodeStart(node, { nodeReceiveId, hasContext })
      → pipeline.ts emits NodeEvent { kind:"start", nodeReceiveId, hasContext }
          → PipelineApp appends block-open + received-context StaticItems
```

Future OTel migration: replace `JsonlPipelineTracer` with `OtelPipelineTracer implements PipelineTracer`. Engine and TUI unchanged.

---

### Section 1: PipelineTracer interface

```typescript
// src/attractor/tracer/pipeline-tracer.ts
export interface PipelineTracer {
  onPipelineStart(meta: { runId: string; graph: Graph; ctx: PipelineContext }): void
  onNodeStart(meta: { nodeReceiveId: string; node: Node; ctx: PipelineContext }): void
  onNodeEnd(meta: { nodeReceiveId: string; node: Node; outcome: Outcome }): void
  onPipelineEnd(meta: { runId: string; outcome: "success" | "failure" }): void
}
```

### Section 2: JsonlPipelineTracer

```typescript
// src/attractor/tracer/jsonl-pipeline-tracer.ts
export class JsonlPipelineTracer implements PipelineTracer {
  constructor(private tracePath: string) {}

  onPipelineStart({ runId, graph, ctx }) {
    this.append({ kind: "pipeline-start", runId, goal: graph.goal,
                  nodes: graph.nodes.map(n => n.id), timestamp: now() })
  }
  onNodeStart({ nodeReceiveId, node, ctx }) {
    this.append({ kind: "node-start", nodeReceiveId, nodeId: node.id,
                  nodeKind: node.type, timestamp: now(), contextSnapshot: ctx.values })
  }
  onNodeEnd({ nodeReceiveId, node, outcome }) {
    this.append({ kind: "node-end", nodeReceiveId, nodeId: node.id,
                  success: outcome.success, contextUpdates: outcome.contextUpdates ?? {} })
  }
  onPipelineEnd({ runId, outcome }) {
    this.append({ kind: "pipeline-end", runId, outcome, timestamp: now() })
  }

  private append(event: object) {
    appendFileSync(this.tracePath, JSON.stringify(event) + "\n")
  }
}
```

Run storage: `~/.ralph/runs/<runId>/pipeline.jsonl`
`runId` = `ctx.values.run_id` (already set by engine at init).
Directory created by constructor via `mkdirSync(..., { recursive: true })`.

Resulting JSONL for a 4-node run:

```jsonl
{"kind":"pipeline-start","runId":"abc123","goal":"...","nodes":["run","push","review","summarize"],"timestamp":"..."}
{"kind":"node-start","nodeReceiveId":"run-1a3d","nodeId":"run","nodeKind":"codergen","timestamp":"...","contextSnapshot":{}}
{"kind":"node-end","nodeReceiveId":"run-1a3d","nodeId":"run","success":true,"contextUpdates":{"run.output":"...","run.success":"true","run.sessionId":"610c7dff"}}
{"kind":"node-start","nodeReceiveId":"push-2b7e","nodeId":"push","nodeKind":"tool","timestamp":"...","contextSnapshot":{"run.output":"...","run.success":"true","run.sessionId":"610c7dff"}}
{"kind":"node-end","nodeReceiveId":"push-2b7e","nodeId":"push","success":true,"contextUpdates":{}}
{"kind":"node-start","nodeReceiveId":"review-3c1f","nodeId":"review","nodeKind":"interactive-agent","timestamp":"...","contextSnapshot":{"run.output":"...","run.success":"true","run.sessionId":"610c7dff"}}
{"kind":"node-end","nodeReceiveId":"review-3c1f","nodeId":"review","success":true,"contextUpdates":{}}
{"kind":"node-start","nodeReceiveId":"summarize-4f8c","nodeId":"summarize","nodeKind":"codergen","timestamp":"...","contextSnapshot":{"run.output":"...","run.success":"true","run.sessionId":"610c7dff"}}
{"kind":"node-end","nodeReceiveId":"summarize-4f8c","nodeId":"summarize","success":true,"contextUpdates":{"summarize.output":"..."}}
{"kind":"pipeline-end","runId":"abc123","outcome":"success","timestamp":"..."}
```

---

### Section 3: Engine changes

`EngineOptions` gains one optional field; `onNodeStart` gains a `meta` second argument:

```typescript
export interface EngineOptions {
  // existing fields unchanged...
  traceWriter?: PipelineTracer
  onNodeStart?: (node: Node, meta: { nodeReceiveId: string }) => void
  onNodeEnd?: (node: Node, outcome: Outcome) => void
}
```

`onNodeStart` second arg is additive — existing one-arg callers are unaffected in JS.

In the main loop, before handler dispatch:

```typescript
const nodeReceiveId = `${node.id}-${randomBytes(2).toString("hex")}`

opts.traceWriter?.onNodeStart({ nodeReceiveId, node, ctx })
opts.onNodeStart?.(node, { nodeReceiveId })

const outcome = await handler.execute(node, ctx, meta)

opts.traceWriter?.onNodeEnd({ nodeReceiveId, node, outcome })
opts.onNodeEnd?.(node, outcome)
```

At pipeline boundaries:

```typescript
// before loop
opts.traceWriter?.onPipelineStart({ runId: ctx.values.run_id as string, graph, ctx })
// after loop
opts.traceWriter?.onPipelineEnd({ runId: ctx.values.run_id as string, outcome })
```

`traceWriter` is optional — omitting it is zero cost (optional chaining).

---

### Section 4: TUI changes

`pipelineEvents.ts` — `start` event gains two fields:

```typescript
| { kind: "start"; nodeId: string; label: string; blockKind: BlockKind;
    nodeReceiveId: string; hasContext: boolean }
```

`hasContext` = `Object.keys(ctx.values).length > 0`, known before handler runs.

`StaticItem` union gains a new kind:

```typescript
| { kind: "received-context"; id: string; nodeReceiveId: string; runId: string; hasContext: boolean }
```

`PipelineApp.tsx` — on `start` event, appends two items in sequence:

```typescript
setStaticItems(prev => [
  ...prev,
  { kind: "block-open", id, displayIndex, nodeId: event.nodeId, label: event.label },
  { kind: "received-context", id: `${id}-ctx`, nodeReceiveId: event.nodeReceiveId,
    runId, hasContext: event.hasContext },
])
```

Rendered immediately after block-open (same pattern as `trace-line`):

```typescript
if (item.kind === "received-context") {
  const cmd = `ralph pipeline trace ${item.runId} --node-receive ${item.nodeReceiveId}`
  const suffix = item.hasContext ? "" : "  (empty)"
  return (
    <Text key={item.id} dimColor>
      {"  received context: "}
      <Text dimColor={false}>{cmd}</Text>
      {suffix}
    </Text>
  )
}
```

`PipelineApp` props gain `runId: string` (passed from `pipeline.ts` where the tracer is constructed).

Pipeline header gains the run trace path:

```
 poc_implement  ·  PID 8671  ·  goal: ...
 nodes: run → push → review → summarize
 run:   ~/.ralph/runs/abc123/pipeline.jsonl
```

---

### Section 5: CLI command

`ralph pipeline trace <runId> --node-receive <nodeReceiveId>`

Reads `~/.ralph/runs/<runId>/pipeline.jsonl`, finds the `node-start` line matching `nodeReceiveId`, pretty-prints:

```
$ ralph pipeline trace abc123 --node-receive summarize-4f8c

node:     summarize
seq:      4
kind:     codergen
received: 2026-04-16T10:23:41Z

context snapshot (4 keys):
  run.output       "Audited 3 specs via parallel Explore subagents..."
  run.success      "true"
  run.sessionId    "610c7dff-8f6a-4086-9781-8c4c06e2640e"
  agent.iterations "1"

completed stages: start · run · push · review
```

`ralph pipeline trace <runId>` (no `--node-receive`) lists all node invocations:

```
$ ralph pipeline trace abc123

run:     abc123
outcome: success
nodes:
  run-1a3d       run        codergen           ✓  187.4s  ctx: {}
  push-2b7e      push       tool               ✓    0.0s  ctx: {run.output, run.success, run.sessionId}
  review-3c1f    review     interactive-agent  ✓  155.6s  ctx: {run.output, run.success, run.sessionId}
  summarize-4f8c summarize  codergen           ✓   19.8s  ctx: {run.output, run.success, run.sessionId, agent.iterations}
```

---

## TUI Output (final shape)

```
 poc_implement  ·  PID 8671  ·  goal: POC: implement loop as a pipeline
 nodes: run → push → review → summarize
 run:   ~/.ralph/runs/abc123/pipeline.jsonl

━━ [1] run · agent ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  received context: ralph pipeline trace abc123 --node-receive run-1a3d  (empty)
  trace:            /Users/josu/.claude/projects/.../610c7dff.jsonl
▶▶▶ MAIN AGENT
...
◈ ctx: 76,213 tokens
◀◀◀ MAIN AGENT
  ✓ success · 1 turns · 508/8171 tok · 187.4s

━━ [2] push · tool ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  received context: ralph pipeline trace abc123 --node-receive push-2b7e
  ✓ success · 0 turns · 0/0 tok · 0.0s

━━ [3] review · interactive-agent ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  received context: ralph pipeline trace abc123 --node-receive review-3c1f
  trace:            /Users/josu/.claude/projects/.../0501cabb.jsonl
  ✓ success · 0 turns · 0/0 tok · 155.6s

━━ [4] summarize · agent ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  received context: ralph pipeline trace abc123 --node-receive summarize-4f8c
  trace:            /Users/josu/.claude/projects/.../9d1c3cc2.jsonl
▶▶▶ MAIN AGENT
...
◈ ctx: 9,855 tokens
◀◀◀ MAIN AGENT
  ✓ success · 1 turns · 9/519 tok · 19.8s
```

## Future: OpenTelemetry

`PipelineTracer` interface maps directly to OTel spans:
- Pipeline run = root trace
- Each node invocation = span (`nodeReceiveId` = span ID)
- `contextSnapshot` = span input attributes
- `contextUpdates` = span output attributes
- `onNodeStart` / `onNodeEnd` = `span.start()` / `span.end()`

Migration path: implement `OtelPipelineTracer implements PipelineTracer`, swap in `pipeline.ts`. Zero changes to engine or TUI.
