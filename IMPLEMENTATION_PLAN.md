# Stimuli Rename + Project-Local-Only Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the `meta_meditations` MCP/code surface to `stimuli` and excise the dead bundled-stimuli plumbing so each project's `<project>/.apparat/meditations/stimuli/` is the sole source.

**Architecture:** Three logical commits in one PR. Commit 1 is independent cleanup (`package.json:files`). Commit 2 is an **atomic refactor** that touches the MCP server, agent-prep, the meditate pipeline frontmatter, the `assets.ts` helper, and every test that references the old names — split would yield a silent runtime failure where the server still expects `argv[3]` while the frontmatter no longer supplies it. Commit 3 updates `CONTEXT.md` and adds ADR-0012.

**Tech Stack:** TypeScript (Node 18+), tsup, vitest, MCP server SDK, dot-pipeline runtime, gray-matter.

**Reference:** See [`docs/superpowers/specs/2026-05-07-stimuli-rename-and-project-local-only-design.md`](../specs/2026-05-07-stimuli-rename-and-project-local-only-design.md) for design rationale and file inventory.

---

## Chunk 1: Stale `package.json:files` cleanup

**Why first:** independent of the rename. Drops a stale entry that has been pointing at a non-existent top-level `meditations/` directory since the 2026-04-26 stimuli split. Lands as its own commit so the rename diff stays focused.

### Task 1.1: Drop stale `"meditations"` entry from `package.json:files`

**Files:**
- Modify: `package.json:43-46`

- [x] **Step 1: Read current files array**

Run: `cat package.json`
Expected: `"files": ["dist", "meditations"]` at lines 43–46.

- [x] **Step 2: Verify there is no top-level `meditations/` directory**

Run: `ls meditations 2>&1 || echo "not present"`
Expected: `not present` (or `ls: meditations: No such file or directory`). Confirms the entry is stale.

- [x] **Step 3: Edit `package.json` to drop the stale entry**

Use Edit tool. Replace:
```json
  "files": [
    "dist",
    "meditations"
  ]
```
with:
```json
  "files": [
    "dist"
  ]
```

- [x] **Step 4: Verify build still passes**

Run: `npm run build`
Expected: build succeeds, `dist/` is regenerated.

- [x] **Step 5: Verify nothing in published artefact references `meditations/`**

Run: `npm pack --dry-run 2>&1 | grep -i meditations || echo "clean"`
Expected: `clean`.

- [x] **Step 6: Commit**

```bash
git add package.json
git commit -m "chore: drop stale \"meditations\" entry from package.json files array"
```

---

## Chunk 2: Atomic rename + bundled-stimuli plumbing removal

**Why atomic:** the MCP server's `argv[3]` parsing and the meditate pipeline's `mcp.args` frontmatter are the two ends of the same wire. Splitting their edits across commits leaves one commit where the server expects a path the frontmatter no longer supplies — silent runtime failure (empty stimuli list, no error). All the renames, the helper deletion, the system-injected-var deletion, and the test updates land together.

**TDD discipline:** every rename gets a failing test first (or an existing test edited to assert the new name), the test is run to confirm it fails, then the implementation flips. Only the final commit at end of chunk passes the full suite.

### Task 2.1: Add the new contract test for `mcp.args` shape on `meditate.md`

**Files:**
- Modify: `src/cli/tests/meditate.test.ts`

- [x] **Step 1: Add a failing test pinning the new `mcp.args` shape**

Use Edit tool. Inside the existing `describe("meditate template agent tool whitelist", ...)` block in `src/cli/tests/meditate.test.ts`, after the existing `whitelists exactly the 7 reflective-only tools` test (around line 167), insert:

```typescript
  it("mcp.args is exactly two entries: illumination server path + project root", () => {
    const agentMd = readFileSync(templatePath, "utf-8");
    const argsMatch = agentMd.match(/^\s+args:\n((?:\s+-\s+.+\n)+)/m);
    expect(argsMatch).not.toBeNull();
    const args = argsMatch![1]
      .split("\n")
      .map((l) => l.replace(/^\s+-\s+"?/, "").replace(/"?$/, "").trim())
      .filter(Boolean);
    expect(args).toEqual(["{{ILLUMINATION_SERVER_PATH}}", "{{PROJECT_ROOT}}"]);
  });
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/cli/tests/meditate.test.ts -t "mcp.args is exactly two entries"`
Expected: FAIL with `expected ["{{ILLUMINATION_SERVER_PATH}}", "{{PROJECT_ROOT}}", "{{META_MEDITATIONS_DIR}}"] to equal ["{{ILLUMINATION_SERVER_PATH}}", "{{PROJECT_ROOT}}"]`. Confirms the existing frontmatter has the third arg.

- [x] **Step 3: Do NOT commit yet** — this test is part of the atomic refactor commit.

### Task 2.2: Update the existing tools-whitelist test for new tool names

**Files:**
- Modify: `src/cli/tests/meditate.test.ts:161-162`

- [x] **Step 1: Edit the expected list**

Use Edit tool. Replace lines 161–162:
```typescript
      "mcp__illumination__list_meta_meditations",
      "mcp__illumination__read_meta_meditation",
```
with:
```typescript
      "mcp__illumination__list_stimuli",
      "mcp__illumination__read_stimulus",
```

- [x] **Step 2: Run the test, verify it now fails**

Run: `npx vitest run src/cli/tests/meditate.test.ts -t "whitelists exactly the 7 reflective-only tools"`
Expected: FAIL. The existing `meditate.md` still has the old names, so the new expected list does not match.

- [x] **Step 3: Do NOT commit yet**.

### Task 2.3: Update the body-prose-no-removed-tool-name test

**Files:**
- Modify: `src/cli/tests/meditate.test.ts` (the `body does not reference any removed lifecycle tool name` test, around lines 190–206)

- [x] **Step 1: Add a parallel test that asserts removed legacy names**

Use Edit. After the existing `body does not reference any removed lifecycle tool name` test, add:

```typescript
  it("body does not reference legacy meta-meditation tool names", () => {
    const agentMd = readFileSync(templatePath, "utf-8");
    const frontmatterMatch = agentMd.match(/^---\n[\s\S]+?\n---\n/);
    expect(frontmatterMatch).not.toBeNull();
    const body = agentMd.slice(frontmatterMatch![0].length);

    expect(body).not.toContain("list_meta_meditations");
    expect(body).not.toContain("read_meta_meditation");
    expect(body).not.toContain("meta-meditation");
    expect(body).not.toContain("meta_meditation");
  });
```

- [x] **Step 2: Run, verify failure**

Run: `npx vitest run src/cli/tests/meditate.test.ts -t "body does not reference legacy meta-meditation tool names"`
Expected: FAIL — body still references the legacy names.

### Task 2.4: Update `meditate.md` frontmatter and body

**Files:**
- Modify: `src/cli/pipelines/meditate/meditate.md:10-24, 50-53, 70`

- [x] **Step 1: Replace `tools:` entries**

Use Edit. Replace:
```
  - mcp__illumination__list_meta_meditations
  - mcp__illumination__read_meta_meditation
```
with:
```
  - mcp__illumination__list_stimuli
  - mcp__illumination__read_stimulus
```

- [x] **Step 2: Drop the third `mcp.args` entry**

Use Edit. Replace:
```
    args:
      - "{{ILLUMINATION_SERVER_PATH}}"
      - "{{PROJECT_ROOT}}"
      - "{{META_MEDITATIONS_DIR}}"
```
with:
```
    args:
      - "{{ILLUMINATION_SERVER_PATH}}"
      - "{{PROJECT_ROOT}}"
```

- [x] **Step 3: Update body prose at lines 50–53**

Use Edit. Replace:
```
You also have tools for meta-meditations — curated lenses from the apparat-cli tool itself:

- `list_meta_meditations` — list available lenses, one per line as `filename — description`. Call this before reading any. Use the descriptions to pick which lenses match what you observed in the project; pass the filename portion (before `—`) to `read_meta_meditation`.
- `read_meta_meditation(filename)` — read a specific lens by filename.
```
with:
```
You also have tools for stimuli — interpretive lenses for this project:

- `list_stimuli` — list available lenses, one per line as `filename — description`. Call this before reading any. Use the descriptions to pick which lenses match what you observed in the project; pass the filename portion (before `—`) to `read_stimulus`.
- `read_stimulus(filename)` — read a specific lens by filename.
```

- [x] **Step 4: Update body prose at line 60 (working-context bullet)**

Use Edit. Replace:
```
- Meta-meditations are interpretive lenses — themes, patterns, and questions to focus your reflection
```
with:
```
- Stimuli are interpretive lenses — themes, patterns, and questions to focus your reflection
```

- [x] **Step 5: Update the numbered task step at line 70**

Use Edit. Replace:
```
4. Call `list_meta_meditations` to see available lenses, then call `read_meta_meditation` on whichever feel most relevant to what you observe
5. If no meta-meditations are available, reflect on the code directly — you can still produce a valuable illumination
```
with:
```
4. Call `list_stimuli` to see available lenses, then call `read_stimulus` on whichever feel most relevant to what you observe
5. If no stimuli are available, reflect on the code directly — you can still produce a valuable illumination
```

- [x] **Step 6: Verify no other `meta-meditation` references remain in the file**

Run: `grep -n "meta.meditation" src/cli/pipelines/meditate/meditate.md || echo "clean"`
Expected: `clean`.

- [x] **Step 7: Run the three meditate.md tests**

Run: `npx vitest run src/cli/tests/meditate.test.ts -t "whitelists exactly the 7"`
Run: `npx vitest run src/cli/tests/meditate.test.ts -t "mcp.args is exactly two entries"`
Run: `npx vitest run src/cli/tests/meditate.test.ts -t "body does not reference legacy meta-meditation tool names"`
Expected: all three PASS.

### Task 2.5: Add failing tests for new MCP server signatures

**Files:**
- Modify: `src/cli/tests/illumination-server.test.ts`

- [x] **Step 1: Replace the import line**

Use Edit. Replace:
```typescript
import { validateFilename, validateSlug, composeIlluminationFilename, writeIllumination, assertWithinRoot, readFile, validateGlobPattern, globFiles, projectTree, listMetaMeditations, readMetaMeditation, listIlluminations, listPlans, consume, consumePlan } from "../mcp/illumination-server";
```
with:
```typescript
import { validateFilename, validateSlug, composeIlluminationFilename, writeIllumination, assertWithinRoot, readFile, validateGlobPattern, globFiles, projectTree, listStimuli, readStimulus, listIlluminations, listPlans, consume, consumePlan } from "../mcp/illumination-server";
```

- [x] **Step 2: Replace the `describe("listMetaMeditations", ...)` block**

Use Edit. Replace the entire `describe("listMetaMeditations", ...)` block (around lines 398–431) with:

```typescript
describe("listStimuli", () => {
  function seed(projectRoot: string, files: Record<string, string>) {
    const dir = join(projectRoot, ".apparat", "meditations", "stimuli");
    mkdirSync(dir, { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(dir, name), content);
    }
  }

  it("returns sorted filename — description pairs when stimuli dir has .md files", () => {
    seed(tmpDir, {
      "b-lens.md": "---\ndescription: B lens summary\n---\ncontent b",
      "a-lens.md": "---\ndescription: A lens summary\n---\ncontent a",
    });
    expect(listStimuli(tmpDir)).toBe("a-lens.md — A lens summary\nb-lens.md — B lens summary");
  });

  it("falls back to (no description) when frontmatter is missing", () => {
    seed(tmpDir, { "raw-lens.md": "no frontmatter here" });
    expect(listStimuli(tmpDir)).toBe("raw-lens.md — (no description)");
  });

  it("only lists .md files, ignoring other file types", () => {
    seed(tmpDir, {
      "a-lens.md": "---\ndescription: A\n---\n",
      "config.json": "",
    });
    const result = listStimuli(tmpDir);
    expect(result).toContain("a-lens.md");
    expect(result).not.toContain("config.json");
  });

  it("returns explanatory message pointing at the project's stimuli folder when dir is empty", () => {
    mkdirSync(join(tmpDir, ".apparat", "meditations", "stimuli"), { recursive: true });
    const result = listStimuli(tmpDir);
    expect(result).toContain("No stimuli found");
    expect(result).toContain(".apparat/meditations/stimuli/");
    expect(result).not.toContain("npm-global");
  });

  it("returns explanatory message when stimuli dir does not exist", () => {
    const result = listStimuli(tmpDir);
    expect(result).toContain("No stimuli found");
    expect(result).toContain(".apparat/meditations/stimuli/");
  });
});
```

- [x] **Step 3: Replace the `describe("readMetaMeditation", ...)` block**

Use Edit. Replace the existing block (around lines 433–454) with:

```typescript
describe("readStimulus", () => {
  function seed(projectRoot: string, filename: string, content: string) {
    const dir = join(projectRoot, ".apparat", "meditations", "stimuli");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, filename), content);
  }

  it("returns file content for a valid existing filename", () => {
    seed(tmpDir, "my-lens.md", "# My Lens\ncontent here");
    expect(readStimulus(tmpDir, "my-lens.md")).toBe("# My Lens\ncontent here");
  });

  it("returns error for path traversal attempt (../secrets.md)", () => {
    const result = readStimulus(tmpDir, "../secrets.md");
    expect(result).toMatch(/^Error:/);
  });

  it("returns error for filename without .md extension", () => {
    const result = readStimulus(tmpDir, "lens.txt");
    expect(result).toMatch(/^Error:/);
  });

  it("returns error when file does not exist", () => {
    const result = readStimulus(tmpDir, "nonexistent.md");
    expect(result).toMatch(/^Error:/);
    expect(result).toContain("nonexistent.md");
  });
});
```

- [x] **Step 4: Run tests, verify a module-load error**

Run: `npx vitest run src/cli/tests/illumination-server.test.ts`
Expected: vitest reports a single module-load failure (not 9 individually-failing tests) — the test file fails to import `listStimuli` / `readStimulus` because those symbols don't exist yet. Output looks like `Error: No matching export in "src/cli/mcp/illumination-server.ts" for import "listStimuli"`. This is the intended red-state for the file as a whole; per-test failures will only materialise after Task 2.6 implements the new exports.

### Task 2.6: Implement `listStimuli` / `readStimulus` in `illumination-server.ts`

**Files:**
- Modify: `src/cli/mcp/illumination-server.ts` — multiple surgical edits (line numbers shift across edits; rely on `old_string` content matching, not absolute line numbers)

- [x] **Step 1: Add `stimuliDir` import**

Use Edit. Replace:
```typescript
import { illuminationsDir } from "../lib/apparat-paths.js";
```
with:
```typescript
import { illuminationsDir, stimuliDir } from "../lib/apparat-paths.js";
```

- [x] **Step 2: Rename and rewrite the sentinel constant**

Use Edit. Replace:
```typescript
const NO_META_MEDITATIONS_MESSAGE =
  "No meta-meditations found. You can still proceed — reflect on the project code " +
  "directly and write your illumination using write_illumination.\n\n" +
  "To add meta-meditations: create .md files in the .apparat/meditations/stimuli/ folder of your " +
  "apparat-cli installation (e.g. ~/.npm-global/lib/node_modules/apparat-cli/.apparat/meditations/stimuli/). " +
  "Each file is a lens the agent will use to reflect on your project.";
```
with:
```typescript
const NO_STIMULI_MESSAGE =
  "No stimuli found. You can still proceed — reflect on the project code directly " +
  "and write your illumination using write_illumination.\n\n" +
  "To add stimuli: create .md files in this project's .apparat/meditations/stimuli/ " +
  "folder. Each file is a lens the agent will use to reflect on your project.";
```

- [x] **Step 3: Replace `listMetaMeditations` with `listStimuli`**

Use Edit. Replace the existing `listMetaMeditations` function (lines 170–182):
```typescript
export function listMetaMeditations(meditationsDir: string): string {
  try {
    const files = readdirSync(meditationsDir)
      .filter((f) => f.endsWith(".md"))
      .sort();
    if (files.length === 0) return NO_META_MEDITATIONS_MESSAGE;
    return files
      .map((name) => `${name} — ${parseIlluminationDescription(join(meditationsDir, name))}`)
      .join("\n");
  } catch {
    return NO_META_MEDITATIONS_MESSAGE;
  }
}
```
with:
```typescript
export function listStimuli(projectRoot: string): string {
  const dir = stimuliDir(projectRoot);
  try {
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .sort();
    if (files.length === 0) return NO_STIMULI_MESSAGE;
    return files
      .map((name) => `${name} — ${parseIlluminationDescription(join(dir, name))}`)
      .join("\n");
  } catch {
    return NO_STIMULI_MESSAGE;
  }
}
```

- [x] **Step 4: Replace `readMetaMeditation` with `readStimulus`**

Use Edit. Replace lines 247–255:
```typescript
export function readMetaMeditation(meditationsDir: string, filename: string): string {
  const err = validateFilename(filename);
  if (err) return `Error: ${err}`;
  try {
    return readFileSync(join(meditationsDir, filename), "utf8");
  } catch {
    return `Error: file not found: ${filename}`;
  }
}
```
with:
```typescript
export function readStimulus(projectRoot: string, filename: string): string {
  const err = validateFilename(filename);
  if (err) return `Error: ${err}`;
  try {
    return readFileSync(join(stimuliDir(projectRoot), filename), "utf8");
  } catch {
    return `Error: file not found: ${filename}`;
  }
}
```

- [x] **Step 5: Drop `argv[3]` parsing**

Use Edit. Replace:
```typescript
  const projectRoot = process.argv[2];
  const meditationsDir = process.argv[3] ?? "";
```
with:
```typescript
  const projectRoot = process.argv[2];
```

- [x] **Step 6: Rename the two MCP tool registrations**

Use Edit. Replace:
```typescript
    server.tool(
      "list_meta_meditations",
      "List available meta-meditation lens files from the apparat-cli installation. " +
        "Call this first to see which lenses are available before reading any.",
      {},
      async () => {
        const result = listMetaMeditations(meditationsDir);
        return { content: [{ type: "text" as const, text: result }] };
      },
    );

    server.tool(
      "read_meta_meditation",
      "Read a specific meta-meditation lens file by filename. " +
        "Use list_meta_meditations first to get available filenames.",
      { filename: z.string() },
      async ({ filename }: { filename: string }) => {
        const result = readMetaMeditation(meditationsDir, filename);
        return { content: [{ type: "text" as const, text: result }] };
      },
    );
```
with:
```typescript
    server.tool(
      "list_stimuli",
      "List available stimulus lens files from this project's .apparat/meditations/stimuli/ folder. " +
        "Call this first to see which lenses are available before reading any.",
      {},
      async () => {
        const result = listStimuli(projectRoot);
        return { content: [{ type: "text" as const, text: result }] };
      },
    );

    server.tool(
      "read_stimulus",
      "Read a specific stimulus lens file by filename. " +
        "Use list_stimuli first to get available filenames.",
      { filename: z.string() },
      async ({ filename }: { filename: string }) => {
        const result = readStimulus(projectRoot, filename);
        return { content: [{ type: "text" as const, text: result }] };
      },
    );
```

- [x] **Step 7: Run the new tests, verify they pass**

Run: `npx vitest run src/cli/tests/illumination-server.test.ts -t "listStimuli|readStimulus"`
Expected: all 9 PASS.

- [x] **Step 8: Run the full illumination-server test file**

Run: `npx vitest run src/cli/tests/illumination-server.test.ts`
Expected: all PASS.

### Task 2.7: Drop bundled-stimuli plumbing in `assets.ts` and `agent-prep.ts`

**Files:**
- Modify: `src/cli/lib/assets.ts` — delete `getMetaMeditationsDir()`
- Modify: `src/attractor/handlers/agent-prep.ts` — drop import + drop `META_MEDITATIONS_DIR` from `SYSTEM_INJECTED_VARS` and `buildSystemInjectedVars`
- Modify: `src/cli/tests/assets.test.ts` — drop import; delete one test block
- Modify: `src/attractor/tests/agent-handler.test.ts` — update one test description; replace one assertion
- Modify: `src/attractor/tests/graph-validator-inputs.test.ts` — drop `META_MEDITATIONS_DIR` from one test

(All line numbers below describe pre-edit state. They will shift as edits land within the chunk; rely on `old_string` content matching.)

- [x] **Step 1a: Drop `getMetaMeditationsDir` from `assets.test.ts` import**

Use Edit. Replace:
```typescript
import { getBundledPipelinesDir, getIlluminationServerPath, getMetaMeditationsDir } from "../lib/assets";
```
with:
```typescript
import { getBundledPipelinesDir, getIlluminationServerPath } from "../lib/assets";
```

- [x] **Step 1b: Delete the entire `getMetaMeditationsDir returns a path...` test block**

Use Edit on `src/cli/tests/assets.test.ts`. Replace:
```typescript
  it("getMetaMeditationsDir returns a path to the stimulus library with all lens files present", () => {
    const p = getMetaMeditationsDir();
    expect(p).toMatch(/\.apparat\/meditations\/stimuli$/);
    expect(existsSync(p)).toBe(true);
    const files = readdirSync(p).filter((f) => f.endsWith(".md"));
    expect(files.length).toBeGreaterThanOrEqual(29);
    expect(files).toContain("red-green-tdd-is-non-negotiable.md");
  });

```
with the empty string (delete entirely, including the trailing blank line after the closing `});`).

- [x] **Step 1c: Verify `assets.test.ts` still compiles and passes**

Run: `npx vitest run src/cli/tests/assets.test.ts`
Expected: PASS (the deletion is a green-by-vacuum step — no test references the symbol). Move on; the plumbing-deletion happens in Step 5.

- [x] **Step 2: Update `agent-handler.test.ts` test description and assertion**

Use Edit on `src/attractor/tests/agent-handler.test.ts`. Replace:
```typescript
  it("auto-injects standard MCP infra variables (illumination server, project root, meta-meditations dir)", async () => {
```
with:
```typescript
  it("auto-injects standard MCP infra variables (illumination server, project root)", async () => {
```

Use Edit (in the same test body). Replace:
```typescript
    expect(call.variables.META_MEDITATIONS_DIR).toMatch(/meditations\/stimuli$/);
```
with:
```typescript
    expect(call.variables).not.toHaveProperty("META_MEDITATIONS_DIR");
```

- [x] **Step 3: Run the updated test — confirm RED**

Run: `npx vitest run src/attractor/tests/agent-handler.test.ts -t "auto-injects standard MCP infra variables"`
Expected: FAIL — `agent-prep.ts` still injects `META_MEDITATIONS_DIR`, so `not.toHaveProperty` fails. This is the intended red phase; do not flip code yet.

- [x] **Step 4: Update `graph-validator-inputs.test.ts`**

Use Edit. Replace:
```typescript
  it("does not fire for system-injected vars (PROJECT_ROOT, ILLUMINATION_SERVER_PATH, META_MEDITATIONS_DIR)", () => {
    const dir = join(tmpdir(), `rule-binis-sysvar-${Date.now()}`);
    setup(dir, {
      "consumer.md": `---
name: consumer
description: x
inputs: [PROJECT_ROOT, ILLUMINATION_SERVER_PATH, META_MEDITATIONS_DIR]
```
with:
```typescript
  it("does not fire for system-injected vars (PROJECT_ROOT, ILLUMINATION_SERVER_PATH)", () => {
    const dir = join(tmpdir(), `rule-binis-sysvar-${Date.now()}`);
    setup(dir, {
      "consumer.md": `---
name: consumer
description: x
inputs: [PROJECT_ROOT, ILLUMINATION_SERVER_PATH]
```

Note: this test stays green throughout — the validator currently does not fire on any of the three vars (all are system-injected). Removing one from the list does not change the assertion outcome. The edit is for parity with the new system contract, not as a TDD-red signal. Acceptable here because the contract assertion is in `agent-handler.test.ts` (Step 3 above).

- [x] **Step 5: Delete `getMetaMeditationsDir()` from `assets.ts`**

Use Edit. Delete lines 40–47 (the entire function plus its preceding blank line):
```typescript

export function getMetaMeditationsDir(): string {
  // prod: dist/cli/ → up two → package root
  // dev:  src/cli/lib/ → up three → package root
  const packageRoot = isProduction()
    ? join(__dirname, "../..")
    : join(__dirname, "../../..");
  return join(packageRoot, ".apparat", "meditations", "stimuli");
}
```

- [x] **Step 6: Drop the import + system-injected-var entry in `agent-prep.ts`**

Use Edit. Replace line 6:
```typescript
import { getIlluminationServerPath, getMetaMeditationsDir } from "../../cli/lib/assets.js";
```
with:
```typescript
import { getIlluminationServerPath } from "../../cli/lib/assets.js";
```

Use Edit. Replace lines 16–28 (the entire `SYSTEM_INJECTED_VARS` block + `buildSystemInjectedVars`):
```typescript
export const SYSTEM_INJECTED_VARS = [
  "ILLUMINATION_SERVER_PATH",
  "PROJECT_ROOT",
  "META_MEDITATIONS_DIR",
] as const;

function buildSystemInjectedVars(projectRoot: string): Record<(typeof SYSTEM_INJECTED_VARS)[number], string> {
  return {
    ILLUMINATION_SERVER_PATH: getIlluminationServerPath(),
    PROJECT_ROOT: projectRoot,
    META_MEDITATIONS_DIR: getMetaMeditationsDir(),
  };
}
```
with:
```typescript
export const SYSTEM_INJECTED_VARS = [
  "ILLUMINATION_SERVER_PATH",
  "PROJECT_ROOT",
] as const;

function buildSystemInjectedVars(projectRoot: string): Record<(typeof SYSTEM_INJECTED_VARS)[number], string> {
  return {
    ILLUMINATION_SERVER_PATH: getIlluminationServerPath(),
    PROJECT_ROOT: projectRoot,
  };
}
```

- [x] **Step 7: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [x] **Step 8: Re-run the previously-RED test from Step 3 — confirm GREEN**

Run: `npx vitest run src/attractor/tests/agent-handler.test.ts -t "auto-injects standard MCP infra variables"`
Expected: PASS. `META_MEDITATIONS_DIR` is no longer injected; `not.toHaveProperty` holds. This closes the red-green cycle for the system-injected-var deletion.

- [x] **Step 9: Verify the four touched test files pass**

Run: `npx vitest run src/cli/tests/assets.test.ts src/attractor/tests/agent-handler.test.ts src/attractor/tests/graph-validator-inputs.test.ts src/cli/tests/illumination-server.test.ts`
Expected: all PASS.

### Task 2.8: Full repo verification

- [x] **Step 1: Verify no lingering `meta_meditation` references in live source**

Run: `grep -rn "meta_meditation\|MetaMeditation\|META_MEDITATIONS" src/ --include="*.ts" --include="*.md" || echo "clean"`
Expected: `clean`. Any hit means a missed surface — investigate before proceeding.

- [x] **Step 2: Run full test suite**

Run: `npx vitest run`
Expected: all PASS.

- [x] **Step 3: Build**

Run: `npm run build`
Expected: success.

- [x] **Step 4: Smoke-test the meditate pipeline against this repo**

Run: `npx tsx src/cli/index.ts pipeline validate src/cli/pipelines/meditate/pipeline.dot`
Expected: validation passes (no `bare_input_not_in_caller_inputs_or_system` for `META_MEDITATIONS_DIR`).

- [x] **Step 5: Commit the atomic refactor**

```bash
git add \
  src/cli/lib/assets.ts \
  src/cli/mcp/illumination-server.ts \
  src/attractor/handlers/agent-prep.ts \
  src/cli/pipelines/meditate/meditate.md \
  src/cli/tests/meditate.test.ts \
  src/cli/tests/illumination-server.test.ts \
  src/cli/tests/assets.test.ts \
  src/attractor/tests/agent-handler.test.ts \
  src/attractor/tests/graph-validator-inputs.test.ts
git commit -m "refactor: rename meta_meditations to stimuli + drop bundled-stimuli plumbing"
```

---

## Chunk 3: Documentation + ADR

### Task 3.1: Update `CONTEXT.md` two-tier-stimuli paragraph

**Files:**
- Modify: `CONTEXT.md:53-58`

- [ ] **Step 1: Replace the paragraph**

Use Edit. Replace:
```
Two-tier pipeline read at runtime:
- **Project-local:** `<project>/.apparat/pipelines/<name>/pipeline.dot`
- **Bundled fallback:** `src/cli/pipelines/<name>/pipeline.dot` (in npm package)

Two-tier stimuli reads (project-local + bundled) work the same way for
the meditate pipeline.
```
with:
```
Two-tier pipeline read at runtime:
- **Project-local:** `<project>/.apparat/pipelines/<name>/pipeline.dot`
- **Bundled fallback:** `src/cli/pipelines/<name>/pipeline.dot` (in npm package)

Stimuli are project-local only. The meditate pipeline reads from
`<project>/.apparat/meditations/stimuli/` exclusively — there is no
bundled fallback. Each project curates its own lens library; an
`apparat init` scaffolds an empty `stimuli/` directory.
```

- [ ] **Step 2: Verify nothing else in CONTEXT.md references bundled stimuli**

Run: `grep -n "bundled.*stimuli\|stimuli.*bundle\|meta.meditation" CONTEXT.md || echo "clean"`
Expected: `clean`.

### Task 3.2: Create ADR-0012

**Files:**
- Create: `docs/adr/0012-stimuli-project-local-only.md`

- [ ] **Step 1: Read existing ADR style**

Run: `ls docs/adr/`
Pick a recent one (e.g. `0011-skill-as-shim-plus-live-reference.md`) and use Read to inspect its structure.

- [ ] **Step 2: Write ADR-0012**

Use Write tool. Content:

```markdown
# ADR-0012: Stimuli are project-local only

**Status:** Accepted
**Date:** 2026-05-07
**Supersedes:** none (sharpens partition principle established by ADR-0010)

## Context

The 2026-04-26 split renamed `<project>/.apparat/meditations/stimuli/` into existence as the
project-local home for meditate-pipeline lens files (commit `v0.1.39`). The MCP server, the
`meta_meditations` helper surface, and the `META_MEDITATIONS_DIR` system-injected variable
remained from the pre-split design where the apparat-cli npm package would ship a curated
bundled lens library and the agent would read from it.

In practice the bundled path was dead in distribution — `package.json:files` did not include
`.apparat/`, so `npm pack` excluded the lens library. Every npm-installed apparat user got the
no-stimuli sentinel. Only the developer running apparat against itself in dev had stimuli at all.

The 2026-05-07 design (`docs/superpowers/specs/2026-05-07-stimuli-rename-and-project-local-only-design.md`)
committed to deleting the bundled-stimuli plumbing and aligning the surface name (`stimuli`) with
the directory name and `CONTEXT.md` glossary.

## Decision

Stimuli are read exclusively from `<project>/.apparat/meditations/stimuli/`. There is no bundled
fallback. Other projects that install apparat get an empty `stimuli/` directory from
`apparat init` and populate it themselves. Apparat's own 32 lens files are project-local content
for the apparat repo, not a shared bundle.

The MCP tools `list_meta_meditations` and `read_meta_meditation` rename to `list_stimuli` and
`read_stimulus`. The system-injected variable `META_MEDITATIONS_DIR` is removed from the
preamble. The MCP server resolves the stimuli directory internally from the project root via
`stimuliDir(projectRoot)`.

## Consequences

- Every project owns a curated lens library tailored to its own concerns. Apparat's lenses
  (e.g. `the-agentic-loop-is-a-graph.md`) no longer leak into other projects.
- A future cookbook-style command (`apparat stimuli import <bundle-name>`) could solve curated
  distribution if it ever becomes a real need. Out of scope here.
- The agent surface in `meditate.md` becomes self-describing: `list_stimuli` matches the
  directory, the glossary, and `CONTEXT.md`.
- New projects scaffolded by `apparat init` see `No stimuli found.` on first meditate. The
  agent still produces a useful illumination by reflecting on code only — degraded but
  functional.
```

- [ ] **Step 3: Verify ADR is well-formed**

Run: `head -5 docs/adr/0012-stimuli-project-local-only.md`
Expected: title heading, status, date, supersedes.

### Task 3.3: Commit docs

- [ ] **Step 1: Stage and commit**

```bash
git add CONTEXT.md docs/adr/0012-stimuli-project-local-only.md
git commit -m "docs: update CONTEXT.md + add ADR-0012 for project-local-only stimuli"
```

---

## Chunk 4: Final acceptance verification

### Task 4.1: Acceptance gates from the spec

- [ ] **Step 1: Build**

Run: `npm run build`
Expected: success.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Test suite**

Run: `npx vitest run`
Expected: all PASS.

- [ ] **Step 4: Greps return clean**

Run: `grep -rn "meta_meditation\|MetaMeditation" src/ docs/adr/0012*.md CONTEXT.md package.json || echo "clean"`
Expected: `clean`.

Run: `grep -rn "META_MEDITATIONS_DIR" src/ || echo "clean"`
Expected: `clean`.

Run: `grep -rn "getMetaMeditationsDir" src/ || echo "clean"`
Expected: `clean`.

- [ ] **Step 5: Smoke-test against a fresh project**

Run:
```bash
TMP=$(mktemp -d)
node dist/cli/index.js init "$TMP"
ls "$TMP/.apparat/meditations/stimuli/"
```
Expected: directory exists and is empty.

- [ ] **Step 6: Smoke-test the apparat-self meditate**

Run: `node dist/cli/index.js pipeline validate src/cli/pipelines/meditate/pipeline.dot`
Expected: validation passes.

**Deferred manual smoke (out-of-CI):** spec §7 last bullet asks for an `apparat meditate .` run against the apparat repo itself loading the 32 lens files. The pipeline-validate above proves the static plumbing; the runtime path through `listStimuli(projectRoot)` is covered by `illumination-server.test.ts` against a tmp project. A genuine end-to-end `apparat meditate .` is interactive and requires the `claude` CLI — execute manually when convenient before merging the PR. Record the result in the PR description if run.

- [ ] **Step 7: Push branch and open PR**

```bash
git push -u origin <branch-name>
gh pr create --title "refactor: rename meta_meditations to stimuli; drop bundled-stimuli plumbing" --body "$(cat <<'EOF'
## Summary
- Rename MCP tools `list_meta_meditations` / `read_meta_meditation` → `list_stimuli` / `read_stimulus`
- Drop the dead bundled-stimuli code path; resolve from `stimuliDir(projectRoot)` only
- Drop stale `"meditations"` from `package.json:files`
- Add ADR-0012; update `CONTEXT.md`

Spec: `docs/superpowers/specs/2026-05-07-stimuli-rename-and-project-local-only-design.md`

## Test plan
- [x] `npm run build`
- [x] `npx tsc --noEmit`
- [x] `npx vitest run`
- [x] `apparat init` scaffolds empty `stimuli/`
- [x] `pipeline validate` passes for the meditate pipeline
EOF
)"
```

---

## Remember

- Exact file paths and line numbers throughout. Verify each `:N` reference if a prior task may have shifted line counts.
- Commit 2 is atomic — frontmatter + server + helpers + tests land together. Do not split.
- TDD: every rename has a failing-then-passing test pair before the code flips.
- Don't touch dated artefacts (sessions, the 2026-05-05 rename spec, ADRs 0007/0008/0010, in-flight illuminations) — they are historical record.
