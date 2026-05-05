# Design: Rename `ralph` → `apparatus` (binary `apparat`, folder `.apparat/`)

**Date:** 2026-05-05
**Status:** draft (pending review)
**Originating session:** grill-with-docs interview, 2026-05-05.

## 1. Motivation

The current name `ralph` is a placeholder that has outlived its utility. The new name `apparatus` describes the project's actual shape: a machine in which `apparatchik` agents do one job each toward a larger goal (per the spider/web mental model already in `MEMORY.md`). The rename is taste + better-fitting metaphor; there is no public collision driving urgency, no compatibility cohort to migrate, and no architectural change.

The cost is mechanical and large: roughly 292 files contain the substring `ralph` across `src/`, tests, docs, bundled pipelines, build config, and self-hosted `.ralph/`. Every reference must move atomically — a half-renamed repo is a non-functional repo. Migration treats this as a single-shot rewrite with no compatibility shims and no transition release window.

## 2. Decision Summary

1. **Brand / GitHub repo / npm description / README copy = `apparatus`.** This is the noun that anchors the metaphor (apparatchik agents work for the apparatus). It appears in prose, the GitHub repo name, README headings, package.json description.

2. **Binary = `apparat`.** Six characters, typed daily. Established convention (`kubernetes/kubectl`, `terraform/tf`) of brand-vs-binary split where the binary is a recognizable shorthand. `package.json:bin` becomes `{ "apparat": "./dist/cli/index.js" }`. `program.name("ralph")` at `src/cli/program.ts:19` becomes `program.name("apparat")`.

3. **Project-local folder = `.apparat/`.** Matches the binary, not the brand. Follows ecosystem convention — `.git/` matches `git`, `.cargo/` matches `cargo`, none spell the brand long-form. Saves two characters in every path string in the codebase. The "apparat-shaped project" idiom replaces "ralph-shaped project" in `CONTEXT.md` §Project-local layout, `VISION.md`, and the new ADR.

4. **Env vars + build constant = `APPARAT_*`.** By symmetry with the binary: `RALPH_PROD__` → `APPARAT_PROD__`, `RALPH_RUNS_KEEP` → `APPARAT_RUNS_KEEP`, `RALPH_RUNS_ROOT` → `APPARAT_RUNS_ROOT`, `RALPH_TEST_CMD` → `APPARAT_TEST_CMD`, `RALPH_ENGINE_TEST_ALLOW_SPAWN` → `APPARAT_ENGINE_TEST_ALLOW_SPAWN`, `RALPH_MEDITATE_MAX_OPEN` → `APPARAT_MEDITATE_MAX_OPEN`. Six total. The TypeScript ambient declaration at `src/types/globals.d.ts:1` and the tsup `define` at `tsup.config.ts:14` move together.

5. **`ralph-paths.ts` → `apparat-paths.ts`.** The module name and every exported helper that is not project-local — `ralphDir()` becomes `apparatDir()`. The seven other helpers (`meditationsDir`, `illuminationsDir`, `stimuliDir`, `sessionsDir`, `pipelinesDir`, `runsDir`, `runDir`) keep their names; only their bodies (which call `ralphDir`) update to call `apparatDir`.

6. **Big-bang migration. No compatibility layer.** Per `VISION.md` ("personal harness for one developer, one machine — not multi-tenant"), there is no cohort to support across versions. The release that ships the rename refuses to read `.ralph/`. Each project on the developer's machine that uses the tool runs `git mv .ralph .apparat && git commit` once, manually, after upgrading.

7. **Code stays "agent". `apparatchik` does not enter code, schema, or runtime vocabulary.** Per the grill-decision Q2 → (a): naming-only rename. Pipeline `.dot` `type=` values, frontmatter field names, agent-loader function names, error messages, and CONTEXT.md §Agent loading all keep "agent". `apparatchik` lives only in README/VISION prose as the metaphor it is.

8. **Pre-rename: consume all 17 design specs in `docs/superpowers/specs/`.** They are post-implementation artefacts of completed work; per ADR-0004 (source-as-truth), they are eligible for deletion. Removing them before the rename eliminates 17 files of `ralph`-referencing prose and shortens the rename diff. The new spec for this rename lands in the same directory after the consume commit.

9. **Plans, sessions, runs, illuminations history left untouched.** `docs/superpowers/plans/*.md`, `.apparat/sessions/*.md` (post-rename location), `.apparat/runs/*/`, and `MEMORY.md` topic files are frozen prose. They describe what was true at the time. References to "ralph" inside them are historical record, not broken pointers.

10. **Live working documents get a path-only sed pass.** Currently-alive illuminations under `.ralph/meditations/illuminations/*.md` and smoke-pipeline scenarios under `.ralph/scenarios/*` mention `.ralph/` in their bodies as path strings the implementer needs to follow post-rename. A targeted `sed 's|\.ralph/|.apparat/|g'` runs against those two trees only — body prose otherwise untouched.

11. **New ADR-0010. ADRs 0001–0009 left untouched.** The MADR convention forbids editing accepted ADRs. ADR-0010 (`docs/adr/0010-rename-to-apparatus.md`) supersedes the *naming* of ADRs 0007 (`.ralph/`-as-project-local-home) and 0008 (partial revert), not their substance — the partition principle and project-local layout still hold; only the folder name changes. ADR-0007/0008 keep their titles ("ralph-folder-...") and bodies; readers follow the supersession link to ADR-0010 for the new naming.

12. **npm package name deferred.** The user has not yet committed to `apparat-cli`, `@scope/apparat`, or another. The rename PR ships under the working assumption that `package.json:name` becomes `apparat-cli` (mirrors current `ralph-cli` shape) but the field is trivially editable post-rename without further code changes.

## 3. Architecture

### 3.1 Rename map

| Surface | Before | After |
|---|---|---|
| Brand / repo / GitHub | `ralph-cli` | `apparatus` |
| Binary (`package.json:bin` key) | `ralph` | `apparat` |
| npm package name (`package.json:name`) | `ralph-cli` | `apparat-cli` (provisional) |
| Commander `program.name(...)` | `"ralph"` | `"apparat"` |
| Project-local folder | `<project>/.ralph/` | `<project>/.apparat/` |
| Build constant | `__RALPH_PROD__` | `__APPARAT_PROD__` |
| Env vars (6) | `RALPH_*` | `APPARAT_*` |
| Path-helper module | `src/cli/lib/ralph-paths.ts` | `src/cli/lib/apparat-paths.ts` |
| Path-helper function | `ralphDir(...)` | `apparatDir(...)` |
| Domain idiom (CONTEXT.md / VISION.md) | "ralph-shaped project" | "apparat-shaped project" |
| TypeScript ambient (`src/types/globals.d.ts`) | `declare const __RALPH_PROD__: ...` | `declare const __APPARAT_PROD__: ...` |
| tsup `define` (`tsup.config.ts:14`) | `__RALPH_PROD__: "true"` | `__APPARAT_PROD__: "true"` |
| Help-text strings (`src/cli/program.ts`) | `ralph init`, `ralph implement my-app`, etc. | `apparat init`, `apparat implement my-app`, etc. |
| Error message in `assets.ts:30` | `... ship under pipelines/ at the ralph-cli repo root.` | `... ship under pipelines/ at the apparatus repo root.` |

### 3.2 Surfaces unchanged

- Pipeline `.dot` syntax — `type=`, `cwd=`, `script_file=`, edge `condition=`, `loop:`, `outputs:`, `inputs:` — all unchanged.
- Agent frontmatter shape: `name`, `description`, `model`, `outputs`, `inputs`, `loop`. Unchanged.
- MCP server name (`illumination-server`), MCP tools (`list_illuminations`, `write_illumination`, `consume`). Unchanged.
- The seven non-`ralphDir` exports of `apparat-paths.ts` keep their names.
- `pipeline.jsonl` schema. Unchanged.
- Runtime CLI command surface beyond the `ralph`/`apparat` token: `init`, `implement`, `meditate`, `pipeline {list,validate,run,show,trace}`, `heartbeat ...`. Unchanged.

### 3.3 Files-touched buckets

| Bucket | Files | Treatment |
|---|---|---|
| Code (`src/**/*.ts`) | every TS file containing `ralph`, `Ralph`, or `RALPH_` | Inline edit + rename `ralph-paths.ts` module |
| Tests (`src/**/tests/**/*.ts`) | every test file with hardcoded `.ralph/` paths or `RALPH_*` env-var assertions | Inline edit |
| Bundled pipelines (`src/cli/pipelines/**`) | `.md`, `.dot`, `.mjs` files referencing `.ralph/`, `RALPH_*`, or "ralph" idioms | Inline edit |
| Build config | `package.json`, `tsup.config.ts`, `src/types/globals.d.ts` | Inline edit |
| Public docs | `README.md`, `VISION.md`, `CONTEXT.md`, `AGENTS.md`, `docs/harness/README.md`, `docs/harness/tmux-drive.md` | Inline edit |
| New ADR | `docs/adr/0010-rename-to-apparatus.md` | Create |
| Pre-rename consume | `docs/superpowers/specs/*-design.md` (17 files) | Delete via `git rm` |
| Live working documents | `.ralph/meditations/illuminations/*.md` (alive only), `.ralph/scenarios/**` | `sed`-replace `.ralph/` → `.apparat/` in path refs only |
| Repo-self folder | `.ralph/` (entire tree) | `git mv .ralph .apparat` |
| Frozen prose (do NOT edit) | `docs/superpowers/plans/*.md`, `.apparat/sessions/*.md` (post-mv), `.apparat/runs/**` (post-mv), `.apparat/meditations/illuminations/*.md` for already-consumed illuminations (none alive at rename time become frozen later), `MEMORY.md` topic files | Skip |
| ADRs 0001–0009 | `docs/adr/0001-...md` … `docs/adr/0009-...md` | Skip — append-only convention |
| Generated `dist/` | n/a | Rebuilt by tsup; not source-controlled-edited |

### 3.4 Pre-rename cleanup commit

Before the rename diff, a single `chore: consume implemented design specs` commit removes all 17 files in `docs/superpowers/specs/`. This is independent of the rename — it would be valid even if the rename were abandoned — but combining the two introduces 17 deletions of large files into the rename diff, which obscures review.

The rename PR's first commit (post-spec-consume) writes this very design spec into the freshly-emptied directory.

### 3.5 Big-bang commit shape

The rename itself is a single commit (or a small handful of logical commits inside one PR — see the plan's chunking). It must leave the repo in a passing state: `npm run build`, `npx tsc --noEmit`, `npx vitest run`, and the smoke-pipeline suite all green. There is no half-renamed checkpoint anyone reviews.

## 4. Components & file edits

| File | Change |
|---|---|
| `package.json` | `name`: `ralph-cli` → `apparat-cli`; `bin`: `{ "ralph": ... }` → `{ "apparat": ... }`; `description` mentions `apparatus`. |
| `tsup.config.ts:14` | `define: { __RALPH_PROD__: "true" }` → `define: { __APPARAT_PROD__: "true" }`. |
| `src/types/globals.d.ts:1` | `declare const __RALPH_PROD__: true \| undefined;` → `declare const __APPARAT_PROD__: true \| undefined;`. |
| `src/cli/lib/ralph-paths.ts` | **Rename to `src/cli/lib/apparat-paths.ts`** via `git mv`. Body: `ralphDir()` → `apparatDir()`; `.ralph` literal → `.apparat`; downstream helpers keep names but call the renamed function. |
| `src/cli/lib/assets.ts` | Replace 3 `__RALPH_PROD__` references at lines 8, 9, 12 with `__APPARAT_PROD__`. Update error string at line 30 (`ralph-cli repo root` → `apparatus repo root`). The hardcoded `.ralph/meditations/stimuli` path inside `getMetaMeditationsDir()` at line 42 becomes `.apparat/meditations/stimuli`. |
| `src/cli/program.ts` | `program.name("ralph")` at line 19 → `program.name("apparat")`. ~30 help-text lines containing `ralph init`, `ralph implement`, `ralph heartbeat`, `ralph meditate`, `ralph pipeline ...`, `.ralph/runs/<runId>/checkpoint.json`, `.ralph/pipelines/...`, `.ralph/meditations/illuminations/`, `Scaffold .ralph/ tree...` — every binary-name and folder-name reference flips. |
| `src/cli/commands/init.ts` | Help text + scaffolded directory targets all flip from `.ralph/...` to `.apparat/...`. The init scaffolder's `.gitignore`-append line that adds `.ralph/runs/` becomes `.apparat/runs/`. The import of `ralphDir`, `pipelinesDir`, etc. updates to `apparatDir` and the new module path `../lib/apparat-paths.js`. |
| `src/cli/commands/heartbeat.ts` | Any reference to `.ralph/` or `ralph` literal flips. (Found by grep in §6.) |
| `src/cli/commands/pipeline.ts` | `RALPH_RUNS_KEEP` env-var read at line 288 → `APPARAT_RUNS_KEEP`. Any `.ralph/` literal in error messages / log strings flips. |
| `src/cli/commands/meditate.ts`, `src/cli/commands/implement.ts` (if present) | Same pattern: env vars, path literals, help text. |
| `src/cli/mcp/illumination-server.ts` | Path literals to `.ralph/meditations/illuminations/` flip; any `ralph` in tool descriptions flips. |
| `src/daemon/runner.ts` | `RALPH_TEST_CMD` (lines 13, 18) → `APPARAT_TEST_CMD`; `RALPH_PROD__` → `APPARAT_PROD__`. |
| `src/lib/daemon-client.ts:16` | `RALPH_PROD__` → `APPARAT_PROD__`. |
| `src/attractor/handlers/agent-prep.ts:63` | `RALPH_PROD__` → `APPARAT_PROD__`. |
| `src/attractor/tests/engine-onNodeEnd.test.ts:21` | `RALPH_ENGINE_TEST_ALLOW_SPAWN` → `APPARAT_ENGINE_TEST_ALLOW_SPAWN`. |
| `src/attractor/tests/agent-handler.test.ts:260` | `RALPH_PROD__` → `APPARAT_PROD__`. |
| `src/cli/tests/smoke.test.ts` | `RALPH_PROD__` (lines 24, 30, 31, 32) → `APPARAT_PROD__`. |
| `src/daemon/tests/runner.test.ts` | All `RALPH_TEST_CMD` references (lines 37, 46, 58, 72, 85, 108) → `APPARAT_TEST_CMD`. |
| All `src/**/*.test.ts` with `.ralph/` path literals | Inline replace. ~14 smoke-pipeline-folder tests (`pipeline-smoke-*-folder.test.ts`), `init.test.ts`, `pipeline.test.ts`, `pipeline-show.test.ts`, `ralph-paths.test.ts` (and rename to `apparat-paths.test.ts`). |
| `src/cli/pipelines/**/*.{md,dot,mjs}` | Bundled-pipeline files referencing `.ralph/` flip to `.apparat/`. (Discovered file-by-file in chunk 3.) |
| `README.md` | Every `ralph init`, `ralph implement`, `ralph pipeline ...`, `ralph meditate`, `ralph heartbeat ...`, `.ralph/` flips. New install instruction reflects `apparat-cli` package + `apparat` binary. The existing apparatchik metaphor paragraph (if added per Q3 commitment) lands in the introduction. |
| `VISION.md` | "ralph-cli", "ralph", ".ralph/", "ralph-shaped project" all flip. The "spider/web" passage extends to mention apparatchik as the metaphor anchor. |
| `CONTEXT.md` | Every `.ralph/` flips to `.apparat/`. "ralph-shaped project" → "apparat-shaped project". The §Agent loading note about "stray `~/.ralph/agents/` files" flips to `~/.apparat/agents/`. References to ADR-0007 / ADR-0008 add a parenthetical pointer to ADR-0010. |
| `AGENTS.md` | Body references to `.ralph/` flip; line 20's `RALPH_PROD__` → `APPARAT_PROD__`. |
| `docs/harness/README.md`, `docs/harness/tmux-drive.md` | `.ralph/` and `ralph` flip; harness-binary references update. |
| `.ralph/` (entire tree) | `git mv .ralph .apparat`. Live illuminations + scenarios additionally get `sed 's\|\.ralph/\|.apparat/\|g'` after the move; sessions, runs, archived illuminations skipped. |
| `docs/adr/0010-rename-to-apparatus.md` | **New.** MADR-style. Status accepted. Supersession reference to ADR-0007/0008 for naming only. |
| `docs/superpowers/specs/*-design.md` (17 files) | **Deleted in pre-rename commit.** |
| `docs/superpowers/specs/2026-05-05-rename-to-apparatus-design.md` | **This file.** Lands in the same commit as the deletions, or the immediately following commit. |

## 5. Data flow

The pipeline run path is byte-identical before and after for any `.dot` graph that is currently valid. Inputs (parsed `Graph`) and outputs (`PipelineResult.context`, `pipeline.jsonl` per-node records) keep their existing shapes. The only operational change is path resolution: every helper that previously resolved to `<project>/.ralph/...` now resolves to `<project>/.apparat/...`. Live pipelines reading or writing under that root see paths flip atomically with the rename.

`apparat init` in a fresh directory scaffolds `.apparat/{pipelines,meditations/{illuminations,stimuli},sessions,runs}` and root `docs/adr/`, with the `.gitignore`-append rule writing `.apparat/runs/` instead of `.ralph/runs/`. The CONTEXT/VISION/README scaffolding under root behaves identically (root layout unchanged).

`apparat init` against an existing project that has a legacy `.ralph/` directory does **not** auto-migrate. The directory is treated as an unknown, untracked side-effect of an unrelated tool. The user runs `git mv .ralph .apparat && git commit` themselves; the binary will then find its expected `.apparat/` and behave normally on the next invocation.

## 6. Blast radius / impact surface

- **Size:** L by file count, S by semantic risk.
- **Files touched:** ~292 files (all that contain `ralph`, `Ralph`, or `RALPH_`). ~172 of those are in `src/`. ~14 smoke-pipeline tests. ~17 spec deletions. 1 ADR creation. Both `git mv` operations (folder rename, ralph-paths module rename) recorded as renames, not delete/add.
- **Surfaces crossed:**
  - **CLI:** binary name + every help-text mention. Visible to anyone typing `--help` or running a subcommand.
  - **MCP / `illumination-server`:** path literals only; tool names unchanged.
  - **Pipeline engine:** path literals in error messages and bundled pipelines; `.dot` syntax and validator rules unchanged.
  - **Agents:** prompt-string references to `.ralph/` flip in bundled pipelines.
  - **`.dot` syntax:** unchanged.
  - **Frontmatter shapes:** unchanged.
  - **Public exports:** module path `lib/ralph-paths.js` → `lib/apparat-paths.js`. `ralphDir` export → `apparatDir` export. Other helper names stable.
  - **Env-var contracts:** all six `RALPH_*` env vars rename. Any external script the developer has set up to invoke `RALPH_RUNS_KEEP=N apparat ...` must be edited.
- **Breaking change:** **yes.** Any consumer of the npm package, the `ralph` binary name, the `RALPH_*` env vars, the `.ralph/` folder, or the `ralphDir`/`__RALPH_PROD__` symbols stops working. The breaking-change cohort is one user (the developer), per `VISION.md`.
- **Spec / docs ripple checklist:**
  - [ ] CONTEXT.md inline rewrite (folder name, idiom, env vars, ADR pointers).
  - [ ] VISION.md narrative rewrite (binary name, folder, optional apparatchik addition).
  - [ ] README.md inline rewrite (every command snippet, install line, folder reference).
  - [ ] AGENTS.md inline edit.
  - [ ] `docs/harness/*.md` inline edit.
  - [ ] ADR-0010 written.
  - [ ] ADRs 0001–0009 untouched.
  - [ ] Plans untouched.
- **Test ripple checklist:**
  - [ ] All 14 `pipeline-smoke-*-folder.test.ts` files updated for `.ralph/` path constants.
  - [ ] `init.test.ts` updated (scaffolded paths).
  - [ ] `pipeline.test.ts`, `pipeline-show.test.ts` updated (path constants).
  - [ ] `ralph-paths.test.ts` renamed to `apparat-paths.test.ts`; tests assert `.apparat/...`.
  - [ ] `engine-onNodeEnd.test.ts`, `agent-handler.test.ts`, `smoke.test.ts`, `runner.test.ts` env-var assertions updated.
  - [ ] No new tests required — rename is mechanical; existing coverage is sufficient.

## 7. Trade-offs

### 7.1 Brand/binary split (apparatus + apparat) vs unified

A single name (`apparat` everywhere, including brand) saves the cognitive cost of "two names to remember". Reasons to keep the split:

- The metaphor anchor (apparatchik = worker of *apparatus*) collapses if the brand is `apparat`. The user committed in the grill (Q3) that "apparatus" appears in README + GitHub repo + as a future flavor paragraph; the noun is load-bearing for the metaphor. Without the brand noun, the grill's motivation reduces to "rename for taste only", which holds but loses the conceptual scaffolding.
- The `kubernetes/kubectl` and `terraform/tf` precedents show this pattern is industry-recognized.
- Daily typing favors the short binary; doc prose favors the long noun. Optimizing each for its frequency is cheaper than forcing one form into both contexts.

### 7.2 Folder `.apparat/` (binary-matching) vs `.apparatus/` (brand-matching)

The user picked binary-matching (Q4 → a). Reasons captured:

- Convention: `.git/`, `.cargo/`, `.npm/`, `.docker/` all match the binary, none spell the brand long-form.
- Path-string brevity. `.apparat/` is two characters shorter, multiplied across ~1287 references in the codebase + every future path constant.
- The folder is operational (the binary's footprint), not promotional. Brand reinforcement happens in README and GitHub UI — places humans read prose.

### 7.3 Big-bang vs transition release with auto-migration

A transition release would detect `.ralph/` on first invocation and either auto-rename or read both for one version window. Reasons to skip:

- `VISION.md` explicitly scopes the project to one developer, one machine. No external cohort needs cross-version compatibility.
- Compat code lives in the binary forever once added. The "delete after one release" promise reliably becomes "still in the binary three years later."
- `git mv .ralph .apparat` is a single shell command per project. The developer has fewer than ten projects using the tool.

### 7.4 New ADR-0010 vs editing ADRs 0007/0008 in place

Inline editing 0007/0008 to replace `.ralph/` with `.apparat/` would make grep simpler and remove a level of indirection. Reasons to write a fresh ADR:

- MADR convention is append-only. Editing accepted ADRs erodes the trust that a reader can understand a past decision in its original context.
- The supersession is partial: 0007's project-local layout principle and 0008's two-clause partition rule both still hold. Only the folder name changes. A new ADR can frame this as "naming-only refinement", whereas an in-place edit risks implying the principles changed.
- Future-you reading `MEMORY.md` topic files (which still say "ralph") sees an ADR trail that explains the transition, not a present-tense doc that pretends the past name never existed.

### 7.5 Consume vs preserve `docs/superpowers/specs/`

The 17 design specs are post-implementation artefacts of completed work. Reasons to consume:

- ADR-0004 (source-as-truth) excised `docs/specs/` for drift; the same logic applies once a design is implemented.
- Each spec contains "ralph" references that would otherwise be edited or skipped. Deleting them eliminates 17 files of decision noise from the rename diff.
- Plans for the same work are preserved (per user decision Q7) because plans encode *what was done* — useful as historical-execution record. Specs encode *what was contemplated* — replaceable by reading the implementation.

### 7.6 Live-document path-only sed vs body-rewrite vs leave-alone

Alive illuminations and `.apparat/scenarios/` (post-rename) still mention `.ralph/` in their bodies. Reasons to do path-only sed (Q8 → c):

- Path-only sed flips operational pointers without rewriting operator-authored prose. The illumination's analytical content is whatever the operator wrote; the path string is mechanical.
- Body-rewrite changes the *description* of the work, which is authored intent. Risky.
- Leave-alone breaks the implementer agent: it follows a `.ralph/` path that no longer exists post-rename.

### 7.7 npm package name deferred vs decided now

The user explicitly deferred the npm name (Q6). This is acceptable because:

- The `package.json:name` field is one line. Editing it is ten seconds.
- No source code outside `package.json` references the package name (binary name, exports, ambient declarations, env vars are all separate concerns).
- The rename PR's working assumption (`apparat-cli`) mirrors current `ralph-cli` shape and is reversible.

The deferred decision is captured as "open question" in §9.

## 8. Constraints

- All edits land within a single PR. Inside the PR, commits chunk by concern (consume specs, rename code, rename folder, rewrite docs, write ADR). The PR must merge as a unit; partial merge breaks the repo.
- After the rename PR merges:
  - `npx tsc --noEmit` must pass.
  - `npx vitest run` must pass — all unit + integration tests, including the 14 smoke-pipeline-folder tests.
  - `npm run build` must pass (tsup completes; `dist/cli/index.js` runs).
  - The new `apparat` binary, when invoked from a temp directory, runs `apparat init` successfully and scaffolds `.apparat/`.
  - `apparat pipeline list .` from the rename PR's repo root surfaces `illumination-to-implementation` (the bundled pipeline that lives at `.apparat/pipelines/...` post-mv).
- Repo-wide grep invariants post-merge (excluding frozen prose):
  - Zero hits for `\bralph\b`, `\bRalph\b`, `\bRALPH_`, `__RALPH_PROD__`, `\.ralph/` outside of ADRs 0001–0009, `docs/superpowers/plans/*.md`, `.apparat/sessions/*.md`, `.apparat/runs/**`, archived illuminations, and `MEMORY.md` topic files.
  - Frozen prose remains untouched — verified by `git status` showing zero modifications under those paths.
- The `.gitignore` template that `apparat init` appends gains `.apparat/runs/` and loses `.ralph/runs/`. Repo-self `.gitignore` updates atomically.
- New ADR-0010 file exists at `docs/adr/0010-rename-to-apparatus.md` with status accepted, dated 2026-05-05.
- Spec consume commit (pre-rename) is independently revertible. The rename commits land on top.

## 9. Open questions

- **npm package name.** Deferred per Q6 of the grill. The rename PR ships with a provisional `apparat-cli`; the user can choose `apparat-cli`, `apparatus-cli`, `@scope/apparat`, or another after the rename merges. Changing the name later is a one-line edit to `package.json:name` plus a re-publish; no code references it.
- **README apparatchik paragraph.** The user committed (Q3) that "apparatchik" lands in README as flavor text "later". Whether that paragraph ships in the rename PR or in a follow-up is operator's choice. The rename PR includes a `<!-- TODO: apparatchik flavor -->` placeholder so the slot is reserved.
- **Repo rename on GitHub.** The user committed (Q3) that the GitHub repo name flips to `apparatus`. This happens outside the rename PR — it's a GitHub-side rename via the repo settings UI, plus updating any CI / external tooling that references the old URL. Not part of the in-repo PR.
- **`~/.apparat/agents/` reference in CONTEXT.md.** The §Agent loading note about stray inert `~/.ralph/agents/` files flips to `~/.apparat/agents/`. This is correct prose under the new convention but the directory itself probably doesn't exist on the developer's machine. The note remains as warning-only ("if such a directory exists, it is inert").

## 10. Verification approach

### 10.1 Static checks

Run after the rename PR's final commit, in order:

- `npx tsc --noEmit` — clean. The rename of `__RALPH_PROD__` → `__APPARAT_PROD__` in `src/types/globals.d.ts` forces every consumer to update; TypeScript guides the edit. The rename of `ralphDir` → `apparatDir` similarly cascades.
- Repo-wide grep `\bralph\b\|\bRalph\b\|\bRALPH_\|__RALPH_PROD__\|\.ralph/` against `src/`, `package.json`, `tsup.config.ts`, `README.md`, `VISION.md`, `CONTEXT.md`, `AGENTS.md`, `docs/harness/`, `docs/adr/0010*`, `.apparat/pipelines/`, `.apparat/scenarios/`, alive illuminations under `.apparat/meditations/illuminations/` — expected: zero hits.
- Repo-wide grep against the explicitly-frozen surfaces (`docs/adr/000{1..9}*.md`, `docs/superpowers/plans/`, `.apparat/sessions/`, `.apparat/runs/`, `MEMORY.md` topic files) — `ralph` references *expected* (historical record).
- Positive-existence grep for `apparatDir`, `__APPARAT_PROD__`, `APPARAT_RUNS_KEEP`, `APPARAT_TEST_CMD`, `APPARAT_PROD__` — at least one hit each, confirming the rename landed.

### 10.2 Tests

- `npx vitest run src/cli/tests/apparat-paths.test.ts` (renamed) — passes with new `.apparat/` assertions.
- `npx vitest run src/cli/tests/init.test.ts` — passes; scaffolded paths match the new layout.
- `npx vitest run src/cli/tests/pipeline-smoke-*-folder.test.ts` — all 14 pass with `.apparat/scenarios/` path constants.
- `npx vitest run src/daemon/tests/runner.test.ts` — passes with `APPARAT_TEST_CMD` env var.
- `npx vitest run` — entire suite passes.

### 10.3 Smoke

- `npm run build` — completes; `dist/cli/index.js` is bundled with `__APPARAT_PROD__` defined.
- `node dist/cli/index.js --help` — top help text shows `apparat`, no `ralph` substrings (sanity-grep the captured output).
- `node dist/cli/index.js init` in a fresh `mktemp -d` — scaffolds `.apparat/` tree, root `CONTEXT.md`/`VISION.md`/`README.md`/`docs/adr/`, appends `.apparat/runs/` to `.gitignore`. Idempotent re-invocation does not overwrite.
- `node dist/cli/index.js pipeline list .` from this repo (post-rename) — surfaces `illumination-to-implementation` from `.apparat/pipelines/`.
- `node dist/cli/index.js pipeline validate .apparat/pipelines/illumination-to-implementation/pipeline.dot` — validates clean.
- Post-merge: `npm link` followed by `which apparat` — symlink resolves to the new binary; `which ralph` returns nothing (or stale, which the developer purges manually with `rm $(npm prefix -g)/bin/ralph`).

### 10.4 Negative cases

- A pre-rename `.ralph/` directory left over on disk: the new binary does not auto-migrate. `apparat init` against a directory containing both `.ralph/` and no `.apparat/` creates `.apparat/` alongside; `.ralph/` is treated as foreign. Documented in README's Migration section as one-time manual `git mv`.
- An external script invoking `RALPH_RUNS_KEEP=20 ralph implement ...`: stops working post-rename. The user is the only consumer; they edit the script. Any such scripts are inventoried during the developer's per-project housekeeping (see plan chunk handling per-project mv).

## 11. Summary

`ralph` becomes `apparatus` (brand) / `apparat` (binary) / `.apparat/` (folder) / `APPARAT_*` (env). The rename is taste plus a better-fitting metaphor (the project is an apparatus where apparatchik agents work toward grand goals); no public collision drives urgency, and `VISION.md`'s "personal harness for one developer" charter eliminates the need for compatibility shims. Migration is big-bang in a single PR. Pre-rename, 17 implemented design specs are consumed (`git rm`) to shorten the rename diff. The rename PR itself touches ~292 files: code (every `RALPH_*` env, every `__RALPH_PROD__`, every `.ralph/` literal, every help-text string), bundled pipelines (path strings in `.md` and `.mjs` files), tests (smoke-pipeline path constants, env-var assertions, the renamed `apparat-paths.test.ts`), docs (`README.md`, `VISION.md`, `CONTEXT.md`, `AGENTS.md`, harness docs), build config (`package.json`, `tsup.config.ts`, `src/types/globals.d.ts`), and the repo-self `git mv .ralph .apparat`. ADRs 0001–0009, plans, sessions, runs, and frozen illuminations are left untouched as historical record. Live illuminations and `.apparat/scenarios/` get a path-only `sed` pass to keep operational pointers resolving. ADR-0010 captures the rename decision with explicit naming-only supersession of ADRs 0007/0008. Public CLI surface, pipeline `.dot` syntax, agent frontmatter shapes, MCP tool names, and `pipeline.jsonl` schema are all unchanged. The npm `package.json:name` provisionally becomes `apparat-cli` and is trivially editable post-merge once the user picks a final form.
