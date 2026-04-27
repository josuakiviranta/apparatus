# Pipeline Folder Architecture Redesign — Design

**Status:** proposed
**Date:** 2026-04-27
**Related:** `src/attractor/core/schemas.ts`, `src/attractor/core/graph.ts`, `src/attractor/handlers/agent-handler.ts`, `src/cli/lib/agent.ts`, `src/cli/lib/agent-registry.ts`, `src/cli/lib/frontmatter.ts`, `src/cli/agents/`, `src/cli/prompts/`, `src/cli/commands/`, `pipelines/`
**Origin:** `/grill-me` session 2026-04-27 (memory: `2026-04-27-pipeline-architecture-grilling-decisions.md`)

## Mission

Restructure ralph-cli pipelines from scattered concept folders into **per-pipeline folders** with each node self-describing in frontmatter. Net effect: `src/` becomes the harness (engine + validators + UI + MCP); `pipelines/` becomes behavior (graph + handlers + tests in one folder). Concept count for pipeline authors drops from 7 to ~3 file types per pipeline, all co-located.

The redesign honors the user's stated goal: "ralph is a wrapper for other projects so that other project would need a new pipeline it would be easy to build, store, test, and use with ralph-cli."

## Why

### The four-verb pipeline-author goal

The user named four verbs that frame ralph's value to a foreign project: **build, store, test, use** a pipeline. Today every verb costs more than necessary:

- **Build**: a new pipeline requires learning seven distinct concept-types (see below).
- **Store**: a single pipeline is scattered across `pipelines/<name>.dot`, `pipelines/scripts/*.mjs`, `pipelines/schemas/*.json`, `src/cli/agents/*.md`, and possibly `<project>/.ralph/agents/*.md`.
- **Test**: no convention exists for project authors. `pipelines/smoke/` is ralph's own engine tests, not a template.
- **Use**: works (`ralph pipeline run <file.dot>`), modulo discoverability of inputs.

The redesign attacks **build** and **store** directly, addresses **test** with a usage convention (live runs against scratch projects, no harness), and leaves **use** intact.

### Concept count today

A pipeline author currently must learn seven distinct concept-types and where each lives:

| # | Concept | Lives in | Why it exists |
|---|---|---|---|
| 1 | `.dot` graph | `pipelines/*.dot` | the graph itself |
| 2 | tool scripts | `pipelines/scripts/*.mjs` | side-effects (mutate disk) |
| 3 | JSON schemas | `pipelines/schemas/*.json` | constrain LLM JSON output |
| 4 | agent prompts | `src/cli/agents/*.md` AND `<project>/.ralph/agents/*.md` | LLM system prompts (split across two locations) |
| 5 | context vars | implicit via `produces=` + `$var` interpolation | data flow between nodes |
| 6 | gate prompts | inline in `.dot` `label=` (multi-line `\n`-escaped) | human decisions |
| 7 | CLI surface | `--var`, `--resume`, `--project`, `cwd=` | runtime |

Concept #4 has a location split — the canonical "where do I put my prompt?" question has two answers, with engine-side resolution rules a foreign project must internalise. Concept #5 is implicit — to know "what vars are available at this node?" the author must walk every upstream path mentally.

The schemas folder (`pipelines/schemas/`) holds 10 files; 7 are used by exactly one pipeline (`illumination-to-implementation.dot`). The scripts folder (`pipelines/scripts/`) holds 2 files; both used by the same pipeline. **Sharing is hypothetical, not actual.** Co-locating these into per-pipeline folders costs nothing in reuse.

### What the user stated during grilling

- "Single source of truth would be nice if possible for pipelines. However, those cannot be too big files because then again mental load comes huge."
- "I don't care about token burn. I care about simplicity and that smoke pipelines test live code."
- "I would like to have some easy mental model to keep in my head about these pipelines and how to build new ones and store old ones."
- "Could create just be its own agent pipeline that would have in its instructions how to build pipelines? This is at least my intuition with KISS framework in my mind."

## Decisions

The grilling produced eleven architectural decisions, each picked deliberately for KISS over more powerful alternatives.

### D1. Per-pipeline folder = single source of truth

Each pipeline becomes a folder. Everything that pipeline needs lives inside.

```
pipelines/release-notes/
  pipeline.dot              # pure graph: nodes + edges + routing labels
  summarizer.md             # agent (frontmatter has model, tools, inputs, outputs)
  review-gate.md            # gate (frontmatter has type:gate, choices, outputs)
  publish.mjs               # tool (idempotent, resume-safe)
  README.md                 # 5 lines: what + when to run
```

Rule: `<node-id>.<ext>` is the handler file for a node, located next to `pipeline.dot`.

**Smoke folder exception:** `pipelines/smoke/` exists to test ENGINE features, not workflows. Multiple smoke pipelines may share an agent (e.g. `task.md`) inside `pipelines/smoke/` because they exercise one harness. The validator's per-pipeline-folder lookup rule (D5) treats `pipelines/smoke/<*.dot>` as siblings sharing the parent folder. No other folder gets this exception.

`pipelines/smoke/` already follows the per-pipeline-folder pattern (own `schemas/` subdir). The top-level shared `pipelines/scripts/` and `pipelines/schemas/` folders are the inconsistency; this redesign removes them.

### D2. Schema + produces collapse into agent frontmatter

Today an agent's behavior is split across three places (`.dot`'s `json_schema_file=` + `produces=` attrs, the agent's `.md` prompt file, the JSON schema file). Collapse to **one place**: agent `.md` frontmatter declares `outputs:` keyed by produced var, value = JSON schema fragment for that var.

```md
---
name: verifier
model: opus
tools: [Read, Grep, Glob, Task]
outputs:
  preferred_label: {enum: [true, false, empty]}
  illumination_path: string
  summary: string
  explanation: string
  archive_reason_short: {type: string, maxLength: 100}
---
# Mission
You verify a single illumination...
```

The `pipelines/schemas/` folder dies. The `.dot` agent node loses `json_schema_file=` and `produces=` attrs; both are derived from the agent file's `outputs:` block.

The `.dot` `produces=` attribute on agent nodes also goes away — the validator derives the produced-key set from the agent's `outputs:` block. (The agent file's frontmatter has no separate `produces:` key either; the top-level keys of `outputs:` ARE the produced var names.) One declaration site, two redundancies removed.

### D3. One file shape per node

Two file types total across all nodes:

- `<node-id>.md` — for agents and gates. Discriminated by `type:` in frontmatter (omitted = agent; `type: gate` = gate). Body = prompt text (agent) or question text (gate).
- `<node-id>.mjs` — for tool nodes. Body = the script.

Filename equals node id. Open `pipeline.dot`, see node id `verifier`, open `verifier.md`. Zero hunting.

Gates today live inline in `.dot` `label=` with multi-line `\n`-escaped strings (the `remove_gate` label is 5 lines of escaped text). After D3 they move to `.md` files with the same shape as agents:

```md
---
name: remove-gate
type: gate
inputs: [illumination_path, explanation]
choices: [Archive, Keep, Chat]
outputs:
  choice: {enum: [Archive, Keep, Chat]}
---
The verifier recommends archiving.

Illumination: $illumination_path
Reason: $explanation

Choose your next action.
```

### D4. Agents move out of `src/cli/agents/`

The 17 bundled agent files in `src/cli/agents/` move into the pipeline folders that use them. Lookup becomes pipeline-folder-only — no runtime fallback to bundled.

For ralph-the-project (which dogfoods these pipelines), each agent moves into the folder of the pipeline that uses it. Where multiple pipelines use the same agent, each pipeline owns its copy. Drift is acceptable: improvements to ralph's bundled `verifier` should not silently retune a foreign project's pipeline. Re-syncing happens by re-copying from a template (see D7).

The smoke folder (`pipelines/smoke/`) is the one exception — smoke pipelines test engine features and may share an agent (e.g. `task.md`) inside `pipelines/smoke/` since they exercise one harness, not separate workflows.

### D5. Mandatory `inputs:` per node + flow validator

Every node `.md` declares `inputs:` in frontmatter — the list of context vars it consumes. Validator (`pipeline validate`) walks the DAG and statically checks:

- **Missing producer.** Node declares `inputs: [summary]`; no upstream path produces `summary` and no `default_summary=` set on the node. Hard error with file:line:col carets (uses today's source-location diagnostics from `src/attractor/core/graph.ts`).
- **Branch-incomplete inputs.** Conditional edges where `summary` is produced on path A but not path B → fails on path B at runtime. Validator catches at authoring time.
- **Type mismatches.** Upstream `outputs: { risk: {enum: [low, med, high]} }`; downstream condition checks `risk=critical`. Static check: enum doesn't include `critical`.
- **Required CLI vars.** Validator computes the union of all node inputs minus internally-produced vars; that's the required `--var` set. Print at top of validate output.
- **Orphan outputs (warning).** Node produces `risk`; no downstream consumer. Warn, don't error.
- **Loop convergence.** `A → B → A` retry loops: B's outputs must satisfy A's inputs on the second pass.

This is the killer feature. It turns "run pipeline, see runtime error, scratch head" into "validate pipeline, see list of file:line errors, fix, run with confidence."

### D6. No fixture/mock test harness

Testing a pipeline = running it. Project authors point `--project` at a scratch directory:

```bash
ralph pipeline run pipelines/release-notes/pipeline.dot \
  --project /tmp/scratch-$(date +%s) \
  --var version=test
```

Real LLM, real shell, real env, throwaway state. Same pattern `pipelines/smoke/` already uses (`$run_id`-scoped directories).

ralph does **not** ship: a fixture format, a mock LLM client, a `--dry-run` mode, a fixture-replay test command. The "smoke catches live-env errors" property the user values is preserved by trusting live runs. Confidence comes from D5 (strong validator catches structure/flow before any live run is wasted).

### D7. `pipeline create` is itself a pipeline

The `ralph pipeline create` command becomes a thin shim that runs a bundled pipeline. Templates live in `src/cli/templates/<template-name>/`:

```
src/cli/templates/
  blank/                    # minimum scaffold (start → first_step → end)
  pipeline-create/          # the meta-template that scaffolds new pipelines
    pipeline.dot
    scaffolder.md           # interactive agent that authors files
    README.md
  release-notes/            # example user-facing template
  ...
```

`src/cli/prompts/PROMPT_pipeline_create.md` and the bespoke command wiring die. The CLI command becomes:

```ts
// src/cli/commands/pipeline.ts
export async function pipelineCreateCommand(name: string) {
  return runPipeline(resolveBundledTemplate("pipeline-create/pipeline.dot"), {
    vars: { pipeline_name: name }
  });
}
```

### D8. Other commands collapse to pipelines

Apply D7's pattern to every workflow command currently driven by bespoke prompt + Claude session wiring:

| Command | Becomes |
|---|---|
| `ralph plan` | `templates/plan/pipeline.dot` (single-node interactive) |
| `ralph meditate` | `templates/meditate/pipeline.dot` (single-node interactive) |
| `ralph new` | `templates/new/pipeline.dot` (kickoff session, possibly 2 nodes) |
| `ralph implement` | ✅ already done (memory: 2026-04-16) |
| `ralph pipeline refine` | `templates/pipeline-refine/pipeline.dot` |

(`ralph pipeline create` is covered separately in D7 — same pattern applied first, since it's the meta-template that scaffolds new pipelines.)

What stays a CLI command (engine plumbing, not a workflow):
- `pipeline run` — the runner itself
- `pipeline validate` — static analysis
- `pipeline list` — file-system listing
- `pipeline trace` — read checkpoint dirs
- `pipeline show` — render to SVG
- `heartbeat` — daemon scheduling

Mental model fully consistent: **if it's a workflow, it's a pipeline; if it's engine plumbing, it's a CLI command.**

### D9. Pipelines are for workflows, not commands

A workflow is multi-step + state + decisions. Below that threshold, use shell. ralph does not compete with `bash`/`make`/`npm run` for one-line tasks.

The validator emits a soft warning (`degenerate_pipeline`) on pipelines with one node + no branching + pure passthrough — "this could be a shell command, are you sure?" Soft nudge, not enforcement.

Templates start at 2+ nodes. The `blank` template ships `start → first_step → end` (3 nodes), not a single-node skeleton. This editorial choice prevents foreign projects from expressing "I want observability for `git status`" as a pipeline.

### D10. Flat pipelines for now (composition deferred)

Pipelines stay flat — a node cannot BE another pipeline. This redesign explicitly defers `type="pipeline"` (sub-pipeline composition) under KISS.

The deferred design and trigger conditions for revisiting are captured in `memory/2026-04-27-deferred-sub-pipeline-composition.md`. Trigger: 3+ pipelines duplicating the same agent and the drift pain is real, OR a single pipeline grows past ~15 nodes and becomes hard to read.

### D11. `.dot` format stays

After all the moves above, `.dot` files shrink to nodes + edges + routing labels + a few attrs. The painful parts of DOT (multi-line strings, embedded prompts, escaped `\n` soup) all moved to `.md` files where they belong. What remains is what graphviz is genuinely good at: declaring graph topology with first-class edge syntax.

Migration to YAML/JSON would lose: SVG-render-for-free (the user just opened `illumination-to-implementation.svg` in Firefox via `pipeline show`), edge syntax compactness (`A -> B [label="X"]` beats YAML's `from:/to:/label:` block), and existing tooling investment (`@ts-graphviz/ast` parser, source-location diagnostics with file:line:col carets). Migration cost is high; gain is purely cosmetic.

## Out of scope

The following are explicitly out of scope for this redesign:

1. **Sub-pipeline composition.** Deferred (D10). Separate memory captures the design.
2. **Engine-level changes to the runtime.** D5 adds a validator pass; D2 + D3 + D4 change file lookup; otherwise the runtime semantics (variable expansion timing, checkpointing, resume) are unchanged.
3. **Format migration from `.dot`.** D11 keeps the format.
4. **A test fixture format.** D6 explicitly drops this.
5. **Backwards compatibility with old pipelines that still use `pipelines/scripts/` or `pipelines/schemas/`.** The migration converts every pipeline at once; there is no transitional period where both layouts work.

## Net result

After full migration:

### `src/` becomes the harness

- `attractor/` — pipeline engine (graph parser, scheduler, context, checkpointing)
- `cli/program.ts` + `cli/commands/pipeline.ts` — engine commands (`pipeline run/validate/list/trace/show`, `heartbeat`)
- `cli/commands/{plan,meditate,new}.ts` — thin shims that call `runPipeline(bundledTemplatePath, vars)`
- `cli/lib/` + `cli/components/` — Ink TUI, stream formatter, gate selector, footer
- `cli/templates/` — bundled pipeline starters (workflow templates + meta-templates)
- `daemon/` — heartbeat
- `cli/mcp/` — MCP runtime infrastructure
- Validators (extended with D5 flow analysis)

### `pipelines/` becomes behavior

Each pipeline is a self-contained folder. ralph's own dogfooded pipelines (`illumination-to-implementation/`, `janitor/`) sit alongside whatever pipelines a foreign project authors. Every pipeline has the same shape; the only difference between a bundled template and a project pipeline is which directory it lives in.

### What dies

- `src/cli/agents/` (17 files redistributed)
- `src/cli/prompts/` (whole folder — `PROMPT_pipeline_create.md`, `PROMPT_kickoff.md`, etc.)
- `pipelines/schemas/` (collapsed into agent frontmatter)
- `pipelines/scripts/` (collapsed into per-pipeline folders)
- Bespoke command wiring for `plan`, `meditate`, `new`, `pipeline create`, `pipeline refine`
- `json_schema_file=` and `produces=` attributes on `.dot` agent nodes
- "Interactive Claude session" plumbing scattered across multiple commands — replaced by ONE pattern: pipelines with `interactive=true` agent nodes

## Migration sequence

The redesign is sequenced into six chunks, each producing working software on its own. Earlier chunks unblock later chunks; later chunks can land months apart from earlier ones if needed.

### Chunk 1: `outputs:` frontmatter + agent self-describes (D2)

**Foundation.** Extends the agent `.md` frontmatter parser to recognize `outputs:` (a keyed object). Engine derives `produces=` from `outputs:` keys. JSON schema is built from `outputs:` values. `json_schema_file=` becomes optional — if both `outputs:` (frontmatter) and `json_schema_file=` (`.dot`) are set, fail with `outputs_and_schema_file_conflict`. If `outputs:` is set, `produces=` on the `.dot` is ignored (and a warning emitted). Migrate one agent (`verifier`) end-to-end as proof.

Outcome: agent files self-describe. `pipelines/schemas/verifier.json` can be deleted; `illumination-to-implementation.dot`'s verifier node loses `json_schema_file=` and `produces=`. All tests still green.

### Chunk 2: `inputs:` frontmatter + flow validator (D5)

Adds `inputs:` to agent frontmatter parser. Adds new validator rules (`missing_input_producer`, `branch_incomplete_input`, `input_type_mismatch`, `orphan_output`, `required_caller_vars`). Hooks rules into `pipeline validate`. Migrate one agent (`verifier`) to declare `inputs:`; verify flow analysis catches a deliberately-broken upstream chain.

Outcome: validator catches flow errors before live runs. Foundation for safer migration of subsequent pipelines.

### Chunk 3: gates as `.md` files (D3)

Add new `type: gate` frontmatter shape to the `.md` parser. Engine learns to load gate prompts from `.md` files when the gate node has no inline `label=` (lookup: `<node-id>.md` next to `.dot`). Migrate every gate in `illumination-to-implementation.dot` (4 gates) to `.md` files. Inline-label gates still work for the smoke folder.

Outcome: `.dot` files lose multi-line escaped gate prose. One file shape per agent + gate node.

### Chunk 4: per-pipeline folder migration (D1, D4)

Move every project pipeline into its own folder. `illumination-to-implementation.dot` → `illumination-to-implementation/pipeline.dot` + per-node files. Each used agent moves from `src/cli/agents/` into the pipeline folder that uses it. `script_file=` paths update to be relative to the new pipeline folder location. `pipelines/scripts/` and `pipelines/schemas/` folders are deleted. Smoke folder stays mostly flat (engine tests, internal sharing).

Outcome: every project pipeline = one folder. `src/cli/agents/` shrinks dramatically (only agents NOT yet folded into pipelines remain — they get folded in Chunk 6).

### Chunk 5: `src/cli/templates/` + `pipeline-create` is a pipeline (D7)

Create `src/cli/templates/` with a `blank` template and the meta-template `pipeline-create`. `pipelineCreateCommand` becomes a thin shim that calls `runPipeline(resolveBundledTemplate("pipeline-create/pipeline.dot"), { vars: { pipeline_name: name } })`. `src/cli/prompts/PROMPT_pipeline_create.md` deleted. `src/cli/agents/agent-creator.md` moves into the `pipeline-create` template.

Outcome: scaffolding works the same way pipelines work. No bespoke command wiring for create.

### Chunk 6: command-to-pipeline conversions (D8)

Convert `plan`, `meditate`, `new`, `pipeline refine` to thin shims that run bundled templates. `src/cli/agents/{plan,meditate,meditate-create}.md` move into their respective `templates/` folders. `src/cli/prompts/PROMPT_kickoff.md` (used by `new`) becomes the prompt body of `templates/new/`'s scaffolder agent. Deletes the last of `src/cli/agents/` and the entire `src/cli/prompts/` folder.

**Sub-chunk split for risk control:** `plan`, `meditate`, and `new` are the user's daily drivers. Land `pipeline refine` first (lowest blast radius — interactive iteration on existing pipelines), then `plan`, then `meditate`, then `new` last (highest blast radius — touches `git init` and project bootstrap). Each sub-chunk gets its own commit and rollback point.

Outcome: the cleanup is complete. `src/` no longer holds any domain prompts. Every workflow command is a pipeline.

## Risks and mitigations

### R1. Multi-week migration during which ralph still must work for the user

**Risk:** ralph is the user's daily driver for `meditate`, `implement`, `pipeline run`. A botched migration breaks their workflow.

**Mitigation:** Each chunk lands as a series of green-tests, working-binary commits. **Pause-points between chunks are coherent; pause-points within a chunk are not.** Once a chunk starts (e.g. mid-Chunk-4 pipeline migration), the only safe stopping point is the chunk's review checkpoint. Smoke pipelines (`pipelines/smoke/`) are the canary — if they pass, the user's workflows pass.

### R2. Agent duplication across pipelines (D4)

**Risk:** ralph improves `verifier.md`; the user's project pipeline still uses an old copy from before the change. Fixes don't propagate.

**Mitigation:** This is a **feature**, not a bug. The user's pipeline should not be silently retuned by an upstream change. To re-sync, re-copy from the template manually. (Future work: a `--replace-agents` flag on `pipeline create` could automate this; the design is not part of this redesign.)

If actual pain materializes (3+ pipelines all need the same agent and copy-paste hurts), revisit D10 — sub-pipeline composition is the real answer to agent reuse.

A related sociological cost: shared schemas in `pipelines/schemas/` (e.g. canonical `verifier.json`-shaped output) cease to exist as a reusable artifact. A foreign project that wants ralph's verifier output shape must copy the agent file and inherit its `outputs:` block — this is the same drift tradeoff, applied to schemas.

### R3. Validator complexity (D5)

**Risk:** Static flow analysis with conditional edges, retry loops, and `default_<key>=` fallbacks is non-trivial. Bugs in the validator either lie (false-pass = runtime surprise) or block valid pipelines (false-fail = author rage).

**Mitigation:** TDD against fixtures with carefully constructed conditional/loop topologies. Validator emits errors as warnings for one release before becoming hard errors. Existing `gate-producer-declaration` validator (memory: 2026-04-19) is the precedent — same shape, same pattern.

### R4. Bundled template lookup (D7)

**Risk:** `resolveBundledTemplate("pipeline-create/pipeline.dot")` must work in dev (`tsx watch`) and prod (`npm install -g`). The existing `src/cli/lib/assets.ts` already handles this for the prompts folder; templates need the same treatment.

**Mitigation:** `tsup` already preserves `src/cli/*` paths in `dist/`. Templates are static assets — copy them via the same pattern used for `src/cli/prompts/`. One existing test (`src/cli/tests/assets.test.ts`) covers asset resolution; extend it.

### R5. Format edge cases in `outputs:` (D2)

**Risk:** The frontmatter parser must accept inline JSON Schema fragments (`{enum: [a, b]}`, `{type: string, maxLength: 100}`). Some YAML parsers choke on `{}` literals.

**Mitigation:** ralph already uses `gray-matter` (which delegates to `js-yaml`) for frontmatter — flow-style mappings are supported. Add a unit test for every JSON Schema shape currently used in `pipelines/schemas/*.json` to confirm.

### R6. Source-location diagnostics for frontmatter

**Risk:** D5's flow validator promises file:line:col carets reusing the `@ts-graphviz/ast` source-location infrastructure (memory: 2026-04-20). But `outputs:` and `inputs:` live in YAML inside `.md` files, not in DOT. The existing parser produces no line numbers for frontmatter content. A flow error like "input X has no producer" can point at the `.dot` node line, but a malformed `outputs:` block can only point at the `.md` file (no line).

**Mitigation:** First-pass diagnostics report `<file>` (no line) for frontmatter errors. `gray-matter` exposes a `data.lineCounter` if needed; if precise line:col is required, switch to `js-yaml` directly with `loadOptions: { lineCounter }`. Track as separate work; the redesign ships with file-only diagnostics for frontmatter and full file:line:col for `.dot`.

### R7. Validator strength gates fixture-harness rejection

**Risk:** D5 (strong validator) and D6 (no fixture harness) are linked. D6's confidence story — "validate static, run live, trust the live run" — collapses if D5 ships weak. A weak validator that misses missing-producer cases means authors discover flow bugs at runtime, exactly the pain D5 was supposed to eliminate.

**Mitigation:** Treat Chunk 2 (the validator chunk) as a release-blocking gate for the rest of the migration. Land Chunk 2 with comprehensive test coverage (every conditional/loop topology in `pipelines/illumination-to-implementation.dot` + every smoke fixture). If validator coverage falls short, do NOT ship Chunks 3-6 — the safety net isn't strong enough to support what comes next.

## Implementation reference

The detailed implementation plan with TDD steps, exact file paths, and test code lives at `docs/superpowers/plans/2026-04-27-pipeline-folder-architecture-redesign.md`. The plan has six chunks matching the migration sequence above.

Chunk 1 is fully detailed in the plan. Chunks 2-6 are outlined; each gets fully expanded as the prior chunk lands, to avoid stale plans drifting from reality discovered during execution.
