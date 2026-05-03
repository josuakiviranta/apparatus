# Design: Janitor — Delete the Dead `scripts/` Folder

**Date:** 2026-05-03
**Status:** draft (pending review)
**Originating illumination:** `meditations/illuminations/2026-05-01T0255-janitor-dead-scripts.md`

## 1. Motivation

The repo's top-level `scripts/` folder holds two files, and neither one is reachable from any live code path:

- `scripts/backfill-plan-frontmatter.sh` — a one-shot migration script whose hardcoded target table no longer matches reality.
- `scripts/audit-tool-nodes.mjs` — a dev audit helper with zero callers, zero importers, and no `package.json#scripts` binding.

A reader walking the repo encounters `scripts/` and reasonably assumes its contents are part of the operational workflow. Today they are not. The folder reads as a junk drawer — the kind of "are these still used or already done?" question that erodes confidence in the rest of the tree. The backfill script is worse than dormant: its STATUS table targets files that were deleted weeks ago, so a developer who tried to run it would get an immediate `exit 1` with no obvious recovery path. That is actively misleading dead code.

Whole-repo verification confirms the dead-code claim. Grep for `audit-tool-nodes|backfill-plan-frontmatter` across the tree returns hits only in:

- the files themselves
- the originating illumination at `meditations/illuminations/2026-05-01T0255-janitor-dead-scripts.md`
- one historical memory note at `memory/2026-04-25-plans-have-no-lifecycle.md` (descriptive, not load-bearing)

Zero hits in `src/`, `dist/`, `pipelines/`, `package.json`, `tsup.config.ts`, or any other production surface. No dynamic import, no shell invocation from tooling, no bundler entry. The orphans are unreachable from any shipping code path.

The `package.json` confirms the scripts cannot be reached by either CLI users or contributors via npm scripts. The full `scripts` block at `package.json:9-14` reads:

```json
"scripts": {
  "build": "tsup",
  "dev": "tsx watch src/cli/index.ts",
  "test": "vitest run",
  "test:watch": "vitest"
}
```

— neither file is bound. The `files` array at `package.json:43-46` declares `["dist", "meditations"]`, so the `scripts/` folder is not shipped with the published `ralph-cli` npm package either. This is a pure local-tree janitor change.

This change deletes two unreferenced files and the now-empty folder. It does not introduce, modify, or relocate any behavior. Same dead-code lens already applied this week by the sibling `2026-05-01-janitor-dead-parse-structured-output-design.md` and `2026-05-01-janitor-dead-two-phase-fn-design.md` cleanups.

## 2. Decision Summary

1. **Delete `scripts/backfill-plan-frontmatter.sh`** in full via `git rm`. The file is a one-shot bash migration whose hardcoded `STATUS` associative array (`scripts/backfill-plan-frontmatter.sh:16-65`) lists 48 plan-file basenames dated 2026-04-03 through 2026-04-25. Today's `docs/superpowers/plans/` contains 10 files dated 2026-04-30 and 2026-05-01 — zero overlap. The guard at `scripts/backfill-plan-frontmatter.sh:70-72` (`if [[ ! -f "$path" ]]; then echo "MISS: $path not found — table out of sync with filesystem" >&2; exit 1; fi`) means the script exits non-zero on its first iteration today. The backfill it was written for has long since shipped.
2. **Delete `scripts/audit-tool-nodes.mjs`** in full via `git rm`. The file's own header at `scripts/audit-tool-nodes.mjs:1-4` declares it "Dev-only, not shipped." Whole-repo grep finds zero importers, zero `package.json#scripts` bindings, zero callers from any other file. The cwd-migration audit it was built for completed earlier in the project lifecycle (verified by `memory/2026-04-19-pipeline-validator-trust-upgrade.md`).
3. **Remove the `scripts/` folder** once both files are gone. The folder will be empty after step 2; an empty top-level directory is the same junk-drawer signal that motivated the cleanup.

Out of scope (locked by upstream verifier sizing — "pure subtraction, no surface added, no scope creep"):

- Anything under `src/`, `dist/`, `package.json`, `tsup.config.ts`, or `meditations/`.
- Editing `memory/2026-04-25-plans-have-no-lifecycle.md`. That note is the historical record of why the backfill script existed; it stays as-is.
- Any change to the `docs/superpowers/plans/` corpus that the backfill script targeted.
- Generalizing `audit-tool-nodes.mjs` into a reusable validator step. If that audit is ever needed again, the validator surface (`src/attractor/lib/validate-graph.ts` and friends) is the right home — not a one-off script.

## 3. Architecture

### 3.1 Current shape

```
scripts/
├── backfill-plan-frontmatter.sh    ← DEAD (122 lines, exits 1 on first iter today)
└── audit-tool-nodes.mjs            ← DEAD (39 lines, zero callers)
```

The folder sits at the repo root, peer to `src/`, `pipelines/`, `docs/`, `meditations/`, etc. Its presence implies operational relevance; today there is none.

### 3.2 Target shape

```
(scripts/ removed entirely)
```

Both files are deleted. The now-empty `scripts/` folder is removed. No new file, no rename, no surrounding edit. The repo root loses one entry.

### 3.3 Why both files delete cleanly

`backfill-plan-frontmatter.sh` is a self-contained bash script. It declares no exports, has no other importer (bash has no import system), is not invoked by any other shell script, and is not bound in `package.json#scripts`. The only file that names it is the originating illumination.

`audit-tool-nodes.mjs` is a self-contained Node ESM script. Verbatim from `scripts/audit-tool-nodes.mjs:1-4`:

```
#!/usr/bin/env node
// scripts/audit-tool-nodes.mjs
// Walk pipelines/**/*.dot, list tool nodes + their tool_command or script_file.
// Suggests cwd value based on prefix patterns. Dev-only, not shipped.
```

The header self-identifies as dev-only. Grep across the repo finds it referenced only by the file itself, the illumination, and one descriptive memory note.

The two deletions are independent — no shared state, no shared import, no shared invocation site. They are bundled into one commit purely for atomicity (the empty-folder cleanup is the third step that requires both prior deletions).

## 4. Components & file edits

| File | Change |
|---|---|
| `scripts/backfill-plan-frontmatter.sh` | `git rm` — delete in full. |
| `scripts/audit-tool-nodes.mjs` | `git rm` — delete in full. |
| `scripts/` (directory) | Remove the now-empty folder. |

After the change, `git ls-files scripts/` returns empty and `ls scripts/` errors with "No such file or directory."

## 5. Data flow

No runtime data flow is affected. Neither script was ever invoked by any production code path, npm script, CI step, or pipeline node. A user running `ralph implement`, `ralph meditate`, `ralph pipeline …`, `ralph heartbeat`, or `ralph new` observes byte-identical behavior before and after the deletion. The published npm package (governed by `package.json:43-46`'s `"files": ["dist", "meditations"]`) was already not shipping these files, so npm consumers see no change either.

## 6. Blast radius / impact surface

Sourced from the verifier's blast-radius paragraph and the explainer's `## Blast radius` block.

- **Size:** S
- **Files touched:** 2 files removed (`scripts/backfill-plan-frontmatter.sh`, `scripts/audit-tool-nodes.mjs`) plus removal of the now-empty `scripts/` directory.
- **Surfaces crossed:** none.
  - **CLI:** unaffected — neither file is reachable from `dist/cli/index.js` or any pipeline.
  - **Pipeline engine:** unaffected — `audit-tool-nodes.mjs` walked `.dot` files but is itself never walked or invoked by the engine.
  - **Agents:** unaffected — neither file is referenced from any agent rubric or pipeline node.
  - **Docs:** unaffected — no doc references either script as live workflow.
  - **Tests:** unaffected — no test imports or executes either file.
  - **Build:** unaffected — `tsup.config.ts` does not list `scripts/` as an entry.
  - **npm package:** unaffected — `package.json:43-46` ships only `dist` and `meditations`.
- **Breaking change:** no. No public API, CLI flag, pipeline contract, or exported function changes. No contract was named or depended-upon to break.
- **Spec / docs ripple checklist:**
  - [ ] No ADR update required — no architectural decision is changed; this is dead-code removal.
  - [ ] No README update required — `scripts/` is not advertised in `README.md`.
  - [ ] No CONTEXT.md update required — `scripts/` is not part of the documented domain language.
  - [ ] `memory/2026-04-25-plans-have-no-lifecycle.md` left untouched intentionally — the historical mention of the backfill script is descriptive (recording why it existed), not load-bearing.
- **Test ripple checklist:**
  - [ ] No test files reference either script (verified via grep). No test additions, deletions, or edits required.

If a future reviewer questions any of these "no impact" claims, the verification commands in §9 confirm them statically.

## 7. Trade-offs

### 7.1 Risk: a future contributor wants to re-run the plan-frontmatter backfill against a new corpus

Cannot import `scripts/backfill-plan-frontmatter.sh` because it no longer exists.

**Accepted because:** the script is a hardcoded one-shot, not a reusable migration framework. Its STATUS table is a 48-entry hand-curated map keyed by exact filenames from a specific point in project history. To reuse it against a new corpus, a contributor would have to rewrite the entire STATUS table anyway — at which point starting from the current `docs/superpowers/plans/` index is faster than resurrecting and editing the dead script. Git history preserves the file if anyone wants the prior shape as a reference (`git log -- scripts/backfill-plan-frontmatter.sh`).

### 7.2 Risk: a future contributor wants to re-audit pipeline `cwd` settings

Cannot import `scripts/audit-tool-nodes.mjs` because it no longer exists.

**Accepted because:** the right home for a recurring `cwd` audit is the validator surface (`src/attractor/lib/validate-graph.ts`), not a one-off script. The original audit existed to drive a one-time migration that has since shipped; standing audits should run as part of `ralph pipeline validate`, not as orphaned dev tooling. If the need recurs, building a validator rule is a small, well-bounded job — and one that the existing `chunk-3 gates as .md` precedent shows how to do cleanly. Git history again preserves the prior shape (`git log -- scripts/audit-tool-nodes.mjs`).

### 7.3 Risk: removing a top-level folder slightly reorganizes the repo root

A reader who has memorized the repo layout sees one fewer entry under `ls`.

**Accepted because:** this is the entire point. The folder reads as live-but-isn't; deleting it is the smallest possible fix to the misleading signal.

## 8. Constraints

- All three steps (two file deletions + folder removal) must land together in a single commit. Splitting them produces an intermediate state where the empty `scripts/` folder still exists and continues to read as a junk drawer.
- `npx tsc --noEmit` must pass after the change. Neither script is in any `tsconfig.json` `include` glob, so the type checker never saw them — but the check confirms no surprise reference exists.
- `npm run build` must succeed. `tsup.config.ts` does not list `scripts/` as a bundle entry (verified via repo audit), so removing it cannot break the build configuration.
- `npx vitest run` must pass. No test imports either file.
- The git repo retains full history of the deleted files. `git log --all -- scripts/` continues to surface them after the deletion commit, satisfying the "preserve history" use case noted in §7.

## 9. Open questions

None. The verifier's three rubric criteria pass; the upstream sizing is unambiguously S; the scope is locked at "two files plus the empty folder, nothing else." The reviewer loop may surface nits, but no design-level question is open at draft time.

## 10. Verification approach

### 10.1 Static checks

Run after the deletion, in order:

- `git ls-files scripts/` — expected: empty output. Confirms both files are tracked-as-deleted.
- `[ ! -d scripts ] && echo OK` — expected: `OK`. Confirms the empty folder is removed from the working tree.
- `npx tsc --noEmit` — expected: clean. Any reference to the deleted files would surface here (none should exist).
- Repo-wide grep for `audit-tool-nodes|backfill-plan-frontmatter` excluding `meditations/illuminations/`, `memory/`, and `docs/superpowers/specs/` — expected: zero hits in `src/`, `pipelines/`, `package.json`, `tsup.config.ts`, `dist/`. Hits in the illumination, the historical memory note, and this design doc are intentional historical record and are ignored.

### 10.2 Tests

- `npx vitest run` — full suite passes. No test imports from either deleted script; the count of executed test cases is unchanged.

### 10.3 Build & smoke

- `npm run build` — `tsup` produces a `dist/` with the same set of `bin` entries (`ralph` → `dist/cli/index.js`) and no error.
- `node dist/cli/index.js --help` — top-level help output is byte-identical. No command surface changes; this is purely a sanity check that the build still loads.
- `npm pack --dry-run` (optional) — the published tarball file list is unchanged. `package.json:43-46`'s `"files": ["dist", "meditations"]` was already excluding `scripts/`, so the published artifact is identical before and after.

## 11. Summary

Two files go: `scripts/backfill-plan-frontmatter.sh` (122 lines of bash, one-shot migration whose target table no longer matches the filesystem) and `scripts/audit-tool-nodes.mjs` (39 lines of Node ESM, dev-only audit with zero callers). The now-empty `scripts/` folder is removed too. Roughly 160 lines of dead code leave the tree, plus one misleading top-level directory entry. The bundled `ralph` CLI behaves identically before and after — no command, no pipeline, no agent, no test ever touched the deleted code paths; the published npm tarball was already excluding `scripts/` via `package.json:43-46`. The win is structural: a future reader walking the repo root no longer encounters a junk-drawer folder whose contents look operational but aren't, and the project's existing dead-code-removal lens (sibling `2026-05-01-janitor-dead-parse-structured-output-design.md` and `2026-05-01-janitor-dead-two-phase-fn-design.md`) extends cleanly to a third instance with no surface added.
