# Illuminations Status-Based Directory Split — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `meditations/illuminations/` so directory presence reflects lifecycle: `open`+`dispatched` stay; `archived` → `meditations/archived-illuminations/`; `implemented` → `meditations/implemented-illuminations/`. Both `markArchived` and `markImplemented` physically move the file when they flip frontmatter.

**Architecture:** Three flat sibling directories under `meditations/`. Source-of-truth = on-disk location, frontmatter `status` is redundant but kept for legibility. The MCP server's `listIlluminations` routes by status to the matching dir. New illuminations always start `open` in `meditations/illuminations/`.

**Tech Stack:** TypeScript + vitest for the MCP server and tests; node ESM script (`pipelines/scripts/mark-archived.mjs`) for pipeline use; one-shot ESM script for the backfill.

**Spec:** `specs/2026-04-27-illuminations-status-dirs-design.md`

**Supersedes:** `specs/2026-04-25-state-machine-exists-verifier-ignores-it-design.md`

---

## File Structure

| File | Action |
|---|---|
| `src/cli/mcp/illumination-server.ts` | Modify — `listIlluminations` (332–356), `markImplemented` (66–131), `markArchived` (196–265), tool description strings (~549, ~657, ~671) |
| `src/cli/tests/illumination-server.test.ts` | Modify — replace archive/ subdir tests, add new-layout tests |
| `src/cli/commands/meditate.ts:42` | Modify — `ensureMeditationDirs` creates 3 subdirs |
| `src/cli/commands/new.ts` | Modify — scaffold `meditations/` with 3 subdirs |
| `pipelines/scripts/mark-archived.mjs` | Modify — physically move file + git commit + emit `archive_path` |
| `pipelines/illumination-to-implementation.dot:10` | Modify — replace glob prompt with `list_illuminations(status: open)` |
| `src/cli/agents/verifier.md:44` | Modify — drop hardcoded path reconstruction |
| `src/cli/agents/memory-writer.md:122` | Modify — doc-comment update |
| `specs/mcp-illumination.md` | Modify — lines 29, 38, 86 + new return-shape rows |
| `scripts/migrate-illuminations-status-dirs.mjs` | Create (one-shot) — backfill 9 implemented + 25 archived + 3 superseded |
| `specs/2026-04-25-state-machine-exists-verifier-ignores-it-design.md` | Modify — supersede header |

---

## Chunk 1: Scaffolding + listIlluminations — ✅ DONE 2026-04-27

Three sibling dirs and the read-side MCP routing shipped. Subsequent chunks build on this.

| Task | Commit |
|---|---|
| 1.1 `ensureMeditationDirs` creates three subdirs | `6eea385` |
| 1.2 `ralph new` scaffolds three meditations subdirs | `816ca9d` |
| 1.3 `listIlluminations` routes by status to dir | `8f2bb97` |

---

## Chunk 2: markImplemented + markArchived (file moves)

The two MCP mutations that physically move the file. `markImplemented` is the larger change because today it doesn't move at all. `markArchived` is a target-dir swap.

### Task 2.1: `markArchived` swap target dir

**Files:**
- Modify: `src/cli/mcp/illumination-server.ts:196-265`
- Test: `src/cli/tests/illumination-server.test.ts:917-945` (and ~10 nearby tests with `archive/` path assertions)

- [x] **Step 1: Read all markArchived tests, list every assertion that hardcodes `archive/`**

```bash
grep -n "archive/" src/cli/tests/illumination-server.test.ts
```

Expected: hits at lines 930, 935, 939, ~1009, ~1027, ~1048, ~1051, ~1069. All inside `describe("markArchived"...)`.

- [x] **Step 2: Bulk-replace `"archive/"` → `"archived-illuminations/"` and `"meditations", "illuminations", "archive"` → `"meditations", "archived-illuminations"` inside the `markArchived` describe block**

Manual edit (do not global-replace — only inside that describe block):

In `src/cli/tests/illumination-server.test.ts`, every assertion of form:
```ts
expect(result.archive_path).toContain("archive/T2000-open.md");
```
becomes:
```ts
expect(result.archive_path).toContain("archived-illuminations/T2000-open.md");
```

And every:
```ts
existsSync(join(tmpDir, "meditations", "illuminations", "archive", "T2000-open.md"))
```
becomes:
```ts
existsSync(join(tmpDir, "meditations", "archived-illuminations", "T2000-open.md"))
```

Same for `readFileSync` calls in the same describe.

- [x] **Step 3: Run tests, verify failure**

Run: `npx vitest run src/cli/tests/illumination-server.test.ts -t "markArchived"`
Expected: most tests FAIL — implementation still writes to old `archive/` subdir.

- [x] **Step 4: Update `markArchived` implementation**

In `src/cli/mcp/illumination-server.ts:238-241`, replace:

```ts
  const archiveDir = join(illumDir, "archive");
  mkdirSync(archiveDir, { recursive: true });

  const archivePath = join(archiveDir, filename);
```

with:

```ts
  const archiveDir = join(projectRoot, "meditations", "archived-illuminations");
  mkdirSync(archiveDir, { recursive: true });

  const archivePath = join(archiveDir, filename);
```

Then update the return at line 263:

```ts
    archive_path: join("meditations", "archived-illuminations", filename),
```

- [x] **Step 5: Run tests, verify pass**

Run: `npx vitest run src/cli/tests/illumination-server.test.ts -t "markArchived"`
Expected: all PASS.

- [x] **Step 6: Commit** — shipped as `d5beda8`

```bash
git add src/cli/mcp/illumination-server.ts src/cli/tests/illumination-server.test.ts
git commit -m "feat(illumination-server): markArchived writes to meditations/archived-illuminations/"
```

**Reviewer follow-up:** `mark_archived` tool description string at `illumination-server.ts:702` still said `archive/ subdirectory`. Patched in commit `1bfbed7` (deferred from Task 2.3 since the description claim must match the now-shipped behavior).

---

### Task 2.2: `markImplemented` physically moves file + returns `new_path`

**Files:**
- Modify: `src/cli/mcp/illumination-server.ts:66-131`
- Test: `src/cli/tests/illumination-server.test.ts:617+` (the `markImplemented` describe block)

- [x] **Step 1a: Add three new failing tests asserting move + new_path + commit**

In the `markImplemented` describe block, append:

```ts
it("moves file from illuminations/ to implemented-illuminations/", () => {
  const illumDir = join(tmpDir, "meditations", "illuminations");
  mkdirSync(illumDir, { recursive: true });
  writeFileSync(
    join(illumDir, "T6000-impl.md"),
    "---\ndate: 2026-04-12\nstatus: open\ndescription: Will be implemented\n---\n\nBody"
  );

  const result = markImplemented(tmpDir, "T6000-impl.md");

  expect(result.success).toBe(true);
  // Original gone
  expect(existsSync(join(illumDir, "T6000-impl.md"))).toBe(false);
  // New location populated
  const newPath = join(tmpDir, "meditations", "implemented-illuminations", "T6000-impl.md");
  expect(existsSync(newPath)).toBe(true);
  // Frontmatter updated in new location
  const written = readFileSync(newPath, "utf-8");
  expect(written).toMatch(/status: implemented/);
  expect(written).toMatch(/implemented_at: \d{4}-\d{2}-\d{2}/);
});

it("returns new_path pointing to implemented-illuminations/", () => {
  const illumDir = join(tmpDir, "meditations", "illuminations");
  mkdirSync(illumDir, { recursive: true });
  writeFileSync(
    join(illumDir, "T6100-newpath.md"),
    "---\ndate: 2026-04-12\nstatus: dispatched\ndescription: Dispatched then done\n---\n\nBody"
  );
  const result = markImplemented(tmpDir, "T6100-newpath.md");
  expect(result.success).toBe(true);
  if (result.success) {
    expect(result.new_path).toBe("meditations/implemented-illuminations/T6100-newpath.md");
  }
});

it("auto-commits move with implement message", () => {
  const illumDir = join(tmpDir, "meditations", "illuminations");
  mkdirSync(illumDir, { recursive: true });
  writeFileSync(
    join(illumDir, "T6200-commit.md"),
    "---\ndate: 2026-04-12\nstatus: open\ndescription: Test commit\n---\n\nBody"
  );
  markImplemented(tmpDir, "T6200-commit.md");
  // mockExecSync was called with a commit-message arg
  const calls = mockExecSync.mock.calls.map((c) => String(c[0]));
  const commitCall = calls.find((c) => c.includes("commit -m"));
  expect(commitCall).toBeDefined();
  expect(commitCall).toContain("meditate: implement T6200-commit.md");
});
```

- [x] **Step 1b: Sweep pre-existing tests for stale "file stays" assertions**

```bash
grep -n 'existsSync(join(.*"meditations".*"illuminations".*' src/cli/tests/illumination-server.test.ts
```

For each hit inside the `describe("markImplemented"...)` block (roughly lines 634–733), update assertions of the form `existsSync(...) === true` (file stays in illuminations/) to `existsSync(...) === false` (file gone) plus a paired `existsSync(<implemented-illuminations path>) === true`.

- [x] **Step 2: Run tests, verify failures**

Run: `npx vitest run src/cli/tests/illumination-server.test.ts -t "markImplemented"`
Expected: 3 new tests FAIL plus any pre-existing "stays in place" tests now FAIL.

- [x] **Step 3: Update `markImplemented` implementation**

In `src/cli/mcp/illumination-server.ts:66-131`, replace the function body with:

```ts
export function markImplemented(
  projectRoot: string,
  filename: string,
): { success: true; filename: string; previous_status: string; new_status: string; new_path: string }
  | { success: false; error: string } {
  const fnErr = validateFilename(filename);
  if (fnErr) return { success: false, error: fnErr };

  const illumDir = join(projectRoot, "meditations", "illuminations");
  const filePath = join(illumDir, filename);

  if (!existsSync(filePath)) {
    return { success: false, error: "Illumination file not found" };
  }

  const raw = readFileSync(filePath, "utf-8");
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n/);
  if (!fmMatch) {
    return { success: false, error: "No frontmatter found in illumination file" };
  }

  const fmBlock = fmMatch[1];
  const body = raw.slice(fmMatch[0].length);

  const statusMatch = fmBlock.match(/^status:\s*(.+)$/m);
  const currentStatus = statusMatch ? statusMatch[1].trim() : "open";

  const allowed = ["open", "dispatched"];
  if (!allowed.includes(currentStatus)) {
    return {
      success: false,
      error: `Cannot mark as implemented: current status is ${currentStatus}`,
    };
  }

  const today = new Date().toISOString().slice(0, 10);
  let updatedFm = statusMatch
    ? fmBlock.replace(/^status:\s*.+$/m, "status: implemented")
    : fmBlock + "\nstatus: implemented";
  updatedFm += `\nimplemented_at: ${today}`;

  const targetDir = join(projectRoot, "meditations", "implemented-illuminations");
  mkdirSync(targetDir, { recursive: true });
  const targetPath = join(targetDir, filename);

  const updatedContent = `---\n${updatedFm}\n---\n${body}`;
  writeFileSync(targetPath, updatedContent);
  rmSync(filePath);

  try {
    execSync(`git -C "${projectRoot}" add "${filePath}"`, { stdio: "ignore" });
    execSync(`git -C "${projectRoot}" add "${targetPath}"`, { stdio: "ignore" });
    execSync(
      `git -C "${projectRoot}" commit -m "meditate: implement ${filename}"`,
      { stdio: "ignore" },
    );
  } catch {
    // git not available, not a git repo, or nothing to commit (idempotent re-run).
  }

  return {
    success: true,
    filename,
    previous_status: currentStatus,
    new_status: "implemented",
    new_path: join("meditations", "implemented-illuminations", filename),
  };
}
```

- [x] **Step 4: Run all markImplemented tests, verify pass**

Run: `npx vitest run src/cli/tests/illumination-server.test.ts -t "markImplemented"`
Expected: all PASS.

- [x] **Step 5: Commit** — shipped as `27b5bab`. 128 tests pass; tsc clean.

```bash
git add src/cli/mcp/illumination-server.ts src/cli/tests/illumination-server.test.ts
git commit -m "feat(illumination-server): markImplemented physically moves file"
```

---

### Task 2.3: Tool description strings

**Files:**
- Modify: `src/cli/mcp/illumination-server.ts:~549, ~657, ~671` (find by `server.tool(`)

- [x] **Step 1: Locate the three tool descriptions**

```bash
grep -n "server.tool" src/cli/mcp/illumination-server.ts
```

Expected: hits for `write_illumination`, `list_illuminations`, `mark_implemented`, `mark_dispatched`, `mark_archived`.

- [x] **Step 2: Update `write_illumination` description**

Find the description string mentioning `meditations/illuminations/`. Replace with one that explicitly notes the layout:

```ts
"Write a meditation illumination file to meditations/illuminations/. " +
"After mark_archived or mark_implemented is called, the file is moved to " +
"meditations/archived-illuminations/ or meditations/implemented-illuminations/ respectively."
```

- [x] **Step 3: Update `mark_implemented` description**

The current description: `"Mark an illumination as implemented. Valid from status open or dispatched."`. Replace with:

```ts
"Mark an illumination as implemented. Valid from status open or dispatched. " +
"The file is physically moved from meditations/illuminations/ to meditations/implemented-illuminations/. " +
"Returns new_path pointing to the new location."
```

- [x] **Step 4: Update `mark_archived` description analogously** — already shipped in commit `1bfbed7` as a Task 2.1 reviewer follow-up.

Mention the move target `meditations/archived-illuminations/` and that `archive_path` reflects the new location.

- [x] **Step 5: Run all illumination-server tests** — 128 pass.

Run: `npx vitest run src/cli/tests/illumination-server.test.ts`
Expected: all PASS (description strings shouldn't be tested by exact match; if they are, update the assertion).

- [x] **Step 6: Commit** — shipped as `71da769` (write_illumination + mark_implemented descriptions). mark_archived already in `1bfbed7`.

---

### Task 2.4: Update `specs/mcp-illumination.md`

**Files:**
- Modify: `specs/mcp-illumination.md` (lines 29, 38, 86 + return-shape tables)

- [x] **Step 1: Read the file to find the exact lines and context**

```bash
sed -n '25,50p;80,100p' specs/mcp-illumination.md
```

- [x] **Step 2: Update line ~29 (write_illumination path)**

Keep the path as-is (`meditations/illuminations/<filename>`) — `write_illumination` does NOT change. Add a note: *"After lifecycle transitions, files may be moved by `mark_implemented` or `mark_archived` to sibling dirs (see those tool sections)."*

- [x] **Step 3: Update line ~38 (list_illuminations reads-from)**

Replace the single-dir line with the routing table from the design spec §`listIlluminations`.

- [x] **Step 4: Update line ~86 (mark_implemented modifies-target)**

Replace the existing modifies-frontmatter-only description with:

```
- **Modifies** frontmatter `status` field to `implemented`, adds `implemented_at` key
- **Moves** file from `meditations/illuminations/<filename>` to `meditations/implemented-illuminations/<filename>`
- **Auto-commits** with message `meditate: implement <filename>`
- **Returns** `{ success, filename, previous_status, new_status, new_path }`
```

- [x] **Step 5: Add analogous update for `mark_archived` section**

Find the `mark_archived` section and add the move target + `archive_path` field reference, replacing any mention of `archive/` subdir.

- [x] **Step 6: Commit** — shipped as `8efc831`.

---

## Chunk 2 status: ✅ DONE 2026-04-27

| Task | Commit |
|---|---|
| 2.1 markArchived swap target dir | `d5beda8` (+ `1bfbed7` description) |
| 2.2 markImplemented physically moves file | `27b5bab` |
| 2.3 Tool description strings | `71da769` (+ `1bfbed7`) |
| 2.4 specs/mcp-illumination.md updates | `8efc831` |

128 illumination-server tests pass. `tsc --noEmit` clean. Pre-existing `server.tool` deprecation warnings on lines 565–732 are unrelated to this work.

---

## Chunk 3: Pipelines + agents + scripts

Pipeline-side parity with the MCP changes: the `mark-archived.mjs` script must also move and commit, and the verifier prompt in `illumination-to-implementation.dot` must stop globbing.

### Task 3.1: `mark-archived.mjs` physically moves file + commits + emits archive_path — ✅ DONE 2026-04-27

Shipped as `020cd39` (core change) + `1ac9f2f` (review follow-ups: pin re-archive-different-reason idempotency test + narrow `git add` scope to the two affected paths). 11/11 mark-archived tests + 1153/1153 full suite pass.

- [x] **Step 1: Find existing tests for the script**

```bash
ls pipelines/scripts/tests/ 2>/dev/null && grep -ln "mark-archived" pipelines/scripts/tests/
```

Expected: existing test file. If absent, create `pipelines/scripts/tests/mark-archived.test.mjs` based on the pattern of any other test under that dir.

- [x] **Step 2: Add failing test asserting move + commit + archive_path output**

```js
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("mark-archived.mjs (file move semantics)", () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ralph-mark-archived-"));
    mkdirSync(join(tmpDir, "meditations", "illuminations"), { recursive: true });
    execFileSync("git", ["-C", tmpDir, "init", "-b", "main"], { stdio: "ignore" });
    execFileSync("git", ["-C", tmpDir, "config", "user.email", "test@example.com"], { stdio: "ignore" });
    execFileSync("git", ["-C", tmpDir, "config", "user.name", "Test"], { stdio: "ignore" });
  });
  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

  it("moves the file to archived-illuminations/ and commits", () => {
    const illumPath = join(tmpDir, "meditations", "illuminations", "T7000-test.md");
    writeFileSync(illumPath, "---\ndate: 2026-04-12\nstatus: open\ndescription: Test\n---\n\nBody");
    execFileSync("git", ["-C", tmpDir, "add", "."], { stdio: "ignore" });
    execFileSync("git", ["-C", tmpDir, "commit", "-m", "seed"], { stdio: "ignore" });

    const out = execFileSync("node", [
      join(process.cwd(), "pipelines", "scripts", "mark-archived.mjs"),
      illumPath,
      "test reason",
    ], { encoding: "utf8", cwd: tmpDir });

    const result = JSON.parse(out);
    expect(result.archive_path).toBe(
      join("meditations", "archived-illuminations", "T7000-test.md")
    );
    expect(existsSync(illumPath)).toBe(false);
    expect(existsSync(join(tmpDir, "meditations", "archived-illuminations", "T7000-test.md"))).toBe(true);

    const log = execFileSync("git", ["-C", tmpDir, "log", "--oneline", "-1"], { encoding: "utf8" });
    expect(log).toContain("meditate: archive T7000-test.md");
  });
});
```

- [x] **Step 3: Run test, verify failure**

Run: `npx vitest run pipelines/scripts/tests/mark-archived.test.mjs`
Expected: FAIL — script doesn't move or commit.

- [x] **Step 4: Update `pipelines/scripts/mark-archived.mjs`**

Replace the entire current file body with the version below. Note: the script resolves `illuminationPath` to absolute up-front so all subsequent `dirname` calls and the `git -C` invocation work whether the pipeline passed a relative or absolute path.

```js
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const [illuminationArg, ...reasonArgs] = process.argv.slice(2);
if (!illuminationArg || reasonArgs.length === 0) {
  console.error("usage: mark-archived.mjs <illumination> <reason-or-reason-file>");
  process.exit(2);
}
const illuminationPath = path.resolve(illuminationArg);

const reasonArg = reasonArgs.join(" ");
let reason;
if (fs.existsSync(reasonArg) && fs.statSync(reasonArg).isFile()) {
  reason = fs.readFileSync(reasonArg, "utf8");
} else {
  reason = reasonArg;
}
reason = reason.replace(/\s+/g, " ").trim();

const filename = path.basename(illuminationPath);
const meditationsDir = path.dirname(path.dirname(illuminationPath));
const projectRoot = path.dirname(meditationsDir);
const targetDir = path.join(meditationsDir, "archived-illuminations");
const targetPath = path.join(targetDir, filename);

const today = new Date().toISOString().slice(0, 10);
const raw = fs.readFileSync(illuminationPath, "utf8");
const parts = raw.split("---\n");
if (parts.length < 3) {
  console.error("no frontmatter");
  process.exit(1);
}

const statusMatch = parts[1].match(/status:\s*(.+)\n/);
const status = statusMatch ? statusMatch[1].trim() : "";

if (status === "archived") {
  // Idempotent: already archived. File may already live in the new dir or still in the old.
  const archivePathRel = path.relative(
    projectRoot,
    fs.existsSync(targetPath) ? targetPath : illuminationPath,
  );
  console.log(JSON.stringify({
    marked_archived: illuminationPath,
    archive_path: archivePathRel,
    idempotent: true,
  }));
  process.exit(0);
}

if (status !== "open") {
  console.error(`status not open: ${status}`);
  process.exit(1);
}

const frontmatter =
  parts[1].replace(/status:\s*open\n/, "status: archived\n") +
  `archived_at: ${today}\n` +
  `reason: ${reason}\n`;
const updated = `---\n${frontmatter}---\n${parts.slice(2).join("---\n")}`;

fs.mkdirSync(targetDir, { recursive: true });
fs.writeFileSync(targetPath, updated);
fs.rmSync(illuminationPath);

try {
  execFileSync("git", ["-C", projectRoot, "add", "-A", "meditations"], { stdio: "ignore" });
  execFileSync("git", ["-C", projectRoot, "commit", "-m", `meditate: archive ${filename} (${reason})`], { stdio: "ignore" });
} catch {
  // git unavailable / nothing to commit — non-fatal.
}

const archivePathRel = path.relative(projectRoot, targetPath);
console.log(JSON.stringify({ marked_archived: illuminationPath, archive_path: archivePathRel }));
```

- [x] **Step 4b: Update existing idempotent test for new shape**

Beyond the planned shape change, the implementation also dropped the prior strict-equality check on idempotent reason: the original script returned exit 1 if already archived with a different reason; the new script silently re-archives (returns `archive_path` + `idempotent: true`). The corresponding "fails with exit 1 when already archived with a different reason" test was deleted; commit `1ac9f2f` adds a replacement test pinning the new no-op contract.

The pre-existing test at `pipelines/scripts/tests/mark-archived.test.mjs:127-138` asserts the idempotent JSON shape `{ marked_archived, idempotent: true }`. The new script adds `archive_path` to that shape, so the existing assertion at line 137 will fail. Update the assertion:

```ts
expect(parsed).toMatchObject({ marked_archived: target, idempotent: true });
expect(typeof parsed.archive_path).toBe("string");
```

(`toMatchObject` instead of `toEqual` lets the extra field through.)

- [x] **Step 5: Run test, verify pass** — 11/11 pass.

- [x] **Step 6: Commit** — shipped as `020cd39` + `1ac9f2f`.

---

### Task 3.2: Fix `illumination-to-implementation.dot:10` glob

**Files:**
- Modify: `pipelines/illumination-to-implementation.dot:10`

- [ ] **Step 1: Read the current verifier node**

```bash
sed -n '8,14p' pipelines/illumination-to-implementation.dot
```

Expected: a prompt mentioning `glob` and `$illuminations_dir/illuminations/*.md`.

- [ ] **Step 2: Replace the glob with `list_illuminations(status: open)`**

Find the `verifier` node at line 10. Replace its prompt verb. Specifically: change `"... Run glob on $illuminations_dir/illuminations/*.md ..."` (or whatever the current wording is) to mirror `pipelines/illumination-to-plan.dot:8`:

```
"Step 1: Call mcp__illumination__list_illuminations with status: open to get the list of open illuminations to consider..."
```

(Copy the exact prompt shape from `illumination-to-plan.dot:8` so the two pipelines stay symmetric.)

- [ ] **Step 3: Validate the pipeline**

Run: `node dist/cli/index.js pipeline validate pipelines/illumination-to-implementation.dot`
(Or `tsx src/cli/index.ts pipeline validate ...` in dev.)
Expected: no errors, no `portability_heuristic` warnings about the new prompt.

- [ ] **Step 4: Commit**

```bash
git add pipelines/illumination-to-implementation.dot
git commit -m "fix(pipeline): illumination-to-implementation verifier uses list_illuminations not glob"
```

---

### Task 3.3: Drop hardcoded path in `verifier.md:44`

**Files:**
- Modify: `src/cli/agents/verifier.md`

- [ ] **Step 1: Read line 44 and surrounding context**

```bash
sed -n '38,52p' src/cli/agents/verifier.md
```

- [ ] **Step 2: Replace any literal `meditations/illuminations/<filename>` reconstruction with consumption of the path from `list_illuminations`**

The fix: the verifier rubric should state that the full path is whatever `list_illuminations` returned, and the agent must read by that returned filename without prepending a hardcoded directory. Concretely, edit the rubric body so any phrase like "construct path as `meditations/illuminations/<filename>`" becomes "use the filename returned by `list_illuminations` and call `read_file` with just the filename — the MCP server resolves the directory."

If `list_illuminations` returns only filenames today (it does — see `parseIlluminationDescription`), the agent's `read_file` call must be path-relative and the MCP server's `read_file` must already resolve under the project root (it does — `assertWithinRoot` line 267). No code change in the MCP needed.

- [ ] **Step 3: Commit**

```bash
git add src/cli/agents/verifier.md
git commit -m "docs(verifier): drop hardcoded illumination path reconstruction"
```

---

### Task 3.4: Doc-comment update in `memory-writer.md:122`

**Files:**
- Modify: `src/cli/agents/memory-writer.md:~122`

- [ ] **Step 1: Read line 122 context**

```bash
sed -n '118,128p' src/cli/agents/memory-writer.md
```

- [ ] **Step 2: Update the comment to mention the post-move location**

Change wording like *"`mark_implemented` resolves file under `meditations/illuminations/`"* to *"`mark_implemented` reads from `meditations/illuminations/` and moves the file to `meditations/implemented-illuminations/` (returned as `new_path` in the response)."*

- [ ] **Step 3: Commit**

```bash
git add src/cli/agents/memory-writer.md
git commit -m "docs(memory-writer): note mark_implemented file move"
```

---

## Chunk 4: Backfill + cleanup

The one-shot migration script + the supersede tag on the prior spec.

### Task 4.1: Write `scripts/migrate-illuminations-status-dirs.mjs`

**Files:**
- Create: `scripts/migrate-illuminations-status-dirs.mjs`

- [ ] **Step 1: Create the directory if it does not exist**

```bash
mkdir -p scripts
```

- [ ] **Step 2: Write the migration script**

```js
#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const projectRoot = process.cwd();
const illumDir = path.join(projectRoot, "meditations", "illuminations");
const archivedDir = path.join(projectRoot, "meditations", "archived-illuminations");
const implementedDir = path.join(projectRoot, "meditations", "implemented-illuminations");

// Precondition: clean tree
const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim();
if (dirty) {
  console.error("Working tree must be clean. git status --porcelain output:");
  console.error(dirty);
  process.exit(1);
}

if (!fs.existsSync(illumDir)) {
  console.error(`No source dir at ${illumDir}; nothing to migrate.`);
  process.exit(0);
}

fs.mkdirSync(archivedDir, { recursive: true });
fs.mkdirSync(implementedDir, { recursive: true });

const files = fs.readdirSync(illumDir).filter((f) => f.endsWith(".md"));
let moved = { open: 0, dispatched: 0, implemented: 0, archived: 0, superseded: 0, other: 0 };

for (const filename of files) {
  const srcPath = path.join(illumDir, filename);
  const raw = fs.readFileSync(srcPath, "utf8");
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n/);
  if (!fmMatch) {
    // No frontmatter at all (rare — e.g. a hand-written review note). MCP `listIlluminations`
    // already treats this as `open`. Leave in place and count under `open`.
    moved.open++;
    continue;
  }
  const fmBlock = fmMatch[1];
  const statusMatch = fmBlock.match(/^status:\s*(.+)$/m);
  // Frontmatter present but no status line → treat as open (matches MCP behavior at illumination-server.ts:343).
  const status = statusMatch ? statusMatch[1].trim() : "open";

  if (status === "open" || status === "dispatched") {
    moved[status]++;
    continue;
  }

  if (status === "implemented") {
    execFileSync("git", ["mv", srcPath, path.join(implementedDir, filename)]);
    moved.implemented++;
    continue;
  }

  if (status === "archived") {
    execFileSync("git", ["mv", srcPath, path.join(archivedDir, filename)]);
    moved.archived++;
    continue;
  }

  if (status === "superseded") {
    // Re-stamp: status -> archived, copy superseded_by into archive_reason.
    const supersededByMatch = fmBlock.match(/^superseded_by:\s*(.+)$/m);
    const supersededBy = supersededByMatch ? supersededByMatch[1].trim() : "(unknown)";
    let newFm = fmBlock
      .replace(/^status:\s*.+$/m, "status: archived")
      .replace(/^superseded_by:.*\n?/m, "")
      .replace(/^superseded_at:.*\n?/m, "");
    const today = new Date().toISOString().slice(0, 10);
    newFm += `\narchived_at: ${today}\narchive_reason: superseded by ${supersededBy}`;
    const body = raw.slice(fmMatch[0].length);
    const updated = `---\n${newFm}\n---\n${body}`;
    fs.writeFileSync(srcPath, updated);
    // git mv stages the rename and picks up the on-disk content modification atomically.
    execFileSync("git", ["mv", srcPath, path.join(archivedDir, filename)]);
    moved.superseded++;
    continue;
  }

  console.error(`UNKNOWN status "${status}" in ${filename}; aborting.`);
  process.exit(1);
}

console.log("Migration summary:");
for (const [k, v] of Object.entries(moved)) console.log(`  ${k}: ${v}`);
console.log("\nReview with: git status && git diff --stat");
console.log("Commit with: git commit -m 'chore(meditations): split illuminations directory by status (backfill)'");
```

- [ ] **Step 3: Make it executable**

```bash
chmod +x scripts/migrate-illuminations-status-dirs.mjs
```

- [ ] **Step 4: Commit the script (without running)**

```bash
git add scripts/migrate-illuminations-status-dirs.mjs
git commit -m "chore(scripts): one-shot migration for illuminations status dirs"
```

---

### Task 4.2: Run migration, verify counts

- [ ] **Step 1: Confirm clean tree**

Run: `git status --porcelain`
Expected: empty.

- [ ] **Step 2: Pre-audit any no-status / no-frontmatter files**

Repo holds 90 illumination files. 89 have a `status:` frontmatter; 1 (`2026-04-26T2300-stimuli-refactor-risk-review.md`) has frontmatter without `status:`. The migration script treats both no-frontmatter and frontmatter-without-status as `open` (matches MCP `listIlluminations` behavior at `illumination-server.ts:343`). No manual intervention needed unless additional unknown-status files appear after this plan was written:

```bash
for f in meditations/illuminations/*.md; do
  head -10 "$f" | grep -E "^status:" > /dev/null || echo "NO_STATUS: $(basename "$f")"
done
```

Expected output: only `NO_STATUS: 2026-04-26T2300-stimuli-refactor-risk-review.md`. If anything else appears, decide whether to leave it as `open` (default behavior) or hand-edit a status before running migration.

- [ ] **Step 3: Run migration**

Run: `node scripts/migrate-illuminations-status-dirs.mjs`
Expected output ends with:
```
Migration summary:
  open: 48
  dispatched: 5
  implemented: 9
  archived: 25
  superseded: 3
  other: 0
```

(48 = 47 with frontmatter + 1 without status. Adjust if pre-audit found more.)

- [ ] **Step 4: Verify counts on disk**

Run:
```bash
ls meditations/illuminations | wc -l
ls meditations/archived-illuminations | wc -l
ls meditations/implemented-illuminations | wc -l
```
Expected: 53, 28, 9. (Total 90.)

- [ ] **Step 5: Verify no `superseded` remains**

Run: `grep -rl "^status: superseded" meditations/ 2>/dev/null`
Expected: empty.

- [ ] **Step 6: Commit the backfill**

```bash
git status
git commit -m "chore(meditations): split illuminations directory by status (backfill)"
```

---

### Task 4.3: Supersede the prior spec

**Files:**
- Modify: `specs/2026-04-25-state-machine-exists-verifier-ignores-it-design.md` (top of file)

- [ ] **Step 1: Add supersede header to the prior spec**

At the top of `specs/2026-04-25-state-machine-exists-verifier-ignores-it-design.md`, before any existing content, insert:

```markdown
> **SUPERSEDED 2026-04-27** by `specs/2026-04-27-illuminations-status-dirs-design.md`. The `archive/` subdir layout described below was never shipped; the new design uses top-level sibling dirs (`meditations/archived-illuminations/`, `meditations/implemented-illuminations/`) instead. Auto-commit and archive-readability fixes from this design are reaffirmed and shipped as part of the supersede.

---

```

- [ ] **Step 2: Commit**

```bash
git add specs/2026-04-25-state-machine-exists-verifier-ignores-it-design.md
git commit -m "docs(specs): mark archive-subdir spec superseded by status-dirs design"
```

---

### Task 4.4: Full-suite + smoke verification

- [ ] **Step 1: Run full unit/integration test suite**

Run: `npm test`
Expected: all PASS. If any test fails, the most likely cause is a leftover `archive/` substring in a test fixture; grep the test files and fix.

- [ ] **Step 2: Run the two smoke pipelines that exercise illuminations**

The illumination-touching smokes are `pipelines/smoke/meditate-steer.dot` and `pipelines/smoke/tmux-tester.dot`. Run each via `ralph pipeline run` with the appropriate `--var` flags (mirror existing CI/scenario invocations).

Expected: both PASS end-to-end. `meditate-steer.dot` exercises `write_illumination`; `tmux-tester.dot` reads from `meditations/illuminations/` for newest-by-mtime — both should still pass since open illuminations stay in the main dir.

- [ ] **Step 3: Verify on-disk layout post-smoke**

After smoke runs, confirm any newly-archived or newly-implemented illumination ended up in the right sibling dir, not in `meditations/illuminations/`.

- [ ] **Step 4: Final commit / PR ready**

If any fixups happened in step 1 or 2, commit them now. Otherwise, the branch is ready for review.

---

### Task 4.5: Delete the migration script

The script is one-shot. After the migration commit lands on `main`, delete it.

- [ ] **Step 1: Delete file**

```bash
git rm scripts/migrate-illuminations-status-dirs.mjs
```

- [ ] **Step 2: Commit**

```bash
git commit -m "chore: remove one-shot migration script (backfill complete)"
```

---

## Verification Matrix (post-implementation)

| Check | Command | Expected |
|---|---|---|
| Layout on disk | `ls meditations/` | `archived-illuminations  illuminations  implemented-illuminations  stimuli` |
| Active queue size | `ls meditations/illuminations \| wc -l` | 52 |
| Archived count | `ls meditations/archived-illuminations \| wc -l` | 28 |
| Implemented count | `ls meditations/implemented-illuminations \| wc -l` | 9 |
| No `superseded` left | `grep -rl "^status: superseded" meditations/` | empty |
| Tests | `npm test` | all PASS |
| `list_illuminations(status="archived")` | run via MCP | returns 28 |
| `list_illuminations(status="implemented")` | run via MCP | returns 9 |
| `list_illuminations()` no filter | run via MCP | returns 89 (union) |
| `markImplemented` on a fixture | unit test | file in implemented-illuminations/, gone from illuminations/, response has `new_path` |
| `markArchived` on a fixture | unit test | file in archived-illuminations/, response `archive_path` matches |
| `mark-archived.mjs` on a fixture | scripts test | file moved + git commit landed |

## Rollback

If any post-merge step is wrong:

1. `git revert <merge-commit>` — single-commit migration is reversible.
2. Re-run the test suite to confirm the rollback restored prior behavior.

The MCP code changes and the backfill move are in separate commits; a partial revert (just the backfill) is also possible if only the file moves are wrong.
