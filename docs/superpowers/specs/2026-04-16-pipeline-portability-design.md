# Pipeline Portability Design

## Overview

Ralph's pipeline authoring prompt teaches DOT grammar but not variable-first design. Bundled pipelines embed ralph-cli's own directory conventions and agent names as string literals. Any consumer project using the pipeline preset mechanism (T2300) will run pipelines that silently target the wrong directories or agents.

This spec covers five changes to make pipelines portable by default:

1. Add a portability section to `PROMPT_pipeline_create.md` (author-facing rule)
2. Parameterize the reference example (agent name as `$variable`)
3. Add portability heuristic warnings to `ralph pipeline validate`
4. Inject available agents dynamically into the authoring prompt at `ralph pipeline create` time
5. Audit and rewrite all bundled pipeline `.dot` files

**Note:** `inputs=` declaration and hard-fail enforcement (scope item #2 from triage) are already implemented. `graph.ts` parses `inputs=`, `Graph.inputs` is typed, and `pipelineRunCommand` exits 1 when declared inputs are missing from `--var`. This spec does NOT re-implement them.

---

## Architecture

### Current state

```
ralph pipeline create
  → readFileSync(PROMPT_pipeline_create.md)
  → spawn claude -p <prompt>  [static, no runtime context]

ralph pipeline validate
  → validateGraph(graph)      [structural checks only, no portability heuristics]

PROMPT_pipeline_create.md
  → static node types table   [drifts as new handlers are added]
  → reference example         [hardcodes agent="reviewer"]
  → no portability rule       [LLM never told the rule]
```

### Target state

```
ralph pipeline create
  → composeCreatePrompt(project)   [static base + dynamic agent list]
  → spawn claude -p <composed>

ralph pipeline validate
  → validateGraph(graph)            [structural + portability heuristics]

PROMPT_pipeline_create.md
  → portability section added       [explicit variable-first rule]
  → reference example parameterized [agent="$review_agent"]
```

---

## Components

### 1. `PROMPT_pipeline_create.md` — portability section

New section inserted after node attributes, before validation rules:

```markdown
### Portability rule

Every project-specific value must be a `$variable`. Never embed paths, agent names, or directory
conventions as string literals.

| Wrong | Right |
|-------|-------|
| `agent="implement"` | `agent="$implement_agent"` |
| `prompt="Read meditations/illuminations/*.md"` | use `$illumination_path` from `inputs=` |
| `tool_command="ls docs/superpowers/specs/"` | `tool_command="ls $specs_dir"` |

Rule: if a value would differ between two projects using this pipeline, it must be a `$variable`
declared in `inputs=`.
```

Reference example update: change `review [agent="reviewer"` → `review [agent="$review_agent"`.

### 2. Portability heuristics in `validateGraph`

New rule `portability_heuristic` added after `variable_coverage` in `src/attractor/core/graph.ts`.

Static list of path pattern substrings flagged as warnings:
- `"meditations/"` — ralph-cli illumination convention
- `"docs/superpowers/"` — ralph-cli doc layout

Agent name cross-check: for any `agent="name"` attribute whose value does not contain `$`, call `agentExists(name, { bundledDir, userDir })`. If the name is unknown in the local registry, warn. This requires injecting registry options as an optional parameter into `validateGraph`.

Emits: `{ rule: "portability_heuristic", severity: "warning", message: "..." }`

### 3. `src/cli/lib/pipeline-create-prompt.ts` — dynamic prompt composition

New module. Reads the static base prompt, appends a `## Available agents` section generated from `listAgents({ userDir: join(project, ".ralph", "agents") })`.

```ts
export function composeCreatePrompt(project: string): string
```

`pipelineCreateCommand` calls `composeCreatePrompt(project)` instead of `readFileSync(getPipelineCreatePromptPath())`.

The agent section format:

```markdown
## Available agents in this project

| name | description | source |
|------|-------------|--------|
| implement | Runs Claude implement loop | built-in |
| reviewer  | Code review agent           | custom  |

Use `agent="name"` to route a node to one of these agents.
```

If no agents are registered, the section is omitted.

### 4. Pipeline audit

All `.dot` files under `pipelines/` are reviewed. Criteria:

- Hardcoded ralph-cli paths → replace with `$variable`, add to `inputs=`
- Hardcoded `agent="name"` where name is not universally available → replace with `$variable`, add to `inputs=`
- Smoke pipelines (`pipelines/smoke/`) intentionally test ralph-cli internals — only add `inputs=` where the pipeline already accepts `--var` parameters

Priority target: `illumination-to-plan.dot` (embeds `meditations/illuminations/*.md`, `docs/superpowers/specs/`, `docs/superpowers/plans/`, `agent="implement"` on every node).

---

## Data flow

```
[pipelineCreateCommand]
  project path
    → composeCreatePrompt(project)
       → readFileSync(PROMPT_pipeline_create.md)   [static base]
       → listAgents({ userDir: project/.ralph/agents })
       → buildAgentSection(agents)                 [markdown table]
    → static + "\n\n" + dynamic section
  → spawn claude -p <composed prompt>

[pipelineValidateCommand]
  .dot source
    → parseDot(src)
    → validateGraph(graph, { project })
       → ... existing rules ...
       → portability_heuristic checks
          → path substring match on prompt/toolCommand
          → agentExists() cross-check for agent= literals
    → emit warnings
```

---

## Constraints

- `composeCreatePrompt` is pure: only reads files, returns string, no side effects. Testable without spawning claude.
- Portability heuristics are **warnings only** — non-fatal. Old pipelines continue to pass validation; authors are nudged not blocked.
- Agent cross-check in validate is **advisory** — false negatives possible (custom agents in non-standard dirs). Acceptable for v1.
- No plugin system for heuristic rules — static list only. YAGNI.
- Smoke pipelines are explicitly exempt from the portability audit where literal agent names are the test subject.
- `inputs=` enforcement is already live — this spec does not change it.
