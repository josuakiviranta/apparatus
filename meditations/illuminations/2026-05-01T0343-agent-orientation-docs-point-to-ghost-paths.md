---
date: 2026-05-01
description: README and docs/orientation/directory-inventory.md both point agents to four paths that don't exist (pipelines/scripts/, pipelines/schemas/, src/cli/templates/, docs/superpowers/specs/), poisoning the orientation step they are meant to accelerate.
---

## Core Idea

The two files an agent is told to read first — `README.md` and `docs/orientation/directory-inventory.md` — confidently reference directories and files that no longer exist on disk. An agent that trusts the orientation hallucinates paths before it has even glob'd anything. This is worse than missing docs: missing docs make an agent search; lying docs make it confabulate.

## Why It Matters

Agents are the primary readers of this repo, and the vision frames pipelines as "delegating to someone who already understands the shape of the problem." Stale orientation docs invert that: the helper now misleads. Concrete ghost references found right now:

- `README.md` "Pipeline script files" section points at `pipelines/scripts/mark-dispatched.mjs` and a design doc at `docs/superpowers/specs/2026-04-17-pipeline-script-files-design.md`. Both `pipelines/scripts/**` and `docs/superpowers/specs/**` return zero matches. The only live exemplar is `pipelines/illumination-to-implementation/consume.mjs`, which lives next to its pipeline, not under a shared `scripts/` dir — so the README also mis-states the convention.
- `docs/orientation/directory-inventory.md` lists `pipelines/schemas/` (zero matches), `src/cli/templates/` (zero matches, mentioned twice including a "Where to Put Things" instruction), and `superpowers/plans/` (gitignored, never on disk for a fresh checkout).
- `IMPLEMENTATION_PLAN.md` sits at project root with `Status: SHIPPED` from the v0.2.11 cleanup. It is transient cruft that the next `ralph new` template scaffolds — keeping a SHIPPED plan at root teaches the agent that root-level plans are normal.
- `CONTEXT.md` cleanly notes excisions ("Excised on 2026-04-30"). The orientation files do not — they were never reconciled when `mark_archived`, `mark_dispatched`, and the schemas/templates dirs were removed.

The `comprehensive-docs-are-agent-fuel` lens reframes this as an economic problem: every false path costs an agent a tool call to discover the lie, plus context to recover from it. ADR 0002's lesson — "location is the state, not metadata" — applies to docs too: a path either resolves or it doesn't; the doc should be reconciled the same commit the path moves.

## Revised Implementation Steps

1. Verify the four ghost paths with `glob_files` (already done for this illumination): `pipelines/scripts/**`, `pipelines/schemas/**`, `src/cli/templates/**`, `docs/superpowers/specs/**` — confirm none exist before editing.
2. README: rewrite the "Pipeline script files" section to use `pipelines/illumination-to-implementation/consume.mjs` as the worked example, and document the actual convention — script files live next to the pipeline that calls them, not in a shared `pipelines/scripts/` dir. Drop the dead link to the design doc.
3. `docs/orientation/directory-inventory.md`: remove the `pipelines/schemas/` row, strip both `src/cli/templates/` references, and either drop the `superpowers/plans/` mention or annotate it as gitignored. Re-grep the file for any other path that doesn't resolve.
4. `AGENTS.md`: tighten the "owned per-pipeline under `pipelines/<name>/<agent>.md`" line to acknowledge both pipeline roots (`pipelines/` and `src/cli/pipelines/`) — or fold it into the location decision tracked in the prior `pipeline-location-drift-vs-vision` illumination.
5. Delete `IMPLEMENTATION_PLAN.md` from project root. The shipped status is in the commit message and tag; the file is dead weight and primes the agent to leave its own plans at root.
6. Add a doc-rot guard test in `src/cli/tests/`: walk `README.md`, `AGENTS.md`, `CONTEXT.md`, and `docs/orientation/*.md`, extract every relative path-looking token (regex on `\.?/?[a-zA-Z0-9_./-]+\.(md|mjs|ts|tsx|dot|json)` plus directory-style refs), and `fs.existsSync` each. Fail the suite on the first miss. Cheap insurance, exactly the kind of guard a solo-dev tool benefits from because no human reviewer is going to catch this drift before the next agent does.
7. Once the guard is in place, run it against the `meditations/stimuli/` lenses too — they are the only inputs to the meditate pipeline, so the same drift can poison reflection sessions.
