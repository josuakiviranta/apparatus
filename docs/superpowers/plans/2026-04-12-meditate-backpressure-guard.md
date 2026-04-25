---
status: pending
---

# Meditate Backpressure Guard — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a pre-session backlog guard to `meditateCommand()` that counts illumination files and exits early when the backlog meets or exceeds a configurable threshold. Bypass via `--force` flag or `RALPH_MEDITATE_MAX_OPEN` env var.

**Architecture:** Add `countIlluminations(projectPath)` to `meditate.ts` that counts `*.md` files in `meditations/illuminations/`. Insert guard logic after the PID lock check (line 127) and before `runMeditationSession()` (line 131). Register `--force` on the Commander `meditate` subcommand in `program.ts`. Default threshold: 5.

**Tech Stack:** TypeScript, Node `fs`, Commander, Vitest

---

## Files

| Action | Path | What changes |
|---|---|---|
| Modify | `src/cli/commands/meditate.ts` | Add `countIlluminations()`; add guard logic; accept `force` option |
| Modify | `src/cli/program.ts` | Add `--force` option to meditate Commander registration |
| Modify | `src/cli/tests/meditate.test.ts` | Add tests for `countIlluminations` and backpressure guard |

---

## Chunk 1: `countIlluminations` with TDD

### Task 1: Write failing tests for `countIlluminations`

**Files:**
- Modify: `src/cli/tests/meditate.test.ts`

- [ ] **Step 1: Add `countIlluminations` to the named import**

At the top of `src/cli/tests/meditate.test.ts`, add `countIlluminations` to the existing import from `../commands/meditate`:

```typescript
import {
  pidPath,
  writePid,
  readPid,
  removePid,
  isPidAlive,
  ensureMeditationDirs,
  appendMeditateGitignore,
  runMeditationSession,
  meditateCommand,
  meditateKillCommand,
  countIlluminations,   // <-- add this
} from "../commands/meditate";
```

- [ ] **Step 2: Write test block for `countIlluminations`**

Append a new `describe` block after the existing blocks:

```typescript
describe("countIlluminations", () => {
  it("returns 0 when illuminations directory is empty", () => {
    ensureMeditationDirs(tmpDir);
    expect(countIlluminations(tmpDir)).toBe(0);
  });

  it("counts only .md files in meditations/illuminations/", () => {
    ensureMeditationDirs(tmpDir);
    const illumDir = join(tmpDir, "meditations", "illuminations");
    writeFileSync(join(illumDir, "2026-04-12T0300-bug-a.md"), "# Bug A");
    writeFileSync(join(illumDir, "2026-04-12T0400-bug-b.md"), "# Bug B");
    writeFileSync(join(illumDir, "not-a-markdown.txt"), "ignored");
    expect(countIlluminations(tmpDir)).toBe(2);
  });

  it("returns 0 when illuminations directory does not exist", () => {
    expect(countIlluminations(tmpDir)).toBe(0);
  });
});
```

Note: `writeFileSync` is already imported from `fs` at the top of the test file.

- [ ] **Step 3: Run the tests to confirm they fail**

Run: `npm test -- src/cli/tests/meditate.test.ts`

Expected: the three new `countIlluminations` tests FAIL with "countIlluminations is not a function" or "countIlluminations is not exported". All existing tests PASS.

---

### Task 2: Implement `countIlluminations`

**Files:**
- Modify: `src/cli/commands/meditate.ts`

- [ ] **Step 1: Add `readdirSync` to the fs import**

At line 1 of `src/cli/commands/meditate.ts`, add `readdirSync` to the existing import:

```typescript
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync } from "fs";
```

- [ ] **Step 2: Add `countIlluminations` function**

After the `ensureMeditationDirs` function (around line 45), add:

```typescript
export function countIlluminations(projectFolder: string): number {
  const illumDir = join(projectFolder, "meditations", "illuminations");
  if (!existsSync(illumDir)) return 0;
  return readdirSync(illumDir).filter((f) => f.endsWith(".md")).length;
}
```

- [ ] **Step 3: Run tests — expect green**

Run: `npm test -- src/cli/tests/meditate.test.ts`

Expected: ALL tests pass including the three new `countIlluminations` tests.

- [ ] **Step 4: Commit Chunk 1**

```bash
git add src/cli/commands/meditate.ts src/cli/tests/meditate.test.ts
git commit -m "feat(meditate): add countIlluminations utility with tests"
```

---

## Chunk 2: Backpressure guard logic and `--force` flag

### Task 3: Write failing tests for the backpressure guard

**Files:**
- Modify: `src/cli/tests/meditate.test.ts`

- [ ] **Step 1: Write tests for backpressure guard behavior**

Append a new `describe` block:

```typescript
describe("meditateCommand backpressure guard", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("exits early with warning when illumination count >= threshold", async () => {
    ensureMeditationDirs(tmpDir);
    const illumDir = join(tmpDir, "meditations", "illuminations");
    for (let i = 0; i < 5; i++) {
      writeFileSync(join(illumDir, `illum-${i}.md`), `# Illumination ${i}`);
    }
    await meditateCommand(tmpDir);
    const { warn } = await import("../lib/output.js");
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("5 illuminations are waiting"),
    );
  });

  it("proceeds when illumination count < threshold", async () => {
    ensureMeditationDirs(tmpDir);
    const illumDir = join(tmpDir, "meditations", "illuminations");
    writeFileSync(join(illumDir, "illum-0.md"), "# Illumination 0");
    await meditateCommand(tmpDir);
    const { warn } = await import("../lib/output.js");
    expect(warn).not.toHaveBeenCalledWith(
      expect.stringContaining("illuminations are waiting"),
    );
  });

  it("bypasses guard when --force is set", async () => {
    ensureMeditationDirs(tmpDir);
    const illumDir = join(tmpDir, "meditations", "illuminations");
    for (let i = 0; i < 6; i++) {
      writeFileSync(join(illumDir, `illum-${i}.md`), `# Illumination ${i}`);
    }
    await meditateCommand(tmpDir, { force: true });
    const { warn } = await import("../lib/output.js");
    expect(warn).not.toHaveBeenCalledWith(
      expect.stringContaining("illuminations are waiting"),
    );
  });

  it("respects RALPH_MEDITATE_MAX_OPEN env var", async () => {
    vi.stubEnv("RALPH_MEDITATE_MAX_OPEN", "10");
    ensureMeditationDirs(tmpDir);
    const illumDir = join(tmpDir, "meditations", "illuminations");
    for (let i = 0; i < 8; i++) {
      writeFileSync(join(illumDir, `illum-${i}.md`), `# Illumination ${i}`);
    }
    await meditateCommand(tmpDir);
    const { warn } = await import("../lib/output.js");
    expect(warn).not.toHaveBeenCalledWith(
      expect.stringContaining("illuminations are waiting"),
    );
  });
});
```

- [ ] **Step 2: Run tests to confirm failures**

Run: `npm test -- src/cli/tests/meditate.test.ts`

Expected: the four new backpressure guard tests FAIL (no guard logic exists yet, and `force` is not an accepted option). Existing tests PASS.

---

### Task 4: Implement the backpressure guard in `meditateCommand`

**Files:**
- Modify: `src/cli/commands/meditate.ts`

- [ ] **Step 1: Update `meditateCommand` signature to accept `force`**

At line 113, change the function signature:

```typescript
// before
export async function meditateCommand(projectFolder: string, opts: { steer?: string } = {}): Promise<void> {
// after
export async function meditateCommand(projectFolder: string, opts: { steer?: string; force?: boolean } = {}): Promise<void> {
```

- [ ] **Step 2: Insert backpressure guard after PID lock check**

After the PID lock check block (after line 128 — the closing brace of the `if (runningPid !== null && isPidAlive(runningPid))` block) and before `ensureMeditationDirs(absPath)` or `runMeditationSession()`, insert:

```typescript
  if (!opts.force) {
    const threshold = parseInt(process.env.RALPH_MEDITATE_MAX_OPEN ?? "5", 10);
    const count = countIlluminations(absPath);
    if (count >= threshold) {
      await output.warn(
        `${count} illuminations are waiting to be processed (threshold: ${threshold}).\n` +
        `Run the illumination pipeline first, or archive resolved files.\n` +
        `Use --force to bypass this check.`
      );
      return;
    }
  }
```

Place this **after** `ensureMeditationDirs(absPath)` (line 129) and the PID lock check, but **before** `await runMeditationSession(absPath, opts.steer)` (line 131). The guard needs the directories to exist for `countIlluminations` to read them.

- [ ] **Step 3: Run tests — expect green**

Run: `npm test -- src/cli/tests/meditate.test.ts`

Expected: ALL tests pass including the four new backpressure guard tests.

---

### Task 5: Add `--force` to Commander registration

**Files:**
- Modify: `src/cli/program.ts`

- [ ] **Step 1: Add `--force` option to the meditate subcommand**

In `src/cli/program.ts`, find the meditate command registration (around line 118–122). Add the `--force` option and update the action signature:

```typescript
// before (around lines 118-122)
  .argument("<project-folder>")
  .option("--steer <text>", "initial steering message injected as first user turn")
  .action(async (projectFolder: string, opts: { steer?: string }) => {
    await meditateCommand(projectFolder, opts);
  });

// after
  .argument("<project-folder>")
  .option("--steer <text>", "initial steering message injected as first user turn")
  .option("--force", "bypass backpressure guard (skip illumination backlog check)")
  .action(async (projectFolder: string, opts: { steer?: string; force?: boolean }) => {
    await meditateCommand(projectFolder, opts);
  });
```

- [ ] **Step 2: Run full test suite**

Run: `npm test`

Expected: all tests pass, no regressions.

- [ ] **Step 3: Build**

Run: `npm run build`

Expected: build succeeds with no TypeScript errors.

- [ ] **Step 4: Commit Chunk 2**

```bash
git add src/cli/commands/meditate.ts src/cli/program.ts src/cli/tests/meditate.test.ts
git commit -m "feat(meditate): add backpressure guard with --force bypass

Counts .md files in meditations/illuminations/ before starting a session.
When count >= threshold (default 5), prints warning and exits 0.
Override threshold via RALPH_MEDITATE_MAX_OPEN env var.
Bypass entirely with --force flag."
```
