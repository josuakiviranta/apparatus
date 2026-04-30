# Bundle Pipelines Under `src/cli/pipelines/` Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate ralph-cli's *bundled* pipelines (`meditate`, `implement`) under `src/cli/pipelines/<name>/` so they ship with the npm package via a single tsup copy rule. `pipelines/{illumination-to-implementation,janitor,smoke}/` stay at repo root as ralph-cli-self-targeting / test fixtures.

**Architecture:** One canonical bundled-pipeline root: `src/cli/pipelines/`. tsup copies that whole tree to `dist/pipelines/`. `assets.ts` resolves bundled root via `__dirname/..` in *both* dev (from `src/cli/lib/`) and prod (from `dist/cli/`). The legacy flat-form (`<name>.dot`) bundled lookup is deleted; folder-form (`<name>/pipeline.dot`) is the only bundled shape. Resolver tier-5 fallback unifies onto `resolveBundledPipeline`.

**Tech Stack:** TypeScript, tsup, vitest, ESM, Node.js >=18.

**Decision context:**
- Current state: `meditate` lives at repo-root `pipelines/meditate/` (folder); `implement` lives at `src/cli/pipelines/implement.{dot,md}` (flat). Two layouts, two tsup copy rules, two `assets.ts` getters.
- Out of scope (option A in brainstorm): bundling `illumination-to-implementation` and `smoke` — these are ralph-cli-private (reference `meditations/`, `docs/superpowers/`, etc.) and would ship dead weight to npm consumers. They stay at repo root. (`janitor` was originally listed here too; superseded 2026-04-30 by `2026-04-30-bundle-janitor-pipeline.md` after the prompt was generalised for consumer use.)
- Stale illumination `meditations/illuminations/2026-04-30T1550-implement-pipeline-stranded-in-src-cli.md` proposed the inverse direction (move `implement` UP to `pipelines/`); it must be archived as superseded.

---

## File Structure

**New / modified locations:**
```
src/cli/pipelines/
├── implement/
│   ├── pipeline.dot          # MOVED from src/cli/pipelines/implement.dot
│   └── implement.md          # MOVED from src/cli/pipelines/implement.md
└── meditate/
    ├── pipeline.dot          # MOVED from pipelines/meditate/pipeline.dot
    └── meditate.md           # MOVED from pipelines/meditate/meditate.md
```

**Removed:**
- `pipelines/meditate/` (after files move)
- `src/cli/pipelines/implement.dot` (flat)
- `src/cli/pipelines/implement.md` (flat)

**Unchanged:**
- `pipelines/illumination-to-implementation/`
- `src/cli/pipelines/janitor/`
- `pipelines/smoke/`

**Modified code (4 files):**
- `tsup.config.ts` — single `cpSync("src/cli/pipelines", "dist/pipelines", {recursive:true})`.
- `src/cli/lib/assets.ts` — flip dev path of `getBundledRoot` to `join(__dirname, "..")`. Delete `getBundledPipelinePath` (legacy flat-form).
- `src/cli/lib/pipeline-resolver.ts` — tier-5 swaps `getBundledPipelinePath` → `resolveBundledPipeline`.
- `src/cli/program.ts` — only doc-text touches (override path message); behavior unchanged.

**Modified tests (6 files):** `assets.test.ts`, `assets-templates.test.ts`, `tsup-templates-copy.test.ts`, `pipeline-resolver.test.ts`, `pipeline.test.ts`, `tests/smoke/implement-pipeline-smoke.dot`.

**Modified docs (~5):** `README.md`, `specs/architecture.md`, `specs/commands.md`, `AGENTS.md`, `docs/orientation/directory-inventory.md`.

**Lifecycle:** Archive `meditations/illuminations/2026-04-30T1550-implement-pipeline-stranded-in-src-cli.md`.

---

## Chunk 1: Move `meditate` to `src/cli/pipelines/meditate/`

This chunk validates the load-bearing change in isolation: dev-mode `__dirname` flip in `assets.ts`. `meditate` is already folder-form, so the only change is its location. After this chunk, `meditate` resolves identically in dev and prod via the unified bundled root.

### Task 1.1: Red — update test fixtures to assert new meditate location

**Files:**
- Modify: `src/cli/tests/tsup-templates-copy.test.ts`
- Modify: `src/cli/tests/assets-templates.test.ts` (no path change in body, but verify after move)

- [ ] **Step 1: Update `tsup-templates-copy.test.ts` to point at the new source location**

Replace the body of the file. The `implement` assertion is gated on `it.skip` until Chunk 2 unskips it — keeps the suite green between chunks.

```ts
import { describe, it, expect } from "vitest";
import { existsSync } from "fs";
import { join } from "path";

describe("bundled pipelines source layout", () => {
  const root = process.cwd();
  it("ships meditate as a folder pipeline under src/cli/pipelines/", () => {
    expect(existsSync(join(root, "src/cli/pipelines/meditate/pipeline.dot"))).toBe(true);
    expect(existsSync(join(root, "src/cli/pipelines/meditate/meditate.md"))).toBe(true);
  });
  it.skip("ships implement as a folder pipeline under src/cli/pipelines/ (unskipped in Chunk 2)", () => {
    expect(existsSync(join(root, "src/cli/pipelines/implement/pipeline.dot"))).toBe(true);
    expect(existsSync(join(root, "src/cli/pipelines/implement/implement.md"))).toBe(true);
  });
});
```

- [ ] **Step 2: Confirm `assets-templates.test.ts` body needs no edit**

`assets-templates.test.ts:14` only asserts `path.endsWith("meditate/pipeline.dot")` — independent of the directory above `meditate/`. After Chunk 1 the assertion still holds; no edit required. (Confirmation step — keeps executor from second-guessing.)

- [ ] **Step 3: Run tests — meditate assertion FAILS, implement skipped**

Run: `npx vitest run src/cli/tests/tsup-templates-copy.test.ts`
Expected: meditate test FAILS (file at `pipelines/meditate/...` not at `src/cli/pipelines/meditate/...`); implement test SKIPPED.

- [ ] **Step 4: Commit (red)**

```bash
git add src/cli/tests/tsup-templates-copy.test.ts
git commit -m "test: assert bundled pipelines under src/cli/pipelines/ (red)"
```

### Task 1.2: Green — move meditate files

**Files:**
- Create dir: `src/cli/pipelines/meditate/`
- Move: `pipelines/meditate/pipeline.dot` → `src/cli/pipelines/meditate/pipeline.dot`
- Move: `pipelines/meditate/meditate.md` → `src/cli/pipelines/meditate/meditate.md`
- Delete dir: `pipelines/meditate/`

- [ ] **Step 1: Move files via `git mv` (preserves history)**

```bash
mkdir -p src/cli/pipelines/meditate
git mv pipelines/meditate/pipeline.dot src/cli/pipelines/meditate/pipeline.dot
git mv pipelines/meditate/meditate.md src/cli/pipelines/meditate/meditate.md
rmdir pipelines/meditate
```

- [ ] **Step 2: Verify directory state**

Run: `ls src/cli/pipelines/meditate/ && ls pipelines/`
Expected:
- `src/cli/pipelines/meditate/` contains `pipeline.dot` and `meditate.md`.
- `pipelines/` contains `illumination-to-implementation/`, `janitor/`, `smoke/` (no `meditate/`).

- [ ] **Step 3: Run tests — meditate assertion now PASSES; resolver / assets tests likely BREAK because dev path still points at repo root**

Run: `npx vitest run src/cli/tests/tsup-templates-copy.test.ts src/cli/tests/assets-templates.test.ts src/cli/tests/assets.test.ts`
Expected: `tsup-templates-copy` meditate test PASSES. `assets-templates.test.ts::resolveBundledPipeline → meditate` likely FAILS in dev (path resolves to old `pipelines/meditate/...` which no longer exists).

This is the failing state that motivates Task 1.3.

### Task 1.3: Green — flip dev path in `assets.ts`

**Files:**
- Modify: `src/cli/lib/assets.ts:15-19` (`getBundledRoot`)

- [ ] **Step 1: Edit `getBundledRoot`**

Old (`src/cli/lib/assets.ts:15-19`):
```ts
function getBundledRoot(): string {
  // prod: dist/cli/ → up one → dist/ (where pipelines/ lives after tsup copy)
  // dev:  src/cli/lib/ → up three → repo root (where pipelines/ lives in source)
  return isProduction() ? join(__dirname, "..") : join(__dirname, "../../..");
}
```

New:
```ts
function getBundledRoot(): string {
  // prod: dist/cli/ → up one → dist/  (tsup copies src/cli/pipelines → dist/pipelines)
  // dev:  src/cli/lib/ → up one → src/cli/  (where pipelines/ lives in source)
  return join(__dirname, "..");
}
```

The `isProduction()` branch is removed *only inside `getBundledRoot`*. Keep the `isProduction` function and its import — `getMetaMeditationsDir`, `getIlluminationServerPath`, and `getBundledPipelinePath` (the latter deleted in Chunk 2) still use it. **Do not delete `isProduction()` itself.**

No other getter changes in Chunk 1: `getBundledAgentsDir`, `getMetaMeditationsDir`, `getIlluminationServerPath` are unaffected by the bundled-root flip. Skip those.

- [ ] **Step 2: Run tests**

Run: `npx vitest run src/cli/tests/assets-templates.test.ts src/cli/tests/assets.test.ts src/cli/tests/tsup-templates-copy.test.ts`
Expected: all green; implement assertion in `tsup-templates-copy.test.ts` is `it.skip`'d.

> **Note:** Do NOT run `npm run build` here. tsup still has the old copy rules (`pipelines/meditate/` was just deleted in Task 1.2; the old `cpSync("pipelines/meditate", ...)` will fail to find the source). The prod-build smoke is deferred to Task 1.4 Step 2 after the tsup config is updated.

- [ ] **Step 3: Commit (green for Chunk 1)**

```bash
git add src/cli/pipelines/meditate src/cli/lib/assets.ts
git commit -m "refactor: bundle meditate pipeline under src/cli/pipelines/

Flips assets.ts dev-mode bundled root from <repo>/pipelines/ to
<repo>/src/cli/pipelines/, matching prod layout (dist/pipelines/).
First half of consolidating bundled pipelines under one root."
```

### Task 1.4: Update tsup config

**Files:**
- Modify: `tsup.config.ts:18-27`

- [ ] **Step 1: Replace dual-copy block with single `cpSync`**

Old (`tsup.config.ts:18-27`):
```ts
async onSuccess() {
  // Copy flat-file pipelines (src/cli/pipelines/*.dot, e.g. implement.dot)
  mkdirSync("dist/pipelines", { recursive: true });
  for (const file of readdirSync("src/cli/pipelines")) {
    copyFileSync(`src/cli/pipelines/${file}`, `dist/pipelines/${file}`);
  }
  // Copy bundled folder pipelines (pipelines/<name>/<files>) — currently meditate.
  cpSync("pipelines/meditate", "dist/pipelines/meditate", { recursive: true });
  console.log("Assets copied to dist/");
},
```

New:
```ts
async onSuccess() {
  // Copy entire src/cli/pipelines/ tree to dist/pipelines/.
  // After Chunk 2, every bundled pipeline is folder-form there.
  cpSync("src/cli/pipelines", "dist/pipelines", { recursive: true });
  console.log("Assets copied to dist/");
},
```

Also remove now-unused imports: `copyFileSync`, `mkdirSync`, `readdirSync` from the top-of-file `import { ... } from "fs"`.

- [ ] **Step 2: Build and verify dist layout + prod-mode meditate smoke**

Run: `npm run build && ls dist/pipelines/`
Expected: `meditate/` folder present with `pipeline.dot` and `meditate.md`. `implement.dot` still copied as flat file (Chunk 2 fixes this).

Then: `node dist/cli/index.js meditate --help`
Expected: help text prints; no errors about missing pipeline. Confirms prod-mode `resolveBundledPipeline("meditate")` resolves correctly.

- [ ] **Step 3: Run full test suite — sanity check no regressions**

Run: `npx vitest run`
Expected: failures only in tests Chunk 2 will touch (`pipeline-resolver`, `tsup-templates-copy::implement`, `implement-pipeline-smoke`).

- [ ] **Step 4: Commit**

```bash
git add tsup.config.ts
git commit -m "refactor(tsup): single recursive copy of src/cli/pipelines → dist/pipelines"
```

---

## Chunk 2: Migrate `implement` to folder form

After this chunk, every bundled pipeline is folder-form. The legacy `getBundledPipelinePath` (flat-file lookup) is deleted; resolver tier-5 fallback uses `resolveBundledPipeline`.

### Task 2.1: Red — update resolver tests for folder-form bundled fallback

**Files:**
- Modify: `src/cli/tests/pipeline-resolver.test.ts:5-7,62-82,133-139`

- [ ] **Step 1: Replace the assets mock**

Old (lines 5-7):
```ts
vi.mock("../lib/assets.js", () => ({
  getBundledPipelinePath: (name: string) => `/dist/pipelines/${name}.dot`,
}));
```

New:
```ts
vi.mock("../lib/assets.js", () => ({
  resolveBundledPipeline: (name: string) => `/dist/pipelines/${name}/pipeline.dot`,
}));
```

- [ ] **Step 2: Update bundled-fallback test expectations**

Lines 62-82:
```ts
describe("resolvePipelineArg bundled fallback", () => {
  beforeEach(() => mockExists.mockReturnValue(false));

  it("returns folder-form bundled path when project and user paths do not exist", () => {
    const result = resolvePipelineArg("implement", "/my/project");
    expect(result).toBe("/dist/pipelines/implement/pipeline.dot");
  });

  it("prefers project-local pipeline when it exists", () => {
    mockExists.mockImplementation((p: unknown) =>
      typeof p === "string" && p.includes("/my/project/pipelines/implement.dot")
    );
    const result = resolvePipelineArg("implement", "/my/project");
    expect(result).toContain("/my/project/pipelines/implement.dot");
  });

  it("returns absolute path unchanged for non-shorthand args", () => {
    const result = resolvePipelineArg("/absolute/path/to/pipeline.dot", "/my/project");
    expect(result).toBe("/absolute/path/to/pipeline.dot");
  });
});
```

- [ ] **Step 3: Delete the legacy `getBundledPipelinePath` describe block**

Remove lines 133-139 entirely (`describe("getBundledPipelinePath (assets.ts)", ...)`).

- [ ] **Step 4: Verify no other callers of `getBundledPipelinePath` in `pipeline.test.ts`**

Run via Grep tool: `pattern="getBundledPipelinePath"` against `src/cli/tests/pipeline.test.ts`.
Expected: only line 43 matches (the mock declaration itself). If any other line matches, surface to user before continuing.

- [ ] **Step 5: Update `pipeline.test.ts` mock**

In `src/cli/tests/pipeline.test.ts:43-44`, drop the `getBundledPipelinePath` mock line (line 43) — keep only `resolveBundledPipeline`.

- [ ] **Step 6: Unskip the implement assertion in `tsup-templates-copy.test.ts`**

Edit `src/cli/tests/tsup-templates-copy.test.ts`: change `it.skip("ships implement as a folder pipeline...` → `it("ships implement as a folder pipeline...`. The Chunk 2 file moves (Task 2.2) will satisfy the assertion.

- [ ] **Step 7: Run resolver tests — they FAIL (mock no longer exports `getBundledPipelinePath` but resolver still calls it)**

Run: `npx vitest run src/cli/tests/pipeline-resolver.test.ts`
Expected: FAIL — TypeError or similar from missing export when tier-5 fires.

- [ ] **Step 8: Commit (red)**

```bash
git add src/cli/tests/pipeline-resolver.test.ts src/cli/tests/pipeline.test.ts src/cli/tests/tsup-templates-copy.test.ts
git commit -m "test: bundled fallback resolves to folder-form pipeline.dot (red)"
```

### Task 2.2: Green — move implement to folder form

**Files:**
- Create dir: `src/cli/pipelines/implement/`
- Move: `src/cli/pipelines/implement.dot` → `src/cli/pipelines/implement/pipeline.dot`
- Move: `src/cli/pipelines/implement.md` → `src/cli/pipelines/implement/implement.md`

- [ ] **Step 1: Move files**

```bash
mkdir -p src/cli/pipelines/implement
git mv src/cli/pipelines/implement.dot src/cli/pipelines/implement/pipeline.dot
git mv src/cli/pipelines/implement.md src/cli/pipelines/implement/implement.md
```

- [ ] **Step 2: Verify**

Run: `ls src/cli/pipelines/implement/ && ls src/cli/pipelines/`
Expected:
- `src/cli/pipelines/implement/` contains `pipeline.dot` and `implement.md`.
- `src/cli/pipelines/` contains only `implement/` and `meditate/` directories (no flat files).

### Task 2.3: Green — swap resolver + drop legacy asset getter

**Files:**
- Modify: `src/cli/lib/pipeline-resolver.ts:4,45`
- Modify: `src/cli/lib/assets.ts:44-49` (delete `getBundledPipelinePath`)

- [ ] **Step 1: Update resolver import + tier-5 call**

Line 4:
```ts
import { resolveBundledPipeline } from "./assets.js";
```

Line 45 (tier-5 fallback):
```ts
return resolveBundledPipeline(arg);
```

- [ ] **Step 2: Delete `getBundledPipelinePath` from `assets.ts`**

Remove lines 44-49 entirely. (Function body, JSDoc comment, and the legacy "flat-file lookup" note all go.)

- [ ] **Step 3: Verify no remaining callers**

Run via Grep tool: `pattern="getBundledPipelinePath"` across `src/`.
Expected: zero matches.

- [ ] **Step 4: Run resolver + assets tests**

Run: `npx vitest run src/cli/tests/pipeline-resolver.test.ts src/cli/tests/assets-templates.test.ts src/cli/tests/assets.test.ts src/cli/tests/pipeline.test.ts`
Expected: all green. (`tsup-templates-copy.test.ts` implement assertion now also passes since the folder exists.)

- [ ] **Step 5: Commit**

```bash
git add src/cli/pipelines/implement src/cli/lib/pipeline-resolver.ts src/cli/lib/assets.ts
git commit -m "refactor: migrate implement pipeline to folder form

Drops getBundledPipelinePath (flat-file lookup). Resolver tier-5
fallback unifies on resolveBundledPipeline (folder-form). Bundled
pipelines now share one shape: <root>/<name>/pipeline.dot."
```

### Task 2.4: Update implement-pipeline-smoke fixture

**Files:**
- Modify: `src/cli/tests/smoke/implement-pipeline-smoke.dot:8-12,17-21,24-28,38-41`

- [ ] **Step 1: Update hardcoded paths**

Replace every occurrence of `src/cli/pipelines/implement.dot` with `src/cli/pipelines/implement/pipeline.dot`. Also update the comments on lines 8-9 to describe the new resolver path:

```dot
  // 1. Verify the bundled implement pipeline exists at the expected source path.
  // resolveBundledPipeline("implement") → src/cli/pipelines/implement/pipeline.dot in dev
  // (assets.ts: __dirname = src/cli/lib/ → up one → src/cli/ → pipelines/implement/pipeline.dot)
  check_bundled_exists [
    shape=parallelogram,
    tool_command="test -f /Users/josu/Documents/projects/ralph-cli/src/cli/pipelines/implement/pipeline.dot && echo 'bundled-pipeline-exists: ok'"
  ]
```

Apply the same path swap to nodes `check_var_expansion` (line 21) and `check_agent_node` (line 27).

**Node 4 (`check_project_local_override`, line 35) is unchanged.** It tests the *absence* of a project-local flat-form override at `$project/pipelines/implement.dot` — flat-form is still a valid tier-2 lookup in the resolver (`pipeline-resolver.ts:33-34`), so the assertion remains semantically correct.

For node 5 (`check_bundled_fallback`, line 41), change `$project/dist/pipelines/implement.dot` → `$project/dist/pipelines/implement/pipeline.dot`.

- [ ] **Step 2: Run the smoke pipeline (project-local)**

Run: `npm run build && node dist/cli/index.js pipeline run src/cli/tests/smoke/implement-pipeline-smoke.dot --project /Users/josu/Documents/projects/ralph-cli`
Expected: all 5 nodes report `: ok`.

- [ ] **Step 3: Commit**

```bash
git add src/cli/tests/smoke/implement-pipeline-smoke.dot
git commit -m "test: implement-pipeline-smoke fixture follows folder-form layout"
```

### Task 2.5: Final regression sweep

- [ ] **Step 1: Full test suite**

Run: `npx vitest run`
Expected: all green. Pay attention to:
- `pipeline.test.ts` (uses both mocks)
- `attractor/tests/dual-parser.test.ts` (scans `pipelines/` + `pipelines/smoke/`; `meditate.dot` no longer in those roots — confirm the fixture set is still non-empty and asserts pass)
- `pipeline-show.test.ts` (uses resolver indirectly)

- [ ] **Step 2: Build verification**

Run: `npm run build && ls dist/pipelines/`
Expected: `dist/pipelines/implement/pipeline.dot`, `dist/pipelines/implement/implement.md`, `dist/pipelines/meditate/pipeline.dot`, `dist/pipelines/meditate/meditate.md`. No flat `.dot` files.

- [ ] **Step 3: Manual end-to-end of meditate (small sanity check)**

Run: `node dist/cli/index.js meditate --help`
Expected: help text renders without errors; `resolveBundledPipeline("meditate")` is exercised internally.

If you have a project handy:
```bash
node dist/cli/index.js meditate <some-project> --help
```
Same expectation.

- [ ] **Step 4: Commit only if regression sweep produced any small fixes (otherwise skip)**

---

## Chunk 3: Documentation + lifecycle

### Task 3.1: Update directory maps and prose references

**Files:**
- Modify: `README.md` lines 35, 152-160 (directory map)
- Modify: `specs/architecture.md` lines 60-66 (file structure), 124-126 (Asset Bundling), 128-141 (Bundled Pipeline Resolution)
- Modify: `specs/commands.md` line 22
- Modify: `AGENTS.md` line 28
- Modify: `docs/orientation/directory-inventory.md` (verify via grep — may have no hits)

- [ ] **Step 1: Grep for stale references**

Run via Grep tool: `pattern="pipelines/meditate"` across repo root, scope `*.md`.
Expected: list of all docs needing updates. For each, swap to `src/cli/pipelines/meditate/` (or remove path-specific phrasing entirely if the path adds no value).

- [ ] **Step 2: Update README.md line 35**

Old:
```
Backed by the bundled folder pipeline `pipelines/meditate/`.
```

New:
```
Backed by the bundled folder pipeline `src/cli/pipelines/meditate/`.
```

- [ ] **Step 3: Update README.md directory map (lines 152-160)**

Adjust the table row for `pipelines/`:

```
| `pipelines/` | Project-local `.dot` pipelines for ralph-cli itself (illumination-to-implementation, janitor) + `smoke/` test fixtures. Bundled pipelines (meditate, implement) ship from `src/cli/pipelines/`. |
```

Add new row above `specs/`:
```
| `src/cli/pipelines/` | Bundled pipelines shipped to npm consumers (`meditate`, `implement`). Folder-form: `<name>/pipeline.dot` + agent `.md` files. Copied to `dist/pipelines/` at build. |
```

- [ ] **Step 4: Update `specs/architecture.md` file-structure block (lines 63-64)**

Replace:
```
│   ├── pipelines/                       # bundled folder pipelines (repo root)
│   │   └── meditate/                   # backs `ralph meditate`
```

With:
```
│   ├── pipelines/                       # bundled folder pipelines (shipped to npm)
│   │   ├── implement/                   # backs `ralph implement`
│   │   └── meditate/                    # backs `ralph meditate`
```

Remove any line in this block that places `pipelines/meditate/` at repo root.

- [ ] **Step 5: Update `specs/architecture.md` Asset Bundling section (line 126)**

Replace the line:
```
`tsup.config.ts` copies flat-file pipelines from `src/cli/pipelines/*.dot` and the folder pipeline at `pipelines/meditate/` into `dist/` via an `onSuccess` hook. ...
```

With:
```
`tsup.config.ts` recursively copies `src/cli/pipelines/` (every bundled pipeline as folder-form `<name>/pipeline.dot` + agent `.md`) into `dist/pipelines/` via an `onSuccess` hook. ...
```

Keep the rest of that paragraph (about `meditations/` and `__RALPH_PROD__`) unchanged.

- [ ] **Step 6: Update `specs/architecture.md` Bundled Pipeline Resolution section (lines 130, 135, 141)**

- Line 130: change `bundled `pipelines/meditate/` folder pipeline` → `bundled `src/cli/pipelines/meditate/` folder pipeline`.
- Line 135: change `(dev: repo-root `pipelines/<name>/pipeline.dot`)` → `(dev: `src/cli/pipelines/<name>/pipeline.dot`)`.
- Line 141 (table row): change `pipelines/meditate/pipeline.dot` → `src/cli/pipelines/meditate/pipeline.dot`. Add a new row for `ralph implement` | `implement` | `src/cli/pipelines/implement/pipeline.dot`.

- [ ] **Step 7: Update `specs/commands.md:22` and `AGENTS.md:28`**

For both files, replace `pipelines/meditate/` with `src/cli/pipelines/meditate/`. (Use the Read tool first to confirm the exact surrounding context before edit.)

- [ ] **Step 8: Verify `docs/orientation/directory-inventory.md`**

Run via Grep tool: `pattern="pipelines/meditate|src/cli/pipelines/implement"` against `docs/orientation/directory-inventory.md`.
- If hits: update each occurrence to the new layout.
- If zero hits: skip — the file already describes structure abstractly.

- [ ] **Step 9: Commit**

```bash
git add README.md specs/architecture.md specs/commands.md AGENTS.md docs/orientation/directory-inventory.md
git commit -m "docs: bundled pipelines now live under src/cli/pipelines/"
```

### Task 3.2: Archive the superseded illumination

**Files:**
- Modify: `meditations/illuminations/2026-04-30T1550-implement-pipeline-stranded-in-src-cli.md` frontmatter
- Move: file → `meditations/archived-illuminations/2026-04-30T1550-implement-pipeline-stranded-in-src-cli.md`

- [ ] **Step 1: Update frontmatter**

Edit lines 1-5 in place. **Field name is `archive_reason` (singular), not `archive_reason_short`** — the latter is the agent output schema; the persisted frontmatter field per `src/cli/mcp/illumination-server.ts:238` is `archive_reason`.

```yaml
---
date: 2026-04-30
status: archived
archived_at: 2026-04-30
archive_reason: Superseded by opposite-direction consolidation; bundled pipelines now live under src/cli/pipelines/ rather than top-level pipelines/. See docs/superpowers/plans/2026-04-30-bundle-pipelines-under-src-cli.md.
description: All pipelines moved to top-level pipelines/ folder-form except implement, still alone in src/cli/pipelines/ — last splinter to consolidate.
---
```

- [ ] **Step 2: Move to archived-illuminations/**

```bash
git mv meditations/illuminations/2026-04-30T1550-implement-pipeline-stranded-in-src-cli.md meditations/archived-illuminations/2026-04-30T1550-implement-pipeline-stranded-in-src-cli.md
```

- [ ] **Step 3: Commit**

```bash
git add meditations/archived-illuminations/2026-04-30T1550-implement-pipeline-stranded-in-src-cli.md
git commit -m "meditate: archive stranded-implement illumination (superseded)"
```

### Task 3.3: Final verification

- [ ] **Step 1: Full vitest**

Run: `npx vitest run`
Expected: all green.

- [ ] **Step 2: tsc / typecheck if configured**

Run: `npx tsc --noEmit` (skip if not in package scripts).
Expected: no errors.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: `dist/pipelines/{implement,meditate}/pipeline.dot` exist; no `dist/pipelines/*.dot` flat files.

- [ ] **Step 4: Smoke run (against ralph-cli itself)**

Run: `node dist/cli/index.js pipeline list .`
Expected: based on `pipeline.ts:598` (`readdirSync(pipelinesDir).filter(f => f.endsWith(".dot"))`), `pipeline list` enumerates only flat `.dot` files at the top level of `<project>/pipelines/`. Since ralph-cli's `pipelines/` now contains only subfolders (`illumination-to-implementation/`, `janitor/`, `smoke/`), the command will print "No workflows found in ..." — that's the expected output. (This is a pre-existing bug/limitation of `pipeline list`, not introduced by this plan; surface as a separate illumination if desired.)

Run: `node dist/cli/index.js meditate --help`
Expected: help renders without errors. Confirms bundled-pipeline resolution works in prod build.

- [ ] **Step 5: No final commit (sweep should produce zero diff)**

If `git status` is clean, you're done.

---

## Risks & Rollback

**Risk surface (in priority order):**
1. **`assets.ts` dev-path flip** — load-bearing. Wrong off-by-one breaks every dev-mode pipeline resolution. Validated by `assets-templates.test.ts::resolveBundledPipeline` and end-to-end run in Task 1.3 / Task 2.5.
2. **tsup copy semantics** — `cpSync(..., {recursive:true})` on a directory containing only folders should produce an identical tree. Validated by Task 1.4 step 2 + `tsup-templates-copy.test.ts`.
3. **Resolver tier-5 swap** — flat-form bundled lookup is deleted entirely. Any caller still expecting `<name>.dot` will break. Grep in Task 2.3 step 3 catches this.

**Rollback:** `git revert <range>` of the chunk commits restores everything; pipelines are pure data, no DB / external state.

**No worktree used:** Brainstorming was conversational; user accepted the plan inline. If the executing harness prefers worktree isolation, create one before Chunk 1 via superpowers:using-git-worktrees.
