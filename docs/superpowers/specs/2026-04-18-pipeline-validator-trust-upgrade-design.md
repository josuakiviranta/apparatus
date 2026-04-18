# Pipeline Validator Trust Upgrade — Design Spec

**Date:** 2026-04-18
**Status:** Approved

## Overview

`ralph pipeline validate` is supposed to be the authoritative pre-flight check for a `.dot` pipeline: if it returns 0, the pipeline should run without a class of avoidable failures. Today, it returns 0 on pipelines that reliably fail at runtime. This design raises the validator's trust level so that a clean `validate` result eliminates three specific failure modes that occur regularly.

The triggering incident: `ralph pipeline validate pipelines/illumination-to-implementation.dot` returned `✔ Pipeline valid (22 nodes, 30 edges)`, and the subsequent `pipeline run` crashed at the `commit_push` node with four consecutive `fatal: not a git repository` errors. Root causes were a missing `--project` flag (caller used `--var project=...`, which is ignored by the reserved-var shortcut) and a tool-handler that inherits the engine's cwd instead of a declared one. The validator had no way to see either.

This upgrade closes both gaps, plus a third related one — silent acceptance of typo'd node attributes.

---

## Goals

Three classes of runtime failure must be caught at `pipeline validate` time (or, for callsite concerns, at `pipeline run` preflight):

1. **Schema drift** — unknown or typo'd node attributes (e.g. `tool_commnd=`, `promt=`) are silently ignored today. Must become `schema_error`.
2. **Missing `$project` binding** — a pipeline that references `$project` but is run without `--project` expands to empty string and silently points every `cd $project &&` at `$HOME`. Must fail preflight before any node runs.
3. **Implicit tool-node cwd** — `tool_command` runs in whatever cwd ralph was invoked from. Must be declared explicitly per-node via a required `cwd=` attribute.

**Non-goals:**

- Shell-AST analysis of `tool_command` bodies (no simulation of `$(…)` substitutions, no semantic shell parsing).
- Secrets scanning, security linting.
- Deprecation windows or two-step migrations — this is a hard break, covered by migrating all in-repo pipelines in the same plan.

---

## Architecture

Three loosely-coupled components:

**1. Zod schema module** (`src/attractor/core/schemas.ts`, new)
Single source of truth for what a valid pipeline node looks like. Exposes `GraphSchema`, `NodeSchemaUnion` (discriminated on node kind), and per-kind schemas: `AgentNodeSchema`, `ToolNodeSchema`, `GateNodeSchema`, `StartNodeSchema`, `ExitNodeSchema`. Every schema is `.strict()` — unknown attrs produce a `schema_error`.

**2. Validator integration** (`src/attractor/core/graph.ts`, modified)
`validateGraph()` runs `GraphSchema.safeParse()` first; zod issues are converted to the existing `ValidationError{ code, nodeId, message, path }` shape with code `schema_error`. The existing semantic pass (topology, reachability, `variable_coverage`, `portability_heuristic`, `script_file_missing`, `inline_script_smell`) runs afterward on the parsed graph and is unchanged in behavior.

**3. Run-time preflight and cwd wiring**
- `src/cli/commands/pipeline.ts` — `pipelineRunCommand` adds a preflight step between graph load and `variableExpansionTransform`: if any node's `prompt | toolCommand | label | scriptArgs | cwd` string attribute contains a `$project` reference and `opts.project` is `undefined`, exit 1 with a specific message (see §Error surfaces). The preflight lives in `pipelineRunCommand` only — `pipelineValidateCommand` intentionally does not run it because `--project` is not a `validate` concern. `pipelineRefineCommand`, which calls `pipelineValidateCommand` internally for its post-session validate step, inherits the same behavior and is therefore unaffected.
- `src/attractor/handlers/tool.ts` — replaces the typeof-guarded attribute reads and the `isTruthyAttr` helper with straight property access (zod guarantees them). Passes `cwd: expandVariables(node.cwd, ctx.values, defaults)` to `spawnSync`.
- `src/attractor/transforms/variable-expansion.ts` — adds `"cwd"` to the `STRING_ATTRS` list so `$project` and `$run_id` inside `cwd` resolve at graph-load time, same as `toolCommand`.

---

## Zod schema shapes

Illustrative, not final:

```ts
const BaseNodeSchema = z.object({
  id: z.string(),
  shape: z.enum(["Mdiamond", "Msquare", "hexagon", "box"]).optional(),
  label: z.string().optional(),
  condition: z.string().optional(),
}).strict();

const AgentNodeSchema = BaseNodeSchema.extend({
  agent: z.string(),
  prompt: z.string(),
  jsonSchemaFile: z.string().optional(),
  produces: z.string().optional(),
  maxRetries: z.coerce.number().int().nonnegative().optional(),
  retryTarget: z.string().optional(),
  interactive: z.union([z.boolean(), z.literal("true"), z.literal("false")]).optional(),
  // default_* attrs flattened by extractDefaults — must still pass through .strict()
  // by explicit allowlist keys (one per known default, e.g. defaultRefinements,
  // defaultTestResult). Not a catchAll.
}).strict();

const ToolNodeSchema = BaseNodeSchema.extend({
  type: z.literal("tool"),
  toolCommand: z.string().optional(),
  scriptFile: z.string().optional(),
  scriptArgs: z.string().optional(),
  producesFromStdout: z.union([z.boolean(), z.literal("true")]).optional(),
  cwd: z.string().min(1),              // REQUIRED
}).strict()
  .refine(n => !(n.toolCommand && n.scriptFile), {
    message: "script_command_conflict: script_file and tool_command are mutually exclusive",
  })
  .refine(n => n.toolCommand || n.scriptFile, {
    message: "tool_node_needs_command_or_script",
  });

const GateNodeSchema = BaseNodeSchema.extend({
  shape: z.literal("hexagon"),
  label: z.string(),
}).strict();
```

Discriminator: since there is no existing `_kind` tag in the DOT representation, a pre-zod coercion step classifies each node into one of the five kinds by looking at existing attrs (`agent=` → Agent, `type="tool"` → Tool, `shape=Mdiamond` → Start, etc.), then routes to the matching schema.

---

## Data flow

**`pipeline validate <file>`:**

```
DOT parser                       → Graph { nodes, edges }
GraphSchema.safeParse(graph)     → ValidationError[] (code: schema_error) on any issue
validateGraph() semantic pass    → ValidationError[] (existing codes)
merge + dedupe by (code, nodeId) → stable output order
exit 0 if no errors, 1 otherwise → warnings do not block
```

**`pipeline run <file> [--project <dir>] [--var k=v]...`:**

```
DOT parser                       → Graph
validateGraph()                  → hard stop on errors (same as `validate`)
preflight $project               → exit 1 if referenced but --project unset
variableExpansionTransform       → $project, $goal, $run_id expanded in all
                                   STRING_ATTRS including new `cwd`
Engine dispatches nodes          → ToolHandler.execute():
                                     spawnSync("sh", ["-c", cmd],
                                               { cwd: resolvedNodeCwd, encoding: "utf8" })
```

`cwd` itself is a literal path after expansion — no shell substitution happens inside it, matching the current `toolCommand` expansion model.

---

## Error surfaces (user-visible)

**`validate` output:**
Each violation formatted as `<nodeId>.<attr>: <message>` with the error code in brackets.
```
✗ commit_push.cwd: required [schema_error]
✗ commit_push.tool_commnd: unrecognized attribute [schema_error]
```

**`run` preflight error:**
```
✗ Pipeline references $project but --project flag not passed.
  Pass --project <folder>, not --var project=...
  Nodes referencing $project: commit_push, launch_tmux, delete_file
```

Exit 1, no partial run, no checkpoint write.

**`run` tool-node failure (unchanged):**
Existing `Command exited with code N: <stderr>` path untouched.

---

## Testing strategy

**New — `src/attractor/tests/schemas.test.ts`:**
- ToolNode requires `cwd` — missing `cwd` fails.
- ToolNode rejects both `toolCommand` + `scriptFile` present.
- ToolNode rejects neither present.
- Unknown attr (`tool_commnd=`, `xyz=`) fails strict.
- AgentNode `maxRetries` coerces `"2"` to `2`.
- GateNode requires `label`.
- Discriminator routes correctly — AgentNode attrs on a ToolNode payload fail.

**Extended — `src/attractor/tests/graph.test.ts`:**
- Zod issues surface as `ValidationError` with code `schema_error` and correct `path`.
- Existing topology, reachability, `variable_coverage`, `portability_heuristic` tests still pass.

**New — `src/cli/tests/pipeline-run-preflight.test.ts`:**
- Graph references `$project`, `opts.project === undefined` → exit 1, expected message.
- Graph references `$project`, `opts.project` set → preflight passes.
- Graph does not reference `$project` → preflight skipped.

**Extended — `src/attractor/tests/tool-handler.test.ts`:**
- `spawnSync` invoked with `cwd: <expanded node.cwd>` (mock `spawnSync`, assert third-arg).
- `$project` in `node.cwd` expands before spawn.

**Regression fixture:**
`pipelines/illumination-to-implementation.dot` (migrated) validates clean; a pre-migration snapshot included as a test fixture fails with `schema_error` on `commit_push.cwd`.

**Smoke pipelines:**
All smoke pipelines under `pipelines/smoke/*.dot` (15 files at time of writing) must pass after migration.

---

## Migration & rollout

**Inventory** — 19 `.dot` files today: 4 top-level, 15 in `pipelines/smoke/`. Every `type="tool"` node across these must declare `cwd`.

**Migration work, part of the same plan:**

1. **Audit script** — one-off `scripts/audit-tool-nodes.mjs`, dev-only, not shipped. Walks every `pipelines/**/*.dot`, lists each tool node and its current `tool_command`. Suggests a default `cwd`: a `cd $project && ...` prefix becomes `cwd="$project"` (and the prefix is removed from `tool_command`); `tmux new-window -c "$project"` becomes `cwd="$project"`; anything else is flagged for manual review.
2. **Migrate in-repo pipelines** — apply the audit output. Known touches: `commit_push`, `launch_tmux`, `delete_file` in both `illumination-to-implementation.dot` and `illumination-to-plan.dot`; smoke `tool.dot`, `tool-runtime-vars.dot`, `tmux-tester.dot`; likely others surfaced by audit.
3. **Docs** — `README.md`, `specs/commands.md`, `specs/architecture.md`: add `cwd` to the tool-node attribute list and document the `--project` preflight rule.
4. **Authoring prompts** — `composeCreatePrompt` (used by `pipeline create` and `pipeline refine`) updated to instruct the authoring agent that every tool node must declare `cwd`.

**Rollout order** (single PR, chunked commits):

```
chunk 1 — schemas.ts + schema tests (red → green, not yet wired in)
chunk 2 — wire GraphSchema into validateGraph, update graph.test.ts
chunk 3 — preflight rule in pipelineRunCommand + test
chunk 4 — ToolHandler uses node.cwd, remove dead guards
chunk 5 — migrate all 19 in-repo .dot files + regression fixture
chunk 6 — update docs + authoring prompts
```

**No deprecation window.** First install after this lands rejects any user pipeline that still has an undeclared-`cwd` tool node. Changelog entry calls it out with a one-line migration instruction (`add cwd="$project" to every tool node`) and a link to this design.

**Risk** — third-party user pipelines break on upgrade. Mitigation is the changelog note plus the preflight error messages being explicit about what to change.

---

## Affected files

- `src/attractor/core/schemas.ts` — new
- `src/attractor/core/graph.ts` — modified (wire zod into `validateGraph`)
- `src/attractor/handlers/tool.ts` — modified (drop typeof guards; use `node.cwd` directly, no re-expansion since the graph-load transform already resolved it)
- `src/attractor/transforms/variable-expansion.ts` — modified (add `cwd` to `STRING_ATTRS`; this is the single expansion site for `cwd`)
- `src/cli/commands/pipeline.ts` — modified (preflight rule)
- `src/attractor/tests/schemas.test.ts` — new
- `src/attractor/tests/graph.test.ts` — extended
- `src/attractor/tests/tool-handler.test.ts` — extended (or new)
- `src/cli/tests/pipeline-run-preflight.test.ts` — new
- `pipelines/**/*.dot` — all 19 files touched (migration)
- `scripts/audit-tool-nodes.mjs` — new, dev-only
- `README.md`, `specs/commands.md`, `specs/architecture.md` — docs updates

## Out of scope (explicit YAGNI)

- Shell-AST parsing of `tool_command`. `$(…)` substitutions remain opaque.
- Warning-only or two-step migration paths.
- `ralph pipeline migrate` codemod subcommand (considered and rejected: 19 files, one-off, audit script + manual edits is enough).
- `cwd` resolution relative to anything other than literal path. No `auto-detect-nearest-git-root` or similar magic.
