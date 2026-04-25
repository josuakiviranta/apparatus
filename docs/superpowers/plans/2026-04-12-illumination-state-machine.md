---
status: implemented
---

# Illumination State Machine — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a lifecycle state machine to illumination files: `status: open` on creation, `list_illuminations` filtering by status, `mark_dispatched` MCP tool + pipeline node, and `mark_archived` MCP tool replacing destructive deletion.

**Architecture:** All changes are in `src/cli/mcp/illumination-server.ts` (new exported functions + MCP tool registrations), `pipelines/illumination-to-plan.dot` (new node, replaced edges), `src/cli/agents/meditate.md` (whitelist), and `src/cli/tests/illumination-server.test.ts` (unit tests). Frontmatter mutations use the existing regex-based parsing pattern established by `markImplemented`.

**Tech Stack:** TypeScript, Node.js `fs`, vitest, regex-based YAML frontmatter parsing

**Design spec:** `docs/superpowers/specs/2026-04-12-illumination-state-machine-design.md`

---

## Chunk 1: `write_illumination` adds `status: open` to frontmatter

### File Map

| Action | File | Purpose |
|--------|------|---------|
| Modify | `src/cli/mcp/illumination-server.ts` | Add `status: open` to frontmatter in `writeIllumination` |
| Modify | `src/cli/tests/illumination-server.test.ts` | Add test asserting `status: open` in written frontmatter |

---

### Task 1: Write failing test for `status: open` in frontmatter

**Files:**
- Modify: `src/cli/tests/illumination-server.test.ts`

- [ ] **Step 1: Add test inside existing `describe("writeIllumination", ...)` block**

Add a new test after the existing "prepends frontmatter" test:

```typescript
it("includes status: open in frontmatter", () => {
  writeIllumination(tmpDir, "T1200-status-test.md", "Status test", "Body");
  const content = readFileSync(
    join(tmpDir, "meditations", "illuminations", "T1200-status-test.md"),
    "utf-8"
  );
  expect(content).toMatch(/^---\n/);
  expect(content).toMatch(/status: open/);
});
```

- [ ] **Step 2: Run tests to confirm failure**

```bash
npx vitest run src/cli/tests/illumination-server.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: new test FAILS — frontmatter does not contain `status: open`. Existing tests still pass.

---

### Task 2: Implement `status: open` in `writeIllumination`

**Files:**
- Modify: `src/cli/mcp/illumination-server.ts`

- [ ] **Step 1: Read `writeIllumination` to locate the frontmatter template**

The frontmatter template is at approximately line 28:

```typescript
const frontmatter = `---\ndate: ${date}\ndescription: ${description.trim()}\n---\n\n`;
```

- [ ] **Step 2: Add `status: open` to the frontmatter template**

Change the template to:

```typescript
const frontmatter = `---\ndate: ${date}\nstatus: open\ndescription: ${description.trim()}\n---\n\n`;
```

- [ ] **Step 3: Run tests to confirm they pass**

```bash
npx vitest run src/cli/tests/illumination-server.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: all tests pass including the new `status: open` test.

- [ ] **Step 4: Commit**

```bash
git add src/cli/mcp/illumination-server.ts src/cli/tests/illumination-server.test.ts
git commit -m "feat(illumination): write status: open in frontmatter on creation"
```

---

## Chunk 2: `list_illuminations` status filter

### File Map

| Action | File | Purpose |
|--------|------|---------|
| Modify | `src/cli/mcp/illumination-server.ts` | Add optional `status` parameter to `listIlluminations` |
| Modify | `src/cli/tests/illumination-server.test.ts` | Add tests for status filtering |

---

### Task 3: Write failing tests for status filtering

**Files:**
- Modify: `src/cli/tests/illumination-server.test.ts`

- [ ] **Step 1: Add tests inside existing `describe("listIlluminations", ...)` block**

Add these tests:

```typescript
it("filters by status when status parameter provided", () => {
  const illumDir = join(tmpDir, "meditations", "illuminations");
  mkdirSync(illumDir, { recursive: true });
  writeFileSync(
    join(illumDir, "T1000-open.md"),
    "---\ndate: 2026-04-12\nstatus: open\ndescription: Open one\n---\n\nBody"
  );
  writeFileSync(
    join(illumDir, "T1100-dispatched.md"),
    "---\ndate: 2026-04-12\nstatus: dispatched\ndescription: Dispatched one\n---\n\nBody"
  );
  const result = listIlluminations(tmpDir, "open");
  expect(result).toContain("T1000-open.md");
  expect(result).not.toContain("T1100-dispatched.md");
});

it("treats files without status field as open", () => {
  const illumDir = join(tmpDir, "meditations", "illuminations");
  mkdirSync(illumDir, { recursive: true });
  writeFileSync(
    join(illumDir, "T0900-legacy.md"),
    "---\ndate: 2026-04-12\ndescription: Legacy file\n---\n\nBody"
  );
  const result = listIlluminations(tmpDir, "open");
  expect(result).toContain("T0900-legacy.md");
});

it("returns all illuminations when status omitted", () => {
  const illumDir = join(tmpDir, "meditations", "illuminations");
  mkdirSync(illumDir, { recursive: true });
  writeFileSync(
    join(illumDir, "T1000-open.md"),
    "---\ndate: 2026-04-12\nstatus: open\ndescription: Open\n---\n\nBody"
  );
  writeFileSync(
    join(illumDir, "T1100-dispatched.md"),
    "---\ndate: 2026-04-12\nstatus: dispatched\ndescription: Dispatched\n---\n\nBody"
  );
  const result = listIlluminations(tmpDir);
  expect(result).toContain("T1000-open.md");
  expect(result).toContain("T1100-dispatched.md");
});
```

- [ ] **Step 2: Run tests to confirm failure**

```bash
npx vitest run src/cli/tests/illumination-server.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: new filtering tests FAIL — `listIlluminations` does not accept a `status` parameter.

---

### Task 4: Implement status filter in `listIlluminations`

**Files:**
- Modify: `src/cli/mcp/illumination-server.ts`

- [ ] **Step 1: Read `listIlluminations` (around line 168)**

Current signature: `listIlluminations(projectRoot: string): string`
It reads all `.md` files, extracts description, and returns formatted list.

- [ ] **Step 2: Add optional `status` parameter and filtering logic**

Change signature to:

```typescript
export function listIlluminations(projectRoot: string, status?: string): string {
```

After reading files and before the final map/join, add filtering:

```typescript
// After getting the list of .md files
let filteredFiles = files;
if (status) {
  filteredFiles = files.filter((f) => {
    const content = readFileSync(join(illumDir, f), "utf-8");
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
    if (!fmMatch) return status === "open"; // no frontmatter = open
    const statusMatch = fmMatch[1].match(/^status:\s*(.+)$/m);
    const fileStatus = statusMatch ? statusMatch[1].trim() : "open";
    return fileStatus === status;
  });
}
```

Use `filteredFiles` instead of `files` for the rest of the function.

- [ ] **Step 3: Update the MCP tool registration for `list_illuminations`**

Find the `server.tool("list_illuminations", ...)` registration. Add the optional `status` parameter to the input schema:

```typescript
{
  status: {
    type: "string",
    enum: ["open", "dispatched", "implemented", "archived"],
    description: "Filter by lifecycle status. Omit to return all.",
  },
}
```

Update the handler to pass `status` through:

```typescript
async ({ status }: { status?: string }) => {
  const result = listIlluminations(projectRoot, status);
  return { content: [{ type: "text", text: result }] };
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run src/cli/tests/illumination-server.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: all tests pass including status filtering tests.

- [ ] **Step 5: Commit**

```bash
git add src/cli/mcp/illumination-server.ts src/cli/tests/illumination-server.test.ts
git commit -m "feat(illumination): add status filter to list_illuminations

Accepts optional status parameter. Files without a status field
are treated as open for backward compatibility."
```

---

## Chunk 3: `mark_dispatched` MCP tool

### File Map

| Action | File | Purpose |
|--------|------|---------|
| Modify | `src/cli/mcp/illumination-server.ts` | Add `markDispatched` function + MCP tool registration |
| Modify | `src/cli/tests/illumination-server.test.ts` | Add tests for `markDispatched` |

---

### Task 5: Write failing tests for `markDispatched`

**Files:**
- Modify: `src/cli/tests/illumination-server.test.ts`

- [ ] **Step 1: Import `markDispatched` alongside existing imports**

Add `markDispatched` to the import from `../mcp/illumination-server.js`.

- [ ] **Step 2: Add `describe("markDispatched", ...)` test block**

```typescript
describe("markDispatched", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = realpathSync(mkdtempSync(join(tmpdir(), "ralph-test-")));
    mkdirSync(join(tmpDir, "meditations", "illuminations"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeIlluminationFile(filename: string, frontmatter: string, body: string) {
    const content = `---\n${frontmatter}\n---\n\n${body}`;
    writeFileSync(join(tmpDir, "meditations", "illuminations", filename), content);
  }

  it("transitions open to dispatched", () => {
    writeIlluminationFile(
      "T1300-open.md",
      "date: 2026-04-12\nstatus: open\ndescription: An open issue",
      "Body content."
    );

    const result = markDispatched(tmpDir, "T1300-open.md", "docs/superpowers/specs/2026-04-12-test.md");

    expect(result.success).toBe(true);
    expect(result.previous_status).toBe("open");
    expect(result.new_status).toBe("dispatched");

    const written = readFileSync(
      join(tmpDir, "meditations", "illuminations", "T1300-open.md"),
      "utf-8"
    );
    expect(written).toMatch(/status: dispatched/);
    expect(written).toMatch(/dispatched_at: \d{4}-\d{2}-\d{2}/);
    expect(written).toMatch(/plan_path: docs\/superpowers\/specs\/2026-04-12-test\.md/);
    expect(written).toContain("Body content.");
  });

  it("rejects already-dispatched illumination", () => {
    writeIlluminationFile(
      "T1400-dispatched.md",
      "date: 2026-04-12\nstatus: dispatched\ndescription: Already dispatched",
      "Body."
    );

    const result = markDispatched(tmpDir, "T1400-dispatched.md", "some/path.md");

    expect(result.success).toBe(false);
    expect(result.error).toContain("dispatched");
  });

  it("rejects implemented illumination", () => {
    writeIlluminationFile(
      "T1500-impl.md",
      "date: 2026-04-12\nstatus: implemented\ndescription: Done",
      "Body."
    );

    const result = markDispatched(tmpDir, "T1500-impl.md", "some/path.md");

    expect(result.success).toBe(false);
    expect(result.error).toContain("implemented");
  });

  it("rejects archived illumination", () => {
    writeIlluminationFile(
      "T1600-archived.md",
      "date: 2026-04-12\nstatus: archived\ndescription: Old",
      "Body."
    );

    const result = markDispatched(tmpDir, "T1600-archived.md", "some/path.md");

    expect(result.success).toBe(false);
    expect(result.error).toContain("archived");
  });

  it("returns error when file not found", () => {
    const result = markDispatched(tmpDir, "T9999-nonexistent.md", "some/path.md");

    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });

  it("treats files without status field as open", () => {
    writeIlluminationFile(
      "T1700-legacy.md",
      "date: 2026-04-12\ndescription: Legacy file",
      "Body."
    );

    const result = markDispatched(tmpDir, "T1700-legacy.md", "some/plan.md");

    expect(result.success).toBe(true);
    expect(result.previous_status).toBe("open");
    expect(result.new_status).toBe("dispatched");
  });

  it("preserves body content unchanged", () => {
    const body = "# Analysis\n\nMultiple paragraphs.\n\n- Item 1\n- Item 2";
    writeIlluminationFile(
      "T1800-preserve.md",
      "date: 2026-04-12\nstatus: open\ndescription: Preserve test",
      body
    );

    markDispatched(tmpDir, "T1800-preserve.md", "some/path.md");

    const written = readFileSync(
      join(tmpDir, "meditations", "illuminations", "T1800-preserve.md"),
      "utf-8"
    );
    expect(written).toContain(body);
  });
});
```

- [ ] **Step 3: Run tests to confirm failure**

```bash
npx vitest run src/cli/tests/illumination-server.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: FAIL — `markDispatched` does not exist.

---

### Task 6: Implement `markDispatched` function + MCP tool

**Files:**
- Modify: `src/cli/mcp/illumination-server.ts`

- [ ] **Step 1: Add `markDispatched` exported function**

Add after `markImplemented`, following the same pattern:

```typescript
export function markDispatched(
  projectRoot: string,
  filename: string,
  planPath: string,
): { success: true; filename: string; previous_status: string; new_status: string }
  | { success: false; error: string } {
  const validationError = validateFilename(filename);
  if (validationError) return { success: false, error: validationError };

  const illumDir = join(projectRoot, "meditations", "illuminations");
  const filePath = join(illumDir, filename);

  if (!existsSync(filePath)) {
    return { success: false, error: `Illumination file not found: ${filename}` };
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

  if (currentStatus !== "open") {
    return {
      success: false,
      error: `Cannot mark as dispatched: current status is ${currentStatus}`,
    };
  }

  const today = new Date().toISOString().slice(0, 10);
  let updatedFm = statusMatch
    ? fmBlock.replace(/^status:\s*.+$/m, "status: dispatched")
    : fmBlock + "\nstatus: dispatched";
  updatedFm += `\ndispatched_at: ${today}`;
  updatedFm += `\nplan_path: ${planPath}`;

  const updatedContent = `---\n${updatedFm}\n---\n${body}`;
  writeFileSync(filePath, updatedContent);

  return {
    success: true,
    filename,
    previous_status: currentStatus,
    new_status: "dispatched",
  };
}
```

- [ ] **Step 2: Register `mark_dispatched` MCP tool**

Add after the `mark_implemented` tool registration:

```typescript
server.tool(
  "mark_dispatched",
  "Mark an illumination as dispatched after a plan has been generated. Valid only from status open.",
  {
    filename: {
      type: "string",
      description: "Illumination filename (e.g. 2026-04-13T2300-some-topic.md)",
    },
    plan_path: {
      type: "string",
      description: "Path to the generated design doc or plan",
    },
  },
  async ({ filename, plan_path }: { filename: string; plan_path: string }) => {
    const result = markDispatched(projectRoot, filename, plan_path);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  },
);
```

- [ ] **Step 3: Run tests to confirm they pass**

```bash
npx vitest run src/cli/tests/illumination-server.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/cli/mcp/illumination-server.ts src/cli/tests/illumination-server.test.ts
git commit -m "feat(illumination): add markDispatched tool for open -> dispatched transition

Reads illumination file, validates status is open, updates frontmatter
to status: dispatched with dispatched_at date and plan_path reference.
Preserves body content unchanged."
```

---

## Chunk 4: `mark_archived` MCP tool

### File Map

| Action | File | Purpose |
|--------|------|---------|
| Modify | `src/cli/mcp/illumination-server.ts` | Add `markArchived` function + MCP tool registration |
| Modify | `src/cli/tests/illumination-server.test.ts` | Add tests for `markArchived` |

---

### Task 7: Write failing tests for `markArchived`

**Files:**
- Modify: `src/cli/tests/illumination-server.test.ts`

- [ ] **Step 1: Import `markArchived` alongside existing imports**

Add `markArchived` to the import from `../mcp/illumination-server.js`.

- [ ] **Step 2: Add `describe("markArchived", ...)` test block**

```typescript
describe("markArchived", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = realpathSync(mkdtempSync(join(tmpdir(), "ralph-test-")));
    mkdirSync(join(tmpDir, "meditations", "illuminations"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeIlluminationFile(filename: string, frontmatter: string, body: string) {
    const content = `---\n${frontmatter}\n---\n\n${body}`;
    writeFileSync(join(tmpDir, "meditations", "illuminations", filename), content);
  }

  it("archives an open illumination", () => {
    writeIlluminationFile(
      "T2000-open.md",
      "date: 2026-04-12\nstatus: open\ndescription: Stale issue",
      "Body."
    );

    const result = markArchived(tmpDir, "T2000-open.md", "No longer relevant");

    expect(result.success).toBe(true);
    expect(result.previous_status).toBe("open");
    expect(result.new_status).toBe("archived");
    expect(result.archive_path).toContain("archive/T2000-open.md");

    // File moved to archive
    expect(existsSync(join(tmpDir, "meditations", "illuminations", "T2000-open.md"))).toBe(false);
    expect(existsSync(join(tmpDir, "meditations", "illuminations", "archive", "T2000-open.md"))).toBe(true);

    // Frontmatter updated
    const written = readFileSync(
      join(tmpDir, "meditations", "illuminations", "archive", "T2000-open.md"),
      "utf-8"
    );
    expect(written).toMatch(/status: archived/);
    expect(written).toMatch(/archived_at: \d{4}-\d{2}-\d{2}/);
    expect(written).toMatch(/archive_reason: No longer relevant/);
  });

  it("archives an implemented illumination", () => {
    writeIlluminationFile(
      "T2100-impl.md",
      "date: 2026-04-12\nstatus: implemented\ndescription: Done",
      "Body."
    );

    const result = markArchived(tmpDir, "T2100-impl.md", "Completed and verified");

    expect(result.success).toBe(true);
    expect(result.previous_status).toBe("implemented");
    expect(result.new_status).toBe("archived");
  });

  it("archives a dispatched illumination", () => {
    writeIlluminationFile(
      "T2200-dispatched.md",
      "date: 2026-04-12\nstatus: dispatched\ndescription: In progress",
      "Body."
    );

    const result = markArchived(tmpDir, "T2200-dispatched.md", "Plan abandoned");

    expect(result.success).toBe(true);
    expect(result.previous_status).toBe("dispatched");
  });

  it("rejects already-archived illumination", () => {
    // Put file directly in archive dir
    mkdirSync(join(tmpDir, "meditations", "illuminations", "archive"), { recursive: true });
    writeFileSync(
      join(tmpDir, "meditations", "illuminations", "archive", "T2300-archived.md"),
      "---\ndate: 2026-04-12\nstatus: archived\ndescription: Old\n---\n\nBody."
    );
    // Also create in main dir to test status check
    writeIlluminationFile(
      "T2300-archived.md",
      "date: 2026-04-12\nstatus: archived\ndescription: Old",
      "Body."
    );

    const result = markArchived(tmpDir, "T2300-archived.md", "Already done");

    expect(result.success).toBe(false);
    expect(result.error).toContain("archived");
  });

  it("returns error when file not found", () => {
    const result = markArchived(tmpDir, "T9999-nonexistent.md", "Gone");

    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });

  it("creates archive directory if it does not exist", () => {
    writeIlluminationFile(
      "T2400-new-archive.md",
      "date: 2026-04-12\nstatus: open\ndescription: Test",
      "Body."
    );

    expect(existsSync(join(tmpDir, "meditations", "illuminations", "archive"))).toBe(false);

    markArchived(tmpDir, "T2400-new-archive.md", "Testing archive creation");

    expect(existsSync(join(tmpDir, "meditations", "illuminations", "archive"))).toBe(true);
  });

  it("preserves body content unchanged", () => {
    const body = "# Deep Analysis\n\nParagraphs.\n\n- List";
    writeIlluminationFile(
      "T2500-preserve.md",
      "date: 2026-04-12\nstatus: open\ndescription: Preserve test",
      body
    );

    markArchived(tmpDir, "T2500-preserve.md", "Done");

    const written = readFileSync(
      join(tmpDir, "meditations", "illuminations", "archive", "T2500-preserve.md"),
      "utf-8"
    );
    expect(written).toContain(body);
  });
});
```

- [ ] **Step 3: Run tests to confirm failure**

```bash
npx vitest run src/cli/tests/illumination-server.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: FAIL — `markArchived` does not exist.

---

### Task 8: Implement `markArchived` function + MCP tool

**Files:**
- Modify: `src/cli/mcp/illumination-server.ts`

- [ ] **Step 1: Add `markArchived` exported function**

Add after `markDispatched`. Import `renameSync` from `fs` if not already imported:

```typescript
export function markArchived(
  projectRoot: string,
  filename: string,
  reason: string,
): { success: true; filename: string; previous_status: string; new_status: string; archive_path: string }
  | { success: false; error: string } {
  const validationError = validateFilename(filename);
  if (validationError) return { success: false, error: validationError };

  const illumDir = join(projectRoot, "meditations", "illuminations");
  const filePath = join(illumDir, filename);

  if (!existsSync(filePath)) {
    return { success: false, error: `Illumination file not found: ${filename}` };
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

  if (currentStatus === "archived") {
    return {
      success: false,
      error: `Cannot archive: current status is already archived`,
    };
  }

  const today = new Date().toISOString().slice(0, 10);
  let updatedFm = statusMatch
    ? fmBlock.replace(/^status:\s*.+$/m, "status: archived")
    : fmBlock + "\nstatus: archived";
  updatedFm += `\narchived_at: ${today}`;
  updatedFm += `\narchive_reason: ${reason}`;

  const archiveDir = join(illumDir, "archive");
  mkdirSync(archiveDir, { recursive: true });

  const archivePath = join(archiveDir, filename);
  const updatedContent = `---\n${updatedFm}\n---\n${body}`;
  writeFileSync(archivePath, updatedContent);

  // Remove original file
  rmSync(filePath);

  return {
    success: true,
    filename,
    previous_status: currentStatus,
    new_status: "archived",
    archive_path: join("meditations", "illuminations", "archive", filename),
  };
}
```

**Note:** Uses `mkdirSync` and `rmSync` from `fs` (already imported in test file; confirm import in server file).

- [ ] **Step 2: Register `mark_archived` MCP tool**

Add after the `mark_dispatched` tool registration:

```typescript
server.tool(
  "mark_archived",
  "Archive an illumination. Moves file to archive/ subdirectory. Valid from any status except archived.",
  {
    filename: {
      type: "string",
      description: "Illumination filename (e.g. 2026-04-13T2300-some-topic.md)",
    },
    reason: {
      type: "string",
      description: "Why the illumination is being archived",
    },
  },
  async ({ filename, reason }: { filename: string; reason: string }) => {
    const result = markArchived(projectRoot, filename, reason);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  },
);
```

- [ ] **Step 3: Run tests to confirm they pass**

```bash
npx vitest run src/cli/tests/illumination-server.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/cli/mcp/illumination-server.ts src/cli/tests/illumination-server.test.ts
git commit -m "feat(illumination): add markArchived tool — moves to archive/ subdirectory

Validates status is not already archived, updates frontmatter with
archived_at date and archive_reason, moves file to archive/ directory.
Preserves body content unchanged."
```

---

## Chunk 5: Pipeline + agent whitelist updates

### File Map

| Action | File | Purpose |
|--------|------|---------|
| Modify | `pipelines/illumination-to-plan.dot` | Add `mark_dispatched` node; replace `delete_agent` with `mark_archived` |
| Modify | `src/cli/agents/meditate.md` | Whitelist `mark_dispatched` and `mark_archived` tools |

---

### Task 9: Add `mark_dispatched` node to pipeline

**Files:**
- Modify: `pipelines/illumination-to-plan.dot`

- [ ] **Step 1: Read the current pipeline graph**

```bash
cat pipelines/illumination-to-plan.dot
```

- [ ] **Step 2: Add `mark_dispatched` node definition**

Add the node in the node definitions section:

```dot
mark_dispatched [shape=box, handler="agent", model="sonnet", label="mark_dispatched", prompt="Call mcp__illumination__mark_dispatched with filename from $illumination_path (basename only) and plan_path set to $design_doc_path. Return the JSON result."]
```

- [ ] **Step 3: Insert `mark_dispatched` between `design_writer` and `plan_writer`**

Change the edge from:
```dot
design_writer -> plan_writer
```
to:
```dot
design_writer -> mark_dispatched -> plan_writer
```

- [ ] **Step 4: Replace `delete_agent` with `mark_archived` on false/decline paths**

Replace the `delete_agent` node definition with:

```dot
mark_archived [shape=box, handler="agent", model="sonnet", label="mark_archived", prompt="Call mcp__illumination__mark_archived with filename from $illumination_path (basename only) and reason summarizing why the illumination is being archived (use context from $summary). Return the JSON result."]
```

Update all edges that reference `delete_agent` to reference `mark_archived` instead:
- `explain_removal -> remove_gate` edge's target after remove_gate: `remove_gate -> mark_archived`
- `approval_gate -> mark_archived` (the Decline edge)
- `mark_archived -> done`

- [ ] **Step 5: Verify DOT syntax**

```bash
dot -Tsvg pipelines/illumination-to-plan.dot -o /dev/null 2>&1 || echo "DOT syntax error"
```

Expected: no errors (or `dot` not installed — skip if so).

- [ ] **Step 6: Commit**

```bash
git add pipelines/illumination-to-plan.dot
git commit -m "feat(pipeline): add mark_dispatched node; replace delete_agent with mark_archived

mark_dispatched inserted between design_writer and plan_writer.
delete_agent replaced by mark_archived on false-path and decline-path
edges, preserving illumination files in archive/ instead of deleting."
```

---

### Task 10: Whitelist new tools in meditate agent

**Files:**
- Modify: `src/cli/agents/meditate.md`

- [ ] **Step 1: Read the file**

```bash
cat src/cli/agents/meditate.md
```

- [ ] **Step 2: Add tools to whitelist**

Add after `mcp__illumination__mark_implemented`:

```yaml
  - mcp__illumination__mark_dispatched
  - mcp__illumination__mark_archived
```

- [ ] **Step 3: Commit**

```bash
git add src/cli/agents/meditate.md
git commit -m "feat(meditate): whitelist mark_dispatched and mark_archived tools"
```

---

## Chunk 6: Backfill existing illuminations + final verification

### File Map

| Action | File | Purpose |
|--------|------|---------|
| Modify | `meditations/illuminations/*.md` | Add `status: open` to files missing the field |

---

### Task 11: Backfill `status: open` in existing illumination files

**Files:**
- Modify: `meditations/illuminations/*.md` (any files lacking a `status` field)

- [ ] **Step 1: Find illuminations missing the status field**

```bash
for f in meditations/illuminations/*.md; do
  grep -q "^status:" "$f" || echo "$f"
done
```

- [ ] **Step 2: Add `status: open` after the `date:` line in each file**

For each file found in step 1, insert `status: open` between the `date:` and `description:` lines in the frontmatter.

- [ ] **Step 3: Commit**

```bash
git add meditations/illuminations/
git commit -m "chore(illumination): backfill status: open in existing illumination frontmatter"
```

---

### Task 12: Final verification

- [ ] **Step 1: Run full test suite**

```bash
npx vitest run 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 2: Build**

```bash
npm run build 2>&1 | tail -10
```

Expected: clean build, no errors.

- [ ] **Step 3: Verify all new tools appear in built output**

```bash
grep -n "mark_dispatched\|mark_archived" dist/cli/mcp/illumination-server.js
```

Expected: both tool names appear in the built output.
