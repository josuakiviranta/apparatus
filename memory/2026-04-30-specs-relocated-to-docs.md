# specs/ → docs/specs/ + `$specs_dir` portability convention

## What changed

The repo-root `specs/` folder (11 authoritative behavioral spec files) was relocated to `docs/specs/`. All cross-links between specs were preserved. The legacy `docs/superpowers/specs/` design-history dir is intentionally untouched.

## Portability convention

Pipeline agent rubrics that scan specs now reference `$specs_dir` instead of the literal path `specs/`. Important nuance: the runtime does **not** substitute `$specs_dir` in agent prompt bodies. The runtime expands `$varname` only inside `toolCommand`, `cwd`, and `maxIterations` strings. Instead:

1. The pipeline node declares `specs_dir` in its `inputs="..."` attribute.
2. The runtime auto-injects an `## Inputs` block into the agent prompt:
   ```
   <specs_dir>docs/specs</specs_dir>
   ```
3. The literal `$specs_dir` token in the rubric body is a **convention** signaling "look up `specs_dir` in the Inputs block."

Each rubric carries a fallback sentence: "If `$specs_dir` is empty in the Inputs block, default to `docs/specs`." This keeps rubrics safe outside a pipeline context.

## Default-path threading

CLI commands `implement` and `meditate` pass `specs_dir: "docs/specs"` in `pipelineRunCommand`'s `variables` map. Override at invocation via `--var specs_dir=custom/path`.

## Rubrics affected

- `src/cli/pipelines/{implement,meditate}/*.md`
- `pipelines/illumination-to-implementation/{implement,verifier}.md`
- `pipelines/janitor/janitor.md`

## Concept-reference holdouts (intentional)

- `verifier.md:65` ("Cited specs:")
- `memory-writer.md:144` ("Do not touch source code, specs, or pipelines")

These use "specs" as an English noun, not a filesystem path — left as-is.

## Validator gotcha

`inputs_missing_frontmatter` (graph.ts:439–453) checks only that the rubric YAML carries an `inputs:` key — it does NOT verify that body `$var` references are covered by frontmatter. So `meditate.md`'s rubric uses `$specs_dir` but its frontmatter still lists only `[vision, steer]` and is not flagged today. Worth knowing if validator tightens.

## Out of scope

- Renaming `docs/superpowers/specs/` — kept for design history.
- Adding a dedicated `--specs-dir` CLI flag — `--var specs_dir=...` already suffices.
