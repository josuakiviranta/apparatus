---
status: implemented
---

# Illumination Auto-Commit Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-commit illumination files to git immediately after `write_illumination` writes them to disk, so they are durable against `git clean`, branch switches, and worktree cleanup.

**Architecture:** After the existing `writeFileSync` call in the `write_illumination` handler in `illumination-server.ts`, run `execSync` for `git add` and `git commit`. Wrap in try/catch so git failures never break the tool call (fail-open). No new dependencies — uses `node:child_process`.

**Tech Stack:** TypeScript, Node `child_process.execSync`, vitest

**Design Doc:** `docs/superpowers/specs/2026-04-12-illumination-auto-commit-design.md`

---

## Chunk 1: Add auto-commit to `write_illumination` with tests

### Task 1: Write failing tests for git auto-commit behavior

**Files:**
- Modify: `src/cli/tests/illumination-server.test.ts`

- [ ] **Step 1: Add `execSync` mock infrastructure**

At the top of `src/cli/tests/illumination-server.test.ts`, add a mock for `node:child_process` that captures `execSync` calls:

```typescript
import { vi } from "vitest";

const mockExecSync = vi.fn();
vi.mock("node:child_process", () => ({
  execSync: mockExecSync,
}));
```

If `node:child_process` is already imported/mocked in the file, extend the existing mock to include `execSync` tracking.

- [ ] **Step 2: Write test — `write_illumination` calls `git add` then `git commit`**

Add a new `describe("write_illumination auto-commit")` block:

```typescript
describe("write_illumination auto-commit", () => {
  beforeEach(() => {
    mockExecSync.mockClear();
  });

  it("calls git add then git commit after writing the file", async () => {
    // Call write_illumination with valid arguments (use existing test patterns)
    // Assert mockExecSync was called twice
    // First call: git -C <projectRoot> add <filePath>
    // Second call: git -C <projectRoot> commit -m "meditate: add illumination <filename>"
    const calls = mockExecSync.mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][0]).toMatch(/git -C .+ add .+/);
    expect(calls[1][0]).toMatch(/git -C .+ commit -m "meditate: add illumination .+"/);
  });
```

- [ ] **Step 3: Write test — tool returns success when `execSync` throws (fail-open)**

```typescript
  it("returns success even when git commands fail", async () => {
    mockExecSync.mockImplementation(() => {
      throw new Error("git not found");
    });
    // Call write_illumination — should NOT throw
    // Assert the tool response indicates success (file was written)
  });
```

- [ ] **Step 4: Write test — idempotent re-write does not throw on "nothing to commit"**

```typescript
  it("handles 'nothing to commit' gracefully on re-write", async () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes("commit")) {
        throw new Error("nothing to commit, working tree clean");
      }
    });
    // Call write_illumination — should NOT throw
    // Assert tool response indicates success
  });
});
```

- [ ] **Step 5: Run tests to confirm failures**

Run: `npm test -- src/cli/tests/illumination-server.test.ts`

Expected: the three new `write_illumination auto-commit` tests FAIL (execSync not called / not imported yet). All existing tests PASS.

---

### Task 2: Implement auto-commit in `write_illumination` handler

**Files:**
- Modify: `src/cli/mcp/illumination-server.ts`

- [ ] **Step 1: Add `execSync` import**

At the top of `src/cli/mcp/illumination-server.ts`, add:

```typescript
import { execSync } from "node:child_process";
```

- [ ] **Step 2: Add git add + git commit after `writeFileSync`**

In the `write_illumination` handler, immediately after the `writeFileSync(filePath, content)` call (around line 280), add:

```typescript
try {
  execSync(`git -C "${projectRoot}" add "${filePath}"`, { stdio: "ignore" });
  execSync(
    `git -C "${projectRoot}" commit -m "meditate: add illumination ${filename}"`,
    { stdio: "ignore" }
  );
} catch {
  // git not available, not a git repo, or nothing to commit (idempotent re-run).
  // The file is already written; commit failure must not break the tool call.
}
```

- [ ] **Step 3: Run tests — expect green**

Run: `npm test -- src/cli/tests/illumination-server.test.ts`

Expected: ALL tests pass including the three new `write_illumination auto-commit` tests.

- [ ] **Step 4: Run full test suite**

Run: `npm test`

Expected: all tests pass, no regressions.

- [ ] **Step 5: Build**

Run: `npm run build`

Expected: build succeeds with no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add src/cli/mcp/illumination-server.ts src/cli/tests/illumination-server.test.ts
git commit -m "feat(meditate): auto-commit illuminations after write_illumination"
```
