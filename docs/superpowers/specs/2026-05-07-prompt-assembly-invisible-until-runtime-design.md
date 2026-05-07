# Design: `pipeline preview` + `pipeline explain` — design-time visibility into prompt assembly

**Date:** 2026-05-07
**Status:** draft (pending review)
**Originating illumination:** `.apparat/meditations/illuminations/2026-05-07T2008-prompt-assembly-invisible-until-runtime.md`

## 1. Motivation

Today, the deepest module in the engine — prompt assembly — has the shallowest seam to the human author.

`assembleAgentPrompt()` at `src/attractor/handlers/agent-prep.ts:37` is the single source of truth for what the LLM sees: it composes preamble + agent body + auto-injected `## Inputs` block + steering, then writes the result to `<runDir>/<nodeId>/prompt.md` at `agent-prep.ts:97`. The function is deterministic and side-effect-free except for that one `writeFileSync` plus a sibling `mkdirSync` at `agent-prep.ts:75-76`. It runs identically inside both `LoopingAgentHandler` (`src/attractor/handlers/looping-agent-handler.ts:27`) and `InteractiveAgentHandler` (`src/attractor/handlers/interactive-agent-handler.ts:26`), and is exercised by `src/attractor/tests/agent-prep.test.ts:44,71,92`. There are exactly three importers and five call sites — a tight surface.

Yet apparat exposes **zero design-time surface** for it. An author writes a `.md` agent file with `inputs:` and `outputs:` frontmatter, and to discover what the agent will actually receive they must:

1. Run the pipeline against a real project (spawning a real LLM).
2. Locate `<project>/.apparat/runs/<runId>/<nodeId>/prompt.md` — gitignored, and lazily pruned (last 50 runs, override via `APPARAT_RUNS_KEEP`).
3. Read that file by hand.

Three concrete consequences:

- **The tag-mangling rule is invisible.** `inputs-renderer.ts:30-37` wraps each input value in `<${r.renderedTag}>...</${r.renderedTag}>`, where `renderedTag` is built at `inputs-resolver.ts:41` as `` `${sourceNode}_${localKey}` `` for qualified inputs. An author who writes `inputs: [verifier.summary]` in the `.dot` source ships an LLM prompt containing `<verifier_summary>...</verifier_summary>` — an underscore replaces the dot. That contract is not documented in `src/cli/skills/apparatus/pipelines.md` (496 lines; no `<sourceNode>_<localKey>` mention).
- **`pipeline trace --node-receive` lies by omission.** It prints `nodeId / kind / received / context snapshot / completed stages` (`src/cli/commands/pipeline/trace.ts:49-66`) but never the rendered prompt — even though the prompt sits at a sibling path under the same run dir.
- **The author cannot answer "what does this pipeline do?" without staring at a graph.** `pipeline show` produces an SVG; that's a graph stare, not a walkthrough. `flow-analyzer.ts:21,36` already computes `computeVarsInScope` / `computeVarsInAnyScope` per-node — the data needed for a plain-English topology walk is sitting in the engine, unrendered.

Strategic compass: VISION.md frames pipelines as *delegating to someone who already understands the shape of the problem*. Today the author building that delegate is themselves blind — they cannot read the briefing their delegate will receive without launching the delegate. Two prior illuminations addressed the **outer** harness (mission-control fragmentation, authoring-loop coldness). This design addresses the **inner** opacity: a print-preview surface for prompt assembly itself.

## 2. Decision Summary

The chat refinement narrowed the illumination's seven steps to **steps 1, 2, 3, 4, 6** — explicitly dropping step 5 (`.last-rendered/` mirror) and deferring step 7 (`pipeline watch` integration). This design implements only those five.

1. **Pure-core extraction.** Split `assembleAgentPrompt` into a side-effect-free `buildAgentPrompt(node, ctx, meta, load, create) → PreparedAgent | { fail }` core plus a thin runtime wrapper that adds the `mkdirSync`+`writeFileSync` write and the `Agent` instantiation. The existing `assembleAgentPrompt` symbol stays exported, with the same five-arg signature, so all five existing call sites compile unchanged. This is the linchpin: runtime and `pipeline preview` share one builder.

2. **`apparat pipeline preview <pipeline> --node <id> [--var k=v]`.** New file `src/cli/commands/pipeline/preview.ts`. Loads the pipeline with `loadPipeline()` from `src/cli/commands/pipeline-invocation.ts:33`, picks the named node, synthesises `ctx.values` from `--var` flags + agent-frontmatter `defaults`, calls the pure builder, prints the rendered prompt to stdout. **No** LLM invoked, **no** run dir created, **no** Agent instance constructed. Headline feature.

3. **`apparat pipeline explain <pipeline>`.** New file `src/cli/commands/pipeline/explain.ts`. Walks the topology and prints a plain-text node list with `consumes:` / `produces:` / `branches:` / `next:` per node, plus separate **Loops** and **Reachability** sections. Reuses `computeVarsInScope` and `computeVarsInAnyScope` from `src/attractor/core/flow-analyzer.ts:21,36`. **No ASCII art, no Graphviz, no SVG** — runs in any terminal, pipes to `less` / `grep`.

4. **Three lines added to `pipeline trace --node-receive`.** Inside `trace.ts:49-66`, after the context snapshot, print one line: `prompt: <runDir>/<nodeId>/prompt.md`. Closes the gap between "node started with these keys" and "and here is the literal text it received."

5. **Document the `<inputs>` rendering contract** in `src/cli/skills/apparatus/pipelines.md` — a new dedicated section *plus* an inputs-block subsection inside §3 (agent nodes). Update the ADR-0011 `SKILL.md` shim (`src/cli/skills/apparatus/SKILL.md:17-21`) command table to add rows for `pipeline preview` and `pipeline explain`.

**Out of scope (locked by chat refinements):**

- `.last-rendered/` per-pipeline mirror (step 5). Defer until evidence loss is observed in practice; `cp -r .apparat/runs/<id>/` is an adequate manual workaround.
- `pipeline watch` integration (step 7). Defer to the authoring-loop illumination.
- `--var` env-var resolution, `$project` substitution, full `pipeline run` semantics. Literal substitution + agent-frontmatter `defaults` only.
- New `--show-schema` flag on `pipeline preview` (open question, deferred to implementation time).
- Phase-vs-topological grouping decision in `pipeline explain` (open question, deferred to implementation time based on `.dot` parser availability).

## 3. Architecture

### 3.1 Before / after diagram

```
Before                                          After
──────                                          ─────
edit agent.md ─┐                                edit agent.md ─┐
               ▼                                                ▼
         (no preview)                            apparat pipeline preview <p> --node <id>
               │                                                │  (pure, <3s, no LLM)
               ▼                                                │
   apparat pipeline run <p>  ◄── only path       (optional)     ▼
   (spawns LLM, writes runs/<id>/<n>/prompt.md)  apparat pipeline run <p>
               │                                                │
               ▼                                                ▼
   dig into .apparat/runs/<runId>/<nodeId>/      apparat pipeline trace <runId> --node-receive <id>
   prompt.md (gitignored, lazily pruned)         …prints "prompt: <runDir>/<nodeId>/prompt.md"

Before:                                         After:
  pipeline command set =                          pipeline command set =
    run, validate, list, trace, show                run, validate, list, trace, show,
                                                    preview, explain
  prompt-assembly seam =                          prompt-assembly seam =
    assembleAgentPrompt (single impl,               buildAgentPrompt (pure core)
    runtime-only, writes prompt.md)               + assembleAgentPrompt (runtime wrapper,
                                                    same signature, writes prompt.md)
```

### 3.2 Pure-core extraction

The current `assembleAgentPrompt` at `src/attractor/handlers/agent-prep.ts:37-102` does five things:

1. Resolves the agent config via `load(agentName, meta.dotDir)` (lines 50-54).
2. Applies model override + dev-mode tsx swap (lines 56-66).
3. Computes `agentVariables`, `inputsBlock`, `steeringBlock`, `assembledPrompt`, preamble, and `jsonWrappedPrompt` (lines 68-95). This block is **pure**: no I/O, no closures over external state.
4. `mkdirSync(nodeDir, ...)` + `writeFileSync(join(nodeDir, "prompt.md"), prompt)` (lines 75-76, 97).
5. Calls `create({ ...config, prompt, ... })` to instantiate an `Agent` (line 99).

Step 3 is the core. The split:

```ts
// src/attractor/handlers/agent-prep.ts (post-split sketch)

export interface BuiltPrompt {
  prompt: string;        // exact bytes that go to the LLM
  inputsBlock: string;   // the auto-injected ## Inputs section
  jsonSchema: string | undefined;
  agentVariables: Record<string, unknown>;
  config: AgentConfig;   // post model-override, post dev-mode tsx swap
  nodeDir: string;       // path the runtime would mkdir+write into
}

/** Pure (modulo `load`, which reads the agent .md from disk). */
export function buildAgentPrompt(
  node: Node,
  ctx: PipelineContext,
  meta: HandlerExecutionContext,
  load: (name: string, pipelineDir: string) => AgentConfig,
): BuiltPrompt | { fail: string } { /* steps 1–3, no IO, no Agent */ }

/** Runtime wrapper — preserves today's signature. */
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

`PreparedAgent` (defined at `agent-prep.ts:28-35`) is unchanged. The five existing call sites — `looping-agent-handler.ts:27`, `interactive-agent-handler.ts:26`, `agent-prep.test.ts:44,71,92` — compile unchanged.

`buildAgentPrompt` still calls `load(agentName, meta.dotDir)` to read the agent `.md`. That is technically I/O, but it is the I/O the *caller* injects via the `load` callback; for `pipeline preview` we pass the same loader the runtime uses, so behaviour is identical. The only IO removed from `buildAgentPrompt` is the `mkdirSync` + `writeFileSync` for `prompt.md`. The dev-mode tsx swap at `agent-prep.ts:61-66` stays inside `buildAgentPrompt` — `pipeline preview` should preview exactly what the runtime would assemble, including the dev-mode swap, so the rendered preamble + Inputs section + steering match byte-for-byte.

### 3.3 `pipeline preview` command

```
apparat pipeline preview <pipeline> --node <nodeId> [--var k=v ...]
                                    [--project <folder>]
```

Behaviour:

1. Resolve the pipeline via `loadPipeline(<pipeline>, { project })` from `src/cli/commands/pipeline-invocation.ts:33`. `loadPipeline` already accepts name shorthand or absolute path and surfaces validation diagnostics; we reuse its diagnostics path so `preview` of a structurally-broken pipeline prints the same `file:line:col` errors as `pipeline validate`.
2. Look up the named node in `loaded.graph.nodes`. If missing, print `node "<id>" not found in <pipeline>; available: <comma-separated list>` and exit 1.
3. Build a synthetic `PipelineContext.values` (`Record<string, unknown>`):
   - Start with `{}` (no system-injected vars, no upstream node outputs).
   - Add caller-input declarations from `loaded.graph.inputs` — set each to `"<placeholder>"` if no `--var` provides one. (The author can override with `--var <name>=...`.)
   - Add agent-frontmatter `defaults` (literal values from the agent's `.md` frontmatter — `extractDefaults` at `agent-prep.ts:80` reads `default_<key>` from the node attrs; the preview path uses node attrs already produced by `parseDot`).
   - Layer `--var k=v` flags on top (literal string values, no env-var expansion, no `$project` resolution).
4. Build a synthetic `HandlerExecutionContext` (`meta`): set `dotDir = dirname(absPath)`, `logsRoot = "/dev/null"` (never used because we call `buildAgentPrompt`, not the wrapper), `cwd = projectRoot`, `projectDir = projectRoot`, `completedNodes = []`, `nodeRetries = 0`. The preamble path at `agent-prep.ts:88-92` references these; `fidelity = "compact"` matches today's default.
5. Call `buildAgentPrompt(node, ctx, meta, load)` with the same `load` callback the runtime uses (resolves agent `.md` from `meta.dotDir`).
6. On `{ fail }`, print the message to stderr and exit 1.
7. On success, print `built.prompt` to stdout. Exit 0.

Stdout is **only** the rendered prompt — no banner, no run dir, no validation summary on the success branch. Diagnostics from step 1 (warnings) print to stderr; errors short-circuit to exit 1 before render.

`--var` parsing rules (locked by refinement):

- `--var k=v` is repeatable (reuses the existing `collectKV` at `src/cli/program.ts:101,133`).
- Values are **literal strings**. No `${ENV_VAR}` substitution. No `$project` resolution. No JSON parsing.
- `--var` collisions with caller inputs override the placeholder. `--var` collisions with system-injected vars (`ILLUMINATION_SERVER_PATH`, `PROJECT_ROOT` per `agent-prep.ts:16-19`) are **rejected** with `Error: --var ${KEY} clashes with a system-injected variable; rename your input.` to keep the preview honest about runtime constraints.

### 3.4 `pipeline explain` command

```
apparat pipeline explain <pipeline> [--project <folder>]
```

Output is plain-text. Sketch:

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

Key implementation choices:

- **Producers** per node come from the agent's `outputs:` frontmatter (already parsed by `loadPipeline`) or from gate `choices:` (gate's `<id>.choice` plus alias).
- **Consumers** per node come from the agent's `inputs:` frontmatter, expanded through `resolveInputDecl` so `verifier.summary` displays as `verifier.summary` (the original declaration), not as the `verifier_summary` mangled form.
- **Reachability** uses `computeVarsInAnyScope` from `src/attractor/core/flow-analyzer.ts:36` for "var available somewhere on the way here" + `computeVarsInScope` from `:21` for "var available on every path here". Mismatches go in a separate `Branch warnings:` section.
- **Phase grouping vs. topological grouping** — open. If the `.dot` parser surfaces phase comments (`// phase: triage`), use them as section headers; otherwise topological. Implementer decides at code-time.

No ASCII art. No graph rendering. No Graphviz dependency.

### 3.5 `pipeline trace --node-receive` one-line addition

`src/cli/commands/pipeline/trace.ts:49-66` becomes:

```ts
console.log(`\nnode:     ${event.nodeId}`);
console.log(`kind:     ${event.nodeKind}`);
console.log(`received: ${event.timestamp}`);
+ const promptPath = join(runDir(project, runId), String(event.nodeId), "prompt.md");
+ if (existsSync(promptPath)) {
+   console.log(`prompt:   ${promptPath}`);
+ }
console.log(`\ncontext snapshot (${keys.length} key…`);
```

The existence check guards against the rare case where the runtime crashed before `writeFileSync(prompt.md)` ran (`agent-prep.ts:97`); in that case trace stays silent on the prompt line rather than printing a dangling path.

### 3.6 Documentation: tag-mangling contract

The mangling rule lives only in code today. Two doc surfaces in `src/cli/skills/apparatus/pipelines.md`:

- **Inputs-block subsection in §3 (agent nodes).** A new subsection between `### Schema — sibling <name>.md frontmatter` (line 53) and `### Example digraph` (line 69) titled `### Auto-injected ## Inputs block`. Body: brief explanation of what `renderInputsBlock` produces (`inputs-renderer.ts:10`), short example, and a forward reference to the dedicated section.
- **Dedicated section.** The illumination + chat both call this "new §8". Existing pipelines.md already has a §8 (`Variables`) at line 371 plus §9–§12. Two viable resolutions, both behaviour-equivalent — implementer's call:
  - **Insert** a new §8 (`The <inputs> rendering contract`) between current §7 and §8, **renumbering** §8–§12 to §9–§13. Honors the chat refinement's literal numbering and gives the contract its own top-level slot.
  - **Append** as `§3.X — The <inputs> rendering contract` inside the agent-nodes section, leaving §8–§12 numbering intact. Lighter doc churn.
  - Default for the implementing session: insert + renumber, because the rule applies to all agent invocations and warrants its own section. Flag in the PR description so reviewers see the renumber and update any internal anchors.

The new section MUST cover: the `<sourceNode>_<localKey>` rule, the bare-input `<key>` rule for caller inputs and system-injected vars, the multi-line vs. single-line tag layout from `inputs-renderer.ts:30-37`, and the empty-string rule (`rawValue == null ? "" : String(rawValue)` at `inputs-renderer.ts:29`). One worked example, ideally generated by `pipeline preview` so the doc and the runtime can never drift again.

### 3.7 ADR-0011 SKILL.md shim regeneration

`src/cli/skills/apparatus/SKILL.md:17-21` lists the pipeline subcommand surface. After this change it should read:

```
| `apparat pipeline run <name> [--var k=v]... [--resume [runId]]` | Execute a `.dot` pipeline by folder name. |
| `apparat pipeline validate <name>` | Structural + portability check. **Run before every `pipeline run`.** |
| `apparat pipeline list <project>` | List all `.dot` pipelines discoverable in the project. |
| `apparat pipeline preview <name> --node <id> [--var k=v]...` | Render the assembled prompt for one node. **No LLM invoked.** |
| `apparat pipeline explain <name>` | Print a plain-text walkthrough of nodes, inputs/outputs, branches, loops. |
| `apparat pipeline trace <runId> [--node-receive <nodeId>] [--full]` | Inspect a past run's context + trace logs. |
| `apparat heartbeat pipeline <name> --project <dir> --every <minutes>` | Schedule a recurring pipeline run. |
```

Per ADR-0011 the SKILL.md shim regenerates from a script when the underlying live reference changes — confirm regeneration vs. hand-edit in the implementing PR.

### 3.8 Surfaces unchanged

- `assembleAgentPrompt` signature and return type. Unchanged — the wrapper preserves it.
- `PreparedAgent` interface (`agent-prep.ts:28-35`). Unchanged.
- `pipeline run`, `pipeline validate`, `pipeline list`, `pipeline show`. Unchanged. (`pipeline trace` gains exactly one console.log line for human consumers; structured `pipeline.jsonl` shape is unchanged.)
- `Graph` type, `parseDot`, `validateGraph`, `loadPipeline` signatures. Unchanged.
- `inputs-resolver.ts` `ResolvedInput` shape and `resolveInputDecl` semantics. Unchanged.
- `inputs-renderer.ts` `renderInputsBlock` signature and rendering rules. Unchanged.
- `flow-analyzer.ts` exports. Unchanged.
- Pipeline `.dot` syntax, agent rubric, gate rubric. Unchanged.
- Daemon IPC, runs JSONL shape, checkpoint format. Untouched.

### 3.9 Files-touched buckets

| Bucket | Files | Treatment |
|---|---|---|
| Pure-core extract | `src/attractor/handlers/agent-prep.ts` | Edited — split into `buildAgentPrompt` (pure) + `assembleAgentPrompt` (wrapper); signatures preserved |
| Preview command | `src/cli/commands/pipeline/preview.ts` | **New** — implements preview behaviour from §3.3 |
| Explain command | `src/cli/commands/pipeline/explain.ts` | **New** — implements explain behaviour from §3.4 |
| Trace edit | `src/cli/commands/pipeline/trace.ts` | Inline edit — three lines added inside `--node-receive` branch |
| CLI registration | `src/cli/program.ts` | Inline edit — register `preview` + `explain` next to existing `pipeline.command(...)` calls (`:107-203`) |
| Doc — pipelines.md | `src/cli/skills/apparatus/pipelines.md` | Inline edit — §3 inputs-block subsection + new dedicated section (or §3.X) per §3.6 |
| Doc — SKILL.md shim | `src/cli/skills/apparatus/SKILL.md` | Edit (or regen) — two new rows in the command table |
| Doc — README | `README.md` | Inline edit — pipeline command list mentions `preview` + `explain` |
| Tests — new | `src/cli/tests/pipeline-preview.test.ts` | **New** — covers preview happy path, missing node, `--var` overrides, `--var` system-collision rejection, JSON-schema wrap |
| Tests — new | `src/cli/tests/pipeline-explain.test.ts` | **New** — covers explain output for a small fixture (start → agent → exit), gate branches, loops, reachability |
| Tests — extend | `src/attractor/tests/agent-prep.test.ts` | Edit — add `buildAgentPrompt` cases that assert no `prompt.md` is written; existing `assembleAgentPrompt` cases stay |
| Tests — extend | `src/cli/tests/pipeline.test.ts` (or `pipeline-trace.test.ts`) | Edit — assert the new `prompt: <path>` line in `--node-receive` output when the run dir contains a `prompt.md`, and absence when it does not |

Total files: 12 (3 new, 9 edited). Line count expected ~600–850 (verifier estimate, refined-scope pass).

## 4. Components & key edits

### 4.1 `src/attractor/handlers/agent-prep.ts` (edited)

See §3.2. Two functions exported instead of one. The `buildAgentPrompt` body is the existing `agent-prep.ts:44-99` minus `mkdirSync`+`writeFileSync` and minus the `create()` call; the wrapper handles those.

Caveat: `nodeDir` is computed inside `buildAgentPrompt` (today at `agent-prep.ts:75`) but the directory is **not** created — only the path string is returned. The runtime wrapper performs the `mkdirSync` immediately before the write. `pipeline preview` ignores `nodeDir` (never writes anything).

### 4.2 `src/cli/commands/pipeline/preview.ts` (new)

```ts
import { resolve, dirname, join } from "path";
import { loadPipeline } from "../pipeline-invocation.js";
import { buildAgentPrompt, SYSTEM_INJECTED_VARS } from "../../../attractor/handlers/agent-prep.js";
import { loadAgent } from "../../lib/agent-loader.js";
import * as output from "../../lib/output.js";

export interface PipelinePreviewOptions {
  node: string;
  project?: string;
  variables?: Record<string, string>;
}

export async function pipelinePreviewCommand(
  pipelineArg: string,
  opts: PipelinePreviewOptions,
): Promise<number> {
  const projectRoot = resolve(opts.project ?? process.cwd());
  const loaded = await loadPipeline(pipelineArg, { project: projectRoot });

  const errors = loaded.diagnostics.filter(d => d.severity === "error");
  if (errors.length > 0) {
    for (const d of errors) await output.error(formatDiagnostic(d));
    return 1;
  }

  const node = loaded.graph.nodes.get(opts.node);
  if (!node) {
    const known = Array.from(loaded.graph.nodes.keys()).join(", ");
    await output.error(`node "${opts.node}" not found in ${pipelineArg}; available: ${known}`);
    return 1;
  }
  if (node.kind !== "agent") {
    await output.error(`node "${opts.node}" is kind=${node.kind}; preview only supports agent nodes`);
    return 1;
  }

  // System-collision check on --var
  for (const k of Object.keys(opts.variables ?? {})) {
    if ((SYSTEM_INJECTED_VARS as readonly string[]).includes(k)) {
      await output.error(`--var ${k} clashes with a system-injected variable; rename your input`);
      return 1;
    }
  }

  const callerInputs: Record<string, unknown> = {};
  for (const k of loaded.graph.inputs ?? []) callerInputs[k] = `<placeholder:${k}>`;
  const ctxValues = { ...callerInputs, ...(opts.variables ?? {}) };

  const meta = synthesiseMeta(loaded.absPath, projectRoot);
  const built = buildAgentPrompt(
    node,
    { values: ctxValues } as any,
    meta,
    (name, dotDir) => loadAgent(name, dotDir),
  );
  if ("fail" in built) {
    await output.error(built.fail);
    return 1;
  }

  process.stdout.write(built.prompt);
  if (!built.prompt.endsWith("\n")) process.stdout.write("\n");
  return 0;
}
```

`synthesiseMeta` builds the minimum `HandlerExecutionContext` shape `buildAgentPrompt` reads (`dotDir`, `cwd`, `projectDir`, `completedNodes`, `nodeRetries`, `logsRoot`). The `logsRoot` is set to a sentinel path that is never written to; only the wrapper writes.

### 4.3 `src/cli/commands/pipeline/explain.ts` (new)

Skeleton — reuses `loadPipeline`, walks `graph.nodes` in topological order from `start`, emits the per-node block from §3.4. Loops are detected by re-running the topological sort and surfacing back-edges; reachability uses `computeVarsInAnyScope`. ~150–200 LOC.

### 4.4 `src/cli/commands/pipeline/trace.ts` (edited)

See §3.5 — three new lines guarded by `existsSync`.

### 4.5 `src/cli/program.ts` (edited)

Two new `pipeline.command(...)` registrations adjacent to the existing five (`:107-203`):

```ts
pipeline
  .command("preview <pipeline>")
  .description("Render the assembled prompt for one agent node (no LLM invoked)")
  .requiredOption("--node <id>", "node id to preview")
  .option("--project <folder>", "Project folder (defaults to cwd)")
  .option("--var <key=value>", "literal variable for the preview (repeatable)", collectKV, {} as Record<string, string>)
  .action(async (pipelineArg: string, opts: { node: string; project?: string }) => {
    const code = await pipelinePreviewCommand(pipelineArg, {
      node: opts.node,
      project: opts.project,
      variables: (opts as Record<string, unknown>)["var"] as Record<string, string> | undefined,
    });
    process.exit(code);
  });

pipeline
  .command("explain <pipeline>")
  .description("Plain-text walkthrough of nodes, inputs/outputs, branches, loops")
  .option("--project <folder>", "Project folder (defaults to cwd)")
  .action(async (pipelineArg: string, opts: { project?: string }) => {
    const code = await pipelineExplainCommand(pipelineArg, opts);
    process.exit(code);
  });
```

## 5. Data flow

### 5.1 `pipeline preview <p> --node <id> --var k=v`

```
apparat pipeline preview workflow --node verifier --var goal="..." --project my-app
  → src/cli/commands/pipeline/preview.ts pipelinePreviewCommand
    → loadPipeline(workflow, { project })
        (src/cli/commands/pipeline-invocation.ts:33 — readFileSync, parseDot, validateGraph)
    → walk diagnostics; exit 1 on errors
    → graph.nodes.get(opts.node); exit 1 if missing or non-agent
    → assert --var keys do not collide with SYSTEM_INJECTED_VARS
        (agent-prep.ts:16-19)
    → ctxValues = { ...callerInputPlaceholders, ...--var }
    → buildAgentPrompt(node, { values: ctxValues }, syntheticMeta, loadAgent)
        (src/attractor/handlers/agent-prep.ts — pure core, no IO except agent .md read)
    → process.stdout.write(built.prompt) → exit 0
```

No daemon RPC. No `mkdirSync`. No `writeFileSync`. No `Agent` instance. No LLM.

### 5.2 `pipeline explain <p>`

```
apparat pipeline explain workflow --project my-app
  → src/cli/commands/pipeline/explain.ts pipelineExplainCommand
    → loadPipeline(workflow, { project })
    → topological walk of graph.nodes
    → per-node: read agent inputs/outputs from frontmatter
    → computeVarsInScope(graph, nodeProduces) + computeVarsInAnyScope(graph, nodeProduces)
        (src/attractor/core/flow-analyzer.ts:21,36)
    → detect back-edges → loops section
    → reachability check → reachability section
    → console.log lines (plain text)
    → exit 0
```

### 5.3 `pipeline trace --node-receive <id>`

```
apparat pipeline trace <runId> --node-receive <id>
  → existing path (trace.ts:6-83)
  → after console.log("received: ...") at line 51:
      promptPath = join(runDir(project, runId), nodeId, "prompt.md")
      if (existsSync(promptPath)) console.log(`prompt:   ${promptPath}`)
  → existing context-snapshot, validation-attempts, completed-stages output (lines 52-82)
```

## 6. Blast radius / impact surface

- **Size:** **M** — verifier's refined-scope pass and explainer agree.
  - File count: 3 new + 9 edited ≈ 12 files (engine 1, CLI 4, docs 3, tests 4 — 2 new + 2 extend).
  - Line count range: ~600–850 (verifier refined-scope estimate; explainer's earlier ~360 figure was the prior pass — refined estimate is more generous on tests + docs).
  - Surface count: engine (1), CLI (3 — preview, explain, trace), docs (3 — pipelines.md, SKILL.md, README.md), tests (4).
- **Surfaces crossed:**
  - **Engine** — `assembleAgentPrompt` split, `buildAgentPrompt` introduced. Call sites unchanged.
  - **CLI** — `pipeline preview` (new), `pipeline explain` (new), `pipeline trace --node-receive` (additive console.log line).
  - **Docs** — `pipelines.md` (§3 inputs-block subsection + new dedicated section per §3.6), `SKILL.md` (two new rows), `README.md` (pipeline command list).
  - **Tests** — two new files, two extensions.
- **Breaking changes:** **none.** Verbatim from the explainer and verifier:
  - `assembleAgentPrompt` signature and return type preserved — five call sites compile unchanged (`looping-agent-handler.ts:27`, `interactive-agent-handler.ts:26`, `agent-prep.test.ts:44,71,92`).
  - `pipeline preview` and `pipeline explain` are additive subcommands — no existing CLI invocation changes shape.
  - `pipeline trace --node-receive` gains a single human-only `console.log` line; `pipeline.jsonl` structured trace shape is untouched, so any tooling reading the JSONL is unaffected. The text shape is not part of any documented contract today.
- **Spec / docs ripple checklist:**
  - [ ] `src/cli/skills/apparatus/pipelines.md` — §3 inputs-block subsection + dedicated tag-mangling section (resolution per §3.6).
  - [ ] `src/cli/skills/apparatus/SKILL.md:17-21` — two new rows in the command table (or regenerate from script per ADR-0011).
  - [ ] `README.md` pipeline command list — `preview` + `explain` mentioned where existing pipeline commands are listed.
  - [ ] No new ADR needed. ADR-0011 (skill-as-shim-plus-live-reference) endorses adding command surface to the live reference; this design is an application of that pattern, not a new principle.
  - [ ] No CONTEXT.md change.
- **Test ripple checklist:**
  - [ ] **New** `src/cli/tests/pipeline-preview.test.ts` — happy path; missing node; non-agent node rejected; `--var` overrides placeholder; `--var` system-collision rejected; JSON-schema-wrapped prompt; multi-line input value formatted with separate tag lines per `inputs-renderer.ts:30-34`.
  - [ ] **New** `src/cli/tests/pipeline-explain.test.ts` — small fixture (start → agent → exit); gate branches enumerated; loop detection (deep-loop fixture); reachability OK + reachability with intentionally-unreachable node; output is plain text only (no ANSI escape codes from chalk in test mode — `FORCE_COLOR=0`).
  - [ ] **Extend** `src/attractor/tests/agent-prep.test.ts` — assert `buildAgentPrompt` returns the same `prompt` field as `assembleAgentPrompt` for the same inputs; assert no `prompt.md` is written by `buildAgentPrompt`; existing three call sites stay green.
  - [ ] **Extend** `src/cli/tests/pipeline.test.ts` (or new `pipeline-trace.test.ts` if the trace tests live there) — assert `--node-receive` prints `prompt: <path>` when a `prompt.md` exists in the run dir, and prints nothing extra when it does not.

## 7. Trade-offs

### 7.1 Pure-core extract vs. duplicate the assembly logic in preview

A cleaner-feeling alternative would be to import the existing `assembleAgentPrompt` from `pipeline preview` and just discard the side-effect outputs. Rejected:

- The runtime path performs `mkdirSync` + `writeFileSync` *and* instantiates an `Agent`. To suppress those for preview we would either need a per-call flag (uglifies the runtime contract for a non-runtime concern) or accept that `pipeline preview` writes a junk `prompt.md` into a synthetic run dir (defeats the "no run dir created" promise).
- Splitting once gives both call sites a clean, identical render. The cost is one wrapper function and zero new branches in either caller. Textbook deep-module move per `stimuli/deep-modules-hide-complexity.md` (one symbol, two adapters).

### 7.2 `pipeline preview` as a separate command vs. flag on `pipeline run`

A `pipeline run --dry-run` was considered. Rejected:

- `pipeline run` already has a non-trivial flag set (`--var`, `--resume`, `--project`). Adding a behaviour-flipping `--dry-run` would re-open the no-LLM-or-LLM contract on every invocation; bugs in that branch would be silent.
- A dedicated `preview` subcommand is one symbol the author can wire into an editor task / pre-commit hook with no risk of accidentally launching an LLM.
- `--node <id>` is mandatory for preview but nonsensical for `run` (which executes the whole graph) — separate commands give clean orthogonal flag sets.

### 7.3 Plain-text `pipeline explain` vs. graph rendering

The illumination explicitly opted for plain text; the chat refinement reaffirmed it ("no ASCII art, no graph rendering"). Reasons:

- Pipes to `less` / `grep`; no terminal capability assumptions.
- Authors who want a graph already have `pipeline show` (SVG).
- Phase comments + per-node `consumes:` / `produces:` lines deliver the "what does this pipeline do?" answer faster than scanning a topology graph.

### 7.4 `--var` literal-only vs. full `pipeline run` semantics

Refinement-locked. Reasons:

- Env-var substitution + `$project` resolution + node-output-key references would replicate most of `pipeline run`'s machinery at no clear preview-specific benefit.
- Authors who want runtime-accurate substitution can do an actual `pipeline run` — that is what the runtime is for.
- The literal-only contract caps preview's blast radius.

### 7.5 Documentation: insert §8 (renumber) vs. §3.X (no renumber)

See §3.6. Either honors the chat refinement; neither changes runtime behaviour. Default for the implementing session: insert + renumber, with renumber clearly called out in the PR description so reviewers see the cascade.

### 7.6 Sequencing — single PR vs. two-PR split

Refinement leaves this to the implementer. Default: **single PR** (12 files, ~600–850 LOC, no breaking changes — well within review-in-one-pass scope). If the implementer prefers smaller chunks, the natural split is:

- **PR 1:** `buildAgentPrompt` extract + `pipelines.md` tag-mangling docs + agent-prep tests. Ships the seam that `pipeline preview` will plug into; runtime behaviour unchanged.
- **PR 2:** `pipeline preview` + `pipeline explain` + `trace --node-receive` line + CLI registrations + new test files + SKILL.md + README.

Either path preserves the no-breaking-change invariant.

## 8. Constraints

After the change:

- `npx tsc --noEmit` passes.
- `npx vitest run` passes — including the two new test files and the two extended ones.
- `apparat pipeline preview <pipeline> --node <id>` writes the rendered prompt to stdout with no other output on the success path; exit 0.
- `apparat pipeline preview <pipeline> --node <missing>` exits 1 with a `not found in <pipeline>` message that lists available node ids.
- `apparat pipeline preview <pipeline> --node <id> --var ILLUMINATION_SERVER_PATH=hax` exits 1 with the system-collision message (no rendering).
- `apparat pipeline preview <pipeline> --node <gate-or-tool>` exits 1 — preview supports agent nodes only.
- `apparat pipeline explain <pipeline>` writes plain ASCII to stdout (no ANSI escape codes when `FORCE_COLOR=0`); exit 0 for valid pipelines, exit 1 surfacing diagnostics for invalid ones.
- `apparat pipeline trace <runId> --node-receive <id>` prints the existing four-block output plus, when the run dir contains a `prompt.md` for the node, one extra line `prompt:   <runDir>/<nodeId>/prompt.md`. When the file is absent, the line is omitted.
- `apparat pipeline run <pipeline>` byte-identical behaviour to today (no preview-related changes leak into runtime output).

Repo-wide grep invariants:

- `grep -n "buildAgentPrompt\b" src/attractor/handlers/agent-prep.ts` — present.
- `grep -n "assembleAgentPrompt\b" src/attractor/handlers/agent-prep.ts` — still present.
- `grep -nR "import.*assembleAgentPrompt" src` — exactly three importers (`looping-agent-handler.ts`, `interactive-agent-handler.ts`, `agent-prep.test.ts`); no new importers.
- `grep -nR "import.*buildAgentPrompt" src` — at least two importers (`pipeline/preview.ts`, `tests/agent-prep.test.ts`).
- `grep -n "pipeline.command" src/cli/program.ts` — seven matches (existing five + preview + explain).
- `grep -nR "<sourceNode>_<localKey>" src/cli/skills/apparatus/pipelines.md` — at least one match (the new contract section or §3 subsection).

Behaviour invariants:

- No `mkdirSync` or `writeFileSync` is reachable from `pipelinePreviewCommand`.
- `pipeline preview` issues zero socket calls (no daemon RPC, no LLM API call).
- `pipeline explain` issues zero socket calls.
- `assembleAgentPrompt`'s five call sites compile unchanged; `git blame` on those lines does not move.

## 9. Open questions

- **Insert + renumber vs. §3.X for the tag-mangling section** in `pipelines.md` (§3.6). Default: insert + renumber. Implementer may reverse this with rationale in the PR description if the renumber creates excessive doc churn.
- **`--show-schema` flag on `pipeline preview`** (deferred per chat). If the author also wants the JSON schema derived from the agent's `outputs:` frontmatter, would a `--show-schema` flag cleanly print it after the rendered prompt with a separator? Implementer may add this if it falls out cleanly during step 3 of §3.3. If non-trivial, defer to a follow-up illumination.
- **Phase grouping vs. topological grouping for `pipeline explain`** (deferred per chat). Phase comments (when present in the `.dot` source) are richer; topological is the universal fallback. Implementer decides at code-time based on `.dot` parser availability — both branches produce a correct walkthrough.
- **`--var` collision with caller inputs vs. node defaults — order of precedence.** Current design: `--var` wins over both. If multiple authors expect node defaults to win unless `--var` is explicitly passed, the order changes one line in `preview.ts` step 3. Default: ship as designed; revisit if author feedback says otherwise.
- **Stale-entry seam in `loadPipeline`.** The verifier flagged that the illumination's "reuse `loadPipeline()` from `pipeline-invocation.ts`" was claimed-but-unverified. Confirmed in this design: `loadPipeline` is exported at `src/cli/commands/pipeline-invocation.ts:33`. No new lookup function needed.

## 10. Verification approach

### 10.1 Static checks

- `npx tsc --noEmit` — clean.
- Grep `buildAgentPrompt\b` in `src/attractor/handlers/agent-prep.ts` — present.
- Grep `pipeline.command\("preview"\)` in `src/cli/program.ts` — one hit.
- Grep `pipeline.command\("explain"\)` in `src/cli/program.ts` — one hit.
- Grep `<sourceNode>_<localKey>` in `src/cli/skills/apparatus/pipelines.md` — at least one hit.

### 10.2 Tests

- `npx vitest run src/cli/tests/pipeline-preview.test.ts` — new, passes.
- `npx vitest run src/cli/tests/pipeline-explain.test.ts` — new, passes.
- `npx vitest run src/attractor/tests/agent-prep.test.ts` — passes after `buildAgentPrompt` cases land; existing `assembleAgentPrompt` cases still green.
- `npx vitest run src/cli/tests/pipeline.test.ts` (or `pipeline-trace.test.ts`) — passes after the `prompt:` line assertion lands.
- Full `npx vitest run` — passes.

### 10.3 Smoke

- `apparat pipeline preview .apparat/pipelines/illumination-to-implementation/pipeline.dot --node verifier --project .` — renders the verifier's prompt to stdout; no run dir created under `.apparat/runs/`; no LLM invoked.
- `apparat pipeline preview <pipeline> --node verifier --var goal="ship feature X"` — the `<goal>...</goal>` block in the rendered prompt contains `ship feature X`.
- `apparat pipeline explain .apparat/pipelines/illumination-to-implementation/pipeline.dot --project .` — prints a plain-text walkthrough that includes a Loops section (the illumination-to-implementation pipeline contains a retry loop).
- `apparat pipeline run .apparat/pipelines/<small-pipeline>/pipeline.dot --project .` then `apparat pipeline trace <runId> --node-receive <nodeId>` — the trace output now contains a `prompt:` line whose path resolves to a real file.
- `apparat pipeline trace <runId> --node-receive <nodeId>` against an old run whose `prompt.md` was lazily pruned — the `prompt:` line is **omitted**, no error.

### 10.4 Negative cases

- `pipeline preview <pipeline> --node <gateId>` — exits 1 with kind-mismatch message; preview is agent-only.
- `pipeline preview <pipeline-with-validation-errors> --node <id>` — exits 1, prints diagnostics, no render.
- `pipeline preview <pipeline> --node <id> --var PROJECT_ROOT=/etc` — exits 1 with system-collision message.
- `pipeline explain <pipeline-with-validation-errors>` — exits 1, prints diagnostics; no walkthrough.
- `pipeline trace <runId> --node-receive <id>` against a run dir where the node never started — existing "No node-start event found" path (`trace.ts:35-38`) wins; new `prompt:` line is never reached.

## 11. Summary

`assembleAgentPrompt` at `src/attractor/handlers/agent-prep.ts:37` is the deterministic, single-source-of-truth builder for what every agent's LLM sees, but apparat exposes zero design-time surface for it: an author's only path to "what will my LLM read?" is to launch a real run and dig into a gitignored, lazily-pruned `<project>/.apparat/runs/<runId>/<nodeId>/prompt.md` written at `agent-prep.ts:97`. The tag-mangling rule (`<sourceNode>_<localKey>` from `inputs-resolver.ts:41` wrapping values via `inputs-renderer.ts:30-37`) is invisible to authors and undocumented in `src/cli/skills/apparatus/pipelines.md` (496 lines, no mention). `pipeline trace --node-receive` (`trace.ts:49-66`) prints node id, kind, timestamp, context snapshot, and completed stages — but never the prompt path, even though it sits at a sibling. This design ships five additive items on the same prompt-assembly seam: (1) a pure-core `buildAgentPrompt` extract that preserves `assembleAgentPrompt`'s signature so all five existing call sites at `looping-agent-handler.ts:27`, `interactive-agent-handler.ts:26`, and `agent-prep.test.ts:44,71,92` compile unchanged; (2) `apparat pipeline preview <pipeline> --node <id> [--var k=v]` (no LLM invoked, literal-only `--var` substitution + frontmatter defaults, system-injected-var collisions rejected); (3) `apparat pipeline explain <pipeline>` (plain-text node list with `consumes:` / `produces:` / `branches:` / `next:` per node + Loops + Reachability sections, reusing `computeVarsInScope` and `computeVarsInAnyScope` at `flow-analyzer.ts:21,36` — no ASCII art, no Graphviz); (4) one new line `prompt: <runDir>/<nodeId>/prompt.md` inside `trace.ts:49-66`; (5) doc the inputs-block tag-mangling contract in `pipelines.md` (§3 subsection + new dedicated section, plus two new rows in the ADR-0011 `SKILL.md` shim at `:17-21`). Per chat refinement, step 5 of the illumination (the `.last-rendered/` per-pipeline mirror) is dropped; step 7 (`pipeline watch` integration) stays deferred. Blast radius is M — 12 files (3 new, 9 edited), ~600–850 LOC, no breaking changes. `assembleAgentPrompt` signature preserved; `pipeline preview` and `pipeline explain` are additive subcommands; `pipeline trace --node-receive` gains exactly one human-only `console.log` line. Two open questions deferred to implementation time: `--show-schema` flag and phase-vs-topological grouping in `explain`. Sequencing (single PR vs. seam-first two-PR split) is the implementer's call; default single PR.
