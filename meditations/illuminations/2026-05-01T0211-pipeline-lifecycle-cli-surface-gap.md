---
date: 2026-05-01
description: ralph pipeline list points users to `ralph pipeline create` but the command no longer exists in program.ts; spec, tests, empty templates dir, and the orphaned janitor pipeline all reveal a half-removed creation/edit surface.
---

## Core Idea

Pipelines are ralph's first-class primitive, yet only their *execution* surface is wired to the CLI. `ralph pipeline create` and `ralph pipeline refine` are documented in `docs/specs/pipeline.md` and referenced by `ralph pipeline list`'s own "no pipelines found" hint, but neither command is registered in `src/cli/program.ts`. The `janitor` pipeline ships in `src/cli/pipelines/janitor/` and is bundled into `dist/`, yet only `ralph heartbeat pipeline janitor` can run it — no top-level shim exists, unlike `ralph meditate` and `ralph implement`. The result is a CRUD-checklist failure for the pipeline primitive itself: ralph can run pipelines, but tells users to author them by hand-editing `.dot` files while pointing them at a `pipeline create` command that doesn't exist.

## Why It Matters

The vision is "author pipelines once, run anywhere." Right now the *authoring* half is missing and lying about it. Three independent signals confirm half-removed scaffolding:

- `src/cli/commands/pipeline.ts:434` and `:441` — `pipelineListCommand` prints `Create one with: ralph pipeline create <name> --project <folder>`. That command path doesn't exist; `program.ts` registers only `run | validate | list | trace | show`. Users on a fresh project hit this exact hint and get nothing.
- `src/cli/tests/pipeline.test.ts:340,346` still assert on the same broken `ralph pipeline create` string — tests have been quietly catching what the CLI no longer does.
- `docs/specs/pipeline.md:23-26` — the canonical spec table lists `pipeline create <project>` and `pipeline refine <name>` as commands, plus `stack.manager_loop` as a node type ("Not yet implemented"). All three are zombies: documented, partially in code (`src/attractor/handlers/manager-loop.ts`, `dist/templates/.gitkeep`), but unreachable from the binary.
- `src/cli/pipelines/janitor/` is fully shipped as a bundled pipeline and exercised in `pipeline-janitor-folder.test.ts`, yet `program.ts` has no `ralph janitor` command. It is reachable only through `heartbeat.ts:161`. By comparison, `meditate` and `implement` — the other two bundled pipelines — both have one-line shims (`commands/meditate.ts`, `commands/implement.ts`). Janitor is the odd one out, and that asymmetry is invisible to anyone reading `--help`.

This connects directly to the steer ("pipeline creation, management and running simpler with KISS"). Right now creation is fully manual, and the only docs pointing toward a smoother path are pointing at deleted commands. Until that surface is either rebuilt or honestly marked dead, every "where do pipelines live?" question dead-ends.

## Revised Implementation Steps

1. **Stop the lie in `pipelineListCommand`.** Replace the `Create one with: ralph pipeline create ...` strings at `src/cli/commands/pipeline.ts:434,441` with a hint that matches reality (e.g. `Author one as <project>/pipelines/<name>/pipeline.dot — copy from src/cli/pipelines/meditate/ for a starting shape`). Update the matching expectations in `src/cli/tests/pipeline.test.ts:340,346`.
2. **Make a decision on `pipeline create` / `pipeline refine`.** Either (a) re-implement them as a single thin command that scaffolds `pipelines/<name>/pipeline.dot` from a starter template (the steer points here), or (b) delete the rows from `docs/specs/pipeline.md`, drop `dist/templates/.gitkeep`, and remove `src/cli/tests/tsup-templates-copy.test.ts`. Don't keep half. Memory shows they were shipped at v0.1.55/v0.1.59 and silently removed since — pick a side.
3. **Promote `janitor` to a top-level shim or delete the pipeline.** If janitor is meant to be runnable, add `src/cli/commands/janitor.ts` mirroring `commands/meditate.ts` (resolve bundled, delegate to `pipelineRunCommand`). If it is heartbeat-only, document that explicitly in `docs/specs/pipeline.md` and `docs/specs/commands.md`, and skip the shim. The current "exists, is tested, but isn't on the CLI" state is the worst of both options.
4. **Resolve `stack.manager_loop` zombie node.** `src/attractor/handlers/manager-loop.ts` is registered but the spec marks it "Not yet implemented". Either build sub-pipeline composition (memory `2026-04-27-deferred-sub-pipeline-composition.md` already deferred this) or delete the handler file plus its registration in `engine.ts` and the corresponding row in the spec. Dead code that the spec advertises is worse than missing code.
5. **Add a "lifecycle audit" test.** One test that walks `program.ts` registered commands, walks the spec's commands table, and fails on any mismatch in either direction. Same lens as `tsup-templates-copy.test.ts` but pointed at the spec/CLI gap. Cheapest possible insurance against this drift recurring.
6. **Then — only then — design the authoring surface.** Once steps 1-5 leave a coherent baseline, the steer's request ("simpler pipeline creation") becomes a real design question rather than a bug fix. The shape worth exploring: a `ralph pipeline new <name> [--from <existing>]` that copies a chosen pipeline folder into `<project>/pipelines/<name>/`, runs `validate`, opens `pipeline.dot` in `$EDITOR`. Authoring = "fork an example", not "read a spec and start typing dot syntax".
