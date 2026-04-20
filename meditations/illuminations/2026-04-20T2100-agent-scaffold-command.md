---
date: 2026-04-20
status: open
description: Adding a new pipeline agent today requires hand-editing three files in three directories (`pipelines/schemas/<name>.json`, `src/cli/agents/<name>.md`, and the `.dot` node reference); a `ralph pipeline scaffold-agent <name>` command would reduce friction and make the three-file contract explicit for new authors.
---

## Core Idea

A pipeline agent in ralph-cli is a tripartite entity. The relationship is implicit — nowhere is it named — but every working agent has exactly these three pieces:

1. An output contract under `pipelines/schemas/`. Today the repo contains `pipelines/schemas/verifier.json`, `pipelines/schemas/explainer.json`, `pipelines/schemas/design-writer.json`, `pipelines/schemas/plan-writer.json`, `pipelines/schemas/memory-writer.json`, `pipelines/schemas/chat-summarizer.json`, `pipelines/schemas/meditate-observe.json`, `pipelines/schemas/tmux-test-result.json`, and `pipelines/schemas/structured-output-test.json`.

2. A rubric / system prompt under `src/cli/agents/`. The repo contains `src/cli/agents/verifier.md`, `src/cli/agents/change-explainer.md`, `src/cli/agents/design-writer.md`, `src/cli/agents/plan-writer.md`, `src/cli/agents/memory-writer.md`, `src/cli/agents/chat-refiner.md`, `src/cli/agents/meditate-create.md`, `src/cli/agents/tmux-tester.md`, `src/cli/agents/agent-creator.md`, `src/cli/agents/implement.md`, `src/cli/agents/plan.md`, `src/cli/agents/chat.md`, and `src/cli/agents/meditate.md`.

3. A `.dot` node reference binding the two, e.g. `verifier [agent="verifier", json_schema_file="schemas/verifier.json", produces="...", prompt="..."]`.

This three-file pattern is undocumented. A contributor adding a new agent must infer it by reading existing agents side-by-side. First-time adds commonly miss one of the three: schema missing yields a validate error; rubric missing yields a silent fallback prompt; `.dot` attribute drift yields a runtime misalignment where the agent emits fields the contract doesn't require and downstream consumers get undefined vars.

A `ralph pipeline scaffold-agent <name>` subcommand would generate all three artifacts from a single invocation, making the relationship syntactic rather than tribal.

Deliverables:
1. `pipelines/schemas/<name>.json` (or `pipelines/contracts/<name>.contract.json` if the renaming in `2026-04-20T2000-node-attr-rules-vs-output-contracts-naming` lands first) — stub JSON Schema with `required: []`, `properties: {}`.
2. `src/cli/agents/<name>.md` — rubric skeleton with sections: Role, Inputs, Procedure, Output format (references the contract path).
3. Printed-to-stdout `.dot` snippet ready to paste:
   ```
   <name> [agent="<name>", json_schema_file="schemas/<name>.json", produces="", prompt="..."]
   ```

## Why It Matters

This is a DX accelerator but also a correctness aid. Today agents drift out of sync with their contracts because the three-file relationship is implicit. A scaffold command makes the relationship syntactic — present from birth — rather than something you discover when a pipeline run emits the wrong fields.

The deeper win is that scaffolding is self-teaching. A contributor who runs `ralph pipeline scaffold-agent foo` learns the three-file contract by reading the files it generates. No spec needed; the artifacts themselves are the documentation.

Cross-links:

- `2026-04-15T0300-consumer-projects-need-a-ralph-manifest` — once a project-level manifest exists, scaffold can also register the new agent in `manifest.agents`. Without a manifest, scaffold still works by writing the three files directly; with one, it auto-updates the manifest entry, closing a fourth implicit relationship.
- `2026-04-20T2000-node-attr-rules-vs-output-contracts-naming` — scaffold is the forcing function that surfaces the schema-vs-contract naming confusion. Generating both files with distinct extensions and folders teaches authors the distinction by construction; if the naming illumination lands first, scaffold adopts the new names automatically.
- `2026-04-15T0400-pipeline-validate-checks-syntax-not-semantics` — the planned agent-name semantic check benefits directly from scaffold: scaffolded agents are guaranteed by construction to satisfy whatever "agent referenced in `.dot` exists on disk" check gets added to validate.
- `2026-04-20T1900-path-sensitive-var-flow-validator` — scaffolded contract + rubric + `.dot` snippet all declare produces/consumes consistently, giving the path-sensitive validator clean input rather than partial or inconsistent declarations.

## Revised Implementation Steps

1. **Add the command handler.** New exported function `pipelineScaffoldAgentCommand(name: string)` in `src/cli/commands/pipeline.ts`, sibling to the existing `pipelineValidateCommand`. Signature accepts a single positional `<name>` argument (kebab-case enforced).

2. **Create templates directory.** New folder `src/cli/templates/agent/` containing `contract.json.template` and `rubric.md.template`. Substitution is a single token `{{NAME}}` initially — YAGNI on richer templating until a second substitution is actually needed.

3. **Conflict handling.** The handler reads both target paths and exits 1 with a clear message if either already exists. Never overwrite. Never merge. The author must either pick a new name or delete the existing artifact explicitly.

4. **Register the subcommand.** Add the Commander subcommand under `ralph pipeline` in `src/cli/program.ts` where `pipeline validate` is already wired.

5. **Print the `.dot` snippet.** After both files write successfully, the handler prints a single-line `.dot` node snippet to stdout (not to a file — the author chooses which `.dot` receives it).

6. **Scenario test.** One test under `scenario-tests/` that runs `ralph pipeline scaffold-agent foo` in a tmp dir, then runs `ralph pipeline validate` on a minimal `.dot` referencing the new agent, and asserts zero errors plus both files present on disk. This end-to-end test is the contract — if scaffold produces output that validate rejects, either scaffold or validate is broken.
