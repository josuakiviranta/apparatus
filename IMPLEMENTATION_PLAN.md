> **Status: ALL TASKS COMPLETE.** Every item in this plan has been implemented, tested, and committed as of 2026-04-04.

# Meditate Illumination MCP Server Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Replace the broken `--allowedTools Write(path)` approach with a bundled stdio MCP server that enforces the `meditations/illuminations/` write path in TypeScript code.

**Architecture:** A new `src/cli/mcp/illumination-server.ts` entry point is compiled by tsup to `dist/mcp/illumination-server.js`. Before spawning Claude, `meditate.ts` writes a PID-namespaced `.mcp.ralph-<pid>.json` config file in the project folder, passes it via `--mcp-config`, and removes it on exit. Claude uses only `Read`, `Glob`, and `mcp__illumination__write_illumination` — no `Write` permission.

**Tech Stack:** TypeScript, Node.js, `@modelcontextprotocol/server` ^1.0.0, `zod` (runtime), tsup, vitest

**Spec:** `docs/superpowers/specs/2026-04-04-meditate-illumination-mcp-design.md`

---

## Chunk 1: MCP Server — core logic, tests, build config

### Task 1: Install runtime dependencies

**Files:**
- Modify: `package.json`

- [x] **Step 1: Install `@modelcontextprotocol/server` and `zod`**

```bash
npm install @modelcontextprotocol/server@^1.0.0 zod@^3.24.0
```

> Note: `zod/v4` is the import path for Zod v4 API within a `zod` ^3.x install. The `^3.24.0` floor guarantees the `/v4` subpath export exists.

- [x] **Step 2: Verify both packages appear in `dependencies` in `package.json`** (not devDependencies)

---

### Task 2: Write failing tests for the MCP server logic

The MCP server exports two pure helper functions — `validateFilename` and `writeIllumination` — so they can be tested without spinning up a full MCP process.

**Files:**
- Create: `src/cli/tests/illumination-server.test.ts`

- [x] **Step 1: Create the test file**

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, realpathSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { validateFilename, writeIllumination } from "../mcp/illumination-server";

let tmpDir: string;

beforeEach(() => {
  // realpathSync resolves macOS /var → /private/var symlink so path comparisons match
  tmpDir = realpathSync(mkdtempSync(join(tmpdir(), "ralph-test-")));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("validateFilename", () => {
  it("accepts a valid kebab-slug filename", () => {
    expect(validateFilename("2026-04-04T1430-my-insight.md")).toBeNull();
  });

  it("accepts underscores", () => {
    expect(validateFilename("my_insight.md")).toBeNull();
  });

  it("rejects filename containing a slash", () => {
    expect(validateFilename("some/path.md")).not.toBeNull();
  });

  it("rejects filename containing ..", () => {
    expect(validateFilename("../escape.md")).not.toBeNull();
  });

  it("rejects filename containing a colon", () => {
    expect(validateFilename("2026-04-04T14:30-slug.md")).not.toBeNull();
  });

  it("rejects filename without .md extension", () => {
    expect(validateFilename("my-insight.txt")).not.toBeNull();
  });

  it("rejects empty string", () => {
    expect(validateFilename("")).not.toBeNull();
  });
});

describe("writeIllumination", () => {
  it("writes content to meditations/illuminations/<filename>", () => {
    const result = writeIllumination(tmpDir, "2026-04-04T1430-test.md", "# Hello");
    // Use join (not resolve) for comparison — implementation returns join-based path
    const expected = join(tmpDir, "meditations", "illuminations", "2026-04-04T1430-test.md");
    expect(result).toBe(expected);
    expect(readFileSync(expected, "utf8")).toBe("# Hello");
  });

  it("overwrites an existing file without error", () => {
    writeIllumination(tmpDir, "test.md", "v1");
    const result = writeIllumination(tmpDir, "test.md", "v2");
    expect(readFileSync(result, "utf8")).toBe("v2");
  });

  it("creates meditations/illuminations/ directory if absent", () => {
    writeIllumination(tmpDir, "test.md", "content");
    expect(existsSync(join(tmpDir, "meditations", "illuminations"))).toBe(true);
  });

  it("throws an error for an invalid filename", () => {
    expect(() => writeIllumination(tmpDir, "bad/name.md", "content")).toThrow();
  });
});
```

- [x] **Step 2: Run the tests to confirm they fail (module not found)**

```bash
npm test -- illumination-server
```

Expected: FAIL — `Cannot find module '../mcp/illumination-server'`

---

### Task 3: Implement the MCP server

**Files:**
- Create: `src/cli/mcp/illumination-server.ts`

- [x] **Step 1: Create the directory**

```bash
mkdir -p src/cli/mcp
```

- [x] **Step 2: Create `illumination-server.ts`**

```typescript
import { mkdirSync, writeFileSync, statSync } from "fs";
import { join } from "path";
import { McpServer, StdioServerTransport } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

// ─── Exported pure helpers (for testing) ──────────────────────────────────────

const FILENAME_RE = /^[\w-]+\.md$/;

/**
 * Validates a filename for an illumination file.
 * Returns null if valid, or an error message string if invalid.
 */
export function validateFilename(filename: string): string | null {
  if (!FILENAME_RE.test(filename)) {
    return `Invalid filename "${filename}". Must match [\\w-]+\\.md (no slashes, colons, or path components).`;
  }
  return null;
}

/**
 * Writes content to <projectRoot>/meditations/illuminations/<filename>.
 * Creates the directory if absent. Returns the resolved absolute path.
 * Throws if the filename is invalid.
 */
export function writeIllumination(projectRoot: string, filename: string, content: string): string {
  const err = validateFilename(filename);
  if (err) throw new Error(err);
  const dir = join(projectRoot, "meditations", "illuminations");
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, filename);  // no resolve() — avoids macOS /var → /private/var mismatch
  writeFileSync(filePath, content, "utf8");
  return filePath;
}

// ─── Server bootstrap ─────────────────────────────────────────────────────────

const projectRoot = process.argv[2];

if (!projectRoot) {
  console.error("Error: project root must be passed as first argument");
  process.exit(1);
}

try {
  const stat = statSync(projectRoot);
  if (!stat.isDirectory()) {
    console.error(`Error: "${projectRoot}" is not a directory`);
    process.exit(1);
  }
} catch {
  console.error(`Error: "${projectRoot}" does not exist or is not accessible`);
  process.exit(1);
}

const server = new McpServer({ name: "illumination", version: "1.0.0" });

server.registerTool(
  "write_illumination",
  {
    description:
      "Write a meditation illumination file to meditations/illuminations/. " +
      "Use filename format: YYYY-MM-DDTHHMM-kebab-slug.md (e.g. 2026-04-04T1430-my-insight.md).",
    inputSchema: z.object({
      filename: z.string(),
      content: z.string(),
    }),
  },
  async ({ filename, content }) => {
    try {
      const filePath = writeIllumination(projectRoot, filename, content);
      return { content: [{ type: "text" as const, text: `Written to ${filePath}` }] };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text" as const, text: `Error: ${msg}` }] };
    }
  }
);

process.on("SIGINT", async () => {
  await server.close();
  process.exit(0);
});

// CJS bundles do not support bare top-level await — wrap in async IIFE
(async () => {
  const transport = new StdioServerTransport();
  await server.connect(transport);
})();
```

- [x] **Step 3: Run the tests to confirm they pass**

```bash
npm test -- illumination-server
```

Expected: all 9 tests PASS

- [x] **Step 4: Commit**

```bash
git add src/cli/mcp/illumination-server.ts src/cli/tests/illumination-server.test.ts package.json package-lock.json
git commit -m "feat: add illumination MCP server with path-restricted write_illumination tool"
```

---

### Task 4: Add MCP server as second tsup entry point

**Files:**
- Modify: `tsup.config.ts`

- [x] **Step 1: Update entry array in `tsup.config.ts`**

Change line 5 from:
```typescript
  entry: ["src/cli/index.ts"],
```
To:
```typescript
  entry: ["src/cli/index.ts", "src/cli/mcp/illumination-server.ts"],
```

- [x] **Step 2: Build and verify both outputs exist**

```bash
npm run build
ls dist/mcp/
```

Expected: `illumination-server.js` present in `dist/mcp/`

> tsup preserves the directory structure relative to the source root: `src/cli/mcp/illumination-server.ts` → `dist/mcp/illumination-server.js`. The `getIlluminationServerPath()` prod branch in Task 5 (`join(__dirname, "mcp", "illumination-server.js")`) depends on this. If for any reason tsup flattens the output to `dist/illumination-server.js`, update that prod path to `join(__dirname, "illumination-server.js")`.

- [x] **Step 3: Commit**

```bash
git add tsup.config.ts
git commit -m "build: add illumination-server as second tsup entry point"
```

---

## Chunk 2: Integration — wire MCP server into meditate command

### Task 5: Add `getIlluminationServerPath()` to assets.ts

**Files:**
- Modify: `src/cli/lib/assets.ts`

The existing `getAssetPath()` uses `basename(__dirname)` — `"dist"` in prod, `"lib"` in dev.
For the MCP server, prod path is `dist/mcp/illumination-server.js` and dev is `src/cli/mcp/illumination-server.ts`.

- [x] **Step 1: Add `getIlluminationServerPath()` to `assets.ts`**

Append after the last export:

```typescript
export function getIlluminationServerPath(): string {
  const dir = basename(__dirname);
  if (dir === "dist") {
    // production: tsup compiled to dist/index.js, MCP server at dist/mcp/illumination-server.js
    return join(__dirname, "mcp", "illumination-server.js");
  } else {
    // dev: tsx runs from src/cli/lib/, MCP server source at src/cli/mcp/illumination-server.ts
    return join(__dirname, "..", "mcp", "illumination-server.ts");
  }
}
```

- [x] **Step 2: Add a test for `getIlluminationServerPath()` in `assets.test.ts`**

Open `src/cli/tests/assets.test.ts`. Add after the last test:

```typescript
it("getIlluminationServerPath returns a path ending in illumination-server.ts or .js", () => {
  const p = getIlluminationServerPath();
  expect(p).toMatch(/illumination-server\.(ts|js)$/);
});
```

Also add `getIlluminationServerPath` to the import from `"../lib/assets"`.

- [x] **Step 3: Run assets tests**

```bash
npm test -- assets
```

Expected: all tests PASS

- [x] **Step 4: Commit**

```bash
git add src/cli/lib/assets.ts src/cli/tests/assets.test.ts
git commit -m "feat: add getIlluminationServerPath to assets"
```

---

### Task 6: Add MCP config helpers to meditate.ts

Two new exported functions: `writeMcpConfig` and `cleanupMcpConfig`.

**Files:**
- Modify: `src/cli/commands/meditate.ts`
- Modify: `src/cli/tests/meditate.test.ts`

- [x] **Step 1: Write failing tests for the new helpers**

Add to `src/cli/tests/meditate.test.ts` (import `writeMcpConfig` and `cleanupMcpConfig` from `"../commands/meditate"`):

```typescript
import {
  // ... existing imports ...
  writeMcpConfig,
  cleanupMcpConfig,
} from "../commands/meditate";

describe("writeMcpConfig", () => {
  let tmpDir: string;
  beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), "ralph-mcp-")); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it("writes a .mcp.ralph-<pid>.json file in the project folder", () => {
    const configPath = writeMcpConfig(tmpDir);
    expect(existsSync(configPath)).toBe(true);
    expect(configPath).toMatch(/\.mcp\.ralph-\d+\.json$/);
  });

  it("config JSON contains illumination mcpServer entry with correct projectRoot", () => {
    const configPath = writeMcpConfig(tmpDir);
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    expect(config.mcpServers.illumination).toBeDefined();
    const args: string[] = config.mcpServers.illumination.args;
    expect(args[args.length - 1]).toBe(tmpDir);
  });
});

describe("cleanupMcpConfig", () => {
  let tmpDir: string;
  beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), "ralph-mcp-")); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it("removes the config file if it exists", () => {
    const configPath = writeMcpConfig(tmpDir);
    cleanupMcpConfig(configPath);
    expect(existsSync(configPath)).toBe(false);
  });

  it("does not throw if the file does not exist", () => {
    expect(() => cleanupMcpConfig(join(tmpDir, "nonexistent.json"))).not.toThrow();
  });
});
```

You will also need `mkdtempSync`, `rmSync`, `existsSync`, `readFileSync` imported at the top of the test file. The existing `meditate.test.ts` imports are: `mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync` from `"fs"` — check before adding duplicates. `rmSync` may already be there; if not, add it.

- [x] **Step 2: Run tests to confirm they fail**

```bash
npm test -- meditate
```

Expected: FAIL — `writeMcpConfig is not exported`

- [x] **Step 3: Implement `writeMcpConfig` and `cleanupMcpConfig` in `meditate.ts`**

Add these imports at the top of `meditate.ts` (they complement existing imports):
```typescript
import { rmSync } from "fs";          // add rmSync to existing fs import
import { getIlluminationServerPath } from "../lib/assets";
```

Add the two helpers in the `// ─── Session runner ───` section, before `buildMeditationArgs`:

```typescript
/**
 * Detects whether the process is running under tsx (dev mode).
 * In dev: __dirname ends with "lib" (tsx runs src/cli/lib).
 * In prod: __dirname ends with "dist".
 */
function isDevMode(): boolean {
  return basename(__dirname) !== "dist";
}

/**
 * Writes a PID-namespaced MCP config file to <projectRoot>/.mcp.ralph-<pid>.json.
 * Returns the absolute path to the written file.
 */
export function writeMcpConfig(projectRoot: string): string {
  const configPath = join(projectRoot, `.mcp.ralph-${process.pid}.json`);
  const serverPath = getIlluminationServerPath();
  const command = isDevMode() ? "tsx" : "node";
  const config = {
    mcpServers: {
      illumination: {
        type: "stdio",
        command,
        args: [serverPath, projectRoot],
      },
    },
  };
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
  return configPath;
}

/**
 * Removes the MCP config file. Silently ignores ENOENT.
 */
export function cleanupMcpConfig(configPath: string): void {
  rmSync(configPath, { force: true });
}
```

- [x] **Step 4: Run tests to confirm they pass**

```bash
npm test -- meditate
```

Expected: new writeMcpConfig and cleanupMcpConfig tests PASS (existing tests still pass)

- [x] **Step 5: Commit**

```bash
git add src/cli/commands/meditate.ts src/cli/tests/meditate.test.ts
git commit -m "feat: add writeMcpConfig and cleanupMcpConfig helpers to meditate"
```

---

### Task 7: Update `buildMeditationArgs` and wire MCP config into session runner

**Files:**
- Modify: `src/cli/commands/meditate.ts`
- Modify: `src/cli/tests/meditate.test.ts`

- [x] **Step 1: Update the `buildMeditationArgs` tests to reflect the new signature and permissions**

In `meditate.test.ts`, find the `describe("buildMeditationArgs", ...)` block and replace it entirely:

```typescript
describe("buildMeditationArgs", () => {
  const absPath = "/fake/project";
  const prompt = "test prompt";
  const mcpConfigPath = "/fake/project/.mcp.ralph-12345.json";

  it("includes Read and Glob in allowedTools", () => {
    const args = buildMeditationArgs(absPath, prompt, mcpConfigPath);
    const allowed = args
      .map((a, i) => (args[i - 1] === "--allowedTools" ? a : null))
      .filter(Boolean);
    expect(allowed).toContain("Read");
    expect(allowed).toContain("Glob");
  });

  it("allows the MCP illumination tool", () => {
    const args = buildMeditationArgs(absPath, prompt, mcpConfigPath);
    const allowed = args
      .map((a, i) => (args[i - 1] === "--allowedTools" ? a : null))
      .filter(Boolean);
    expect(allowed).toContain("mcp__illumination__write_illumination");
  });

  it("does not allow Write tool", () => {
    const args = buildMeditationArgs(absPath, prompt, mcpConfigPath);
    const allowed = args
      .map((a, i) => (args[i - 1] === "--allowedTools" ? a : null))
      .filter(Boolean);
    expect(allowed.some((a) => a?.startsWith("Write"))).toBe(false);
  });

  it("does not disallow ToolSearch explicitly (not in allowedTools is sufficient)", () => {
    const args = buildMeditationArgs(absPath, prompt, mcpConfigPath);
    expect(args).not.toContain("--disallowedTools");
  });

  it("passes --mcp-config with the config path", () => {
    const args = buildMeditationArgs(absPath, prompt, mcpConfigPath);
    const idx = args.indexOf("--mcp-config");
    expect(args[idx + 1]).toBe(mcpConfigPath);
  });

  it("sets permission-mode to dontAsk", () => {
    const args = buildMeditationArgs(absPath, prompt, mcpConfigPath);
    const modeIdx = args.indexOf("--permission-mode");
    expect(args[modeIdx + 1]).toBe("dontAsk");
  });

  it("sets --add-dir to absPath", () => {
    const args = buildMeditationArgs(absPath, prompt, mcpConfigPath);
    const dirIdx = args.indexOf("--add-dir");
    expect(args[dirIdx + 1]).toBe(absPath);
  });

  it("passes prompt text via -p flag", () => {
    const args = buildMeditationArgs(absPath, prompt, mcpConfigPath);
    const pIdx = args.indexOf("-p");
    expect(args[pIdx + 1]).toBe(prompt);
  });
});
```

- [x] **Step 2: Run tests to confirm they fail**

```bash
npm test -- meditate
```

Expected: FAIL — `buildMeditationArgs` missing `mcpConfigPath` param and wrong allowedTools

- [x] **Step 3: Replace `buildMeditationArgs` implementation in `meditate.ts`**

Replace the entire function (lines ~153–171) with:

```typescript
export function buildMeditationArgs(
  absPath: string,
  promptText: string,
  mcpConfigPath: string
): string[] {
  return [
    "--print",
    "--output-format", "stream-json",
    "--permission-mode", "dontAsk",
    "--allowedTools", "Read",
    "--allowedTools", "Glob",
    "--allowedTools", "mcp__illumination__write_illumination",
    "--mcp-config", mcpConfigPath,
    "--add-dir", absPath,
    "-p", promptText,
  ];
}
```

Also remove the now-unused `resolve` import from `"path"` if it's only used for the old `illuminationsAbs` calculation. Keep `join` and `basename`.

- [x] **Step 4: Run tests to confirm they pass**

```bash
npm test -- meditate
```

Expected: all meditate tests PASS

- [x] **Step 5: Commit**

```bash
git add src/cli/commands/meditate.ts src/cli/tests/meditate.test.ts
git commit -m "feat: update buildMeditationArgs to use MCP config instead of Write allowedTools"
```

---

### Task 8: Wire `writeMcpConfig`/`cleanupMcpConfig` into `runMeditationSession`

**Files:**
- Modify: `src/cli/commands/meditate.ts`

- [x] **Step 1: Update `runMeditationSession` to write and clean up the MCP config**

Replace the `runMeditationSession` function body. The key changes are:
1. Call `writeMcpConfig(absPath)` before building args
2. Pass `mcpConfigPath` to `buildMeditationArgs`
3. Call `cleanupMcpConfig(mcpConfigPath)` in the cleanup handler and after `child.on("close")`

```typescript
async function runMeditationSession(absPath: string): Promise<void> {
  writePid(absPath, process.pid);

  const prompt = readFileSync(getMeditationPromptPath(), "utf8");
  const mcpConfigPath = writeMcpConfig(absPath);

  const border = "\u2501".repeat(40);
  console.log(border);
  console.log(`Mode:    meditate`);
  console.log(`Project: ${absPath}`);
  console.log(`PID:     ${process.pid} (ralph meditate kill <folder> to stop)`);
  console.log(border);
  console.log();

  const args = buildMeditationArgs(absPath, prompt, mcpConfigPath);

  const child = spawn("claude", args, {
    cwd: absPath,
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });

  const cleanup = () => {
    child.kill("SIGTERM");
    removePid(absPath);
    cleanupMcpConfig(mcpConfigPath);
  };
  process.once("SIGTERM", cleanup);
  process.once("SIGINT", cleanup);

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
            }
          }
        }
      } catch {}
    }
  });

  child.stderr.on("data", (chunk: Buffer) => process.stderr.write(chunk));

  await new Promise<void>((res) => child.on("close", () => {
    // Clean up inside the close callback — not after the await — so cleanup
    // happens even if the outer function returns before this fires.
    try { cleanupMcpConfig(mcpConfigPath); } catch {}
    res();
  }));

  process.off("SIGTERM", cleanup);
  process.off("SIGINT", cleanup);
  removePid(absPath);
}
```

- [x] **Step 2: Run the full test suite**

```bash
npm run test
```

Expected: all tests PASS

- [x] **Step 3: Commit**

```bash
git add src/cli/commands/meditate.ts
git commit -m "feat: wire MCP config lifecycle into runMeditationSession"
```

---

### Task 9: Add `.mcp.ralph-*.json` to gitignore scaffold

**Files:**
- Modify: `src/cli/commands/meditate.ts` (`appendMeditateGitignore`)
- Modify: `src/cli/commands/new.ts` (project scaffold gitignore)
- Modify: `src/cli/tests/meditate.test.ts` (gitignore test)

- [x] **Step 1: Update `appendMeditateGitignore` entries**

In `meditate.ts`, find `appendMeditateGitignore`. The `entries` array currently is:
```typescript
const entries = [".meditate.json", ".meditate.log", ".meditate.pid"];
```
Change to:
```typescript
const entries = [".meditate.json", ".meditate.log", ".meditate.pid", ".mcp.ralph-*.json"];
```

- [x] **Step 2: Update the gitignore test in `meditate.test.ts`**

Find the `appendMeditateGitignore` test and add:
```typescript
it("adds .mcp.ralph-*.json to .gitignore", () => {
  appendMeditateGitignore(tmpDir);
  const content = readFileSync(join(tmpDir, ".gitignore"), "utf8");
  expect(content).toContain(".mcp.ralph-*.json");
});
```

- [x] **Step 3: Add `.mcp.ralph-*.json` to the `new.ts` scaffold gitignore**

Open `src/cli/commands/new.ts` and search for where the scaffold `.gitignore` is written (look for the gitignore content string or array — it contains entries like `PROMPT-*.md` and `IMPLEMENTATION_PLAN.md`). Add `.mcp.ralph-*.json` to that list.

> If `new.ts` does not yet have a gitignore scaffold (i.e., the feature is not yet implemented), skip this step — it will be addressed when `new.ts` is implemented.

- [x] **Step 4: Run the full test suite**

```bash
npm run test
```

Expected: all tests PASS

- [x] **Step 5: Commit**

```bash
git add src/cli/commands/meditate.ts src/cli/commands/new.ts src/cli/tests/meditate.test.ts
git commit -m "chore: add .mcp.ralph-*.json to gitignore entries"
```

---

### Task 10: Update `PROMPT_meditation.md`

**Files:**
- Modify: `src/cli/prompts/PROMPT_meditation.md`

- [x] **Step 1: Update the prompt**

Replace the current step 4 and the line about `meditations/illuminations/` writes:

Current text (around line 7–8 and line 18):
```
You may write only to `meditations/illuminations/` — no other writes are permitted.
...
4. Write a single illumination file to `meditations/illuminations/` — choose a descriptive filename with a timestamp prefix (e.g. `2026-04-03T14:32-your-topic-here.md`)
```

Replace with:
```
You may only write illumination files using the `write_illumination` tool — no other writes are permitted.
...
4. When you are ready to record the illumination, call `write_illumination` with:
   - `filename`: use the format `YYYY-MM-DDTHHMM-kebab-slug.md` (example: `2026-04-04T1430-the-thing-i-noticed.md`). No colons in the filename.
   - `content`: the full markdown content of the illumination
   Do not use the `Write` tool directly — it is not available in this session.
```

- [x] **Step 2: Build and verify the prompt is copied to dist**

```bash
npm run build
cat dist/prompts/PROMPT_meditation.md
```

Expected: the updated prompt text is present in `dist/prompts/PROMPT_meditation.md`

- [x] **Step 3: Commit**

```bash
git add src/cli/prompts/PROMPT_meditation.md
git commit -m "docs: update PROMPT_meditation to use write_illumination MCP tool"
```

---

### Task 11: End-to-end build and smoke test

- [x] **Step 1: Full clean build**

```bash
npm run build
ls dist/
ls dist/mcp/
```

Expected:
- `dist/index.js` present
- `dist/mcp/illumination-server.js` present
- `dist/prompts/PROMPT_meditation.md` present

- [x] **Step 2: Run full test suite one final time**

```bash
npm run test
```

Expected: all tests PASS

- [x] **Step 3: Re-link the global binary**

```bash
npm link
```

> If `npm link` was already run once, this is a no-op — the symlink already picks up the new dist. But run it anyway to confirm no errors.

- [x] **Step 4: Manual smoke test**

Run `ralph meditate <any-project-folder>` and observe:
- The session starts without errors
- A `.mcp.ralph-<pid>.json` file appears in the project folder during the session
- The session completes and the file is removed
- A file is written to `<project>/meditations/illuminations/`

- [x] **Step 5: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: <describe any fixes from smoke test>"
```

---

## Learnings

1. **Correct npm package name:** The npm package is `@modelcontextprotocol/sdk` (not `@modelcontextprotocol/server` as originally planned). Import paths: `@modelcontextprotocol/sdk/server/mcp.js` for `McpServer`, `@modelcontextprotocol/sdk/server/stdio.js` for `StdioServerTransport`.

2. **TS2589 "Type instantiation is excessively deep":** The SDK's `registerTool` and `tool()` overloads cause this error when zod schemas are provided via dynamic imports. Fixed with a `@ts-expect-error` directive.

3. **`inputSchema` accepts a raw shape object:** `registerTool`/`tool()` accepts a raw shape object (e.g. `{ filename: z.string() }`) — no need to wrap in `z.object()`.

4. **Server bootstrap guard for vitest:** Server bootstrap code must be guarded from running during vitest (checked via `process.env.VITEST === "true"`) and MCP SDK imports are dynamic to avoid pulling them in during tests.
