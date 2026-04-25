---
status: implemented
---

# Meditate Tool Whitelist Gap — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `list_illuminations` to the meditate agent's tool whitelist and prompt so the agent can orient itself against prior illuminations in step 1.

**Architecture:** Two files need a one-line addition each: the agent YAML frontmatter (`meditate.md`) gets `mcp__illumination__list_illuminations` in its `tools:` list, and the prompt file (`PROMPT_meditation.md`) gets `list_illuminations` in its Tools Available section. A unit test verifies the whitelist contains all 8 server-registered tools.

**Tech Stack:** TypeScript, Vitest, YAML frontmatter parsing.

---

## Files

| Action | Path | What changes |
|---|---|---|
| Modify | `src/cli/agents/meditate.md` | Add `list_illuminations` to `tools:` whitelist |
| Modify | `src/cli/prompts/PROMPT_meditation.md` | Add `list_illuminations` to Tools Available section |
| Modify | `src/cli/tests/meditate.test.ts` | Add whitelist-completeness test |

---

## Chunk 1: Whitelist fix with TDD

### Task 1: Write failing test for whitelist completeness

**Files:**
- Modify: `src/cli/tests/meditate.test.ts`

- [ ] **Step 1: Write failing test that asserts `list_illuminations` is in the whitelist**

Add a new `describe` block at the end of `src/cli/tests/meditate.test.ts`:

```typescript
describe("meditate agent tool whitelist", () => {
  it("includes list_illuminations in the tools list", () => {
    const agentMd = readFileSync(
      join(__dirname, "..", "agents", "meditate.md"),
      "utf-8",
    );
    const toolsMatch = agentMd.match(/^tools:\n((?:\s+-\s+.+\n)+)/m);
    expect(toolsMatch).not.toBeNull();
    const tools = toolsMatch![1]
      .split("\n")
      .map((l) => l.replace(/^\s+-\s+/, "").trim())
      .filter(Boolean);
    expect(tools).toContain("mcp__illumination__list_illuminations");
  });

  it("whitelists all 8 illumination server tools", () => {
    const agentMd = readFileSync(
      join(__dirname, "..", "agents", "meditate.md"),
      "utf-8",
    );
    const toolsMatch = agentMd.match(/^tools:\n((?:\s+-\s+.+\n)+)/m);
    expect(toolsMatch).not.toBeNull();
    const tools = toolsMatch![1]
      .split("\n")
      .map((l) => l.replace(/^\s+-\s+/, "").trim())
      .filter(Boolean);
    expect(tools).toHaveLength(8);

    const expected = [
      "mcp__illumination__list_illuminations",
      "mcp__illumination__read_file",
      "mcp__illumination__glob_files",
      "mcp__illumination__project_tree",
      "mcp__illumination__write_illumination",
      "mcp__illumination__mark_implemented",
      "mcp__illumination__list_meta_meditations",
      "mcp__illumination__read_meta_meditation",
    ];
    for (const tool of expected) {
      expect(tools).toContain(tool);
    }
  });
});
```

Note: `readFileSync` and `join` are already imported at the top of the file. No new imports needed.

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/cli/tests/meditate.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: the `list_illuminations` test fails — the tool is not in the current whitelist. The "all 8 tools" test also fails (only 7 present).

- [ ] **Step 3: Commit the failing tests**

```bash
git add src/cli/tests/meditate.test.ts
git commit -m "test(meditate): add failing tests for tool whitelist completeness"
```

---

### Task 2: Add `list_illuminations` to agent whitelist

**Files:**
- Modify: `src/cli/agents/meditate.md:6-13`

- [ ] **Step 1: Add `mcp__illumination__list_illuminations` as first entry in the tools list**

The `tools:` section currently starts at line 6. Insert `list_illuminations` as the first tool entry (reflecting its role as the session-orientation tool called in step 1):

```yaml
tools:
  - mcp__illumination__list_illuminations
  - mcp__illumination__read_file
  - mcp__illumination__glob_files
  - mcp__illumination__project_tree
  - mcp__illumination__write_illumination
  - mcp__illumination__mark_implemented
  - mcp__illumination__list_meta_meditations
  - mcp__illumination__read_meta_meditation
```

- [ ] **Step 2: Run tests to verify they pass**

```bash
npx vitest run src/cli/tests/meditate.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: both new tests pass. All existing tests still pass.

- [ ] **Step 3: Commit**

```bash
git add src/cli/agents/meditate.md
git commit -m "feat(meditate): add list_illuminations to agent tool whitelist

The tool was registered in the MCP server and referenced in prompt
instructions but missing from the dontAsk whitelist, causing silent
auto-denial every session."
```

---

### Task 3: Add `list_illuminations` to PROMPT_meditation.md Tools Available section

**Files:**
- Modify: `src/cli/prompts/PROMPT_meditation.md`

- [ ] **Step 1: Read the file to confirm current state**

```bash
cat src/cli/prompts/PROMPT_meditation.md
```

Confirm: the Tools Available section lists `project_tree`, `glob_files`, `read_file`, `list_meta_meditations`, `read_meta_meditation`, and `write_illumination` / `mark_implemented` — but not `list_illuminations`.

- [ ] **Step 2: Add `list_illuminations` to the Tools Available section**

After the line `You have tools for exploring the project:` and before `project_tree`, add:

```markdown
- `list_illuminations` — call with no arguments to see a summary of all existing illuminations
  (filename and description). Use this first to orient against prior observations.
```

This matches the instruction in step 1 which already says "Call `list_illuminations` with no arguments".

- [ ] **Step 3: Run full test suite to verify no regressions**

```bash
npx vitest run 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 4: Build to verify no compilation errors**

```bash
npm run build 2>&1 | tail -10
```

Expected: clean build.

- [ ] **Step 5: Commit**

```bash
git add src/cli/prompts/PROMPT_meditation.md
git commit -m "feat(meditate): add list_illuminations to prompt Tools Available section

Syncs PROMPT_meditation.md with the agent whitelist and MCP server
registration. Both files now document all 8 illumination tools."
```
