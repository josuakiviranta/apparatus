# Design: AgentHandler — Split Two Paths, Hide The Disjunction

**Date:** 2026-05-05
**Status:** draft (pending review)
**Originating illumination:** `.ralph/meditations/illuminations/2026-05-05T0913-agent-handler-two-paths-one-execute.md`

## 1. Motivation

`src/attractor/handlers/agent-handler.ts` is registered as one `AgentHandler` class but its `execute()` method is two structurally disjoint handlers welded into a single ~290-line body. The class declaration sits at `src/attractor/handlers/agent-handler.ts:42`:

```ts
export class AgentHandler implements NodeHandler {
```

Inside `execute()` the prompt-assembly prep runs first (lines 51-123), then a runtime guard fires at line 127 and a comment at line 187 names the second half "legacy":

```ts
// agent-handler.ts:127-132
if (jsonSchema) {
  return {
    status: "fail",
    failureReason: "interactive=true cannot be combined with outputs: structured output is incompatible with live chat streaming",
  };
}
// agent-handler.ts:138-186  → interactive branch (runInteractive, callback, digest)
// agent-handler.ts:187
// --- end interactive branch; legacy path below is unchanged ---
// agent-handler.ts:229-323 → iteration loop, evaluateAgentOutput, prev_note, done===true break
```

Three converging signals make this a shallow module pretending to be deep:

1. **In-source admission.** The `legacy path below is unchanged` comment at line 187 is the kind of ghost-of-refactor-past marker meta-meditation `when-code-is-slop.md` calls out — a self-aware split waiting to be made.

2. **Test-file fragmentation already mirrors the split.** `src/attractor/tests/` carries seven files for one class — `agent-handler.test.ts`, `agent-handler-interactive.test.ts`, `agent-handler-deep-loop.test.ts`, `agent-handler-frontmatter-jsonschema.test.ts`, `agent-handler-inputs.test.ts`, `agent-handler-json-constraint.test.ts`, `agent-handler-retry.test.ts`. Seven test files for one class is the test layer telling us the abstraction has at least two inhabitants.

3. **Mode-confusion guards instead of types.** "interactive=true + outputs:" is rejected at runtime (line 127). "interactive=true + loop:true" is silently no-oped — the early-return at line 186 fires before the iteration body at line 229 ever runs. These are validator-level constraints; only the runtime is enforcing them today, and only partially. The source-location infrastructure shipped in v0.1.31 (`{ rule, severity, message, location }` diagnostic shape, see `src/attractor/core/graph.ts:187-190` and parallels) makes elevating these to authoring-time errors a one-rule lift each.

The same shallow-module rot also sits in `src/attractor/interviewer/`. Five classes implement the 3-method `Interviewer` interface but production code in `src/cli/lib/pipeline.ts:374-375` only ever instantiates `InkInterviewer` (TTY) or `AutoApproveInterviewer` (headless). `ConsoleInterviewer` is referenced by **no** non-defining file in the repo. `CallbackInterviewer` appears only in `src/attractor/tests/interviewer.test.ts` testing itself — a tautology, not a usage. This is structurally identical to the already-illuminated `ParallelHandler` / `ManagerLoopHandler` dead-code findings (illuminations `2026-05-01T0423`, `2026-05-01T0828`) — the pattern repeats whenever a registry pretends to be open-ended but only two adapters are alive.

The chosen structure under the deep-modules lens is: **two named handlers** (`InteractiveAgentHandler`, `LoopingAgentHandler`) over a **shared free function** (`assembleAgentPrompt`) for the prep work, with the runtime mode-confusion guards promoted to graph validator rules and the dead interviewer adapters deleted. No `BaseAgentHandler<TConfig>` generics — two classes is the right number today.

This is plumbing-under-the-floor: the user-visible surface — CLI, MCP, agents, pipelines, `.dot` syntax, frontmatter shapes, public exports — does not change.

## 2. Decision Summary

1. **Extract `assembleAgentPrompt(node, config, ctx, meta)` into `src/attractor/handlers/agent-prep.ts`.** Owns the shared prep currently spanning `agent-handler.ts:51-123`: agent name resolution + `loadAgent` failure handling, `node.llmModel` override, dev-mode `tsx` MCP swap, `buildSystemInjectedVars` + `agentVariables` merge, `extractDefaults` re-prefix, `renderInputsBlock`, steering composition, `buildPreamble` + JSON-schema wrap, `prompt.md` write, and `Agent` instantiation. Returns:

    ```ts
    interface PreparedAgent {
      agent: Agent;
      config: AgentConfig;
      jsonSchema: string | undefined;
      agentVariables: Record<string, unknown>;
      prompt: string;     // final preamble + assembled prompt
      nodeDir: string;    // mkdir'd logsRoot/<node.id>
    }
    ```

    Both new handlers consume this. The current method body shrinks by ~60 lines before any actual split.

2. **Create `src/attractor/handlers/interactive-agent-handler.ts`.** Owns lines 134-186 of the current method: `randomUUID` session, `Session` instantiation, `agent.runInteractive`, `onInteractiveRequest` callback (line 154), child kill timeout (lines 157-164), `buildSessionDigest` (line 167), `${prefix}.output` flatten (lines 169-177), `digest.json` write, success/fail outcome. The runtime `if (jsonSchema)` guard at line 127 is **deleted** — the new validator rule (item 4) catches it at parse time. The `if (!onInteractiveRequest)` guard at line 145 is **kept** — that is an engine-options invariant, not a graph-author error.

3. **Create `src/attractor/handlers/looping-agent-handler.ts`.** Owns lines 189-342 of the current method: `maxIterations` resolution from `node.maxIterations` / `config.maxIterations` / `config.loop` (lines 189-203), `outputsToZod` (line 211), retry-budget resolution (lines 213-217), the iteration loop body including `evaluateAgentOutput` at line 260, `prev_note` plumbing at lines 312-314, `done === true` break at lines 318-319, `preferred_label` capture at line 309, structured-update flatten at lines 325-331, success outcome at lines 333-342.

4. **Promote runtime guards to graph validator rules in `src/attractor/core/graph.ts`.** Two new rules added alongside the existing `reaches_exit` / `variable_coverage` / `script_command_conflict` siblings (rule shape `{ rule, severity, message, location }`, see `graph.ts:187-190`):

    ```ts
    // emitted when a node has interactive=true AND its agent's frontmatter declares outputs:
    {
      rule: "interactive_with_outputs_forbidden",
      severity: "error",
      message: `Node "${id}" sets interactive=true but agent "${agentName}" declares outputs:; structured output is incompatible with live chat streaming`,
      location: node.sourceLocation,
    }

    // emitted when a node has interactive=true AND (node.loop=true or node.maxIterations>1 or agent.loop=true)
    {
      rule: "interactive_with_loop_forbidden",
      severity: "error",
      message: `Node "${id}" sets interactive=true with looping (loop=true / maxIterations>1); interactive sessions cannot iterate`,
      location: node.sourceLocation,
    }
    ```

    Both rules need agent-frontmatter access — the validator already loads agents to read their `outputs:` for the existing `bare_input_not_in_caller_inputs_or_system` rule, so the agent loader is in scope. The corresponding runtime fail in `interactive-agent-handler.ts` (the would-be port of `agent-handler.ts:127-132`) is removed; the would-be silent-no-op of mixing interactive+loop is also caught at validate time.

5. **Update the registry to dispatch on `node.interactive`.** In `src/attractor/core/engine.ts:47-63`, the current `buildHandlerMap`:

    ```ts
    const agentHandler = new AgentHandler();
    m.set("codergen", agentHandler);     // line 52
    m.set("ralph.implement", agentHandler); // line 56
    m.set("agent", agentHandler);        // line 61
    ```

    becomes a single `AgentHandlerDispatch` shim that holds both concrete handlers and routes per-call:

    ```ts
    class AgentHandlerDispatch implements NodeHandler {
      constructor(
        private interactive: InteractiveAgentHandler,
        private looping: LoopingAgentHandler,
      ) {}
      async execute(node, ctx, meta) {
        const isInteractive = node.interactive === true || node.interactive === "true";
        return isInteractive
          ? this.interactive.execute(node, ctx, meta)
          : this.looping.execute(node, ctx, meta);
      }
    }
    ```

    The three semantic-name registrations (`codergen`, `ralph.implement`, `agent`) keep pointing at one shared dispatch instance. This shallow shim is the seam — its only job is the routing decision the giant method was making inline.

6. **Companion cleanup — collapse the dead interviewer tier.** Delete `src/attractor/interviewer/console.ts` (zero non-defining references). Delete `src/attractor/interviewer/callback.ts` plus the `CallbackInterviewer` block in `src/attractor/tests/interviewer.test.ts` (only self-tautological coverage). The remaining tier is `InkInterviewer` (TTY production), `AutoApproveInterviewer` (headless production), `QueueInterviewer` (test fixture). The `Interviewer` interface stays — that is the deep seam — but the dead adapters go.

Out of scope (locked by the chat refinement bullets and the verifier's blast estimate):

- A `BaseAgentHandler<TConfig>` generic. Two classes is the right count today; introducing the generic before a third concrete handler appears would re-create the shallow surface this work is removing. The shared piece is a free function (`assembleAgentPrompt`), not a base class.
- Any `.dot` pipeline edits — pipelines reference semantic agent names (`agent='implement'`), never class names.
- Any CLI / flag / `pipeline.jsonl` schema changes — `pipeline.jsonl` records `nodeKind: resolveHandlerType(node)`, not `meta.handler`.
- Any CONTEXT.md / README / ADR updates — zero pre-existing mentions of `AgentHandler`, `ConsoleInterviewer`, or `CallbackInterviewer` in those surfaces (verified by the doc-ripple subagent).
- Un-extracting `flow-analyzer.computeScope` reverse-adjacency or other unrelated refactors. Out of scope; surfaced only for transparency.

## 3. Architecture

### 3.1 Current shape

```
src/attractor/handlers/agent-handler.ts
  └── class AgentHandler implements NodeHandler  (line 42)
        └── execute(node, ctx, meta)             (line 51, ~290 lines)
              ├── prompt-assembly prep            (lines 51-123)
              ├── const interactive = ...         (line 90)
              ├── if (interactive) { ... }        (lines 126-186)  ← path A
              │     ├── if (jsonSchema) fail      (lines 127-132)  ← runtime guard #1
              │     ├── randomUUID + Session       (line 134)
              │     ├── agent.runInteractive       (lines 138-143)
              │     ├── onInteractiveRequest       (line 154)
              │     ├── buildSessionDigest         (line 167)
              │     └── ${prefix}.output flatten   (lines 169-177)
              └── // --- end interactive branch; legacy path below is unchanged ---  (line 187)
                    ├── maxIterations resolve     (lines 189-203)
                    ├── outputsToZod              (line 211)
                    ├── for-loop                  (line 229)         ← path B
                    │     ├── agent.run             (line 238)
                    │     ├── evaluateAgentOutput   (line 260)
                    │     ├── retry-with-corrective (lines 262-290)
                    │     ├── prev_note plumbing    (lines 312-314)
                    │     └── done===true break     (lines 318-319)
                    └── structuredUpdates + return (lines 325-342)

src/attractor/core/engine.ts
  └── buildHandlerMap                              (lines 47-63)
        ├── const agentHandler = new AgentHandler();  (line 49)
        ├── m.set("codergen", agentHandler)           (line 52)
        ├── m.set("ralph.implement", agentHandler)    (line 56)
        └── m.set("agent", agentHandler)              (line 61)

src/attractor/interviewer/
  ├── index.ts          (interface + barrel)
  ├── ink.ts            (production)
  ├── auto-approve.ts   (production)
  ├── queue.ts          (test fixture)
  ├── console.ts        ← dead: zero non-defining references
  └── callback.ts       ← dead: only self-tautological test
```

### 3.2 Target shape

```
src/attractor/handlers/agent-prep.ts                ← new
  └── assembleAgentPrompt(node, config, ctx, meta) → PreparedAgent
        (owns the lines-51-123 prep, including prompt.md write
         and Agent instantiation; both handlers consume.)

src/attractor/handlers/interactive-agent-handler.ts  ← new
  └── class InteractiveAgentHandler implements NodeHandler
        └── execute(node, ctx, meta)
              ├── const prep = assembleAgentPrompt(...)
              ├── if (!onInteractiveRequest) fail    (engine invariant — kept)
              ├── runInteractive + Session digest
              └── ${prefix}.output flatten
        (no jsonSchema runtime guard — validator catches it.)

src/attractor/handlers/looping-agent-handler.ts      ← new
  └── class LoopingAgentHandler implements NodeHandler
        └── execute(node, ctx, meta)
              ├── const prep = assembleAgentPrompt(...)
              ├── maxIterations resolve
              ├── outputsToZod
              └── iteration loop + retry + prev_note + done-break

src/attractor/core/engine.ts
  └── buildHandlerMap
        ├── const interactive = new InteractiveAgentHandler();
        ├── const looping     = new LoopingAgentHandler();
        ├── const dispatch    = new AgentHandlerDispatch(interactive, looping);
        ├── m.set("codergen", dispatch);
        ├── m.set("ralph.implement", dispatch);
        └── m.set("agent", dispatch);

src/attractor/core/graph.ts
  ├── existing rules unchanged
  ├── + interactive_with_outputs_forbidden rule
  └── + interactive_with_loop_forbidden rule

src/attractor/handlers/agent-handler.ts              ← deleted
src/attractor/interviewer/console.ts                 ← deleted
src/attractor/interviewer/callback.ts                ← deleted
```

Two named handlers behind a thin dispatcher; one shared prep function; two runtime mode-confusion guards lifted to authoring-time diagnostics.

### 3.3 `AgentHandlerDispatch` interface

```ts
// src/attractor/core/engine.ts (or src/attractor/handlers/agent-dispatch.ts)
export class AgentHandlerDispatch implements NodeHandler {
  constructor(
    private readonly interactive: NodeHandler,
    private readonly looping: NodeHandler,
  ) {}

  async execute(node: Node, ctx: PipelineContext, meta: HandlerExecutionContext): Promise<Outcome> {
    // DOT attributes parse as strings; coerce explicitly to boolean
    const isInteractive = node.interactive === true || node.interactive === "true";
    return isInteractive
      ? this.interactive.execute(node, ctx, meta)
      : this.looping.execute(node, ctx, meta);
  }
}
```

The `node.interactive` boolean coercion is lifted verbatim from `agent-handler.ts:90`. No semantics change at the dispatch level — this is a 1:1 lift of the inline branch decision.

### 3.4 `assembleAgentPrompt` shape

```ts
// src/attractor/handlers/agent-prep.ts (new file)
import type { Node, PipelineContext } from "../types.js";
import type { HandlerExecutionContext } from "./registry.js";
import { Agent, type AgentConfig } from "../../cli/lib/agent.js";
// ... other imports lifted from agent-handler.ts

export interface PreparedAgent {
  agent: Agent;
  config: AgentConfig;
  jsonSchema: string | undefined;
  agentVariables: Record<string, unknown>;
  prompt: string;
  nodeDir: string;
}

export function assembleAgentPrompt(
  node: Node,
  ctx: PipelineContext,
  meta: HandlerExecutionContext,
  load: (name: string, pipelineDir: string) => AgentConfig,
  create: (config: AgentConfig) => Agent,
): PreparedAgent | { fail: string } {
  // body lifted verbatim from agent-handler.ts:52-123:
  //   - agent name resolution + load failure handling
  //   - node.llmModel override
  //   - dev-mode tsx MCP swap
  //   - buildSystemInjectedVars + agentVariables merge
  //   - extractDefaults re-prefix
  //   - renderInputsBlock + steering composition
  //   - buildPreamble + jsonWrappedPrompt
  //   - prompt.md write
  //   - new Agent({ ...config, prompt, ...(jsonSchema ? { jsonSchema } : {}) })
  // Returns { fail: string } if loadAgent throws or agent is missing — caller maps to Outcome.
}
```

Body is a near-1:1 lift; no semantics change. The `{ fail: string } | PreparedAgent` shape preserves the existing failure-string contract from `agent-handler.ts:54` and `:61`.

### 3.5 Validator rule emission

Both rules need agent-frontmatter to look up `outputs:` and `loop:`. The validator already invokes `loadAgent` for the existing `bare_input_not_in_caller_inputs_or_system` rule path, so `loadAgent(agentName, dotDir)` is in scope. New rule emission slots in alongside existing emissions; the diagnostic shape (`{ rule, severity, message, location }`) is unchanged. Source location is taken from `node.sourceLocation`, which the v0.1.31 source-location migration populates on every node parsed by `parseDot`.

## 4. Components & file edits

| File | Change |
|---|---|
| `src/attractor/handlers/agent-prep.ts` | **New file.** Exports `assembleAgentPrompt(node, ctx, meta, load, create): PreparedAgent \| { fail: string }`. Body lifted from `agent-handler.ts:52-123`. Re-exports `SYSTEM_INJECTED_VARS` (currently exported at `agent-handler.ts:22`) so the validator's `bare_input_not_in_caller_inputs_or_system` rule keeps importing it from a stable name. |
| `src/attractor/handlers/interactive-agent-handler.ts` | **New file.** Exports `class InteractiveAgentHandler implements NodeHandler`. Calls `assembleAgentPrompt`, then runs the body lifted from `agent-handler.ts:134-186` (Session, runInteractive, callback, kill timeout, digest, `${prefix}.output` flatten). The runtime `if (jsonSchema)` guard at line 127 is **omitted** — validator catches it. The `if (!onInteractiveRequest)` guard is **kept**. |
| `src/attractor/handlers/looping-agent-handler.ts` | **New file.** Exports `class LoopingAgentHandler implements NodeHandler`. Calls `assembleAgentPrompt`, then runs the body lifted from `agent-handler.ts:189-342` (maxIterations resolve, outputsToZod, iteration loop, retry, prev_note, done-break, structured update flatten). |
| `src/attractor/handlers/agent-handler.ts` | **Deleted.** All consumers re-routed via the dispatcher. The `SYSTEM_INJECTED_VARS` re-export keeps its public name in `agent-prep.ts`. |
| `src/attractor/core/engine.ts` | Replace `const agentHandler = new AgentHandler();` at line 49 with the dispatch instantiation block (see §3.3). The three `m.set` registrations at lines 52, 56, 61 keep their semantic keys — only the value changes from `agentHandler` to `dispatch`. |
| `src/attractor/core/graph.ts` | Add two new rule emissions: `interactive_with_outputs_forbidden` and `interactive_with_loop_forbidden`. Both inside the existing per-node validation loop where agent-frontmatter is already loaded for `bare_input_not_in_caller_inputs_or_system`. Diagnostic shape `{ rule, severity, message, location }` matches existing siblings (e.g. `graph.ts:187-190`). |
| `src/attractor/interviewer/console.ts` | **Deleted.** Zero non-defining references in the repo. |
| `src/attractor/interviewer/callback.ts` | **Deleted.** Only self-tautological coverage in `interviewer.test.ts`. |
| `src/attractor/interviewer/index.ts` | Remove `console` and `callback` re-exports if present; keep `Interviewer` interface, `InkInterviewer`, `AutoApproveInterviewer`, `QueueInterviewer` exports. |
| `src/attractor/tests/agent-handler.test.ts` | Retarget at `LoopingAgentHandler` (the bulk of its existing cases exercise the loop path). |
| `src/attractor/tests/agent-handler-deep-loop.test.ts` | Retarget at `LoopingAgentHandler`. |
| `src/attractor/tests/agent-handler-frontmatter-jsonschema.test.ts` | Retarget at `LoopingAgentHandler`. |
| `src/attractor/tests/agent-handler-inputs.test.ts` | Retarget at `LoopingAgentHandler` (default-prefix behavior). |
| `src/attractor/tests/agent-handler-json-constraint.test.ts` | Retarget at `LoopingAgentHandler`. |
| `src/attractor/tests/agent-handler-retry.test.ts` | Retarget at `LoopingAgentHandler`. |
| `src/attractor/tests/agent-handler-interactive.test.ts` | Retarget at `InteractiveAgentHandler`. Drop the case that asserts the runtime `if (jsonSchema)` failure string — the new validator-rule test covers that path. |
| `src/attractor/tests/interviewer.test.ts` | Delete the `CallbackInterviewer` block (only self-tautological coverage). Keep `Ink` / `AutoApprove` / `Queue` cases. |
| `src/attractor/tests/graph-interactive-with-outputs-forbidden.test.ts` | **New file.** Asserts the validator emits `interactive_with_outputs_forbidden` with the expected message + `location` when a node sets `interactive=true` and its agent declares `outputs:`. |
| `src/attractor/tests/graph-interactive-with-loop-forbidden.test.ts` | **New file.** Asserts the validator emits `interactive_with_loop_forbidden` for the three trigger combos: `node.loop=true`, `node.maxIterations>1`, `agent.loop=true`. |

No `.dot` pipeline edits. No CLI / MCP / agent-rubric edits. No CONTEXT.md / README / ADR edits.

## 5. Data flow

The pipeline run path is byte-identical before and after for any `.dot` graph that is currently valid. Inputs (the parsed `Graph`) and outputs (`PipelineResult.context`, `pipeline.jsonl` per-node records) keep their existing shapes — `pipeline.jsonl` records `nodeKind: resolveHandlerType(node)` and that resolver is unchanged.

The only externally observable behavioral change is for graphs that previously passed validation but failed at runtime via `agent-handler.ts:127-132` (the `interactive=true + outputs:` runtime fail) or were silently misconfigured (`interactive=true + loop=true` running only the interactive branch). After the change those graphs fail `pipeline validate` with a file:line:col-anchored diagnostic before the engine starts. This is the desired behavior shift the illumination explicitly proposed; it is not a breaking change for any currently-shipping `.dot` (none in the bundled-pipeline corpus combine those flags — verified by the test-files subagent against the 14 `pipeline-smoke-*-folder.test.ts` corpus).

`buildPreamble`, `renderInputsBlock`, `extractDefaults`, `outputsToZod`, `evaluateAgentOutput`, `buildCorrectiveMessage`, `buildSessionDigest`, `Agent.run`, `Agent.runInteractive` — all unchanged. The Session lifecycle (interactive branch) and the iteration / retry budget (looping branch) move literally from one file to two files; their code paths execute the same calls in the same order.

## 6. Blast radius / impact surface

Sourced from the verifier's `Blast radius:` paragraph and the explainer's `## Blast radius` block. The verifier's count is authoritative where it differs from the illumination — the illumination's "16 pipeline-smoke tests" claim is corrected to **14** below (verified by Glob against `src/cli/tests/pipeline-smoke-*-folder.test.ts`).

- **Size:** M
- **Files touched:** ~12 — handler module + core engine registry + graph validator + interviewer tier + test suite. Specifically: 3 new handler files (`agent-prep.ts`, `interactive-agent-handler.ts`, `looping-agent-handler.ts`); 1 deleted handler file (`agent-handler.ts`); 1 registry edit (`engine.ts`); 1 validator edit with 2 new rules (`graph.ts`); 2 deleted interviewer files (`console.ts`, `callback.ts`); 1 interviewer index trim (`interviewer/index.ts`); 7 retargeted handler tests; 1 partial delete in `interviewer.test.ts`; 2 new validator-rule tests.
- **Surfaces crossed:** handler module + core engine registry + graph validator + interviewer tier + test suite.
  - **CLI:** unaffected — no command, flag, or help-text change.
  - **MCP / `illumination-server`:** unaffected.
  - **Pipeline engine (run path):** behaviorally identical for currently-valid graphs. `pipeline.jsonl` records `nodeKind: resolveHandlerType(node)`, not class name — the dispatcher transparently substitutes for `AgentHandler` at all three semantic-name keys.
  - **Pipeline engine (validate path):** two new error-severity diagnostics fire for previously-mis-typed graphs. No existing diagnostic is silenced or re-worded; the rule shape `{ rule, severity, message, location }` matches existing siblings (`graph.ts:187-190`).
  - **Agents:** unaffected — no agent rubric, prompt, or contract sees a change.
  - **`.dot` syntax:** unaffected — `interactive=true` parses the same; only its rejection criteria expand.
  - **Frontmatter shapes:** unaffected — `outputs:`, `loop:`, `maxIterations:` keep their meanings.
  - **`.ralph/` layout:** unaffected.
  - **Public exports:** `AgentHandler` was internal-only — `src/attractor/core/engine.ts` was its sole non-test importer (verified by the public-contract subagent). `SYSTEM_INJECTED_VARS` keeps its public name, re-exported from `agent-prep.ts`. New exports `InteractiveAgentHandler`, `LoopingAgentHandler`, `AgentHandlerDispatch`, `assembleAgentPrompt` have no prior name collision.
- **Breaking change:** **no.** Internal-only refactor; pipelines reference semantic agent names (`agent='implement'`), never class names; `pipeline.jsonl` records `nodeKind: resolveHandlerType(node)` not `meta.handler`.
- **Spec / docs ripple checklist:**
  - [ ] No CONTEXT.md update required — zero mentions of `AgentHandler`, `ConsoleInterviewer`, or `CallbackInterviewer` (verified by doc-ripple subagent).
  - [ ] No README update required — same.
  - [ ] No ADR update required — ADR-0001 forbids global agent registries but says nothing about handler class shape; no ADR constrains in-source class splitting (verified by ADR subagent).
- **Test ripple checklist:**
  - [ ] 7 existing `agent-handler-*.test.ts` retargeted (import swap + class name rename in test setup; assertions unchanged).
  - [ ] 1 partial delete in `interviewer.test.ts` (CallbackInterviewer block).
  - [ ] 2 new files: `graph-interactive-with-outputs-forbidden.test.ts`, `graph-interactive-with-loop-forbidden.test.ts`.
  - [ ] **14** `pipeline-smoke-*-folder.test.ts` files exercise `validateGraph` + the engine end-to-end against bundled pipelines — no edits, no behavior change. (Illumination's "16" count is corrected to 14.)

## 7. Trade-offs

### 7.1 Free function vs base class for the shared prep

`assembleAgentPrompt` is a free function, not a `BaseAgentHandler<TConfig>` abstract class. The illumination's step 1 explicitly chose the function form ("Move the shared prep ... into a free function in a new `src/attractor/handlers/agent-prep.ts`"). The "Things to keep in mind" bullet at the bottom of the illumination reinforces this: "Don't introduce `BaseAgentHandler<TConfig>` generics until a third concrete handler appears — that would re-create the shallow surface this work is removing."

The free-function shape also keeps the `loadAgent` and `createAgent` deps explicit at the call site rather than buried in a constructor, which makes the existing `AgentHandlerDeps` injection pattern (used by `agent-handler.test.ts`) port cleanly to per-handler test setup.

### 7.2 Dispatcher class vs `if/else` inside `buildHandlerMap`

The dispatcher is a named class (`AgentHandlerDispatch`) with one method (`execute`) rather than an inline branch in `buildHandlerMap`. Reasons:

- The `m.set` API expects a `NodeHandler`; the branch needs to live somewhere with that signature.
- Three keys (`codergen`, `ralph.implement`, `agent`) all need the same dispatch. Hoisting the branch into a named class lets all three keys share one instance — three inline branches would replicate the same `node.interactive` coercion three times.
- The class is a shallow shim by design (one method, one decision). That is the seam the illumination calls out: "the dispatcher is the seam." It exists to make the routing decision the giant method was making inline visible at the registry level.

### 7.3 Validator rules need agent-frontmatter access

Both new rules look up `agent.outputs` (rule 1) and `agent.loop` (rule 2). The validator already invokes `loadAgent` for the existing `bare_input_not_in_caller_inputs_or_system` rule (which reads `agent.inputs`), so the agent loader is in scope and `loadAgent` failure paths are already handled. The new rules slot into the same per-node block; no new infrastructure is required.

If a future change moves agent frontmatter resolution earlier in the validate phase (e.g. to support cross-node agent-output inference), these two rules ride along. They do not introduce a new failure mode for agent loading.

### 7.4 Keep `QueueInterviewer`

`QueueInterviewer` is referenced only in test fixtures (`src/attractor/tests/`) and is **kept** — test fixtures are real consumers under the deep-modules lens, not dead weight. The deletion criterion the illumination applies to `ConsoleInterviewer` and `CallbackInterviewer` is "zero non-defining references" (Console) and "only self-tautological tests" (Callback). `QueueInterviewer` fails both deletion criteria.

### 7.5 Drop runtime `interactive + outputs` fail vs keep belt-and-suspenders

The illumination's step 3 explicitly drops the runtime guard ("Drop the `if (jsonSchema)` runtime guard — the validator now rejects `interactive=true` + `outputs:` at parse time"). The argument is locality — keeping both means a maintainer fixing the validator rule has to also remember to update the runtime fail string, and they can drift. The validator rule fires earlier, with file:line:col anchors and the existing diagnostic UX; the runtime fail fired late, mid-graph, with a generic string. Removing the runtime fail concentrates the constraint at the seam where it now lives.

If the validator rule has a bug and lets a bad graph through, the failure mode is not "silent corruption" — `agent.runInteractive` will receive a `jsonSchema` argument it doesn't honor, and the session will run interactively without producing structured output. The downstream node's `inputs:` resolution will then surface a clean `bare_input_*` failure. The blast is bounded.

### 7.6 Defer un-extracting the `Interviewer` interface itself

The `Interviewer` interface (3 methods: `prompt`, `confirm`, `select`) stays. The illumination flagged that "5 classes implementing 3-method interface" is wider than the production paths actually need, but the deletion targets only the dead adapters (`Console`, `Callback`); the interface itself has three live consumers (`Ink`, `AutoApprove`, `Queue`) and is the deep seam between the engine and the TUI / headless / test surfaces. Collapsing it further would require collapsing one of `Ink` / `AutoApprove`, which is a different shape of refactor — out of scope for this design.

## 8. Constraints

- All edits land in a single commit so the diff tells a single story (3 new handler files, 2 new validator rules, 1 registry edit, 2 deleted interviewer files, 7 retargeted test files, 2 new validator-rule tests, 1 partial test delete).
- `npx tsc --noEmit` must pass after the change. The dispatcher preserves the `NodeHandler` signature; the new handlers each implement `NodeHandler`; `assembleAgentPrompt` reuses existing types (`Node`, `PipelineContext`, `HandlerExecutionContext`, `Agent`, `AgentConfig`).
- `npx vitest run` must pass with no edits to the 14 `pipeline-smoke-*-folder.test.ts` files. The 7 retargeted handler tests assert the same behaviors against renamed classes; the 2 new validator-rule tests lock the new emissions.
- `pipeline.jsonl` byte-equivalence (modulo timestamps) for any pre-split valid graph. The illumination's step 7 verification calls for: "diff the `pipeline.jsonl` traces by hash for every node. Identical byte-for-byte except `meta.handler` would be the desired outcome." `pipeline.jsonl` does not record `meta.handler` today — it records `nodeKind: resolveHandlerType(node)`. Verification reduces to: hash-diff `pipeline.jsonl` runs against the bundled implement / meditate / janitor pipelines pre-split vs post-split — they must match.
- `SYSTEM_INJECTED_VARS` must keep its existing import path callable. The validator imports it from `agent-handler.ts`; after the split, it lives in `agent-prep.ts`. Either re-export from a stable module or update the validator's import.
- Diagnostic strings on existing rules (`reaches_exit`, `variable_coverage`, `script_command_conflict`, etc.) stay byte-identical. Any wording change indicates accidental coupling and must be reverted before merge.
- New rule message strings can be tuned in-loop with the spec reviewer or in a follow-up; they are not load-bearing for the architecture decision.

## 9. Open questions

None at design-doc time. All three rubric criteria (still-relevant / technically-accurate / project-fit) pass per the verifier's evidence; the illumination's revised steps 1-7 are honored except for the 16-vs-14 smoke-test count correction (verified). The reviewer loop may surface nits on:

- `assembleAgentPrompt` placement — `src/attractor/handlers/agent-prep.ts` vs colocated under `src/cli/lib/` (current `agent.ts` neighborhood).
- Whether `AgentHandlerDispatch` lives in `engine.ts` (where `buildHandlerMap` is) or in its own `src/attractor/handlers/agent-dispatch.ts`. Either is fine — the class is small and the import shape is the same.
- Whether `interactive_with_loop_forbidden` should also reject `agent.maxIterations > 1` (in addition to `node.maxIterations > 1`). The illumination is silent on this; current proposal: yes, both. Resolved in-loop.
- Whether `SYSTEM_INJECTED_VARS` should move to a module strictly downstream of both new handlers (e.g. `src/attractor/core/system-vars.ts`) so neither handler depends on the prep module just to re-export the constant. Cosmetic; deferred to in-loop discussion.

## 10. Verification approach

### 10.1 Static checks

Run after the change, in order:

- `npx tsc --noEmit` — clean. The dispatcher preserves the `NodeHandler` signature; both new handlers implement it; `assembleAgentPrompt` types resolve.
- Repo-wide grep for `class AgentHandler\b` — expected: zero hits (file deleted).
- Repo-wide grep for `from "../handlers/agent-handler"` — expected: zero hits (only `engine.ts` was importing from there, now imports the dispatch trio).
- Repo-wide grep for `ConsoleInterviewer\|CallbackInterviewer` — expected: zero hits in `src/` (both files deleted, all references gone).
- Positive-existence grep for `class InteractiveAgentHandler`, `class LoopingAgentHandler`, `class AgentHandlerDispatch`, `function assembleAgentPrompt` — each exactly one definition.
- Positive-existence grep for `interactive_with_outputs_forbidden`, `interactive_with_loop_forbidden` — each at least 2 hits (one rule emission + one test).

### 10.2 Tests

- `npx vitest run src/attractor/tests/agent-handler*.test.ts` — all 7 retargeted files pass. Imports + class names updated; assertions unchanged.
- `npx vitest run src/attractor/tests/graph-interactive-*.test.ts` — both new files pass. Each asserts: rule fires for the trigger combo, rule does NOT fire for the non-trigger control, `location` is populated from `node.sourceLocation`.
- `npx vitest run src/attractor/tests/interviewer.test.ts` — passes after the `CallbackInterviewer` block delete.
- `npx vitest run src/cli/tests/pipeline-smoke-*-folder.test.ts` — all 14 files pass. They exercise `validateGraph` + engine end-to-end against the bundled pipelines; behavior is unchanged for currently-valid graphs.
- `npx vitest run` — entire suite passes.

### 10.3 Smoke

- `ralph pipeline validate <bundled-pipeline>` against each of the 14 bundled per-folder pipelines — expected: identical diagnostic output before and after. None of the bundled pipelines combine `interactive=true` with `outputs:` or `loop:true` (verified by manual spot-check of `src/cli/pipelines/`); the new rules will not fire.
- `ralph pipeline run <bundled-pipeline>` against the bundled `implement` pipeline — expected: identical exit code and `pipeline.jsonl` content (modulo timestamps + nondeterministic IDs).
- Hash-diff of `pipeline.jsonl` traces from a known-good `implement` run pre-split vs post-split — equal.
- `npm run build` — `tsup` produces the same `dist/` shape. The handler-module file count goes from 1 to 3 plus a deleted file; if `dist/` lays out per-source, the dist tree gains `agent-prep.js`, `interactive-agent-handler.js`, `looping-agent-handler.js` and loses `agent-handler.js`. No new bin entries, no removed bin entries.

### 10.4 Validator-rule negative cases

For each new rule, the validator-rule test asserts both directions:

- `interactive_with_outputs_forbidden`:
  - Trigger graph (`interactive=true` node + agent with `outputs: {note: string}`) → rule fires, message contains node id and agent name, `location` populated.
  - Non-trigger graphs: `interactive=true` + agent without `outputs:` → rule does NOT fire. Agent with `outputs:` but `interactive=false` → rule does NOT fire.
- `interactive_with_loop_forbidden`:
  - Trigger graphs: each of `node.loop=true`, `node.maxIterations=2`, `agent.loop=true` (combined with `interactive=true`) → rule fires.
  - Non-trigger graphs: `interactive=true` alone, `loop=true` alone, `interactive=false + loop=true` → rule does NOT fire.

## 11. Summary

A 290-line `AgentHandler.execute` method at `src/attractor/handlers/agent-handler.ts` whose own line-187 comment names the second half "legacy" splits into two named handlers — `InteractiveAgentHandler` and `LoopingAgentHandler` — sharing a single free function `assembleAgentPrompt` (`src/attractor/handlers/agent-prep.ts`) for prompt assembly, MCP injection, and `prompt.md` write. The handler registry at `src/attractor/core/engine.ts:47-63` swaps the single `new AgentHandler()` for an `AgentHandlerDispatch` shim that routes per-call on `node.interactive`. Two runtime mode-confusion guards (`interactive=true + outputs:` runtime fail at line 127; `interactive=true + loop=true` silent no-op via the early-return at line 186) lift to graph-validator rules `interactive_with_outputs_forbidden` and `interactive_with_loop_forbidden` in `src/attractor/core/graph.ts`, reported with the v0.1.31 file:line:col diagnostic shape. Two dead interviewer adapters — `src/attractor/interviewer/console.ts` (zero non-defining references) and `src/attractor/interviewer/callback.ts` (only self-tautological test) — are deleted; `Interviewer` interface and `Ink` / `AutoApprove` / `Queue` adapters stay. Seven `agent-handler-*.test.ts` files retarget to the new handler classes; two new `graph-interactive-*-forbidden.test.ts` files lock the validator emissions; one block in `interviewer.test.ts` is dropped. No `.dot` pipeline edits, no CLI / flag / `pipeline.jsonl` schema changes, no CONTEXT.md / README / ADR updates. Public exports — `parseDot`, `resolveHandlerType`, `validateGraph`, `validateOrRaise`, `SYSTEM_INJECTED_VARS` — unchanged. Net code direction is reduction at the registry level (one class, three keys) → focused expansion at the handler level (two classes, one shared function), with two runtime constraints relocated to authoring-time diagnostics where the user can see them before the engine starts.
