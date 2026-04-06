# ralph run-scenarios Implementation Plan

> **Status: COMPLETE** — All tasks implemented and verified. Tag: 0.0.14

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add `ralph run-scenarios <project-folder>` command for language-agnostic scenario test orchestration via isolated Claude sessions; fix three bugs in `meditate.ts`; correct `ralph new` scaffold to be language-agnostic.

**Architecture:** `run-scenarios` follows the `meditate-create.ts` non-interactive session pattern — one Claude subprocess per scenario, stream-json output piped to terminal, Claude writes the report file itself. Pure utility functions (discovery, header parsing, slugify) are exported separately for unit testing. The three `meditate.ts` fixes are independent line-level changes enabled by the `RALPH_TEST_CMD` env override.

**Tech Stack:** TypeScript, Node.js `child_process.spawn`, `readline` (stdin selection), `vitest`, `commander`

**Spec:** `docs/superpowers/specs/2026-04-05-run-scenarios-design.md`

---

## Chunk 1: meditate.ts fixes

### Task 1: Export `runMeditationSession` and add `RALPH_TEST_CMD` override

**Files:**
- Modify: `src/cli/commands/meditate.ts`

- [x] **Step 1: Read meditate.ts to locate exact lines**

Run: `grep -n "runMeditationSession\|spawn(\"claude\"" src/cli/commands/meditate.ts`

Expected output shows line numbers for the function declaration (~105) and spawn call (~121).

- [x] **Step 2: Export the function**

In `src/cli/commands/meditate.ts`, change the function declaration:

```typescript
// before
async function runMeditationSession(absPath: string): Promise<void> {

// after
export async function runMeditationSession(absPath: string): Promise<void> {
```

- [x] **Step 3: Add RALPH_TEST_CMD override to the spawn call**

```typescript
// before
const child = spawn("claude", args, {
  cwd: absPath,
  stdio: ["ignore", "pipe", "pipe"],
  env: process.env,
});

// after
const cmd = process.env.RALPH_TEST_CMD ?? "claude";
const child = spawn(cmd, args, {
  cwd: absPath,
  stdio: ["ignore", "pipe", "pipe"],
  env: process.env,
});
```

- [x] **Step 4: Run existing tests to confirm no regressions**

Run: `npm test -- src/cli/tests/meditate.test.ts`
Expected: All 28 existing tests pass.

- [x] **Step 5: Commit**

```bash
git add src/cli/commands/meditate.ts
git commit -m "feat: export runMeditationSession, add RALPH_TEST_CMD override"
```

---

### Task 2: Fix exit code warning and tool-use indicators (TDD)

**Files:**
- Modify: `src/cli/commands/meditate.ts`
- Modify: `src/cli/tests/meditate.test.ts`

- [x] **Step 1: Extend imports in meditate.test.ts**

The file already has these imports at lines 1–2:
```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "fs";
```

Extend them in-place (do NOT add separate import lines):
```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, chmodSync, writeFileSync } from "fs";
import { runMeditationSession } from "../commands/meditate";
```

- [x] **Step 2: Add the failing test block at the end of meditate.test.ts**

```typescript
describe("runMeditationSession — subprocess behavior", () => {
  let sessionDir: string;
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    sessionDir = mkdtempSync(join(tmpdir(), "ralph-session-test-"));
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    rmSync(sessionDir, { recursive: true, force: true });
    stderrSpy.mockRestore();
    stdoutSpy.mockRestore();
    delete process.env.RALPH_TEST_CMD;
  });

  function makeStub(script: string): string {
    const stubPath = join(sessionDir, "stub.sh");
    writeFileSync(stubPath, `#!/bin/bash\n${script}\n`);
    chmodSync(stubPath, 0o755);
    return stubPath;
  }

  it("emits warning to stderr when claude exits with non-zero code", async () => {
    process.env.RALPH_TEST_CMD = makeStub("exit 1");
    await runMeditationSession(sessionDir);
    const written = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(written).toContain("Warning: claude exited with code 1");
  }, 15000);

  it("does not emit warning when claude exits with code 0", async () => {
    process.env.RALPH_TEST_CMD = makeStub("exit 0");
    await runMeditationSession(sessionDir);
    const written = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(written).not.toContain("Warning:");
  }, 15000);

  it("emits tool-use indicator for tool_use stream events", async () => {
    const streamLine = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "tool_use", name: "read_file" }] },
    });
    process.env.RALPH_TEST_CMD = makeStub(`echo '${streamLine}'`);
    await runMeditationSession(sessionDir);
    const written = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(written).toContain("→ [tool] read_file");
  }, 15000);
});
```

- [x] **Step 3: Run tests to confirm the 3 new tests FAIL**

Run: `npm test -- src/cli/tests/meditate.test.ts`
Expected: All existing tests pass, 3 new tests fail (warning not emitted, tool indicator not emitted).

- [x] **Step 4: Fix close handler in meditate.ts to check exit code**

Find the close handler (search for `child.on("close", res)`) and replace:

```typescript
// before
await new Promise<void>((res) => child.on("close", res));

// after
await new Promise<void>((res) => child.on("close", (code) => {
  if (code !== 0) process.stderr.write(`Warning: claude exited with code ${code}\n`);
  res();
}));
```

- [x] **Step 5: Add tool-use indicator to stream parser in meditate.ts**

Find the block inside `if (msg.type === "assistant")` and extend:

```typescript
// before
if (msg.type === "assistant") {
  for (const block of (msg.message?.content ?? [])) {
    if (block.type === "text") {
      process.stdout.write(block.text);
    }
  }
}

// after
if (msg.type === "assistant") {
  for (const block of (msg.message?.content ?? [])) {
    if (block.type === "text") {
      process.stdout.write(block.text);
    } else if (block.type === "tool_use") {
      process.stdout.write(`\n→ [tool] ${block.name}\n`);
    }
  }
}
```

- [x] **Step 6: Run tests to confirm all pass**

Run: `npm test -- src/cli/tests/meditate.test.ts`
Expected: All tests pass (existing + 3 new).

- [x] **Step 7: Commit**

```bash
git add src/cli/commands/meditate.ts src/cli/tests/meditate.test.ts
git commit -m "fix: surface exit code warning and add tool-use indicators to meditate"
```

---

## Chunk 2: ralph new scaffold correction

### Task 3: Correct scaffoldProject to be language-agnostic

**Files:**
- Modify: `src/cli/commands/new.ts`
- Modify: `src/cli/tests/new.test.ts`

- [x] **Step 1: Read new.test.ts and new.ts scaffoldProject in full**

Run both:
```bash
cat -n src/cli/tests/new.test.ts
grep -n "" src/cli/commands/new.ts | head -90
```

You will find:
- `scaffoldProject` currently creates `meditations/illuminations/`, `src/tests/{integration,unit,scenarios}/`
- `.gitignore` currently contains `meditations/illuminations/`, `.meditate.json`, `.meditate.log`
- Existing tests assert the presence of those dirs and `.gitignore` entries

**What you will find — two blocks need rewriting, not deletion:**

1. `"creates src/tests subdirectories"` — a single `it` block that loops over `["integration", "unit", "scenarios"]`. You cannot delete just the `scenarios` entry; Step 2 replaces this block with per-directory `it` blocks that omit `scenarios`.

2. `"adds meditate entries to .gitignore"` — a single `it` block that asserts `meditations/illuminations/`, `.meditate.json`, and `.meditate.log` together. You cannot delete just the `.meditate.*` assertions; Step 2 replaces this with two separate `it` blocks — one for `meditations/illuminations/`, one for `scenario-runs/`.

**Action:** Replace the entire `scaffoldProject` describe block wholesale in Step 2. Do not attempt surgical edits to individual `it` blocks.

- [x] **Step 2: Write failing tests for the corrected scaffold**

In `src/cli/tests/new.test.ts`, replace/update the `scaffoldProject` describe block with:

```typescript
describe("scaffoldProject", () => {
  it("creates src/tests/integration/ directory", () => {
    scaffoldProject(tmpDir, "my-project");
    expect(existsSync(join(tmpDir, "src", "tests", "integration"))).toBe(true);
  });

  it("creates src/tests/unit/ directory", () => {
    scaffoldProject(tmpDir, "my-project");
    expect(existsSync(join(tmpDir, "src", "tests", "unit"))).toBe(true);
  });

  it("creates meditations/illuminations/ directory", () => {
    scaffoldProject(tmpDir, "my-project");
    expect(existsSync(join(tmpDir, "meditations", "illuminations"))).toBe(true);
  });

  it("creates scenario-tests/ directory", () => {
    scaffoldProject(tmpDir, "my-project");
    expect(existsSync(join(tmpDir, "scenario-tests"))).toBe(true);
  });

  it("creates scenario-runs/ directory", () => {
    scaffoldProject(tmpDir, "my-project");
    expect(existsSync(join(tmpDir, "scenario-runs"))).toBe(true);
  });

  it("creates specs/ directory", () => {
    scaffoldProject(tmpDir, "my-project");
    expect(existsSync(join(tmpDir, "specs"))).toBe(true);
  });

  it("adds meditations/illuminations/ to .gitignore", () => {
    scaffoldProject(tmpDir, "my-project");
    const gitignore = readFileSync(join(tmpDir, ".gitignore"), "utf8");
    expect(gitignore).toContain("meditations/illuminations/");
  });

  it("adds scenario-runs/ to .gitignore", () => {
    scaffoldProject(tmpDir, "my-project");
    const gitignore = readFileSync(join(tmpDir, ".gitignore"), "utf8");
    expect(gitignore).toContain("scenario-runs/");
  });

  it("does not create src/tests/scenarios/ directory", () => {
    scaffoldProject(tmpDir, "my-project");
    expect(existsSync(join(tmpDir, "src", "tests", "scenarios"))).toBe(false);
  });
});
```

- [x] **Step 3: Run new tests to confirm they FAIL**

Run: `npm test -- src/cli/tests/new.test.ts`
Expected: New assertions fail — `meditations/` is created, `scenario-tests/` is not, `src/tests/` exists, etc.

- [x] **Step 4: Replace scaffoldProject body in new.ts**

Replace the full `scaffoldProject` function. The old body creates `src/tests/scenarios/` — **remove only that**. Keep `src/tests/integration/`, `src/tests/unit/`, and `meditations/illuminations/`. Add `scenario-tests/` and `scenario-runs/`. Update `.gitignore` to drop `.meditate.json`/`.meditate.log` (meditate adds these itself) and add `scenario-runs/`. The new body:

```typescript
export function scaffoldProject(targetPath: string, _projectName: string): void {
  mkdirSync(join(targetPath, "specs"), { recursive: true });
  mkdirSync(join(targetPath, "src", "tests", "integration"), { recursive: true });
  mkdirSync(join(targetPath, "src", "tests", "unit"), { recursive: true });
  mkdirSync(join(targetPath, "meditations", "illuminations"), { recursive: true });
  mkdirSync(join(targetPath, "scenario-tests"), { recursive: true });
  mkdirSync(join(targetPath, "scenario-runs"), { recursive: true });

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
      "scenario-runs/",
    ].join("\n") + "\n"
  );
}
```

- [x] **Step 5: Run tests to confirm all pass**

Run: `npm test -- src/cli/tests/new.test.ts`
Expected: All tests pass.

- [x] **Step 6: Commit**

```bash
git add src/cli/commands/new.ts src/cli/tests/new.test.ts
git commit -m "fix: correct ralph new scaffold to be language-agnostic"
```

---

## Chunk 3: run-scenarios core — pure functions + tests

### Task 4: Add getScenarioPromptPath to assets.ts

**Files:**
- Modify: `src/cli/lib/assets.ts`

- [x] **Step 1: Add the new function after `getMeditateCreatePromptPath`**

```typescript
export function getScenarioPromptPath(): string {
  return getAssetPath(join("prompts", "PROMPT_scenario.md"));
}
```

- [x] **Step 2: Run assets tests to confirm no regressions**

Run: `npm test -- src/cli/tests/assets.test.ts`
Expected: All pass.

- [x] **Step 3: Commit**

```bash
git add src/cli/lib/assets.ts
git commit -m "feat: add getScenarioPromptPath to assets"
```

---

### Task 5: Create PROMPT_scenario.md

**Files:**
- Create: `src/cli/prompts/PROMPT_scenario.md`

- [x] **Step 1: Create the prompt file**

```markdown
You are running a scenario test on behalf of the user.

Scenario name: {{SCENARIO_NAME}}
Description: {{SCENARIO_DESCRIPTION}}
Script: {{SCRIPT_PATH}}
Output file: {{OUTPUT_PATH}}

Your job:
1. Read the script at {{SCRIPT_PATH}} to understand what it does.
2. Run it using bash. Capture stdout, stderr, and the exit code.
3. Interpret the results — diagnose root causes, not just symptoms.
4. Write a markdown report to {{OUTPUT_PATH}} using exactly this structure:

---
date: <ISO timestamp>
scenario: {{SCENARIO_NAME}}
script: {{SCRIPT_PATH}}
status: <pass or fail>
---

# {{SCENARIO_NAME}}

## What ran
One sentence describing what the script does.

## What happened
Your interpretation of the results. If it failed, explain the root cause. If it passed, confirm what was validated.

## Actionable findings
- If pass: bullet points of what was confirmed working, with references to specific output lines
- If fail: bullet points of specific things to fix, with file/line references where possible

<details>
<summary>Raw output</summary>

```
<full stdout and stderr here>
```

</details>

Do not ask questions. Write the file and exit.
```

- [x] **Step 2: Verify the file is picked up by tsup (no config change needed)**

The tsup `onSuccess` hook copies all files from `src/cli/prompts/` to `dist/prompts/` — PROMPT_scenario.md is included automatically.

Verify: `cat tsup.config.ts | grep -A5 onSuccess`
Expected: See `readdirSync("src/cli/prompts/")` loop that copies all files.

- [x] **Step 3: Commit**

```bash
git add src/cli/prompts/PROMPT_scenario.md
git commit -m "feat: add PROMPT_scenario.md for run-scenarios Claude sessions"
```

---

### Task 6: Create run-scenarios.ts pure functions + unit tests (TDD)

**Files:**
- Create: `src/cli/tests/run-scenarios.test.ts`
- Create: `src/cli/commands/run-scenarios.ts` (pure functions only in this task)

- [x] **Step 1: Create the test file**

Create `src/cli/tests/run-scenarios.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  parseScenarioHeader,
  slugify,
  discoverScenarios,
  buildScenarioPrompt,
} from "../commands/run-scenarios";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "ralph-scenarios-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("slugify", () => {
  it("converts name to kebab-case", () => {
    expect(slugify("Auth Flow Integration")).toBe("auth-flow-integration");
  });

  it("handles special characters and extra spaces", () => {
    expect(slugify("API: Contract Tests!")).toBe("api-contract-tests");
  });

  it("strips leading and trailing hyphens", () => {
    expect(slugify("  My Test  ")).toBe("my-test");
  });
});

describe("parseScenarioHeader", () => {
  it("parses # prefixed header (shell style)", () => {
    const file = join(tmpDir, "test.sh");
    writeFileSync(file, "#!/bin/bash\n# @name: Auth Test\n# @description: Tests auth flow\n");
    expect(parseScenarioHeader(file)).toEqual({ name: "Auth Test", description: "Tests auth flow" });
  });

  it("parses // prefixed header (Go/JS style)", () => {
    const file = join(tmpDir, "test.go");
    writeFileSync(file, "// @name: Go Integration\n// @description: Tests API contracts\n");
    expect(parseScenarioHeader(file)).toEqual({ name: "Go Integration", description: "Tests API contracts" });
  });

  it("parses -- prefixed header (SQL style)", () => {
    const file = join(tmpDir, "test.sql");
    writeFileSync(file, "-- @name: Migration Test\n-- @description: Verifies schema\n");
    expect(parseScenarioHeader(file)).toEqual({ name: "Migration Test", description: "Verifies schema" });
  });

  it("returns empty strings when no header found", () => {
    const file = join(tmpDir, "test.sh");
    writeFileSync(file, "#!/bin/bash\necho hello\n");
    expect(parseScenarioHeader(file)).toEqual({ name: "", description: "" });
  });

  it("returns empty description when only @name is present", () => {
    const file = join(tmpDir, "test.sh");
    writeFileSync(file, "# @name: Only Name\necho hi\n");
    expect(parseScenarioHeader(file)).toEqual({ name: "Only Name", description: "" });
  });

  it("only reads the first 10 lines", () => {
    const lines = Array.from({ length: 12 }, (_, i) => `# line${i}`);
    lines[11] = "# @name: Too Late";
    const file = join(tmpDir, "test.sh");
    writeFileSync(file, lines.join("\n"));
    expect(parseScenarioHeader(file)).toEqual({ name: "", description: "" });
  });
});

describe("discoverScenarios", () => {
  it("returns empty array when scenario-tests/ folder is absent", () => {
    expect(discoverScenarios(tmpDir)).toEqual([]);
  });

  it("discovers files in scenario-tests/", () => {
    mkdirSync(join(tmpDir, "scenario-tests"));
    writeFileSync(
      join(tmpDir, "scenario-tests", "test-auth.sh"),
      "#!/bin/bash\n# @name: Auth Test\n# @description: Tests auth\n"
    );
    const results = discoverScenarios(tmpDir);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("Auth Test");
    expect(results[0].description).toBe("Tests auth");
    expect(results[0].filename).toBe("test-auth.sh");
  });

  it("falls back to filename (without extension) when no header", () => {
    mkdirSync(join(tmpDir, "scenario-tests"));
    writeFileSync(join(tmpDir, "scenario-tests", "my-scenario.sh"), "#!/bin/bash\necho hi\n");
    const results = discoverScenarios(tmpDir);
    expect(results[0].name).toBe("my-scenario");
    expect(results[0].description).toBe("");
  });

  it("ignores subdirectories inside scenario-tests/", () => {
    const scenDir = join(tmpDir, "scenario-tests");
    mkdirSync(scenDir);
    mkdirSync(join(scenDir, "subdir"));
    writeFileSync(join(scenDir, "test.sh"), "# @name: Real\n# @description: desc\n");
    const results = discoverScenarios(tmpDir);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("Real");
  });
});

describe("buildScenarioPrompt", () => {
  it("substitutes all four placeholders", () => {
    const template =
      "Run {{SCRIPT_PATH}} → {{OUTPUT_PATH}} for {{SCENARIO_NAME}}: {{SCENARIO_DESCRIPTION}}";
    const result = buildScenarioPrompt(
      template,
      "Auth Test",
      "Tests auth flow",
      "/project/scenario-tests/test.sh",
      "/project/scenario-runs/out.md"
    );
    expect(result).toBe(
      "Run /project/scenario-tests/test.sh → /project/scenario-runs/out.md for Auth Test: Tests auth flow"
    );
  });

  it("replaces all occurrences of each placeholder", () => {
    const template = "{{SCENARIO_NAME}} and {{SCENARIO_NAME}}";
    const result = buildScenarioPrompt(template, "My Test", "", "", "");
    expect(result).toBe("My Test and My Test");
  });
});
```

- [x] **Step 2: Run tests to confirm they ALL FAIL (module not found)**

Run: `npm test -- src/cli/tests/run-scenarios.test.ts`
Expected: All tests fail with import error.

- [x] **Step 3: Create run-scenarios.ts with pure functions only**

Create `src/cli/commands/run-scenarios.ts`:

```typescript
import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ScenarioFile {
  file: string;
  filename: string;
  name: string;
  description: string;
}

// ─── Pure utilities ───────────────────────────────────────────────────────────

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function parseScenarioHeader(
  filePath: string
): { name: string; description: string } {
  const lines = readFileSync(filePath, "utf8").split("\n").slice(0, 10);
  const nameMatch = lines.find((l) => /^[#/\-]+\s*@name:/.test(l));
  const descMatch = lines.find((l) => /^[#/\-]+\s*@description:/.test(l));
  return {
    name: nameMatch
      ? nameMatch.replace(/^[#/\-]+\s*@name:\s*/, "").trim()
      : "",
    description: descMatch
      ? descMatch.replace(/^[#/\-]+\s*@description:\s*/, "").trim()
      : "",
  };
}

export function discoverScenarios(projectFolder: string): ScenarioFile[] {
  const scenarioDir = join(projectFolder, "scenario-tests");
  if (!existsSync(scenarioDir)) return [];
  return readdirSync(scenarioDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const filename = entry.name;
      const file = join(scenarioDir, filename);
      const { name, description } = parseScenarioHeader(file);
      const baseName = filename.replace(/\.[^.]+$/, "");
      return { file, filename, name: name || baseName, description };
    });
}

export function buildScenarioPrompt(
  template: string,
  scenarioName: string,
  description: string,
  scriptPath: string,
  outputPath: string
): string {
  return template
    .replace(/\{\{SCENARIO_NAME\}\}/g, scenarioName)
    .replace(/\{\{SCENARIO_DESCRIPTION\}\}/g, description)
    .replace(/\{\{SCRIPT_PATH\}\}/g, scriptPath)
    .replace(/\{\{OUTPUT_PATH\}\}/g, outputPath);
}
```

- [x] **Step 4: Run tests to confirm all pass**

Run: `npm test -- src/cli/tests/run-scenarios.test.ts`
Expected: All tests pass.

- [x] **Step 5: Commit**

```bash
git add src/cli/commands/run-scenarios.ts src/cli/tests/run-scenarios.test.ts
git commit -m "feat: add run-scenarios pure functions with tests (slugify, parseScenarioHeader, discoverScenarios)"
```

---

## Chunk 4: run-scenarios command + registration + scenario-tests/

### Task 7: Complete run-scenarios.ts with command entry point

**Files:**
- Modify: `src/cli/commands/run-scenarios.ts`

- [x] **Step 1: Add command implementation to run-scenarios.ts**

Update the imports at the top of `run-scenarios.ts` to the following (replace both existing import lines):

```typescript
import { existsSync, readdirSync, readFileSync, mkdirSync } from "fs";
import { join, resolve } from "path";
import { createInterface } from "readline";
import { spawn, spawnSync } from "child_process";
import { getScenarioPromptPath } from "../lib/assets";
```

Then append these functions after the pure utilities:

```typescript
// ─── Timestamp ────────────────────────────────────────────────────────────────

function formatTimestamp(): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const time = now.toTimeString().slice(0, 5).replace(":", "");
  return `${date}T${time}`;
}

// ─── Interactive selection ────────────────────────────────────────────────────

function printScenarioList(scenarios: ScenarioFile[]): void {
  console.log("\nScenario tests found in scenario-tests/:\n");
  scenarios.forEach((s, i) => {
    console.log(`  ${i + 1}. ${s.name}`);
    if (s.description) console.log(`     ${s.description}`);
    console.log(`     [${s.filename}]`);
    console.log();
  });
}

async function promptSelection(scenarios: ScenarioFile[]): Promise<ScenarioFile[]> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question("Enter numbers to run (e.g. 1 3) or 'all': ", (answer) => {
      rl.close();
      const trimmed = answer.trim();
      if (trimmed === "all") return resolve(scenarios);
      const indices = trimmed
        .split(/\s+/)
        .map(Number)
        .filter((n) => !isNaN(n) && n >= 1 && n <= scenarios.length);
      resolve(indices.map((i) => scenarios[i - 1]));
    });
  });
}

// ─── Session runner ───────────────────────────────────────────────────────────

export function buildScenarioArgs(promptText: string): string[] {
  return [
    "-p", promptText,
    "--output-format", "stream-json",
    "--dangerously-skip-permissions",
  ];
}

async function runScenarioSession(cwd: string, promptText: string): Promise<void> {
  return new Promise((resolve) => {
    let buffer = "";
    const args = buildScenarioArgs(promptText);
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
    child.on("close", (code) => {
      if (code !== 0)
        process.stderr.write(`Warning: scenario session exited with code ${code}\n`);
      resolve();
    });
  });
}

// ─── Command entry point ──────────────────────────────────────────────────────

export async function runScenariosCommand(
  projectFolder: string,
  options: { all?: boolean }
): Promise<void> {
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

  const scenarios = discoverScenarios(absPath);
  if (scenarios.length === 0) {
    console.log(
      `No scenario-tests/ folder found in ${absPath}.\n` +
        `Run \`ralph new ${projectFolder}\` to scaffold the ralph structure, or create scenario-tests/ manually.`
    );
    process.exit(0);
  }

  printScenarioList(scenarios);

  let selected: ScenarioFile[];
  if (options.all) {
    selected = scenarios;
  } else {
    selected = await promptSelection(scenarios);
    if (selected.length === 0) {
      console.log("No scenarios selected.");
      process.exit(0);
    }
  }

  const runsDir = join(absPath, "scenario-runs");
  mkdirSync(runsDir, { recursive: true });

  const promptTemplate = readFileSync(getScenarioPromptPath(), "utf8");

  for (const scenario of selected) {
    const ts = formatTimestamp();
    const slug = slugify(scenario.name);
    const outFile = `${ts}-${slug}.md`;
    const outPath = join(runsDir, outFile);
    const prompt = buildScenarioPrompt(
      promptTemplate,
      scenario.name,
      scenario.description,
      scenario.file,
      outPath
    );

    console.log(`\nRunning: ${scenario.name}...`);
    await runScenarioSession(absPath, prompt);
    console.log(`Done: scenario-runs/${outFile}`);
  }
}
```

- [x] **Step 2: Run unit tests to confirm no regressions**

Run: `npm test -- src/cli/tests/run-scenarios.test.ts`
Expected: All pure-function tests still pass.

- [x] **Step 3: Commit**

```bash
git add src/cli/commands/run-scenarios.ts
git commit -m "feat: add runScenariosCommand and session runner to run-scenarios.ts"
```

---

### Task 8: Register run-scenarios in index.ts

**Files:**
- Modify: `src/cli/index.ts`

- [x] **Step 1: Add import at the top of index.ts**

```typescript
import { runScenariosCommand } from "./commands/run-scenarios";
```

- [x] **Step 2: Register the command before `program.parse(process.argv)`**

```typescript
program
  .command("run-scenarios <project-folder>")
  .description("Discover and run scenario tests, writing actionable reports")
  .option("--all", "Run all scenarios without interactive selection")
  .action(async (projectFolder: string, options: { all?: boolean }) => {
    await runScenariosCommand(projectFolder, options);
  });
```

- [x] **Step 3: Build and smoke-test the CLI**

Run: `npm run build && node dist/cli/index.js run-scenarios --help`
Expected: Shows `run-scenarios <project-folder>` with `--all` option.

- [x] **Step 4: Commit**

```bash
git add src/cli/index.ts
git commit -m "feat: register ralph run-scenarios command"
```

---

### Task 9: Add ralph-cli's own scenario tests

**Files:**
- Create: `scenario-tests/test-meditate-session.sh`
- Create: `scenario-tests/test-run-scenarios.sh`

These are ralph-cli eating its own dog food — they will be run via `ralph run-scenarios .` once everything is in place.

- [x] **Step 1: Create scenario-tests/ directory**

```bash
mkdir -p scenario-tests
```

- [x] **Step 2: Create test-meditate-session.sh**

```bash
cat > scenario-tests/test-meditate-session.sh << 'EOF'
#!/bin/bash
# @name: Meditate Session Orchestration
# @description: Verifies runMeditationSession spawns subprocess, emits tool indicators, and handles exit codes correctly via RALPH_TEST_CMD stub

set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "=== Scenario: Meditate session tool-use indicator ==="
echo "Running vitest for runMeditationSession scenario tests..."

cd "$REPO_ROOT"
npx vitest run src/cli/tests/meditate.test.ts --reporter=verbose 2>&1

echo ""
echo "=== PASS: runMeditationSession scenario tests completed ==="
EOF
chmod +x scenario-tests/test-meditate-session.sh
```

- [x] **Step 3: Create test-run-scenarios.sh**

```bash
cat > scenario-tests/test-run-scenarios.sh << 'EOF'
#!/bin/bash
# @name: run-scenarios Command End-to-End
# @description: Scaffolds a temp project with scenario-tests/, runs a stub scenario, and asserts a report file is written to scenario-runs/

set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP_PROJECT="$(mktemp -d)"
trap "rm -rf $TMP_PROJECT" EXIT

echo "=== Scenario: run-scenarios creates report file ==="

# Create a minimal scenario test in the temp project
mkdir -p "$TMP_PROJECT/scenario-tests"
cat > "$TMP_PROJECT/scenario-tests/test-stub.sh" << 'STUB'
#!/bin/bash
# @name: Stub Scenario
# @description: Always passes, used for end-to-end harness test
echo "Stub scenario ran successfully"
exit 0
STUB
chmod +x "$TMP_PROJECT/scenario-tests/test-stub.sh"

echo "Running: ralph run-scenarios $TMP_PROJECT --all"
node "$REPO_ROOT/dist/cli/index.js" run-scenarios "$TMP_PROJECT" --all

echo ""
echo "Checking for report in scenario-runs/..."
REPORT_COUNT=$(ls "$TMP_PROJECT/scenario-runs/"*.md 2>/dev/null | wc -l | tr -d ' ')

if [ "$REPORT_COUNT" -eq 0 ]; then
  echo "FAIL: No report file found in scenario-runs/"
  exit 1
fi

echo "Found $REPORT_COUNT report file(s):"
ls "$TMP_PROJECT/scenario-runs/"*.md

echo ""
echo "=== PASS: run-scenarios wrote report to scenario-runs/ ==="
EOF
chmod +x scenario-tests/test-run-scenarios.sh
```

- [x] **Step 4: Build dist (required by test-run-scenarios.sh) and verify scripts are executable**

`test-run-scenarios.sh` invokes `dist/cli/index.js` directly — the build must be current before running it.

Run: `npm run build && ls -la scenario-tests/`
Expected: Both .sh files present and executable.

- [x] **Step 5: Manually verify test-meditate-session.sh runs**

Run: `bash scenario-tests/test-meditate-session.sh`
Expected: vitest output showing all meditate tests passing.

- [x] **Step 6: Commit**

```bash
git add scenario-tests/
git commit -m "feat: add ralph-cli scenario tests for meditate and run-scenarios"
```

---

### Task 10: Final build and full test suite

- [x] **Step 1: Run full test suite**

Run: `npm test`
Expected: All tests pass.

- [x] **Step 2: Build**

Run: `npm run build`
Expected: Build succeeds, `dist/prompts/PROMPT_scenario.md` is present.

- [x] **Step 3: Verify PROMPT_scenario.md was bundled**

Run: `ls dist/prompts/`
Expected: `PROMPT_scenario.md` appears in the list alongside other prompts.

- [x] **Step 4: Final commit if any loose changes**

```bash
git status
# only commit if there are uncommitted changes
```
