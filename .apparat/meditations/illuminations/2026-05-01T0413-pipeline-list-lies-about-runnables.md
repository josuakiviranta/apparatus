---
date: 2026-05-01
description: `ralph pipeline list` only scans `<project>/pipelines/*.dot` flat-form files, so it hides every folder-form pipeline, every `~/.apparat/pipelines/` entry, and every bundled pipeline that `resolvePipelineArg` will happily run — discovery diverges from execution from the first command.
---

## Core Idea

`ralph pipeline list` and `resolvePipelineArg` disagree about what a pipeline is. The resolver (`src/cli/lib/pipeline-resolver.ts:30-49`) walks five tiers — project folder-form, project flat-form, user-home folder-form, user-home flat-form, bundled — so `ralph pipeline run implement` works from any cwd. The list command (`src/cli/commands/pipeline.ts:380-395`) only does `readdirSync(<project>/pipelines).filter(f => f.endsWith(".dot"))`. Folder-form (`pipelines/foo/pipeline.dot`, the SSoT layout per ADR-0001) is invisible. So is everything in `~/.apparat/` and every bundled pipeline. The empty-state message even tells users to run `ralph pipeline create`, a subcommand that no longer exists. Discovery is broken in three directions at once.

## Why It Matters

The vision is "author once, run against any project." The first command a new project tries is `pipeline list` — and it returns "no workflows found" even though `ralph pipeline run implement --project here` would succeed. That single asymmetry breaks the mental model of where pipelines live before the user has done anything wrong. The previous illumination `2026-05-01T0211-pipeline-lifecycle-cli-surface-gap.md` flagged the dangling `pipeline create` reference; this is the deeper version of the same disease — the lifecycle CLI is a half-built CRUD where Run is solid, List lies, Create is gone, Refine never landed. The CRUD-as-checklist lens applies: pipelines became a persisted, addressable resource the moment the resolver started honoring multiple tiers. List has to enumerate every tier or it is not a list, it is a guess.

Compounding evidence:

- `program.ts:36-58` help text still documents the DOT anatomy with `prompt="..."` + `max_iterations` on a `box` work node. The three bundled pipelines (`implement`, `janitor`, `meditate`) all use `agent=` + agent frontmatter and never set `prompt=` on the node. So the help text contradicts the only exemplars users can copy from — same theme as `2026-05-01T0255-bundled-pipeline-exemplars-disagree.md`, but here it's program.ts itself doing the contradicting.
- `pipelineListCommand` is the natural place to print "bundled: implement, janitor, meditate" so the user sees what ralph itself ships, but it never does.
- The empty-state message hardcodes the dead `pipeline create` command — three illuminations now point at this one phrase; just delete it.

## Revised Implementation Steps

1. Rewrite `pipelineListCommand` to mirror `resolvePipelineArg`: enumerate (a) project folder-form (`pipelines/*/pipeline.dot`), (b) project flat-form (`pipelines/*.dot`), (c) `~/.apparat/pipelines/` folder-form + flat-form, (d) bundled (`getBundledPipelinesDir()`). Group output by tier with a header per tier; mark project entries that shadow a bundled name.
2. Extract a shared `enumerateResolvablePipelines(project)` helper into `pipeline-resolver.ts` so list and any future `pipeline show --all` reuse the same walk; resolver and lister must not drift again.
3. Drop every `ralph pipeline create` reference from the empty-state strings and from `program.ts` help. Replace with `Author one by adding pipelines/<name>/pipeline.dot — see bundled examples at <getBundledPipelinesDir()>`.
4. Replace the obsolete DOT anatomy in `program.ts:36-58` with a one-line pointer to a single canonical exemplar (e.g. `src/cli/pipelines/meditate/pipeline.dot`) instead of trying to teach the file format in --help. The format is too rich to summarise truthfully in a help block, and the inline anatomy has been wrong for two pipeline-redesign chunks.
5. Add a smoke test: with `--project` pointing at a directory that has no `pipelines/` folder, `pipeline list` must still print `implement`, `janitor`, `meditate` from the bundled tier. Today this test would fail — that is the point.
6. Optional follow-up (KISS check before doing it): once list and resolver share an enumerator, see whether `pipeline list` and `pipeline show <name>` can collapse into a single `pipeline show` with no args = list, with name = SVG. Two commands that share a discovery walk and a single resolver are a candidate for one command with two output modes.
