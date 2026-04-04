# Meta-Meditations MCP Implementation Plan

> **Status:** All chunks complete. Implemented in commit 262a90f, tagged 0.0.8.

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Expose ralph-cli's own `meditations/` folder to the meditation agent via two new MCP tools (`list_meta_meditations`, `read_meta_meditation`), so the agent can use curated lenses without needing meditation files in every project.

**Architecture:** Add `getMetaMeditationsDir()` to `assets.ts` resolving the package-root `meditations/` folder. Add pure helper functions and two MCP tools to `illumination-server.ts`. Wire the path into `meditate.ts` when spawning the server and whitelisting tools. Update `PROMPT_meditation.md` to instruct the agent to use the new tools.

**Tech Stack:** TypeScript, Node.js fs module, `@modelcontextprotocol/sdk`, `vitest`

---

## Chunk 1: `getMetaMeditationsDir()` in assets.ts

**Files:**
- Modify: `src/cli/lib/assets.ts`
- Modify: `src/cli/tests/assets.test.ts`

- [x] **Step 1: Write failing tests**

Add to `src/cli/tests/assets.test.ts`:

```typescript
import { existsSync } from "fs";
// add existsSync to the existing import, then add to the imports line:
import { getAssetPath, getLoopShPath, getPromptPath, getKickoffPromptPath, getMeditationPromptPath, getIlluminationServerPath, getMetaMeditationsDir } from "../lib/assets";

// add inside describe("assets", ...):
it("getMetaMeditationsDir returns a path ending in meditations", () => {
  const p = getMetaMeditationsDir();
  expect(p).toMatch(/meditations$/);
});

it("getMetaMeditationsDir resolves to an existing directory in the current repo", () => {
  const p = getMetaMeditationsDir();
  expect(existsSync(p)).toBe(true);
});
```

- [x] **Step 2: Run tests to confirm they fail**

```bash
cd /Users/josu/Documents/projects/ralph-cli && npx vitest run src/cli/tests/assets.test.ts
```

Expected: FAIL — `getMetaMeditationsDir is not a function`

- [x] **Step 3: Implement `getMetaMeditationsDir()` in assets.ts**

Add after `getMeditationPromptPath()` in `src/cli/lib/assets.ts`:

```typescript
export function getMetaMeditationsDir(): string {
  const dir = basename(__dirname);
  // In production (dist/): package root is one level up
  // In dev (src/cli/lib/): package root is three levels up
  const packageRoot = dir === "dist"
    ? join(__dirname, "..")
    : join(__dirname, "../../..");
  return join(packageRoot, "meditations");
}
```

- [x] **Step 4: Run tests to confirm they pass**

```bash
cd /Users/josu/Documents/projects/ralph-cli && npx vitest run src/cli/tests/assets.test.ts
```

Expected: all PASS

- [x] **Step 5: Commit**

```bash
git add src/cli/lib/assets.ts src/cli/tests/assets.test.ts
git commit -m "feat: add getMetaMeditationsDir() resolving package-root meditations/"
```

---

## Chunk 2: Pure helpers in illumination-server.ts

**Files:**
- Modify: `src/cli/mcp/illumination-server.ts`
- Modify: `src/cli/tests/illumination-server.test.ts`

- [x] **Step 1: Write failing tests**

Add to `src/cli/tests/illumination-server.test.ts` (after existing imports, add to the import line):

```typescript
import { validateFilename, writeIllumination, assertWithinRoot, readFile, validateGlobPattern, globFiles, projectTree, listMetaMeditations, readMetaMeditation } from "../mcp/illumination-server";
```

Add new describe blocks at the end of the file:

```typescript
describe("listMetaMeditations", () => {
  it("returns newline-separated sorted filenames when dir has .md files", () => {
    writeFileSync(join(tmpDir, "b-lens.md"), "content b");
    writeFileSync(join(tmpDir, "a-lens.md"), "content a");
    const result = listMetaMeditations(tmpDir);
    expect(result).toBe("a-lens.md\nb-lens.md");
  });

  it("only lists .md files, ignoring other file types", () => {
    writeFileSync(join(tmpDir, "a-lens.md"), "");
    writeFileSync(join(tmpDir, "config.json"), "");
    const result = listMetaMeditations(tmpDir);
    expect(result).toContain("a-lens.md");
    expect(result).not.toContain("config.json");
  });

  it("returns explanatory message with instructions when dir is empty", () => {
    const result = listMetaMeditations(tmpDir);
    expect(result).toContain("No meta-meditations found");
    expect(result).toContain("meditations/");
  });

  it("returns explanatory message with instructions when dir does not exist", () => {
    const result = listMetaMeditations(join(tmpDir, "nonexistent"));
    expect(result).toContain("No meta-meditations found");
    expect(result).toContain("meditations/");
  });
});

describe("readMetaMeditation", () => {
  it("returns file content for a valid existing filename", () => {
    writeFileSync(join(tmpDir, "my-lens.md"), "# My Lens\ncontent here");
    expect(readMetaMeditation(tmpDir, "my-lens.md")).toBe("# My Lens\ncontent here");
  });

  it("returns error for path traversal attempt (../secrets.md)", () => {
    const result = readMetaMeditation(tmpDir, "../secrets.md");
    expect(result).toMatch(/^Error:/);
  });

  it("returns error for filename without .md extension", () => {
    const result = readMetaMeditation(tmpDir, "lens.txt");
    expect(result).toMatch(/^Error:/);
  });

  it("returns error when file does not exist", () => {
    const result = readMetaMeditation(tmpDir, "nonexistent.md");
    expect(result).toMatch(/^Error:/);
    expect(result).toContain("nonexistent.md");
  });
});
```

- [x] **Step 2: Run tests to confirm they fail**

```bash
cd /Users/josu/Documents/projects/ralph-cli && npx vitest run src/cli/tests/illumination-server.test.ts
```

Expected: FAIL — `listMetaMeditations is not a function`, `readMetaMeditation is not a function`

- [x] **Step 3: Implement pure helpers in illumination-server.ts**

Add after the existing `globFiles` function (before `const SKIP_DIRS`), in `src/cli/mcp/illumination-server.ts`:

```typescript
const NO_META_MEDITATIONS_MESSAGE =
  "No meta-meditations found. You can still proceed — reflect on the project code " +
  "directly and write your illumination using write_illumination.\n\n" +
  "To add meta-meditations: create .md files in the meditations/ folder of your " +
  "ralph-cli installation (e.g. ~/.npm-global/lib/node_modules/ralph-cli/meditations/). " +
  "Each file is a lens the agent will use to reflect on your project.";

export function listMetaMeditations(meditationsDir: string): string {
  try {
    const files = readdirSync(meditationsDir)
      .filter((f) => f.endsWith(".md"))
      .sort();
    if (files.length === 0) return NO_META_MEDITATIONS_MESSAGE;
    return files.join("\n");
  } catch {
    return NO_META_MEDITATIONS_MESSAGE;
  }
}

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

- [x] **Step 4: Run tests to confirm they pass**

```bash
cd /Users/josu/Documents/projects/ralph-cli && npx vitest run src/cli/tests/illumination-server.test.ts
```

Expected: all PASS

- [x] **Step 5: Commit**

```bash
git add src/cli/mcp/illumination-server.ts src/cli/tests/illumination-server.test.ts
git commit -m "feat: add listMetaMeditations and readMetaMeditation pure helpers"
```

---

## Chunk 3: MCP tools registration in server bootstrap

**Files:**
- Modify: `src/cli/mcp/illumination-server.ts` (bootstrap section only)

No new tests needed — the MCP tool registration wires existing pure helpers. Pure helpers are already tested in Chunk 2.

- [x] **Step 1: Update server bootstrap to accept `meditationsDir` arg and register two new tools**

In `src/cli/mcp/illumination-server.ts`, inside the `if (!isTestEnv)` block, after `const projectRoot = process.argv[2];`:

```typescript
const meditationsDir = process.argv[3] ?? "";
```

Then register two new tools after the existing `project_tree` tool registration (before the `process.on("SIGINT", ...)` line):

```typescript
server.tool(
  "list_meta_meditations",
  "List available meta-meditation lens files from the ralph-cli installation. " +
    "Call this first to see which lenses are available before reading any.",
  {},
  // @ts-expect-error — SDK overloads cause deep type instantiation with dynamically-imported zod
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
  // @ts-expect-error — SDK overloads cause deep type instantiation with dynamically-imported zod
  async ({ filename }: { filename: string }) => {
    const result = readMetaMeditation(meditationsDir, filename);
    return { content: [{ type: "text" as const, text: result }] };
  },
);
```

- [x] **Step 2: Build and verify no TypeScript errors**

```bash
cd /Users/josu/Documents/projects/ralph-cli && npm run build
```

Expected: build succeeds with no errors

- [x] **Step 3: Run full test suite to confirm nothing broke**

```bash
cd /Users/josu/Documents/projects/ralph-cli && npx vitest run
```

Expected: all PASS

- [x] **Step 4: Commit**

```bash
git add src/cli/mcp/illumination-server.ts
git commit -m "feat: register list_meta_meditations and read_meta_meditation MCP tools"
```

---

## Chunk 4: Wire into meditate.ts

**Files:**
- Modify: `src/cli/commands/meditate.ts`
- Modify: `src/cli/tests/meditate.test.ts`

- [x] **Step 1: Update import in meditate.ts**

In `src/cli/commands/meditate.ts`, update the assets import at line 4:

```typescript
import { getMeditationPromptPath, getIlluminationServerPath, getMetaMeditationsDir } from "../lib/assets";
```

- [x] **Step 2: Update `writeMcpConfig` to pass `meditationsDir` as third server arg**

In `writeMcpConfig` (around line 162), update the `args` field:

```typescript
args: [serverPath, projectRoot, getMetaMeditationsDir()],
```

- [x] **Step 3: Update `buildMeditationArgs` to whitelist two new tools**

In `buildMeditationArgs` (around line 180), add two new `--allowedTools` entries after the existing four:

```typescript
"--allowedTools", "mcp__illumination__list_meta_meditations",
"--allowedTools", "mcp__illumination__read_meta_meditation",
```

- [x] **Step 4: Update tests for `writeMcpConfig` in meditate.test.ts**

The existing test at line 235–241 (`"config JSON contains illumination mcpServer entry with correct projectRoot"`) checks `args[args.length - 1]` equals `tmpDir`. After the change, `args[args.length - 1]` will be `meditationsDir`, not `projectRoot`. Fix it by checking `args[1]` instead, and add a new assertion for the third arg:

```typescript
// Replace the existing test body at line 235–241:
it("config JSON contains illumination mcpServer entry with correct projectRoot", () => {
  const configPath = writeMcpConfig(tmpDir);
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  expect(config.mcpServers.illumination).toBeDefined();
  const args: string[] = config.mcpServers.illumination.args;
  expect(args[1]).toBe(tmpDir);           // projectRoot is second arg
  expect(args[2]).toMatch(/meditations$/); // meditationsDir is third arg
});
```

- [x] **Step 5: Update tests for `buildMeditationArgs` in meditate.test.ts**

Find the `buildMeditationArgs` describe block (around line 256) and add two tests:

```typescript
it("includes mcp__illumination__list_meta_meditations in allowedTools", () => {
  const args = buildMeditationArgs("/proj", "prompt", "/mcp.json");
  expect(args).toContain("mcp__illumination__list_meta_meditations");
});

it("includes mcp__illumination__read_meta_meditation in allowedTools", () => {
  const args = buildMeditationArgs("/proj", "prompt", "/mcp.json");
  expect(args).toContain("mcp__illumination__read_meta_meditation");
});
```

- [x] **Step 6: Run tests to confirm all pass**

```bash
cd /Users/josu/Documents/projects/ralph-cli && npx vitest run src/cli/tests/meditate.test.ts
```

Expected: all PASS

- [x] **Step 7: Commit**

```bash
git add src/cli/commands/meditate.ts src/cli/tests/meditate.test.ts
git commit -m "feat: pass meditationsDir to MCP server and whitelist new tools in meditate"
```

---

## Chunk 5: Update PROMPT_meditation.md

**Files:**
- Modify: `src/cli/prompts/PROMPT_meditation.md`

- [x] **Step 1: Replace the full file content**

Overwrite `src/cli/prompts/PROMPT_meditation.md` with:

```markdown
You are a silent analyst for this software project. Your role is reflective, not executive — you observe, think, and write insights. You cannot and will not implement anything.

## Tools available

You have tools for exploring the project:

- `project_tree` — call with no arguments to see the full file/folder structure of the project.
  Use this first to orient yourself. Optionally pass a subdirectory path to see just that subtree.
- `glob_files(pattern)` — find files matching a glob pattern (e.g. `"src/**/*.ts"`). Pattern must
  be relative to the project root.
- `read_file(path)` — read a file by relative path (e.g. `"src/cli/index.ts"`).

You also have tools for meta-meditations — curated lenses from the ralph-cli tool itself:

- `list_meta_meditations` — list available lens filenames. Call this before reading any.
- `read_meta_meditation(filename)` — read a specific lens by filename.

All project tools are restricted to the project folder. You may only write illumination files using the `write_illumination` tool — no other writes are permitted.

Your working context:
- Project files are available to read in the current directory
- Meta-meditations are interpretive lenses — themes, patterns, and questions to focus your reflection
- You may only write illumination files using the `write_illumination` tool

Your task for this session:
1. Call `project_tree` with no arguments to orient yourself in the project structure
2. Use `glob_files` and `read_file` to explore files relevant to the current state of the codebase, architecture, and plans
3. Call `list_meta_meditations` to see available lenses, then call `read_meta_meditation` on whichever feel most relevant to what you observe
4. If no meta-meditations are available, reflect on the code directly — you can still produce a valuable illumination
5. Reflect deeply on the intersection: what does the project need, and what do the lenses reveal about it?
6. When you are ready to record the illumination, call `write_illumination` with:
   - `filename`: use the format `YYYY-MM-DDTHHMM-kebab-slug.md` (example: `2026-04-04T1430-the-thing-i-noticed.md`). No colons in the filename.
   - `content`: the full markdown content of the illumination
   Do not use the `Write` tool directly — it is not available in this session.

The illumination file must contain exactly these sections:

## Core Idea
State the insight plainly in 2–4 sentences. No padding.

## Why It Matters
Connect it to the project's current situation, goals, or pain points. Be specific — reference actual files or patterns you observed.

## Revised Implementation Steps
Ordered, concrete steps a developer could act on tomorrow. Each step actionable enough to become a task. 3–7 steps max.

Write for a human who will read this in the morning. Be direct. No filler. No hedging.
```

- [x] **Step 2: Run full test suite to confirm nothing broke**

```bash
cd /Users/josu/Documents/projects/ralph-cli && npx vitest run
```

Expected: all PASS

- [x] **Step 3: Build to confirm clean compile**

```bash
cd /Users/josu/Documents/projects/ralph-cli && npm run build
```

Expected: build succeeds

- [x] **Step 4: Commit**

```bash
git add src/cli/prompts/PROMPT_meditation.md
git commit -m "docs: update PROMPT_meditation to use list/read_meta_meditation tools"
```

---

## Chunk 6: Include `meditations/` in npm package

**Files:**
- Modify: `package.json`

The `"files"` array currently contains only `"dist"`. The `meditations/` folder lives at the package root and must be explicitly included, otherwise `npm publish` will exclude it and every `list_meta_meditations` call on an installed package will return the empty-dir fallback message.

- [x] **Step 1: Add `"meditations"` to the `files` array in `package.json`**

Change the `"files"` field from:

```json
"files": [
  "dist"
]
```

to:

```json
"files": [
  "dist",
  "meditations"
]
```

- [x] **Step 2: Verify the meditations directory has files**

```bash
ls /Users/josu/Documents/projects/ralph-cli/meditations/*.md | wc -l
```

Expected: 23 (or more)

- [x] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore: include meditations/ in npm package files"
```
