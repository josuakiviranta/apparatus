# Bundle Janitor Pipeline + Heartbeat Shorthand Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `pipelines/janitor/` → `src/cli/pipelines/janitor/` so the janitor pipeline ships to npm consumers, after generalising its prompt to drop ralph-cli-private references and adding heartbeat-command shorthand support so consumers can run `ralph heartbeat pipeline janitor --project . --every 720` without typing the bundled-dist path.

**Architecture:** Three-step migration. (1) Generalise `janitor.md` so its instruction body refers to project surfaces abstractly rather than naming ralph-cli internals. (2) Move the folder under `src/cli/pipelines/` — tsup already copies the whole tree to `dist/pipelines/`, and `pipeline-resolver.ts:45` already falls through to bundled lookup, so the move is mechanical. (3) Teach `heartbeat pipeline <arg>` to accept the same shorthand the `pipeline run` command accepts (route through `resolvePipelineArg`) when the arg is not a literal path — required so the README example stays usable for npm consumers who lack `dist/pipelines/janitor/pipeline.dot` typed by hand.

**Tech Stack:** TypeScript, tsup, vitest, ESM, Node.js >=18.

**Decision context:**
- A sibling plan `docs/superpowers/plans/2026-04-30-bundle-pipelines-under-src-cli.md:18` previously listed janitor as **out of scope** for bundling on the rationale that it was "ralph-cli-private". The user revised that decision: janitor's logic is generic (KISS-lens scanner of any codebase) and should ship. This plan supersedes that "out of scope" line, which must be revised in Chunk 3.
- `heartbeat pipeline` (heartbeat.ts:155-171) currently takes a literal dotfile path (`resolve(dotfile)`). It does NOT route through `resolvePipelineArg`. Without Chunk 2's shorthand support, npm consumers would have to type `node_modules/ralph-cli/dist/pipelines/janitor/pipeline.dot`. Heartbeat shorthand is part of *this* move's scope precisely because the move's value (consumer accessibility) requires it.
- `script_file` resolution (`tool.ts:248`) is relative to `dotDir` — moving `read-vision.mjs` alongside `pipeline.dot` keeps it findable. `agent="janitor"` resolution (`agent-loader.ts:11-16`) is also relative to the pipeline directory. Both confirmed by blast-radius probe — no resolver code change needed for paths.

---

## File Structure

**Files moved (3, via `git mv`):**
```
pipelines/janitor/janitor.md       → src/cli/pipelines/janitor/janitor.md
pipelines/janitor/pipeline.dot     → src/cli/pipelines/janitor/pipeline.dot
pipelines/janitor/read-vision.mjs  → src/cli/pipelines/janitor/read-vision.mjs
```

After move, `pipelines/janitor/` directory is removed (`rmdir`). `pipelines/` retains `smoke/`, `illumination-to-implementation/`, `janitor.svg`, `illumination-to-implementation.svg`.

**Files modified (code, 1):**
- `src/cli/commands/heartbeat.ts:145-189` — route `<dotfile>` arg through `resolvePipelineArg` when it is shorthand (not a literal path).

**Files modified (tests, 4):**
- `src/cli/tests/pipeline-janitor-folder.test.ts` — change expected path from `<repo>/pipelines/janitor/...` to `<repo>/src/cli/pipelines/janitor/...`.
- `src/cli/tests/janitor-agent.test.ts:10` — `AGENT_PATH` constant uses `resolve(__dirname, "../../../pipelines/janitor/janitor.md")`. After move, `src/cli/pipelines/janitor/janitor.md` is reachable from `src/cli/tests/` with one `..` only: change to `resolve(__dirname, "../pipelines/janitor/janitor.md")`.
- `src/cli/tests/tsup-templates-copy.test.ts` — add `it()` asserting janitor ships under `src/cli/pipelines/`.
- `src/cli/tests/heartbeat.test.ts` (or new file if absent) — add tests for shorthand resolution.

**Files modified (prompt body, 1):**
- `src/cli/pipelines/janitor/janitor.md` (post-move) — replace the strategic-compass example "core CLI surfaces, pipeline engine" with a project-agnostic phrasing.

**Files modified (docs, 9 active path refs + 1 supersession-note revision):**
- `README.md:47` — switch heartbeat example to bundled shorthand `janitor`. (The blast-radius inventory cited "line 41" — actual current line is 47. Always locate by verbatim string match, not by line number.)
- `CONTEXT.md:97` — path reference (active prose). Line 109 ("captured in pre-rewrite commits to `pipelines/janitor/janitor.md`") is a **historical reference** documenting where the file lived in earlier commits — leave alone.
- `docs/adr/0002-consume-only-illumination-lifecycle.md:52` — path reference (active prose). Line 87 ("captured in pre-2026-04-30 commits to `pipelines/janitor/janitor.md`") is a **historical reference** — leave alone.
- `docs/superpowers/plans/2026-04-30-bundle-pipelines-under-src-cli.md:13,38` — revise the line-13 "out of scope" sentence to record the supersession; update the line-38 directory listing.
- `docs/superpowers/plans/2026-04-30-specs-to-docs-portability.md:326,327,336` — path references.
- `docs/superpowers/plans/2026-04-30-consume-only-illumination-lifecycle.md:954,957,1056` — path references.

**Files NOT touched (historical / incidental refs from blast radius):**
- `memory/2026-04-30-specs-relocated-to-docs.md`, `memory/2026-04-25-meditate-prompt-is-write-only.md`, `memory/2026-04-25-janitor-lifecycle-orphan-plans.md`, `memory/2026-04-27-pipeline-show-two-open-seams.md`. Memory entries are point-in-time records; they document what was true when written.

---

## Chunk 1: Generalise janitor agent prompt

This chunk runs *before* the move. The agent prompt currently names ralph-cli internals as examples ("core CLI surfaces, pipeline engine"). For npm consumers those phrases are noise. Generalise first, in place — that way the move in Chunk 2 carries the consumer-ready prompt with it, and a reviewer sees the prompt change isolated from path noise.

### Task 1.1: Read and capture current strategic-compass section

**Files:**
- Read: `pipelines/janitor/janitor.md:27-32`

- [x] **Step 1: Read the current strategic-compass section**

Run: `sed -n '27,32p' pipelines/janitor/janitor.md`

Expected current content (line 31 is the example to revise):
```
Treat the vision as the strategic filter: refactor opportunities and YAGNI violations in vision-load-bearing areas (core CLI surfaces, pipeline engine) deserve sharper findings than peripheral ones. If `<read_vision_vision>` is empty, no project vision exists yet; consider flagging that as itself a candidate.
```

### Task 1.2: Generalise the example phrasing

**Files:**
- Modify: `pipelines/janitor/janitor.md:31`

- [x] **Step 1: Replace the ralph-cli-specific example**

Change the parenthetical "(core CLI surfaces, pipeline engine)" to "(modules the vision identifies as core)". Full revised sentence:

```
Treat the vision as the strategic filter: refactor opportunities and YAGNI violations in vision-load-bearing areas (modules the vision identifies as core) deserve sharper findings than peripheral ones. If `<read_vision_vision>` is empty, no project vision exists yet; consider flagging that as itself a candidate.
```

- [x] **Step 2: Verify no other ralph-cli-specific phrasing remains**

Run: `grep -nE "ralph|cli surface|pipeline engine|attractor" pipelines/janitor/janitor.md`
Expected: no matches.

If matches appear, revise each one to a project-agnostic equivalent before proceeding.

### Task 1.3: Commit prompt generalisation

- [x] **Step 1: Commit**

```bash
git add pipelines/janitor/janitor.md
git commit -m "refactor(janitor): generalise prompt for non-ralph-cli consumers"
```

---

## Chunk 2: Move janitor folder and add heartbeat shorthand

This chunk performs the load-bearing change: physical move + heartbeat shorthand routing. TDD on the heartbeat shorthand because that is the only behavioural change.

### Task 2.1: Red — write failing test for janitor folder location

**Files:**
- Modify: `src/cli/tests/pipeline-janitor-folder.test.ts:7,11,17,23`

- [x] **Step 1: Update path expectations in existing test**

Change every occurrence of `join(REPO_ROOT, "pipelines", "janitor", ...)` to `join(REPO_ROOT, "src", "cli", "pipelines", "janitor", ...)`. Update the describe block label from `"pipelines/janitor/ — chunk-4 per-folder migration"` to `"src/cli/pipelines/janitor/ — bundled pipeline"`.

The test on line 13 (`resolvePipelineArg("janitor", REPO_ROOT)`) still asserts equality against the same `expected` variable, so updating `expected`'s path is sufficient.

- [x] **Step 2: Run test to verify it fails (because files have not moved yet)**

Run: `npx vitest run src/cli/tests/pipeline-janitor-folder.test.ts`
Expected: FAIL — `existsSync(<src/cli/pipelines/janitor/pipeline.dot>)` returns false.

### Task 2.2: Green — move the janitor folder

**Files:**
- Move: `pipelines/janitor/{janitor.md, pipeline.dot, read-vision.mjs}` → `src/cli/pipelines/janitor/`

- [x] **Step 1: Move files via `git mv`**

```bash
mkdir -p src/cli/pipelines/janitor
git mv pipelines/janitor/janitor.md src/cli/pipelines/janitor/janitor.md
git mv pipelines/janitor/pipeline.dot src/cli/pipelines/janitor/pipeline.dot
git mv pipelines/janitor/read-vision.mjs src/cli/pipelines/janitor/read-vision.mjs
rmdir pipelines/janitor
```

- [x] **Step 2: Confirm directory removal**

Run: `[ ! -d pipelines/janitor ] && echo "removed" || echo "still exists"`
Expected: `removed`.

- [x] **Step 3: Update `janitor-agent.test.ts` AGENT_PATH constant**

`src/cli/tests/janitor-agent.test.ts:10` currently has:

```typescript
const AGENT_PATH = resolve(__dirname, "../../../pipelines/janitor/janitor.md");
```

`__dirname` resolves to `src/cli/tests/`, so the existing three `..` segments climb to repo root and re-enter via `pipelines/`. The new bundled location lives one directory up at `src/cli/pipelines/janitor/janitor.md`. Replace with a single `..`:

```typescript
const AGENT_PATH = resolve(__dirname, "../pipelines/janitor/janitor.md");
```

- [x] **Step 4: Run pipeline-janitor-folder test to verify it passes**

Run: `npx vitest run src/cli/tests/pipeline-janitor-folder.test.ts`
Expected: PASS — all 3 cases green.

- [x] **Step 5: Run janitor-agent test to verify the AGENT_PATH update**

Run: `npx vitest run src/cli/tests/janitor-agent.test.ts`
Expected: PASS.

- [x] **Step 6: Sanity-check pipeline validates from new location**

Run: `npx tsx src/cli/index.ts pipeline validate src/cli/pipelines/janitor/pipeline.dot`
Expected: exit 0, no error-level diagnostics.

### Task 2.3: Add tsup-templates-copy assertion for janitor

**Files:**
- Modify: `src/cli/tests/tsup-templates-copy.test.ts:6-15`

- [x] **Step 1: Add a third `it()` block asserting janitor ships**

Insert after the `implement` assertion:

```typescript
  it("ships janitor as a folder pipeline under src/cli/pipelines/", () => {
    expect(existsSync(join(root, "src/cli/pipelines/janitor/pipeline.dot"))).toBe(true);
    expect(existsSync(join(root, "src/cli/pipelines/janitor/janitor.md"))).toBe(true);
    expect(existsSync(join(root, "src/cli/pipelines/janitor/read-vision.mjs"))).toBe(true);
  });
```

- [x] **Step 2: Run test to verify it passes**

Run: `npx vitest run src/cli/tests/tsup-templates-copy.test.ts`
Expected: PASS — three `it()` blocks all green.

### Task 2.4: Red — write failing test for heartbeat shorthand

**Files:**
- Look for: `src/cli/tests/heartbeat.test.ts` — if absent, create.

- [x] **Step 1: Locate or create the heartbeat test file**

Run: `ls src/cli/tests/ | grep -i heartbeat`

If a file exists, append the new `describe`. If not, create `src/cli/tests/heartbeat.test.ts` with imports modelled after `pipeline-janitor-folder.test.ts`.

- [x] **Step 2: Write the failing test against an export that does not yet exist**

The behaviour we want: when the positional arg is *not* a literal path (no `/`, no `.dot` suffix, matches `[a-zA-Z0-9_-]+`), `heartbeat pipeline` resolves it through the shared resolver instead of treating it as a relative file path. We expose this via a new helper `resolveHeartbeatPipelineArg(arg, project)` from `src/cli/commands/heartbeat.ts` so the wiring is unit-testable. The helper returns the absolute dotfile path, using `resolvePipelineArg` when `isNameShorthand(arg)` is true and `resolve(arg)` otherwise.

Add this single test block (no preamble unit test on `isNameShorthand` — it already exists in `pipeline-resolver.test.ts`, retesting it here is noise):

```typescript
import { describe, it, expect } from "vitest";
import { resolveHeartbeatPipelineArg } from "../commands/heartbeat.js";
import { resolve } from "node:path";

describe("resolveHeartbeatPipelineArg", () => {
  const repoRoot = resolve(__dirname, "../../..");

  it("routes shorthand `janitor` through the resolver to the bundled dotfile", () => {
    const dotPath = resolveHeartbeatPipelineArg("janitor", repoRoot);
    expect(dotPath.endsWith("janitor/pipeline.dot")).toBe(true);
  });

  it("treats `./my.dot` as a literal path", () => {
    const cwd = process.cwd();
    expect(resolveHeartbeatPipelineArg("./my.dot", cwd)).toBe(resolve(cwd, "./my.dot"));
  });
});
```

- [x] **Step 3: Run test to verify it fails for the right reason**

Run: `npx vitest run src/cli/tests/heartbeat.test.ts`
Expected: FAIL — TypeScript or vitest error reporting that `resolveHeartbeatPipelineArg` is not exported from `../commands/heartbeat.js`. This is the red signal we want.

### Task 2.5: Green — implement heartbeat shorthand

**Files:**
- Modify: `src/cli/commands/heartbeat.ts:145-189`

- [x] **Step 1: Extract resolution helper at top of heartbeat.ts**

Add the export above the `hb.command(...)` block (alongside the existing imports — note `resolvePipelineArg` and `isNameShorthand` already live in `src/cli/lib/pipeline-resolver.ts`):

```typescript
import { resolvePipelineArg, isNameShorthand } from "../lib/pipeline-resolver.js";

export function resolveHeartbeatPipelineArg(arg: string, project: string): string {
  if (isNameShorthand(arg)) {
    return resolvePipelineArg(arg, project);
  }
  return resolve(arg);
}
```

- [x] **Step 2: Use the helper in the action handler**

Replace `const absDotFile = resolve(dotfile);` (heartbeat.ts:156) with:

```typescript
const projectForResolver = opts.project ? resolve(opts.project) : process.cwd();
const absDotFile = resolveHeartbeatPipelineArg(dotfile, projectForResolver);
```

The `validatePathArg(dotfile, absDotFile, "file", "Pipeline dotfile")` call on line 157 stays. It is now redundant on the shorthand branch (`resolvePipelineArg` only returns paths that exist or throws) but harmless, and still load-bearing on the literal-path branch (`resolve(arg)` does not check existence). Keeping it is the simpler, less-surprising choice.

`opts.project` is optional. When omitted, `projectForResolver` defaults to `process.cwd()`. With shorthand input, the resolver's tier 1 (`<cwd>/pipelines/<name>/pipeline.dot`) misses if cwd has no `pipelines/` directory and falls through to tier 5 (bundled). So `ralph heartbeat pipeline janitor --every 720` (no `--project`) works for an npm consumer running from any directory: bundled `dist/pipelines/janitor/pipeline.dot` is found regardless of cwd. Document this in the help text in step 3.

The `parseDot(readFileSync(absDotFile, "utf8"))` call on line 161 is unchanged. Shorthand resolution always returns an existing dotfile, so the `readFileSync` succeeds.

- [x] **Step 3: Update the help-text example**

Change the `addHelpText` line (heartbeat.ts:148) example from:
```
ralph heartbeat pipeline workflow.dot --project my-app --every 60
```
to include both forms:
```
ralph heartbeat pipeline workflow.dot --project my-app --every 60
ralph heartbeat pipeline janitor      --project my-app --every 720
```

- [x] **Step 4: Run all heartbeat tests**

Run: `npx vitest run src/cli/tests/heartbeat.test.ts`
Expected: PASS.

- [x] **Step 5: Run the full test suite to catch regressions**

Run: `npm test`
Expected: PASS. If anything is red, fix before commit.

### Task 2.6: Verify dev-mode and prod-mode resolution

- [x] **Step 1: Verify dev-mode shorthand resolution (no build)**

Tests run pre-build via `tsx`. `getBundledRoot()` in `assets.ts` resolves to `src/cli/` in dev (via `__dirname` from `src/cli/lib/`). Confirm the bundled fallback works without ever building:

Run: `npx tsx src/cli/index.ts pipeline validate janitor`
Expected: exit 0, no error-level diagnostics. The `validate` subcommand routes through `resolvePipelineArg`, so a green run here proves the dev-mode tier-5 fallback finds `src/cli/pipelines/janitor/pipeline.dot`.

- [x] **Step 2: Build and confirm janitor lands in dist**

Run:
```bash
npm run build
ls dist/pipelines/janitor/
```
Expected output:
```
janitor.md
pipeline.dot
read-vision.mjs
```

- [x] **Step 3: Verify prod-mode shorthand resolution (against dist)**

Run: `node dist/cli/index.js pipeline validate janitor`
Expected: exit 0. Confirms `getBundledRoot()` resolving from `dist/cli/` finds `dist/pipelines/janitor/pipeline.dot`.

### Task 2.7: Commit chunk 2

- [x] **Step 1: Commit**

```bash
git add -A
git commit -m "feat(janitor): bundle as src/cli/pipelines/janitor + heartbeat shorthand

- move pipelines/janitor/ → src/cli/pipelines/janitor/
- heartbeat pipeline now accepts shorthand (routes through resolvePipelineArg)
- npm consumers can run: ralph heartbeat pipeline janitor --project . --every 720"
```

---

## Chunk 3: Update docs and revise sibling plan

This chunk has no behavioural change. Pure docs sweep over the 11 path refs the blast radius found, plus the parent plan's now-stale "out of scope" line.

### Task 3.1: Update README

**Files:**
- Modify: `README.md` — locate by verbatim string, not line number.

- [x] **Step 1: Replace the heartbeat example**

Find the line containing:
```
ralph heartbeat pipeline pipelines/janitor/pipeline.dot --project . --every 720
```

Replace with:
```
ralph heartbeat pipeline janitor --project . --every 720
```

- [x] **Step 2: Confirm the surrounding paragraph still scans**

Read the 5 lines before and after the substitution. The surrounding prose calls janitor "the bundled janitor pipeline" — that wording becomes literally accurate after this plan, so no change is needed. If the prose now reads awkwardly (e.g. "schedule the bundled janitor pipeline ... `pipelines/janitor/pipeline.dot`" with the path now stripped), tighten the sentence.

### Task 3.2: Update CONTEXT.md

**Files:**
- Modify: `CONTEXT.md:97` only.

- [x] **Step 1: Update the active prose path ref on line 97**

Line 97 currently contains `\`pipelines/janitor/pipeline.dot\`` in active prose describing janitor's location. Change to `\`src/cli/pipelines/janitor/pipeline.dot\``.

- [x] **Step 2: Leave line 109 alone (historical reference)**

Line 109 reads "captured in pre-rewrite commits to `pipelines/janitor/janitor.md`". This describes where the file *was* in earlier commits — rewriting it would falsify that historical record (the pre-rewrite commits really do live at `pipelines/janitor/janitor.md`). Leave unchanged.

- [x] **Step 3: Confirm surrounding prose remains accurate**

If line 97's surrounding paragraph describes janitor as project-local, revise to reflect that janitor now ships bundled. Read 5 lines before and after to judge.

### Task 3.3: Update ADR-0002

**Files:**
- Modify: `docs/adr/0002-consume-only-illumination-lifecycle.md:52` only.

- [x] **Step 1: Update the active prose path ref on line 52**

Change `\`pipelines/janitor/pipeline.dot\`` to `\`src/cli/pipelines/janitor/pipeline.dot\``. The ADR's *decision* is unchanged — only the path string changes.

- [x] **Step 2: Leave line 87 alone (historical reference)**

Line 87 reads "captured in pre-2026-04-30 commits to `pipelines/janitor/janitor.md`" — same historical-reference reasoning as CONTEXT.md:109. Leave unchanged.

### Task 3.4: Revise sibling plan's out-of-scope line

**Files:**
- Modify: `docs/superpowers/plans/2026-04-30-bundle-pipelines-under-src-cli.md:13,38`

- [x] **Step 1: Mark the out-of-scope decision as superseded**

Find line 13. Verbatim current text:
```
- Out of scope (option A in brainstorm): bundling `illumination-to-implementation`, `janitor`, `smoke` — these are ralph-cli-private (reference `meditations/`, `docs/superpowers/`, etc.) and would ship dead weight to npm consumers. They stay at repo root.
```

Replace with:
```
- Out of scope (option A in brainstorm): bundling `illumination-to-implementation` and `smoke` — these are ralph-cli-private (reference `meditations/`, `docs/superpowers/`, etc.) and would ship dead weight to npm consumers. They stay at repo root. (`janitor` was originally listed here too; superseded 2026-04-30 by `2026-04-30-bundle-janitor-pipeline.md` after the prompt was generalised for consumer use.)
```

The `meditations/`, `docs/superpowers/` parenthetical is preserved verbatim from the original — the supersession note is additive, not a rewrite of the rationale.

- [x] **Step 2: Update the directory-listing reference at line 38**

Line 38 currently reads `- \`pipelines/janitor/\``. Change to `- \`src/cli/pipelines/janitor/\``.

### Task 3.5: Update the two other plan docs

**Files:**
- Modify: `docs/superpowers/plans/2026-04-30-specs-to-docs-portability.md:326,327,336`
- Modify: `docs/superpowers/plans/2026-04-30-consume-only-illumination-lifecycle.md:954,957,1056`

- [x] **Step 1: Apply the path substitution at each cited line**

At each of the six locations, replace `pipelines/janitor/` with `src/cli/pipelines/janitor/`. These plans reference janitor as an example or as a target file. After the substitution, the reference points to the new bundled path. (If a cited line has shifted since the inventory was generated, locate by verbatim string match against the surrounding context, not by line number.)

### Task 3.6: Run the full test suite + verify no remaining stale paths

- [x] **Step 1: Full grep sweep for any missed `pipelines/janitor` ref**

Run: `grep -rn "pipelines/janitor" --include="*.md" --include="*.ts" --include="*.mjs" --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=memory .`

Expected matches (these are intentional, leave them alone):
- `CONTEXT.md:109` — historical reference to pre-rewrite commits.
- `docs/adr/0002-consume-only-illumination-lifecycle.md:87` — historical reference to pre-2026-04-30 commits.

Any other match indicates a missed substitution — fix each before committing.

- [x] **Step 2: Run tests**

Run: `npm test`
Expected: PASS.

### Task 3.7: Commit chunk 3

- [x] **Step 1: Commit**

```bash
git add -A
git commit -m "docs: update janitor refs to src/cli/pipelines/janitor + revise sibling plan

- README, CONTEXT, ADR-0002 path updates
- sibling plan 'out of scope' line marked superseded
- two other plan docs receive same path substitution"
```

---

## Verification (after all chunks)

- [x] `npm test` — full suite green.
- [x] `npm run build && ls dist/pipelines/janitor/` — three files present.
- [x] `npx tsx src/cli/index.ts pipeline validate janitor` — validates the bundled pipeline by shorthand.
- [x] `grep -rn "pipelines/janitor" --include="*.md" --include="*.ts" --exclude-dir=node_modules --exclude-dir=memory .` — no matches.
- [x] Manual smoke (optional): `npx tsx src/cli/index.ts heartbeat pipeline janitor --project . --every 720` then immediately `ralph heartbeat list` to confirm registration; `ralph heartbeat stop pipeline:pipeline` to clean up.
