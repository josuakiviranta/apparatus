# Design: Partial Revert of `.ralph/` — Restore Third-Party Convention Files to Repo Root

**Date:** 2026-05-04
**Status:** draft (pending review)
**ADR:** `docs/adr/0008-partial-revert-of-ralph-folder.md` (to be written; supersedes parts of ADR-0007)

## 1. Motivation

ADR-0007 (2026-05-04) introduced `<project>/.ralph/` as "the home for everything ralph-touchable." The principle is sound for ralph-defined artefacts (pipelines, meditations, runs, agents). It is **wrong** for files that follow conventions older than ralph and owned by the broader software-engineering ecosystem:

| File | Convention owner | Pre-dates ralph? |
|------|------------------|------------------|
| `CONTEXT.md` | DDD glossary / skill ecosystem (`grill-with-docs`, `improve-codebase-architecture`) | yes |
| `VISION.md` | generic project-doc convention | yes |
| `docs/adr/` | architecture-decision-records (Nygard, ~2011; MADR) | yes |

ADR-0007's framing — "ralph reads it, therefore ralph owns it" — does not hold. Ralph reads `package.json` too; that does not make `package.json` a ralph artefact. **Reading a file is not the same as defining its convention.**

Three observable symptoms:

1. **Skill landing failure.** Third-party skills (`grill-with-docs`, `improve-codebase-architecture`, etc.) hard-code `CONTEXT.md` and `docs/adr/` at repo root. They look there, find nothing, and either create a new root file (drift) or operate without context (degraded). The skill ecosystem assumes the standard convention; `.ralph/CONTEXT.md` is invisible to it.

2. **Discoverability drop on GitHub.** ADRs and CONTEXT.md under `.ralph/` are less discoverable to outside readers, code-review tools, and IDE outliners that surface root-level docs by convention.

3. **Incomplete migration drift.** ADR-0007 declared the migration "big-bang" but two unmigrated dirs remain at repo root (`pipelines/`, `memory/`) and the planned `.ralph/` slots for them are empty. The `memory-writer` pipeline node still writes to root `memory/`, contradicting ADR-0007's diagram.

This design documents the **partial revert**: third-party convention files return to repo root, ralph-defined artefacts stay in `.ralph/`. ADR-0008 supersedes the relevant clauses of ADR-0007.

### 1.1 Alternatives considered and rejected

- **`CONTEXT-MAP.md` at repo root pointing into `.ralph/`.** The skill ecosystem documents this as the multi-context escape hatch (`grill-with-docs/SKILL.md`). One ~10-line file, no moves. **Rejected because:** It only fixes the *primary* skill ecosystem; humans browsing the repo on GitHub, IDE doc outliners, and any tool not aware of CONTEXT-MAP.md still expect root `CONTEXT.md`. The map adds an indirection that downstream tools must learn. Worse, it codifies "ralph claims this convention" rather than admitting "ralph should not have claimed it."
- **Patch the skills themselves to look at `.ralph/CONTEXT.md` first.** Editable: skills live under `~/.claude/skills/<name>/SKILL.md`. **Rejected because:** Global blast radius (changes affect every project on the machine), bus-factor (collaborators on fresh machines silently fall back), sibling-skill drift (every doc-aware skill needs the same patch). The patched skill becomes an invisible dependency of working on this repo.
- **Symlink `CONTEXT.md → .ralph/CONTEXT.md`.** Skill works unchanged. **Rejected because:** Platform-fragile (Windows handling, archive tools), confusing in `git status`, doesn't match what humans see when reading the repo at GitHub.

The chosen path — return the files to root — is the simplest and most robust. The cost is the admission that ADR-0007 over-claimed.

### 1.2 Operational test: where does a file belong?

A file or directory belongs in `<project>/.ralph/` **only if both** clauses hold:

**Clause A — ralph-defined.** At least one of:
1. Its format/schema is specified by ralph (e.g. illumination YAML frontmatter with `kind: illumination`, `state: open|dispatched|implemented`; `.dot` files with ralph-specific node attributes like `loop`, `outputs`, `cwd`).
2. Its lifecycle is enforced by ralph code (e.g. illumination state machine, run-state checkpoint write/read).
3. Its discovery semantics are ralph-specific (e.g. `pipeline list` scans `.ralph/pipelines/` for `.dot` files).

**Clause B — no pre-existing root convention.** No widely-adopted ecosystem convention (DDD glossary, MADR/Nygard ADRs, generic markdown project docs, npm `package.json`, `.gitignore`, etc.) places the file at repo root.

A file fails clause B if humans browsing the repo on GitHub, IDE doc outliners, or third-party tooling (skill ecosystem) expect to find it at root by convention. Reading a file (`package.json`, `tsconfig.json`) does not make ralph the convention owner.

Both clauses are necessary. Clause A alone is too permissive (ralph parses many files). Clause B alone is too restrictive (it would forbid `.ralph/` entirely). The combination is the rule.

Worked examples:
| File | Clause A (ralph-defined?) | Clause B (no root convention?) | Belongs |
|------|---------------------------|-------------------------------|---------|
| `meditations/illuminations/<file>.md` | ✓ frontmatter schema + lifecycle | ✓ no root convention | `.ralph/` |
| `pipelines/<name>/pipeline.dot` | ✓ ralph-specific node attrs | ✓ no root convention | `.ralph/` |
| `runs/<runId>/checkpoint.json` | ✓ ralph-defined format | ✓ no root convention | `.ralph/` |
| `scenarios/<name>/pipeline.dot` (smoke) | ✓ ralph-specific `.dot` content | ✓ no root convention for pipeline-engine fixtures | `.ralph/` |
| `sessions/<date>-<slug>.md` (memory-writer) | ✓ ralph-defined frontmatter | ✓ no root convention | `.ralph/` |
| `CONTEXT.md` | ✗ no ralph schema enforced | ✗ DDD/glossary convention at root | root |
| `docs/adr/0001-*.md` | ✗ no ralph enforcement | ✗ MADR convention at root | root |
| `VISION.md` | ✗ no ralph schema | ✗ generic project-doc convention at root | root |
| `package.json`, `tsconfig.json` | ✗ ralph reads but does not define | ✗ npm/TS conventions at root | root |

This test is the rule the spec applies. Where the test is debatable (e.g. `pipeline.dot` files: is graphviz a "pre-existing convention"?), clause B asks "does the wider ecosystem expect this at repo root?" — graphviz files have no root convention; pipelines as a category vary by tool. Ralph claims `.ralph/pipelines/`. The test holds.

## 2. Decision summary

1. **Move back to repo root** (third-party conventions):
   - `.ralph/CONTEXT.md` → `CONTEXT.md`
   - `.ralph/VISION.md` → `VISION.md`
   - `.ralph/docs/adr/` → `docs/adr/`

2. **Stay in `.ralph/`** (ralph-defined artefacts):
   - `.ralph/meditations/{illuminations,stimuli}/`
   - `.ralph/pipelines/`
   - `.ralph/runs/`

3. **Finish the original migration** (close drift from ADR-0007):
   - Root `pipelines/illumination-to-implementation/` → `.ralph/pipelines/illumination-to-implementation/`
   - Root `pipelines/smoke/` → `.ralph/scenarios/` (rename: these are smoke-test fixtures, not production pipelines; placing them in `.ralph/pipelines/` would commingle with real pipelines and pollute `pipeline list`)
   - Root `memory/` → `.ralph/sessions/` (rename: the word "memory" is overloaded — Claude auto-memory, ADR-0007's `.ralph/memory/` slot, and session-closure files collide; `.ralph/sessions/` says exactly what the dir holds). The pipeline node that writes these files **stays named `memory-writer`** — only its target path changes; the node id is referenced from `pipeline.dot` and any rename is a separate refactor.
   - Drop the unused `.ralph/memory/` slot from `ralph-paths.ts` and ADR-0007's diagram.

4. **`ralph-paths.ts` API changes:**
   - Delete `docsAdrDir()`. ADRs return to repo root; if any caller still needs the path, use a literal `join(projectRoot, "docs/adr")` (or a new helper if call sites multiply). No internal call sites remain after this change.
   - Rename `memoryDir()` → `sessionsDir()` returning `<project>/.ralph/sessions/`.

5. **`ralph init` scaffold changes:**
   - Create `CONTEXT.md`, `VISION.md` at repo root (not `.ralph/`).
   - Create `docs/adr/` at repo root (not `.ralph/docs/adr/`).
   - Drop `.ralph/memory/` from the dir-list; add `.ralph/sessions/` instead (or skip if memory-writer creates lazily — see §9 open question).
   - Idempotency contract unchanged.

6. **Pipeline-prompt edits:**
   - `pipelines/illumination-to-implementation/memory-writer.md:49,144` — write path `$project/memory/...` → `$project/.ralph/sessions/...`.
   - `pipelines/illumination-to-implementation/verifier.md:83` — example string `.ralph/docs/adr/0007-…` → `docs/adr/0007-…`.
   - Bundled pipeline prompts under `src/cli/pipelines/**` already use generic `CONTEXT.md` / `VISION.md` strings — no edits needed.

7. **ADR-0008 supersedes specific clauses of ADR-0007.** Append-only ADR convention: 0007 body stays as-written; 0008 documents the partial revert and the partition principle (§1.2 operational test). ADR-0008 must explicitly name the superseded clauses by quoting the affected lines of ADR-0007's "Decision" section (the layout tree showing `.ralph/CONTEXT.md`, `.ralph/VISION.md`, `.ralph/docs/adr/`, `.ralph/memory/`). ADR-0007 receives a one-line footer pointing readers to ADR-0008.

8. **Staged commits, not big-bang.** Six logical commits, one per move. Each commit leaves the repo in a working state (passes `tsc`, `vitest`, smoke). Reasons: ADR-0007's big-bang made bisecting harder; staged commits are independently revertable; smaller diffs are easier to review.

9. **No downstream-migration concern.** No projects outside ralph-cli use the new layout yet. No migration recipe required for downstream consumers.

10. **Stale doc cleanup — `IMPLEMENTATION_PLAN.md`.** Root file, 1000+ lines, is the *executed* original migration plan, full of `.ralph/CONTEXT.md` references that this spec invalidates. Justification for inclusion in this revert (rather than as a separate cleanup): the file is dead-as-of-this-commit (every reference inside it is to an obsolete layout). Leaving it after the revert makes future code archaeology harder — `git log --follow` already preserves history. Decision: delete in the same series as the revert.

Out of scope (locked):

- `docs/superpowers/{plans,specs,reviews,verifications}/` — methodology meta, stays at root (per ADR-0007 spec note that this was intentional; this design does not revisit).
- `docs/harness/` — tmux harness debugging docs, stays at root for the same reason.
- `~/.ralph/` user-home daemon state — unaffected.
- Bundled-pipeline path strings in `src/cli/pipelines/**` — already generic; no edits.
- Pipeline resolver (`pipeline-resolver.ts`) — already two-tier (`.ralph/pipelines/` → bundled). No change.
- Run-state path (`<project>/.ralph/runs/`) — unchanged.

## 3. Architecture

### 3.1 Current shape (post-ADR-0007, pre-revert)

```
ralph-cli/                               ← repo root
├── .ralph/
│   ├── CONTEXT.md                       ← TO MOVE BACK
│   ├── VISION.md                        ← TO MOVE BACK
│   ├── docs/adr/0001-*.md               ← TO MOVE BACK
│   ├── meditations/{illuminations,stimuli}/  ← stays
│   ├── memory/                          ← empty (drift from ADR-0007)
│   ├── pipelines/                       ← empty (drift)
│   └── runs/                            ← unchanged
├── memory/                              ← TO MOVE: 18 session-closure files
├── pipelines/
│   ├── illumination-to-implementation/  ← TO MOVE: → .ralph/pipelines/...
│   └── smoke/                           ← TO MOVE: → .ralph/scenarios/
├── docs/
│   ├── superpowers/{plans,specs,...}/   ← stays (methodology meta)
│   └── harness/                         ← stays (debugging docs)
├── IMPLEMENTATION_PLAN.md               ← stale, delete
└── (src/, README.md, package.json, …)
```

### 3.2 Target shape (post-revert)

```
ralph-cli/
├── CONTEXT.md                           ← back at root
├── VISION.md                            ← back at root
├── docs/
│   ├── adr/0001-*..0008-*.md            ← back at root, plus new ADR-0008
│   ├── superpowers/                     ← unchanged
│   └── harness/                         ← unchanged
├── .ralph/
│   ├── meditations/{illuminations,stimuli}/
│   ├── pipelines/
│   │   └── illumination-to-implementation/  ← migrated
│   ├── scenarios/                       ← smoke-pipeline fixtures (renamed)
│   │   ├── conditional/
│   │   ├── chat-only/
│   │   └── …                            ← 14 subdirs
│   ├── sessions/                        ← session-closure files (renamed)
│   │   ├── 2026-04-13-illumination-pipeline-session.md
│   │   └── …                            ← 18 files
│   └── runs/
└── (src/, README.md, package.json, …)
```

### 3.3 Naming-collision check

- **`.ralph/scenarios/` vs `src/tests/scenarios/` (filesystem):** distinct namespaces. `src/tests/scenarios/*.md` are operator-surface harness scenarios driven by `tmux-tester`. `.ralph/scenarios/` holds smoke-pipeline fixtures consumed by `pipeline-smoke-*.test.ts`. Different runtime, different consumers, different format. The dirs never appear together at runtime.
- **"Scenario test" glossary collision (CONTEXT.md):** the existing CONTEXT.md "Scenario test" entry defines scenarios as harness fixtures driven by tmux-tester. Adding a second meaning under the same word — "smoke-pipeline scenario" — is the **real** collision, not the directory path. Mitigation: CONTEXT.md edit (§4.5) splits the glossary entry into two terms: "Harness scenario" (operator-surface, tmux-driven, `src/tests/scenarios/`) and "Smoke-pipeline scenario" (pipeline-engine fixture, vitest-driven, `.ralph/scenarios/`). Both entries cross-reference each other.
- **`.ralph/sessions/` vs anything** — no collision. `.ralph/runs/` (pipeline run state, checkpoint.json + pipeline.jsonl, machine-readable) is distinct from `.ralph/sessions/` (session-closure markdown narratives written by `memory-writer`, human-readable). CONTEXT.md edit defines both.
- **`pipeline list` recursion** — confirmed read-only at top-level of `.ralph/pipelines/` (no recursion). Subdirs under `.ralph/scenarios/` and `.ralph/sessions/` are invisible to the pipeline-list command. Not picked up as runtime pipelines.

### 3.4 Refining the partition principle

ADR-0007's framing was "everything ralph-touchable lives in `.ralph/`." This spec refines via the §1.2 two-clause rule:

> `.ralph/` holds **project-local artefacts that are ralph-defined AND have no pre-existing root convention** — pipelines, agents, run state, illuminations, stimuli, session-closure files, and pipeline-engine test fixtures (smoke scenarios qualify: their content uses ralph-specific `.dot` attributes and no ecosystem convention places pipeline-engine fixtures at repo root).
>
> Repo root holds **pre-existing project-doc conventions** owned by the broader ecosystem (`README.md`, `CONTEXT.md`, `VISION.md`, `docs/adr/`, `package.json`, `tsconfig.json`).

The earlier ADR-0007 framing failed clause B: it claimed `.ralph/CONTEXT.md` despite the existing root convention. The refined principle prevents that overclaim. The framing "`.ralph/` = runtime state only" considered earlier in this spec drafting was too narrow on clause A: it would have excluded build-time test fixtures even though they are clause-A-positive and clause-B-positive. The two-clause rule covers both edges.

### 3.5 Two-tier pipeline resolution — unchanged

The pipeline resolver (`src/cli/lib/pipeline-resolver.ts`) already searches `<project>/.ralph/pipelines/` first, bundled fallback second. The illumination-to-implementation move from root `pipelines/` to `.ralph/pipelines/` requires no resolver change — only the test fixtures that point at the old root location update.

## 4. Components & file edits

### 4.1 Moves (`git mv`)

| From | To | Files |
|------|----|-----|
| `.ralph/CONTEXT.md` | `CONTEXT.md` | 1 |
| `.ralph/VISION.md` | `VISION.md` | 1 |
| `.ralph/docs/adr/` | `docs/adr/` | 7 ADRs (0001–0007) |
| `pipelines/illumination-to-implementation/` | `.ralph/pipelines/illumination-to-implementation/` | 21 |
| `pipelines/smoke/` | `.ralph/scenarios/` | ~40 across 14 subdirs |
| `memory/` | `.ralph/sessions/` | 18 |

### 4.2 Code edits

| File:line | Change |
|-----------|--------|
| `src/cli/lib/ralph-paths.ts:24` | Delete `docsAdrDir()` function. |
| `src/cli/lib/ralph-paths.ts:20` | Rename `memoryDir()` → `sessionsDir()`. Returns `<project>/.ralph/sessions`. |
| `src/cli/commands/init.ts:9-10` | Drop `docsAdrDir`, `memoryDir` imports; add `sessionsDir`. |
| `src/cli/commands/init.ts:15-21` | Update dir-array: drop `docsAdrDir(projectRoot)`, drop `memoryDir(projectRoot)`, add `sessionsDir(projectRoot)`. |
| `src/cli/commands/init.ts:27-32` | Write `CONTEXT.md` / `VISION.md` at repo root, not `.ralph/`. Create `docs/adr/` at repo root. |
| `src/cli/program.ts:95` | Update help text: `.ralph/{pipelines,meditations,memory,docs/adr}` → `.ralph/{pipelines,meditations,sessions,runs}` and add separate clause "creates root `CONTEXT.md`, `VISION.md`, `docs/adr/`". Keep `runs` in the slot list since `ralph init` does append `.ralph/runs/` to gitignore even if it skips `mkdir`. |
| `src/cli/program.ts:194` | Help-text example string `ralph pipeline show pipelines/illumination-to-implementation/pipeline.dot` → `ralph pipeline show .ralph/pipelines/illumination-to-implementation/pipeline.dot` (post-move path). |

### 4.3 Test edits

| File:line | Change |
|-----------|--------|
| `src/cli/tests/ralph-paths.test.ts:8-9` | Drop `docsAdrDir`, rename `memoryDir`→`sessionsDir` import. |
| `src/cli/tests/ralph-paths.test.ts:24` | Delete `it("docsAdrDir joins .ralph/docs/adr")` test. |
| `src/cli/tests/ralph-paths.test.ts:34-35` | Rename `memoryDir`→`sessionsDir`; flip expected to `.ralph/sessions`. |
| `src/cli/tests/init.test.ts:27-30` | Flip path assertions: `CONTEXT.md`, `VISION.md` at repo root; `docs/adr` at repo root; `.ralph/sessions` exists. |
| `src/cli/tests/init.test.ts:48-52,72-78` | Same flip in subsequent test cases (idempotent + content preservation). |
| `src/tests/scenarios/ralph-init-scaffolds-tree.md:16-18` | Flip Expect: paths to repo root for CONTEXT/VISION/docs/adr. |
| `src/tests/scenarios/ralph-init-idempotent.md:7-8,16-17` | Same flip. |
| `src/attractor/tests/illumination-pipeline-flow.test.ts:8-9` | Update path constants: `pipelines/illumination-to-implementation` → `.ralph/pipelines/illumination-to-implementation`. |
| `src/attractor/tests/dual-parser.test.ts:16` | Update `const roots = ["pipelines", "pipelines/smoke"]` → `[".ralph/pipelines", ".ralph/scenarios"]`. This drives a dual-parser fixture-snapshot scan and silently breaks otherwise. |
| `src/cli/tests/pipeline-smoke-conditional-folder.test.ts:8` | `REPO_ROOT/pipelines/smoke/` → `REPO_ROOT/.ralph/scenarios/`. |
| ` ⋮ (13 more pipeline-smoke-*.test.ts files)` | Same path-constant update. Full list in implementation plan. |

### 4.4 Pipeline-prompt edits

| File:line | Change |
|-----------|--------|
| `pipelines/illumination-to-implementation/memory-writer.md:49` | `$project/memory/YYYY-MM-DD-<slug>.md` → `$project/.ralph/sessions/YYYY-MM-DD-<slug>.md`. |
| `pipelines/illumination-to-implementation/memory-writer.md:144` | `No writes outside $project/memory/` → `No writes outside $project/.ralph/sessions/`. |
| `pipelines/illumination-to-implementation/verifier.md:83` | Example string `.ralph/docs/adr/0007-…` → `docs/adr/0007-…`. |

### 4.5 Doc edits

| File:line | Change |
|-----------|--------|
| `README.md:14` | Update `ralph init` description: tree creates `.ralph/{pipelines,meditations/{illuminations,stimuli},sessions}` plus root `CONTEXT.md`, `VISION.md`, `docs/adr/`. |
| `README.md:37` | Reference to `.ralph/CONTEXT.md` and `.ralph/docs/adr/0003-...` → `CONTEXT.md` and `docs/adr/0003-...`. |
| `README.md:61` | Reference to `.ralph/docs/adr/0002-...` → `docs/adr/0002-...`. |
| `README.md:170-173` | "Where to look" section: `CONTEXT.md` and `docs/adr/` at root; remove `.ralph/CONTEXT.md` references. |
| `README.md:184-198` | Migration recipe: **delete entirely**. The recipe described migrating *into* the ADR-0007 layout that this spec reverts; no projects need it. (See §9 — promoted from open question to decision.) |
| `README.md:202` | "See [`.ralph/docs/adr/`]" reference → `docs/adr/`. |
| `CONTEXT.md` (post-`git mv`) | Multi-section rewrite. (a) §"Project-local layout" diagram (~lines 26–34): drop `.ralph/CONTEXT.md`, `.ralph/VISION.md`, `.ralph/memory/`; add `.ralph/sessions/`, `.ralph/scenarios/`; keep `.ralph/{pipelines,meditations,runs}/`. (b) Inline self-references that flip to root: line 15 (`.ralph/docs/adr/0001-...`), line 40 (`.ralph/docs/adr/0007-...`), line 70 (`.ralph/docs/adr/0002-...`), line 136 (`.ralph/docs/adr/`), line 145 (`.ralph/docs/adr/0004-...`), line 148 (`.ralph/CONTEXT.md` and `.ralph/docs/adr/`). **Do NOT flip** lines that point at `.ralph/meditations/illuminations/` (lines 23, 46, 65, 72) or `.ralph/pipelines/` (line 23, 34) or `~/.ralph/agents/` (lines 17, 20) — those stay. (c) Split "Scenario test" glossary entry into "Harness scenario" + "Smoke-pipeline scenario" (per §3.3). (d) Add new term entries: "Session-closure file" (replaces the previous concept of session memory) and "Project-local artefact" (the partition principle from §3.4). (e) Add a footer note: "ADR-0007 is partly superseded by ADR-0008; see ADR-0008 for the partition principle." |
| `VISION.md:30,32` (post-`git mv`) | Two edits. (a) Line 30: narrative says `.ralph/` is "the single home for everything ralph-touchable in the project: pipelines, meditations …, memory, ADRs, CONTEXT.md, VISION.md, run state." Rewrite to reflect the partition: `.ralph/` holds ralph-defined artefacts (pipelines, meditations, sessions, runs); root holds CONTEXT.md, VISION.md, docs/adr/. (b) Line 32: `See \`.ralph/docs/adr/0007-...\`` → `See \`docs/adr/0007-...\`` and add "and `docs/adr/0008-...md` for the partial revert." |
| `AGENTS.md:17` | `.ralph/docs/adr/0001-...` → `docs/adr/0001-...`. |
| `IMPLEMENTATION_PLAN.md` | Delete file. Stale (original `.ralph/` migration plan). Git history preserves it. |
| `docs/adr/0008-partial-revert-of-ralph-folder.md` | NEW. Documents the partial revert + the partition principle. |

### 4.6 Skipped — historical record

| File | Status |
|------|--------|
| `docs/superpowers/plans/2026-04-30-*.md`, `2026-05-01-*.md`, `2026-05-04-ralph-folder-as-project-local-home.md` | Leave unchanged. Historical plan documents; rewriting them rewrites history. |
| `docs/superpowers/specs/2026-05-04-ralph-folder-as-project-local-home-design.md` | Leave unchanged. Spec for the original migration; this design supersedes it via ADR-0008. |
| `docs/superpowers/reviews/2026-05-04-ralph-folder-partial-revert-devil-advocate.md` (and any other `2026-05-04-*` review/verification artefacts produced during this revert's authoring) | Leave unchanged. Session work products that record the spec/plan review process; not live references. |
| `.ralph/docs/adr/0001/0002/0007/...` references to `memory/2026-...md` files (historical examples) | Leave unchanged. They are illustrative examples in the ADR text, not live references. |

Approximately:
- 6 directory `git mv`s (3 root-bound: CONTEXT/VISION/docs-adr; 3 `.ralph/`-bound: illumination-to-implementation, smoke→scenarios, memory→sessions; plus 1 empty-dir cleanup of `.ralph/memory/`)
- 7 source-code edits (`ralph-paths.ts` ×2, `init.ts` ×3, `program.ts` ×2)
- ~25 test-file updates (1 ralph-paths, 1 init unit, 2 init scenarios, 1 attractor illumination flow, 1 dual-parser, 14 smoke folder tests, plus 5 assorted CONTEXT/VISION inline refs)
- 3 pipeline-prompt edits (memory-writer.md ×2, verifier.md ×1)
- 6 README sections (lines 14, 37, 61, 170-173, 184-198, 202) + multi-section CONTEXT.md + 2-line VISION.md + AGENTS.md:17 + 1 new ADR-0008 + 1 ADR-0007 footer + 1 stale-plan deletion

## 5. Data flow

### 5.1 `ralph init` — before / after

**Before** (current, post-ADR-0007):
```
ralph init
        │
        ▼
mkdir .ralph/{pipelines,meditations/{illuminations,stimuli},memory,docs/adr}
write empty .ralph/CONTEXT.md
write empty .ralph/VISION.md
write empty README.md (root)
append .ralph/runs/ to .gitignore
```

**After** (post-revert):
```
ralph init
        │
        ▼
mkdir .ralph/{pipelines,meditations/{illuminations,stimuli},sessions}
mkdir docs/adr (root)
write empty CONTEXT.md (root)
write empty VISION.md (root)
write empty README.md (root)
append .ralph/runs/ to .gitignore
```

### 5.2 `memory-writer` pipeline node — before / after

**Before:**
```
memory-writer reads $project/memory/ as write-target
└── writes $project/memory/2026-MM-DD-<slug>.md
```

**After:**
```
memory-writer reads $project/.ralph/sessions/ as write-target
└── writes $project/.ralph/sessions/2026-MM-DD-<slug>.md
```

The directory is created lazily by the `mkdir -p` inside the script, so `ralph init` does not need to pre-create it (but creates it for consistency with other `.ralph/` slots).

### 5.3 Skill discovery (third-party `grill-with-docs` etc.)

**Before:** Skill looks at `CONTEXT.md` / `docs/adr/` at root → not found → either creates new root file (drift) or operates without context.

**After:** Skill looks at `CONTEXT.md` / `docs/adr/` at root → finds them → operates on the existing convention.

No code change in ralph-cli; the change is the file location.

## 6. Blast radius / impact surface

- **Size:** M (smaller than the original migration; mostly text-string + `git mv`s, no new modules).
- **Files touched:** ~40 total — ~6 source edits, ~24 test updates, 3 pipeline-prompt edits, 5 doc edits, 1 new ADR, 6 directory `git mv`s, 1 stale-plan deletion.
- **Surfaces crossed:**
  - **CLI:** affected. `ralph init` scaffolds different tree; help text updates.
  - **Pipeline engine:** unaffected at runtime. Resolver already two-tier. Run-state path unchanged.
  - **MCP server:** unaffected. No CONTEXT/VISION/ADR refs.
  - **Bundled pipelines:** unaffected. Already generic.
  - **Project-local pipelines** (`pipelines/illumination-to-implementation/memory-writer.md`, `verifier.md`): affected. 3 line edits.
  - **Tests:** affected. ~24 path-string updates, 0 new tests.
  - **Build:** unaffected.
  - **Docs:** affected. README, CONTEXT, AGENTS, new ADR-0008.
- **Breaking changes for downstream projects:** None. No projects outside ralph-cli use the new layout.
- **Breaking changes for ralph-cli's own dogfood:** Yes. The 18 session-closure files at root `memory/` move under `.ralph/sessions/`. Any in-flight illumination-implementation run mid-session would write to the new path on next run; old paths in old session files become git-history-only references.

## 7. Trade-offs

### 7.1 Partial revert is a partial admission

ADR-0007 was wrong about CONTEXT.md / VISION.md / docs/adr. Calling that out via ADR-0008 (rather than amending 0007 in place) keeps the trail honest but creates a "two ADRs to read" obligation for future readers.

**Accepted because:** Append-only ADRs are the convention. Mutating 0007 destroys the lesson; future authors would not see why the partition principle matters. ADR-0008 references 0007's body and explicitly supersedes specific clauses.

### 7.2 `.ralph/scenarios/` overloads the noun "scenario"

The repo already has `src/tests/scenarios/*.md` (harness scenarios). Adding `.ralph/scenarios/` (smoke-pipeline fixtures) creates dual meaning.

**Accepted because:** The two are operationally distinct (different runtime, different consumers, different format). CONTEXT.md will document both. Alternative names considered: `.ralph/smoke/` (less descriptive — does not say "test fixture"), `tests/fixtures/smoke/` (under `src/tests/`, breaks the "ralph state in `.ralph/`" partition). `scenarios` won on co-location with `.ralph/` and shared "test-input" framing.

### 7.3 `memory/` → `sessions/` is a name change AND a location change

Two transformations in one move. A reader doing `git log --follow` for the 18 files sees both changes at once.

**Accepted because:** Bundling them in one `git mv` keeps the rename atomic. Splitting (move first, rename second) requires touching the same files twice; doesn't help blame and doubles the diff noise. The rename is justified independently (the word "memory" is overloaded — see §2 item 3).

### 7.4 Reversal of ADR-0007 sets a "we may revert" precedent

If ADR-0007's principle is reversible 7 days later, any future ADR feels less load-bearing. ADR-0007 also explicitly named the discoverability cost as an *accepted* trade-off — reversing on the same evidence weakens future "accepted trade-off" framings.

**Accepted because:** ADR-0007 accepted "discoverability drop" as a static trade-off. What changed is *operational evidence*: skill-landing failure, observed within days of dogfooding, was not predicted by the ADR-0007 trade-off discussion. The precedent ADR-0008 sets is not "ADRs are casually reversible" but "ADRs encode best-understanding-at-time; new operational evidence justifies a new ADR." This is the system working as designed. The append-only ADR convention (0008 supersedes 0007 by reference, 0007 body unchanged) preserves the lesson; future authors reading the trail see *why* the partition matters.

### 7.5 VISION.md inclusion is convention-driven, not skill-driven

VISION.md is not a typical third-party-skill target (unlike CONTEXT.md). Including it in the revert is justified separately: VISION.md is a generic project-doc convention humans expect at repo root (alongside README.md), and IDE/GitHub doc-outliners surface root-level docs by default. Leaving VISION.md under `.ralph/` while reverting CONTEXT.md splits the human-readable docs across two locations for no operational gain. The partition principle (§1.2 clause B) classifies VISION.md as pre-existing convention; consistency with the principle requires moving it back.

### 7.6 Rename `memory/` → `.ralph/sessions/` bundled with location change

A separate refactor would split: (1) move `memory/` → `.ralph/memory/` (location), (2) rename `.ralph/memory/` → `.ralph/sessions/` (terminology). Bundling them in one commit is the spec's choice.

**Accepted because (principled):** Moving without renaming would commit content into a slot whose name is *already* known-bad (the word "memory" overloaded across Claude auto-memory, ADR-0007's slot, and session-closure files). The two-step path "fix one wrong thing, then fix the second wrong thing" leaves a transitional state where the wrong name sits in the new layout's tree. The rename is on the critical path of the partial-revert change — without it, `.ralph/memory/` would persist as a name we already know is wrong, in the same commit series that fixes ADR-0007's other overclaims. Bundling the rename is therefore not gold-plating; it is *closing the same class of error* (incorrect-naming) that ADR-0007 left open.

**Accepted because (logistical, secondary):** Splitting requires touching the same files (memory-writer.md, ralph-paths.ts, init.ts, tests, ADR diagram, CONTEXT.md) twice. The principled argument carries the case; the logistical one is a tiebreaker.

The pipeline node id stays `memory-writer` (separate refactor when other node renames cluster).

### 7.7 Staged commits over big-bang for solo dev

ADR-0007's big-bang was one commit. This spec proposes ~6 staged commits. For a solo dev with no review process, "easier to review" benefits do not apply.

**Accepted because:** Bisect benefit *does* apply, even solo: if any single move breaks the smoke pipeline (e.g. the `git mv` of `.ralph/docs/adr/` accidentally drops a file), `git bisect` lands on the offending commit immediately rather than on a 40-file blob. The cost of staged commits is one extra `git commit` invocation per move; the benefit is selective revertability if one move turns out wrong. Not LARP; concrete value.

### 7.8 ADR ordering rigidity

ADR-0008 must be born at `docs/adr/` (per §8 constraint). Until the `git mv .ralph/docs/adr/ docs/adr/` lands, `docs/adr/` does not exist as a tracked directory. ADR-0008 cannot be drafted before that move. Authoring sequence is locked: move ADRs first, write ADR-0008 second.

**Accepted because:** The sequence is naturally enforced by the staged-commit ordering in the implementation plan. The constraint surfaces explicitly so reviewers and the plan author do not propose an ordering that puts ADR-0008 first.

### 7.9 Risk: stale references in historical plans

`docs/superpowers/plans/*.md` (~9 files) reference `.ralph/CONTEXT.md`, `.ralph/docs/adr/`, root `memory/`, root `pipelines/illumination-to-implementation/` in their text. These are not updated.

**Accepted because:** Plans are historical work products. Updating them rewrites history; readers who follow them get confused about which version of the layout the plan describes. The README + CONTEXT.md + ADR-0008 establish the current truth; plans stand as records.

## 8. Constraints

- All edits land in a sequence of staged commits (one per move + one for code edits + one for ADR-0008 + one for cleanup). Each commit leaves the repo passing `npx tsc --noEmit`, `npx vitest run`, and the smoke-pipeline test suite.
- The `git mv` of `.ralph/CONTEXT.md` → `CONTEXT.md` and the `git mv` of `.ralph/docs/adr/` → `docs/adr/` happen **before** ADR-0008 is written, so ADR-0008 is born at its final location (root `docs/adr/`).
- The `git mv` of `memory/` → `.ralph/sessions/` happens **after** the `memory-writer.md:49,144` edits land, so the live pipeline writes to the new location from that commit forward. (Alternative ordering — move first, edit prompt second — leaves the prompt momentarily pointing at the old root path; harmless for ralph-cli's own dogfood since no run starts mid-commit, but cleaner if prompt edit precedes mv.)
- `IMPLEMENTATION_PLAN.md` deletion happens last (or at any point — it has no live consumers).
- ADR-0008 references ADR-0007 explicitly via "Supersedes 0007 §2 items 1, 2, 3 (CONTEXT/VISION/docs-adr placement)".

## 9. Open questions

1. **Lazy `.ralph/sessions/` creation vs eager.** Should `ralph init` mkdir `.ralph/sessions/` (consistency with other slots) or skip and let `memory-writer` create it on first write (lazy)? Recommendation: eager. Empty dir is harmless; explicit slots aid discoverability. Confirm during implementation.

2. **Verifier.md example string coherence.** The string `'.ralph/docs/adr/0007-…'` at `verifier.md:83` is illustrative within a longer prompt that teaches the verifier how to attribute claims. After the edit to `'docs/adr/0007-…'`, the example still teaches the same principle. Confirm the verifier prompt remains coherent post-edit.

(Previously-listed open questions promoted to decisions in §2/§4: README migration recipe deleted; ADR-0007 footer added pointing to 0008; init.test.ts assertion flip enumerated.)

## 10. Verification approach

### 10.1 Static checks

After each commit:

- `grep -rn '\\.ralph/CONTEXT\\.md\\|\\.ralph/VISION\\.md\\|\\.ralph/docs/adr' src/` — expected: zero hits in `src/` after the code+test commits.
- `grep -rn '\\bmemoryDir\\b\\|docsAdrDir' src/` — expected: zero hits after the ralph-paths.ts commit.
- `grep -rn 'pipelines/smoke\\|pipelines/illumination-to-implementation' src/cli/tests/ src/attractor/tests/` — expected: zero hits after the test-update commits.
- `npx tsc --noEmit` — clean.

### 10.2 Tests

- `npx vitest run src/cli/tests/ralph-paths.test.ts` — passes with new `sessionsDir` test.
- `npx vitest run src/cli/tests/init.test.ts` — passes with flipped path assertions.
- `npx vitest run src/cli/tests/pipeline-smoke-*.test.ts` — all 14 pass with `.ralph/scenarios/` fixture path.
- `npx vitest run src/attractor/tests/illumination-pipeline-flow.test.ts` — passes with `.ralph/pipelines/illumination-to-implementation/` path.
- `npx vitest run` — full suite green.

### 10.3 Smoke

- `mktemp -d /tmp/ralph-init-test` then `cd` and run `ralph init`. Expected: root `CONTEXT.md`, `VISION.md`, `docs/adr/` created; `.ralph/{pipelines,meditations/{illuminations,stimuli},sessions}/` created; `.gitignore` contains `.ralph/runs/`.
- Re-run `ralph init` in same dir. Expected: idempotent; no overwrites.
- `ralph pipeline run .ralph/pipelines/illumination-to-implementation/pipeline.dot --project .` against ralph-cli's own repo — confirms the pipeline still resolves and runs from its new location.
- `ralph pipeline list .` — confirms `.ralph/scenarios/` does NOT appear (subdirs invisible to top-level scan), `illumination-to-implementation` DOES appear.

### 10.4 Skill landing (empirical, not mental simulation)

The original motivation (§1 symptom 1) is skill-landing failure. Verification must be empirical:

- `test -f CONTEXT.md && test -d docs/adr` from repo root — both exist post-revert.
- `grep -rn 'CONTEXT\\.md\\|docs/adr' ~/.claude/skills/grill-with-docs/ ~/.claude/skills/improve-codebase-architecture/ 2>/dev/null` — confirms the skills hard-code root paths (so root placement is what they expect).
- Invoke `/grill-with-docs` (or any doc-aware skill) in a fresh Claude session against this repo post-revert. Expect: skill finds `CONTEXT.md` and `docs/adr/` at the locations its hard-coded paths target. Record the session result in the implementation-plan verification step.

## 11. Summary

ADR-0007's "everything ralph-touchable in `.ralph/`" principle is partly wrong: CONTEXT.md, VISION.md, and docs/adr/ follow conventions older than ralph and owned by the broader ecosystem. This design moves them back to repo root, finishes ADR-0007's incomplete migration of root `pipelines/` and `memory/` into `.ralph/`, renames `memory/` → `.ralph/sessions/` (and drops the unused `.ralph/memory/` slot) for terminology clarity, and renames smoke-pipeline fixtures to `.ralph/scenarios/`. Six staged commits, ~40 files touched, no new modules. ADR-0008 documents the partition principle ("ralph-defined artefacts in `.ralph/`; pre-existing conventions at root") and supersedes the relevant clauses of ADR-0007. No downstream consumers are affected.
