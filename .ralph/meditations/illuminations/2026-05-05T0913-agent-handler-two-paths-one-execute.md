---
date: 2026-05-05
description: AgentHandler.execute crams two structurally disjoint code paths (interactive session vs. looping json-validated agent) into one 277-line method whose own comment names the second half "legacy" — the deepening move is to split into InteractiveAgentHandler + LoopingAgentHandler with shared prompt-assembly extracted as a base, mirroring the same shallow-module pattern visible in the 5-class interviewer tier where 2 are dead in production.
---

## Core Idea

`src/attractor/handlers/agent-handler.ts` is registered as a single `AgentHandler` class but its `execute()` method is two disjoint handlers wedged into one body. Lines ~120-180 are the interactive path (`runInteractive` + session digest + interactive-request callback). The remaining ~150 lines are guarded by an in-source comment — `// --- end interactive branch; legacy path below is unchanged ---` — and run a completely different shape: iteration loop, `evaluateAgentOutput` retry-with-corrective-message, `prev_note` plumbing, deep-loop `done=true` break. The two paths share prompt assembly and MCP injection; they share **nothing** about how the agent is invoked, how results become `contextUpdates`, or how abort propagates. The runtime even encodes the disjunction defensively (`if (jsonSchema) return fail "interactive=true cannot be combined with outputs:"`). The deepening move is to split into `InteractiveAgentHandler` and `LoopingAgentHandler` over a shared `BaseAgentHandler` (or composition helper) that owns prompt assembly, defaults extraction, and system-injected vars.

## Why It Matters

Three converging symptoms make this a shallow module pretending to be deep:

- **In-source admission of two histories.** The `legacy path below is unchanged` comment (`agent-handler.ts:188`) is the kind of ghost-of-refactor-past marker that meta-meditation `when-code-is-slop.md` calls out — a self-aware split waiting to be made.
- **Test-file fragmentation already mirrors the split.** `src/attractor/tests/` carries `agent-handler-interactive.test.ts` plus six others (`-deep-loop`, `-frontmatter-jsonschema`, `-inputs`, `-json-constraint`, `-retry`, plus `agent-handler.test.ts`). Seven test files for one class is the test layer telling us the abstraction has at least two inhabitants.
- **Mode-confusion guards instead of types.** "interactive=true + outputs:" is rejected at runtime; "interactive=true + loop:true" silently ignores the loop because the early-return fires before the iteration body. These are validator-level constraints, not runtime accidents — but only the runtime is enforcing them today, and only partially.

The same shape — a class hierarchy that's wider than the actual production paths — also sits in `src/attractor/interviewer/`. Five classes (`ConsoleInterviewer`, `CallbackInterviewer`, `QueueInterviewer`, `InkInterviewer`, `AutoApproveInterviewer`) implement the 3-method `Interviewer` interface. Production code (`pipeline.ts:374-375`) only ever instantiates `InkInterviewer` (TTY) or `AutoApproveInterviewer` (headless). `ConsoleInterviewer` is referenced by **no** non-defining file in the repo. `CallbackInterviewer` appears only in `interviewer.test.ts` testing itself — a tautology, not a usage. This is the same shallow-module rot at smaller scale: speculative interfaces inflating the type surface beyond what the engine actually needs. It is structurally identical to the already-illuminated `ParallelHandler` / `ManagerLoopHandler` dead-code findings (`2026-05-01T0423`, `2026-05-01T0828`) — the pattern repeats whenever a registry pretends to be open-ended but only two adapters are alive.

Locality and leverage both lose under the current shape. A maintainer fixing an interactive abort bug has to read the loop+JSON-validation code to confirm they didn't break it (low locality). A new contributor adding a third handler shape — say, "streaming-only without iteration" — has to either fork the giant method or add a third branch alongside the legacy comment (low leverage). Splitting concentrates each concern, halves the body each maintainer must reason about, and turns the validator's "you cannot combine X with Y" rules into impossibilities-by-type rather than runtime fail strings.

## Revised Implementation Steps

1. **Extract `assembleAgentPrompt(node, config, ctx, meta)`.** Move the shared prep (MCP injection, system-injected vars in `buildSystemInjectedVars`, `extractDefaults` re-prefix, `renderInputsBlock`, preamble + steering composition, `prompt.md` write) into a free function in a new `src/attractor/handlers/agent-prep.ts`. Returns `{ prompt, agentVariables, jsonSchema }`. Both new handlers consume this. The current method body shrinks by ~60 lines before any actual split.

2. **Create `LoopingAgentHandler`.** Move iteration loop, `evaluateAgentOutput`, retry-with-corrective-message, `prev_note`, deep-loop `done=true`, and `preferred_label` extraction into `looping-agent-handler.ts`. Tests `agent-handler-deep-loop`, `agent-handler-frontmatter-jsonschema`, `agent-handler-inputs`, `agent-handler-json-constraint`, `agent-handler-retry` retarget against this class.

3. **Create `InteractiveAgentHandler`.** Move `runInteractive`, `onInteractiveRequest`, session digest, child kill timeout, and the `${prefix}.output` flatten into `interactive-agent-handler.ts`. `agent-handler-interactive.test.ts` retargets here. Drop the `if (jsonSchema)` runtime guard — the validator now rejects `interactive=true` + `outputs:` at parse time.

4. **Update the handler registry to dispatch by `node.interactive`.** In `src/attractor/handlers/registry.ts` (or wherever `agent` is registered), wrap the two new handlers behind a thin dispatcher: `node.interactive === true` → InteractiveAgentHandler, else LoopingAgentHandler. This is a shallow shim by design — its only job is the routing decision the giant method was making inline.

5. **Promote runtime guards to graph validator rules.** `interactive_with_outputs_forbidden` and `interactive_with_loop_forbidden` become diagnostics in `src/attractor/core/graph.ts` (alongside existing rules like `loop_missing_done_field`). Remove the corresponding runtime fails. `pipeline validate` now catches these at authoring time, with proper file:line:col diagnostics from the source-location infrastructure shipped in v0.1.31.

6. **Companion cleanup — collapse the interviewer tier.** Delete `src/attractor/interviewer/console.ts` (zero non-defining references in repo). Delete `src/attractor/interviewer/callback.ts` plus its self-tautological test in `interviewer.test.ts`. The remaining tier is `InkInterviewer` (TTY production), `AutoApproveInterviewer` (headless production), `QueueInterviewer` (test fixture). The `Interviewer` interface stays — that's the deep seam — but the dead adapters go.

7. **Verify parity.** Run all 16 `pipeline-smoke-*-folder.test.ts` plus the bundled meditate / janitor / implement pipelines twice — once on `main` pre-split, once on the split branch — and diff the `pipeline.jsonl` traces by hash for every node. Identical byte-for-byte except `meta.handler` would be the desired outcome.

### Things to keep in mind

- This is the same prescription deep-modules-hide-complexity calls for: hunt where interface ≈ implementation, pick one candidate, sketch the simple version, move implementation behind it, put the test at the seam. Each new handler is a deep module; the dispatcher is the seam.
- The interactive vs. looping split aligns with the spider/web mental model in user memory: looping = autonomous spider eating through plan chunks; interactive = catch-and-prepare web. Naming the classes that way also clarifies pipeline-author intent.
- Resist generality. Two handler classes is the right number today. Don't introduce `BaseAgentHandler<TConfig>` generics until a third concrete handler appears — that would re-create the shallow surface this work is removing.
- The shipping-now `command-surface-collapse-to-pipeline-alias` work removes wrappers above the engine; this proposal removes wrappers inside the engine. The two finish each other: the operator says one thing, one handler shape executes it.
