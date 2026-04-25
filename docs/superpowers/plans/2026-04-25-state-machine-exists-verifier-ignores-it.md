---
status: pending
---

# State Machine Exists, Verifier Ignores It Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close three lifecycle-integrity gaps in the illumination state machine so dispatched items are never re-processed, every state transition is committed to git, and `list_illuminations(status="archived")` actually returns archived items.

**Architecture:** Three localized changes — one prompt-string edit in `pipelines/illumination-to-plan.dot`, three identical `try/catch` git-commit blocks appended to mark-* functions in `src/cli/mcp/illumination-server.ts`, and a one-line directory branch in `listIlluminations`. No new modules, no new MCP tools, no engine changes. Every change is grounded in the design doc at `specs/2026-04-25-state-machine-exists-verifier-ignores-it-design.md`.

**Tech Stack:** TypeScript, Node.js `child_process.execSync`, vitest with `vi.mock("node:child_process")` (test file already mocks execSync — auto-commit assertions go through the mock, matching the existing `writeIllumination auto-commit` precedent at `src/cli/tests/illumination-server.test.ts:111-147`).

**Source spec:** `specs/2026-04-25-state-machine-exists-verifier-ignores-it-design.md` (Approved 2026-04-25).

---

## File Structure

| File | Disposition | Responsibility |
|------|-------------|----------------|
| `pipelines/illumination-to-plan.dot` | Modify (line 8) | Verifier reads only `status: open` instead of glob |
| `src/cli/mcp/illumination-server.ts` | Modify (3 funcs + listIlluminations) | Commit on each state transition; route `archived` reads to `archive/` |
| `src/cli/tests/illumination-server.test.ts` | Modify (append) | Mock-based regression tests for the three changes |
| `src/cli/tests/illumination-to-plan-pipeline.test.ts` | Create | Pin the verifier-prompt step-1 wording |

No file in this plan is at risk of growing unwieldy. `illumination-server.ts` currently sits ~554 lines; this plan adds ~20 lines net. The test file grows by ~150 lines but is already partitioned by `describe` block and remains comfortably scannable.

**TDD precedent — read this before writing any test:** The test file at `src/cli/tests/illumination-server.test.ts:6-12` hoists `mockExecSync` and replaces `node:child_process` with a vi mock for the entire suite. All git-commit assertions in this plan therefore observe `mockExecSync.mock.calls` — not real git. This matches the existing `writeIllumination auto-commit` block at lines 111-147. Do not attempt `git init` in temp dirs or assert `git status --porcelain` — the mock makes that meaningless.

---

## Chunk 1: Verifier reads `list_illuminations(status: open)` instead of glob

**Goal:** Replace step 1 of the verifier prompt in `pipelines/illumination-to-plan.dot` so the read side honors the state machine's filter.

**Files:**
- Create: `src/cli/tests/illumination-to-plan-pipeline.test.ts`
- Modify: `pipelines/illumination-to-plan.dot` (line 8, inside the `verifier` node's `prompt=` attribute)

### Task 1.1: Pin the verifier prompt step-1 wording with a regression test

**Files:**
- Create: `src/cli/tests/illumination-to-plan-pipeline.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/cli/tests/illumination-to-plan-pipeline.test.ts` with this exact content:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const PIPELINE_PATH = join(
  process.cwd(),
  "pipelines",
  "illumination-to-plan.dot",
);

describe("illumination-to-plan.dot — verifier prompt", () => {
  it("step 1 calls mcp__illumination__list_illuminations with status: open", () => {
    const dot = readFileSync(PIPELINE_PATH, "utf-8");
    expect(dot).toContain(
      "1. Call mcp__illumination__list_illuminations with status: open",
    );
  });

  it("step 1 does NOT use a raw glob over illumination filenames", () => {
    const dot = readFileSync(PIPELINE_PATH, "utf-8");
    expect(dot).not.toContain(
      "Run glob on $meditations_dir/illuminations/*.md",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/cli/tests/illumination-to-plan-pipeline.test.ts`

Expected: 2 failed — first test fails because the new string is not yet in the .dot file; second test fails because the old glob string is still there.

### Task 1.2: Edit the verifier prompt step 1

**Files:**
- Modify: `pipelines/illumination-to-plan.dot:8`

- [ ] **Step 3: Apply the prompt edit**

In `pipelines/illumination-to-plan.dot`, line 8, locate the substring:

```
1. Run glob on $meditations_dir/illuminations/*.md to list all illumination files.
```

Replace it with:

```
1. Call mcp__illumination__list_illuminations with status: open to get the list of unprocessed illuminations.
```

Do not change any other character on line 8. The surrounding `prompt="..."` attribute, the `\n2.` separator, and step 2's `If no files exist, return preferred_label: empty, ...` clause stay byte-identical — step 2 already handles the `No illuminations found.` literal that `list_illuminations` returns when empty.

After the edit, `pipelines/illumination-to-plan.dot` line 8 (still one logical line) reads:

```
  verifier [agent="verifier", json_schema_file="schemas/verifier.json", produces="preferred_label, illumination_path, summary, explanation", prompt="You are a verification agent for the ralph-cli project.\n\n## Task\n\n1. Call mcp__illumination__list_illuminations with status: open to get the list of unprocessed illuminations.\n2. If no files exist, return preferred_label: empty, illumination_path: empty, summary: No illuminations found, explanation: The illuminations directory is empty.\n3. Pick ONE illumination to verify. Read it carefully.\n4. Spawn subagents (up to 50) to verify the illumination against the current codebase:\n   - Check src/ to verify technical claims about code behavior\n   - Check specs/*.md to verify claims about specifications\n   - Verify the issue described has NOT already been fixed\n5. Return your structured verdict.\n\n## Verification Criteria\n- Still relevant: the issue or gap described in the illumination exists in the current code\n- Technically accurate: the claims about code behavior match what the source code actually does\n- Both must be true for preferred_label: true\n\n## Rules\n- Do NOT modify any project files\n- Read only — no edits, no deletions, no new files"]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/cli/tests/illumination-to-plan-pipeline.test.ts`

Expected: 2 passed.

- [ ] **Step 5: Run pipeline validators to confirm the .dot still parses**

Run: `npm test -- --run pipeline`

Expected: All pipeline-related tests pass. (The verifier's `produces=` and edge list are untouched, so validator + DOT-parser tests should continue to pass.)

- [ ] **Step 6: Commit**

```bash
git add pipelines/illumination-to-plan.dot src/cli/tests/illumination-to-plan-pipeline.test.ts
git commit -m "fix(verifier): read list_illuminations(status: open) instead of raw glob

Verifier was re-selecting dispatched illuminations because step 1 of its
prompt globbed all *.md filenames. Switching to the MCP tool's status
filter makes the state machine's gate actually gate.

Spec: specs/2026-04-25-state-machine-exists-verifier-ignores-it-design.md"
```

---

## Chunk 2: Auto-commit every mark-* state transition

**Goal:** Append the existing `writeIllumination` git-commit pattern (`illumination-server.ts:33-42`) to `markImplemented`, `markDispatched`, and `markArchived` so each transition lands in history. `markArchived` stages two paths (deleted source, new archive) before committing so the rename is one commit.

**Files:**
- Modify: `src/cli/mcp/illumination-server.ts:46-101` (markImplemented)
- Modify: `src/cli/mcp/illumination-server.ts:103-154` (markDispatched)
- Modify: `src/cli/mcp/illumination-server.ts:156-214` (markArchived)
- Modify: `src/cli/tests/illumination-server.test.ts` (append three describe blocks)

### Task 2.1: Failing test — `markImplemented` calls git add + commit

**Files:**
- Modify: `src/cli/tests/illumination-server.test.ts`

- [ ] **Step 1: Write the failing test**

In `src/cli/tests/illumination-server.test.ts`, locate the existing `describe("markImplemented", ...)` block (starts around line 500). At the very end of that describe block (immediately before its closing `});`), append the following test:

```ts
  it("auto-commits the file after writing (git add then git commit)", () => {
    mockExecSync.mockClear();
    writeIlluminationFile("commit-impl.md", "status: dispatched", "# Body");
    const result = markImplemented(tmpDir, "commit-impl.md");
    expect(result.success).toBe(true);
    expect(mockExecSync).toHaveBeenCalledTimes(2);
    const addCall = mockExecSync.mock.calls[0][0] as string;
    const commitCall = mockExecSync.mock.calls[1][0] as string;
    expect(addCall).toContain("git -C");
    expect(addCall).toContain(tmpDir);
    expect(addCall).toContain("add");
    expect(addCall).toContain("commit-impl.md");
    expect(commitCall).toContain("git -C");
    expect(commitCall).toContain("commit");
    expect(commitCall).toContain("meditate: mark commit-impl.md implemented");
  });

  it("returns success even when git commands fail (fail-open)", () => {
    mockExecSync.mockClear();
    mockExecSync.mockImplementation(() => {
      throw new Error("git not found");
    });
    writeIlluminationFile("fail-open-impl.md", "status: open", "# Body");
    const result = markImplemented(tmpDir, "fail-open-impl.md");
    expect(result.success).toBe(true);
  });
```

`mockExecSync` is the suite-level hoisted mock from lines 6-12 of the test file — it is in scope here because `vi.mock("node:child_process", ...)` applies to the whole module. `writeIlluminationFile` is the helper already defined inside the `markImplemented` describe block at lines 512-515.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/cli/tests/illumination-server.test.ts -t "auto-commits the file after writing"`

Expected: 1 failed — `mockExecSync` was called 0 times because `markImplemented` does not yet invoke `execSync`.

### Task 2.2: Implement auto-commit in `markImplemented`

**Files:**
- Modify: `src/cli/mcp/illumination-server.ts:93`

- [ ] **Step 3: Apply the implementation**

In `src/cli/mcp/illumination-server.ts`, after line 93 (`writeFileSync(filePath, updatedContent);`) and before the `return { success: true, ... }` block (line 95), insert the following four lines (matching the shape at lines 33-42):

```ts
  try {
    execSync(`git -C "${projectRoot}" add "${filePath}"`, { stdio: "ignore" });
    execSync(
      `git -C "${projectRoot}" commit -m "meditate: mark ${filename} implemented"`,
      { stdio: "ignore" },
    );
  } catch {
    // git not available, not a git repo, or nothing to commit (idempotent re-run).
  }
```

The function body now reads (lines 92-101 after the edit):

```ts
  const updatedContent = `---\n${updatedFm}\n---\n${body}`;
  writeFileSync(filePath, updatedContent);

  try {
    execSync(`git -C "${projectRoot}" add "${filePath}"`, { stdio: "ignore" });
    execSync(
      `git -C "${projectRoot}" commit -m "meditate: mark ${filename} implemented"`,
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
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/cli/tests/illumination-server.test.ts -t "markImplemented"`

Expected: All `markImplemented` tests pass (existing 7 + new 2 = 9 passing).

- [ ] **Step 5: Commit**

```bash
git add src/cli/mcp/illumination-server.ts src/cli/tests/illumination-server.test.ts
git commit -m "feat(mcp): auto-commit on markImplemented

Mirrors writeIllumination's commit pattern. Lifecycle transition now
lands in git history instead of leaving a dirty tree."
```

### Task 2.3: Failing test — `markDispatched` calls git add + commit

**Files:**
- Modify: `src/cli/tests/illumination-server.test.ts`

- [ ] **Step 6: Write the failing test**

Locate the existing `describe("markDispatched", ...)` block (starts around line 592). At the very end of that describe block (immediately before its closing `});`), append:

```ts
  it("auto-commits the file after writing (git add then git commit)", () => {
    mockExecSync.mockClear();
    writeIlluminationFile(
      "T1900-commit-dispatch.md",
      "date: 2026-04-12\nstatus: open\ndescription: Commit test",
      "Body."
    );
    const result = markDispatched(tmpDir, "T1900-commit-dispatch.md", "docs/superpowers/plans/foo.md");
    expect(result.success).toBe(true);
    expect(mockExecSync).toHaveBeenCalledTimes(2);
    const addCall = mockExecSync.mock.calls[0][0] as string;
    const commitCall = mockExecSync.mock.calls[1][0] as string;
    expect(addCall).toContain("git -C");
    expect(addCall).toContain(tmpDir);
    expect(addCall).toContain("add");
    expect(addCall).toContain("T1900-commit-dispatch.md");
    expect(commitCall).toContain("commit");
    expect(commitCall).toContain("meditate: mark T1900-commit-dispatch.md dispatched");
  });

  it("returns success even when git commands fail (fail-open)", () => {
    mockExecSync.mockClear();
    mockExecSync.mockImplementation(() => {
      throw new Error("git not found");
    });
    writeIlluminationFile(
      "T1950-fail-open.md",
      "date: 2026-04-12\nstatus: open\ndescription: Fail-open test",
      "Body."
    );
    const result = markDispatched(tmpDir, "T1950-fail-open.md", "some/plan.md");
    expect(result.success).toBe(true);
  });
```

- [ ] **Step 7: Run test to verify it fails**

Run: `npx vitest run src/cli/tests/illumination-server.test.ts -t "markDispatched"`

Expected: 2 new tests fail — `mockExecSync` was not called.

### Task 2.4: Implement auto-commit in `markDispatched`

**Files:**
- Modify: `src/cli/mcp/illumination-server.ts:146`

- [ ] **Step 8: Apply the implementation**

In `src/cli/mcp/illumination-server.ts`, after line 146 (`writeFileSync(filePath, updatedContent);` inside `markDispatched`) and before the `return { success: true, ... }` block, insert:

```ts
  try {
    execSync(`git -C "${projectRoot}" add "${filePath}"`, { stdio: "ignore" });
    execSync(
      `git -C "${projectRoot}" commit -m "meditate: mark ${filename} dispatched"`,
      { stdio: "ignore" },
    );
  } catch {
    // git not available, not a git repo, or nothing to commit (idempotent re-run).
  }
```

- [ ] **Step 9: Run test to verify it passes**

Run: `npx vitest run src/cli/tests/illumination-server.test.ts -t "markDispatched"`

Expected: All `markDispatched` tests pass (existing 7 + new 2 = 9 passing).

- [ ] **Step 10: Commit**

```bash
git add src/cli/mcp/illumination-server.ts src/cli/tests/illumination-server.test.ts
git commit -m "feat(mcp): auto-commit on markDispatched

Same shape as markImplemented commit; commit message uses the
'meditate: mark <file> dispatched' form."
```

### Task 2.5: Failing test — `markArchived` stages two paths and commits once

**Files:**
- Modify: `src/cli/tests/illumination-server.test.ts`

- [ ] **Step 11: Write the failing test**

Locate the existing `describe("markArchived", ...)` block (starts around line 722). At the very end of that describe block (immediately before its closing `});`), append:

```ts
  it("auto-commits the rename as one commit (add deleted path, add new path, commit)", () => {
    mockExecSync.mockClear();
    writeIlluminationFile(
      "T2600-commit-archive.md",
      "date: 2026-04-12\nstatus: open\ndescription: Archive commit test",
      "Body."
    );
    const result = markArchived(tmpDir, "T2600-commit-archive.md", "Stale");
    expect(result.success).toBe(true);
    // Three execSync calls: add original (now deleted), add archive path, commit.
    expect(mockExecSync).toHaveBeenCalledTimes(3);
    const calls = mockExecSync.mock.calls.map((c) => c[0] as string);
    expect(calls[0]).toContain("git -C");
    expect(calls[0]).toContain("add");
    expect(calls[0]).toContain("T2600-commit-archive.md");
    expect(calls[0]).not.toContain("archive/T2600-commit-archive.md");
    expect(calls[1]).toContain("git -C");
    expect(calls[1]).toContain("add");
    expect(calls[1]).toContain("archive/T2600-commit-archive.md");
    expect(calls[2]).toContain("commit");
    expect(calls[2]).toContain("meditate: archive T2600-commit-archive.md");
  });

  it("returns success even when git commands fail (fail-open)", () => {
    mockExecSync.mockClear();
    mockExecSync.mockImplementation(() => {
      throw new Error("git not found");
    });
    writeIlluminationFile(
      "T2700-archive-fail-open.md",
      "date: 2026-04-12\nstatus: open\ndescription: Fail-open archive",
      "Body."
    );
    const result = markArchived(tmpDir, "T2700-archive-fail-open.md", "Reason");
    expect(result.success).toBe(true);
    // File still moved to archive even when git fails
    expect(existsSync(join(tmpDir, "meditations", "illuminations", "archive", "T2700-archive-fail-open.md"))).toBe(true);
  });
```

- [ ] **Step 12: Run test to verify it fails**

Run: `npx vitest run src/cli/tests/illumination-server.test.ts -t "markArchived"`

Expected: 2 new tests fail — `mockExecSync` was not called by `markArchived`.

### Task 2.6: Implement auto-commit in `markArchived`

**Files:**
- Modify: `src/cli/mcp/illumination-server.ts:205`

- [ ] **Step 13: Apply the implementation**

In `src/cli/mcp/illumination-server.ts`, after line 205 (`rmSync(filePath);` inside `markArchived`) and before the `return { success: true, ... }` block, insert:

```ts
  try {
    execSync(`git -C "${projectRoot}" add "${filePath}"`, { stdio: "ignore" });
    execSync(`git -C "${projectRoot}" add "${archivePath}"`, { stdio: "ignore" });
    execSync(
      `git -C "${projectRoot}" commit -m "meditate: archive ${filename}"`,
      { stdio: "ignore" },
    );
  } catch {
    // git not available, not a git repo, or nothing to commit (idempotent re-run).
  }
```

The first `git add` of a now-deleted path stages the deletion; the second `git add` stages the new archive file; the commit captures the rename atomically. Order matters — staging both paths before the commit avoids a transient delete-only commit.

- [ ] **Step 14: Run test to verify it passes**

Run: `npx vitest run src/cli/tests/illumination-server.test.ts -t "markArchived"`

Expected: All `markArchived` tests pass (existing 7 + new 2 = 9 passing).

- [ ] **Step 15: Run the full test file to check for regressions**

Run: `npx vitest run src/cli/tests/illumination-server.test.ts`

Expected: All tests pass — pre-existing `writeIllumination auto-commit` tests at lines 111-147 must continue to pass (they share the mock and could be affected by stale state from new tests; each new test calls `mockExecSync.mockClear()` to prevent cross-contamination).

- [ ] **Step 16: Commit**

```bash
git add src/cli/mcp/illumination-server.ts src/cli/tests/illumination-server.test.ts
git commit -m "feat(mcp): auto-commit on markArchived (rename as one commit)

Stages both the deleted source path and the new archive path before
committing so the rename appears as a single 'meditate: archive <file>'
commit. Avoids a transient delete-only state in history."
```

---

## Chunk 3: `listIlluminations` reads `archive/` when `status="archived"`

**Goal:** Route `listIlluminations(projectRoot, "archived")` to read from `meditations/illuminations/archive/`. All other status values (and the unfiltered call) keep reading the top-level directory unchanged.

**Files:**
- Modify: `src/cli/mcp/illumination-server.ts:281-304` (listIlluminations body)
- Modify: `src/cli/tests/illumination-server.test.ts` (append to existing `describe("listIlluminations", ...)` block)

### Task 3.1: Failing tests — archive listing

**Files:**
- Modify: `src/cli/tests/illumination-server.test.ts`

- [ ] **Step 1: Write the failing tests**

Locate the existing `describe("listIlluminations", ...)` block (starts around line 409). At the very end of that describe block (immediately before its closing `});`), append:

```ts
  it("reads from archive/ when status is archived", () => {
    const archiveDir = join(tmpDir, "meditations", "illuminations", "archive");
    mkdirSync(archiveDir, { recursive: true });
    writeFileSync(
      join(archiveDir, "T3000-archived.md"),
      "---\ndate: 2026-04-12\nstatus: archived\ndescription: Archived insight\n---\n\nBody"
    );
    // Top-level dir intentionally has a non-archived file that should NOT show up
    const topDir = join(tmpDir, "meditations", "illuminations");
    writeFileSync(
      join(topDir, "T3001-open.md"),
      "---\ndate: 2026-04-12\nstatus: open\ndescription: Open one\n---\n\nBody"
    );
    const result = listIlluminations(tmpDir, "archived");
    expect(result).toContain("T3000-archived.md");
    expect(result).toContain("Archived insight");
    expect(result).not.toContain("T3001-open.md");
  });

  it("returns no-illuminations message when archive/ does not exist", () => {
    // Top-level exists, but archive/ subdir does not
    mkdirSync(join(tmpDir, "meditations", "illuminations"), { recursive: true });
    const result = listIlluminations(tmpDir, "archived");
    expect(result).toBe("No illuminations found.");
  });

  it("returns no-illuminations message when archive/ exists but is empty", () => {
    mkdirSync(join(tmpDir, "meditations", "illuminations", "archive"), { recursive: true });
    const result = listIlluminations(tmpDir, "archived");
    expect(result).toBe("No illuminations found.");
  });

  it("status=open continues to read top-level dir, ignoring archive/", () => {
    const archiveDir = join(tmpDir, "meditations", "illuminations", "archive");
    mkdirSync(archiveDir, { recursive: true });
    writeFileSync(
      join(archiveDir, "T3100-archived.md"),
      "---\ndate: 2026-04-12\nstatus: archived\ndescription: Archived\n---\n\nBody"
    );
    const topDir = join(tmpDir, "meditations", "illuminations");
    writeFileSync(
      join(topDir, "T3101-open.md"),
      "---\ndate: 2026-04-12\nstatus: open\ndescription: Open\n---\n\nBody"
    );
    const result = listIlluminations(tmpDir, "open");
    expect(result).toContain("T3101-open.md");
    expect(result).not.toContain("T3100-archived.md");
  });

  it("status omitted continues to read top-level dir, ignoring archive/", () => {
    const archiveDir = join(tmpDir, "meditations", "illuminations", "archive");
    mkdirSync(archiveDir, { recursive: true });
    writeFileSync(
      join(archiveDir, "T3200-archived.md"),
      "---\ndate: 2026-04-12\nstatus: archived\ndescription: Archived\n---\n\nBody"
    );
    const topDir = join(tmpDir, "meditations", "illuminations");
    writeFileSync(
      join(topDir, "T3201-open.md"),
      "---\ndate: 2026-04-12\nstatus: open\ndescription: Open\n---\n\nBody"
    );
    const result = listIlluminations(tmpDir);
    expect(result).toContain("T3201-open.md");
    expect(result).not.toContain("T3200-archived.md");
  });
```

These tests use `mkdirSync`, `writeFileSync`, and `join` — all already imported in the test file (lines 2-3). No new imports.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/cli/tests/illumination-server.test.ts -t "listIlluminations"`

Expected:
- The first test (`reads from archive/ when status is archived`) fails because `listIlluminations` reads only the top-level dir, so `T3000-archived.md` is not found.
- The second and third tests (`archive/ does not exist` / `archive/ exists but is empty`) — these may pass *coincidentally* today because the unfiltered top-level read returns `NO_ILLUMINATIONS_MESSAGE` when the top-level dir is empty. After the fix, they will pass for the right reason (reading from `archive/`). Don't be misled if they pass at red — focus on the first and last two failures.
- The fourth and fifth tests (`status=open / omitted continues to read top-level`) — should pass at red (current behavior is to read top-level for all statuses) and continue to pass at green (the fix only branches when `status === "archived"`).

The minimum red signal is: **the first test (`reads from archive/`) must fail.** That is the load-bearing failure for the TDD cycle.

### Task 3.2: Implement the directory branch

**Files:**
- Modify: `src/cli/mcp/illumination-server.ts:281-304`

- [ ] **Step 3: Apply the implementation**

In `src/cli/mcp/illumination-server.ts`, replace lines 281-304 (the entire `listIlluminations` function) with:

```ts
export function listIlluminations(projectRoot: string, status?: string): string {
  const baseDir = join(projectRoot, "meditations", "illuminations");
  const dir = status === "archived" ? join(baseDir, "archive") : baseDir;
  try {
    let files = readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .sort();
    if (status) {
      files = files.filter((f) => {
        const content = readFileSync(join(dir, f), "utf-8");
        const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
        if (!fmMatch) return status === "open"; // no frontmatter = open
        const statusMatch = fmMatch[1].match(/^status:\s*(.+)$/m);
        const fileStatus = statusMatch ? statusMatch[1].trim() : "open";
        return fileStatus === status;
      });
    }
    if (files.length === 0) return NO_ILLUMINATIONS_MESSAGE;
    return files
      .map((f) => `${f} — ${parseIlluminationDescription(join(dir, f))}`)
      .join("\n");
  } catch {
    return NO_ILLUMINATIONS_MESSAGE;
  }
}
```

The only structural changes versus the current implementation are the two new lines:

```ts
  const baseDir = join(projectRoot, "meditations", "illuminations");
  const dir = status === "archived" ? join(baseDir, "archive") : baseDir;
```

The rest of the body is byte-identical to today's lines 283-303 (including the frontmatter-status filter that defensively double-checks each file). The `try/catch` continues to return `NO_ILLUMINATIONS_MESSAGE` when `readdirSync` throws `ENOENT` — which now also covers the case where `archive/` does not yet exist.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/cli/tests/illumination-server.test.ts -t "listIlluminations"`

Expected: All 5 new tests pass plus all 7 pre-existing `listIlluminations` tests (at lines 410-497) continue to pass — the unfiltered and `status=open` cases still read the top-level dir.

- [ ] **Step 5: Run the full suite**

Run: `npm test`

Expected: All tests pass. Specifically check:
- `illumination-server.test.ts` — all `describe` blocks green.
- `illumination-to-plan-pipeline.test.ts` — both verifier-prompt assertions still green from Chunk 1.
- No regressions elsewhere (the `listIlluminations` change is additive for callers that don't pass `status="archived"`).

- [ ] **Step 6: Commit**

```bash
git add src/cli/mcp/illumination-server.ts src/cli/tests/illumination-server.test.ts
git commit -m "fix(mcp): list_illuminations(status=archived) reads archive/ subdir

When status is 'archived', readdirSync now targets
meditations/illuminations/archive/ instead of the top-level dir.
All other status values (and the unfiltered call) keep reading the
top-level dir unchanged. Restores the documented surface area of the
list_illuminations MCP tool."
```

---

## Chunk 4: End-to-end verification

**Goal:** Confirm the three changes compose correctly — running the verifier against a project with one open and one dispatched illumination should select only the open one, the mark-* commit should land in history, and an archived item should be queryable.

This chunk has no production-code edits. It is a final manual check before declaring the spec implemented.

### Task 4.1: Verify suite is green and build is clean

- [ ] **Step 1: Full test run**

Run: `npm test`

Expected: All tests pass. No skipped tests introduced by this plan.

- [ ] **Step 2: Type-check + build**

Run: `npm run build`

Expected: Build succeeds. tsup produces `dist/cli/mcp/illumination-server.js` containing the new `try/catch` blocks and the `archive/` branch.

### Task 4.2: Manual sanity check (read-only — no destructive ops)

- [ ] **Step 3: Inspect the .dot diff**

Run: `git log -p -1 -- pipelines/illumination-to-plan.dot`

Expected: The diff shows the single-line replacement of step 1 inside the `verifier` node's `prompt=` attribute. No other lines changed.

- [ ] **Step 4: Inspect the illumination-server.ts diff**

Run: `git log -p -- src/cli/mcp/illumination-server.ts`

Expected: Three appended `try/catch` blocks (one per mark-* function) and one `listIlluminations` body rewrite that adds two lines (`baseDir`, `dir = status === "archived" ? ...`) before the existing `try/catch`.

- [ ] **Step 5: Confirm no other files were touched**

Run: `git diff --stat HEAD~6 HEAD` (or however many commits this plan produced)

Expected: Only four files changed across the plan:
- `pipelines/illumination-to-plan.dot`
- `src/cli/mcp/illumination-server.ts`
- `src/cli/tests/illumination-server.test.ts`
- `src/cli/tests/illumination-to-plan-pipeline.test.ts`

If any other file appears, investigate before declaring the plan complete.

- [ ] **Step 6: Mark spec implemented (optional — for the spec's own state machine)**

This step is **out of scope of this plan's automated changes**, but logically the next pipeline run could call `mcp__illumination__mark_implemented` on `2026-04-14T0600-state-machine-exists-verifier-ignores-it.md`. Whether to invoke it manually here or let the next pipeline run handle it is a session-level call, not a plan step.

---

## Open Questions

None at planning time.

The design doc's `Open Questions` section is also empty. Both the writer and reviewer of this plan agree on the three changes and their exact shape. The only judgment call this plan makes — using mock-based assertions for the auto-commit tests instead of `git init` in temp dirs — follows the existing test-file precedent (`writeIllumination auto-commit` at lines 111-147) and matches the design doc's hint that "writeIllumination already exercises this commit path, so the test framework needed for it exists in this file."
