# Stop vitest from polluting `~/.apparat/projects.json` — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop three vitest files from leaking `apparat-pipeline-test-*` and `apparat-preflight-*` paths into the operator's real `~/.apparat/projects.json`.

**Architecture:** Each `describe` block that ultimately invokes `pipelineRunCommand({ project, … })` (directly or via a spawned child CLI) gains a `beforeEach`/`afterEach` pair that swaps `process.env.HOME` to a fresh `mkdtempSync("apparat-…-home-")` and restores it on teardown. `recordProject` (`src/cli/lib/projects-registry.ts:30`) resolves through `getApparatHome()` (`src/daemon/state.ts:31-34`) on every call — re-reading `process.env.HOME` at invocation time — so the swap deterministically redirects writes to a per-test fake home that gets deleted with the test. **Zero production code changes. Zero documentation changes.**

**Tech Stack:** TypeScript, vitest, Node.js `child_process.spawnSync` (inherits `process.env` by default), `fs.mkdtempSync` / `rmSync`, `os.tmpdir()`.

**Source design:** [`docs/superpowers/specs/2026-05-10-projects-registry-stale-temp-dir-noise-design.md`](../specs/2026-05-10-projects-registry-stale-temp-dir-noise-design.md)

**Scope summary (locked by chat refinement):**

- **In scope:** edits to `src/cli/tests/pipeline-run-preflight.test.ts`, `src/cli/tests/pipeline-preflight.test.ts`, `src/cli/tests/pipeline.test.ts`.
- **Out of scope:** `prune(entries, fsExists)` helper, `apparat status --prune` flag, `apparat projects forget <path>` command, CI/git-hook backstop, migration script (operator's registry already cleaned during the chat round), any production-code edit, any doc edit, any `APPARAT_HOME` env-var addition (would require touching `src/daemon/state.ts:31-34`).
- **Resolved open questions:** §9.1 — symmetric isolation across every `describe` that touches CLI commands (Option 1 in the design); §9.3 — restore-original `process.env.HOME` in teardown (parallel-safe shape).

**Reference patterns (already in repo, copy verbatim):**

- `src/cli/tests/pipeline-run-runid.test.ts:13-15` (inline triplet, teardown at `:30-31`).
- `src/cli/tests/projects-registry.test.ts:9-18` (`beforeEach`/`afterEach` shape — preferred when multiple `it` blocks share the home).
- `src/cli/tests/status.test.ts:17-30` (same shape, with a stdout-capture sibling).

**Residual leak surface (carried from design §6):** the verifier flagged 6 sibling test files (`implement.test.ts`, `meditate.test.ts`, `pipeline-failure-footer-scenario.test.ts`, `pipeline-failure-reason.test.ts`, `pipeline-headless.test.ts`, `runs-gc-per-pipeline.test.ts`) as possibly leaking — design recommends scope-defer (this plan executes the recommendation: ship three files, measure, follow up only if Chunk 4's empirical check shows residual growth).

---

## Chunk 1: Fix `src/cli/tests/pipeline-run-preflight.test.ts`

This file is the smallest of the three (71 lines, single `describe`, three `it` blocks) — implement first to validate the pattern before scaling.

**Files:**

- Modify: `src/cli/tests/pipeline-run-preflight.test.ts:1-71`
- Reference (do **not** edit): `src/cli/tests/pipeline-run-runid.test.ts:13-15`, `src/cli/tests/projects-registry.test.ts:9-18`

**Leak source (current state):** the second `it` (`:36-52`) calls `pipelineRunCommand(dot, { project: dir })` at `:48`. `dir` is `mkdtempSync(join(tmpdir(), "apparat-preflight-"))` from `:37`. With no HOME isolation, `recordProject(project)` at `src/cli/commands/pipeline/run.ts:59` writes `dir` into the operator's real `~/.apparat/projects.json`. The first (`:8-34`) and third (`:54-70`) `it` blocks call `pipelineRunCommand(dot, {})` (no `project`), so `if (project)` short-circuits and they do not leak today — isolation is added defensively per design §9.1.

### Task 1.1: Add describe-scoped HOME isolation

- [x] **Step 1: Snapshot the operator's registry baseline (writer machine)**

```bash
cp ~/.apparat/projects.json /tmp/before-chunk-1.json 2>/dev/null || echo "[]" > /tmp/before-chunk-1.json
wc -l /tmp/before-chunk-1.json
grep -c "apparat-preflight-" /tmp/before-chunk-1.json || true
```

Record the baseline counts. (Used in Step 6 to demonstrate the fix.)

- [x] **Step 2: Reproduce the leak — run the test file as-is and verify the registry grew**

Run: `npx vitest run src/cli/tests/pipeline-run-preflight.test.ts`

Expected: all 3 `it` blocks pass. Then:

```bash
grep -c "apparat-preflight-" ~/.apparat/projects.json
```

Expected: count is **strictly greater** than the baseline from Step 1 (typically baseline + 1, because only the second `it` passes `project`). This confirms the leak before we fix it. If the count is unchanged, halt and re-read the design — the trigger graph in §3.1 must be reproducible before we trust the fix.

- [x] **Step 3: Apply describe-scoped isolation**

Edit `src/cli/tests/pipeline-run-preflight.test.ts`. Replace the imports block at `:1-5` with the import set below (adds `beforeEach`, `afterEach`, and `rmSync`):

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { pipelineRunCommand } from "../commands/pipeline.js";
```

Then, immediately after the `describe(…, () => {` opening at `:7`, insert the isolation pair:

```ts
describe("pipelineRunCommand — $project preflight", () => {
  let fakeHome: string;
  let origHome: string | undefined;

  beforeEach(() => {
    fakeHome = mkdtempSync(join(tmpdir(), "apparat-preflight-home-"));
    origHome = process.env.HOME;
    process.env.HOME = fakeHome;
  });

  afterEach(() => {
    process.env.HOME = origHome;
    rmSync(fakeHome, { recursive: true, force: true });
  });

  it("exits with error when pipeline references $project but --project not passed", async () => {
    // …existing body unchanged…
```

The three `it` bodies (`:8-34`, `:36-52`, `:54-70`) are unchanged. Only the `describe` head gains the four declarations.

- [x] **Step 4: Static check — TypeScript still compiles**

Run: `npx tsc --noEmit`

Expected: zero errors. (This is a pure test-file edit; production typing is unaffected.)

- [x] **Step 5: Run the targeted vitest file and confirm green**

Run: `npx vitest run src/cli/tests/pipeline-run-preflight.test.ts`

Expected: `Test Files  1 passed (1)` and `Tests  3 passed (3)`. If any test fails, the most likely cause is a typo in the inserted block — re-read Step 3 verbatim against the file.

- [x] **Step 6: Verify the leak is closed (post-fix empirical check)**

```bash
cp ~/.apparat/projects.json /tmp/after-chunk-1.json 2>/dev/null || echo "[]" > /tmp/after-chunk-1.json
diff /tmp/before-chunk-1.json /tmp/after-chunk-1.json
```

Expected: the post-fix file may differ from `before-chunk-1.json` only by the **single** `apparat-preflight-*` entry that the leaky run in Step 2 created (because we snapshotted *after* that run). Re-running the test now must not introduce any new entries:

```bash
cp ~/.apparat/projects.json /tmp/before-rerun.json
npx vitest run src/cli/tests/pipeline-run-preflight.test.ts
diff /tmp/before-rerun.json ~/.apparat/projects.json
```

Expected: **empty diff.** The fix is verified.

- [x] **Step 7: Commit**

```bash
git add src/cli/tests/pipeline-run-preflight.test.ts
git commit -m "$(cat <<'EOF'
test: isolate HOME in pipeline-run-preflight tests

Add describe-scoped beforeEach/afterEach that swaps process.env.HOME to
a fresh mkdtempSync home, mirroring projects-registry.test.ts. Stops
recordProject() from writing apparat-preflight-* paths to the
operator's real ~/.apparat/projects.json.

EOF
)"
```

## Verification targets

- Smokes: None
- Manual exercises: None
- Lint: `npx vitest run src/cli/tests/pipeline-run-preflight.test.ts`, `npx tsc --noEmit`
- Surfaces touched: tests (vitest setup only — no production code, no Ink components, no `program.ts`)

---

## Chunk 2: Fix `src/cli/tests/pipeline-preflight.test.ts`

This file leaks via **child processes**: `spawnSync("node", [CLI, "pipeline", "run", dot], …)` at `:33`, `:51`, `:68` inherit `process.env.HOME` from the parent vitest worker (Node's `child_process.spawnSync` defaults to `process.env` when no `env:` is supplied — verified by inspecting the call shape, no explicit `env` option is passed). Each child re-reads `process.env.HOME` on startup via `getApparatHome()` and writes to the parent's real `~/.apparat/projects.json`. Isolation must therefore happen at the parent level, scoped to the `describe` block, so the child inherits the patched value.

The second `describe("pipeline list shows requires:", …)` block at `:77-128` only spawns `pipeline list`, which does not call `recordProject`. It does not leak today; isolation is added defensively per design §9.1.

**Files:**

- Modify: `src/cli/tests/pipeline-preflight.test.ts:1-129`

### Task 2.1: Add describe-scoped HOME isolation to both blocks

- [x] **Step 1: Snapshot the registry baseline**

```bash
cp ~/.apparat/projects.json /tmp/before-chunk-2.json 2>/dev/null || echo "[]" > /tmp/before-chunk-2.json
grep -c "apparat-preflight-" /tmp/before-chunk-2.json || true
```

- [x] **Step 2: Reproduce the leak**

Build the CLI bundle (the test invokes `dist/cli/index.js` via `spawnSync`):

```bash
npm run build
```

Expected: `tsup` exits 0 and `dist/cli/index.js` exists.

Then run the test file as-is:

```bash
npx vitest run src/cli/tests/pipeline-preflight.test.ts
grep -c "apparat-preflight-" ~/.apparat/projects.json
```

Expected: tests pass; the count is **strictly greater** than baseline (typically baseline + at least 1, because the three `pipeline run` `spawnSync` calls each call into `recordProject` when `--project` is omitted but the bundled path coincidentally matches the temp dir layout — even one entry confirms the leak).

If the count is unchanged, the spawned child may have failed before reaching `recordProject`. Re-read `r.stdout`/`r.stderr` from the failing run; `recordProject` is invoked at `src/cli/commands/pipeline/run.ts:59` regardless of preflight outcome but only when `project` is bound — confirm whether the child's CLI parser auto-bound `--project=cwd`. Either way, applying the fix below is correct; the empirical check in Step 6 is the contract.

- [x] **Step 3: Apply isolation to the `pipeline run pre-flight check` block**

Edit `src/cli/tests/pipeline-preflight.test.ts`. Replace the imports block at `:1-5`:

```ts
import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { spawnSync } from "child_process";
import { writeFileSync, mkdtempSync, mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
```

Replace the `describe("pipeline run pre-flight check", () => {` opening (currently `:23`) with the block below — it adds the isolation triplet immediately inside the `describe`, before the first `it`:

```ts
describe("pipeline run pre-flight check", () => {
  let fakeHome: string;
  let origHome: string | undefined;

  beforeEach(() => {
    fakeHome = mkdtempSync(join(tmpdir(), "apparat-preflight-home-"));
    origHome = process.env.HOME;
    process.env.HOME = fakeHome;
  });

  afterEach(() => {
    process.env.HOME = origHome;
    rmSync(fakeHome, { recursive: true, force: true });
  });

  it("exits 1 when a declared input is not supplied", () => {
    // …existing body unchanged…
```

The three `it` bodies (`:24-40`, `:42-58`, `:60-74`) are unchanged. The `spawnSync` calls inside them inherit the patched `HOME` automatically because no `env:` option is supplied — verified by inspecting the call shape at `:33`: `spawnSync("node", [CLI, "pipeline", "run", dot], { encoding: "utf-8" })`.

- [x] **Step 4: Apply isolation to the `pipeline list shows requires:` block (defensive)**

Replace the `describe("pipeline list shows requires:", () => {` opening (currently `:77`) with:

```ts
describe("pipeline list shows requires:", () => {
  let fakeHome: string;
  let origHome: string | undefined;

  beforeEach(() => {
    fakeHome = mkdtempSync(join(tmpdir(), "apparat-list-home-"));
    origHome = process.env.HOME;
    process.env.HOME = fakeHome;
  });

  afterEach(() => {
    process.env.HOME = origHome;
    rmSync(fakeHome, { recursive: true, force: true });
  });

  it("prints 'requires:' for pipelines with inputs=, omits it for legacy pipelines", () => {
    // …existing body unchanged…
```

The single `it` body at `:78-127` is unchanged.

- [x] **Step 5: Static check**

Run: `npx tsc --noEmit`

Expected: zero errors.

- [x] **Step 6: Run the targeted vitest file and confirm green**

Run: `npx vitest run src/cli/tests/pipeline-preflight.test.ts`

Expected: `Test Files  1 passed (1)` and `Tests  4 passed (4)`.

- [x] **Step 7: Verify the leak is closed**

```bash
cp ~/.apparat/projects.json /tmp/before-rerun-chunk-2.json
npx vitest run src/cli/tests/pipeline-preflight.test.ts
diff /tmp/before-rerun-chunk-2.json ~/.apparat/projects.json
```

Expected: **empty diff.** No new `apparat-preflight-*` entries in the registry.

- [x] **Step 8: Commit**

```bash
git add src/cli/tests/pipeline-preflight.test.ts
git commit -m "$(cat <<'EOF'
test: isolate HOME in pipeline-preflight tests

Add describe-scoped beforeEach/afterEach to both blocks so spawnSync
children inherit a fake HOME via process.env. Stops the spawned `pipeline
run` and `pipeline list` CLIs from writing apparat-preflight-* and
apparat-list-* paths to the operator's real ~/.apparat/projects.json.

EOF
)"
```

## Verification targets

- Smokes: None
- Manual exercises: None
- Lint: `npx vitest run src/cli/tests/pipeline-preflight.test.ts`, `npx tsc --noEmit`
- Surfaces touched: tests (vitest setup + spawned child-process inheritance)

---

## Chunk 3: Fix `src/cli/tests/pipeline.test.ts`

The largest of the three. Six `describe` blocks total; per the design §9.1 (Option 1) every block that touches `pipelineRunCommand` or `pipelineListCommand` gains the HOME swap. Each block already has its own `beforeEach`/`afterEach` pair that does `vi.clearAllMocks()` and `mkdtempSync` for a per-block `dir`; we extend each pair with the HOME-swap triplet.

**Block-by-block leak audit (against the file as it stands now):**

| Block | Range | Existing setup | Calls `pipelineRunCommand(.., { project })`? | Leak today? | Treatment |
|---|---|---|---|---|---|
| `pipelineValidateCommand` | `:69-122` | `beforeEach :71-74`, `afterEach :75` | No (only `pipelineValidateCommand`) | No | Defensive — add HOME swap |
| `pipelineRunCommand` | `:124-222` | `beforeEach :126-129`, `afterEach :130` | Yes — `:135, :153, :163, :175, :191, :207` | **Yes** | Required — add HOME swap |
| `pipelineRunCommand — --resume resolution` | `:224-288` | `beforeEach :226-229`, `afterEach :230-232` | Yes — `:237, :243, :251, :255, :265, :278, :284` | **Yes** | Required — add HOME swap |
| `pipelineRunCommand — onInteractiveRequest` | `:290-333` | `beforeEach :292-295`, `afterEach :296` | Yes — `:301` | **Yes** | Required — add HOME swap |
| `pipelineListCommand` | `:335-402` | `beforeEach :337-340`, `afterEach :341` | No (only `pipelineListCommand`) | No | Defensive — add HOME swap |
| `pipelineValidateCommand — edge-label diff` | `:404-548` | `beforeEach :407-412`, `afterEach :413` | No (only `pipelineValidateCommand`) | No | Defensive — add HOME swap |

Six blocks, six identical extensions. The shape is the same in each: alongside the existing `let dir: string`, add `let fakeHome: string` and `let origHome: string | undefined`; in `beforeEach` prepend three lines that set up the fake home; in `afterEach` prepend two lines that restore and tear down. The `dir = mkdtempSync(…)` and `rmSync(dir, …)` lines stay exactly where they are.

**Files:**

- Modify: `src/cli/tests/pipeline.test.ts:1-548`

### Task 3.1: Extend imports

- [x] **Step 1: Snapshot the registry baseline**

```bash
cp ~/.apparat/projects.json /tmp/before-chunk-3.json 2>/dev/null || echo "[]" > /tmp/before-chunk-3.json
grep -c "apparat-pipeline-test-\|apparat-pipeline-resume-\|apparat-pipeline-diff-" /tmp/before-chunk-3.json || true
```

- [x] **Step 2: Reproduce the leak**

Run: `npx vitest run src/cli/tests/pipeline.test.ts`

Expected: tests pass. Then:

```bash
grep -c "apparat-pipeline-test-\|apparat-pipeline-resume-" ~/.apparat/projects.json
```

Expected: count is **strictly greater** than baseline. The three leaking blocks combined call `pipelineRunCommand(_, { project: dir })` 14 times across all `it` blocks; each invocation appends one entry on first sight (idempotent on repeat), so a single test-file run typically grows the registry by ~3 unique entries (one per fresh `mkdtempSync` `dir` that survives within an `it`). Any non-zero growth confirms the leak.

- [x] **Step 3: Add `rmSync` to the `fs` import (already present) — verify only**

The existing import at `:2` already has `mkdtempSync, rmSync, writeFileSync, mkdirSync` — no edit needed. Confirm by running:

```bash
head -3 src/cli/tests/pipeline.test.ts
```

Expected output (verbatim):

```
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
// (mkdirSync is also used by resume tests below to seed run directories)
```

If `rmSync` is missing, add it to the named-imports list before proceeding.

### Task 3.2: Extend each `describe` block with HOME isolation

Six blocks, identical pattern. Each step below names the block and gives the exact replacement.

- [x] **Step 1: Block 1 — `pipelineValidateCommand` (`:69-122`)**

Replace `:69-75` (the `describe` opening through the `afterEach`) with:

```ts
describe("pipelineValidateCommand", () => {
  let dir: string;
  let fakeHome: string;
  let origHome: string | undefined;
  beforeEach(() => {
    vi.clearAllMocks();
    fakeHome = mkdtempSync(join(tmpdir(), "apparat-validate-home-"));
    origHome = process.env.HOME;
    process.env.HOME = fakeHome;
    dir = mkdtempSync(join(tmpdir(), "apparat-pipeline-test-"));
  });
  afterEach(() => {
    process.env.HOME = origHome;
    rmSync(fakeHome, { recursive: true, force: true });
    rmSync(dir, { recursive: true });
  });
```

- [x] **Step 2: Block 2 — `pipelineRunCommand` (`:124-222`)**

Replace `:124-130` with:

```ts
describe("pipelineRunCommand", () => {
  let dir: string;
  let fakeHome: string;
  let origHome: string | undefined;
  beforeEach(() => {
    vi.clearAllMocks();
    fakeHome = mkdtempSync(join(tmpdir(), "apparat-run-home-"));
    origHome = process.env.HOME;
    process.env.HOME = fakeHome;
    dir = mkdtempSync(join(tmpdir(), "apparat-pipeline-test-"));
  });
  afterEach(() => {
    process.env.HOME = origHome;
    rmSync(fakeHome, { recursive: true, force: true });
    rmSync(dir, { recursive: true });
  });
```

- [x] **Step 3: Block 3 — `pipelineRunCommand — --resume resolution` (`:224-288`)**

Replace `:224-232` with:

```ts
describe("pipelineRunCommand — --resume resolution", () => {
  let dir: string;
  let fakeHome: string;
  let origHome: string | undefined;
  beforeEach(() => {
    vi.clearAllMocks();
    fakeHome = mkdtempSync(join(tmpdir(), "apparat-resume-home-"));
    origHome = process.env.HOME;
    process.env.HOME = fakeHome;
    dir = mkdtempSync(join(tmpdir(), "apparat-pipeline-resume-"));
  });
  afterEach(() => {
    process.env.HOME = origHome;
    rmSync(fakeHome, { recursive: true, force: true });
    rmSync(dir, { recursive: true });
  });
```

- [x] **Step 4: Block 4 — `pipelineRunCommand — onInteractiveRequest` (`:290-333`)**

Replace `:290-296` with:

```ts
describe("pipelineRunCommand — onInteractiveRequest", () => {
  let dir: string;
  let fakeHome: string;
  let origHome: string | undefined;
  beforeEach(() => {
    vi.clearAllMocks();
    fakeHome = mkdtempSync(join(tmpdir(), "apparat-oninteractive-home-"));
    origHome = process.env.HOME;
    process.env.HOME = fakeHome;
    dir = mkdtempSync(join(tmpdir(), "apparat-pipeline-test-"));
  });
  afterEach(() => {
    process.env.HOME = origHome;
    rmSync(fakeHome, { recursive: true, force: true });
    rmSync(dir, { recursive: true });
  });
```

- [x] **Step 5: Block 5 — `pipelineListCommand` (`:335-402`)**

Replace `:335-341` with:

```ts
describe("pipelineListCommand", () => {
  let dir: string;
  let fakeHome: string;
  let origHome: string | undefined;
  beforeEach(() => {
    vi.clearAllMocks();
    fakeHome = mkdtempSync(join(tmpdir(), "apparat-list-home-"));
    origHome = process.env.HOME;
    process.env.HOME = fakeHome;
    dir = mkdtempSync(join(tmpdir(), "apparat-pipeline-test-"));
  });
  afterEach(() => {
    process.env.HOME = origHome;
    rmSync(fakeHome, { recursive: true, force: true });
    rmSync(dir, { recursive: true });
  });
```

- [x] **Step 6: Block 6 — `pipelineValidateCommand — edge-label diff` (`:404-548`)**

This block declares `dotPath` alongside `dir`. Replace `:404-413` with:

```ts
describe("pipelineValidateCommand — edge-label diff", () => {
  let dir: string;
  let dotPath: string;
  let fakeHome: string;
  let origHome: string | undefined;
  beforeEach(() => {
    vi.clearAllMocks();
    fakeHome = mkdtempSync(join(tmpdir(), "apparat-diff-home-"));
    origHome = process.env.HOME;
    process.env.HOME = fakeHome;
    dir = mkdtempSync(join(tmpdir(), "apparat-pipeline-diff-"));
    dotPath = join(dir, "test.dot");
    writeFileSync(dotPath, VALID_DOT);
  });
  afterEach(() => {
    process.env.HOME = origHome;
    rmSync(fakeHome, { recursive: true, force: true });
    rmSync(dir, { recursive: true });
  });
```

### Task 3.3: Verify and commit

- [x] **Step 1: Static check**

Run: `npx tsc --noEmit`

Expected: zero errors. If TypeScript complains about `tmpdir is not defined`, re-check that the existing `import { tmpdir } from "os";` at `:4` survived the edits intact.

- [x] **Step 2: Run the targeted vitest file and confirm green**

Run: `npx vitest run src/cli/tests/pipeline.test.ts`

Expected: `Test Files  1 passed (1)` and `Tests  N passed (N)` where N matches the pre-edit count (the file currently has 26 `it` blocks across six `describe`s — 5 + 7 + 3 + 1 + 5 + 5; if you have not edited bodies, N must be 26). Re-record the count from the test output for the verification step.

- [x] **Step 3: Verify the leak is closed**

```bash
cp ~/.apparat/projects.json /tmp/before-rerun-chunk-3.json
npx vitest run src/cli/tests/pipeline.test.ts
diff /tmp/before-rerun-chunk-3.json ~/.apparat/projects.json
```

Expected: **empty diff.** No new `apparat-pipeline-*` entries.

- [x] **Step 4: Commit**

```bash
git add src/cli/tests/pipeline.test.ts
git commit -m "$(cat <<'EOF'
test: isolate HOME in pipeline.test.ts (six describe blocks)

Each describe block that touches CLI commands now swaps process.env.HOME
to a fresh mkdtempSync home in beforeEach and restores it in afterEach.
Mirrors projects-registry.test.ts. Stops pipelineRunCommand({ project })
calls (14 sites across three blocks) from writing apparat-pipeline-test-*
and apparat-pipeline-resume-* paths to the operator's real
~/.apparat/projects.json. Defensive symmetric isolation in the three
non-leaking blocks (validate / list / diff) closes the door for future
tests added inside those blocks.

EOF
)"
```

## Verification targets

- Smokes: None
- Manual exercises: None
- Lint: `npx vitest run src/cli/tests/pipeline.test.ts`, `npx tsc --noEmit`
- Surfaces touched: tests (vitest setup only)

---

## Chunk 4: Empirical full-suite leak verification

This chunk runs the contract from design §10.3 — full `npm test` invocation must not increase the registry's line count or introduce any entries matching the two leak patterns. If the empirical check fails, this chunk's investigation step routes the residual leak to one of the 6 sibling test files flagged in design §6 ("Residual leak surface").

**Files:** none modified — this chunk is verification only.

### Task 4.1: Full-suite empirical check

- [x] **Step 1: Snapshot the registry baseline**

```bash
cp ~/.apparat/projects.json /tmp/before-fullsuite.json 2>/dev/null || echo "[]" > /tmp/before-fullsuite.json
wc -l /tmp/before-fullsuite.json
grep -cE "apparat-pipeline-test-|apparat-preflight-|apparat-pipeline-resume-|apparat-pipeline-diff-|apparat-list-" /tmp/before-fullsuite.json || true
```

Record both numbers.

- [x] **Step 2: Build the CLI bundle (required by `pipeline-preflight.test.ts`'s `spawnSync`)**

```bash
npm run build
```

Expected: `tsup` exits 0 and `dist/cli/index.js` is up-to-date.

- [x] **Step 3: Run the full vitest suite**

```bash
npm test
```

(Equivalent: `npx vitest run`.) Expected: full suite passes. Record the test count from the summary line.

- [x] **Step 4: Compare registry state**

```bash
cp ~/.apparat/projects.json /tmp/after-fullsuite.json
wc -l /tmp/after-fullsuite.json
diff /tmp/before-fullsuite.json /tmp/after-fullsuite.json
```

Expected: the post-suite line count matches the baseline; `diff` is empty.

- [x] **Step 5: Grep for leak patterns**

```bash
grep -cE "apparat-pipeline-test-|apparat-preflight-|apparat-pipeline-resume-|apparat-pipeline-diff-" ~/.apparat/projects.json
```

Expected: **`0`** (or unchanged from the pre-fix baseline grep — the operator's registry was cleaned during the chat round, so the baseline is `0`). If the count is non-zero, proceed to Task 4.2.

### Task 4.2: Triage residual leaks (only if Step 5 above returns non-zero)

The 6 sibling files flagged by the upstream verifier are the most likely sources. Audit each in turn:

- [x] **Step 1: List candidate files**

The 6 files (per design §6):

```
src/cli/tests/implement.test.ts
src/cli/tests/meditate.test.ts
src/cli/tests/pipeline-failure-footer-scenario.test.ts
src/cli/tests/pipeline-failure-reason.test.ts
src/cli/tests/pipeline-headless.test.ts
src/cli/tests/runs-gc-per-pipeline.test.ts
```

Plus, noted during plan-writing: `src/cli/tests/pipeline-run-runid.test.ts` has describe blocks at `:36` and `:54` that call `pipelineRunCommand(_, { project })` without HOME isolation (the first describe at `:11` is correctly isolated via the inline-triplet pattern). Add this file to the audit list.

- [x] **Step 2: For each candidate, grep for `pipelineRunCommand` callers that pass `project`**

Run, per file:

```bash
grep -n "pipelineRunCommand" src/cli/tests/<file>
```

Inspect each match. A leak is present iff:

1. The call shape is `pipelineRunCommand(_, { …, project: <something>, … })` (any value bound to `project`).
2. The enclosing `describe` (or, less commonly, the enclosing `it`) does **not** swap `process.env.HOME` before the call.

If both conditions hold, the file leaks. Apply the same describe-scoped isolation pattern from Chunks 1–3 (it's identical — three lines into `beforeEach`, two into `afterEach`, plus `let fakeHome / let origHome` declarations).

- [x] **Step 3: Re-run the empirical check after each fix**

After each candidate is patched, redo Task 4.1 Steps 1–5. Stop when the grep returns `0`.

- [x] **Step 4: Commit each follow-up fix as its own commit**

```bash
git add src/cli/tests/<file>
git commit -m "$(cat <<'EOF'
test: isolate HOME in <file>

Follow-up to the three-file fix landed in Chunks 1–3 of the
projects-registry-stale-temp-dir-noise plan. Empirical check after the
initial fix showed residual <pattern> entries leaking; this commit
closes the source. Same describe-scoped beforeEach/afterEach swap
pattern as projects-registry.test.ts.

EOF
)"
```

### Task 4.3: Final verification

- [x] **Step 1: Confirm clean registry on a fresh run**

```bash
cp ~/.apparat/projects.json /tmp/before-final.json
npm test
diff /tmp/before-final.json ~/.apparat/projects.json
```

Expected: empty diff.

- [x] **Step 2: No commit needed if Task 4.2 was skipped.**

If Task 4.2 was skipped (no residual leaks), this chunk produces zero commits — the plan ships with three commits total (one per file), as designed.

## Verification targets

- Smokes: None
- Manual exercises: `npm test` followed by `diff /tmp/before-fullsuite.json ~/.apparat/projects.json` — empty diff is the contract that matters
- Lint: `npx tsc --noEmit`, `npm test`
- Surfaces touched: tests only (Task 4.2 may extend the surface if residual leaks force a follow-up fix; the same surface label still applies — vitest setup, no production code)

---

## Plan summary

Three chunks edit three test files; the fourth chunk is empirical verification with an explicit fall-through to triage residual leaks in 7 sibling test files (the 6 from design §6 plus `pipeline-run-runid.test.ts`'s un-isolated describe blocks at `:36` and `:54`). Each fix is a copy of the reference pattern at `src/cli/tests/projects-registry.test.ts:9-18` — same shape across all sites for legibility. Total: three commits expected (one per chunk 1–3); zero, one, or up to seven additional commits in chunk 4 depending on what the empirical check reveals. Zero production code edits, zero documentation edits.

## Chunk 4 outcome (executed)

Task 4.1 empirical run revealed residual leaks under prefixes the original grep didn't catch (`apparat-test-`, `apparat-gc-pp-`, `apparat-runid-`, `apparat-slug-runid-`, `apparat-failreason-`, `apparat-failure-footer-scenario-`). Five sibling files leaked; two (`implement.test.ts`, `meditate.test.ts`) were false positives — both `vi.mock`/`vi.spyOn` `pipelineRunCommand` so `recordProject` never fires. Fixes shipped:

- `0464c12` test(config): use forks pool in `vitest.config.ts` — vitest's default `threads` pool shares `process.env` across worker threads, so HOME swaps in one file leaked into concurrent files (root cause of `pipeline-app-integration.test.tsx` failures observed in full-suite at HEAD `a870037`). `pool: "forks"` isolates env per file.
- `2d71404` test: `delete process.env.HOME` when `origHome === undefined` in the three Chunks 1-3 files (avoids restoring to literal string `"undefined"`).
- `a5fedf1` `pipeline-headless.test.ts` — both describes (`apparat-test-`).
- `ec5f397` `pipeline-failure-reason.test.ts` (`apparat-failreason-`).
- `a63fe25` `pipeline-failure-footer-scenario.test.ts` (`apparat-failure-footer-scenario-`).
- `db034cb` `runs-gc-per-pipeline.test.ts` (`apparat-gc-pp-`).
- `6668bde` `pipeline-run-runid.test.ts` (`apparat-runid-`, `apparat-slug-runid-` in describes at `:36` and `:54`).

**Final state**: 1442/1442 pass, `diff` against pre-suite registry empty, leak-prefix grep returns 0.
