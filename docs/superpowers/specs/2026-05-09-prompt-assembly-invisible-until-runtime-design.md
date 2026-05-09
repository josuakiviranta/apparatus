# Design: `apparat pipeline explain <pipeline> [nodeId]` — design-time visibility into prompt assembly

**Date:** 2026-05-09
**Status:** draft (pending review)
**Originating illumination:** `.apparat/meditations/illuminations/2026-05-07T2008-prompt-assembly-invisible-until-runtime.md`
**Supersedes (same illumination, pre-refinement scope):** `docs/superpowers/specs/2026-05-07-prompt-assembly-invisible-until-runtime-design.md`

## 1. Motivation

Today, the deepest module in the engine — prompt assembly — has the shallowest seam to the human author.

`assembleAgentPrompt()` at `src/attractor/handlers/agent-prep.ts:37-42` is the single source of truth for what every agent's LLM sees. It composes preamble + agent body + auto-injected `## Inputs` block + steering, then writes the result to `<runDir>/<nodeId>/prompt.md` at `src/attractor/handlers/agent-prep.ts:97`. The function is deterministic and side-effect-free except for that one `writeFileSync` plus a sibling `mkdirSync` at `src/attractor/handlers/agent-prep.ts:75-76`. It runs identically inside `LoopingAgentHandler` (`src/attractor/handlers/looping-agent-handler.ts:27`) and `InteractiveAgentHandler` (`src/attractor/handlers/interactive-agent-handler.ts:26`).

Yet apparat exposes **zero design-time surface** for it. An author writes a `.md` agent file with `inputs:` and `outputs:` frontmatter, and to discover what their agent will actually receive they must:

1. Run the pipeline against a real project (spawning a real LLM).
2. Locate `<project>/.apparat/runs/<runId>/<nodeId>/prompt.md` — gitignored, lazily pruned (last 50 runs, override via `APPARAT_RUNS_KEEP`).
3. Read that file by hand.

Three concrete consequences:

- **The tag-mangling rule is invisible.** `renderInputsBlock` (`src/attractor/transforms/inputs-renderer.ts:10-41`) wraps each input value in `<${r.renderedTag}>...</${r.renderedTag}>`, where `renderedTag` is built at `src/attractor/transforms/inputs-resolver.ts:41` as `` `${sourceNode}_${localKey}` `` for qualified inputs. An author who declares `inputs: [verifier.summary]` ships an LLM prompt containing `<verifier_summary>...</verifier_summary>` — an underscore replaces the dot. That contract is not documented in `src/cli/skills/apparatus/pipelines.md` (496 lines; zero matches for `renderedTag`/`<rendered`/`underscored tag`).
- **`pipeline trace --node-receive` lies by omission.** It prints `node` / `kind` / `received` / `context snapshot` / `validation attempts` / `completed stages` (`src/cli/commands/pipeline/trace.ts:49-83`) but never the rendered-prompt path — even though the prompt sits at a sibling path under the same run dir.
- **The author cannot answer "what does this pipeline do?" without staring at a graph.** `pipeline show` produces an SVG; that's a graph stare, not a walkthrough. `flow-analyzer.ts:21,36` already computes `computeVarsInScope` / `computeVarsInAnyScope` per node — the data needed for a plain-English topology walk is sitting in the engine, unrendered.

Strategic compass: VISION.md frames pipelines as *delegating to someone who already understands the shape of the problem*. Today the author building that delegate is themselves blind — they cannot read the briefing their delegate will receive without launching the delegate. ADR-0001 (`docs/adr/0001-agents-live-next-to-pipeline.md:23-26`) collapsed the agent registry to a single tier; ADR-0011 makes `src/cli/skills/apparatus/pipelines.md` the live authoring reference. A single additive `pipeline explain` subcommand fits the additive pattern just established by `pipeline list` (`4422dca feat(pipeline-list): show bundled + local roster`), puts the briefing in the author's terminal, and lights up the live reference with the missing tag-mangling rule.

## 2. Decision summary

The chat refinement (round 1) collapsed the illumination's seven steps and the prior-spec two-command surface (`pipeline preview` + `pipeline explain`) into a single, smaller shape. This design implements only that refined shape:

1. **Single additive subcommand: `apparat pipeline explain <pipeline> [nodeId]`.**
   - **Bare** (`apparat pipeline explain <pipeline>`) — topology walkthrough: per-node `kind`, `agent`, `consumes:`, `produces:`, `branches:`, `next:`, plus separate `Loops` and `Reachability` sections. Plain text, no ASCII art, no Graphviz dependency.
   - **Node-zoom** (`apparat pipeline explain <pipeline> <nodeId>`) — render the agent's prompt skeleton with **placeholder** values: each `inputs:` declaration becomes `<renderedTag>placeholder</renderedTag>` using the same tag layout the runtime uses (`<illumination_path>./meditations/illumination</illumination_path>`-style). No `--var` flag; no caller-supplied `ctx.values`. Placeholders come from the node's declared `inputs:` frontmatter and any agent-frontmatter `default_*` attrs. Still no LLM, no run dir.
2. **Pure-core extraction.** Split `assembleAgentPrompt` (`src/attractor/handlers/agent-prep.ts:37-42`) into a pure `buildAgentPrompt` core plus a thin runtime wrapper that retains the `mkdirSync` + `writeFileSync` at `agent-prep.ts:75-76,97`. The exported `assembleAgentPrompt` symbol keeps its five-arg signature so the two existing call sites (`looping-agent-handler.ts:27`, `interactive-agent-handler.ts:26`) and the existing tests in `src/attractor/tests/agent-prep.test.ts` (102 lines) compile unchanged.
3. **One trace line in `pipeline trace --node-receive`.** Inside `src/cli/commands/pipeline/trace.ts:49-83`, after `received: <timestamp>`, print `prompt:   <runDir>/<nodeId>/prompt.md` when the file exists. Closes the post-run gap from "what keys arrived" to "what literal text the LLM saw."
4. **Document the `<renderedTag>` rule** in `src/cli/skills/apparatus/pipelines.md` §3 (agent nodes), one paragraph near lines 45-60. ADR-0011 makes pipelines.md the live reference; the `<renderedTag>` rule belongs there. No new ADR.

**Locked OUT of scope** (chat refinements, round 1):

- A separate `apparat pipeline preview` subcommand. Collapsed into `pipeline explain <pipeline> <nodeId>` per refinement-bullet 1: "One command with optional zoom-in argument is easier to remember and reduces surface concepts vs. two separate commands."
- A `--var k=v` flag. Refinement-bullet 3: "No need for this probably. I think placeholders are enough at least for now."
- Real-value rendering mode of any kind. Refinement-bullet 2: "placeholders are enough at least for now."
- `<pipeline-dir>/.last-rendered/<nodeId>.md` mirror. Refinement-bullet 5: "Skip?" — defer until run-dir prune actually bites in practice.
- `pipeline watch` integration (illumination step 7). Out of this design's surface; belongs to the authoring-loop illumination if revisited.
- Phase-comment grouping in topology view. Implementation may opt into phase grouping if `parseDot` surfaces phase comments cleanly; topological order is the universal fallback.

## 3. Architecture

### 3.1 Before / after

```
Before                                            After
──────                                            ─────
edit agent.md ─┐                                  edit agent.md ─┐
               ▼                                                  ▼
         (no preview)                              apparat pipeline explain <p> <nodeId>
               │                                    (pure, <3s, no LLM, no run dir)
               ▼                                                  │
   apparat pipeline run <p>  ◄── only path                        ▼
   (spawns LLM, writes runs/<id>/<n>/prompt.md)    (optional) apparat pipeline run <p>
               │                                                  │
               ▼                                                  ▼
   dig into .apparat/runs/<runId>/<nodeId>/        apparat pipeline trace <runId> --node-receive <id>
   prompt.md (gitignored, lazily pruned)            …prints "prompt:   <runDir>/<nodeId>/prompt.md"

Before:                                           After:
  pipeline command set =                            pipeline command set =
    run, validate, list, trace, show                  run, validate, list, trace, show, explain
                                                                                     ───────
  prompt-assembly seam =                            prompt-assembly seam =
    assembleAgentPrompt (single impl,                 buildAgentPrompt (pure core)
    runtime-only, writes prompt.md)                 + assembleAgentPrompt (runtime wrapper,
                                                      same signature, writes prompt.md)
```

### 3.2 The single command — `apparat pipeline explain`

```
apparat pipeline explain <pipeline> [nodeId] [--project <folder>]
```

#### 3.2.1 Topology mode (`apparat pipeline explain <pipeline>`)

Plain-text walkthrough. Sketch:

```
Pipeline: illumination-to-implementation
  goal: Triage an illumination into an approved design doc, plan, and code

Nodes:

  start                        kind=start
    next: triage_gate

  triage_gate                  kind=gate (sibling: triage_gate.md)
    consumes: $goal
    produces: triage_gate.choice
    branches: Approve → verifier · Decline → exit
    next: verifier (on Approve), exit (on Decline)

  verifier                     kind=agent (agent: verifier)
    consumes: $goal, illumination_path
    produces: verifier.summary, verifier.explanation, verifier.success
    next: explainer

  …

Loops:
  - implement → implement (on agent.success=false) — retry loop, max_iterations=12

Reachability:
  - all nodes reachable from start ✓
  - exit reachable from all non-loop nodes ✓
```

Implementation notes:

- **Producers** per node come from the agent's `outputs:` frontmatter (already parsed by `loadPipeline` at `src/cli/commands/pipeline-invocation.ts:33`) or from gate `choices:` (gate's `<id>.choice` plus alias).
- **Consumers** per node come from the agent's `inputs:` frontmatter, expanded through `resolveInputDecl` (`src/attractor/transforms/inputs-resolver.ts:18-54`) so `verifier.summary` displays as `verifier.summary` (the original declaration), not as the `verifier_summary` mangled tag.
- **Reachability** uses `computeVarsInAnyScope` (`src/attractor/core/flow-analyzer.ts:36`) for "var available somewhere on the way here" + `computeVarsInScope` (`src/attractor/core/flow-analyzer.ts:21`) for "var available on every path here". Mismatches go in a separate `Branch warnings:` section.
- **Loops** are detected by re-running the topological sort and surfacing back-edges.
- **No ASCII art.** No Graphviz. No SVG. Pipes cleanly to `less` / `grep`.

#### 3.2.2 Node-zoom mode (`apparat pipeline explain <pipeline> <nodeId>`)

When the second positional arg is present, `pipeline explain` switches from topology view to a single-node prompt skeleton render. Behaviour:

1. Resolve the pipeline via `loadPipeline(<pipeline>, { project })` (`src/cli/commands/pipeline-invocation.ts:33`). Reuse its diagnostics path so a structurally-broken pipeline prints the same `file:line:col` errors as `pipeline validate`.
2. Look up `nodeId` in `loaded.graph.nodes`. If missing, print `node "<id>" not found in <pipeline>; available: <comma-separated list>` and exit 1.
3. Reject non-agent nodes: `node "<id>" is kind=<gate|tool|...>; explain <node> only renders agent nodes`. Topology view (no node arg) covers gate / tool / start / exit nodes; node-zoom is the agent-prompt view.
4. Build a synthetic `PipelineContext.values` (`Record<string, unknown>`) populated from **placeholders** only. The rendering goes through the runtime's `renderInputsBlock` (`src/attractor/transforms/inputs-renderer.ts:30-37`), so the *tag* shape is identical to runtime — the only difference is the *value* substituted inside the tag:
   - For each declared input on the agent, call `resolveInputDecl(decl)` (`src/attractor/transforms/inputs-resolver.ts:18-54`) and stash the literal string `<placeholder:${decl}>` at `r.lookupKey`. The renderer wraps that value in `<${r.renderedTag}>...</${r.renderedTag}>` exactly as it does at runtime — a qualified `verifier.summary` declaration produces `<verifier_summary><placeholder:verifier.summary></verifier_summary>`; a bare `illumination_path` produces `<illumination_path><placeholder:illumination_path></illumination_path>`. Output is byte-identical to runtime save for the substituted value.
   - Layer agent-frontmatter `default_*` values from `extractDefaults` (`src/attractor/handlers/agent-prep.ts:80`) on top — when an agent declares a real default, render the real default rather than the placeholder.
5. Build a synthetic `HandlerExecutionContext` (`meta`): `dotDir = dirname(absPath)`, `cwd = projectRoot`, `projectDir = projectRoot`, `completedNodes = []`, `nodeRetries = 0`, `logsRoot = "/dev/null"`. The preamble at `agent-prep.ts:88-92` references these; `fidelity = "compact"` matches today's default. `logsRoot` is never written because the pure builder does not write.
6. Call `buildAgentPrompt(node, ctx, meta, load)` with the same `load` callback the runtime uses (resolves agent `.md` from `meta.dotDir`).
7. On `{ fail }`, print the message to stderr and exit 1.
8. On success, print `built.prompt` to stdout. Exit 0.

Stdout on the success branch is **only** the rendered prompt — no banner, no run-dir path, no validation summary. Diagnostics from step 1 (warnings) print to stderr; errors short-circuit to exit 1 before render.

**No `--var` flag** (refinement-locked). No env-var substitution, no `$project` resolution, no JSON parsing, no node-output references. Authors who want runtime-accurate substitution do an actual `pipeline run` — that is what the runtime is for.

### 3.3 Pure-core extraction

The current `assembleAgentPrompt` at `src/attractor/handlers/agent-prep.ts:37-102` does five things:

1. Resolves the agent config via `load(agentName, meta.dotDir)` (lines 50-54).
2. Applies `node.llmModel` override + dev-mode tsx swap (lines 56-66).
3. Computes `agentVariables`, `inputsBlock`, `steeringBlock`, `assembledPrompt`, preamble, and `jsonWrappedPrompt` (lines 68-96). This block is **pure**: no I/O beyond `load`, no closures over external state.
4. `mkdirSync(nodeDir, { recursive: true })` at line 76, `writeFileSync(join(nodeDir, "prompt.md"), prompt)` at line 97.
5. `create({ ...config, prompt, ... })` to instantiate an `Agent` (line 99).

Steps 1-3 are the core. The split:

```ts
// src/attractor/handlers/agent-prep.ts (post-split sketch)

export interface BuiltPrompt {
  prompt: string;        // exact bytes that go to the LLM
  inputsBlock: string;   // the auto-injected ## Inputs section
  jsonSchema: string | undefined;
  agentVariables: Record<string, unknown>;
  config: AgentConfig;   // post llmModel override, post dev-mode tsx swap
  nodeDir: string;       // path the runtime would mkdir+write into (NOT created here)
}

/** Pure (modulo `load`, which reads the agent .md from disk). */
export function buildAgentPrompt(
  node: Node,
  ctx: PipelineContext,
  meta: HandlerExecutionContext,
  load: (name: string, pipelineDir: string) => AgentConfig,
): BuiltPrompt | { fail: string } { /* steps 1–3, no IO except `load`, no Agent */ }

/** Runtime wrapper — preserves today's signature exactly. */
export function assembleAgentPrompt(
  node: Node,
  ctx: PipelineContext,
  meta: HandlerExecutionContext,
  load: (name: string, pipelineDir: string) => AgentConfig,
  create: (config: AgentConfig) => Agent,
): PreparedAgent | { fail: string } {
  const built = buildAgentPrompt(node, ctx, meta, load);
  if ("fail" in built) return built;
  mkdirSync(built.nodeDir, { recursive: true });
  writeFileSync(join(built.nodeDir, "prompt.md"), built.prompt);
  const agent = create({
    ...built.config,
    prompt: built.prompt,
    ...(built.jsonSchema ? { jsonSchema: built.jsonSchema } : {}),
  });
  return {
    agent,
    config: built.config,
    jsonSchema: built.jsonSchema,
    agentVariables: built.agentVariables,
    prompt: built.prompt,
    nodeDir: built.nodeDir,
  };
}
```

`PreparedAgent` (`src/attractor/handlers/agent-prep.ts:28-35`) is unchanged. Both existing call sites (`looping-agent-handler.ts:27`, `interactive-agent-handler.ts:26`) compile unchanged. The dev-mode tsx swap (`agent-prep.ts:61-66`) stays inside `buildAgentPrompt` so the explain output matches what the runtime would assemble byte-for-byte.

`buildAgentPrompt` still calls `load(agentName, meta.dotDir)` — that is technically I/O, but it is the I/O the *caller* injects via the `load` callback. For `pipeline explain` we pass the same loader the runtime uses, so the rendered prompt is byte-identical to what the runtime would produce given the same `ctx.values`. The only I/O removed from `buildAgentPrompt` is the `mkdirSync` + `writeFileSync` for `prompt.md`.

### 3.4 `pipeline trace --node-receive` one-line addition

The `--node-receive` branch lives in `src/cli/commands/pipeline/trace.ts:31-83`. Insert three lines after the `received:` log at `:51`, before the `context snapshot` log at `:52` (which carries the leading `\n`):

```ts
console.log(`\nnode:     ${event.nodeId}`);          // :49
console.log(`kind:     ${event.nodeKind}`);           // :50
console.log(`received: ${event.timestamp}`);          // :51
+ const promptPath = join(runDir(project, runId), String(event.nodeId), "prompt.md");
+ if (existsSync(promptPath)) {
+   console.log(`prompt:   ${promptPath}`);
+ }
console.log(`\ncontext snapshot (${keys.length} key${keys.length === 1 ? "" : "s"}):`);  // :52
```

The `\n` stays on the existing `context snapshot` line so the prompt line, when emitted, reads tightly under `received:`. The `existsSync` check guards the rare case where the runtime crashed before `writeFileSync(prompt.md)` ran (`agent-prep.ts:97`); when the file is absent, trace stays silent on the prompt line rather than printing a dangling path. Implementation note: `existsSync` is already imported at `src/cli/commands/pipeline/trace.ts:1`; `runDir` is already imported at `:3`; `join` is already imported at `:2`. The change is purely additive — three lines, zero new imports.

### 3.5 Documentation: `<renderedTag>` contract in `pipelines.md`

The `<sourceNode>_<localKey>` mangling rule lives only in code today (`src/attractor/transforms/inputs-resolver.ts:41`). Per ADR-0011 (skill-as-shim-plus-live-reference, `docs/adr/0011-*.md`), `src/cli/skills/apparatus/pipelines.md` is the live authoring reference; the rule belongs there. The current `pipelines.md` is 496 lines with zero matches for `renderedTag` / `<rendered` / `underscored tag`.

**Where it goes:** §3 (agent nodes), near lines 45-60, between the `Schema — pipeline.dot attrs` table and the `Schema — sibling <name>.md frontmatter` table (or immediately after the latter — the implementing session picks the smoother fit). One paragraph + one short example. Sketch:

```markdown
### Auto-injected `## Inputs` block

When an agent runs, the engine prepends a `## Inputs` section to the prompt
that wraps each declared input in an XML-style tag. The tag name uses
`<sourceNode>_<localKey>` for qualified inputs (the dot is replaced by an
underscore) and `<bareKey>` for caller-graph inputs and system-injected vars.

Example: an agent declaring `inputs: [verifier.summary, illumination_path]`
receives:

  <verifier_summary>...the value...</verifier_summary>
  <illumination_path>...the value...</illumination_path>

Use `apparat pipeline explain <pipeline> <nodeId>` to render the exact
skeleton with placeholder values without running the LLM.
```

That paragraph closes the doc-drift surface called out in the verifier evidence (`pipelines.md` 496 lines, zero matches for `renderedTag`/`<rendered`/`underscored tag`).

### 3.6 ADR-0011 SKILL.md shim

`src/cli/skills/apparatus/SKILL.md` lists the pipeline subcommand surface. The implementing session should add **one row** for `pipeline explain` next to the existing five. Per ADR-0011 (`docs/adr/0011-*.md`), the shim regenerates from a script when the live reference changes — confirm the regeneration script's current state in the implementing PR; hand-edit only if regeneration is not currently wired.

### 3.7 README ripple

`README.md` lines 60-100 (the commands section) currently lists `pipeline run / validate / list / trace`. Add **one entry** for `pipeline explain` in the same list, with its `<pipeline> [nodeId]` shape mirroring the help output.

### 3.8 Files-touched buckets

| Bucket | Files | Treatment |
|---|---|---|
| Pure-core extract | `src/attractor/handlers/agent-prep.ts` | Edited — split into `buildAgentPrompt` (pure) + `assembleAgentPrompt` (wrapper); five-arg signature preserved |
| Explain command | `src/cli/commands/pipeline/explain.ts` | **New** — implements both topology and node-zoom modes per §3.2 |
| Trace edit | `src/cli/commands/pipeline/trace.ts` | Inline edit — three lines added inside `--node-receive` branch (between `:51` and `:52`) |
| CLI registration | `src/cli/program.ts` | Inline edit — register `pipeline.command("explain <pipeline> [nodeId]")` after the existing `show` registration at `:186-203` |
| Doc — pipelines.md | `src/cli/skills/apparatus/pipelines.md` | Inline edit — one paragraph in §3 (agent nodes) per §3.5 |
| Doc — SKILL.md shim | `src/cli/skills/apparatus/SKILL.md` | Edit (or regen) — one new row in the command table |
| Doc — README | `README.md` | Inline edit — one new entry in the pipeline command list |
| Tests — new | `src/cli/tests/pipeline-explain.test.ts` | **New** — covers topology output for a small fixture, gate branches, loops, reachability, node-zoom skeleton, missing-node, non-agent rejection, FORCE_COLOR=0 plain text |
| Tests — extend | `src/attractor/tests/agent-prep.test.ts` | Edit — add `buildAgentPrompt` cases asserting no `prompt.md` is written; existing `assembleAgentPrompt` cases stay |

Total files: 9 (2 new, 7 edited). Surfaces: engine (1), CLI (3 — explain registration, explain command, trace), docs (3), tests (2). This matches the verifier's blast-radius envelope (~6 source files + new test + extended test = 8-9 files; verifier called ~6 source files plus the test ripple).

## 4. Components & key edits

### 4.1 `src/attractor/handlers/agent-prep.ts` (edited)

See §3.3. Two functions exported instead of one. The `buildAgentPrompt` body is the existing `agent-prep.ts:44-99` minus the `mkdirSync` + `writeFileSync` (lines 76, 97) and minus the `create()` call (line 99); the wrapper handles those. `nodeDir` is computed inside `buildAgentPrompt` (today at `agent-prep.ts:75`) but the directory is **not** created — only the path string is returned. The runtime wrapper performs the `mkdirSync` immediately before the write. `pipeline explain` ignores `nodeDir` (never writes anything).

`SYSTEM_INJECTED_VARS` (`src/attractor/handlers/agent-prep.ts:16-19`) stays exported as today; the explain path passes the same `meta.projectDir` to it via the synthetic context.

### 4.2 `src/cli/commands/pipeline/explain.ts` (new)

Single command, two modes. Skeleton:

```ts
import { resolve, dirname, join } from "path";
import { loadPipeline } from "../pipeline-invocation.js";
import { buildAgentPrompt } from "../../../attractor/handlers/agent-prep.js";
import { computeVarsInScope, computeVarsInAnyScope } from "../../../attractor/core/flow-analyzer.js";
import { resolveInputDecl } from "../../../attractor/transforms/inputs-resolver.js";
import { loadAgent } from "../../lib/agent-loader.js";
import * as output from "../../lib/output.js";

export interface PipelineExplainOptions { project?: string; }

export async function pipelineExplainCommand(
  pipelineArg: string,
  nodeId: string | undefined,
  opts: PipelineExplainOptions,
): Promise<number> {
  const projectRoot = resolve(opts.project ?? process.cwd());
  const loaded = await loadPipeline(pipelineArg, { project: projectRoot });

  // Errors short-circuit the same way as `pipeline validate`.
  const errors = loaded.diagnostics.filter(d => d.severity === "error");
  if (errors.length > 0) {
    for (const d of errors) await output.error(formatDiagnostic(d));
    return 1;
  }

  if (nodeId === undefined) {
    return renderTopology(loaded);   // §3.2.1
  }
  return renderNodeZoom(loaded, nodeId, projectRoot);  // §3.2.2
}
```

Both renderers reuse `loaded.graph` and the existing parsed agent metadata. ~150-220 LOC total (topology renderer ~100, node-zoom renderer ~80).

### 4.3 `src/cli/program.ts` (edited)

One new `pipeline.command(...)` registration adjacent to the existing five at `src/cli/program.ts:107-203`. Pattern follows the `show` registration at `:186-203`:

```ts
pipeline
  .command("explain <pipeline> [nodeId]")
  .description("Plain-text walkthrough of a pipeline's topology, or render a node's prompt skeleton")
  .addHelpText("after", `
Examples:
  apparat pipeline explain illumination-to-implementation             # topology walkthrough
  apparat pipeline explain illumination-to-implementation verifier    # render verifier's prompt skeleton

Bare invocation prints node-by-node consumes/produces/branches, plus Loops and
Reachability sections. With a node id, prints the rendered prompt skeleton with
placeholder values — no LLM invoked, no run dir created.
`)
  .option("--project <folder>", "Project folder (defaults to cwd)")
  .action(async (pipelineArg: string, nodeId: string | undefined, opts: { project?: string }) => {
    const code = await pipelineExplainCommand(pipelineArg, nodeId, opts);
    process.exit(code);
  });
```

### 4.4 `src/cli/commands/pipeline/trace.ts` (edited)

See §3.4 — three additive lines guarded by `existsSync`, no new imports.

### 4.5 `src/cli/skills/apparatus/pipelines.md` (edited)

See §3.5 — one new paragraph in §3 (agent nodes), near lines 45-60.

## 5. Data flow

### 5.1 `pipeline explain <p>` — topology mode

```
apparat pipeline explain workflow --project my-app
  → src/cli/commands/pipeline/explain.ts pipelineExplainCommand
    → loadPipeline(workflow, { project })
        (src/cli/commands/pipeline-invocation.ts:33 — readFileSync, parseDot, validateGraph)
    → walk diagnostics; exit 1 on errors
    → topological walk of loaded.graph.nodes from start
    → per-node: read agent inputs/outputs from frontmatter (already on the loaded graph)
    → computeVarsInScope(graph, nodeProduces) + computeVarsInAnyScope(graph, nodeProduces)
        (src/attractor/core/flow-analyzer.ts:21,36)
    → detect back-edges → Loops section
    → reachability check → Reachability section
    → console.log lines (plain text)
    → exit 0
```

### 5.2 `pipeline explain <p> <nodeId>` — node-zoom mode

```
apparat pipeline explain workflow verifier --project my-app
  → src/cli/commands/pipeline/explain.ts pipelineExplainCommand
    → loadPipeline(workflow, { project })
    → graph.nodes.get(nodeId); exit 1 if missing or non-agent
    → for each declared input on the agent:
        resolveInputDecl(decl) (src/attractor/transforms/inputs-resolver.ts:18-54)
        ctx.values[r.lookupKey] = "<placeholder:" + decl + ">"
      layer agent-frontmatter default_* on top via extractDefaults
        (src/attractor/handlers/agent-prep.ts:80)
    → buildAgentPrompt(node, { values: ctx.values }, syntheticMeta, loadAgent)
        (src/attractor/handlers/agent-prep.ts — pure core, no IO except agent .md read)
    → process.stdout.write(built.prompt) → exit 0
```

No daemon RPC. No `mkdirSync`. No `writeFileSync`. No `Agent` instance. No LLM.

### 5.3 `pipeline trace --node-receive <id>`

```
apparat pipeline trace <runId> --node-receive <id>
  → existing path (src/cli/commands/pipeline/trace.ts:6-83)
  → after console.log("received: ...") at :51:
      promptPath = join(runDir(project, runId), nodeId, "prompt.md")
      if (existsSync(promptPath)) console.log(`prompt:   ${promptPath}`)
  → existing context-snapshot, validation-attempts, completed-stages output (lines 52-82)
```

## 6. Blast radius / impact surface

- **Size:** **S/M.** Verifier refined-scope pass: S/M (smaller than the prior pass's M after dropping `preview`/`--var`/`.last-rendered/`). Explainer Tier-2 §Blast radius: S/M. Same envelope.
  - **Files touched:** ~9 — 2 new (`pipeline-explain.test.ts`, `explain.ts`) + 7 edited (`agent-prep.ts`, `trace.ts`, `program.ts`, `pipelines.md`, `SKILL.md`, `README.md`, `agent-prep.test.ts`).
  - **Surfaces crossed:** CLI (`pipeline explain` registration + new command file + trace one-liner = 3 sub-surfaces), engine (`agent-prep.ts` seam split = 1), docs (`pipelines.md`, `SKILL.md`, `README.md` = 3), tests (`pipeline-explain.test.ts`, `agent-prep.test.ts` = 2). No daemon IPC, no `.dot` schema change, no agent rubric change.
- **Breaking changes:** **none.**
  - `assembleAgentPrompt` exported signature (`src/attractor/handlers/agent-prep.ts:37-42`) preserved; `PreparedAgent` shape preserved. The two existing call sites (`looping-agent-handler.ts:27`, `interactive-agent-handler.ts:26`) and the existing `agent-prep.test.ts` (102 lines) compile unchanged.
  - `pipeline explain` is an additive subcommand — no existing CLI invocation changes shape.
  - `pipeline trace --node-receive` gains a single human-only `console.log` line; the structured `pipeline.jsonl` shape is untouched, so any tooling reading the JSONL is unaffected. The text shape is not part of any documented contract today.
- **Spec / docs ripple checklist:**
  - [ ] `src/cli/skills/apparatus/pipelines.md` §3 (agent nodes), near lines 45-60 — one paragraph documenting the `<renderedTag>` rule per §3.5. Live authoring reference per ADR-0011.
  - [ ] `src/cli/skills/apparatus/SKILL.md` command table — one new row for `pipeline explain` (or regenerate from script per ADR-0011).
  - [ ] `README.md` lines 60-100 commands section — one new entry for `pipeline explain <pipeline> [nodeId]`.
  - [ ] **No new ADR.** ADR-0001 (`docs/adr/0001-agents-live-next-to-pipeline.md:23-26`) is reinforced (single-tier agent registry remains). ADR-0011 (skill-as-shim-plus-live-reference) is applied (rule documented in pipelines.md, not in source comments). Neither needs editing.
  - [ ] **No CONTEXT.md change.** CONTEXT.md is the DDD glossary; the explain command does not introduce a new domain term.
- **Test ripple checklist:**
  - [ ] **New** `src/cli/tests/pipeline-explain.test.ts` (~100-150 lines, mirroring `pipeline-show.test.ts` 107 lines / `pipeline-trace-command-validation.test.ts` 37 lines per the verifier's test-ripple subagent). Cases:
    - Bare invocation on a small fixture (start → agent → exit) prints expected topology.
    - Bare invocation on a fixture with a gate enumerates branches.
    - Bare invocation on a fixture with a back-edge populates the Loops section.
    - Bare invocation on a fixture with an unreachable node populates Branch warnings or Reachability mismatch.
    - Node-zoom on an agent node renders a prompt skeleton containing the agent body + the auto-injected `## Inputs` block with `<placeholder:...>` values.
    - Node-zoom on a missing node id exits 1 with the available-nodes list.
    - Node-zoom on a non-agent node exits 1 with the kind-mismatch message.
    - Output is plain ASCII when `FORCE_COLOR=0` — no ANSI escape codes (per the chalk-level-0 rule established in `2026-04-16-markdown-rendering.md` memory).
  - [ ] **Extend** `src/attractor/tests/agent-prep.test.ts` (currently 102 lines) — add `buildAgentPrompt` cases asserting (a) the same `prompt` field as `assembleAgentPrompt` for the same inputs, (b) no `prompt.md` is written by `buildAgentPrompt`, (c) the existing three `assembleAgentPrompt` call sites stay green.

## 7. Trade-offs

### 7.1 Single command (`explain` with optional nodeId) vs. two commands (`preview` + `explain`)

**Single command** chosen. Reasons (refinement-locked):

- The user's exact ask in chat: "could we simplify commands to get these outputs? I could imagine ... 'apparat pipeline explain illumination-to-implementation' to get a big picture ... 'apparat pipeline explain illumination-to-implementation verifier' that would give the same output what you showed with apparat pipeline preview command." (chat_summarizer round 1, bullet 1.)
- Rationale: one symbol, optional zoom-in, fewer surface concepts to remember. Both modes operate on the same prompt-assembly seam — same `loadPipeline`, same `buildAgentPrompt`, same plain-text-only output policy.
- The prior-spec two-command design (`docs/superpowers/specs/2026-05-07-prompt-assembly-invisible-until-runtime-design.md`) is superseded by this design for the same illumination.

### 7.2 Placeholders only vs. `--var k=v` substitution

**Placeholders only.** Reasons (refinement-locked):

- chat_summarizer round 1 bullet 2: "I'm more interested the prompts and skeleton of node so that for example the exact filenames could be replaced with placeholders."
- chat_summarizer round 1 bullet 3: "No need for this probably. I think placeholders are enough at least for now."
- The author's question is "what shape does my LLM see?", not "what value would it see for this specific input?". Placeholders answer the shape question deterministically without coupling design-time to project state. Authors who want runtime-accurate substitution do an actual `pipeline run`.
- Caps the command's blast radius and keeps the surface immune to `--var` / env-var / `$project` / JSON-parsing semantics drift.

### 7.3 Pure-core extract vs. flag on `assembleAgentPrompt`

**Pure-core extract.** Reasons:

- A "skip the write" boolean on `assembleAgentPrompt` would uglify the runtime contract for a non-runtime concern. Bugs in that branch would be silent (e.g. side-effect leaks).
- Splitting once gives both call sites a clean, identical render. The cost is one wrapper function and zero new branches in either runtime caller. Textbook deep-module move per `stimuli/deep-modules-hide-complexity.md`: one symbol, two adapters.
- Verifier confirmed the wrapper-stable signature keeps `looping-agent-handler.ts:27` and `interactive-agent-handler.ts:26` compiling unchanged.

### 7.4 Plain-text topology vs. graph rendering

**Plain text** — reaffirmed from the prior-spec design and the originating illumination. Reasons:

- Pipes cleanly to `less` / `grep`; no terminal capability assumptions.
- Authors who want a graph already have `pipeline show` (SVG).
- Per-node `consumes:` / `produces:` lines deliver the "what does this pipeline do?" answer faster than scanning a topology graph, especially for pipelines with branches and loops.

### 7.5 Drop `.last-rendered/` mirror

**Dropped.** Reasons (refinement-locked):

- chat_summarizer round 1 bullet 5: "Skip?" — after explanation of the post-run mirror's value vs. cost.
- With node-zoom `explain` covering design-time visibility, the post-run mirror's value is marginal vs. its cost. The lazy-prune evidence-loss failure mode is real but not yet observed; reconsider if it bites in practice.

### 7.6 Sequencing — single PR vs. two-PR split

Refinement leaves this to the implementer. Default: **single PR** (~9 files, no breaking changes — well within review-in-one-pass scope). If the implementer prefers smaller chunks, the natural split is:

- **PR 1:** `buildAgentPrompt` extract + `pipelines.md` `<renderedTag>` paragraph + agent-prep test additions. Ships the seam that `pipeline explain` plugs into; runtime behaviour unchanged.
- **PR 2:** `pipeline explain` + `trace --node-receive` line + CLI registration + new test file + SKILL.md + README.

Either path preserves the no-breaking-change invariant.

## 8. Constraints

After the change:

- `npx tsc --noEmit` passes.
- `npx vitest run` passes — including the new `pipeline-explain.test.ts` and the extended `agent-prep.test.ts`.
- `apparat pipeline explain <pipeline>` writes plain ASCII to stdout; exit 0 for valid pipelines, exit 1 surfacing diagnostics for invalid ones.
- `apparat pipeline explain <pipeline> <nodeId>` writes the rendered prompt skeleton to stdout with no other output on the success path; exit 0.
- `apparat pipeline explain <pipeline> <missing>` exits 1 with a `not found in <pipeline>` message that lists available node ids.
- `apparat pipeline explain <pipeline> <gate-or-tool-id>` exits 1 — node-zoom is agent-only (topology mode covers gates and tools).
- `apparat pipeline trace <runId> --node-receive <id>` prints the existing four-block output plus, when the run dir contains a `prompt.md` for the node, one extra line `prompt:   <runDir>/<nodeId>/prompt.md`. When the file is absent, the line is omitted (no error, no dangling path).
- `apparat pipeline run <pipeline>` byte-identical behaviour to today (no explain-related changes leak into runtime output).

Repo-wide grep invariants (post-merge):

- `grep -n "buildAgentPrompt\b" src/attractor/handlers/agent-prep.ts` — present.
- `grep -n "assembleAgentPrompt\b" src/attractor/handlers/agent-prep.ts` — still present.
- `grep -nR "import.*assembleAgentPrompt" src` — exactly two source importers (`looping-agent-handler.ts`, `interactive-agent-handler.ts`) plus existing test file; no new importers.
- `grep -nR "import.*buildAgentPrompt" src` — at least two importers (`pipeline/explain.ts`, `tests/agent-prep.test.ts`).
- `grep -n "pipeline.command" src/cli/program.ts` — six matches (existing five + explain).
- `grep -nR "renderedTag\|<sourceNode>_<localKey>" src/cli/skills/apparatus/pipelines.md` — at least one match (the new §3 paragraph).

Behaviour invariants:

- No `mkdirSync` or `writeFileSync` is reachable from `pipelineExplainCommand` (any mode).
- `pipeline explain` issues zero socket calls (no daemon RPC, no LLM API call) in either mode.
- The two existing `assembleAgentPrompt` call sites' line numbers do not move under `git blame`.

## 9. Open questions

- **Phase grouping vs. topological grouping in topology view.** Phase comments (when present in the `.dot` source) are richer; topological is the universal fallback. Implementer decides at code-time based on `.dot` parser availability. Both branches produce a correct walkthrough; the choice affects readability, not correctness.
- **`buildAgentPrompt` location of the `BuiltPrompt` interface.** Either inline in `agent-prep.ts` (as sketched in §3.3) or moved to a shared types file. Default: inline; the interface has only one consumer outside `agent-prep.ts` (the `explain` command). Move only if a third consumer appears.
- **`SKILL.md` regeneration vs. hand-edit.** Per ADR-0011, the shim regenerates from a script when the live reference changes. Confirm the regeneration script's current state in the implementing PR; hand-edit the row only if regeneration is not currently wired.

## 10. Verification approach

### 10.1 Static checks

- `npx tsc --noEmit` — clean.
- Grep `buildAgentPrompt\b` in `src/attractor/handlers/agent-prep.ts` — present.
- Grep `pipeline.command\("explain"\)` (or the `<pipeline> [nodeId]` registration) in `src/cli/program.ts` — exactly one hit.
- Grep `renderedTag` or `<sourceNode>_<localKey>` in `src/cli/skills/apparatus/pipelines.md` — at least one hit.
- Grep `pipeline explain` in `README.md` — at least one hit (the new commands-section entry).

### 10.2 Tests

- `npx vitest run src/cli/tests/pipeline-explain.test.ts` — new, passes.
- `npx vitest run src/attractor/tests/agent-prep.test.ts` — passes after `buildAgentPrompt` cases land; existing `assembleAgentPrompt` cases still green.
- Full `npx vitest run` — passes.

### 10.3 Smoke

- `apparat pipeline explain illumination-to-implementation --project .` — prints a plain-text topology walkthrough. Includes `Loops:` section (the illumination-to-implementation pipeline contains a retry loop). Exit 0.
- `apparat pipeline explain illumination-to-implementation verifier --project .` — prints the verifier's prompt skeleton. The rendered text contains a `## Inputs` section whose tags use the runtime's `<renderedTag>` shape (e.g. `<illumination_path>...</illumination_path>` for a bare input, `<verifier_summary>...</verifier_summary>` for a qualified `verifier.summary` if declared) and whose substituted values contain the literal substring `<placeholder:` so author tooling can grep for the placeholder marker. No run dir created under `.apparat/runs/`. No LLM invoked (verify by network silence + clock).
- `apparat pipeline run <small-pipeline> --project .` then `apparat pipeline trace <runId> --node-receive <nodeId>` — the trace output now contains a `prompt:   <path>` line whose path resolves to a real file.
- `apparat pipeline trace <runId> --node-receive <nodeId>` against an old run whose `prompt.md` was lazily pruned — the `prompt:` line is **omitted**, no error, exit 0.

### 10.4 Negative cases

- `pipeline explain <pipeline> <gateId>` — exits 1 with kind-mismatch message; node-zoom is agent-only.
- `pipeline explain <pipeline> <toolId>` — exits 1 with kind-mismatch message.
- `pipeline explain <pipeline-with-validation-errors>` — exits 1, prints `file:line:col` diagnostics; no walkthrough, no skeleton.
- `pipeline explain <pipeline-with-validation-errors> <nodeId>` — same; errors short-circuit before mode dispatch.
- `pipeline trace <runId> --node-receive <id>` against a run dir where the node never started — existing "No node-start event found" path (`trace.ts:35-38`) wins; new `prompt:` line is never reached.

## 11. Summary

`assembleAgentPrompt` at `src/attractor/handlers/agent-prep.ts:37-42` is the deterministic, single-source-of-truth builder for what every agent's LLM sees, but apparat exposes zero design-time surface for it: an author's only path to "what will my LLM read?" is to launch a real run and dig into a gitignored, lazily-pruned `<project>/.apparat/runs/<runId>/<nodeId>/prompt.md` written at `agent-prep.ts:97`. The tag-mangling rule (`<sourceNode>_<localKey>` from `src/attractor/transforms/inputs-resolver.ts:41` wrapping values via `src/attractor/transforms/inputs-renderer.ts:30-37`) is invisible to authors and undocumented in `src/cli/skills/apparatus/pipelines.md` (496 lines, zero matches for `renderedTag`/`<rendered`/`underscored tag`). `pipeline trace --node-receive` (`src/cli/commands/pipeline/trace.ts:49-83`) prints node id, kind, timestamp, context snapshot, validation attempts, and completed stages — but never the prompt path, even though it sits at a sibling. This design ships four additive items on the same prompt-assembly seam: (1) a pure-core `buildAgentPrompt` extract that preserves `assembleAgentPrompt`'s five-arg signature so both existing call sites at `looping-agent-handler.ts:27` and `interactive-agent-handler.ts:26` and the existing `agent-prep.test.ts` cases compile unchanged; (2) **single** `apparat pipeline explain <pipeline> [nodeId]` subcommand — bare invocation prints a plain-text topology walkthrough (per-node `consumes:` / `produces:` / `branches:` / `next:` plus Loops + Reachability sections, reusing `computeVarsInScope` and `computeVarsInAnyScope` at `src/attractor/core/flow-analyzer.ts:21,36`), node-zoom invocation prints the rendered prompt skeleton with placeholder values (no `--var` flag, no real-value substitution); (3) one new line `prompt:   <runDir>/<nodeId>/prompt.md` inside `trace.ts` after `received:`; (4) document the `<renderedTag>` rule in `pipelines.md` §3 (agent nodes) plus one row in the ADR-0011 `SKILL.md` shim and one entry in `README.md`. Per chat refinement (round 1), the prior-spec separate `pipeline preview` command, the `--var k=v` flag, and the `<pipeline-dir>/.last-rendered/<nodeId>.md` mirror are all out of scope. Blast radius is **S/M** — ~9 files (2 new, 7 edited), no breaking changes. `assembleAgentPrompt` signature preserved; `pipeline explain` is additive; `pipeline trace --node-receive` gains exactly one human-only `console.log` line. Open questions deferred to implementation: phase-vs-topological grouping in topology view, `BuiltPrompt` interface location, and `SKILL.md` regeneration vs. hand-edit. Sequencing (single PR vs. seam-first two-PR split) is the implementer's call; default single PR.
