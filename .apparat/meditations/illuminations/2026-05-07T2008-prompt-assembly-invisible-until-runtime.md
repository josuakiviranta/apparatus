---
date: 2026-05-07
description: The exact bytes an agent's LLM receives are deterministically assembled by `assembleAgentPrompt()` but invisible to the author until a real run dumps them into a gitignored, lazily-pruned `.apparat/runs/` dir — there is no `pipeline preview` / `pipeline explain` to close the design-time/run-time gap.
---

## Core Idea

`src/attractor/handlers/agent-prep.ts:assembleAgentPrompt()` is a deterministic, side-effect-free pure function (modulo the `prompt.md` write) that combines preamble + agent body + auto-injected `## Inputs` block + steering. It is the single source of truth for what the LLM sees. Yet apparat exposes **zero design-time surface** for it. The author writes a `.md` agent file, scribbles `inputs:` and `outputs:` in frontmatter, and then has to run the pipeline against a real project to discover what their agent actually receives — and they discover it by digging into `<project>/.apparat/runs/<runId>/<nodeId>/prompt.md`, which is gitignored and lazily pruned (last 50 runs, `APPARAT_RUNS_KEEP`). The deepest module in the engine — prompt assembly — has the shallowest seam to the human author.

## Why It Matters

The two prior illuminations (mission-control fragmentation; missing CRUD) cover the *outer* harness around the graph. This one is about the *inner* opacity: even with perfect mission control and a `pipeline create` shim, the human authoring an agent still cannot answer the most basic question — *"what will my LLM see?"* — without doing a round-trip through `pipeline run`.

Concrete evidence:

- `agent-prep.ts:88-90` writes the assembled prompt to `<runDir>/<nodeId>/prompt.md`. There is no equivalent design-time output. The transformation is deep; the inspection point is buried.
- `inputs-renderer.ts:renderInputsBlock` invents a tag format (`<renderedTag>value</renderedTag>`, with multi-line variants) the author never sees. Author writes `outputs: { vision: string }` and `inputs: read_vision_vision`; what reaches the LLM is `<read_vision_vision>...</read_vision_vision>`. That tag-mangling rule lives only in source and one paragraph buried in `pipelines.md`. Author iteration on prompt body is blind to it.
- `pipeline trace --node-receive <id>` (`src/cli/commands/pipeline/trace.ts:51-79`) prints the `contextSnapshot` keys but not the rendered prompt. The rendered prompt is sitting at a sibling path `<runDir>/<nodeId>/prompt.md` — one extra `cat` would surface it. Trace is shallow where it could be deep.
- `pipeline show` (`annotate-show.ts`) emits SVG with `in:` / `out:` labels — the closest thing to "explain my pipeline." But it is static, requires Graphviz WASM, and does not walk the *flow* (which node fires first, what `<inputs>` each receives, which iterate). `flow-analyzer.ts` already computes the producer/consumer graph; `pipeline explain <name>` could print a plain-English walkthrough from that.
- The runtime preview the author would need at design time — *"feed `vision="X"`, project=`my-app`, see what the meditate agent gets"* — is reachable in 30 lines: load pipeline, pick a node, call `assembleAgentPrompt()` with synthesised `ctx.values`, print to stdout. No LLM invocation, no checkpoint, no run dir. A pure-function preview that rides the same seam the runtime already uses.

Strategic compass — VISION.md frames pipelines as *"delegating to someone who already understands the shape of the problem."* Today, the author building that delegate is themselves blind: they cannot see the briefing their delegate will receive. Apparat is engine-driven (`stimuli/prompt-as-program-philosophy.md`) and the engine's superpower is determinism; if the runtime can render the prompt deterministically, the design-time tool can too. Failing to expose this is the engine pattern's biggest cost (transcript-level traceability) showing up at *author time* instead of just run time.

`stimuli/deep-modules-hide-complexity.md` reading: `assembleAgentPrompt` is the deepest module in the engine. Its caller-facing seam (the prompt that arrives at the LLM) is currently exposed only inside the runtime. A `pipeline preview` command is a second adapter on the same seam — caller learns one symbol, gets full visibility into what the engine builds. That is leverage.

`stimuli/comprehensive-docs-are-agent-fuel.md` reading: the rendered prompt **is** the agent's documentation of itself. Every iteration on agent body is an iteration on a document the author cannot read. Make it readable.

## Revised Implementation Steps

1. **Extract `assembleAgentPrompt()`'s side-effect-free core.** It currently mkdirs and writes `prompt.md`. Split into pure `buildAgentPrompt(node, ctx, agentConfig, meta) → { prompt, inputsBlock, jsonSchema }` and a thin runtime wrapper that adds the writeFileSync. One seam, two callers.
2. **Add `apparat pipeline preview <pipeline> --node <id> [--var k=v]`.** Loads the pipeline (reuse `loadPipeline()` from `pipeline-invocation.ts`), synthesises `ctx.values` from `--var` flags + node defaults, calls the pure builder for the chosen node, prints the rendered prompt to stdout. No LLM invocation, no checkpoint dir created. Author iterates on agent body with `<3s` feedback.
3. **Add `apparat pipeline explain <pipeline>`.** Walk the topology start→exit, print: each node id + agent + inputs/outputs (from agent metadata), each edge with its data-flow intersection (reuse `annotate-show.ts` logic), each gate's choices, each loop's `done` field. Plain English — no SVG, no graphviz dependency, runs in any terminal. Closes the "what does this pipeline do?" question without making the author stare at a graph.
4. **Surface the runtime's `prompt.md` path inside `pipeline trace --node-receive`.** Three lines in `trace.ts:51-79`: print `prompt: <runDir>/<nodeId>/prompt.md` after the context snapshot. Author goes from "node started with these keys" to "and here is the literal text it received" with one `cat`.
5. **Make the rendered-prompt path stable per-pipeline, not per-run.** On every run, also drop a copy of each node's rendered prompt into `<pipeline-dir>/.last-rendered/<nodeId>.md` (gitignored, overwritten each run). Diff between iterations becomes `git diff` against a sibling tracked baseline if the author chooses to commit it. Solves the "lazy prune nuked my evidence" failure mode without keeping every run forever.
6. **Document the `<inputs>` rendering contract in one place.** Today the tag-mangling rule (snake_case_dot → underscored tag) is implicit in `inputs-resolver.ts`. Move the human-facing description out of buried source comments into `src/cli/skills/apparatus/pipelines.md` (the live reference per ADR-0011), with one example block authored by `pipeline preview`. README + help text link to it instead of paraphrasing — collapse the doc-drift surface (also called out in the prior CRUD illumination, step 6).
7. **Wire `pipeline preview` into `pipeline watch` (the missing-CRUD illumination's step 3).** When the author saves an agent file, the watcher re-validates *and* re-renders the preview. The cold edit→validate→run loop becomes warm edit→see-what-the-LLM-will-see, with the LLM never spawned until the author chooses `pipeline run`.
