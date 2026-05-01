---
date: 2026-05-01
description: meditateCommand calls resolveBundledPipeline("meditate") directly while implementCommand goes through pipelineRunCommand("implement") — so project-local pipelines/meditate/pipeline.dot is silently ignored, breaking the resolver chain that the implement help text advertises and the test even pins the bundled-only path.
---

## Core Idea

`ralph implement` and `ralph meditate` resolve their bundled pipeline differently. `implementCommand` passes the bare name `"implement"` into `pipelineRunCommand`, which routes through `resolvePipelineArg` (project-folder → `~/.ralph/pipelines/` → bundled). `meditateCommand` bypasses that chain by calling `resolveBundledPipeline("meditate")` and handing `pipelineRunCommand` an absolute path. The result: a user who drops `pipelines/meditate/pipeline.dot` into their project gets the override honored for `ralph pipeline run meditate` and `ralph heartbeat pipeline meditate`, but silently ignored for `ralph meditate`. Same pipeline name, three different resolution policies depending on the verb.

## Why It Matters

This contradicts the one-line mental model the resolver was built for, and contradicts the implement command's own help text which advertises the override pattern (`The pipeline can be overridden by placing pipelines/implement.dot in your project folder.`). Meditate has no such note — and the divergence is now load-bearing: `src/cli/tests/meditate.test.ts:meditateCommand (shim)` asserts the dotFile path `endsWith("meditate/pipeline.dot")`, pinning bundled-only resolution as the contract. The asymmetry will replicate. If `ralph janitor` becomes a top-level command tomorrow, an author copying meditate as the exemplar will reach for `resolveBundledPipeline` again; copying implement will reach for the resolver chain. The vision treats pipelines as cross-project orchestration logic, but the CLI surface gives the user three rules of thumb instead of one. Per the open-question in `VISION.md` ("how authoring/iteration should work are still being designed"), this is one of the small surface decisions that bleeds into authoring confidence.

## Revised Implementation Steps

1. In `src/cli/commands/meditate.ts:meditateCommand`, replace `resolveBundledPipeline("meditate")` with the bare name `"meditate"` and let `pipelineRunCommand` route through `resolvePipelineArg` like `implement` does. Drop the `resolveBundledPipeline` import if it becomes unused.
2. Update the failing test in `src/cli/tests/meditate.test.ts` (the `meditateCommand (shim)` describe block) to assert the bare name flowed through, not the bundled `endsWith` path. Add a positive test: a project-local `pipelines/meditate/pipeline.dot` resolves and is invoked instead of the bundled file.
3. Add a one-liner to `meditate`'s `--help` mirroring the implement note: `The pipeline can be overridden by placing pipelines/meditate/pipeline.dot in your project folder.` Same note belongs on any future bundled-shim command.
4. Audit other entry points that hand `pipelineRunCommand` an already-resolved absolute path when a bare name would do — `meditateCommand` is the only current offender, but the daemon runner should be re-checked since it spawns these commands in turn.
5. Document the resolver chain (project → `~/.ralph/pipelines/` → bundled) once in `docs/specs/pipeline.md` and link to it from `directory-inventory.md`, so the next bundled shim author has a single reference instead of two implementations to copy from.
