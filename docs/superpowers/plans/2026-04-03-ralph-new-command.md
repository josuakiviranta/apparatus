# ralph new Command Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `ralph new <project-name>` command that scaffolds a language-agnostic project folder, initializes git, and launches a Claude kickoff session to define the project's README and initial specs.

**Architecture:** Three self-contained chunks — asset infrastructure first (new bundled prompt + asset helper), then the `new` command with extracted testable scaffold logic, then wiring into the CLI entry point. The two-phase Claude session logic from `plan.ts` is intentionally duplicated in `new.ts`; extract only if a third command needs it.

**Tech Stack:** TypeScript, Node.js `fs`/`child_process`, vitest (tests), tsup (build)

**Spec:** `docs/superpowers/specs/2026-04-03-ralph-new-command-design.md`

---

## Chunk 1: Asset Infrastructure

Add the bundled `PROMPT_kickoff.md`, a helper to resolve its path, and a test for the helper.

### Task 1: Create `PROMPT_kickoff.md`

**Files:**
- Create: `src/cli/prompts/PROMPT_kickoff.md`

- [ ] **Step 1: Create the prompt file**

Write `src/cli/prompts/PROMPT_kickoff.md` with this exact content:

```markdown
You are helping initialize a new software project called "{{PROJECT_NAME}}".

Your goal is to define what this project is before any code is written.

Do the following in order:
1. Ask the user to describe the project in a few sentences — what it does, who it's for, and any key constraints.
2. Write a succinct README.md in the project root: what it is, why it exists, how to use it (stub).
3. Write specs/README.md: a 2–3 sentence description of the project followed by a lookup table listing future spec files that will live in specs/*.md (leave the table empty for now — just the headers).

Keep both files short. Avoid filler. Do not write any code.
```

- [ ] **Step 2: Commit**

```bash
git add src/cli/prompts/PROMPT_kickoff.md
git commit -m "feat: add PROMPT_kickoff.md bundled default"
```

---

### Task 2: Add `getKickoffPromptPath()` to `assets.ts` (TDD)

**Files:**
- Modify: `src/cli/lib/assets.ts`
- Modify: `src/cli/tests/assets.test.ts`

- [ ] **Step 1: Write the failing test**

In `src/cli/tests/assets.test.ts`, add inside the existing `describe("assets", ...)` block:

```typescript
it("getKickoffPromptPath returns a path ending in PROMPT_kickoff.md", () => {
  const p = getKickoffPromptPath();
  expect(p).toMatch(/PROMPT_kickoff\.md$/);
});
```

Also add `getKickoffPromptPath` to the import at line 2:

```typescript
import { getAssetPath, getLoopShPath, getPromptPath, getKickoffPromptPath } from "../lib/assets";
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/cli/tests/assets.test.ts
```

Expected: FAIL — `getKickoffPromptPath is not a function`

- [ ] **Step 3: Add the export to `assets.ts`**

Append to `src/cli/lib/assets.ts` after the existing `getPromptPath` function:

```typescript
export function getKickoffPromptPath(): string {
  return getAssetPath(join("prompts", "PROMPT_kickoff.md"));
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/cli/tests/assets.test.ts
```

Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/lib/assets.ts src/cli/tests/assets.test.ts
git commit -m "feat: add getKickoffPromptPath asset helper"
```

---

### Task 3: Copy `PROMPT_kickoff.md` to `dist/` in build

**Files:**
- Modify: `tsup.config.ts`

- [ ] **Step 1: Add the copy to `tsup.config.ts`**

In the `onSuccess` callback, after the `copyFileSync` call for `PROMPT_build.md` (line 22), add:

```typescript
    copyFileSync(
      "src/cli/prompts/PROMPT_kickoff.md",
      "dist/prompts/PROMPT_kickoff.md"
    );
```

- [ ] **Step 2: Verify the build copies the file**

```bash
npm run build
ls dist/prompts/
```

Expected output includes: `PROMPT_kickoff.md  PROMPT_build.md  PROMPT_plan.md`

- [ ] **Step 3: Commit**

```bash
git add tsup.config.ts
git commit -m "build: copy PROMPT_kickoff.md to dist on build"
```

---

## Chunk 2: `new` Command Implementation

Implement the command with a testable scaffold function extracted from process-spawning concerns.

### Task 4: Write scaffold logic tests (TDD)

**Files:**
- Create: `src/cli/tests/new.test.ts`

The `scaffoldProject` function and `buildKickoffPrompt` helper are pure logic — no spawning — so both are fully testable.

- [ ] **Step 1: Create the test file**

Write `src/cli/tests/new.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { scaffoldProject, buildKickoffPrompt } from "../commands/new";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "ralph-new-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("scaffoldProject", () => {
  it("creates the top-level empty files", () => {
    const target = join(tmpDir, "myproject");
    scaffoldProject(target, "myproject");

    for (const f of ["AGENTS.md", "IMPLEMENTATION_PLAN.md", "PROMPT_build.md", "PROMPT_plan.md", "README.md"]) {
      expect(existsSync(join(target, f)), `${f} should exist`).toBe(true);
      expect(readFileSync(join(target, f), "utf8")).toBe("");
    }
  });

  it("creates .gitignore with correct entries", () => {
    const target = join(tmpDir, "myproject");
    scaffoldProject(target, "myproject");

    const content = readFileSync(join(target, ".gitignore"), "utf8");
    expect(content).toContain("PROMPT-*.md");
    expect(content).toContain("IMPLEMENTATION_PLAN.md");
  });

  it("creates specs/ directory", () => {
    const target = join(tmpDir, "myproject");
    scaffoldProject(target, "myproject");
    expect(existsSync(join(target, "specs"))).toBe(true);
  });

  it("creates src/tests subdirectories", () => {
    const target = join(tmpDir, "myproject");
    scaffoldProject(target, "myproject");

    for (const sub of ["integration", "unit", "scenarios"]) {
      expect(existsSync(join(target, "src", "tests", sub)), `src/tests/${sub} should exist`).toBe(true);
    }
  });
});

describe("buildKickoffPrompt", () => {
  it("substitutes {{PROJECT_NAME}} with the given name", () => {
    const template = 'Hello "{{PROJECT_NAME}}", welcome to {{PROJECT_NAME}}!';
    const result = buildKickoffPrompt(template, "my-app");
    expect(result).toBe('Hello "my-app", welcome to my-app!');
  });

  it("leaves the template unchanged if no placeholder present", () => {
    const template = "No placeholder here.";
    const result = buildKickoffPrompt(template, "my-app");
    expect(result).toBe("No placeholder here.");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/cli/tests/new.test.ts
```

Expected: FAIL — `Cannot find module '../commands/new'`

- [ ] **Step 3: Commit the test file**

```bash
git add src/cli/tests/new.test.ts
git commit -m "test: add scaffoldProject tests for new command (red)"
```

---

### Task 5: Implement `new.ts`

**Files:**
- Create: `src/cli/commands/new.ts`

- [ ] **Step 1: Write the implementation**

Create `src/cli/commands/new.ts`:

```typescript
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { spawnSync, spawn } from "child_process";
import { getKickoffPromptPath } from "../lib/assets";

export async function newCommand(projectName: string): Promise<void> {
  const targetPath = resolve(process.cwd(), projectName);

  if (existsSync(targetPath)) {
    console.error(`Error: directory already exists: ${targetPath}`);
    process.exit(1);
  }

  const which = spawnSync("which", ["claude"], { encoding: "utf8" });
  if (which.status !== 0) {
    console.error(
      "Error: claude CLI not found.\nInstall it: npm install -g @anthropic-ai/claude-code"
    );
    process.exit(1);
  }

  console.log(`Creating project: ${projectName}`);
  scaffoldProject(targetPath, projectName);

  console.log("Initializing git repository...");
  const gitResult = spawnSync("git", ["init", "-b", "main"], {
    cwd: targetPath,
    stdio: "inherit",
    encoding: "utf8",
  });
  if (gitResult.status !== 0) {
    console.error("Error: git init failed");
    process.exit(1);
  }

  console.log("\nStarting project kickoff session...\n");
  const sessionId = await runKickoffSession(targetPath, projectName);

  console.log("\n\nKickoff complete. Opening interactive session...\n");
  const resumeArgs = sessionId ? ["--resume", sessionId] : [];
  const result = spawnSync("claude", resumeArgs, {
    cwd: targetPath,
    stdio: "inherit",
    env: process.env,
  });

  process.exit(result.status ?? 0);
}

export function scaffoldProject(targetPath: string, _projectName: string): void {
  mkdirSync(targetPath, { recursive: true });
  mkdirSync(join(targetPath, "specs"), { recursive: true });
  mkdirSync(join(targetPath, "src", "tests", "integration"), { recursive: true });
  mkdirSync(join(targetPath, "src", "tests", "unit"), { recursive: true });
  mkdirSync(join(targetPath, "src", "tests", "scenarios"), { recursive: true });

  const emptyFiles = [
    "AGENTS.md",
    "IMPLEMENTATION_PLAN.md",
    "PROMPT_build.md",
    "PROMPT_plan.md",
    "README.md",
  ];
  for (const f of emptyFiles) {
    writeFileSync(join(targetPath, f), "");
  }

  writeFileSync(join(targetPath, ".gitignore"), "PROMPT-*.md\nIMPLEMENTATION_PLAN.md\n");
}

export function buildKickoffPrompt(template: string, projectName: string): string {
  return template.replace(/\{\{PROJECT_NAME\}\}/g, projectName);
}

async function runKickoffSession(cwd: string, projectName: string): Promise<string | null> {
  const promptTemplate = readFileSync(getKickoffPromptPath(), "utf8");
  const prompt = buildKickoffPrompt(promptTemplate, projectName);

  return new Promise((resolve) => {
    let sessionId: string | null = null;
    let buffer = "";

    const child = spawn(
      "claude",
      ["-p", prompt, "--output-format", "stream-json", "--dangerously-skip-permissions"],
      { cwd, env: process.env, stdio: ["ignore", "pipe", "pipe"] }
    );

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

- [ ] **Step 2: Run the tests to verify they pass**

```bash
npx vitest run src/cli/tests/new.test.ts
```

Expected: All 4 tests PASS

- [ ] **Step 3: Run the full test suite to check nothing broke**

```bash
npx vitest run
```

Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add src/cli/commands/new.ts
git commit -m "feat: implement ralph new command with scaffold logic"
```

---

## Chunk 3: CLI Wiring + Smoke Test

Register the `new` subcommand in the CLI entry point and verify the built binary works end-to-end.

### Task 6: Register `new` in `index.ts`

**Files:**
- Modify: `src/cli/index.ts`

- [ ] **Step 1: Add the import**

At the top of `src/cli/index.ts`, after the existing imports (line 3), add:

```typescript
import { newCommand } from "./commands/new";
```

- [ ] **Step 2: Register the subcommand**

After the `implement` command block (after line 27), add:

```typescript
program
  .command("new <project-name>")
  .description("Scaffold a new project folder and launch a Claude kickoff session")
  .action(async (projectName: string) => {
    await newCommand(projectName);
  });
```

- [ ] **Step 3: Verify help output**

```bash
npx tsx src/cli/index.ts --help
```

Expected output includes a line for the `new` command:

```
  new <project-name>   Scaffold a new project folder and launch a Claude kickoff session
```

- [ ] **Step 4: Commit**

```bash
git add src/cli/index.ts
git commit -m "feat: register ralph new subcommand in CLI"
```

---

### Task 7: Build + smoke test

**Files:** none (verification only)

- [ ] **Step 1: Build the project**

```bash
npm run build
```

Expected: no errors, `dist/prompts/PROMPT_kickoff.md` exists

```bash
ls dist/prompts/
```

Expected: `PROMPT_kickoff.md  PROMPT_build.md  PROMPT_plan.md`

- [ ] **Step 2: Check binary help**

```bash
node dist/index.js --help
```

Expected: `new <project-name>` appears in the command list

- [ ] **Step 3: Dry-run scaffold (no claude needed)**

Run from the `ralph-cli` repo root:

```bash
RALPH_BIN="$(pwd)/dist/index.js"
cd /tmp && node "$RALPH_BIN" new test-ralph-project 2>&1 | head -5
```

Expected first line: `Creating project: test-ralph-project`
Expected second line: `Initializing git repository...`
(It will then fail or prompt for Claude — that's fine for this check)

- [ ] **Step 4: Verify conflict detection**

```bash
RALPH_BIN="$(pwd)/dist/index.js"   # run from repo root
mkdir -p /tmp/existing-project
node "$RALPH_BIN" new /tmp/existing-project
echo "exit code: $?"
```

Expected: prints `Error: directory already exists: /tmp/existing-project` and exits with code 1

- [ ] **Step 5: Clean up**

```bash
rm -rf /tmp/test-ralph-project /tmp/existing-project
```

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "chore: verify ralph new build and smoke tests pass"
```
