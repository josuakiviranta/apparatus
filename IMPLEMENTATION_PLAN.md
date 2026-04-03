# ralph meditate Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `ralph meditate <project-folder>` command that runs a permission-restricted Claude session to reflect on the project and write structured illumination files, with optional cron-based scheduling.

**Architecture:** Three self-contained chunks — asset infrastructure first (bundled prompt + helper), then the meditate command with all pure utility functions tested in isolation, then CLI wiring and ralph new scaffolding update. The stream-json output rendering is implemented inline in `meditate.ts` (same pattern as `new.ts`), not extracted, per the code reuse note in the spec.

**Tech Stack:** TypeScript, Node.js `fs`/`child_process`, vitest (tests), tsup (build), system `crontab` command

**Spec:** `docs/superpowers/specs/2026-04-03-ralph-meditate-design.md`

---

## Chunk 1: Asset Infrastructure

Add the bundled `PROMPT_meditation.md` and the `getMeditationPromptPath()` helper.

### Task 1: Create `PROMPT_meditation.md` and `getMeditationPromptPath()` (TDD)

**Files:**
- Create: `src/cli/prompts/PROMPT_meditation.md`
- Modify: `src/cli/lib/assets.ts`
- Modify: `src/cli/tests/assets.test.ts`

- [ ] **Step 1: Write the failing test**

In `src/cli/tests/assets.test.ts`, add `getMeditationPromptPath` to the import and add one test inside the existing `describe("assets", ...)` block:

```typescript
import { getAssetPath, getLoopShPath, getPromptPath, getKickoffPromptPath, getMeditationPromptPath } from "../lib/assets";

// inside describe("assets", ...) block:
it("getMeditationPromptPath returns a path ending in PROMPT_meditation.md", () => {
  const p = getMeditationPromptPath();
  expect(p).toMatch(/PROMPT_meditation\.md$/);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/cli/tests/assets.test.ts
```

Expected: FAIL — `getMeditationPromptPath is not a function`

- [ ] **Step 3: Add `getMeditationPromptPath()` to `assets.ts`**

Append to `src/cli/lib/assets.ts` after `getKickoffPromptPath`:

```typescript
export function getMeditationPromptPath(): string {
  return getAssetPath(join("prompts", "PROMPT_meditation.md"));
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/cli/tests/assets.test.ts
```

Expected: all tests PASS

- [ ] **Step 5: Create `PROMPT_meditation.md`**

Write `src/cli/prompts/PROMPT_meditation.md` with this exact content:

```markdown
You are a silent analyst for this software project. Your role is reflective, not executive — you observe, think, and write insights. You cannot and will not implement anything.

Your working context:
- Project files are available to read in the current directory
- Meditation files are in `meditations/` — these are themes, questions, or lenses to focus your reflection
- You may only write to `meditations/illuminations/`

Your task for this session:
1. Read the project files relevant to understanding the current state of the codebase, architecture, and plans
2. Read the meditation files in `meditations/` — choose which ones feel most relevant to what you observe in the code
3. Reflect deeply on the intersection: what does the project need, and what do the meditations reveal about it?
4. Write a single illumination file to `meditations/illuminations/` — choose a descriptive filename with a timestamp prefix (e.g. `2026-04-03T14:32-your-topic-here.md`)

The illumination file must contain exactly these sections:

## Core Idea
State the insight plainly in 2–4 sentences. No padding.

## Why It Matters
Connect it to the project's current situation, goals, or pain points. Be specific — reference actual files or patterns you observed.

## Revised Implementation Steps
Ordered, concrete steps a developer could act on tomorrow. Each step actionable enough to become a task. 3–7 steps max.

Write for a human who will read this in the morning. Be direct. No filler. No hedging.
```

- [ ] **Step 6: Run all tests to confirm nothing broke**

```bash
npx vitest run
```

Expected: all tests PASS

- [ ] **Step 7: Commit**

```bash
git add src/cli/prompts/PROMPT_meditation.md src/cli/lib/assets.ts src/cli/tests/assets.test.ts
git commit -m "feat: add PROMPT_meditation.md and getMeditationPromptPath helper"
```

---

## Chunk 2: meditate command

### Task 2: Pure cron utilities in `meditate.ts` (TDD)

These functions are pure (no side effects) and fully unit-testable. All go in `src/cli/commands/meditate.ts`.

**Files:**
- Create: `src/cli/commands/meditate.ts`
- Create: `src/cli/tests/meditate.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/cli/tests/meditate.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  cronId,
  buildCronExpression,
  isCleanInterval,
  buildCronLine,
  insertCronEntry,
  deleteCronEntry,
} from "../commands/meditate";

describe("cronId", () => {
  it("returns ralph-meditate-<basename>", () => {
    expect(cronId("/home/user/my-project")).toBe("ralph-meditate-my-project");
    expect(cronId("/projects/foo-bar")).toBe("ralph-meditate-foo-bar");
  });
});

describe("buildCronExpression", () => {
  it("returns */N * * * * for given minutes", () => {
    expect(buildCronExpression(30)).toBe("*/30 * * * *");
    expect(buildCronExpression(60)).toBe("*/60 * * * *");
    expect(buildCronExpression(15)).toBe("*/15 * * * *");
  });
});

describe("isCleanInterval", () => {
  it("returns true for values that divide 60", () => {
    for (const n of [1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30, 60]) {
      expect(isCleanInterval(n), `${n} should be clean`).toBe(true);
    }
  });

  it("returns false for values that do not divide 60", () => {
    for (const n of [7, 11, 13, 17, 25, 45]) {
      expect(isCleanInterval(n), `${n} should not be clean`).toBe(false);
    }
  });
});

describe("buildCronLine", () => {
  it("includes the cron expression, ralph meditate command, and bash log redirect", () => {
    const line = buildCronLine("/abs/project", 30);
    expect(line).toContain("*/30 * * * *");
    expect(line).toContain("ralph meditate /abs/project");
    expect(line).toContain(".meditate.log");
    expect(line).toContain("&>>");
  });
});

describe("insertCronEntry", () => {
  it("appends cron line and anchor to empty crontab", () => {
    const result = insertCronEntry("", "*/30 * * * * ralph meditate /p >> /p/.meditate.log 2>&1", "# ralph-meditate-p");
    expect(result).toContain("*/30 * * * *");
    expect(result).toContain("# ralph-meditate-p");
  });

  it("appends to existing crontab with newline separator", () => {
    const existing = "0 * * * * some-other-job\n";
    const result = insertCronEntry(existing, "*/30 * * * * ralph meditate /p >> /p/.meditate.log 2>&1", "# ralph-meditate-p");
    expect(result).toContain("some-other-job");
    expect(result).toContain("# ralph-meditate-p");
  });

  it("is idempotent — does not insert twice if anchor already present", () => {
    const existing = "*/30 * * * * ralph meditate /p >> /p/.meditate.log 2>&1\n# ralph-meditate-p\n";
    const result = insertCronEntry(existing, "*/30 * * * * ralph meditate /p >> /p/.meditate.log 2>&1", "# ralph-meditate-p");
    expect(result).toBe(existing);
  });
});

describe("deleteCronEntry", () => {
  it("removes cron line and anchor from crontab", () => {
    const crontab = "0 * * * * other-job\n*/30 * * * * ralph meditate /p >> /p/.meditate.log 2>&1\n# ralph-meditate-p\n";
    const result = deleteCronEntry(crontab, "# ralph-meditate-p");
    expect(result).not.toContain("# ralph-meditate-p");
    expect(result).not.toContain("ralph meditate /p");
    expect(result).toContain("other-job");
  });

  it("returns crontab unchanged if anchor not found", () => {
    const crontab = "0 * * * * other-job\n";
    expect(deleteCronEntry(crontab, "# ralph-meditate-missing")).toBe(crontab);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/cli/tests/meditate.test.ts
```

Expected: FAIL — `cronId is not a function` (module does not exist yet)

- [ ] **Step 3: Create `meditate.ts` with pure utility functions**

Create `src/cli/commands/meditate.ts` with the following content (pure exports only — no main command yet):

```typescript
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { join, resolve, basename } from "path";
import { spawnSync, spawn } from "child_process";
import { getMeditationPromptPath } from "../lib/assets";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MeditationSentinel {
  every: number;
  until?: string;
  cronId: string;
}

export interface MeditateOptions {
  every?: number;
  until?: string;
}

// ─── Pure utilities ───────────────────────────────────────────────────────────

export function cronId(projectFolder: string): string {
  return `ralph-meditate-${basename(projectFolder)}`;
}

export function buildCronExpression(every: number): string {
  return `*/${every} * * * *`;
}

export function isCleanInterval(every: number): boolean {
  return [1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30, 60].includes(every);
}

export function buildCronLine(projectFolder: string, every: number): string {
  const logPath = join(projectFolder, ".meditate.log");
  // Use /bin/bash -c to support &>> (redirect stdout+stderr) — matches spec
  return `${buildCronExpression(every)} /bin/bash -c 'ralph meditate ${projectFolder} &>> ${logPath}'`;
}

export function insertCronEntry(crontab: string, cronLine: string, anchor: string): string {
  if (crontab.includes(anchor)) return crontab;
  const sep = crontab.length > 0 && !crontab.endsWith("\n") ? "\n" : "";
  return crontab + sep + cronLine + "\n" + anchor + "\n";
}

export function deleteCronEntry(crontab: string, anchor: string): string {
  const lines = crontab.split("\n");
  const anchorIdx = lines.findIndex((l) => l === anchor);
  if (anchorIdx === -1) return crontab;
  const removeFrom = anchorIdx > 0 ? anchorIdx - 1 : anchorIdx;
  const count = anchorIdx > 0 ? 2 : 1;
  lines.splice(removeFrom, count);
  return lines.join("\n");
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/cli/tests/meditate.test.ts
```

Expected: all pure utility tests PASS (sentinel/filesystem tests will fail — not written yet)

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/meditate.ts src/cli/tests/meditate.test.ts
git commit -m "feat: add meditate pure cron utilities with tests"
```

---

### Task 3: Filesystem utilities in `meditate.ts` (TDD)

**Files:**
- Modify: `src/cli/commands/meditate.ts`
- Modify: `src/cli/tests/meditate.test.ts`

- [ ] **Step 1: Add failing tests for filesystem utilities**

Append to `src/cli/tests/meditate.test.ts` (before the end of the file):

```typescript
import {
  readSentinel,
  writeSentinel,
  removeSentinel,
  ensureMeditationDirs,
  appendMeditateGitignore,
} from "../commands/meditate";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "ralph-meditate-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("readSentinel", () => {
  it("returns null when .meditate.json does not exist", () => {
    expect(readSentinel(tmpDir)).toBeNull();
  });

  it("returns parsed sentinel when .meditate.json exists", () => {
    const sentinel = { every: 30, cronId: "ralph-meditate-proj" };
    writeFileSync(join(tmpDir, ".meditate.json"), JSON.stringify(sentinel));
    expect(readSentinel(tmpDir)).toEqual(sentinel);
  });
});

describe("writeSentinel / removeSentinel", () => {
  it("writes and reads back a sentinel", () => {
    const sentinel: import("../commands/meditate").MeditationSentinel = {
      every: 60,
      until: "2026-04-05T08:00:00",
      cronId: "ralph-meditate-test",
    };
    writeSentinel(tmpDir, sentinel);
    expect(existsSync(join(tmpDir, ".meditate.json"))).toBe(true);
    expect(readSentinel(tmpDir)).toEqual(sentinel);
  });

  it("removeSentinel deletes the file if present", () => {
    writeSentinel(tmpDir, { every: 30, cronId: "ralph-meditate-test" });
    removeSentinel(tmpDir);
    expect(existsSync(join(tmpDir, ".meditate.json"))).toBe(false);
  });

  it("removeSentinel is a no-op if file does not exist", () => {
    expect(() => removeSentinel(tmpDir)).not.toThrow();
  });
});

describe("ensureMeditationDirs", () => {
  it("creates meditations/illuminations/ nested structure", () => {
    ensureMeditationDirs(tmpDir);
    expect(existsSync(join(tmpDir, "meditations", "illuminations"))).toBe(true);
  });

  it("is idempotent — does not throw if dirs already exist", () => {
    ensureMeditationDirs(tmpDir);
    expect(() => ensureMeditationDirs(tmpDir)).not.toThrow();
  });
});

describe("appendMeditateGitignore", () => {
  it("adds .meditate.json and .meditate.log to .gitignore", () => {
    appendMeditateGitignore(tmpDir);
    const content = readFileSync(join(tmpDir, ".gitignore"), "utf8");
    expect(content).toContain(".meditate.json");
    expect(content).toContain(".meditate.log");
  });

  it("creates .gitignore if it does not exist", () => {
    expect(existsSync(join(tmpDir, ".gitignore"))).toBe(false);
    appendMeditateGitignore(tmpDir);
    expect(existsSync(join(tmpDir, ".gitignore"))).toBe(true);
  });

  it("does not duplicate entries if called twice", () => {
    appendMeditateGitignore(tmpDir);
    appendMeditateGitignore(tmpDir);
    const content = readFileSync(join(tmpDir, ".gitignore"), "utf8");
    const count = (content.match(/\.meditate\.json/g) ?? []).length;
    expect(count).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify new ones fail**

```bash
npx vitest run src/cli/tests/meditate.test.ts
```

Expected: FAIL — `readSentinel is not a function`

- [ ] **Step 3: Add filesystem utilities to `meditate.ts`**

Append after the pure utilities section in `src/cli/commands/meditate.ts`:

```typescript
// ─── Filesystem utilities ────────────────────────────────────────────────────

export function readSentinel(projectFolder: string): MeditationSentinel | null {
  const p = join(projectFolder, ".meditate.json");
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8")) as MeditationSentinel;
}

export function writeSentinel(projectFolder: string, sentinel: MeditationSentinel): void {
  writeFileSync(join(projectFolder, ".meditate.json"), JSON.stringify(sentinel, null, 2) + "\n");
}

export function removeSentinel(projectFolder: string): void {
  const p = join(projectFolder, ".meditate.json");
  if (existsSync(p)) unlinkSync(p);
}

export function ensureMeditationDirs(projectFolder: string): void {
  mkdirSync(join(projectFolder, "meditations", "illuminations"), { recursive: true });
}

export function appendMeditateGitignore(projectFolder: string): void {
  const entries = [".meditate.json", ".meditate.log"];
  const gitignorePath = join(projectFolder, ".gitignore");
  const existing = existsSync(gitignorePath) ? readFileSync(gitignorePath, "utf8") : "";
  const lines = existing.split("\n");
  const toAdd = entries.filter((e) => !lines.includes(e));
  if (toAdd.length === 0) return;
  const sep = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
  writeFileSync(gitignorePath, existing + sep + toAdd.join("\n") + "\n");
}
```

- [ ] **Step 4: Run tests to verify all pass**

```bash
npx vitest run src/cli/tests/meditate.test.ts
```

Expected: all tests PASS

- [ ] **Step 5: Run full test suite to confirm no regressions**

```bash
npx vitest run
```

Expected: all tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/cli/commands/meditate.ts src/cli/tests/meditate.test.ts
git commit -m "feat: add meditate filesystem utilities with tests"
```

---

### Task 4: Main command logic in `meditate.ts`

**Files:**
- Modify: `src/cli/commands/meditate.ts`

- [ ] **Step 1: Add impure cron management functions**

Append after the filesystem utilities section in `src/cli/commands/meditate.ts`:

```typescript
// ─── Cron management ─────────────────────────────────────────────────────────

function readCurrentCrontab(): string {
  const result = spawnSync("crontab", ["-l"], { encoding: "utf8" });
  // exit code 1 with no crontab is normal on some systems
  return result.status === 0 ? result.stdout : "";
}

function writeCurrentCrontab(content: string): void {
  spawnSync("crontab", ["-"], { input: content, encoding: "utf8" });
}

function addCronEntry(projectFolder: string, every: number, id: string): void {
  const anchor = `# ${id}`;
  const cronLine = buildCronLine(projectFolder, every);
  const updated = insertCronEntry(readCurrentCrontab(), cronLine, anchor);
  writeCurrentCrontab(updated);
}

function removeCronEntry(id: string): void {
  const anchor = `# ${id}`;
  const updated = deleteCronEntry(readCurrentCrontab(), anchor);
  writeCurrentCrontab(updated);
}
```

- [ ] **Step 2: Add `runMeditationSession` function**

Append after the cron management section in `src/cli/commands/meditate.ts`:

```typescript
// ─── Session runner ───────────────────────────────────────────────────────────

async function runMeditationSession(absPath: string): Promise<void> {
  const illuminationsPath = resolve(join(absPath, "meditations", "illuminations"));
  const prompt = readFileSync(getMeditationPromptPath(), "utf8");

  const border = "━".repeat(40);
  console.log(border);
  console.log(`Mode:    meditate`);
  console.log(`Project: ${absPath}`);
  console.log(`PID:     ${process.pid} (kill ${process.pid} to stop)`);
  console.log(border);
  console.log();

  const args = [
    "--print",
    "--output-format", "stream-json",
    "--permission-mode", "dontAsk",
    "--allowedTools", "Read",
    "--allowedTools", `Write(${illuminationsPath}/**)`,
    "--add-dir", absPath,
    "-p", prompt,
  ];

  const child = spawn("claude", args, {
    cwd: absPath,
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });

  let buffer = "";
  child.stdout.on("data", (chunk: Buffer) => {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.type === "assistant") {
          for (const block of (msg.message?.content ?? [])) {
            if (block.type === "text") {
              process.stdout.write(block.text);
            } else if (block.type === "thinking") {
              process.stdout.write(block.thinking);
            } else if (block.type === "tool_use" && block.name === "Read") {
              process.stdout.write(`\n→ [tool] Read: ${block.input?.file_path}\n`);
            } else if (block.type === "tool_use") {
              process.stdout.write(`\n→ [tool] ${block.name}\n`);
            }
          }
        }
      } catch {}
    }
  });

  child.stderr.on("data", (chunk: Buffer) => process.stderr.write(chunk));

  await new Promise<void>((res) => child.on("close", res));
}
```

- [ ] **Step 3: Add exported command entry points**

Append at the end of `src/cli/commands/meditate.ts`:

```typescript
// ─── Command entry points ─────────────────────────────────────────────────────

export async function meditateStop(projectFolder: string): Promise<void> {
  const absPath = resolve(projectFolder);
  const sentinel = readSentinel(absPath);
  if (!sentinel) {
    console.log("No active meditation schedule found.");
    return;
  }
  removeCronEntry(sentinel.cronId);
  removeSentinel(absPath);
  console.log(`Meditation schedule stopped for ${absPath}`);
}

export async function meditateStatus(projectFolder: string): Promise<void> {
  const absPath = resolve(projectFolder);
  const sentinel = readSentinel(absPath);
  if (!sentinel) {
    console.log("No active meditation schedule.");
    return;
  }
  console.log(`Project:  ${absPath}`);
  console.log(`Interval: every ${sentinel.every} minutes`);
  console.log(`Until:    ${sentinel.until ?? "no end time set"}`);
  console.log(`Cron ID:  ${sentinel.cronId}`);
}

export async function meditateCommand(
  projectFolder: string,
  options: MeditateOptions
): Promise<void> {
  const absPath = resolve(projectFolder);

  if (!existsSync(absPath)) {
    console.error(`Error: project folder not found: ${absPath}`);
    process.exit(1);
  }

  // Check for claude CLI
  const which = spawnSync("which", ["claude"], { encoding: "utf8" });
  if (which.status !== 0) {
    console.error("Error: claude CLI not found.\nInstall it: npm install -g @anthropic-ai/claude-code");
    process.exit(1);
  }

  // Check end-time expiry for scheduled runs
  const sentinel = readSentinel(absPath);
  if (sentinel?.until) {
    const until = new Date(sentinel.until).getTime();
    if (Date.now() >= until) {
      console.log("Meditation schedule has expired. Removing schedule.");
      removeCronEntry(sentinel.cronId);
      removeSentinel(absPath);
      process.exit(0);
    }
  }

  ensureMeditationDirs(absPath);
  appendMeditateGitignore(absPath);

  if (options.every !== undefined) {
    if (!isCleanInterval(options.every)) {
      console.warn(
        `Warning: ${options.every} min does not divide 60 evenly. ` +
        `Cron resets hourly — prefer: 1, 2, 5, 10, 15, 20, 30, or 60.`
      );
    }
    const id = cronId(absPath);
    writeSentinel(absPath, {
      every: options.every,
      ...(options.until ? { until: options.until } : {}),
      cronId: id,
    });
    addCronEntry(absPath, options.every, id);
    console.log(`Scheduled: every ${options.every} min${options.until ? `, until ${options.until}` : ""}`);
  }

  await runMeditationSession(absPath);
}
```

- [ ] **Step 4: Run all tests to confirm nothing broke**

```bash
npx vitest run
```

Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/meditate.ts
git commit -m "feat: add meditate session runner and command entry points"
```

---

## Chunk 3: CLI Wiring and ralph new Update

### Task 5: Register `meditate` command in `index.ts`

**Files:**
- Modify: `src/cli/index.ts`

- [ ] **Step 1: Add meditate import and commands to `index.ts`**

Add the import at the top of `src/cli/index.ts` (after existing imports):

```typescript
import { meditateCommand, meditateStop, meditateStatus } from "./commands/meditate";
```

Add the following three command registrations before `program.parse(process.argv)`:

```typescript
program
  .command("meditate <action-or-folder>")
  .argument("[project-folder]")
  .description("Run a meditation cycle (reflection only, no implementation)")
  .option("--every <n>", "Schedule interval in minutes (registers cron job)", parseInt)
  .option("--until <datetime>", "Stop scheduling after this ISO 8601 datetime")
  .action(async (actionOrFolder: string, projectFolderArg: string | undefined, options: { every?: number; until?: string }) => {
    if (actionOrFolder === "stop" && projectFolderArg) {
      await meditateStop(projectFolderArg);
    } else if (actionOrFolder === "status" && projectFolderArg) {
      await meditateStatus(projectFolderArg);
    } else {
      await meditateCommand(actionOrFolder, options);
    }
  });
```

- [ ] **Step 2: Build and smoke-test the CLI**

```bash
npm run build
ralph meditate --help
```

Expected: help text showing `meditate <action-or-folder>` with `--every` and `--until` options

- [ ] **Step 3: Run all tests to confirm nothing broke**

```bash
npx vitest run
```

Expected: all tests PASS

- [ ] **Step 4: Commit**

```bash
git add src/cli/index.ts
git commit -m "feat: register ralph meditate command in CLI"
```

---

### Task 6: Update `ralph new` scaffold

Add `meditations/illuminations/` to the project scaffold and extend the generated `.gitignore`.

**Files:**
- Modify: `src/cli/commands/new.ts`
- Modify: `src/cli/tests/new.test.ts`

- [ ] **Step 1: Write failing tests for the new scaffold items**

In `src/cli/tests/new.test.ts`, add these tests inside the existing `describe("scaffoldProject", ...)` block:

```typescript
it("creates meditations/illuminations/ directory", () => {
  const target = join(tmpDir, "myproject");
  scaffoldProject(target, "myproject");
  expect(existsSync(join(target, "meditations", "illuminations"))).toBe(true);
});

it("adds meditate entries to .gitignore", () => {
  const target = join(tmpDir, "myproject");
  scaffoldProject(target, "myproject");
  const content = readFileSync(join(target, ".gitignore"), "utf8");
  expect(content).toContain("meditations/illuminations/");
  expect(content).toContain(".meditate.json");
  expect(content).toContain(".meditate.log");
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/cli/tests/new.test.ts
```

Expected: FAIL — meditations dir not created, gitignore missing entries

- [ ] **Step 3: Update `scaffoldProject` in `new.ts`**

In `src/cli/commands/new.ts`, update `scaffoldProject` to add the `meditations/illuminations/` directory and extend the `.gitignore`:

Replace the existing `mkdirSync` block and `writeFileSync` for `.gitignore`:

```typescript
export function scaffoldProject(targetPath: string, _projectName: string): void {
  mkdirSync(targetPath, { recursive: true });
  mkdirSync(join(targetPath, "specs"), { recursive: true });
  mkdirSync(join(targetPath, "src", "tests", "integration"), { recursive: true });
  mkdirSync(join(targetPath, "src", "tests", "unit"), { recursive: true });
  mkdirSync(join(targetPath, "src", "tests", "scenarios"), { recursive: true });
  mkdirSync(join(targetPath, "meditations", "illuminations"), { recursive: true });

  const emptyFiles = ["AGENTS.md", "IMPLEMENTATION_PLAN.md", "README.md"];
  for (const f of emptyFiles) {
    writeFileSync(join(targetPath, f), "");
  }

  copyFileSync(getPromptPath("plan"), join(targetPath, "PROMPT_plan.md"));
  copyFileSync(getPromptPath("build"), join(targetPath, "PROMPT_build.md"));

  writeFileSync(
    join(targetPath, ".gitignore"),
    [
      "PROMPT_plan.md",
      "PROMPT_build.md",
      "IMPLEMENTATION_PLAN.md",
      "meditations/illuminations/",
      ".meditate.json",
      ".meditate.log",
    ].join("\n") + "\n"
  );
}
```

- [ ] **Step 4: Run tests to verify all pass**

```bash
npx vitest run src/cli/tests/new.test.ts
```

Expected: all tests PASS

- [ ] **Step 5: Run full test suite**

```bash
npx vitest run
```

Expected: all tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/cli/commands/new.ts src/cli/tests/new.test.ts
git commit -m "feat: scaffold meditations/ dirs and meditate gitignore in ralph new"
```
