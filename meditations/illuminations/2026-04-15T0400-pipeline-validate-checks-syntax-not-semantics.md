---
date: 2026-04-13
status: open
description: pipelineValidateCommand already exists and checks graph structure, but validates nothing about whether the pipeline will actually work in the target project — no agent name verification, no variable coverage check, no path plausibility — leaving consumer projects with no feedback until a live run fails.
---

## Core Idea

`pipelineValidateCommand` in `src/cli/commands/pipeline.ts:30-58` exists today. It parses the DOT file, runs `validateGraph`, and reports syntax errors and structural warnings. What it never does: ask whether the pipeline makes sense for the project it is about to run against. It doesn't check that `agent="reviewer"` corresponds to an agent that actually exists anywhere. It doesn't check that `$spec_file` will resolve to something at runtime. It doesn't check that referenced paths like `meditations/illuminations/*.md` exist in the target project directory. The validate command is a syntax gate. It cannot be a correctness gate because it has no knowledge of the project. The result: consumer projects discover misconfiguration at runtime, mid-run, after an agent has already consumed tokens and mutated files.

This gap sits at the intersection of T0000 (inputs declaration), T0200 (agent registration), and T0300 (manifest). Each of those illuminations adds structure to the project's knowledge of itself. None of them wired that structure into the validate command. The semantic validation layer is unbuilt.

## Why It Matters

The gene transfusion lens names the condition precisely: the exemplar paired with tests is what makes a pattern transferable. Without semantic validation, the "exemplar" (a `.dot` file) cannot be validated against a new project context — the developer must run the pipeline and observe failure. For consumer projects, this is especially costly: they don't have ralph-cli's internal smoke suite, they have no local exemplar pipelines (T0000 and T2300 address this but are unimplemented), and they are most likely to author pipelines with wrong agent names and missing variables precisely because `pipeline create` is still context-blind (T0000 unimplemented).

Look at what `validateGraph` currently checks (`src/attractor/core/graph.ts`): structural rules — every non-exit node has at least one outgoing edge, every conditional edge has a condition string, start/exit node counts are valid. Zero project-aware rules. Now look at what the T0300 manifest enables: `manifest.agents` declares every agent name the project uses. The `inputs` graph attribute (proposed in T0000) declares every `$variable` the pipeline expects. The two-tier pipeline resolver (T2300) knows which directories are valid pipeline homes. With the manifest loaded, `pipelineValidateCommand` can check:

1. Every `agent=` attribute in the DOT matches an entry in `manifest.agents` or `~/.ralph/agents/`.
2. Every `$variable` used in node attributes appears in the graph's `inputs` attribute or `manifest.variables`.
3. Every static file path in `prompt` or `schema` attributes (strings ending in `.md`, `.json`, `.txt`) exists relative to the project root.

None of this requires running the pipeline. All of it catches real errors before a run starts. And in CI — where `headless_safe=false` pipelines are refused anyway — `ralph pipeline validate --project .` becomes the natural pre-run gate that currently doesn't exist.

## Revised Implementation Steps

1. **Add a `project` parameter to `validateGraph`** in `src/attractor/core/graph.ts`. When `project` is provided, the function gains access to project-specific facts. Keep the current structural rules entirely unchanged — only add new semantic rules that fire when `project` is non-null. This preserves backward compatibility with every existing caller.

2. **Implement agent-name validation.** In the new semantic rule set, for every node with an `agent` attribute: check `join(homedir(), '.ralph', 'agents', agentName)` exists (or, once T0300 is implemented, check `manifest.agents.includes(agentName)`). Emit a `severity: "warning"` diagnostic (not error) for unknown agents — the agent directory may not be populated on all machines, but missing names in a declared manifest are unambiguous errors.

3. **Implement variable coverage validation.** For every `$variable` reference found in any node attribute (already scannable via the `variableExpansionTransform` logic in `src/attractor/transforms/variable-expansion.ts`): check that it appears in the graph's `inputs` attribute string or in `manifest.variables`. Emit `severity: "warning"` for undeclared variables — this is the runtime silence described in the T2100 illumination, surfaced at validation time instead.

4. **Implement static path existence check.** For any node attribute value that looks like a file path (contains `/` and ends in a known extension), resolve it relative to `project` and check existence. Emit `severity: "warning"` for missing paths. This catches the most common consumer misconfiguration: pipeline prompts that reference `specs/` or `meditations/illuminations/` paths copied from ralph-cli's own internal pipelines.

5. **Wire manifest loading into `pipelineValidateCommand`.** After loading the DOT file, attempt `await import(join(project, 'ralph.config.js'))` with silent fallback. Pass the manifest (or `null`) alongside `project` to `validateGraph`. This is the same manifest loading T0300 proposes for `pipelineRunCommand` — validate should load it first, not last.

6. **Expose `ralph pipeline validate` as the recommended CI step in `README.md` and `specs/`.** Once semantic validation is in place, the command becomes worth advertising: `ralph pipeline validate my-pipeline --project .` exits 0 only when the pipeline is structurally sound and project-consistent. This gives consumer projects a pre-run gate they can add to their CI without the cost or side effects of an actual run.
