# `ralph meditate add` Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add `ralph meditate add <project-folder>` — a two-phase AI-assisted session that helps the user write a new meditation file in `<project-folder>/meditations/`.

**Architecture:** Mirrors `plan.ts` exactly: Phase 1 spawns Claude non-interactively with a kickoff prompt (reads existing meditations, greets the user), captures the session ID from stream-json output, then Phase 2 resumes the same session interactively so the user can articulate their insight and Claude writes the file.

**Tech Stack:** TypeScript, Node.js `child_process` (spawn / spawnSync), commander.js for CLI registration, vitest for tests.

---

## Chunk 1: Prompt file and assets resolver

### Task 1: Create bundled kickoff prompt

**Files:**
- Create: `src/cli/prompts/PROMPT_meditate_create.md`

No test needed — this is a text asset. The build step (`npm run build`) copies all files in `src/cli/prompts/` to `dist/prompts/` automatically (see `tsup.config.ts`).

- [x] **Step 1: Write the prompt file**

Create `src/cli/prompts/PROMPT_meditate_create.md` with this exact content:

```markdown
Read all files in meditations/ (excluding meditations/illuminations/) to understand the existing format: frontmatter (source, date, description), # Title, prose body, kebab-case filename.

Then say: "I've reviewed your meditations. What insight or practice do you want to document?"

When the user is ready, write the finished meditation to meditations/<slug>.md matching the existing format exactly. Do not write any code. Do not create specs.
```

- [x] **Step 2: Verify file exists**

```bash
cat src/cli/prompts/PROMPT_meditate_create.md
```
Expected: the content above is printed.

- [x] **Step 3: Commit**

```bash
git add src/cli/prompts/PROMPT_meditate_create.md
git commit -m "feat: add PROMPT_meditate_create bundled prompt"
```

---

### Task 2: Add `getMeditateCreatePromptPath()` to assets.ts

**Files:**
- Modify: `src/cli/lib/assets.ts`
- Modify: `src/cli/tests/assets.test.ts`

**Background:** `assets.ts` resolves paths to bundled files. In dev (`__dirname` ends with `lib`), the base is `src/cli/`. In production (`__dirname` ends with `dist`), the base is `dist/`. All existing prompt functions follow the same one-liner pattern via `getAssetPath(join("prompts", filename))`.

- [x] **Step 1: Write the failing test**

In `src/cli/tests/assets.test.ts`, add inside the existing `describe` block (or a new one if the file uses top-level `it` calls — check first):

```typescript
import { getMeditateCreatePromptPath } from "../lib/assets";

it("getMeditateCreatePromptPath returns path ending in PROMPT_meditate_create.md", () => {
  expect(getMeditateCreatePromptPath()).toMatch(/PROMPT_meditate_create\.md$/);
});
```

- [x] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/cli/tests/assets.test.ts
```
Expected: FAIL — `getMeditateCreatePromptPath is not a function` (or import error).

- [x] **Step 3: Add `getMeditateCreatePromptPath` to assets.ts**

In `src/cli/lib/assets.ts`, add after `getMeditationPromptPath()`:

```typescript
export function getMeditateCreatePromptPath(): string {
  return getAssetPath(join("prompts", "PROMPT_meditate_create.md"));
}
```

- [x] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/cli/tests/assets.test.ts
```
Expected: all tests PASS.

- [x] **Step 5: Commit**

```bash
git add src/cli/lib/assets.ts src/cli/tests/assets.test.ts
git commit -m "feat: add getMeditateCreatePromptPath to assets"
```

---

## Chunk 2: Command, tests, and CLI registration

### Task 3: Create `meditate-add.ts` command

**Files:**
- Create: `src/cli/commands/meditate-add.ts`

**Background:** Study `src/cli/commands/plan.ts` before writing — this file is an almost exact copy with three changes: (1) the prompt is read from `getMeditateCreatePromptPath()` instead of hardcoding `BRAINSTORM_TRIGGER`, (2) the function is named `meditateAddCommand`, (3) the internal kickoff runner is named `runMeditateCreateKickoff`. Also export `buildMeditateAddKickoffArgs` as a pure function so tests can verify the args without spawning processes.

- [x] **Step 1: Write the file**

Create `src/cli/commands/meditate-add.ts`:

```typescript
import { spawn, spawnSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { getMeditateCreatePromptPath } from "../lib/assets";

export function buildMeditateAddKickoffArgs(promptText: string): string[] {
  return [
    "-p", promptText,
    "--output-format", "stream-json",
    "--dangerously-skip-permissions",
  ];
}

export async function meditateAddCommand(projectFolder: string): Promise<void> {
  const absPath = resolve(projectFolder);

  if (!existsSync(absPath)) {
    console.error(`Error: project folder not found: ${absPath}`);
    process.exit(1);
  }

  const which = spawnSync("which", ["claude"], { encoding: "utf8" });
  if (which.status !== 0) {
    console.error(
      "Error: claude CLI not found.\nInstall it: npm install -g @anthropic-ai/claude-code"
    );
    process.exit(1);
  }

  console.log(`Starting meditation session in ${absPath}...`);
  console.log(`Reading your meditations — this may take a moment...\n`);

  const sessionId = await runMeditateCreateKickoff(absPath);

  console.log("\n\nReady. Opening interactive session...\n");

  const resumeArgs = [
    "--dangerously-skip-permissions",
    ...(sessionId ? ["--resume", sessionId] : []),
  ];
  const result = spawnSync("claude", resumeArgs, {
    cwd: absPath,
    stdio: "inherit",
    env: process.env,
  });

  process.exit(result.status ?? 0);
}

async function runMeditateCreateKickoff(cwd: string): Promise<string | null> {
  return new Promise((resolve) => {
    let sessionId: string | null = null;
    let buffer = "";

    const promptText = readFileSync(getMeditateCreatePromptPath(), "utf8");
    const args = buildMeditateAddKickoffArgs(promptText);

    const child = spawn("claude", args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.session_id && !sessionId) sessionId = msg.session_id;
          if (msg.type === "assistant") {
            for (const block of msg.message?.content ?? []) {
              if (block.type === "text") process.stdout.write(block.text);
              else if (block.type === "tool_use")
                process.stdout.write(`\n→ [tool] ${block.name}\n`);
            }
          }
        } catch {}
      }
    });

    child.stderr.on("data", (chunk: Buffer) => process.stderr.write(chunk));
    child.on("close", () => resolve(sessionId));
  });
}
```

- [x] **Step 2: Verify it compiles**

```bash
npx tsc --noEmit
```
Expected: no errors.

---

### Task 4: Write tests for `meditate-add.ts`

**Files:**
- Create: `src/cli/tests/meditate-add.test.ts`

**Background:** The test pattern in this codebase tests pure exported functions directly (no process-spawn mocking). We test: (1) `buildMeditateAddKickoffArgs` shape, (2) `meditateAddCommand` error path for non-existent folder (uses a real temp dir — no mock needed since the folder genuinely won't exist).

- [x] **Step 1: Write the failing tests**

Create `src/cli/tests/meditate-add.test.ts`:

```typescript
import { describe, it, expect, vi, afterEach } from "vitest";
import { buildMeditateAddKickoffArgs, meditateAddCommand } from "../commands/meditate-add";
import { join } from "path";
import { tmpdir } from "os";

describe("buildMeditateAddKickoffArgs", () => {
  it("includes -p with the prompt text", () => {
    const args = buildMeditateAddKickoffArgs("my prompt");
    const idx = args.indexOf("-p");
    expect(idx).not.toBe(-1);
    expect(args[idx + 1]).toBe("my prompt");
  });

  it("includes --output-format stream-json", () => {
    const args = buildMeditateAddKickoffArgs("x");
    const idx = args.indexOf("--output-format");
    expect(idx).not.toBe(-1);
    expect(args[idx + 1]).toBe("stream-json");
  });

  it("includes --dangerously-skip-permissions", () => {
    const args = buildMeditateAddKickoffArgs("x");
    expect(args).toContain("--dangerously-skip-permissions");
  });
});

describe("meditateAddCommand", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exits with error if project folder does not exist", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await meditateAddCommand(join(tmpdir(), "ralph-nonexistent-" + Date.now()));

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("project folder not found"));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/cli/tests/meditate-add.test.ts
```
Expected: FAIL — module not found (file doesn't exist yet, or import errors).

- [x] **Step 3: Confirm tests pass now that the file exists**

```bash
npx vitest run src/cli/tests/meditate-add.test.ts
```
Expected: all 4 tests PASS.

- [x] **Step 4: Run full test suite to check no regressions**

```bash
npx vitest run
```
Expected: all tests PASS.

- [x] **Step 5: Commit**

```bash
git add src/cli/commands/meditate-add.ts src/cli/tests/meditate-add.test.ts
git commit -m "feat: add meditateAddCommand and tests"
```

---

### Task 5: Register `ralph meditate add` in `index.ts`

**Files:**
- Modify: `src/cli/index.ts`

**Background:** The `meditate` command in `index.ts` uses an `if/else` chain on `actionOrFolder`. Add an `add` branch before the final `else` that calls `meditateAddCommand`. Also add the import.

- [x] **Step 1: Add the import**

At the top of `src/cli/index.ts`, add to the existing meditate import line:

```typescript
import { meditateCommand, meditateStop, meditateStatus, meditateKill } from "./commands/meditate";
import { meditateAddCommand } from "./commands/meditate-add";
```

- [x] **Step 2: Add the `add` branch**

In the `.action(...)` handler of the `meditate` command, add `else if (actionOrFolder === "add")` before the final `else`:

Current code (lines 45–56 of `src/cli/index.ts`):
```typescript
    if ((actionOrFolder === "stop" || actionOrFolder === "status" || actionOrFolder === "kill") && !projectFolderArg) {
      console.error(`Usage: ralph meditate ${actionOrFolder} <project-folder>`);
      process.exit(1);
    } else if (actionOrFolder === "stop" && projectFolderArg) {
      await meditateStop(projectFolderArg);
    } else if (actionOrFolder === "status" && projectFolderArg) {
      await meditateStatus(projectFolderArg);
    } else if (actionOrFolder === "kill" && projectFolderArg) {
      await meditateKill(projectFolderArg);
    } else {
      await meditateCommand(actionOrFolder, options);
    }
```

Replace with:
```typescript
    if ((actionOrFolder === "stop" || actionOrFolder === "status" || actionOrFolder === "kill" || actionOrFolder === "add") && !projectFolderArg) {
      console.error(`Usage: ralph meditate ${actionOrFolder} <project-folder>`);
      process.exit(1);
    } else if (actionOrFolder === "stop" && projectFolderArg) {
      await meditateStop(projectFolderArg);
    } else if (actionOrFolder === "status" && projectFolderArg) {
      await meditateStatus(projectFolderArg);
    } else if (actionOrFolder === "kill" && projectFolderArg) {
      await meditateKill(projectFolderArg);
    } else if (actionOrFolder === "add" && projectFolderArg) {
      await meditateAddCommand(projectFolderArg);
    } else {
      await meditateCommand(actionOrFolder, options);
    }
```

- [x] **Step 3: Verify compilation**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [x] **Step 4: Run full test suite**

```bash
npx vitest run
```
Expected: all tests PASS.

- [x] **Step 5: Build and smoke-test the CLI**

```bash
npm run build && ralph meditate add --help
```
Expected: no crash (commander will print usage or process the add flag).

Verify `ralph meditate add` with a non-existent folder prints an error:
```bash
ralph meditate add /tmp/does-not-exist-ralph-test
```
Expected: `Error: project folder not found: /tmp/does-not-exist-ralph-test` and exit 1.

- [x] **Step 6: Commit**

```bash
git add src/cli/index.ts
git commit -m "feat: register ralph meditate add subcommand"
```
