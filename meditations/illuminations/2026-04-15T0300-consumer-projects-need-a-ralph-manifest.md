---
date: 2026-04-13
status: open
description: The four prior illuminations (T2300–T0200) each patch one gap in the consumer-project experience; they share a fragile assumption — that ralph will discover everything it needs by scanning at session time — which a single project manifest file (`ralph.config.js`) would replace with a stable, declared contract.
---

## Core Idea

T2300 patches distribution. T0000 patches context-blindness. T0100 patches missing patterns. T0200 patches the sealed engine. Each fix tells ralph to *scan harder* — read more files, bundle more assets, inject more instructions at session start. But scanning is fragile by nature: it succeeds when the consumer project happens to match ralph-cli's own conventions, and fails silently when it doesn't. The gap underneath all four patches is structural: ralph has no stable declaration of what a consumer project is, what it calls things, or what it expects ralph to do. Every session starts from zero. `ralph.config.js` is mentioned in T0200 narrowly as a custom-handlers hook. It is actually the missing project manifest.

## Why It Matters

Look at `pipelineCreateCommand` in `src/cli/commands/pipeline.ts`. The trigger injected into the authoring session is: `${promptContent}\n\nCreate a new pipeline named "${name}". Write it to: ${dotPath}`. T0000 proposes appending a scan instruction — "read specs/, list agents, look at existing pipelines." That instruction fires once, the agent scans, the session ends. Next `pipeline create`, same scan, same uncertainty. If the project's specs live in `doc/` not `docs/`, or its agents are named differently than ralph-cli's own, the scan produces wrong answers. Discovery is not a substitute for declaration.

`package.json` solved this for npm in 1010: the project declares its identity once, and every tool that reads it gets consistent answers. `vite.config.js`, `tsconfig.json`, `nx.json` — the entire modern JS toolchain is built around project-level declaration files. ralph's consumer projects have no equivalent. The dark factory lens makes the cost concrete: an automated pipeline running unattended against a consumer project cannot tolerate "the agent will figure it out by scanning." The machine configuration must be declared upfront, not discovered at runtime.

`pipeline-resolver.ts` currently resolves names by convention only (`$project/pipelines/$name.dot`). `pipelineRunCommand` reads variables from the DOT file itself. `pipelineListCommand` scans only local `.dot` files, showing nothing about bundled pipelines the project has opted into. Each command operates independently with no shared knowledge of the project's intent. A manifest changes this: every command reads it once at startup and gets stable, declared answers.

## Revised Implementation Steps

1. **Define `ralph.config.js` as the project manifest**, not just a handlers hook. The exported default should accept: `handlers` (Map of custom node types — T0200), `agents` (string[] of agent names used in this project), `conventions` (object: where specs, tests, and scenarios live), `variables` (object: project-level variable defaults injected before any pipeline run), `pipelines` (string[]: which bundled pipeline names this project opts into — T2300). All fields optional; ralph falls back to convention-scanning when absent.

2. **Load `ralph.config.js` once per command** in `src/cli/commands/pipeline.ts`, using `await import(join(project, 'ralph.config.js'))` with a try/catch that silently skips if absent. Pass the manifest into `pipelineRunCommand`, `pipelineCreateCommand`, and `pipelineListCommand` via a `manifest` option field. No manifest = current behavior. Manifest present = manifest wins over scanning.

3. **Feed `manifest.variables` into `variableExpansionTransform`** as a base layer before DOT-level variable resolution. This closes a gap none of T2300–T0200 addresses: consumer projects today must pass every variable on the CLI or hard-code it in the DOT file. A manifest `variables` object lets the project declare stable defaults once (e.g. `model`, `project`, `max_tokens`) and override per-run only when needed.

4. **Feed `manifest.agents` and `manifest.conventions` into the `pipelineCreateCommand` trigger** as a structured context block, replacing the open-ended scan instruction T0000 proposes. Concrete declared data beats "please scan and figure it out." The trigger becomes: `"This project uses agents: [reviewer, code-fixer]. Specs live in docs/specs/. Existing pipelines: [list]. Design the pipeline using these known names and paths."` The authoring agent gets facts, not a search task.

5. **Use `manifest.pipelines` in `pipelineListCommand`** to show a second section: `ralph built-ins (opted in)`, listing bundled pipelines the project has explicitly activated alongside their goals. This gives `pipeline list` a discovery function — users see what's available system-wide, not just what's in their local `pipelines/` folder.

6. **Scaffold `ralph.config.js` in `scaffoldProject()`** (`src/cli/commands/new.ts`) with commented-out fields and a link to docs. First-time users of `ralph new` get the manifest as part of the project skeleton — they see it exists, understand it's where they declare ralph's knowledge of their project, and fill it in as the project grows. This is cheaper than every subsequent `pipeline create` session re-discovering the same project facts from scratch.
