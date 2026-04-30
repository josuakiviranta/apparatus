# Consume-only illumination lifecycle and janitor refocus

**Status:** accepted (2026-04-30)

## Context

The illumination-to-implementation pipeline distributed illumination files
across three sibling directories: `meditations/illuminations/` (open +
dispatched), `meditations/archived-illuminations/` (declined), and
`meditations/implemented-illuminations/` (successfully implemented). State
transitions were performed by three MCP tools — `mark_dispatched`,
`mark_implemented`, `mark_archived` — each of which moved files between
directories and rewrote frontmatter to flip a `status` field. A fourth
state, `dispatched`, captured "plan written, implementation deferred"; the
janitor agent existed largely to reconcile this state by walking
dispatched illuminations whose plans had completed and flipping them to
implemented.

The side folders accumulated. No agent or human read them after
consumption. The lifecycle vocabulary (`mark_archived`, `archive_reason`,
`mark_implemented.new_path`) suggested preservation that the operator did
not value. The janitor, designed around a state that produced no
operator-visible value, did mechanical bookkeeping no one inspected.

## Decision

The illumination lifecycle collapses to two states by location: **alive**
(file present in `meditations/illuminations/`) or **consumed** (file
deleted). There are no side folders.

The three lifecycle tools collapse to one:
`consume(filename, reason: "implemented" | "declined")`. It performs
`git rm <path>` and commits with `meditate: consume <filename> (<reason>)`.
No frontmatter rewrite, no validation, no `note` parameter, no return
path. The decline reason exists only in the commit message; recoverable
via `git log --grep`.

`list_illuminations` drops its `status` parameter. Every file in the
folder is alive — there is nothing to filter.

The `dispatched` state and `mark_dispatched` tool are deleted. The
defer-and-resume pipeline path is removed: the illumination-to-implementation
gate now offers two choices (implement, decline). Plan files no longer
carry `illumination_source` frontmatter; filename slug-mirroring between
illumination and plan is incidental, not relied upon.

The janitor agent is refocused. It no longer walks the (now-deleted)
dispatched state. Its new role: scan source/workspace through a KISS
lens, identify bloat / YAGNI / refactor opportunities, and write one
illumination per candidate via `write_illumination`. Tools available:
`Read`, `Grep`, `Glob`, `Bash`, `list_illuminations` (for dedup),
`write_illumination`. The `pipelines/janitor/pipeline.dot` graph stays
single-agent; only the agent's prompt changes.

## Considered alternatives

- **(a) Delete-only, keep three tools.** Strip the move logic from
  `mark_archived` / `mark_implemented`, keep their names. Rejected: the
  names lie about what they do, the API surface is artificially wide,
  and `mark_dispatched` would still produce a state with no consumer.
- **(b) Keep `dispatched`, delete only the side folders.** Preserves the
  defer-and-resume capability. Rejected: the operator does not use the
  deferred path; the only consumer of the `dispatched` state was the
  janitor's reconciliation walk, which itself produced no value the
  operator cared about.
- **(c) Replace folders with a SQLite/JSONL ledger of past illuminations.**
  Preserves audit trail without folder bloat. Rejected: introduces a new
  bookkeeping surface that itself rots; commit messages already provide
  an adequate trail and are recoverable via `git log`.
- **(d) Keep `mark_archived` writing `archive_reason` to frontmatter
  before delete.** Preserves the why-declined data structurally.
  Rejected: file is deleted milliseconds later; the rewrite is
  cosmetic. Commit message captures the reason at equivalent fidelity
  with less code.

## Consequences

- The pipeline can no longer **defer implementation**. The gate must
  finalize a decision in-run: implement or decline. Operators who want
  a draft-only pass must adapt by running the pipeline and accepting
  that an implemented plan will result, or by exiting before the
  implement-loop node.
- The decline reason is durable only in `git log`. Searching past
  declines requires `git log --grep="declined"`. No ls-able directory
  of past judgments.
- The janitor's old design (lifecycle reconciliation across illuminations
  and plans, captured in pre-2026-04-30 commits to `pipelines/janitor/janitor.md`
  and the memory entry at `memory/2026-04-25-state-machine-exists-verifier-ignores-it.md`)
  is now historical. A future need for that reconciliation would require
  redesigning the janitor — supersede this ADR if that happens.
- Tests that asserted file moves into side folders are deleted; tests
  for the consume tool assert deletion + commit instead. Test fixtures
  carrying `status: archived` or `status: dispatched` frontmatter are
  removed.
- The MCP server's `list_illuminations` rejects `status` arguments
  (parameter no longer exists). External callers passing a `status`
  field will fail at the schema layer.
- One surviving illumination on disk
  (`meditations/illuminations/2026-04-30T1732-janitor-plan-no-frontmatter.md`)
  has its `status: open` frontmatter line stripped as part of the
  rollout. The single archived illumination
  (`meditations/archived-illuminations/2026-04-30T1550-implement-pipeline-stranded-in-src-cli.md`)
  is `git rm`'d.
