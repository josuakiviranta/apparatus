---
date: 2026-04-14
status: open
description: The six consumer-project illuminations (T2300–T0500) collectively require three shared mechanisms — manifest loading, asset enumeration, and variable precedence — that each illumination independently patches at its own layer, guaranteeing rework if built sequentially without a shared design contract.
---

## Core Idea

T2300 through T0500 correctly diagnose six independent gaps in the consumer-project experience. But reading them together against the actual `pipeline.ts` code reveals a problem the individual illuminations cannot see: they share three implementation seams — manifest loading, asset enumeration, and variable precedence resolution — and each illumination patches its own seam independently. T0200, T0300, and T0400 each propose a separate `await import(ralph.config.js)` call with no shared function. T2300, T0100, and T0500 each require enumerating bundled pipelines with no shared function. T0000, T0300, and T0400 each add a new layer to variable resolution with no agreed-upon precedence order. Building any one illumination first creates an interface that the next must either extend (rework) or duplicate (divergence). The integration seams need to be designed as contracts before any feature implementation begins.

## Why It Matters

Reading `pipeline.ts` directly makes the collision concrete:

**Seam 1 — Manifest loading** is proposed three times independently. T0200 proposes `await import(join(project, 'ralph.config.js'))` inside `pipelineRunCommand` to extract `handlers`. T0300 proposes the same `await import()` call in all three pipeline subcommands to extract the full manifest. T0400 proposes it again inside `pipelineValidateCommand`. If implemented in order, the codebase ends up with three `try { await import(...) } catch {}` blocks with subtly different error handling and different field extraction logic. The first implementation establishes a de-facto interface; each subsequent one either has to match it exactly or introduce a second slightly-different path.

**Seam 2 — Asset enumeration** is required by T2300 (implement `getBundledPipelinesDir()`), T0100 (surface bundled pipelines as named patterns in the create session), T0500 (scaffold `hello.dot` from a bundled template), and T0300 (`manifest.pipelines` opt-in list needs to know what's available). T2300 implements the function. T0500 explicitly acknowledges the dependency: "use the bundled template T2300 proposes, or a hardcoded minimal fallback if that isn't implemented yet." That fallback is technical debt baked into the spec before a line is written. And T0100 needs a `listBundledPipelines()` call that neither T2300 nor any other illumination specifies.

**Seam 3 — Variable precedence** is the most dangerous because it's invisible until runtime. Currently `pipelineRunCommand` calls `variableExpansionTransform(graph, { project: opts.project })` — one function, one parameter. T0300 proposes adding `manifest.variables` as a base layer below DOT-level resolution. T0000 proposes an `inputs` graph attribute as a declaration layer. T0400 proposes checking variable coverage at validate time against both of these. The function signature must change to accommodate T0300 and T0000. But none of the three illuminations specifies the new signature, the merge order, or whether the caller or the function is responsible for merging. If T0300 is built first, it adds a `manifest` parameter to `variableExpansionTransform`. If T0000 is built first, it adds `inputs` parsing. If T0400 is built first using the current signature, it validates against a simpler contract than T0300 or T0000 would require — and the validator becomes wrong the moment either of those is implemented.

## Revised Implementation Steps

1. **Design and implement `loadProjectManifest(project: string): Promise<RalphManifest | null>` first**, as a single shared function in `src/cli/lib/manifest.ts`. Define `RalphManifest` as a TypeScript interface with all fields from T0200, T0300, and the handlers contract. Every command that needs the manifest calls this one function. This eliminates the three-`await-import` divergence before it starts. Make the interface exported — it is the public contract.

2. **Design the variable resolution contract before any caller changes.** Define the precedence order explicitly in `variableExpansionTransform` or a new `resolveVariables.ts` wrapper:
   - Lowest priority: `manifest.variables` (project defaults — T0300)
   - Middle: DOT graph `inputs` defaults (pipeline defaults — T0000)
   - Highest: CLI `--var` flags (per-run overrides)
   Write this as a pure function with a typed signature: `resolveVariables(graph, manifest, cliVars)`. Both `pipelineRunCommand` and `pipelineValidateCommand` use the same function. T0400's semantic variable check reads from the resolved set, not from individual sources. Specify this before T0000, T0300, or T0400 is implemented.

3. **Implement `getBundledPipelinesDir()` and `listBundledPipelines()` in `src/cli/lib/assets.ts` before T0100, T0500, or T0300 uses them.** T0500's spec already acknowledges needing a "hardcoded minimal fallback" — that fallback is a symptom of building T0500 before T2300. The dependency order is: T2300 (assets) → T0500 (init), T2300 → T0100 (create patterns), T2300 → T0300 (manifest opt-in list). Build the asset functions first with tests, then build the consumers.

4. **Write the canonical build order as a single planning artifact** before implementation begins: T2300 (assets) → `manifest.ts` shared loader → `resolveVariables` contract → T0300 (manifest shape) → T0400 (validate, uses manifest + resolveVariables) → T0000/T0100 (authoring, uses assets + manifest) → T0200 (engine extensibility, uses manifest loader already built) → T0500 (init, uses all of the above). This is a dependency graph, not a flat queue. An agent session that picks items from the queue in list order will implement T0500's init command before `getBundledPipelinesDir()` exists, hit the dependency, add a fallback, and that fallback will never be removed.

5. **Add an integration test** that exercises the full consumer path end-to-end: `loadProjectManifest` → `resolveVariables` → `pipelineRunCommand`. This test does not exist today and none of the T-series illuminations propose it. The integration seams are only visible at the point where all three mechanisms are exercised together. A unit test for each mechanism independently cannot catch a precedence inversion or a double-import. The integration test is the early-warning system for seam collisions.
