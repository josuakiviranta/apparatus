---
status: implemented
---

# Mark-Implemented Lifecycle Completion — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `mark_implemented` MCP tool to `illumination-server.ts` so developers can transition illuminations from `dispatched`/`open` to `implemented` during `ralph meditate` sessions.

**Architecture:** A new exported function `markImplemented(projectRoot, filename)` reads an illumination file, parses its YAML frontmatter, validates the current status allows transition, updates `status` to `implemented`, adds `implemented_at` date, and writes the file back. The tool is registered in the MCP server, whitelisted in the meditate agent, and referenced in the meditation prompt.

**Tech Stack:** TypeScript, Node.js `fs`, YAML frontmatter parsing (regex-based, matching existing patterns in the file), Vitest.

---

## Files

| Action | Path | What changes |
|---|---|---|
| Modify | `src/cli/mcp/illumination-server.ts` | Add `markImplemented` function + MCP tool registration |
| Modify | `src/cli/tests/illumination-server.test.ts` | Add `describe("markImplemented", ...)` test block |
| Modify | `src/cli/agents/meditate.md` | Add tool to whitelist |
| Modify | `src/cli/prompts/PROMPT_meditation.md` | Add prompt instruction |

---

## Chunk 1: `markImplemented` function with TDD

### Task 1: Write failing tests for `markImplemented`

**Files:**
- Modify: `src/cli/tests/illumination-server.test.ts`

- [ ] **Step 1: Read the test file to understand existing patterns**

```bash
cat src/cli/tests/illumination-server.test.ts
```

Confirm: `tmpDir` setup/teardown via `beforeEach`/`afterEach`, `mkdtempSync`/`rmSync` pattern, direct `writeFileSync` for fixture files.

- [ ] **Step 2: Write failing tests for `markImplemented`**

Add a new `describe("markImplemented", ...)` block at the end of the file. Import `markImplemented` from `../mcp/illumination-server.js` alongside existing imports.

```typescript
describe("markImplemented", () => {
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

  it("transitions dispatched to implemented", () => {
    writeIlluminationFile(
      "T1620-some-bug.md",
      "date: 2026-04-10\ndescription: A bug\nstatus: dispatched",
      "Body content here."
    );

    const result = markImplemented(tmpDir, "T1620-some-bug.md");

    expect(result.success).toBe(true);
    expect(result.previous_status).toBe("dispatched");
    expect(result.new_status).toBe("implemented");

    const written = readFileSync(
      join(tmpDir, "meditations", "illuminations", "T1620-some-bug.md"),
      "utf-8"
    );
    expect(written).toMatch(/status: implemented/);
    expect(written).toMatch(/implemented_at: \d{4}-\d{2}-\d{2}/);
    expect(written).toContain("Body content here.");
  });

  it("transitions open to implemented", () => {
    writeIlluminationFile(
      "T1700-open-issue.md",
      "date: 2026-04-10\ndescription: An issue\nstatus: open",
      "Some body."
    );

    const result = markImplemented(tmpDir, "T1700-open-issue.md");

    expect(result.success).toBe(true);
    expect(result.previous_status).toBe("open");
    expect(result.new_status).toBe("implemented");
  });

  it("rejects already-implemented illumination", () => {
    writeIlluminationFile(
      "T1800-done.md",
      "date: 2026-04-10\ndescription: Done\nstatus: implemented",
      "Body."
    );

    const result = markImplemented(tmpDir, "T1800-done.md");

    expect(result.success).toBe(false);
    expect(result.error).toContain("Cannot mark as implemented");
    expect(result.error).toContain("implemented");
  });

  it("rejects archived illumination", () => {
    writeIlluminationFile(
      "T1900-archived.md",
      "date: 2026-04-10\ndescription: Old\nstatus: archived",
      "Body."
    );

    const result = markImplemented(tmpDir, "T1900-archived.md");

    expect(result.success).toBe(false);
    expect(result.error).toContain("Cannot mark as implemented");
    expect(result.error).toContain("archived");
  });

  it("returns error when file not found", () => {
    const result = markImplemented(tmpDir, "T9999-nonexistent.md");

    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });

  it("preserves body content unchanged", () => {
    const body = "# Deep Analysis\n\nMultiple paragraphs.\n\n- List item\n- Another";
    writeIlluminationFile(
      "T2000-preserve.md",
      "date: 2026-04-10\ndescription: Preserve test\nstatus: dispatched",
      body
    );

    markImplemented(tmpDir, "T2000-preserve.md");

    const written = readFileSync(
      join(tmpDir, "meditations", "illuminations", "T2000-preserve.md"),
      "utf-8"
    );
    expect(written).toContain(body);
  });

  it("adds implemented_at as UTC date in YYYY-MM-DD format", () => {
    writeIlluminationFile(
      "T2100-date.md",
      "date: 2026-04-10\ndescription: Date test\nstatus: open",
      "Body."
    );

    markImplemented(tmpDir, "T2100-date.md");

    const written = readFileSync(
      join(tmpDir, "meditations", "illuminations", "T2100-date.md"),
      "utf-8"
    );
    const match = written.match(/implemented_at: (\d{4}-\d{2}-\d{2})/);
    expect(match).not.toBeNull();
    // Verify it's a valid date string
    const parsed = new Date(match![1]);
    expect(parsed.toString()).not.toBe("Invalid Date");
  });
});
```

- [ ] **Step 3: Run tests to confirm they fail**

```bash
npx vitest run src/cli/tests/illumination-server.test.ts --reporter=verbose 2>&1 | tail -30
```

Expected: all `markImplemented` tests fail (function doesn't exist yet). Existing tests still pass.

- [ ] **Step 4: Commit the failing tests**

```bash
git add src/cli/tests/illumination-server.test.ts
git commit -m "test(illumination): add failing tests for markImplemented lifecycle transition"
```

---

### Task 2: Implement `markImplemented` in illumination-server.ts

**Files:**
- Modify: `src/cli/mcp/illumination-server.ts`

- [ ] **Step 1: Read the current implementation**

```bash
cat src/cli/mcp/illumination-server.ts
```

Understand: how `writeIllumination` constructs frontmatter, the export pattern, and where to place the new function.

- [ ] **Step 2: Add the `markImplemented` function**

Add the exported function after `writeIllumination`. It should:

```typescript
export function markImplemented(
  projectRoot: string,
  filename: string,
): { success: true; filename: string; previous_status: string; new_status: string }
  | { success: false; error: string } {
  const illumDir = join(projectRoot, "meditations", "illuminations");
  const filePath = join(illumDir, filename);

  if (!existsSync(filePath)) {
    return { success: false, error: "Illumination file not found" };
  }

  const raw = readFileSync(filePath, "utf-8");

  // Parse frontmatter block: content between first --- and second ---
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n/);
  if (!fmMatch) {
    return { success: false, error: "No frontmatter found in illumination file" };
  }

  const fmBlock = fmMatch[1];
  const body = raw.slice(fmMatch[0].length);

  // Extract current status
  const statusMatch = fmBlock.match(/^status:\s*(.+)$/m);
  const currentStatus = statusMatch ? statusMatch[1].trim() : "open";

  // Validate transition
  const allowed = ["open", "dispatched"];
  if (!allowed.includes(currentStatus)) {
    return {
      success: false,
      error: `Cannot mark as implemented: current status is ${currentStatus}`,
    };
  }

  // Update frontmatter
  const today = new Date().toISOString().slice(0, 10);
  let updatedFm = statusMatch
    ? fmBlock.replace(/^status:\s*.+$/m, "status: implemented")
    : fmBlock + "\nstatus: implemented";
  updatedFm += `\nimplemented_at: ${today}`;

  const updatedContent = `---\n${updatedFm}\n---\n${body}`;
  writeFileSync(filePath, updatedContent);

  return {
    success: true,
    filename,
    previous_status: currentStatus,
    new_status: "implemented",
  };
}
```

**Note:** Uses `existsSync` and `readFileSync` from `fs` (already imported in the file). Pattern matches existing frontmatter handling: regex-based, no external YAML library.

- [ ] **Step 3: Run tests to confirm they pass**

```bash
npx vitest run src/cli/tests/illumination-server.test.ts --reporter=verbose 2>&1 | tail -30
```

Expected: all `markImplemented` tests pass. All existing tests still pass.

- [ ] **Step 4: Run the full test suite**

```bash
npx vitest run 2>&1 | tail -20
```

Expected: no regressions.

- [ ] **Step 5: Commit**

```bash
git add src/cli/mcp/illumination-server.ts
git commit -m "feat(illumination): add markImplemented function for lifecycle transition

Reads illumination file, validates status is open or dispatched,
updates frontmatter to status: implemented with implemented_at date.
Preserves body content unchanged."
```

---

## Chunk 2: MCP tool registration

### Task 3: Register `mark_implemented` as an MCP tool

**Files:**
- Modify: `src/cli/mcp/illumination-server.ts`

- [ ] **Step 1: Read the MCP server registration section**

```bash
grep -n "server.tool\|addTool\|registerTool" src/cli/mcp/illumination-server.ts
```

Understand: how existing tools are registered (name, description, input schema, handler).

- [ ] **Step 2: Add the MCP tool registration**

Add after the last existing tool registration, following the same pattern:

```typescript
server.tool(
  "mark_implemented",
  "Mark an illumination as implemented. Valid from status open or dispatched.",
  {
    filename: {
      type: "string",
      description: "Illumination filename (e.g. T1620-some-bug.md)",
    },
  },
  async ({ filename }: { filename: string }) => {
    const result = markImplemented(projectRoot, filename);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  },
);
```

- [ ] **Step 3: Build to verify no compilation errors**

```bash
npm run build 2>&1 | tail -10
```

Expected: clean build, no errors.

- [ ] **Step 4: Commit**

```bash
git add src/cli/mcp/illumination-server.ts
git commit -m "feat(illumination): register mark_implemented MCP tool"
```

---

## Chunk 3: Meditate agent whitelist + prompt instruction

### Task 4: Add tool to meditate agent whitelist

**Files:**
- Modify: `src/cli/agents/meditate.md`

- [ ] **Step 1: Read the file**

```bash
cat src/cli/agents/meditate.md
```

- [ ] **Step 2: Add `mcp__illumination__mark_implemented` to the tools whitelist**

Insert after `mcp__illumination__write_illumination`:

```yaml
  - mcp__illumination__mark_implemented
```

- [ ] **Step 3: Commit**

```bash
git add src/cli/agents/meditate.md
git commit -m "feat(meditate): whitelist mark_implemented tool in agent config"
```

---

### Task 5: Add prompt instruction for marking resolved illuminations

**Files:**
- Modify: `src/cli/prompts/PROMPT_meditation.md`

- [ ] **Step 1: Read the file**

```bash
cat src/cli/prompts/PROMPT_meditation.md
```

- [ ] **Step 2: Add instruction after the existing task list**

After the last numbered step in the workflow (step 7 — `write_illumination`), add:

```markdown
8. If the user reports that a fix has been shipped or an illumination has been resolved,
   call `mark_implemented` with the illumination filename before ending the session.
```

- [ ] **Step 3: Commit**

```bash
git add src/cli/prompts/PROMPT_meditation.md
git commit -m "feat(meditate): add prompt instruction for marking resolved illuminations"
```

---

### Task 6: Final verification

- [ ] **Step 1: Run full test suite**

```bash
npx vitest run 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 2: Build**

```bash
npm run build 2>&1 | tail -10
```

Expected: clean build.

- [ ] **Step 3: Verify the tool appears in MCP server output**

```bash
node dist/cli/mcp/illumination-server.js --help 2>&1 || true
# Or check via listing tools if the server supports it
grep -n "mark_implemented" dist/cli/mcp/illumination-server.js
```

Expected: `mark_implemented` appears in the built output.
