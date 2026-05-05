# Rename `ralph` → `apparatus` Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the project end-to-end: brand `ralph-cli` → `apparatus`, binary `ralph` → `apparat`, project-local folder `.ralph/` → `.apparat/`, env vars `RALPH_*` → `APPARAT_*`, build constant `__RALPH_PROD__` → `__APPARAT_PROD__`, path-helper module `ralph-paths.ts` → `apparat-paths.ts`. Big-bang migration with no compatibility layer.

**Architecture:** Four staged chunks inside one PR. Chunk 1 consumes 17 stale specs and stubs ADR-0010 *before* any code change so the rename diff stays focused. Chunk 2 renames code-side identifiers (env vars, build constant, `package.json` fields, the `ralph-paths.ts` module). Chunk 3 performs `git mv .ralph .apparat`, updates every `.ralph/` path string, and runs the live-document `sed` pass. Chunk 4 rewrites public docs, finalizes ADR-0010, and runs full verification. Each chunk leaves the repo passing `npx tsc --noEmit`, `npx vitest run`, and `npm run build`.

**Tech Stack:** TypeScript, Vitest, tsup, Commander, ralph-cli's own pipeline DSL (`.dot` + agent `.md`).

**Spec:** `docs/superpowers/specs/2026-05-05-rename-to-apparatus-design.md`

**Pre-flight requirement:** Read the spec end-to-end before starting. The §2 Decision Summary, §3.1 Rename map, and §3.3 Files-touched buckets are load-bearing. The §6 Blast radius lists every grep invariant the post-merge state must satisfy.

---

## File structure plan

| File | Status | Responsibility |
|------|--------|---------------|
| `docs/superpowers/specs/*-design.md` (17 stale files) | deleted | Consumed pre-rename; reduces rename diff noise. |
| `docs/superpowers/specs/2026-05-05-rename-to-apparatus-design.md` | exists (already written) | This rename's design doc. Survives chunk 1's deletion. |
| `docs/adr/0010-rename-to-apparatus.md` | created | New MADR-style ADR superseding ADR-0007/0008's *naming* (not their substance). |
| `package.json` | modified | `name`: `ralph-cli` → `apparat-cli`; `bin`: `{ ralph → apparat }`; `description` mentions apparatus. |
| `tsup.config.ts` | modified | `define` flips from `__RALPH_PROD__` to `__APPARAT_PROD__` (line 14). |
| `src/types/globals.d.ts` | modified | Ambient declaration flips `__RALPH_PROD__` → `__APPARAT_PROD__` (line 1). |
| `src/cli/lib/ralph-paths.ts` → `src/cli/lib/apparat-paths.ts` | moved + edited | `git mv`. Body: `ralphDir` → `apparatDir`; `.ralph` literal → `.apparat`. Other helper exports keep their names. |
| `src/cli/tests/ralph-paths.test.ts` → `src/cli/tests/apparat-paths.test.ts` | moved + edited | `git mv`. Imports + assertions flip. |
| `src/cli/lib/assets.ts` | modified | 3 `__RALPH_PROD__` references (lines 8, 9, 12) → `__APPARAT_PROD__`. Error string at line 30. Hardcoded `.ralph/meditations/stimuli` literal at line 42. |
| `src/cli/program.ts` | modified | `program.name("ralph")` line 19. ~30 help-text lines containing `ralph <command>` and `.ralph/` paths. |
| `src/cli/commands/init.ts` | modified | Scaffolded directory targets (`ralphDir` callsites + `.gitignore`-append rule). |
| `src/cli/commands/pipeline.ts` | modified | `RALPH_RUNS_KEEP` env var (line 288); any `.ralph/` literals in error messages or log strings. |
| `src/cli/commands/heartbeat.ts` | modified (if any hits) | `.ralph/` or `ralph` literal flips. |
| `src/cli/commands/meditate.ts` | modified (if any hits) | Path literals + help strings. |
| `src/cli/commands/implement.ts` | modified (if any hits) | Path literals + help strings. |
| `src/cli/mcp/illumination-server.ts` | modified | Path literals to `.ralph/meditations/illuminations/`. |
| `src/daemon/runner.ts` | modified | `RALPH_TEST_CMD` (lines 13, 18) → `APPARAT_TEST_CMD`; `RALPH_PROD__` → `APPARAT_PROD__`. |
| `src/lib/daemon-client.ts` | modified | `RALPH_PROD__` (line 16) → `APPARAT_PROD__`. |
| `src/attractor/handlers/agent-prep.ts` | modified | `RALPH_PROD__` (line 63) → `APPARAT_PROD__`. |
| `src/attractor/tests/engine-onNodeEnd.test.ts` | modified | `RALPH_ENGINE_TEST_ALLOW_SPAWN` (line 21) → `APPARAT_ENGINE_TEST_ALLOW_SPAWN`. |
| `src/attractor/tests/agent-handler.test.ts` | modified | `RALPH_PROD__` (line 260) → `APPARAT_PROD__`. |
| `src/cli/tests/smoke.test.ts` | modified | `RALPH_PROD__` (lines 24, 30, 31, 32) → `APPARAT_PROD__`. |
| `src/daemon/tests/runner.test.ts` | modified | `RALPH_TEST_CMD` (lines 37, 46, 58, 72, 85, 108) → `APPARAT_TEST_CMD`. |
| `src/cli/tests/init.test.ts` | modified | Path assertions flip from `.ralph/` to `.apparat/`. |
| `src/cli/tests/pipeline.test.ts` | modified | Path assertions flip. |
| `src/cli/tests/pipeline-show.test.ts` | modified | Path assertions flip. |
| `src/cli/tests/pipeline-smoke-*-folder.test.ts` (14 files) | modified | `.ralph/scenarios/` path constants flip. |
| `src/cli/pipelines/**/*.{md,dot,mjs}` | modified (per-file as needed) | Bundled pipelines referencing `.ralph/`, `RALPH_*`, or "ralph" idioms. |
| `.ralph/` (entire tree) | moved | `git mv .ralph .apparat`. |
| `.apparat/meditations/illuminations/*.md` (alive) | sed-edited | Path-only replace `.ralph/` → `.apparat/`. |
| `.apparat/scenarios/**` | sed-edited | Path-only replace `.ralph/` → `.apparat/`. |
| `README.md` | modified | Every command snippet, install line, folder reference, "Where to look" section. |
| `VISION.md` | modified | Brand, binary, folder, `ralph-shaped` idiom. |
| `CONTEXT.md` | modified | Folder name, idiom, env vars, ADR-0007/0008 pointer adds parenthetical to ADR-0010. |
| `AGENTS.md` | modified | Body references; `RALPH_PROD__` (line 20) → `APPARAT_PROD__`. |
| `docs/harness/README.md` | modified | `.ralph/` paths and `ralph` binary references. |
| `docs/harness/tmux-drive.md` | modified | Same. |
| `.gitignore` | modified | `.ralph/runs/` → `.apparat/runs/`. |

**Frozen — do not edit:** `docs/adr/0001-...md` through `0009-...md`, `docs/superpowers/plans/*.md`, `.apparat/sessions/*.md` (post-mv), `.apparat/runs/**` (post-mv), `MEMORY.md` topic files in `~/.claude/projects/-Users-josu-Documents-projects-ralph-cli/memory/`. References to "ralph" inside these are historical record.

---

## Chunk 1: Pre-rename cleanup — consume stale specs + stub ADR-0010

Goal: remove 17 implemented design specs from `docs/superpowers/specs/` and create a placeholder ADR-0010 file. After this chunk, `docs/superpowers/specs/` contains only the rename-to-apparatus spec, and `docs/adr/0010-rename-to-apparatus.md` exists with `Status: draft`. Chunk 4 finalizes ADR-0010 to `Status: accepted` after the rename completes.

This chunk is independent of the rename — it would be valid even if the rename were abandoned. Its independence is the reason it is its own commit: a reviewer should be able to verify "yes, these 17 specs are stale" without conflating that judgment with rename-mechanics review.

**Files:**
- Delete: `docs/superpowers/specs/2026-05-01-janitor-dead-parse-structured-output-design.md`
- Delete: `docs/superpowers/specs/2026-05-01-janitor-dead-two-phase-fn-design.md`
- Delete: `docs/superpowers/specs/2026-05-01-meditate-bypasses-resolver-chain-design.md`
- Delete: `docs/superpowers/specs/2026-05-01-source-as-truth-no-behavioral-specs-design.md`
- Delete: `docs/superpowers/specs/2026-05-03-janitor-dead-scripts-design.md`
- Delete: `docs/superpowers/specs/2026-05-04-drop-llm-model-from-bundled-implement-pipeline-design.md`
- Delete: `docs/superpowers/specs/2026-05-04-janitor-graph-validator-bloat-design.md`
- Delete: `docs/superpowers/specs/2026-05-04-janitor-string-attrs-drift-design.md`
- Delete: `docs/superpowers/specs/2026-05-04-mark-plan-implemented-not-idempotent-design.md`
- Delete: `docs/superpowers/specs/2026-05-04-model-flag-dead-in-implement-pipeline-design.md`
- Delete: `docs/superpowers/specs/2026-05-04-ralph-folder-as-project-local-home-design.md`
- Delete: `docs/superpowers/specs/2026-05-04-ralph-folder-partial-revert-design.md`
- Delete: `docs/superpowers/specs/2026-05-04-validator-misclassifies-tool-node-outputs-as-caller-vars-design.md`
- Delete: `docs/superpowers/specs/2026-05-05-agent-handler-two-paths-one-execute-design.md`
- Delete: `docs/superpowers/specs/2026-05-05-graph-ts-parser-validator-conflation-design.md`
- Delete: `docs/superpowers/specs/2026-05-05-memory-writer-trace-locate-gap-design.md`
- Delete: `docs/superpowers/specs/2026-05-05-shallow-control-flow-handlers-design.md`
- **Preserve:** `docs/superpowers/specs/2026-05-05-rename-to-apparatus-design.md` (already exists; chunk 1 must not delete it).
- Create: `docs/adr/0010-rename-to-apparatus.md` (draft stub).

### Tasks

- [x] **1.1: Verify the preserved spec exists.**

Run: `ls docs/superpowers/specs/2026-05-05-rename-to-apparatus-design.md`
Expected: file lists. If it does not exist, abort — the rename spec must be authored before this chunk runs.

- [x] **1.2: List the current spec directory contents.**

Run: `ls docs/superpowers/specs/`
Expected: 18 files. 17 stale `*-design.md` files (per the deletion list above) + the rename spec.

- [x] **1.3: Delete the 17 stale specs in one atomic `git rm` invocation.**

Run:
```bash
cd /Users/josu/Documents/projects/ralph-cli
git rm \
  docs/superpowers/specs/2026-05-01-janitor-dead-parse-structured-output-design.md \
  docs/superpowers/specs/2026-05-01-janitor-dead-two-phase-fn-design.md \
  docs/superpowers/specs/2026-05-01-meditate-bypasses-resolver-chain-design.md \
  docs/superpowers/specs/2026-05-01-source-as-truth-no-behavioral-specs-design.md \
  docs/superpowers/specs/2026-05-03-janitor-dead-scripts-design.md \
  docs/superpowers/specs/2026-05-04-drop-llm-model-from-bundled-implement-pipeline-design.md \
  docs/superpowers/specs/2026-05-04-janitor-graph-validator-bloat-design.md \
  docs/superpowers/specs/2026-05-04-janitor-string-attrs-drift-design.md \
  docs/superpowers/specs/2026-05-04-mark-plan-implemented-not-idempotent-design.md \
  docs/superpowers/specs/2026-05-04-model-flag-dead-in-implement-pipeline-design.md \
  docs/superpowers/specs/2026-05-04-ralph-folder-as-project-local-home-design.md \
  docs/superpowers/specs/2026-05-04-ralph-folder-partial-revert-design.md \
  docs/superpowers/specs/2026-05-04-validator-misclassifies-tool-node-outputs-as-caller-vars-design.md \
  docs/superpowers/specs/2026-05-05-agent-handler-two-paths-one-execute-design.md \
  docs/superpowers/specs/2026-05-05-graph-ts-parser-validator-conflation-design.md \
  docs/superpowers/specs/2026-05-05-memory-writer-trace-locate-gap-design.md \
  docs/superpowers/specs/2026-05-05-shallow-control-flow-handlers-design.md
```
Expected: 17 lines of `rm '...'` output, no errors.

- [x] **1.4: Verify the rename spec survived the deletion.**

Run:
```bash
COUNT=$(ls docs/superpowers/specs/ | wc -l | tr -d ' ')
SURVIVOR=$(ls docs/superpowers/specs/)
test "$COUNT" = "1" && echo "count ok" || { echo "FAIL: expected 1, got $COUNT"; exit 1; }
test "$SURVIVOR" = "2026-05-05-rename-to-apparatus-design.md" && echo "name ok" \
  || { echo "FAIL: surviving file is $SURVIVOR, expected the rename spec"; exit 1; }
```
Expected: `count ok` followed by `name ok`. The two checks together catch both over-deletion (rename spec accidentally removed) and under-deletion (a stale spec slipped through the deletion list).

- [x] **1.5: Create the ADR-0010 draft stub.**

Write `docs/adr/0010-rename-to-apparatus.md` with this content:

```markdown
# 0010 — Rename `ralph` → `apparatus`

**Status:** Draft (pending rename PR completion)

**Supersedes (in part):** ADR-0007 (`.ralph/` as project-local home) and ADR-0008 (partial revert + partition principle), but only their *naming*. The project-local layout principle and the §1.2 two-clause partition rule both still hold; only the folder name `.ralph/` becomes `.apparat/` and the brand `ralph` becomes `apparatus` (binary `apparat`).

## Context

The name `ralph` is a placeholder that has outlived its utility. The new name `apparatus` better describes the project's actual shape: a machine in which `apparatchik` agents do one job each toward a larger goal (per the spider/web mental model already in `MEMORY.md`). The rename is taste plus a better-fitting metaphor; there is no public collision driving urgency, no compatibility cohort to migrate, and no architectural change.

`VISION.md`'s "personal harness for one developer, one machine — not multi-tenant" charter eliminates the need for compatibility shims, cross-version transition releases, or auto-migration of legacy `.ralph/` folders.

## Decision

Adopt the following rename map:

| Surface | Before | After |
|---|---|---|
| Brand / repo / GitHub | `ralph-cli` | `apparatus` |
| Binary | `ralph` | `apparat` |
| Project-local folder | `<project>/.ralph/` | `<project>/.apparat/` |
| Env vars (6) | `RALPH_*` | `APPARAT_*` |
| Build constant | `__RALPH_PROD__` | `__APPARAT_PROD__` |
| Path-helper module | `src/cli/lib/ralph-paths.ts` | `src/cli/lib/apparat-paths.ts` |
| Path-helper function | `ralphDir()` | `apparatDir()` |
| Domain idiom | "ralph-shaped project" | "apparat-shaped project" |
| npm package name | `ralph-cli` | `apparat-cli` (provisional; finalized post-merge) |

Migration is big-bang: a single PR rewrites every reference. No compatibility layer, no transition release, no auto-migration code. Each project on the developer's machine that uses the tool runs `git mv .ralph .apparat && git commit` once, manually, after upgrading.

The brand-vs-binary split (apparatus + apparat) follows the `kubernetes/kubectl` and `terraform/tf` precedents. The brand noun is load-bearing for the metaphor (apparatchik = worker of *apparatus*); the short binary name optimizes daily typing.

The project-local folder name `.apparat/` matches the binary, not the brand, following the `.git/`/`.cargo/`/`.npm/` convention.

The "agent" vocabulary stays in code, schema, frontmatter, and CONTEXT.md §Agent loading. `apparatchik` is metaphor-only; it appears in README/VISION prose, not in pipeline DSL or runtime.

## Consequences

**Positive:**
- Brand reads as the project's actual mental model; future contributors (or future-me) read `apparatus` and recognize the machine-with-workers shape.
- Six-character binary `apparat` is faster to type than nine-character `apparatus`.
- `.apparat/` as folder name follows ecosystem convention; saves two characters per path string × ~1287 references in the codebase.
- Removes the legacy placeholder name from public surfaces.

**Negative:**
- 292 files touched in one PR. Diff is large but mechanical; review burden is verifying mechanics, not semantics.
- Breaking change for any external script invoking `RALPH_*` env vars or the `ralph` binary. Cohort size: one user.
- Frozen prose (ADRs 0001–0009, plans, sessions, runs, MEMORY.md topic files) continues to reference "ralph". Future readers must follow this ADR's supersession link to understand the rename.

**Out of scope (preserved from ADR-0007 + ADR-0008):**
- The two-clause partition principle (ralph-defined AND no pre-existing root convention). Still holds; only the folder name changes.
- Project-local pipelines as a tier (`.apparat/pipelines/` overrides bundled).
- Run-state inside `.apparat/runs/` (no user-home tier).
- Code vocabulary: "agent", "pipeline", "illumination", "session-closure file" all unchanged.

## Alternatives considered and rejected

- **Unified `apparatus` everywhere (no binary shorthand).** Rejected: nine-character binary is borderline-tedious for daily typing; loses the recognized brand-vs-binary precedent.
- **Unified `apparat` everywhere (no brand longform).** Rejected: collapses the metaphor (apparatchik = worker of *apparatus*).
- **Folder `.apparatus/` (brand-matching).** Rejected: departs from `.git/`/`.cargo/`/`.npm/` convention; longer path strings; folder is operational, not promotional.
- **Transition release with auto-migration.** Rejected: VISION explicitly scopes the project to one developer; compat code lives in the binary forever once added.
- **Editing ADRs 0007/0008 in place.** Rejected: violates the MADR append-only convention.

## References

- Spec: `docs/superpowers/specs/2026-05-05-rename-to-apparatus-design.md`
- Plan: `docs/superpowers/plans/2026-05-05-rename-to-apparatus.md`
- ADR-0007: `.ralph/` as project-local home (naming superseded by this ADR; substance retained).
- ADR-0008: Partial revert + partition principle (naming superseded by this ADR; substance retained).
```

- [x] **1.6: Verify ADR-0010 was written.**

Run: `ls docs/adr/0010-rename-to-apparatus.md && wc -l docs/adr/0010-rename-to-apparatus.md`
Expected: file lists; line count > 50.

- [x] **1.7: Run TypeScript typecheck (sanity — nothing should fail).**

Run: `npx tsc --noEmit`
Expected: PASS.

Vitest is intentionally skipped here: the deleted specs and the new ADR are documentation files, not imported by any source code. The chunk's surface area for runtime breakage is zero. Full vitest re-runs in chunk 2.

- [x] **1.8: Stage and commit chunk 1.**

The chunk-1 commit must include three things atomically: the 17 deletions (already staged by `git rm` in step 1.3), the new ADR-0010 stub, and the rename spec authored just before this chunk ran. Stage the latter two explicitly:

Run:
```bash
git add docs/adr/0010-rename-to-apparatus.md
git add docs/superpowers/specs/2026-05-05-rename-to-apparatus-design.md
git status
```

Expected `git status`: 17 entries under `Changes to be committed` as `deleted: docs/superpowers/specs/<filename>`, plus 2 additions: `docs/adr/0010-rename-to-apparatus.md` and `docs/superpowers/specs/2026-05-05-rename-to-apparatus-design.md`. No other files staged.

If the rename spec is already in HEAD from a prior commit (e.g. authored in a separate session), the second `git add` becomes a no-op and `git status` shows only 17 deletions + 1 addition. Either state is acceptable — the invariant is "rename spec exists in or before chunk-1 commit".

Then commit:

```bash
git commit -m "$(cat <<'EOF'
chore(specs): consume 17 implemented designs + stub ADR-0010

Removes 17 design docs from docs/superpowers/specs/ that paired with
already-shipped plans (ADR-0004 source-as-truth ethos: implementation
is truth; pre-implementation thinking is replaceable by reading code).

Stubs docs/adr/0010-rename-to-apparatus.md (status: draft) covering
the upcoming ralph → apparatus rename. ADR transitions to status:
accepted in chunk 4 after the rename PR's mechanical work completes.

Preserves docs/superpowers/specs/2026-05-05-rename-to-apparatus-design.md
(this rename's design doc).
EOF
)"
```

Expected: commit succeeds; `git log -1 --stat` shows 17 deletions plus 1–2 additions (ADR-0010 + optional rename-spec).

- [x] **1.9: Verify chunk 1 final state.**

Run:
```bash
ls docs/superpowers/specs/             # expected: 2026-05-05-rename-to-apparatus-design.md (one file)
test "$(ls docs/superpowers/specs/)" = "2026-05-05-rename-to-apparatus-design.md" \
  && echo "specs dir verified" || echo "FAIL"
ls docs/adr/0010-rename-to-apparatus.md # expected: file exists
git log -1 --oneline                    # expected: chunk 1 commit at HEAD
```

All four checks must pass. The single-line `test "$(ls ...)" = ...` catches the same over/under-deletion modes verified in step 1.4 (post-commit re-check).

---

## Chunk 2: Code-side renames — env vars, build constant, package.json, ralph-paths module

Goal: every code-side identifier reflects the rename. No `.ralph/` folder rename yet — the project still scaffolds and reads from `.ralph/` operationally; only the source-code-level naming flips. After this chunk, the codebase compiles, tests pass against `.ralph/` (because tests still target `.ralph/` paths), and `apparat-paths.ts` exports `apparatDir` returning `<project>/.apparat/`. Chunk 3 will then `git mv .ralph .apparat` and update path constants atomically.

**Crucial sequencing note.** Chunk 2 makes `apparatDir()` return `<project>/.apparat/`. But the repo's own `.ralph/` directory has not been renamed yet. Tests that call `apparatDir(REPO_ROOT)` would resolve to a `.apparat/` directory that does not exist on disk. **Therefore: chunk 2 keeps the `apparatDir` return value as `<project>/.ralph/` temporarily.** The function name flips (so types and imports cascade), but the literal string returned is still `.ralph`. Chunk 3 flips that literal in one focused edit alongside the `git mv`.

This temporary mismatch is intentional and uncomfortable; it is the cost of avoiding a half-rebuilt repo between chunks. Chunk 3 closes the loop in a single commit.

**Reviewer note on `--help` output:** Step 2.5 flips `program.name(...)` to `apparat` while leaving help-text strings ("`ralph init my-app`" etc.) for chunk 4. A reviewer running `apparat --help` after chunk 2 sees `Usage: apparat [...]` followed by command examples that say `ralph`. This is incoherent by design — the rename PR is reviewed and merged as a unit; intermediate chunk states are not user-facing. Help text flips alongside README/VISION in chunk 4 so the doc rewrite is one focused diff.

**Files:**
- Modify: `package.json`
- Modify: `tsup.config.ts`
- Modify: `src/types/globals.d.ts`
- Move: `src/cli/lib/ralph-paths.ts` → `src/cli/lib/apparat-paths.ts`
- Move: `src/cli/tests/ralph-paths.test.ts` → `src/cli/tests/apparat-paths.test.ts`
- Modify (after move): `src/cli/lib/apparat-paths.ts` body — `ralphDir` → `apparatDir`; literal `.ralph` retained until chunk 3.
- Modify (after move): `src/cli/tests/apparat-paths.test.ts` — imports + assertions update to `apparatDir`; assertion strings retain `.ralph` until chunk 3.
- Modify: `src/cli/lib/assets.ts`
- Modify: `src/cli/program.ts` — only `program.name(...)`; help-text flips happen in chunk 4 (docs).
- Modify: `src/cli/commands/init.ts` — imports flip from `ralph-paths` to `apparat-paths`; `ralphDir` callsites flip to `apparatDir`.
- Modify: `src/cli/commands/pipeline.ts` — `RALPH_RUNS_KEEP` env var.
- Modify: every other source file with a `RALPH_*` env-var reference (per spec §4 table).
- Modify: every test file with a `RALPH_*` env-var assertion (per spec §4 table).

### Tasks

#### 2.1: Build-config and ambient declaration (TDD-friendly entry point)

- [x] **2.1.1: Update `src/types/globals.d.ts`.**

Read the file. Replace `__RALPH_PROD__` with `__APPARAT_PROD__`:

```typescript
// Before:
declare const __RALPH_PROD__: true | undefined;

// After:
declare const __APPARAT_PROD__: true | undefined;
```

- [x] **2.1.2: Update `tsup.config.ts:14`.**

```typescript
// Before:
define: { __RALPH_PROD__: "true" },

// After:
define: { __APPARAT_PROD__: "true" },
```

- [x] **2.1.3: Run `npx tsc --noEmit` — confirms TS guides next edits.**

Expected: errors at every `__RALPH_PROD__` reference site (lines 8, 9, 12 in `assets.ts`; lines 13, 18 in `daemon/runner.ts`; line 16 in `lib/daemon-client.ts`; line 63 in `attractor/handlers/agent-prep.ts`; lines 21, 260 in tests; lines 24, 30, 31, 32 in `smoke.test.ts`). All flag `Cannot find name '__RALPH_PROD__'`.

- [x] **2.1.4: Update `src/cli/lib/assets.ts` lines 8, 9, 12.**

Three occurrences. Replace `__RALPH_PROD__` with `__APPARAT_PROD__` in lines 8 (comment), 9 (comment), and 12 (the runtime check `typeof __RALPH_PROD__ !== "undefined"`).

- [x] **2.1.5: Update `src/daemon/runner.ts` lines 13, 18.**

Replace `RALPH_PROD__` with `APPARAT_PROD__`.

- [x] **2.1.6: Update `src/lib/daemon-client.ts` line 16.**

Replace `RALPH_PROD__` with `APPARAT_PROD__`.

- [x] **2.1.7: Update `src/attractor/handlers/agent-prep.ts` line 63.**

Replace `RALPH_PROD__` with `APPARAT_PROD__`.

- [x] **2.1.8: Update `src/cli/tests/smoke.test.ts` lines 24, 30, 31, 32.**

Four occurrences. Replace each with `APPARAT_PROD__`.

- [x] **2.1.9: Update `src/attractor/tests/agent-handler.test.ts` line 260.**

Replace with `APPARAT_PROD__`.

- [x] **2.1.10: Run `npx tsc --noEmit` — confirms zero `__RALPH_PROD__` references remain.**

Expected: PASS. (Or one residual `__APPARAT_PROD__` ambient-not-found if `globals.d.ts` was missed — re-check 2.1.1.)

- [x] **2.1.11: Repo-wide grep verifies the build-constant rename.**

Run:
```bash
grep -rn '__RALPH_PROD__\|RALPH_PROD__' src/ tsup.config.ts 2>/dev/null
```
Expected: zero hits.

#### 2.2: Other env-var renames

- [x] **2.2.1: Update `src/cli/commands/pipeline.ts:288` (`RALPH_RUNS_KEEP`).**

Replace `RALPH_RUNS_KEEP` with `APPARAT_RUNS_KEEP`.

- [x] **2.2.2: Update `src/cli/program.ts:129` (`RALPH_RUNS_KEEP`).**

Replace `RALPH_RUNS_KEEP` with `APPARAT_RUNS_KEEP`.

- [x] **2.2.3: Update `src/daemon/runner.ts` (`RALPH_TEST_CMD`).**

Lines 13 and 18 already touched in 2.1.5 for `RALPH_PROD__`. The `RALPH_TEST_CMD` reference is at the same lines (env-var read). Confirm both env-var keys flip in this file.

Replace each `RALPH_TEST_CMD` with `APPARAT_TEST_CMD`.

- [x] **2.2.4: Update `src/daemon/tests/runner.test.ts` (`RALPH_TEST_CMD`, lines 37, 46, 58, 72, 85, 108).**

Six occurrences. Replace each with `APPARAT_TEST_CMD`.

- [x] **2.2.5: Update `src/attractor/tests/engine-onNodeEnd.test.ts:21` (`RALPH_ENGINE_TEST_ALLOW_SPAWN`).**

Replace with `APPARAT_ENGINE_TEST_ALLOW_SPAWN`.

- [x] **2.2.6: Search for remaining `RALPH_` references in source.**

Run:
```bash
grep -rn 'RALPH_' src/ 2>/dev/null
```
Expected: zero hits. If `RALPH_MEDITATE_MAX_OPEN` or other env vars surface — flip them too. (The grill identified `RALPH_MEDITATE_MAX_OPEN` referenced only in `.ralph/meditations/stimuli/.triage/...chat-notes.md`, which is frozen prose; if it appears in source, this step catches it.)

- [x] **2.2.7: Run vitest — confirms env-var renames are wired through.**

Run: `npx vitest run`
Expected: PASS. Tests now read/write `APPARAT_*` env vars; source code emits `APPARAT_*`.

- [x] **2.2.8: Run `npm run build` — confirms the build constant rename works end-to-end.**

Run: `npm run build`
Expected: PASS. `dist/cli/index.js` is bundled with `__APPARAT_PROD__: "true"` injected by tsup.

#### 2.3: package.json field renames

- [x] **2.3.1: Update `package.json`.**

Read the file. Apply three edits:

```json
// Before:
"name": "ralph-cli",
"description": "Agentic loop runner CLI for AI-assisted project development",
...
"bin": {
  "ralph": "./dist/cli/index.js"
}

// After:
"name": "apparat-cli",
"description": "Apparatus — agentic loop runner CLI for AI-assisted project development",
...
"bin": {
  "apparat": "./dist/cli/index.js"
}
```

(npm name is provisional per spec §9; `apparat-cli` mirrors current `ralph-cli` shape and is post-merge editable.)

- [x] **2.3.2: Run `npm install` to update `package-lock.json` with the new package name.**

Run: `npm install`
Expected: `package-lock.json` updates the `name` field; no other deltas. If `node_modules` symlinks break, that is an `npm link` issue handled in 2.3.4.

- [x] **2.3.3: Run `npm run build` — verifies tsup still emits with the new bin shape.**

Run: `npm run build`
Expected: PASS. The `bin` rename does not affect bundling.

- [x] **2.3.4: Re-link the binary globally so `apparat` is on PATH.**

Run:
```bash
npm unlink -g ralph-cli 2>/dev/null || true
npm link
which apparat
```
Expected: `which apparat` returns a path under `~/.npm-global/bin/apparat`. The old `ralph` symlink may still exist depending on previous installs; chunk 4's verification step removes it.

#### 2.4: ralph-paths module rename

- [x] **2.4.1: `git mv` the module and its test.**

Run:
```bash
git mv src/cli/lib/ralph-paths.ts src/cli/lib/apparat-paths.ts
git mv src/cli/tests/ralph-paths.test.ts src/cli/tests/apparat-paths.test.ts
```
Expected: both moves recorded as renames; no errors.

- [x] **2.4.2: Update the renamed module body (`src/cli/lib/apparat-paths.ts`).**

Read the file. Rename the `ralphDir` export to `apparatDir`. Keep the literal `.ralph` in the body for now (chunk 3 flips this). Update internal callers (`meditationsDir`, `pipelinesDir`, etc.) to call `apparatDir` instead of `ralphDir`.

```typescript
// Before:
export function ralphDir(projectRoot: string): string {
  return join(projectRoot, ".ralph");
}

export function meditationsDir(projectRoot: string): string {
  return join(ralphDir(projectRoot), "meditations");
}
// ... etc.

// After (intermediate state — literal `.ralph` flips in chunk 3):
export function apparatDir(projectRoot: string): string {
  return join(projectRoot, ".ralph");
}

export function meditationsDir(projectRoot: string): string {
  return join(apparatDir(projectRoot), "meditations");
}
// ... etc. — every internal `ralphDir(...)` call → `apparatDir(...)`.
```

The seven downstream helpers (`meditationsDir`, `illuminationsDir`, `stimuliDir`, `sessionsDir`, `pipelinesDir`, `runsDir`, `runDir`) keep their names; only their bodies update.

- [x] **2.4.3: Update the renamed test file body (`src/cli/tests/apparat-paths.test.ts`).**

Replace `import { ralphDir, ... } from "../lib/ralph-paths.js"` with `import { apparatDir, ... } from "../lib/apparat-paths.js"`. Replace every `ralphDir(` callsite with `apparatDir(`. Assertion strings still expect `.ralph` literal until chunk 3 — leave them as `expect(apparatDir("/abs/project")).toBe("/abs/project/.ralph")`.

If the test name or `describe(...)` block contains "ralphDir", flip to "apparatDir".

- [x] **2.4.4: Run `npx tsc --noEmit` — TS surfaces every importer.**

Expected: errors at every `from "../lib/ralph-paths"`, `from "../../lib/ralph-paths"`, etc. import path, plus every `ralphDir(` callsite outside the renamed test.

- [x] **2.4.5: Update each importer.**

For each file flagged in 2.4.4:
- Update the import path: `ralph-paths.js` → `apparat-paths.js` (TypeScript module resolution still uses `.js` suffix in ESM).
- Update the imported symbol: `ralphDir` → `apparatDir` (other helpers unchanged).

Confirmed importer list (verified by `grep -rn '"\.\.\?/lib/ralph-paths' src/`):

- `src/cli/commands/init.ts:5,10,15` — imports `ralphDir` (and others); call site at line 15.
- `src/cli/commands/pipeline.ts:19` — imports `runDir, runsDir` (no `ralphDir`; only the import path string flips).
- `src/cli/commands/meditate.ts:4` — imports `illuminationsDir` (path-only flip).
- `src/cli/mcp/illumination-server.ts:6` — imports `illuminationsDir` (path-only flip).
- `src/cli/lib/pipeline-resolver.ts:4` — imports `pipelinesDir` (path-only flip).
- `src/cli/tests/pipeline-failure-reason.test.ts:6` — imports `runsDir` (path-only flip).
- `src/cli/tests/pipeline-trace-command-validation.test.ts:6` — imports `runDir` (path-only flip).
- `src/cli/tests/pipeline-trace-lookup.test.ts:6` — imports `runDir` (path-only flip).

Eight importers total. Re-run the grep before editing to confirm the list is current; `tsc --noEmit` between 2.4.4 and 2.4.5 will surface any addition.

- [x] **2.4.5b: Rename the daemon-home `ralphDir` const in `src/daemon/index.ts:12-14`.**

This is a *different* `ralphDir` from the path-helper export — it is a local const naming the daemon's home directory at `~/.ralph/`, not a project-local `<project>/.ralph/`. The two were given the same name in the original code but refer to different roots. To avoid conflation in the rename, give the daemon-home const a distinct name reflecting its referent.

Read the file. Apply:

```typescript
// Before (lines 12-14):
const ralphDir = join(process.env.HOME || homedir(), ".ralph");
const pidPath = join(ralphDir, "daemon.pid");
const sockPath = join(ralphDir, "daemon.sock");

// After:
const apparatHome = join(process.env.HOME || homedir(), ".apparat");
const pidPath = join(apparatHome, "daemon.pid");
const sockPath = join(apparatHome, "daemon.sock");
```

The literal `.ralph` flips to `.apparat` here (different from chunk 3's project-folder rename — this is the user-home daemon dir, not on-disk inside a project). Daemons running pre-rename keep their PID file at `~/.ralph/daemon.pid` until they restart; on next daemon start, the new binary writes to `~/.apparat/daemon.pid` and the stale `~/.ralph/daemon.pid` becomes orphaned. The user kills any pre-rename daemon manually before invoking the new binary (see chunk 4 verification).

- [x] **2.4.5c: Verify no other local `ralphDir` const exists.**

Run:
```bash
grep -rn '\bconst ralphDir\b\|\blet ralphDir\b' src/
```
Expected: zero hits.

- [x] **2.4.5d: Flip the daemon-client `~/.ralph/` references.**

`src/lib/daemon-client.ts` has two references to the same daemon-home directory that step 2.4.5b just renamed in `src/daemon/index.ts`. Both must flip in the same chunk to keep client + daemon agreeing on the socket path.

Read `src/lib/daemon-client.ts`. Apply:

```typescript
// Before (line 11):
const SOCK_PATH = join(process.env.HOME || homedir(), ".ralph", "daemon.sock");

// After:
const SOCK_PATH = join(process.env.HOME || homedir(), ".apparat", "daemon.sock");

// Before (line 40 error message):
throw new Error("Daemon failed to start — check permissions on ~/.ralph/");

// After:
throw new Error("Daemon failed to start — check permissions on ~/.apparat/");
```

- [x] **2.4.5e: Repo-wide grep — every `~/.ralph/` reference must now be a `~/.apparat/`.**

Run:
```bash
grep -rn '~/\.ralph\|"\.ralph"' src/
```
Expected: zero hits in `.ts` files. Any hit signals an unflipped daemon-home reference. Note: project-local `.ralph/` literals (returned by `apparatDir()` and assertion strings) are the deferred work for chunk 3 — those are NOT prefixed with `~/` and are acceptable here.

- [x] **2.4.6: Run `npx tsc --noEmit` — verifies zero stale imports.**

Expected: PASS.

- [x] **2.4.7: Run vitest — confirms the module rename did not break runtime.**

Run: `npx vitest run`
Expected: PASS. Tests still target `.ralph/` paths because `apparatDir` still returns `.ralph` literal; the module/function rename is internal.

#### 2.5: program.name flip (binary identity)

- [x] **2.5.1: Update `src/cli/program.ts:19` `program.name("ralph")` → `program.name("apparat")`.**

Read the file. The `program.name(...)` call is on or near line 19 inside `createProgram()`. Replace `"ralph"` with `"apparat"`.

The help-text strings (lines ~27–95 containing `ralph init`, `ralph implement`, `.ralph/` paths) are NOT touched in this chunk — those flip in chunk 4 alongside README/VISION/CONTEXT.

- [x] **2.5.2: Run vitest — sanity check, nothing depends on the program name.**

Run: `npx vitest run`
Expected: PASS.

- [x] **2.5.3: Smoke-test the renamed binary.**

Run: `node dist/cli/index.js --help | head -5`
Expected: top-line shows `Usage: apparat [...]` (the help text below still says "ralph init my-app" — chunk 4 fixes that).

#### 2.6: Commit chunk 2

- [x] **2.6.1: Run full verification before commit.**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: all PASS.

- [x] **2.6.2: Commit.**

```bash
git add -A
git status   # confirm: package.json + tsup.config.ts + globals.d.ts + ralph-paths→apparat-paths rename + every src/ file modified, no .ralph/ folder rename yet
git commit -m "$(cat <<'EOF'
refactor: rename code-side identifiers (ralph → apparat / apparatus)

Renames every source-code identifier without touching the on-disk
.ralph/ folder yet (chunk 3 does that):

- package.json: name=apparat-cli, bin.apparat (was ralph)
- tsup.config.ts: __APPARAT_PROD__ build constant
- src/types/globals.d.ts: ambient declaration flipped
- src/cli/lib/ralph-paths.ts → apparat-paths.ts (git mv)
- src/cli/tests/ralph-paths.test.ts → apparat-paths.test.ts (git mv)
- ralphDir() → apparatDir() (literal .ralph kept; chunk 3 flips)
- Every RALPH_* env var → APPARAT_*: PROD, RUNS_KEEP, TEST_CMD,
  ENGINE_TEST_ALLOW_SPAWN
- program.name("ralph") → program.name("apparat")

Help-text strings, .ralph/ path literals, and READMEs are NOT
touched here — chunks 3 and 4 handle those atomically with the
folder mv and doc rewrite.
EOF
)"
```

Expected: commit succeeds.

- [x] **2.6.3: Verify chunk 2 final state.**

Run:
```bash
grep -rn '__RALPH_PROD__\|RALPH_RUNS_KEEP\|RALPH_TEST_CMD\|RALPH_ENGINE_TEST_ALLOW_SPAWN\|ralphDir\b' src/ 2>/dev/null
```
Expected: zero hits in source code.

```bash
grep -n 'ralph' package.json
```
Expected: zero hits. (Verified pre-edit: `package.json` has no `repository`, `homepage`, or `bugs` URL fields, so no GitHub-URL-bound `ralph-cli` strings exist there. Add the URL fields in chunk 4 if desired, with the new `apparatus` repo URL.)

```bash
ls src/cli/lib/apparat-paths.ts && ls src/cli/tests/apparat-paths.test.ts
```
Expected: both files exist; old paths gone.

### Chunk-3 prep notes (from chunk-2 review)

- The lone surviving `Ralph`-prefixed identifier is `getRalphCliPath` in `src/daemon/runner.ts:11`. Plan it into chunk 3 alongside the `.ralph` literal flip in `apparatDir()`.
- Stale unused imports in `src/daemon/tests/runner.test.ts:9` (`getRalphCliPath`, `killSession`) — pre-existing, but worth cleaning up in chunk 3 if convenient.

---

## Chunk 3: Folder rename + path-literal flip

Goal: the on-disk `.ralph/` directory becomes `.apparat/`, and every path-string literal in source/tests/bundled-pipelines flips atomically with the move. The literal inside `apparatDir()` (deferred from chunk 2) flips here, so tests and runtime resolve to `.apparat/` from the moment `git mv` lands.

After this chunk: `npx tsc --noEmit`, `npx vitest run`, and `npm run build` all pass against the new layout. No `.ralph/` literals remain in `src/`, bundled pipelines, the project-self `.gitignore`, or live illuminations/scenarios. Frozen prose (sessions, runs, plans, ADRs 0001–0009) untouched.

**Sequencing rationale.** The order below flips literals BEFORE the `git mv` so that the moment the directory exists at its new location, every reader resolves to the right place. The reverse order (mv first, then literal flip) would leave a window where `apparatDir(REPO_ROOT)` returns `.ralph` while no `.ralph/` exists on disk — every test fails.

**Files modified or moved (high-level — exact set discovered by grep in step 3.5):**
- Modify literal: `src/cli/lib/apparat-paths.ts` (the `.ralph` → `.apparat` flip in `apparatDir`).
- Modify literal: `src/cli/tests/apparat-paths.test.ts` (assertion strings).
- Modify literal: `src/cli/lib/assets.ts:42` (`.ralph/meditations/stimuli` literal).
- Move: `git mv .ralph .apparat` (entire tree, ~all-files-tracked-by-git inside).
- Modify literal: every `src/**/*.ts` file with a hardcoded `.ralph/` path string.
- Modify literal: every `src/cli/pipelines/**/*.{md,dot,mjs}` file with `.ralph/` references.
- Modify literal: `.gitignore` (the `.ralph/runs/` line).
- `sed` pass: `.apparat/meditations/illuminations/*.md` (alive only) and `.apparat/scenarios/**`.

### Tasks

#### 3.1: Flip the literal inside `apparatDir()`

- [x] **3.1.1: Update `apparat-paths.test.ts` first (TDD red).**

Read `src/cli/tests/apparat-paths.test.ts`. Flip every assertion string from `.ralph` to `.apparat`:

```typescript
// Before (the test currently asserts .ralph because chunk 2 left the literal alone):
expect(apparatDir(project)).toBe("/abs/project/.ralph");
expect(meditationsDir(project)).toBe("/abs/project/.ralph/meditations");
// ... etc. for illuminationsDir, stimuliDir, sessionsDir, pipelinesDir, runsDir, runDir.

// After:
expect(apparatDir(project)).toBe("/abs/project/.apparat");
expect(meditationsDir(project)).toBe("/abs/project/.apparat/meditations");
// ... etc.
```

The `describe("ralph-paths", ...)` (or equivalent) block name should already have flipped to `apparat-paths` in chunk 2 step 2.4.3; if not, flip it now.

- [x] **3.1.2: Run the test to verify red.**

Run: `npx vitest run src/cli/tests/apparat-paths.test.ts`
Expected: FAIL — assertions expect `.apparat`, source returns `.ralph`.

- [x] **3.1.3: Update `apparat-paths.ts` body (green).**

Read `src/cli/lib/apparat-paths.ts`. Flip the literal:

```typescript
// Before:
export function apparatDir(projectRoot: string): string {
  return join(projectRoot, ".ralph");
}

// After:
export function apparatDir(projectRoot: string): string {
  return join(projectRoot, ".apparat");
}
```

Other helper bodies (`meditationsDir`, etc.) call `apparatDir` and inherit the new literal automatically — no edit needed.

- [x] **3.1.4: Run the test to verify green.**

Run: `npx vitest run src/cli/tests/apparat-paths.test.ts`
Expected: PASS.

- [x] **3.1.5: Run full vitest — confirm what now fails.**

Run: `npx vitest run`
Expected: FAIL across many tests. Tests with hardcoded `.ralph/` path constants now diverge from the live layout (which is still `.ralph/` on disk, but `apparatDir` returns `.apparat/`). This failure surface is the input set for steps 3.4–3.7.

#### 3.2: Flip the `assets.ts:42` literal

- [x] **3.2.1: Update `src/cli/lib/assets.ts:42`.**

Read the file. The `getMetaMeditationsDir()` function constructs a hardcoded `.ralph/meditations/stimuli` path:

```typescript
// Before (line 42):
return join(packageRoot, ".ralph", "meditations", "stimuli");

// After:
return join(packageRoot, ".apparat", "meditations", "stimuli");
```

#### 3.3: Flip remaining source-code `.ralph/` literals

- [x] **3.3.1: Enumerate `.ralph/` literals in source.**

Run:
```bash
grep -rn '\.ralph/\|"\.ralph"\|'\''\.ralph'\''' src/ --include='*.ts' \
  | grep -v 'ralph-paths.ts'  # already handled in 3.1
```
Expected: a list of files in `src/cli/commands/`, `src/cli/mcp/`, possibly `src/attractor/`. The list IS the editing surface for this step.

- [x] **3.3.2: For each file in the enumeration, replace every `.ralph` literal with `.apparat`.**

Apply by file using `Edit` with `replace_all: true` per occurrence as appropriate. Examples likely to appear:

- `src/cli/commands/init.ts` — the `.gitignore`-append rule writes `.ralph/runs/`. Flip to `.apparat/runs/`.
- `src/cli/commands/pipeline.ts` — log-line strings or error messages mentioning `.ralph/`.
- `src/cli/mcp/illumination-server.ts` — fallback path strings.
- `src/cli/program.ts` — every `.ralph/` literal in help-text strings (lines ~27–124 mention `.ralph/runs/<runId>/checkpoint.json`, `.ralph/pipelines/...`, etc.). Path literals flip here. Sentence-shaped prose ("Scaffold .ralph/ tree", "ralph project") stays in chunk 4 — that section is the prose-rewrite focus.

The carve-out between chunk 3 and chunk 4 for `program.ts`:
- **Chunk 3 (this step):** path-string literals like `.ralph/`, `.ralph/runs/`, `.ralph/pipelines/...` — anything that resembles a file path. These flip mechanically with no judgment.
- **Chunk 4:** `ralph init`, `ralph implement`, etc. command-name references; the `program.name(...)` flip already happened in chunk 2.5.1. Sentence-shape prose like "Scaffold `.apparat/` tree" (note the `.apparat/` flipped here in chunk 3, but the surrounding sentence may still say "ralph") gets one final pass in chunk 4.

After each file edit: re-run grep on that file to confirm zero `\.ralph/` remain.

- [x] **3.3.3: Re-run the enumeration grep.**

Run:
```bash
grep -rn '\.ralph/\|"\.ralph"' src/ --include='*.ts'
```
Expected: zero hits. Every `.ralph/` path literal is gone, including inside help-text strings. Word-form "ralph" (without leading dot) is still expected in `program.ts` and is owned by chunk 4.

#### 3.4: `git mv .ralph .apparat` (the project-self folder rename)

- [x] **3.4.1: Pre-flight: verify `.apparat/` does not yet exist.**

Run: `ls -d .apparat 2>/dev/null && echo EXISTS || echo OK`
Expected: `OK`. If `EXISTS`, abort and inspect — chunk should run on a clean repo state.

- [x] **3.4.2: Verify `.ralph/` is fully tracked by git (no untracked files inside).**

Run: `git status --porcelain .ralph/ | grep -v '^[ M]'`
Expected: zero output. If untracked files exist (e.g. local run state, scratch notes), commit or stash them before the move; otherwise `git mv` will not move them and the working tree state diverges from index.

- [x] **3.4.3: `git mv .ralph .apparat`.**

Run: `git mv .ralph .apparat`
Expected: success, no errors. Single command moves the entire tree atomically as a rename.

- [x] **3.4.4: Verify the move.**

Run:
```bash
ls -d .apparat && ls -d .ralph 2>/dev/null
git status | head -5
```
Expected: `.apparat` lists; `.ralph` does not exist; `git status` shows the move staged as renames.

#### 3.5: Flip `.ralph/` literals in test files

- [x] **3.5.1: Enumerate test files with `.ralph/` literals.**

Run:
```bash
grep -rln '\.ralph/\|"\.ralph"' src/ --include='*.test.ts'
```
Expected list (per spec §4): `init.test.ts`, `pipeline.test.ts`, `pipeline-show.test.ts`, the 14 `pipeline-smoke-*-folder.test.ts` files, plus possibly `pipeline-trace-*.test.ts` and others depending on hardcoded fixtures.

- [x] **3.5.2: For each enumerated test file, replace every `.ralph` literal with `.apparat`.**

Common replacement patterns (apply per file):

```typescript
// String-literal forms:
".ralph/pipelines/..."  → ".apparat/pipelines/..."
".ralph/scenarios/..."  → ".apparat/scenarios/..."
".ralph/runs/..."       → ".apparat/runs/..."
".ralph/meditations/..." → ".apparat/meditations/..."
".ralph/sessions/..."   → ".apparat/sessions/..."

// join() array-arg forms:
join(dir, ".ralph", "pipelines", ...)  → join(dir, ".apparat", "pipelines", ...)
join(dir, ".ralph", "scenarios", ...)  → join(dir, ".apparat", "scenarios", ...)
// ... etc.

// describe / it test names with .ralph in the string:
describe(".ralph/pipelines/ ...", ...)  → describe(".apparat/pipelines/ ...", ...)
```

For each of the 14 smoke-folder tests, the per-file `<subdir>` token in the path strings is preserved; only the `.ralph` segment flips.

Process per file: read; identify all `.ralph` occurrences; apply Edit with `replace_all: true` for the literal `.ralph` → `.apparat`; re-grep the file to confirm zero residual hits.

- [x] **3.5.3: Re-run the enumeration grep.**

Run:
```bash
grep -rln '\.ralph/\|"\.ralph"' src/ --include='*.test.ts'
```
Expected: zero files.

- [x] **3.5.4: Run vitest to verify green.**

Run: `npx vitest run`
Expected: PASS. Tests now reference `.apparat/` paths and the on-disk directory matches.

#### 3.6: Flip `.ralph/` literals + word-form "ralph" in bundled pipelines

- [x] **3.6.1: Enumerate every `ralph`/`Ralph`/`RALPH_`/`.ralph/` hit, pinned to file:line with verbatim source.**

This is the inventory-first step — judgment per occurrence happens once, against a checklist, not in a streaming edit pass. Run:

```bash
grep -rn '\.ralph/\|RALPH_\|\bralph\b\|\bRalph\b' src/cli/pipelines/ \
  --include='*.md' --include='*.dot' --include='*.mjs' \
  > /tmp/apparat-pipelines-pins.txt
wc -l /tmp/apparat-pipelines-pins.txt
cat /tmp/apparat-pipelines-pins.txt
```

Expected: file lists each hit as `<path>:<line>:<verbatim source>`. Read the file end-to-end. For each pin, decide the replacement noun:

| Pattern | Decision rule | Replacement |
|---|---|---|
| `.ralph/<sub>` (path literal) | mechanical | `.apparat/<sub>` |
| `RALPH_<NAME>` (env var) | mechanical | `APPARAT_<NAME>` |
| `ralph` followed by a CLI verb (`ralph init`, `ralph pipeline`, `ralph heartbeat`) | binary referent | `apparat <verb>` |
| `ralph` followed by "project" / "harness" / "system" / standalone subject | brand referent | `apparatus` |
| `ralph-shaped` (idiom) | binary-matching idiom | `apparat-shaped` |
| `ralph-cli` (npm package context) | provisional package name | `apparat-cli` |
| `Ralph` (capitalized, prose) | brand referent | `Apparatus` |

Annotate the pin file with the chosen replacement for each line. The annotated file is the input to step 3.6.2.

- [x] **3.6.2: Apply the pinned replacements file-by-file.**

For each file with hits:
1. Read the file.
2. Apply each pinned edit (use `Edit` tool with the verbatim source as `old_string` and the chosen replacement as `new_string`).
3. Re-run `grep -n '\.ralph/\|RALPH_\|\bralph\b\|\bRalph\b' <file>` — expected zero hits.

- [x] **3.6.3: Re-grep to confirm zero residue across all bundled pipelines.**

Run: `grep -rn '\.ralph/\|RALPH_\|\bralph\b\|\bRalph\b' src/cli/pipelines/`
Expected: zero hits.

#### 3.7: Flip `.ralph/runs/` in `.gitignore`

- [x] **3.7.1: Update `.gitignore` (the project-self gitignore).**

Read the file. Find the line:
```
.ralph/runs/
```
Replace with:
```
.apparat/runs/
```

This is the project-self gitignore. The `init.ts` scaffolder's gitignore-append rule was already updated in step 3.3.2.

#### 3.8: `sed` pass on live working documents

- [x] **3.8.1: Identify alive illuminations.**

Run: `ls .apparat/meditations/illuminations/*.md 2>/dev/null | head`
Expected: the list (post-mv) of currently-alive illumination markdown files. Each is operator-authored prose that may reference `.ralph/` paths the implementer agent reads.

- [x] **3.8.2: `sed`-replace path strings only in alive illuminations.**

Run:
```bash
find .apparat/meditations/illuminations -maxdepth 1 -name '*.md' -print0 \
  | xargs -0 sed -i '' 's|\.ralph/|.apparat/|g'
```

(macOS `sed -i ''` syntax. On linux, `sed -i 's|...|...|g'` without the empty quote.)

This flips only the path-string `.ralph/` → `.apparat/`; the operator-authored body prose is otherwise untouched. The `-maxdepth 1` excludes the `.triage/` subdirectory which contains historical chat notes (frozen prose).

- [x] **3.8.3: `sed`-replace path strings in `.apparat/scenarios/`.**

Run:
```bash
find .apparat/scenarios -type f \( -name '*.md' -o -name '*.dot' -o -name '*.mjs' \) -print0 \
  | xargs -0 sed -i '' 's|\.ralph/|.apparat/|g'
```

These are smoke-pipeline test fixtures — live test code, not history — so a path-string flip is required for the engine to find resources.

- [x] **3.8.4: Verify the sed pass found targets and didn't touch frozen prose.**

Run:
```bash
git diff --stat .apparat/meditations/illuminations .apparat/scenarios | head -20
git status .apparat/sessions .apparat/runs   # expected: empty (frozen)
```
Expected: diff stat shows changes only in alive illuminations + scenarios; sessions and runs report no modifications.

#### 3.9: Final verification of chunk 3

- [x] **3.9.1: Repo-wide invariant grep.**

Run:
```bash
# All non-frozen surfaces must be free of .ralph/ literals:
grep -rn '\.ralph/' src/ .apparat/scenarios/ .apparat/meditations/illuminations/ .apparat/pipelines/ \
  --include='*.ts' --include='*.dot' --include='*.md' --include='*.mjs' \
  | head -20
```
Expected: zero hits. Every `.ralph/` path literal across source, tests, bundled pipelines, alive illuminations, and scenarios has flipped. Word-form "ralph" (without leading dot) is still expected in `src/cli/program.ts` help text and `README.md`/`VISION.md`/`CONTEXT.md` etc.; chunk 4 finishes those.

- [x] **3.9.2: TypeScript check.**

Run: `npx tsc --noEmit`
Expected: PASS.

- [x] **3.9.3: Full vitest.**

Run: `npx vitest run`
Expected: PASS.

- [x] **3.9.4: Build.**

Run: `npm run build`
Expected: PASS. `dist/pipelines/` re-emitted from `src/cli/pipelines/` (post-rename); `dist/cli/index.js` bundled with `__APPARAT_PROD__: "true"`.

- [x] **3.9.5: Smoke — `node dist/cli/index.js init` in a temp dir.**

Run:
```bash
TMPDIR=$(mktemp -d /tmp/apparat-init-test.XXXXXX)
cd "$TMPDIR"
node /Users/josu/Documents/projects/ralph-cli/dist/cli/index.js init
ls -la               # expected: CONTEXT.md, VISION.md, README.md, .apparat/, docs/, .gitignore
ls .apparat/         # expected: pipelines/, meditations/{illuminations,stimuli}/, sessions/, runs/
cat .gitignore       # expected: contains .apparat/runs/
cd /Users/josu/Documents/projects/ralph-cli
rm -rf "$TMPDIR"
```
Expected: all assertions hold. Init scaffolds the new `.apparat/` layout.

#### 3.10: Commit chunk 3

- [x] **3.10.1: Commit.**

```bash
git add -A
git status   # confirm: .ralph→.apparat tree rename + every literal flip + .gitignore + sed-touched live docs
git commit -m "$(cat <<'EOF'
refactor: rename project-local folder .ralph → .apparat

git mv .ralph .apparat (entire tree). Flips:

- apparatDir() return-string literal in src/cli/lib/apparat-paths.ts
- assets.ts:42 hardcoded .ralph/meditations/stimuli literal
- Every .ralph/ path string in src/ (commands, mcp, attractor) outside
  addHelpText (chunk 4 owns help-text rewrite)
- All test fixtures: init.test.ts, pipeline.test.ts, pipeline-show.test.ts,
  14 pipeline-smoke-*-folder.test.ts, plus pipeline-trace-* tests
- All bundled pipelines under src/cli/pipelines/**: .md / .dot / .mjs
- .gitignore self-line: .apparat/runs/
- Live working documents (path-only sed): alive illuminations under
  .apparat/meditations/illuminations/*.md and .apparat/scenarios/**

Frozen prose untouched: .apparat/sessions/, .apparat/runs/, ADRs 0001-0009,
docs/superpowers/plans/*. References to "ralph" in those files are
historical record.
EOF
)"
```

Expected: commit succeeds; `git log -1 --stat` shows the rename plus dozens of small literal flips.

- [x] **3.10.2: Verify chunk 3 final state.**

Run:
```bash
test -d .apparat && test ! -d .ralph && echo "folder rename ok"
npx tsc --noEmit && echo "tsc ok"
npx vitest run > /dev/null && echo "vitest ok"
npm run build > /dev/null && echo "build ok"
```
Expected: all four `ok` lines print.

---

## Chunk 4: Doc rewrite + ADR-0010 finalize + final verification

Goal: every doc surface (README, VISION, CONTEXT, AGENTS, harness/) reflects the new naming. Help-text strings in `src/cli/program.ts` flip alongside the docs (single focused diff). ADR-0010 transitions from `Status: draft` to `Status: accepted`. Chunk 4 closes with full smoke + grep invariants.

After this chunk: zero `ralph` / `Ralph` / `RALPH_` / `__RALPH_PROD__` / `\.ralph/` references remain in any non-frozen surface. The renamed PR is ready to merge.

**Files modified:**
- Modify: `src/cli/program.ts` — every help-text string under `addHelpText`/`description` containing `ralph` or `.ralph/`.
- Modify: `README.md` — every command snippet, install line, folder reference.
- Modify: `VISION.md` — brand, binary, folder, idiom, optional apparatchik metaphor paragraph.
- Modify: `CONTEXT.md` — every `.apparat/` reference where source was `.ralph/`, idiom flip, ADR-0010 cross-reference.
- Modify: `AGENTS.md` — body refs.
- Modify: `docs/harness/README.md` — `.ralph/` paths + binary refs.
- Modify: `docs/harness/tmux-drive.md` — same.
- Modify: `docs/adr/0010-rename-to-apparatus.md` — `Status: draft` → `Status: accepted`.

### Tasks

#### 4.1: Help-text strings in `program.ts` — word-form "ralph" only

Chunk 3 already flipped every `.ralph/` path literal in `program.ts` help text. Chunk 4 finishes the prose-shape rewrites: command names (`ralph init` → `apparat init`) and idiomatic phrases ("ralph project", "ralph-shaped").

- [ ] **4.1.1: Enumerate remaining word-form references.**

Run:
```bash
grep -n '\bralph\b' src/cli/program.ts
```
Expected: ~25 hits — `ralph <command>` invocations and standalone "ralph" in prose. Should NOT include `.ralph/` path strings (chunk 3 cleared those).

- [ ] **4.1.2: Flip every `ralph` command and prose word.**

Apply patterns (literal find/replace):

- `ralph init` → `apparat init`
- `ralph implement` → `apparat implement`
- `ralph meditate` → `apparat meditate`
- `ralph heartbeat ...` → `apparat heartbeat ...`
- `ralph pipeline ...` → `apparat pipeline ...`
- "ralph project" → "apparat-shaped project" (idiom flip)
- "ralph-shaped" → "apparat-shaped"
- "ralph cleanly terminates" → "apparat cleanly terminates"

The `program.name("apparat")` from chunk 2 step 2.5.1 is unchanged.

- [ ] **4.1.3: Verify zero `ralph` references remain in `program.ts`.**

Run: `grep -n '\bralph\b\|\bRalph\b\|\.ralph/' src/cli/program.ts`
Expected: zero hits.

#### 4.2: README.md

- [ ] **4.2.1: Read README end-to-end.**

Open `/Users/josu/Documents/projects/ralph-cli/README.md`. Inventory every reference to `ralph`, `Ralph`, `RALPH_`, `.ralph/`, `ralph-cli`.

- [ ] **4.2.2: Apply replacements.**

Patterns (case-sensitive):

- Title `# ralph-cli` → `# apparatus`
- Tagline / first paragraph mentions of "ralph" → "apparatus" or "apparat" depending on referent (project name vs binary).
- `npm install -g ralph-cli` → `npm install -g apparat-cli`
- `ralph init`, `ralph implement`, `ralph meditate`, `ralph heartbeat`, `ralph pipeline ...` → `apparat ...`
- `.ralph/{pipelines,meditations/...,sessions,runs}` → `.apparat/{pipelines,meditations/...,sessions,runs}`
- `.ralph/runs/` → `.apparat/runs/`
- `.ralph/pipelines/illumination-to-implementation/...` → `.apparat/pipelines/...`
- "ralph-shaped" → "apparat-shaped"
- `RALPH_RUNS_KEEP` → `APPARAT_RUNS_KEEP`
- "ralph cleanly terminates" → "apparat cleanly terminates"
- The `## Where to look` section's `**`src/`** — TypeScript source (CLI, pipeline engine, daemon, MCP servers)` line and similar — confirm no stale "ralph" word usage.

- [ ] **4.2.3: Add the apparatchik metaphor placeholder.**

Per spec §9, reserve a slot in the README intro:

```markdown
<!-- TODO: apparatchik flavor — explain that apparatus = the machine, apparatchik = an agent doing one job in service of the larger goal. -->
```

The user fills this in later or leaves the placeholder in place; either is acceptable.

- [ ] **4.2.4: Verify zero `ralph` references remain in README.**

Run: `grep -n '\bralph\|\.ralph/\|RALPH_\|ralph-cli' README.md`
Expected: zero hits.

#### 4.3: VISION.md

- [ ] **4.3.1: Read VISION end-to-end.**

Open `/Users/josu/Documents/projects/ralph-cli/VISION.md`. Inventory every `ralph`-bearing reference.

- [ ] **4.3.2: Apply replacements.**

- Title `# ralph-cli — Vision` → `# apparatus — Vision`
- "ralph is the engine" → "apparatus is the engine"
- "ralph-cli npm package" → "apparat-cli npm package"
- "ralph-shaped project" → "apparat-shaped project"
- `<project>/.ralph/` → `<project>/.apparat/`
- "Not a Claude Code replacement. Claude is the muscle; ralph is the choreography." → "Not a Claude Code replacement. Claude is the muscle; apparatus is the choreography."
- ADR-0007/0008 references add a parenthetical pointer to ADR-0010 (naming superseded).
- Optional: add the apparatchik metaphor inline. Per the user's grill commitment (Q3 + Q11), this lands in VISION as a late-paragraph addition. Suggested placement: end of `## What it is`. Suggested phrasing — kept short, not bombastic:

  > Inside the metaphor: the project is the *apparatus* — the machine that runs the work. Each agent is an *apparatchik* — a worker doing one job in service of the apparatus's larger goal. Pipelines choreograph apparatchiks into a working machine.

  If the user wants to defer the addition, replace with `<!-- TODO: apparatchik flavor -->` instead.

- [ ] **4.3.3: Verify zero `ralph` references remain.**

Run: `grep -n '\bralph\|\.ralph/\|ralph-cli' VISION.md`
Expected: zero hits.

#### 4.4: CONTEXT.md

- [ ] **4.4.1: Read CONTEXT end-to-end.**

Open `/Users/josu/Documents/projects/ralph-cli/CONTEXT.md`. Inventory every `ralph`-bearing reference.

- [ ] **4.4.2: Apply replacements.**

- Title `# ralph-cli — Domain Language` → `# apparatus — Domain Language`
- §Agent loading paragraph: "Stray `~/.ralph/agents/` files on contributor machines are now inert." → "Stray `~/.apparat/agents/` files on contributor machines are now inert."
- §Project-local layout heading: "ralph-shaped project" → "apparat-shaped project"
- The layout-tree code block: `.ralph/` → `.apparat/`
- "ralph-defined project-local artefacts" → "apparat-defined project-local artefacts"
- Throughout: every `.ralph/` → `.apparat/`, every "ralph" word → "apparat" (binary referent) or "apparatus" (brand referent) — read each sentence to choose.
- §Janitor: "via `ralph heartbeat`" → "via `apparat heartbeat`".
- ADR cross-references: ADR-0007 + ADR-0008 references gain a parenthetical: `(naming superseded by ADR-0010)`.
- Closing footer: extend to "ADR-0007 + ADR-0008 are partly superseded by ADR-0010 (naming-only)."

- [ ] **4.4.3: Verify zero `ralph` references remain (excluding historical-fact mentions).**

Run: `grep -n '\bralph\|\.ralph/' CONTEXT.md`
Expected: zero hits. CONTEXT describes present-tense domain language; no historical references belong here (history goes in ADRs).

#### 4.5: AGENTS.md and harness docs

- [ ] **4.5.1: Update `AGENTS.md`.**

Read the file. Patterns:
- `RALPH_PROD__` → `APPARAT_PROD__` (line 20).
- Any `.ralph/` path strings → `.apparat/`.
- "ralph" word → "apparatus" or "apparat" by context.

- [ ] **4.5.2: Update `docs/harness/README.md`.**

Read the file. Flip:
- `.ralph/` paths → `.apparat/`
- "ralph" binary references → "apparat"
- "ralph-cli" repo references → "apparatus"
- The `~/.ralph/harness/<run-id>/` scratchpad path mentioned in MEMORY.md → `~/.apparat/harness/<run-id>/`. (Current chunk 2 only flipped daemon-home `~/.ralph/`; the harness scratchpad uses a different code path. Verify by reading the harness setup.)

- [ ] **4.5.3: Update `docs/harness/tmux-drive.md`.**

Same pattern as 4.5.2. The tmux-drive doc contains shell snippets with `ralph` invocations — flip every command name to `apparat`. Path strings to `~/.ralph/harness/...` flip to `~/.apparat/harness/...` if present.

- [ ] **4.5.4: Verify zero `ralph` in harness/AGENTS docs.**

Run: `grep -n '\bralph\|\.ralph/\|RALPH_' AGENTS.md docs/harness/`
Expected: zero hits.

#### 4.6: Finalize ADR-0010

- [ ] **4.6.1: Flip ADR-0010 status.**

Read `docs/adr/0010-rename-to-apparatus.md`. Replace:

```markdown
**Status:** Draft (pending rename PR completion)
```

with:

```markdown
**Status:** Accepted (2026-05-05)
```

- [ ] **4.6.2: Add ADR-0007 and ADR-0008 footer pointers (one line each).**

Append to `docs/adr/0007-ralph-folder-as-project-local-home.md`:

```markdown

---

**Update 2026-05-05:** Naming superseded by [ADR-0010](0010-rename-to-apparatus.md). The folder name `.ralph/` becomes `.apparat/`; the project-local home principle stands. ADR-0008's two-clause partition principle stands.
```

Append to `docs/adr/0008-partial-revert-of-ralph-folder.md`:

```markdown

---

**Update 2026-05-05:** Naming superseded by [ADR-0010](0010-rename-to-apparatus.md). The folder name `.ralph/` becomes `.apparat/`; the two-clause partition principle stands.
```

(These footers are the *only* edits to ADRs 0001–0009. The "MADR append-only" convention is preserved by appending a clearly-separated update line, not by editing original prose.)

#### 4.7: Final verification

- [ ] **4.7.1: Repo-wide invariant grep — zero `ralph` in non-frozen surfaces.**

Run:
```bash
grep -rn '\bralph\b\|\bRalph\b\|RALPH_\|__RALPH_PROD__\|\.ralph/\|ralph-cli\|ralphDir' \
  src/ package.json tsup.config.ts README.md VISION.md CONTEXT.md AGENTS.md \
  docs/harness/ docs/adr/0010-* \
  .apparat/scenarios/ .apparat/meditations/illuminations/ .apparat/pipelines/ \
  --include='*.ts' --include='*.md' --include='*.dot' --include='*.mjs' \
  --include='*.json' 2>/dev/null
```
Expected: zero hits.

- [ ] **4.7.2: Frozen-prose unchanged invariant.**

Run:
```bash
git diff HEAD~4 HEAD --name-only \
  | grep -E '^docs/adr/000[1-9]-|^docs/superpowers/plans/|^\.apparat/sessions/|^\.apparat/runs/'
```
Expected: only `0007-...md` and `0008-...md` (the footer additions from step 4.6.2). Plans, sessions, runs all absent — never modified by the rename PR.

- [ ] **4.7.3: TypeScript + vitest + build all pass.**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: all PASS.

- [ ] **4.7.4: Smoke — `apparat --help` is internally coherent.**

Run: `node dist/cli/index.js --help | head -50`
Expected: every line says `apparat` (no `ralph`); every path says `.apparat/` (no `.ralph/`).

- [ ] **4.7.5: Smoke — `apparat init` in a fresh temp dir.**

Run:
```bash
TMPDIR=$(mktemp -d /tmp/apparat-final-test.XXXXXX)
cd "$TMPDIR"
node /Users/josu/Documents/projects/ralph-cli/dist/cli/index.js init
test -d .apparat && echo "init scaffolded .apparat/"
test -f CONTEXT.md && echo "CONTEXT.md at root"
grep -q '\.apparat/runs/' .gitignore && echo ".gitignore has new path"
cd /Users/josu/Documents/projects/ralph-cli
rm -rf "$TMPDIR"
```
Expected: three `ok`-style lines.

- [ ] **4.7.6: Smoke — `apparat pipeline list .` from this repo.**

Run: `node dist/cli/index.js pipeline list .`
Expected: lists `illumination-to-implementation` (the bundled pipeline at `.apparat/pipelines/illumination-to-implementation/pipeline.dot` post-rename).

- [ ] **4.7.7: Re-link the binary globally and verify.**

Run:
```bash
npm unlink -g ralph-cli 2>/dev/null || true
npm unlink -g apparat-cli 2>/dev/null || true
npm link
which apparat       # expected: ~/.npm-global/bin/apparat (or equivalent)
which ralph         # expected: nothing (or stale; remove with `rm $(which ralph)`)
apparat --help | head -3
```
Expected: `which apparat` resolves; `apparat --help` runs.

#### 4.8: Commit chunk 4

- [ ] **4.8.1: Commit.**

```bash
git add -A
git status   # confirm: program.ts help text + README + VISION + CONTEXT + AGENTS + docs/harness/* + ADR-0010 status flip + ADR-0007/0008 footers
git commit -m "$(cat <<'EOF'
docs: rewrite README/VISION/CONTEXT/AGENTS for apparatus rename

Flips help-text strings in src/cli/program.ts, every public doc
(README, VISION, CONTEXT, AGENTS, docs/harness/), and finalizes
ADR-0010 from draft to accepted. Adds one-line footer pointers
in ADR-0007 + ADR-0008 noting naming-only supersession; the
project-local-home + partition-principle substance stands.

Optional apparatchik metaphor paragraph lands in VISION.md
end of "What it is" section, or stays as a TODO placeholder.

Frozen prose untouched: ADRs 0001-0006, 0009; plans;
.apparat/sessions/; .apparat/runs/; MEMORY.md topic files.
EOF
)"
```

Expected: commit succeeds.

- [ ] **4.8.2: Final state report.**

Run:
```bash
git log --oneline -10
# expected: chunk 1, chunk 2, chunk 3, chunk 4 commits visible at HEAD
echo "---"
echo "Renamed surfaces:"
echo "  binary: $(node dist/cli/index.js --help | head -1)"
echo "  package: $(grep '"name"' package.json | head -1)"
echo "  folder: $(test -d .apparat && echo .apparat || echo MISSING)"
echo "  ADR-0010: $(head -3 docs/adr/0010-rename-to-apparatus.md | tail -1)"
```
Expected: 4 commit lines, name reads `apparat-cli`, folder lists, ADR-0010 status reads `Accepted`.

---

## Verification — overall

After all 4 chunks:

- `git log --oneline -10` shows 4 commits in order: consume-specs / rename-code / rename-folder / rewrite-docs.
- `npx tsc --noEmit` passes.
- `npx vitest run` passes (full suite, 14 smoke-folder tests included).
- `npm run build` passes.
- `node dist/cli/index.js init` in a fresh dir scaffolds `.apparat/` correctly.
- `node dist/cli/index.js pipeline list .` lists `illumination-to-implementation`.
- Repo-wide invariant grep (chunk 4 step 4.7.1) returns zero hits.
- Frozen-prose invariant (step 4.7.2) shows zero modifications outside the two ADR-0007/0008 footer additions.

## Rollback notes

- **Chunk 1** (consume specs + ADR stub) is independently revertible — the deleted specs are recoverable from git history; ADR-0010 stub deletion is one-line.
- **Chunk 2** (code-side renames) is revertible via `git revert`. `npm unlink && npm link` restores the previous binary symlink.
- **Chunk 3** (folder mv + literals) is the hardest revert because every file edit and the `git mv` are interleaved. `git revert` of the chunk-3 SHA is the cleanest path; manual recovery is not advised.
- **Chunk 4** (docs + ADR finalize) is revertible without test impact.

The PR is reviewed and merged as a unit — partial merges leave the repo non-functional.

If a critical bug surfaces post-merge: roll forward by adjusting ADR-0011+ rather than reverting ADR-0010. The ADR trail must remain append-only.
