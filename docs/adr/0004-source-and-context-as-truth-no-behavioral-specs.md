# 0004: Source code, CONTEXT.md, and ADRs are the only authoritative documentation

**Date:** 2026-05-01
**Status:** Accepted

## Context

ralph-cli accumulated a third documentation channel — `docs/specs/` — alongside the glossary (`.ralph/CONTEXT.md`) and decision records (`.ralph/docs/adr/`). It held 11 hand-authored behavioral specs (`architecture.md`, `commands.md`, `pipeline.md`, `daemon.md`, `loop.md`, `heartbeat.md`, `meditate.md`, `mcp-illumination.md`, `memory-reflector.md`, `stream-formatter.md`, `README.md`) plus auto-generated design docs from the illumination-to-implementation pipeline.

A 2026-05-01 audit found 3 of 11 files heavily DRIFTED (claims contradicted by `src/`), 1 DEAD (described a removed feature), and 5 nominally CURRENT but with no mechanism preventing future drift. Recent illuminations (`2026-05-01T0820-pipeline-spec-drift-poisons-agents.md`, `2026-05-01T0343-agent-orientation-docs-point-to-ghost-paths.md`) named spec drift as a hazard for any agent reading these files for project context.

Pipeline agents — `verifier.md`, `implement.md`, `meditate.md`, `scenario-author.md` — preloaded `$specs_dir/*` to learn the project, then made decisions against an outdated mental model. The drift was not a maintenance problem; it was a structural one. Any document that summarizes structure or behavior is a future lie.

## Decision

The only authoritative documentation in this repo is:

1. **`.ralph/CONTEXT.md`** — domain language and glossary. Hand-curated. Updated during grill-with-docs sessions and ADR writes.
2. **`.ralph/docs/adr/`** — append-only decision records. Each captures a hard-to-reverse, surprising-without-context choice with its trade-off. Never edited after acceptance.
3. **Source code** in `src/` and `pipelines/` — the truth about behavior. No spec file claims to mirror it.

`docs/specs/` is deleted. Any non-derivable WHY content from its 11 files is salvaged into supplementary ADRs before deletion.

Pipeline agents that need workspace orientation discover the project layout at runtime (Glob source/docs roots) and read `.ralph/CONTEXT.md` + `.ralph/docs/adr/` + `README.md` + a live source inventory. No preloaded curated overview. Instructions are positively phrased — substitution, not prohibition.

The `docs/specs/architecture.md`-style overview is replaced by step-0a-style discovery in two agents (`verifier.md`, `implement.md`) and equivalent rubric updates in three more (`scenario-author.md`, `meditate.md`).

The `$specs_dir` pipeline variable is removed from all four pipelines (`pipelines/illumination-to-implementation/`, `src/cli/pipelines/{implement,meditate,janitor}/`) and both CLI commands that plumb it (`src/cli/commands/{implement,meditate}.ts`).

Auto-generated design docs from the illumination-to-implementation pipeline now land in `docs/superpowers/specs/` (a previously-intended-but-unbuilt folder), not `docs/specs/`. Plans continue to land in `docs/superpowers/plans/`. Both write paths are pipeline-owned conventions hardcoded inside agent files.

## Consequences

**Positive:**
- Drift surface eliminated. Source code, the one thing always true, becomes the read target for behavior questions.
- Pipeline call sites simplify to `ralph pipeline run <dot> --project .` with no `--var` flags.
- Pipeline portability across target projects with different source layouts (`src/`, `lib/`, `app/`, `pkg/`, etc.) via runtime discovery.
- Onboarding signal sharper: README points at four entry points (`.ralph/CONTEXT.md`, `.ralph/docs/adr/`, `src/`, `pipelines/`) with stable locations.

**Negative:**
- New contributors landing from GitHub get less hand-holding. Mitigated by README's "Where to look" pointer list.
- Pipeline less portable to projects that do not adopt the (`.ralph/meditations/illuminations/`, `docs/superpowers/specs/`, `docs/superpowers/plans/`) write convention — they would need to edit agent `.md` files.
- Salvage pass may miss decisions buried in long passages. Mitigated by liberal candidate-surfacing during salvage and `git log` archaeology if anything is later needed.

## Related

- Spec: `docs/superpowers/specs/2026-05-01-source-as-truth-no-behavioral-specs-design.md`
- ADR-0001 (`agents-live-next-to-pipeline`) — same principle: kill abstraction surfaces that drift.
- ADR-0002 (`consume-only-illumination-lifecycle`) — same shape: collapse multi-state taxonomies into one source of truth.
- Recent illuminations naming spec drift: `.ralph/meditations/illuminations/2026-05-01T0820-pipeline-spec-drift-poisons-agents.md`, `.ralph/meditations/illuminations/2026-05-01T0343-agent-orientation-docs-point-to-ghost-paths.md`, `.ralph/meditations/illuminations/2026-05-01T0050-pipeline-location-drift-vs-vision.md`.
