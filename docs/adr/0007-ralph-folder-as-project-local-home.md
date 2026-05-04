# Project-Local `.ralph/` as Single Home for Ralph-Touchable State

## Context

Ralph-touchable state in a target project was scattered across multiple
locations: `meditations/illuminations/` and `meditations/stimuli/` at
the project root, `~/.ralph/<projectKey>/runs/` in user-home for run
state, and `.ralph/docs/adr/` / `.ralph/CONTEXT.md` / `.ralph/VISION.md` at the project root (pre-migration).
Agents working inside a project had to cross the user-home boundary to
read run state, and a project's "ralph-shape" was implicit — no single
folder declared "this is a ralph project."

## Decision

A single project-local folder `<project>/.ralph/` becomes the home for
everything ralph-touchable in a target project:

```
.ralph/
├── pipelines/                    ← project-local pipelines (override bundled)
├── meditations/
│   ├── illuminations/
│   └── stimuli/                  ← project-local stimuli (bundled stimuli stay in ralph-cli)
├── memory/                       ← project-local agent memory
├── docs/
│   └── adr/
├── VISION.md
├── CONTEXT.md
└── runs/                         ← gitignored (state, checkpoints, jsonl)
```

A new `ralph init` command replaces `ralph new`. It is in-place:
`mkdir foo && cd foo && ralph init` scaffolds the tree, runs `git init`
if not already a repo, and appends `.ralph/runs/` to `.gitignore`. No
kickoff flow, no `--migrate` flag, no `config.json`. `ralph init` is
idempotent — running on an existing `.ralph/` fills missing subfolders
without overwriting.

Bundled pipelines and stimuli stay in `src/cli/pipelines/` (shipped via
npm). `.ralph/pipelines/` is the override tier, read first at runtime.
Run state moves from `~/.ralph/<projectKey>/runs/` into
`<project>/.ralph/runs/` — the user-home tier and project-key map go away.

## Trade-offs

- **vs ADR 0001 (agents live next to pipeline, no global library).**
  ADR 0001 rejected a per-user `~/.ralph/agents/` tier as schema-coupled
  drift. This ADR re-introduces a per-project tier, but for *pipelines*
  (the orchestrating web), not free-floating agents. Agents still live
  next to their pipeline — inside `.ralph/pipelines/<name>/` for
  project-local pipelines, `src/cli/pipelines/<name>/` for bundled ones.
- **Schema coupling.** Project-local pipelines are still ralph-cli DSL
  files; refactors to the DSL can break them. Solo-dev vision = small
  blast radius (one operator, author of both ralph-cli and consuming
  projects), so this risk is accepted without version-pinning machinery.
- **Convention over configuration.** No `config.json`. Paths are fixed
  by convention; per-invocation overrides stay as CLI flags or shell
  aliases.
- **Discoverability.** ADRs and CONTEXT.md move under `.ralph/`, which
  reduces outsider discoverability on GitHub. Solo-dev vision = non-issue;
  `README.md` at root remains the human entry point, `.ralph/` is the
  agent entry point.
- **Reverses earlier vision.** VISION.md previously stated "not
  per-project bespoke webs — pipelines are cross-project, project-
  specificity is handled by runtime variables." That stance is reversed:
  pipelines can now live per-project so meditation can iterate on them.
  Bundled pipelines remain the cross-project tier.

---

**Update 2026-05-04:** Partly superseded by [ADR-0008](0008-partial-revert-of-ralph-folder.md). The clauses of this ADR placing `CONTEXT.md`, `VISION.md`, `docs/adr/`, and the unused `memory/` slot under `.ralph/` are reversed; the remainder (project-local pipelines, meditations, run state, two-tier resolver) stands.
