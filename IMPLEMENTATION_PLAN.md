# list_illuminations MCP Tool Implementation Plan

> **Status: COMPLETE** — All tasks implemented and shipped as tag `0.0.26`.

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add YAML frontmatter to illumination files and a `list_illuminations` MCP tool so the meditating agent can orient itself before writing new insights.

**Architecture:** Modify `writeIllumination()` to prepend auto-generated frontmatter (date + description), add `listIlluminations()` that parses frontmatter from all illumination files, register a new `list_illuminations` MCP tool, and update `PROMPT_meditation.md` to use it.

**Tech Stack:** TypeScript, Node.js `fs` module, Vitest, `@modelcontextprotocol/sdk`, `zod`

---

## Chunk 1: Core Logic — `writeIllumination` + `listIlluminations`

### Task 1: Update `writeIllumination` to inject frontmatter

**Files:**
- Modify: `src/cli/mcp/illumination-server.ts` — `writeIllumination()` function
- Modify: `src/cli/tests/illumination-server.test.ts` — update existing tests, add new ones

The function gains a `description: string` param. It prepends frontmatter before writing.

- [x] **Step 1: Write failing tests for the new `writeIllumination` signature**

Add to the `describe("writeIllumination", ...)` block in `src/cli/tests/illumination-server.test.ts`. First, update the four existing tests to pass a description argument (they will still fail at compile time once the signature changes):

```typescript
// Update existing tests: add "Test insight" as the third argument
it("writes content to meditations/illuminations/<filename>", () => {
  const result = writeIllumination(tmpDir, "2026-04-04T1430-test.md", "Test insight", "# Hello");
  const expected = join(tmpDir, "meditations", "illuminations", "2026-04-04T1430-test.md");
  expect(result).toBe(expected);
});

it("overwrites an existing file without error", () => {
  writeIllumination(tmpDir, "test.md", "desc v1", "v1");
  const result = writeIllumination(tmpDir, "test.md", "desc v2", "v2");
  const raw = readFileSync(result, "utf8");
  expect(raw).toContain("desc v2");
  expect(raw).not.toContain("desc v1");
});

it("creates meditations/illuminations/ directory if absent", () => {
  writeIllumination(tmpDir, "test.md", "desc", "content");
  expect(existsSync(join(tmpDir, "meditations", "illuminations"))).toBe(true);
});

it("throws an error for an invalid filename", () => {
  expect(() => writeIllumination(tmpDir, "bad/name.md", "desc", "content")).toThrow();
});
```

Then add new tests:

```typescript
it("prepends YAML frontmatter with date and description", () => {
  writeIllumination(tmpDir, "2026-04-08T0900-test.md", "A concise insight.", "# Title\n\nBody.");
  const filePath = join(tmpDir, "meditations", "illuminations", "2026-04-08T0900-test.md");
  const raw = readFileSync(filePath, "utf8");
  expect(raw).toMatch(/^---\ndate: \d{4}-\d{2}-\d{2}\ndescription: A concise insight\.\n---\n\n/);
});

it("places the content body after the frontmatter separator", () => {
  writeIllumination(tmpDir, "test.md", "desc", "# Title\n\nBody.");
  const filePath = join(tmpDir, "meditations", "illuminations", "test.md");
  const raw = readFileSync(filePath, "utf8");
  expect(raw).toContain("---\n\n# Title\n\nBody.");
});

it("throws when description is empty", () => {
  expect(() => writeIllumination(tmpDir, "test.md", "", "content")).toThrow("description");
});
```

- [x] **Step 2: Run tests to verify they fail**

```bash
cd /Users/josu/Documents/projects/ralph-cli && npm test -- --reporter=verbose src/cli/tests/illumination-server.test.ts 2>&1 | grep -E "(FAIL|PASS|✓|×|error)" | head -30
```

Expected: compile errors or test failures referencing wrong argument count or missing frontmatter.

- [x] **Step 3: Update `writeIllumination` in `src/cli/mcp/illumination-server.ts`**

Replace the existing function:

```typescript
export function writeIllumination(
  projectRoot: string,
  filename: string,
  description: string,
  content: string,
): string {
  const err = validateFilename(filename);
  if (err) throw new Error(err);
  if (!description || !description.trim()) throw new Error("description is required");
  const date = new Date().toISOString().slice(0, 10);
  const frontmatter = `---\ndate: ${date}\ndescription: ${description.trim()}\n---\n\n`;
  const dir = join(projectRoot, "meditations", "illuminations");
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, filename);
  writeFileSync(filePath, frontmatter + content, "utf8");
  return filePath;
}
```

- [x] **Step 4: Run tests to verify they pass**

```bash
cd /Users/josu/Documents/projects/ralph-cli && npm test -- --reporter=verbose src/cli/tests/illumination-server.test.ts 2>&1 | grep -E "(FAIL|PASS|✓|×)" | head -30
```

Expected: all `writeIllumination` tests pass. Other describes also pass.

- [x] **Step 5: Commit**

```bash
cd /Users/josu/Documents/projects/ralph-cli && git add src/cli/mcp/illumination-server.ts src/cli/tests/illumination-server.test.ts && git commit -m "feat: writeIllumination injects YAML frontmatter (date + description)"
```

---

### Task 2: Add `listIlluminations` function and `list_illuminations` MCP tool

**Files:**
- Modify: `src/cli/mcp/illumination-server.ts` — add `listIlluminations()`, private `parseIlluminationDescription()`, register tool, update `write_illumination` tool schema
- Modify: `src/cli/tests/illumination-server.test.ts` — add `listIlluminations` describe block, update import

- [x] **Step 1: Write failing tests for `listIlluminations`**

Add to `src/cli/tests/illumination-server.test.ts`. First update the import to include `listIlluminations`:

```typescript
import { validateFilename, writeIllumination, assertWithinRoot, readFile, validateGlobPattern, globFiles, projectTree, listMetaMeditations, readMetaMeditation, listIlluminations } from "../mcp/illumination-server";
```

Then add the describe block:

```typescript
describe("listIlluminations", () => {
  it("returns no-illuminations message when directory is missing", () => {
    const result = listIlluminations(tmpDir);
    expect(result).toBe("No illuminations found.");
  });

  it("returns no-illuminations message when directory is empty", () => {
    mkdirSync(join(tmpDir, "meditations", "illuminations"), { recursive: true });
    const result = listIlluminations(tmpDir);
    expect(result).toBe("No illuminations found.");
  });

  it("returns filename and description for a file with frontmatter", () => {
    const dir = join(tmpDir, "meditations", "illuminations");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "2026-04-08T0900-my-insight.md"), "---\ndate: 2026-04-08\ndescription: Something important.\n---\n\n# My Insight\n\nBody.");
    const result = listIlluminations(tmpDir);
    expect(result).toBe("2026-04-08T0900-my-insight.md — Something important.");
  });

  it("shows (no description) for a file without frontmatter", () => {
    const dir = join(tmpDir, "meditations", "illuminations");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "old-insight.md"), "# Old Insight\n\nNo frontmatter here.");
    const result = listIlluminations(tmpDir);
    expect(result).toBe("old-insight.md — (no description)");
  });

  it("shows (no description) for a file with frontmatter missing description field", () => {
    const dir = join(tmpDir, "meditations", "illuminations");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "partial.md"), "---\ndate: 2026-04-08\n---\n\n# Partial");
    const result = listIlluminations(tmpDir);
    expect(result).toBe("partial.md — (no description)");
  });

  it("lists multiple files sorted by filename", () => {
    const dir = join(tmpDir, "meditations", "illuminations");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "2026-04-08T1100-second.md"), "---\ndate: 2026-04-08\ndescription: Second insight.\n---\n\n# Second");
    writeFileSync(join(dir, "2026-04-08T0900-first.md"), "---\ndate: 2026-04-08\ndescription: First insight.\n---\n\n# First");
    const result = listIlluminations(tmpDir);
    expect(result).toBe(
      "2026-04-08T0900-first.md — First insight.\n2026-04-08T1100-second.md — Second insight."
    );
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

```bash
cd /Users/josu/Documents/projects/ralph-cli && npm test -- --reporter=verbose src/cli/tests/illumination-server.test.ts 2>&1 | grep -E "(FAIL|PASS|✓|×|listIlluminations)" | head -20
```

Expected: `listIlluminations` tests fail with "not exported" or similar.

- [x] **Step 3: Add `listIlluminations` and helper to `src/cli/mcp/illumination-server.ts`**

Add after the `listMetaMeditations` function (around line 78):

```typescript
const NO_ILLUMINATIONS_MESSAGE = "No illuminations found.";

function parseIlluminationDescription(filePath: string): string {
  try {
    const content = readFileSync(filePath, "utf8");
    if (!content.startsWith("---\n")) return "(no description)";
    const end = content.indexOf("\n---\n", 4);
    if (end === -1) return "(no description)";
    const frontmatter = content.slice(4, end);
    const match = frontmatter.match(/^description:\s*(.+)$/m);
    return match ? match[1].trim() : "(no description)";
  } catch {
    return "(no description)";
  }
}

export function listIlluminations(projectRoot: string): string {
  const dir = join(projectRoot, "meditations", "illuminations");
  try {
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .sort();
    if (files.length === 0) return NO_ILLUMINATIONS_MESSAGE;
    return files
      .map((f) => `${f} — ${parseIlluminationDescription(join(dir, f))}`)
      .join("\n");
  } catch {
    return NO_ILLUMINATIONS_MESSAGE;
  }
}
```

- [x] **Step 4: Run tests to verify they pass**

```bash
cd /Users/josu/Documents/projects/ralph-cli && npm test -- --reporter=verbose src/cli/tests/illumination-server.test.ts 2>&1 | grep -E "(FAIL|PASS|✓|×)" | head -30
```

Expected: all tests pass.

- [x] **Step 5: Update MCP tool registrations in `src/cli/mcp/illumination-server.ts`**

**Update `write_illumination` tool** — add `description` to schema and handler. Find the existing `write_illumination` tool block and replace it:

```typescript
server.tool(
  "write_illumination",
  "Write a meditation illumination file to meditations/illuminations/. " +
    "Use filename format: YYYY-MM-DDTHHMM-kebab-slug.md (e.g. 2026-04-04T1430-my-insight.md). " +
    "Provide a one-sentence description summarizing the core insight — this is required.",
  {
    filename: z.string(),
    description: z.string(),
    content: z.string(),
  },
  async ({ filename, description, content }: { filename: string; description: string; content: string }) => {
    try {
      const filePath = writeIllumination(projectRoot, filename, description, content);
      return {
        content: [{ type: "text" as const, text: `Written to ${filePath}` }],
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text" as const, text: `Error: ${msg}` }],
      };
    }
  },
);
```

**Add `list_illuminations` tool** — insert after the updated `write_illumination` block:

```typescript
server.tool(
  "list_illuminations",
  "List all illuminations written to this project, with descriptions. " +
    "Call this at the start of a session to orient yourself before writing new insights.",
  {},
  async () => {
    const result = listIlluminations(projectRoot);
    return { content: [{ type: "text" as const, text: result }] };
  },
);
```

- [x] **Step 6: Build to verify no TypeScript errors**

```bash
cd /Users/josu/Documents/projects/ralph-cli && npm run build 2>&1 | tail -20
```

Expected: clean build with no errors.

- [x] **Step 7: Run full test suite**

```bash
cd /Users/josu/Documents/projects/ralph-cli && npm test 2>&1 | tail -20
```

Expected: all tests pass.

- [x] **Step 8: Commit**

```bash
cd /Users/josu/Documents/projects/ralph-cli && git add src/cli/mcp/illumination-server.ts src/cli/tests/illumination-server.test.ts && git commit -m "feat: add list_illuminations MCP tool with frontmatter parsing"
```

---

## Chunk 2: Prompt + Backfill + Docs

### Task 3: Update `PROMPT_meditation.md`

**Files:**
- Modify: `src/cli/prompts/PROMPT_meditation.md`

Two additions:
1. Before step 1, add a step 0 to call `list_illuminations`
2. Update the `write_illumination` instruction to require `description`

- [x] **Step 1: Read the current prompt**

Open `src/cli/prompts/PROMPT_meditation.md` and locate:
- The numbered task list (steps 1–6)
- The `write_illumination` instruction near step 6

- [x] **Step 2: Add `list_illuminations` step at the start of the task list**

Insert as the new step 1, shifting all existing steps up by one:

```markdown
1. Call `list_illuminations` with no arguments to see what has already been written. Review the
   list before exploring — your illumination should build on, contradict, or deepen prior
   observations rather than restate them.
```

So the task list becomes steps 1–7 (new `list_illuminations` → existing `project_tree` → existing
`glob_files`/`read_file` → ... → `write_illumination`).

- [x] **Step 3: Update the `write_illumination` instruction**

Find the block describing how to call `write_illumination` (around step 6/7 after the shift). Update
it to include `description`:

```markdown
- When you are ready to record the illumination, call `write_illumination` with:
  - `filename`: use the format `YYYY-MM-DDTHHMM-kebab-slug.md` (example: `2026-04-04T1430-the-thing-i-noticed.md`). No colons in the filename.
  - `description`: a single sentence summarizing the core insight. This will appear in `list_illuminations` for future sessions — write it as if orienting someone who will read only this line.
  - `content`: the full markdown content of the illumination (body only — no frontmatter, that is added automatically).
  Do not use the `Write` tool directly — it is not available in this session.
```

- [x] **Step 4: Commit**

```bash
cd /Users/josu/Documents/projects/ralph-cli && git add src/cli/prompts/PROMPT_meditation.md && git commit -m "feat: add list_illuminations step and description requirement to PROMPT_meditation.md"
```

---

### Task 4: Backfill existing illuminations with frontmatter

**Files:**
- Modify: `meditations/illuminations/*.md` (7 files)

This task is done by a subagent. Launch it with the following instructions — do NOT edit these files manually.

- [x] **Step 1: Dispatch subagent to backfill all 7 files**

Dispatch a `general-purpose` agent with this prompt:

```
Add YAML frontmatter to 7 existing illumination files in
/Users/josu/Documents/projects/ralph-cli/meditations/illuminations/.

For each file:
- Read the file
- Extract a one-sentence description from the # Title line and opening of ## Core Idea
  (capture the actual takeaway, not a restatement of the filename)
- Prepend this frontmatter block (preserving the existing markdown body exactly):
  ---
  date: 2026-04-08
  description: <extracted one-sentence description>
  ---

  (blank line before the first heading)

Files to process:
1. 2026-04-05T0900-meditation-agent-is-blind-to-its-own-outputs.md
2. 2026-04-05T1045-basename-dirname-is-a-fragile-contract.md
3. 2026-04-05T1200-phase-boundaries-must-be-explicit-in-prompts.md
4. 2026-04-05T1400-private-env-detection-is-an-untested-assumption.md
5. 2026-04-05T1530-two-phase-session-abstraction-threshold-reached.md
6. 2026-04-08T0900-scenario-runs-are-stale-evidence.md
7. 2026-04-08T1100-ctx-count-is-lost-on-mixed-content-agent-dispatch.md

After editing all 7 files, commit with:
git -C /Users/josu/Documents/projects/ralph-cli add meditations/illuminations/
git -C /Users/josu/Documents/projects/ralph-cli commit -m "chore: backfill frontmatter on existing illuminations"
```

- [x] **Step 2: Verify backfill**

```bash
cd /Users/josu/Documents/projects/ralph-cli && for f in meditations/illuminations/*.md; do echo "=== $f ==="; head -4 "$f"; done
```

Expected: every file starts with `---`, followed by `date: 2026-04-08` and a `description:` line.

---

### Task 5: Update `specs/mcp-illumination.md`

**Files:**
- Modify: `specs/mcp-illumination.md`

- [x] **Step 1: Read the current spec**

Open `specs/mcp-illumination.md` and locate the MCP Tools table and the `write_illumination` section.

- [x] **Step 2: Update the tools table**

Add `list_illuminations` as a new row in the MCP Tools table:

```markdown
| `list_illuminations` | `<projectRoot>/meditations/illuminations/` (read-only) |
```

- [x] **Step 3: Update `write_illumination` section**

Update the params description to include `description`:

```markdown
- **Params:** `{ filename: string, description: string, content: string }`
- `description` is required — one sentence summarizing the core insight; auto-inserted into frontmatter
- `date` is auto-generated server-side (`YYYY-MM-DD`); not a param
- `content` is the markdown body only — frontmatter is prepended automatically
```

- [x] **Step 4: Add `list_illuminations` section**

```markdown
### `list_illuminations`

Lists all illuminations written to this project, with descriptions.

- **Params:** none
- **Reads from** `<projectRoot>/meditations/illuminations/`
- **Returns** one line per file: `<filename> — <description>` (sorted by filename)
- Files without frontmatter show `(no description)`
- Returns `"No illuminations found."` if directory is empty or missing
```

- [x] **Step 5: Commit**

```bash
cd /Users/josu/Documents/projects/ralph-cli && git add specs/mcp-illumination.md && git commit -m "docs: update mcp-illumination spec with list_illuminations and description param"
```
