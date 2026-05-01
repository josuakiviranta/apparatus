# Design: Source-as-Truth — Excise `docs/specs/`, Adopt Discover-Then-Read Orientation

**Date:** 2026-05-01
**Status:** draft (pending review)
**Originating illumination:** none — emerged from `/grill-with-docs` session triggered by recurring spec-drift illuminations (`2026-05-01T0820-pipeline-spec-drift-poisons-agents.md`, `2026-05-01T0343-agent-orientation-docs-point-to-ghost-paths.md`, `2026-05-01T0050-pipeline-location-drift-vs-vision.md`).

## 1. Motivation

`docs/specs/` is a third documentation channel alongside `CONTEXT.md` (glossary) and `docs/adr/` (decisions). It currently holds 11 hand-authored behavioral specs plus auto-generated design docs (the latter written by `design-writer.md` from the illumination-to-implementation pipeline). A source-vs-spec audit performed during the grill session found:

- **3 specs heavily DRIFTED** — `architecture.md`, `commands.md`, `mcp-illumination.md` make claims contradicted by `src/`
- **1 DEAD** — `memory-reflector.md` describes a deleted feature
- **5 CURRENT** — `pipeline.md`, `heartbeat.md`, `daemon.md`, `loop.md`, `stream-formatter.md` happen to match source today

Recent illuminations from the janitor pipeline have repeatedly named spec drift as a hazard: agents who read `architecture.md` to "understand the project" arrive at outdated mental models and produce work that contradicts current behavior.

The root cause is structural: any document that **summarizes structure or behavior** is a future lie the moment the underlying code shifts. A periodic janitor pass cannot keep pace with commit velocity. The only sustainable answer is to remove the drift surface.

## 2. Decision Summary

1. **Delete `docs/specs/` after a salvage pass.** Any non-derivable WHY content (decisions with real trade-offs, surprising invariants, hard-to-reverse choices) is promoted to a new ADR; the rest is removed.
2. **Adopt discover-then-read orientation** in agents that previously preloaded `$specs_dir/*`. Agents discover the project's source root and docs root at runtime by Glob, then read CONTEXT.md, ADRs, README, and a live source inventory. No preloaded curated overview.
3. **Split path ownership** in pipeline-driven workflows. **Write paths** (where the pipeline emits design docs, plans, illuminations) are pipeline-owned conventions hardcoded inside agent files. **Read paths** (where the pipeline learns project state) are discovered at runtime to keep the pipeline portable to projects with non-`src/` layouts.
4. **Relocate auto-generated design docs** from the now-deleted `docs/specs/` to `docs/superpowers/specs/`. They remain ephemeral inputs to plan-writer; they do not become a new behavioral-spec store.

## 3. Architecture

### 3.1 Pipeline ownership boundary

Pipelines have two kinds of project-relative paths:

| Kind | Examples | Source of truth |
|---|---|---|
| **Write target (pipeline-owned)** | `meditations/illuminations/`, `docs/superpowers/specs/`, `docs/superpowers/plans/` | Hardcoded inside agent `.md` files. Target projects adopt this layout to use the pipeline. |
| **Read target (project-discovered)** | source root, docs root, ADR location | Discovered at runtime by Glob in the orienting agent. Supports projects using `src/`, `lib/`, `app/`, `pkg/`, `cmd/`, `internal/`, etc. |

Consequence: `pipeline.dot` declares only `inputs="project"`. No `--var` flags needed at the call site. The pipeline is portable to projects that adopt the (illuminations + superpowers/specs + superpowers/plans) write convention but use any source layout.

### 3.2 Discover-then-read orientation block

Both `verifier.md` (judging an illumination's project-fit) and `implement.md` (building from a plan) need to know current workspace status before acting. They share an orientation preamble:

```
1. Discover the project layout:
   - Source root: Glob $project for src/, lib/, app/, pkg/, cmd/, internal/ — pick directories that exist
   - Docs root: Glob $project for docs/, documentation/, architecture/ — pick what exists
   - ADR location: under the docs root, look for adr/ or decisions/

2. Dispatch parallel Sonnet subagents (up to 100) to read concurrently:
   - $project/CONTEXT.md if present (domain language)
   - All files in the discovered ADR location, if any
   - $project/README.md (mission + command surface)
   - File inventory of each discovered source root — one subagent per top-level subdir,
     returns file list + one-paragraph role summary
   - Output of `git log --since="2 weeks ago" --oneline` from $project

3. For code-level facts during work, Grep/Glob the discovered source roots on demand.
```

All instructions are positively phrased. No "Do NOT" / "Never" / "Avoid" directives — agents respond better to substitutions than prohibitions.

### 3.3 Salvage pass procedure

A one-shot extract pass over the 11 files in `docs/specs/`:

1. Dispatch 11 subagents (one per spec file). Each returns:
   - **Validity verdict:** CURRENT / DRIFTED / DEAD with `file:line` evidence (spec claim vs source reality)
   - **ADR candidates:** verbatim quotes meeting the ADR criteria (hard to reverse + surprising without context + result of real trade-off), with source line refs
   - **Confidence note** if the verdict is ambiguous
2. Triage the consolidated list. User decides which candidates become ADRs.
3. Write accepted ADRs to `docs/adr/`.
4. `git rm -r docs/specs/` after salvage and ADR writes.

Expected yield: 0–3 new ADRs across all 11 files. Most content is WHAT (derivable from source), not WHY.

## 4. Components & file edits

The `$specs_dir` pattern propagates across **four pipelines** and **two CLI commands**. The excision is system-wide — applying it to one pipeline only would leave others reading from a now-empty directory. All four pipelines and both CLI commands change in lockstep.

### 4.1 Pipeline definitions (`.dot` files)

| File | Change |
|---|---|
| `pipelines/illumination-to-implementation/pipeline.dot:4` | `inputs="project"` (drop `illuminations_dir`, `specs_dir`, `plans_dir`, `run_id`) |
| `src/cli/pipelines/implement/pipeline.dot:3` | `inputs="max_iterations,llm_model,scenarios_dir"` (drop `specs_dir`) |
| `src/cli/pipelines/meditate/pipeline.dot:2` | `inputs="steer,vision"` (drop `specs_dir`) |
| `src/cli/pipelines/janitor/pipeline.dot:4` | `inputs="project"` (drop `specs_dir`) |

### 4.2 Pipeline agents — illumination-to-implementation

| File | Change |
|---|---|
| `pipelines/illumination-to-implementation/design-writer.md` | Hardcode `docs/superpowers/specs/` as write target. Drop `specs_dir` from frontmatter `inputs:` list. Update §"Inputs you will receive" and §"Procedure" step 1 accordingly. |
| `pipelines/illumination-to-implementation/plan-writer.md` | Hardcode `docs/superpowers/plans/` as write target. Drop `plans_dir` from frontmatter `inputs:` list. Update §"Inputs you will receive" and §"Procedure" step 1 accordingly. |
| `pipelines/illumination-to-implementation/verifier.md` | Replace project-fit reads at lines 47 + 66 with the discover-then-read orientation block (§3.2). All directives positive-phrased. |
| `pipelines/illumination-to-implementation/implement.md` | Replace step 0a (the 500-subagent fan-out over `$specs_dir/*`) with the discover-then-read orientation block (§3.2). Also drop step 9999999999999 ("if you find inconsistencies in `$specs_dir/*`…") — there is no `$specs_dir` to compare against anymore. |

**Verification task (explicit):** grep `pipelines/illumination-to-implementation/memory-writer.md` and `pipelines/illumination-to-implementation/consume.mjs` for any `specs_dir` / `$specs_dir` token. Expected: zero hits. If hits found, add an edit row.

### 4.3 Pipeline agents — bundled (`src/cli/pipelines/`)

| File | Change |
|---|---|
| `src/cli/pipelines/implement/implement.md:10,16,37` | Drop `specs_dir` from frontmatter inputs. Replace step 0a with discover-then-read block. Drop the inconsistency-update step (9999999999999). |
| `src/cli/pipelines/implement/scenario-author.md:16,97` | Drop `specs_dir` from frontmatter inputs. Replace the "If `$specs_dir` documents the behavior under test…" sentence with positive guidance to ground vocabulary in CONTEXT.md, README, and source. |
| `src/cli/pipelines/meditate/meditate.md:69` | Replace the "Use `glob_files` and `read_file` to explore the project, with weighted focus on `$specs_dir/*.md` and `src/`…" instruction with a discover-then-read variant: glob source roots, read CONTEXT.md + ADRs + README, weight reads toward source code. Drop the `If $specs_dir is empty…` fallback. |
| `src/cli/pipelines/janitor/janitor.md` (or equivalent) | **Verification task (explicit):** grep this file for `specs_dir` / `$specs_dir`. Expected: zero hits per current grep. If found, edit to remove. |

### 4.4 CLI command code

| File | Change |
|---|---|
| `src/cli/commands/implement.ts:33` | Remove `specs_dir: "docs/specs"` from the `variables` map passed to the pipeline runtime. |
| `src/cli/commands/meditate.ts:85` | Remove `specs_dir: opts.variables?.specs_dir ?? "docs/specs"` from the `variables` map. |

### 4.5 Tests

Each test below references `specs_dir` as part of an existing contract. Edit or delete per the listed action.

| Test file | Action |
|---|---|
| `src/cli/tests/implement.test.ts:48–53` | Delete the `"passes specs_dir default of docs/specs"` test case (contract removed). |
| `src/cli/tests/meditate.test.ts:267–274,279–288` | Delete the `"passes specs_dir default"` and `"exploration step weights $specs_dir and src/ folders"` test cases. Add a replacement assertion that the rubric body matches the new discover-then-read shape (matches `CONTEXT.md`, matches a Glob across source roots, etc.). |
| `src/cli/tests/implement-rubric.test.ts:8–14,22–30` | Delete the `"uses $specs_dir token"` and `"declares an inputs: block listing specs_dir"` cases. Add a replacement asserting the new orientation block's positive-phrased shape. |
| `src/cli/tests/pipeline-implement-folder.test.ts:43` | Replace `expect(content).toContain("specs_dir")` with an assertion against the new `inputs="…"` content. |
| `src/cli/tests/pipeline.test.ts:184,187` | Test uses `specs_dir` only as a generic variable name to verify variable-passing — this is a runtime-engine test, not a spec-pattern test. Rename the variable to `widget_dir` to avoid implying the spec pattern still exists. |
| `src/attractor/tests/illumination-pipeline-flow.test.ts:27` | Replace `expect(info!.message).toContain("specs_dir")` with the new expected preflight message (likely names a different missing input, or test becomes obsolete if `inputs="project"` only). |

### 4.6 Repo content

| File | Change |
|---|---|
| `docs/specs/` | After salvage pass + ADR writes: `git rm -r` the whole folder. |
| `docs/orientation/directory-inventory.md` | Delete. Folder removed if empty. (Step 0a discovery replaces this curated overview.) |
| `README.md` lines 60, 158–170, 183–185 | Line 60 (the `--var specs_dir=docs/specs` example) — remove. Lines 158–170 ("Directory Map") — replace with a 4-pointer "Where to look" list: `CONTEXT.md`, `docs/adr/`, `src/`, `pipelines/`. Lines 183–185 (specs links section) — remove or replace with `CONTEXT.md` + ADR pointers. |
| `CONTEXT.md` | Append a "Documentation channels" section recording the excision and the discover-then-read pattern. Reference the new ADR. |
| `docs/adr/0004-source-and-context-as-truth-no-behavioral-specs.md` | New ADR capturing this decision. |
| `docs/adr/0005-NN-…` | Zero or more ADRs from the salvage pass (yield TBD). |

`docs/superpowers/specs/` already exists with this design doc — no `.gitkeep` needed.

### 4.7 Blast radius — historical files NOT to edit

The following hits are historical/narrative content; leave intact:

- `docs/adr/0003-scenario-tests-in-implement-pipeline.md` — append-only ADR; references `specs_dir` as the pre-existing pattern at write time. ADRs are immutable.
- `docs/superpowers/plans/2026-04-30-*.md` — historical implementation plans documenting the prior `$specs_dir` rollout.
- `meditations/illuminations/2026-05-01T*` — historical illumination narratives.
- `memory/2026-04-30-specs-relocated-to-docs.md` and adjacent — historical session memory.
- `meditations/stimuli/.triage/*` — historical scratch.
- `dist/pipelines/*` — generated by `tsup` build; will regenerate.

## 5. Data flow

Before:
```
ralph pipeline run … --var specs_dir=docs/specs --var plans_dir=docs/superpowers/plans …
  → verifier reads $specs_dir/architecture.md
  → implement preloads 500 subagents over $specs_dir/*
  → design-writer writes to $specs_dir/
  → plan-writer writes to $plans_dir/
```

After:
```
ralph pipeline run pipelines/illumination-to-implementation/pipeline.dot --project .
  → verifier discovers source/docs roots, reads CONTEXT.md + ADRs + README + live src/ inventory
  → implement runs same orientation block before coding
  → design-writer writes to docs/superpowers/specs/ (hardcoded)
  → plan-writer writes to docs/superpowers/plans/ (hardcoded)
```

## 6. Trade-offs

### 6.1 Loss of curated structural overview

Deleting `docs/specs/architecture.md`, `directory-inventory.md`, and the README Directory Map removes hand-curated narratives describing the codebase shape. New contributors landing from GitHub get less hand-holding.

**Mitigation:** the 4-pointer "Where to look" list in README directs them to `CONTEXT.md` (domain language), `docs/adr/` (decisions), `src/` (code), `pipelines/` (workflows). Each entry point is short and unlikely to relocate. `ralph --help` is the authoritative command surface.

### 6.2 Pipeline less portable to non-conforming projects

A target project that does not adopt the (`meditations/illuminations/`, `docs/superpowers/specs/`, `docs/superpowers/plans/`) write convention cannot run this pipeline without editing agent `.md` files.

**Accepted because:** the pipeline is opinionated by design. Adopting three directory paths is a low cost compared to maintaining a `--var` matrix per call site. Source-side discovery handles the larger variability (where a project keeps its source code).

### 6.3 ADR salvage may miss decisions

A skim-and-extract pass over 11 files is faster than a deep read but may overlook decisions buried in long passages. After deletion, recovery requires `git log` archaeology.

**Mitigation:** the salvage subagents are instructed to be liberal — when in doubt, surface as a candidate. The user triages explicitly. Anything genuinely lost is recoverable from git history (the files are not amnesia-deleted, only `git rm`-deleted).

## 7. Constraints

- Salvage pass + ADR writes must happen **before** `git rm -r docs/specs/` to avoid losing decision context to history-only retrieval.
- New `docs/adr/0004-…` ADR must exist **before** edits to `verifier.md`, `implement.md`, `design-writer.md`, `plan-writer.md`, since those edits reference it.
- `docs/superpowers/specs/` folder must exist **before** the first pipeline run after these changes (already satisfied — this design doc lives there).
- All test edits in §4.5 must pass **before** `git rm -r docs/specs/` to avoid leaving the repo in a broken state.
- `npm run build` must succeed after agent + command edits, since `dist/pipelines/*` is generated and consumed at runtime by `ralph implement`/`ralph meditate`.

## 8. Open questions

None at design time. Any new questions surface during implementation through plan reviewer or smoke tests.

## 9. Verification approach

### 9.1 Unit / integration tests

The test edits in §4.5 are themselves part of verification. After edits:

- `npx vitest run` — full suite passes
- `npx tsc --noEmit` — types check
- `npm run build` — `dist/pipelines/*` regenerates without error

### 9.2 End-to-end smoke

After all edits, exercise each affected pipeline against ralph-cli itself:

- **`ralph implement <project>` (bundled)** — runs the implement pipeline; verify the implement agent orients via discover-then-read and produces a commit.
- **`ralph meditate <project>` (bundled)** — runs the meditate pipeline; verify the rubric scans source roots, not a specs dir.
- **`ralph heartbeat pipeline janitor --project .`** — janitor still produces illuminations against this repo without expecting `specs_dir`.
- **`ralph pipeline run pipelines/illumination-to-implementation/pipeline.dot --project .`** — full triage flow against an illumination. Use a current alive illumination (any file in `meditations/illuminations/` at smoke time, e.g. `2026-05-01T0820-pipeline-spec-drift-poisons-agents.md`). Verifier orients, design-writer writes to `docs/superpowers/specs/`, plan-writer writes to `docs/superpowers/plans/`, implement orients. If no live illuminations exist, restore one with `git checkout HEAD~10 -- meditations/illuminations/<filename>` for the smoke run.

Each smoke must complete without engine-side preflight failures and without agent-side `$specs_dir` resolution errors. Note that **dogfooding closes here**: ralph-cli is itself the target project, so once `docs/specs/` is deleted, the discover-then-read agents must produce coherent output despite finding no specs directory — this is the desired end state, not a degenerate case.

## 10. Appendix: glossary updates for `CONTEXT.md`

A new section to append:

```markdown
### Documentation channels

ralph-cli has three documentation channels with disjoint roles:

- **`CONTEXT.md` (this file)** — domain language and glossary. Hand-curated.
  Updated during grill-with-docs sessions and ADR writes. Stable.
- **`docs/adr/`** — append-only decision records. Each captures a hard-to-reverse
  or surprising-without-context choice with its trade-off. Never edited after
  acceptance.
- **`src/` and `pipelines/`** — the authoritative description of behavior.
  Source code is truth. No spec file claims to mirror it.

Removed on 2026-05-01: `docs/specs/` (behavioral specs that drifted faster than
they could be maintained) and `docs/orientation/directory-inventory.md` (a
curated file-tree summary that drifted on every reorg). See
`docs/adr/0004-source-and-context-as-truth-no-behavioral-specs.md`.

Agents needing workspace orientation discover the project layout at runtime
(Glob source/docs roots) and read `CONTEXT.md` + `docs/adr/` + `README.md` +
a live `src/` inventory. No preloaded curated overview.
```
