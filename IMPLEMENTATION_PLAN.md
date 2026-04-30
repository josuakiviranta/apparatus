# Consume-Only Illumination Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the illumination lifecycle to two states (alive on disk vs consumed) by replacing the three lifecycle MCP tools (`mark_dispatched` / `mark_implemented` / `mark_archived`) with a single `consume(filename, reason)` tool, deleting the `archived-illuminations/` and `implemented-illuminations/` side folders, removing the `dispatched` state from the pipeline, and refocusing the janitor agent on KISS code-hygiene illumination authoring.

**Architecture:** One new MCP tool (`consume`) that performs `git rm <file>` + commit. Pipeline gate collapses from 3 paths (implement / dispatch / archive) to 2 (implement / decline). Plan files lose `illumination_source` frontmatter; illuminations lose `status:` frontmatter. Janitor's reconciliation walk is deleted; its prompt is rewritten to scan source/workspace for bloat / YAGNI / refactor opportunities and emit illuminations describing them. The single `pipelines/illumination-to-implementation/mark-archived.mjs` script is replaced by a `consume.mjs` script that mirrors the MCP tool's signature for the pipeline tool-node decline path.

**Tech Stack:** TypeScript (vitest, zod, MCP SDK), Node.js (.mjs scripts, vitest for script tests), DOT pipeline graph, markdown agent prompts.

**Reference docs (read before starting):**
- `CONTEXT.md` — illumination-lifecycle and janitor glossary entries (added in the same change as this plan)
- `docs/adr/0002-consume-only-illumination-lifecycle.md` — the architectural decision and its considered alternatives
- `memory/2026-04-25-state-machine-exists-verifier-ignores-it.md` — pre-rewrite janitor / lifecycle context for historical reference

---

## Chunk 1: MCP server — `consume` tool + lifecycle-tool removal

This chunk lands the new `consume` pure helper with tests, registers the `consume` MCP tool, drops the `status` parameter from `list_illuminations`, removes the `status: open` line from `writeIllumination`'s frontmatter template, and deletes the three obsolete lifecycle functions (`markImplemented`, `markDispatched`, `markArchived`) along with their tool registrations and tests.

**Files:**
- Modify: `src/cli/mcp/illumination-server.ts` (lines 1, 38-64, 66-330, 334-374, 660-716)
- Modify: `src/cli/tests/illumination-server.test.ts` (named imports + every `mark_*` describe block + every `listIlluminations` status filter assertion)

### Task 1.1: Add `consume()` pure helper with failing tests

**Files:**
- Modify: `src/cli/tests/illumination-server.test.ts` (add `consume` to named imports + new describe block at file end)
- Modify: `src/cli/mcp/illumination-server.ts` (export new function; do NOT register MCP tool yet)

- [x] **Step 1: Add `consume` to the named imports**

In `src/cli/tests/illumination-server.test.ts:14`, add `consume` to the imports:

```ts
import { ..., consume, ... } from "../mcp/illumination-server";
```

(Keep alphabetical-ish order matching the existing list; do not delete other imports yet.)

- [x] **Step 2: Write failing tests for `consume`**

Append to the bottom of `src/cli/tests/illumination-server.test.ts`:

```ts
describe("consume", () => {
  function seedIllumination(filename: string, body = "body"): string {
    const dir = join(tmpDir, "meditations", "illuminations");
    mkdirSync(dir, { recursive: true });
    const filePath = join(dir, filename);
    writeFileSync(filePath, `---\ndate: 2026-04-30\ndescription: test\n---\n\n${body}`, "utf8");
    return filePath;
  }

  it("deletes the illumination file from disk", () => {
    const filePath = seedIllumination("2026-04-30T1200-x.md");
    consume(tmpDir, "2026-04-30T1200-x.md", "implemented");
    expect(existsSync(filePath)).toBe(false);
  });

  it("commits with reason in the message — implemented", () => {
    seedIllumination("2026-04-30T1200-x.md");
    consume(tmpDir, "2026-04-30T1200-x.md", "implemented");
    const calls = mockExecSync.mock.calls.map((c) => c[0] as string);
    expect(calls.some((cmd) => cmd.includes("git -C") && cmd.includes("rm"))).toBe(true);
    expect(calls.some((cmd) => cmd.includes("commit -m") && cmd.includes("(implemented)"))).toBe(true);
  });

  it("commits with reason in the message — declined", () => {
    seedIllumination("2026-04-30T1200-y.md");
    consume(tmpDir, "2026-04-30T1200-y.md", "declined");
    const calls = mockExecSync.mock.calls.map((c) => c[0] as string);
    expect(calls.some((cmd) => cmd.includes("commit -m") && cmd.includes("(declined)"))).toBe(true);
  });

  it("rejects invalid filenames", () => {
    expect(() => consume(tmpDir, "../oops", "declined")).toThrow(/Invalid filename/);
  });

  it("rejects unknown reasons", () => {
    seedIllumination("2026-04-30T1200-z.md");
    expect(() => consume(tmpDir, "2026-04-30T1200-z.md", "archived" as never)).toThrow(/reason/i);
  });

  it("returns success descriptor with consumed filename", () => {
    seedIllumination("2026-04-30T1200-r.md");
    const result = consume(tmpDir, "2026-04-30T1200-r.md", "implemented");
    expect(result).toEqual({ success: true, filename: "2026-04-30T1200-r.md", reason: "implemented" });
  });

  it("returns failure when file does not exist", () => {
    const result = consume(tmpDir, "2026-04-30T1200-missing.md", "implemented");
    expect(result).toEqual({ success: false, error: "Illumination file not found" });
  });
});
```

- [x] **Step 3: Run tests — confirm they fail at the import boundary**

Run: `npx vitest run src/cli/tests/illumination-server.test.ts -t consume`
Expected: FAIL — `consume` is not exported from `illumination-server.ts`.

- [x] **Step 4: Implement `consume()` in `illumination-server.ts`**

Add after `writeIllumination` (around line 65):

```ts
export type ConsumeReason = "implemented" | "declined";

export function consume(
  projectRoot: string,
  filename: string,
  reason: ConsumeReason,
): { success: true; filename: string; reason: ConsumeReason }
  | { success: false; error: string } {
  const fnErr = validateFilename(filename);
  if (fnErr) throw new Error(fnErr);
  if (reason !== "implemented" && reason !== "declined") {
    throw new Error(`Invalid reason "${reason}". Must be "implemented" or "declined".`);
  }

  const filePath = join(projectRoot, "meditations", "illuminations", filename);
  if (!existsSync(filePath)) {
    return { success: false, error: "Illumination file not found" };
  }

  rmSync(filePath);

  try {
    execSync(`git -C "${projectRoot}" rm "${filePath}"`, { stdio: "ignore" });
    execSync(
      `git -C "${projectRoot}" commit -m "meditate: consume ${filename} (${reason})"`,
      { stdio: "ignore" },
    );
  } catch {
    // git unavailable / not a repo / nothing to commit — non-fatal, file already removed.
  }

  return { success: true, filename, reason };
}
```

- [x] **Step 5: Run tests — confirm they pass**

Run: `npx vitest run src/cli/tests/illumination-server.test.ts -t consume`
Expected: PASS, 7/7.

- [x] **Step 6: Commit**

```bash
git add src/cli/mcp/illumination-server.ts src/cli/tests/illumination-server.test.ts
git commit -m "feat(illumination): add consume(filename, reason) pure helper + tests"
```

### Task 1.2: Register `consume` MCP tool, drop `status` from `list_illuminations`

**Files:**
- Modify: `src/cli/mcp/illumination-server.ts` (lines 660-672 — `list_illuminations` registration; add new `consume` tool registration)

- [x] **Step 1: Add failing test that proves side-folders are no longer read**

Append a new describe block to `src/cli/tests/illumination-server.test.ts`:

```ts
describe("listIlluminations — single-folder semantics", () => {
  it("returns only files in meditations/illuminations/ (does not union side folders)", () => {
    const aliveDir = join(tmpDir, "meditations", "illuminations");
    const archivedDir = join(tmpDir, "meditations", "archived-illuminations");
    mkdirSync(aliveDir, { recursive: true });
    mkdirSync(archivedDir, { recursive: true });
    writeFileSync(join(aliveDir, "alive.md"), `---\ndate: 2026-04-30\ndescription: alive one\n---\n`);
    writeFileSync(join(archivedDir, "ghost.md"), `---\ndate: 2026-04-30\ndescription: should not appear\n---\n`);

    const result = listIlluminations(tmpDir);

    expect(result).toContain("alive.md");
    expect(result).not.toContain("ghost.md");
    expect(result).not.toContain("should not appear");
  });

  it("returns the no-illuminations sentinel when folder is empty", () => {
    expect(listIlluminations(tmpDir)).toMatch(/no illuminations found/i);
  });
});
```

- [x] **Step 2: Run test — confirm it fails against the current implementation**

Run: `npx vitest run src/cli/tests/illumination-server.test.ts -t "single-folder semantics"`
Expected: FAIL — current `listIlluminations` (no-status branch, lines 363-370) unions all three directories, so `ghost.md` shows up in the result.

- [x] **Step 3: Simplify `listIlluminations`**

Replace lines 334-374 of `src/cli/mcp/illumination-server.ts` with:

```ts
export function listIlluminations(projectRoot: string): string {
  const dir = join(projectRoot, "meditations", "illuminations");
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".md")).sort();
  } catch {
    files = [];
  }
  if (files.length === 0) return NO_ILLUMINATIONS_MESSAGE;
  return files
    .map((name) => `${name} — ${parseIlluminationDescription(join(dir, name))}`)
    .join("\n");
}
```

- [x] **Step 4: Delete the six side-folder `listIlluminations` tests**

The simplified function no longer reads from `meditations/archived-illuminations/` or `meditations/implemented-illuminations/`, so the existing tests asserting status-filtered side-folder reads will fail. Find and delete them.

Run: `grep -nE "status.*archived|status.*implemented|archived-illuminations|implemented-illuminations" src/cli/tests/illumination-server.test.ts`
Note every `it(...)` test case that hits one of those strings inside a `listIlluminations` describe block. Delete each one (the entire `it(...)` block, not just the assertion). Approximate range: lines 550-632 — verify current line numbers via the grep output before editing.

- [x] **Step 5: Update `list_illuminations` MCP registration**

Replace lines 660-672 of `src/cli/mcp/illumination-server.ts` with:

```ts
    server.tool(
      "list_illuminations",
      "List illuminations in meditations/illuminations/, with descriptions. " +
        "Call this at the start of a session to orient yourself before writing new insights. " +
        "No filters — every file in the folder is alive.",
      {},
      async () => {
        const result = listIlluminations(projectRoot);
        return { content: [{ type: "text" as const, text: result }] };
      },
    );
```

- [x] **Step 6: Add `consume` MCP tool registration**

Insert immediately after the `list_illuminations` registration (replacing the old `mark_implemented`, `mark_dispatched`, `mark_archived` blocks at lines 674-716):

```ts
    server.tool(
      "consume",
      "Consume an illumination — delete the file from meditations/illuminations/ and commit the deletion. " +
        "Use reason='implemented' after the implement loop succeeds and a memory file has been written. " +
        "Use reason='declined' when the operator rejects an illumination at the gate. " +
        "Commit message format: 'meditate: consume <filename> (<reason>)' — searchable via git log --grep.",
      {
        filename: z.string(),
        reason: z.enum(["implemented", "declined"]),
      },
      async ({ filename, reason }: { filename: string; reason: "implemented" | "declined" }) => {
        const result = consume(projectRoot, filename, reason);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      },
    );
```

- [x] **Step 7: Run all illumination-server tests**

Run: `npx vitest run src/cli/tests/illumination-server.test.ts`
Expected: PASS — single-folder test passes; side-folder tests have been deleted; the three `mark_*` describe blocks still exist and still pass against unchanged implementations (cleaned up in Task 1.4).

- [x] **Step 8: Commit**

```bash
git add src/cli/mcp/illumination-server.ts src/cli/tests/illumination-server.test.ts
git commit -m "feat(illumination): register consume MCP tool, drop status param from list_illuminations"
```

### Task 1.3: Drop `status: open` from `writeIllumination` frontmatter

**Files:**
- Modify: `src/cli/mcp/illumination-server.ts:48` (frontmatter template)
- Modify: `src/cli/tests/illumination-server.test.ts:134-137` (frontmatter regex assertions)

- [x] **Step 1: Update the failing test first**

Find the existing assertions in `src/cli/tests/illumination-server.test.ts` around line 134:

```ts
expect(written).toMatch(new RegExp(`^---\\ndate: ${today}\\nstatus: open\\ndescription: My core insight\\n---\\n`));
```

Replace with:

```ts
expect(written).toMatch(new RegExp(`^---\\ndate: ${today}\\ndescription: My core insight\\n---\\n`));
```

Find the test `"includes status: open in frontmatter"` (line 137) and DELETE it entirely — no `status:` field is written anymore.

- [x] **Step 2: Run test — confirm it fails**

Run: `npx vitest run src/cli/tests/illumination-server.test.ts -t writeIllumination`
Expected: FAIL — implementation still emits `status: open`.

- [x] **Step 3: Update `writeIllumination` to drop `status: open`**

In `src/cli/mcp/illumination-server.ts:48`, change:

```ts
const frontmatter = `---\ndate: ${date}\nstatus: open\ndescription: ${description.trim()}\n---\n\n`;
```

to:

```ts
const frontmatter = `---\ndate: ${date}\ndescription: ${description.trim()}\n---\n\n`;
```

- [x] **Step 4: Update the `write_illumination` MCP tool description**

In `src/cli/mcp/illumination-server.ts` around line 567-571 (the description string passed to `server.tool("write_illumination", …)`), replace the trailing sentence about `mark_implemented` / `mark_archived` moving the file. New description:

```ts
      "Write a meditation illumination file to meditations/illuminations/. " +
        "Provide a kebab-case `slug` (lowercase alphanumeric + hyphens, e.g. `janitor-doc-drift` or `my-insight`); " +
        "the server prepends the current YYYY-MM-DDTHHMM- timestamp and appends .md — do not include either yourself. " +
        "Provide a one-sentence `description` summarizing the core insight — this is required. " +
        "Frontmatter is auto-generated as `date` + `description` only — no status field. " +
        "Use the `consume` tool with reason='implemented' or 'declined' to remove an illumination after the work it represents is done.",
```

- [x] **Step 5: Run tests — confirm they pass**

Run: `npx vitest run src/cli/tests/illumination-server.test.ts -t writeIllumination`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add src/cli/mcp/illumination-server.ts src/cli/tests/illumination-server.test.ts
git commit -m "feat(illumination): drop status:open from writeIllumination frontmatter"
```

### Task 1.4: Delete `markImplemented`, `markDispatched`, `markArchived` functions, registrations, tests

**Files:**
- Modify: `src/cli/mcp/illumination-server.ts` (delete lines 66-330 — all three `mark_*` functions; delete lines for `mark_implemented`, `mark_dispatched`, `mark_archived` MCP tool registrations)
- Modify: `src/cli/tests/illumination-server.test.ts` (delete imports for `markImplemented`, `markDispatched`, `markArchived`; delete every `describe(...)` block testing them)

- [x] **Step 1: Find every reference to the three functions in tests**

Run: `grep -nE "markImplemented|markDispatched|markArchived" src/cli/tests/illumination-server.test.ts`
Note every line and which `describe` block it belongs to.

- [x] **Step 2: Delete the test imports and describe blocks**

In `src/cli/tests/illumination-server.test.ts`:
- Line 14: remove `markImplemented`, `markDispatched`, `markArchived` from the named imports.
- Delete every `describe("markImplemented", ...)`, `describe("markDispatched", ...)`, `describe("markArchived", ...)` block in full (including all nested `it(...)` cases).
- Delete any `listIlluminations` test asserting `status="archived"` reads from `meditations/archived-illuminations/` or `status="implemented"` reads from `meditations/implemented-illuminations/`.

- [x] **Step 3: Run tests — confirm remaining tests still pass**

Run: `npx vitest run src/cli/tests/illumination-server.test.ts`
Expected: PASS — imports for the three mark_* functions are gone; the function definitions themselves are still in the source file (unused exports are not TS errors). Surviving tests (writeIllumination, listIlluminations, consume, plan helpers) all green.

- [x] **Step 4: Delete the three function definitions**

In `src/cli/mcp/illumination-server.ts`:
- Delete `markImplemented` (around lines 66-133)
- Delete `markDispatched` (around lines 135-195)
- Delete `markArchived` (around lines 198-265)

The exact line ranges may shift after Task 1.3. Search-and-delete by function name; do not touch surrounding helpers (`parseIlluminationDescription`, `writeIllumination`, `consume`, `listIlluminations`).

- [x] **Step 5: Delete the three MCP tool registrations**

In `src/cli/mcp/illumination-server.ts`, delete the three `server.tool("mark_implemented", …)`, `server.tool("mark_dispatched", …)`, `server.tool("mark_archived", …)` blocks. After deletion, the `consume` registration from Task 1.2 should sit alone where they used to be.

- [x] **Step 6: Run typecheck + tests**

Run: `npx tsc --noEmit && npx vitest run src/cli/tests/illumination-server.test.ts`
Expected: PASS — no unresolved imports, all surviving tests green.

- [x] **Step 7: Commit**

```bash
git add src/cli/mcp/illumination-server.ts src/cli/tests/illumination-server.test.ts
git commit -m "refactor(illumination): delete mark_dispatched/mark_implemented/mark_archived tools and tests"
```

### Chunk 1 verification

- [x] **Final check:** Run the full test file and confirm the new tool surface is exactly what we expect.

```bash
npx vitest run src/cli/tests/illumination-server.test.ts
grep -nE "server\.tool\(" src/cli/mcp/illumination-server.ts | grep -E "mark_|list_illuminations|consume|write_illumination"
```

Expected output for the grep (order may differ):
- `server.tool("write_illumination", …)`
- `server.tool("list_illuminations", …)`
- `server.tool("consume", …)`
- (no `mark_*` lines remain)

---

## Chunk 2: Pipeline graph, scripts, and agent prompts

This chunk reshapes the `illumination-to-implementation` pipeline: replaces `mark-archived.mjs` with `consume.mjs`, deletes `mark-dispatched.mjs`, removes the `mark_dispatched` node from `pipeline.dot`, and rewrites four agent prompts (`verifier.md`, `plan-writer.md`, `memory-writer.md`, `memory-reflector.md`) to match the new lifecycle.

**Files:**
- Create: `pipelines/illumination-to-implementation/consume.mjs`
- Create: `pipelines/illumination-to-implementation/tests/consume.test.mjs`
- Delete: `pipelines/illumination-to-implementation/mark-archived.mjs`
- Delete: `pipelines/illumination-to-implementation/tests/mark-archived.test.mjs`
- Delete: `pipelines/illumination-to-implementation/mark-dispatched.mjs`
- Delete: `pipelines/illumination-to-implementation/tests/mark-dispatched.test.mjs`
- Modify: `pipelines/illumination-to-implementation/pipeline.dot` (lines 14-22, 65, 79, 83-86)
- Modify: `pipelines/illumination-to-implementation/verifier.md` (line 60 — drop `status: "open"` filter; line 38 — drop side-folder mentions in discovery rule)
- Modify: `pipelines/illumination-to-implementation/plan-writer.md:47` (drop `illumination_source` requirement)
- Modify: `pipelines/illumination-to-implementation/memory-writer.md` (tools list line 12-13; mission line 56; step 7b lines 132; hard rules line 145; misc references)
- Modify: `pipelines/illumination-to-implementation/memory-reflector.md` (line 29 + line 41 — drop side-folder fallback)

### Task 2.1: Write `consume.mjs` script + tests (TDD)

**Files:**
- Create: `pipelines/illumination-to-implementation/tests/consume.test.mjs`
- Create: `pipelines/illumination-to-implementation/consume.mjs`

- [x] **Step 1: Author the failing test file**

Create `pipelines/illumination-to-implementation/tests/consume.test.mjs`:

```js
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdtempSync,
  rmSync,
  mkdirSync,
  existsSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(__dirname, "..", "consume.mjs");

function runScript(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
}

function setupRepo() {
  const tmp = mkdtempSync(join(tmpdir(), "consume-test-"));
  const illumDir = join(tmp, "meditations", "illuminations");
  mkdirSync(illumDir, { recursive: true });
  const illumPath = join(illumDir, "2026-04-30T1200-x.md");
  writeFileSync(illumPath, `---\ndate: 2026-04-30\ndescription: test\n---\n\nbody\n`);
  spawnSync("git", ["-C", tmp, "init", "-b", "main"], { stdio: "ignore" });
  spawnSync("git", ["-C", tmp, "config", "user.email", "test@example.com"], { stdio: "ignore" });
  spawnSync("git", ["-C", tmp, "config", "user.name", "Test"], { stdio: "ignore" });
  spawnSync("git", ["-C", tmp, "add", "."], { stdio: "ignore" });
  spawnSync("git", ["-C", tmp, "commit", "-m", "seed"], { stdio: "ignore" });
  return { tmp, illumPath };
}

describe("consume.mjs", () => {
  let tmp, illumPath;

  beforeEach(() => {
    ({ tmp, illumPath } = setupRepo());
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("deletes the illumination file with reason=declined", () => {
    const result = runScript([illumPath, "declined"]);
    expect(result.status).toBe(0);
    expect(existsSync(illumPath)).toBe(false);
  });

  it("deletes the illumination file with reason=implemented", () => {
    const result = runScript([illumPath, "implemented"]);
    expect(result.status).toBe(0);
    expect(existsSync(illumPath)).toBe(false);
  });

  it("creates a commit with reason in the message — declined", () => {
    runScript([illumPath, "declined"]);
    const log = spawnSync("git", ["-C", tmp, "log", "-1", "--pretty=%s"], { encoding: "utf8" });
    expect(log.stdout.trim()).toBe("meditate: consume 2026-04-30T1200-x.md (declined)");
  });

  it("creates a commit with reason in the message — implemented", () => {
    runScript([illumPath, "implemented"]);
    const log = spawnSync("git", ["-C", tmp, "log", "-1", "--pretty=%s"], { encoding: "utf8" });
    expect(log.stdout.trim()).toBe("meditate: consume 2026-04-30T1200-x.md (implemented)");
  });

  it("rejects unknown reasons with exit 2", () => {
    const result = runScript([illumPath, "archived"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/reason must be implemented or declined/i);
    expect(existsSync(illumPath)).toBe(true);
  });

  it("exits with usage error when args are missing", () => {
    const result = runScript([]);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/usage:/i);
  });

  it("emits JSON {success: true, filename, reason} on stdout", () => {
    const result = runScript([illumPath, "implemented"]);
    const payload = JSON.parse(result.stdout);
    expect(payload).toEqual({
      success: true,
      filename: "2026-04-30T1200-x.md",
      reason: "implemented",
    });
  });
});
```

- [x] **Step 2: Run the test — confirm it fails because the script does not exist**

Run: `npx vitest run pipelines/illumination-to-implementation/tests/consume.test.mjs`
Expected: FAIL — `consume.mjs` does not exist; spawnSync errors out.

- [x] **Step 3: Implement `consume.mjs`**

Create `pipelines/illumination-to-implementation/consume.mjs`:

```js
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const [illuminationArg, reason] = process.argv.slice(2);
if (!illuminationArg || !reason) {
  console.error("usage: consume.mjs <illumination-path> <implemented|declined>");
  process.exit(2);
}
if (reason !== "implemented" && reason !== "declined") {
  console.error("reason must be implemented or declined");
  process.exit(2);
}

const illuminationPath = path.resolve(illuminationArg);
if (!fs.existsSync(illuminationPath)) {
  console.error(`illumination not found: ${illuminationPath}`);
  process.exit(1);
}

const filename = path.basename(illuminationPath);
const meditationsDir = path.dirname(path.dirname(illuminationPath));
const projectRoot = path.dirname(meditationsDir);

fs.rmSync(illuminationPath);

try {
  execFileSync("git", ["-C", projectRoot, "rm", illuminationPath], { stdio: "ignore" });
  execFileSync(
    "git",
    ["-C", projectRoot, "commit", "-m", `meditate: consume ${filename} (${reason})`],
    { stdio: "ignore" },
  );
} catch {
  // git unavailable / not a repo / nothing to commit — non-fatal, file already removed.
}

console.log(JSON.stringify({ success: true, filename, reason }));
```

- [x] **Step 4: Run the test — confirm it passes**

Run: `npx vitest run pipelines/illumination-to-implementation/tests/consume.test.mjs`
Expected: PASS, 7/7.

- [x] **Step 5: Commit**

```bash
git add pipelines/illumination-to-implementation/consume.mjs pipelines/illumination-to-implementation/tests/consume.test.mjs
git commit -m "feat(pipeline): add consume.mjs script + tests for decline path"
```

### Task 2.2: Delete obsolete scripts (`mark-archived.mjs`, `mark-dispatched.mjs`)

**Files:**
- Delete: `pipelines/illumination-to-implementation/mark-archived.mjs`
- Delete: `pipelines/illumination-to-implementation/tests/mark-archived.test.mjs`
- Delete: `pipelines/illumination-to-implementation/mark-dispatched.mjs`
- Delete: `pipelines/illumination-to-implementation/tests/mark-dispatched.test.mjs`

- [x] **Step 1: Confirm no other code references these scripts**

Run: `grep -rn -E "mark-archived\.mjs|mark-dispatched\.mjs" --include="*.dot" --include="*.md" --include="*.ts" --include="*.mjs" --include="*.js" .`
Expected: only references inside `pipeline.dot` (handled in Task 2.3), the scripts themselves, and their tests. Any other hit must be flagged before deletion.

- [x] **Step 2: Delete the four files**

```bash
git rm pipelines/illumination-to-implementation/mark-archived.mjs
git rm pipelines/illumination-to-implementation/tests/mark-archived.test.mjs
git rm pipelines/illumination-to-implementation/mark-dispatched.mjs
git rm pipelines/illumination-to-implementation/tests/mark-dispatched.test.mjs
```

- [x] **Step 3: Run the full pipeline test suite — confirm nothing else broke**

Run: `npx vitest run pipelines/illumination-to-implementation/tests/`
Expected: PASS (only `consume.test.mjs` and any other unrelated tests in that dir).

- [x] **Step 4: Commit**

```bash
git commit -m "refactor(pipeline): delete mark-archived.mjs and mark-dispatched.mjs (replaced by consume.mjs)"
```

### Task 2.3: Reshape `pipeline.dot` — drop dispatch path, route gates to `consume.mjs`

**Files:**
- Modify: `pipelines/illumination-to-implementation/pipeline.dot`

- [x] **Step 1: Replace the `mark_archived` node definition with `consume_declined`**

In `pipeline.dot` lines 14-17, replace:

```
  mark_archived [type="tool",
                 cwd="$project",
                 script_file="mark-archived.mjs",
                 script_args="$verifier.illumination_path $verifier.archive_reason_short"]
```

with:

```
  consume_declined [type="tool",
                    cwd="$project",
                    script_file="consume.mjs",
                    script_args="$verifier.illumination_path declined"]
```

- [x] **Step 2: Delete the `mark_dispatched` node definition**

In `pipeline.dot` lines 19-22, delete the entire `mark_dispatched [type="tool", …]` block (4 lines).

- [x] **Step 3: Rewire the routing edges**

In `pipeline.dot` lines 59 and 65, change `mark_archived` to `consume_declined`:

```
  remove_gate -> consume_declined  [label="Archive"]
  ...
  approval_gate -> consume_declined  [label="Decline"]
```

In line 79, change the terminator edge:

```
  consume_declined -> done
```

In lines 83-86, replace the plan_writer → mark_dispatched → implement chain with a direct edge:

```
  // Plan writing — plan_writer hands its plan_path directly to implement.
  design_writer -> plan_writer -> implement
```

Delete the now-orphan line `mark_dispatched -> implement` (currently line 86).

- [x] **Step 4: Validate the pipeline**

Run: `npx ralph pipeline validate pipelines/illumination-to-implementation/pipeline.dot`
Expected: PASS — no structural errors, no portability_heuristic warnings (the script_file references a sibling file that exists).

- [x] **Step 5: Run the smoke pipeline test (if one exists for this pipeline)**

Run: `grep -rln "illumination-to-implementation" pipelines/smoke/`
If a smoke fixture exists, run its test. Otherwise, skip this step.

- [x] **Step 6: Commit**

```bash
git add pipelines/illumination-to-implementation/pipeline.dot
git commit -m "refactor(pipeline): collapse gate to implement/decline, drop mark_dispatched node"
```

### Task 2.4: Update `verifier.md` prompt — single-folder, no status filter

**Files:**
- Modify: `pipelines/illumination-to-implementation/verifier.md` (lines 38, 60)

- [x] **Step 1: Update the discovery rule (line 38)**

Find the sentence forbidding direct enumeration of illumination dirs (currently mentions all three folders). Replace with a single-folder version:

```
   - Never Glob, Grep, `ls`, `find`, or Read against `meditations/illuminations/` to enumerate or filter illuminations. Always go through `mcp__illumination__list_illuminations` so the tool's interpretation is the single source of truth.
```

(Drop the `archived-illuminations`, `implemented-illuminations` mentions.)

- [x] **Step 2: Update the list call (line 60)**

Replace:

```
- Otherwise: call `mcp__illumination__list_illuminations` with `status: "open"`. The tool returns one `<filename> — <description>` line per open illumination, or the literal string `No illuminations found.` when empty.
```

with:

```
- Otherwise: call `mcp__illumination__list_illuminations` (no parameters). The tool returns one `<filename> — <description>` line per illumination in `meditations/illuminations/`, or the literal string `No illuminations found.` when empty.
```

- [x] **Step 3: Delete `archive_reason_short` from the verifier output schema and rubric**

The verifier's `archive_reason_short` field used to feed `mark-archived.mjs` via `pipeline.dot`'s `script_args="$verifier.archive_reason_short"`. After Task 2.3 the new tool node hardcodes `declined` as the consume reason — no consumer reads `archive_reason_short` anymore. Delete it entirely (YAGNI):

  - **Line 29** of `verifier.md` — delete the line:

    ```
      archive_reason_short: {type: string, maxLength: 100}
    ```

  - **Lines 78-81** — delete the `archive_reason_short:` bullet (the field description with sub-bullets for each `preferred_label` value).

  - **Line 90** — delete the entire hard-rule paragraph:

    ```
    - You MUST emit `archive_reason_short` on every verdict (`true`, `false`, `empty`). The mark_archived script consumes it verbatim as the illumination's archived frontmatter `reason:` value on whichever path triggers archiving (remove_gate on `false`, approval_gate decline on `true`). Treat the shape constraints (one sentence, ≤100 chars, shell-safe) as strict. Use `Declined at approval gate` on `true` and empty string on `empty`.
    ```

- [x] **Step 4: Update line 61's stale "dispatched / archived" wording**

Line 61 currently reads:

```
2. **Pick one.** If the tool returned `No illuminations found.` → emit `preferred_label: empty`, empty paths, summary "No open illuminations found", explanation "All illuminations in the directory are dispatched, archived, or otherwise closed." (Skip on re-entry — the path is already set.) Otherwise pick one filename and construct `illumination_path` as `meditations/illuminations/<filename>`.
```

Change to:

```
2. **Pick one.** If the tool returned `No illuminations found.` → emit `preferred_label: empty`, empty paths, summary "No illuminations found", explanation "No illuminations remain in `meditations/illuminations/`." (Skip on re-entry — the path is already set.) Otherwise pick one filename and construct `illumination_path` as `meditations/illuminations/<filename>`.
```

- [x] **Step 5: Final sweep — confirm no stale lifecycle vocabulary remains**

Run: `grep -nE "status.*open|status.*dispatched|archived-illuminations|implemented-illuminations|mark_dispatched|mark_archived|archive_reason" pipelines/illumination-to-implementation/verifier.md`
Expected: no matches.

- [x] **Step 6: Commit**

```bash
git add pipelines/illumination-to-implementation/verifier.md
git commit -m "docs(pipeline): update verifier.md to single-folder list_illuminations"
```

**Follow-up nit (discovered during code review of b7bf0cd):** `verifier.md` still says "the MCP server resolves the dir based on the file's lifecycle status" in the read_file hard-rule (~line 39) and procedure step 3 (~line 62). Under the single-folder model that rationale is stale — files always live in `meditations/illuminations/`. Suggest replacing the rationale with: "the MCP server is the authoritative path resolver for illumination files." Pick up in a later sweep alongside Tasks 2.5–2.7 prompt updates.

### Task 2.5: Update `plan-writer.md` — drop `illumination_source` frontmatter

**Files:**
- Modify: `pipelines/illumination-to-implementation/plan-writer.md:47`

- [x] **Step 1: Locate the frontmatter requirement**

Run: `grep -n "illumination_source" pipelines/illumination-to-implementation/plan-writer.md`
Confirm the only hit is at the line directing the agent to write `illumination_source: <basename>` to plan frontmatter.

- [x] **Step 2: Edit the requirement**

Around line 47, the prompt currently says:

```
4. **Begin the plan file with a frontmatter block.** Two fields, in this order: `status: pending` and `illumination_source: <basename of $verifier_illumination_path>` (filename only, no path). Place the block before the plan's first heading, delimited by `---` lines. The downstream `list_plans` MCP tool reads this frontmatter; omitting it makes the produced plan invisible to lifecycle queries.
```

Change to:

```
4. **Begin the plan file with a frontmatter block.** One field: `status: pending`. Place the block before the plan's first heading, delimited by `---` lines. The downstream `list_plans` MCP tool reads this frontmatter; omitting it makes the produced plan invisible to lifecycle queries.
```

- [x] **Step 3: Commit**

```bash
git add pipelines/illumination-to-implementation/plan-writer.md
git commit -m "docs(pipeline): drop illumination_source from plan frontmatter"
```

### Task 2.6: Update `memory-writer.md` — call `consume(reason: implemented)`

**Files:**
- Modify: `pipelines/illumination-to-implementation/memory-writer.md` (lines 12-13 tools, line 56 trace bullet, lines 128-134 step 7, line 145 hard rules, line 97 example)

- [x] **Step 1: Update the `tools:` list**

Lines 12-13 currently list:

```yaml
  - mcp__illumination__mark_plan_implemented
  - mcp__illumination__mark_implemented
```

Replace with:

```yaml
  - mcp__illumination__mark_plan_implemented
  - mcp__illumination__consume
```

- [x] **Step 2: Update the trace-reading bullet at line 56**

Line 56 currently mentions `mark_archived, mark_dispatched`. Change to:

```
   - Tool-node failures (consume, push).
```

- [x] **Step 3: Rewrite step 7b (the illumination-side lifecycle call)**

The current step 7 framing — "closes BOTH halves of the open/close pair that `mark_dispatched` opened upstream" — is obsolete. Rewrite the entire step 7 (lines ~128-134) as:

```
7. **Mark the lifecycle artifacts complete (best-effort, both halves).** Run them in this order:

   **7a. Plan side.** If `$plan_writer.plan_path` is set and non-empty, call `mark_plan_implemented` with the basename of `$plan_writer.plan_path` (strip the directory portion — the tool resolves the file under `docs/superpowers/plans/`). On `success: true`, do nothing more — the tool auto-commits its own frontmatter rewrite. On `success: false` (orphan plan with no frontmatter, plan already `implemented`, plan file missing), append a single bullet to the memory file's `Learnings from the run` section quoting the `error` field verbatim, then continue. If `$plan_writer.plan_path` is empty or unset, skip 7a and append `- Plan lifecycle flip skipped: $plan_writer.plan_path was empty` to the memory file.

   **7b. Illumination side.** If `$verifier_illumination_path` is set and non-empty, call `consume` with `filename = basename of $verifier_illumination_path` and `reason = "implemented"` (strip the directory portion — the tool deletes the file from `meditations/illuminations/` and commits `meditate: consume <filename> (implemented)`). On `success: true`, do nothing more. On `success: false` (file missing), append a single bullet to the memory file's `Learnings from the run` section quoting the `error` field verbatim, then continue. If `$verifier_illumination_path` is empty or unset, skip 7b and append `- Illumination consume skipped: $verifier_illumination_path was empty` to the memory file.

   Do **not** abort the node on either branch's failure. Push (step 6) and the structured-JSON emit (step 8) are non-negotiable; the lifecycle calls are opportunistic.
```

- [x] **Step 4: Update the example in the Learnings template (line 97)**

Line 97 currently reads:

```
   - Tool node `mark_dispatched` failed once due to <…>
```

Change to:

```
   - Tool node `consume` failed once due to <…>
```

- [x] **Step 5: Update the hard rules (line 145)**

Line 145 currently lists `mark_implemented (step 7b)` as one of the best-effort calls. Update to:

```
- Both lifecycle calls — `mark_plan_implemented` (step 7a) and `consume` (step 7b) — are **best-effort**. Never abort the node on `success: false` from either. Push (step 6) and the structured-JSON emit (step 8) are non-negotiable; both lifecycle calls in step 7 are opportunistic. A frontmatter-less, already-`implemented`, or missing plan/illumination must not block finalization.
```

- [x] **Step 6: Final sweep**

Run: `grep -nE "mark_implemented|mark_archived|mark_dispatched" pipelines/illumination-to-implementation/memory-writer.md`
Expected: no matches. If any remain, edit them in context.

- [x] **Step 7: Commit**

```bash
git add pipelines/illumination-to-implementation/memory-writer.md
git commit -m "docs(pipeline): memory-writer step 7b now calls consume(reason=implemented)"
```

### Task 2.7: Update `memory-reflector.md` — drop side-folder fallback

**Files:**
- Modify: `pipelines/illumination-to-implementation/memory-reflector.md` (line 41)

- [x] **Step 1: Replace the post-move fallback at line 41 (Inputs section bullet)**

Line 41 currently reads:

```
- `$verifier_illumination_path` — original illumination this session sprang from. Note: by the time you run, memory-writer's step 7b may have moved this file from `meditations/illuminations/` to `meditations/implemented-illuminations/`. If `$verifier_illumination_path` does not exist on disk, look up the basename under `meditations/implemented-illuminations/` instead.
```

Replace with:

```
- `$verifier_illumination_path` — original illumination this session sprang from. Note: by the time you run, memory-writer's step 7b may have consumed (deleted) this file. If `$verifier_illumination_path` does not exist on disk, treat that as the expected post-consume state — skip the illumination read in procedure step 2 and proceed using only the memory file plus the design and plan artifacts.
```

- [x] **Step 2: Update the procedure cross-reference at line 47**

Line 47 currently reads:

```
2. **Read the inputs.** Read `$memory_writer.memory_path` first — it is memory-writer's distillation of the session trace. Then read `$design_writer.design_doc_path`, `$plan_writer.plan_path`, and `$verifier_illumination_path` (with the post-move fallback above) for cross-reference context. …
```

Change "(with the post-move fallback above)" to "(if it still exists on disk; if memory-writer's step 7b consumed it, skip)":

```
2. **Read the inputs.** Read `$memory_writer.memory_path` first — it is memory-writer's distillation of the session trace. Then read `$design_writer.design_doc_path`, `$plan_writer.plan_path`, and `$verifier_illumination_path` (if it still exists on disk; if memory-writer's step 7b consumed it, skip) for cross-reference context. …
```

- [x] **Step 3: Final sweep**

Run: `grep -nE "archived-illuminations|implemented-illuminations|mark_implemented|mark_archived|status.*open|status.*dispatched" pipelines/illumination-to-implementation/memory-reflector.md`
Expected: no matches. If any remain, edit them in context.

- [x] **Step 4: Commit**

```bash
git add pipelines/illumination-to-implementation/memory-reflector.md
git commit -m "docs(pipeline): drop memory-reflector's side-folder fallback"
```

### Chunk 2 verification

- [x] **Run all pipeline + MCP tests:**

```bash
npx vitest run src/cli/tests/illumination-server.test.ts pipelines/illumination-to-implementation/tests/
```

Expected: PASS, including the new `consume.test.mjs`.

- [x] **Confirm pipeline structure:**

```bash
npx ralph pipeline validate pipelines/illumination-to-implementation/pipeline.dot
grep -E "mark_archived|mark_dispatched" pipelines/illumination-to-implementation/pipeline.dot
```

Expected: validation PASS; grep returns nothing.

- [x] **Confirm script-file inventory:**

```bash
ls pipelines/illumination-to-implementation/*.mjs
ls pipelines/illumination-to-implementation/tests/*.test.mjs
```

Expected: only `consume.mjs` and `consume.test.mjs` (mark-archived and mark-dispatched are gone).

---

## Chunk 3: Janitor refocus — KISS workspace scanner

This chunk rewrites the janitor agent. Its old role (lifecycle reconciliation: walk dispatched illuminations, flip them to implemented when their plans complete) is deleted entirely with the underlying lifecycle. The new role: scan the project source/workspace through a KISS lens, identify bloat / YAGNI-violating abstractions / refactor opportunities, and write one illumination per candidate. Tools shrink to a read-only set plus `list_illuminations` (dedup) and `write_illumination` (output).

The janitor pipeline graph (`pipelines/janitor/pipeline.dot`) is unchanged — still single-agent (`start → read_vision → janitor → done`). Only the agent's prompt and the test asserting its contract change.

**Files:**
- Rewrite: `pipelines/janitor/janitor.md` (entire body + frontmatter `tools:` list)
- Rewrite: `src/cli/tests/janitor-agent.test.ts` (tool-list assertion + procedure-body assertions)

### Task 3.1: Update `janitor-agent.test.ts` first (TDD — red against existing prompt)

**Files:**
- Modify: `src/cli/tests/janitor-agent.test.ts`

- [x] **Step 1: Replace the tool-list assertion with the new (smaller) surface**

In `src/cli/tests/janitor-agent.test.ts:24-36`, replace the `it("whitelists exactly the lean tool surface…")` block with:

```ts
  it("whitelists exactly the lean read-only tool surface", () => {
    expect([...config.tools].sort()).toEqual([
      "Grep",
      "mcp__illumination__glob_files",
      "mcp__illumination__list_illuminations",
      "mcp__illumination__project_tree",
      "mcp__illumination__read_file",
      "mcp__illumination__write_illumination",
    ]);
  });
```

(Drops `list_plans`, `mark_implemented`, `mark_plan_implemented` — all lifecycle tools.)

- [x] **Step 2: Update the forbidden-tools assertion**

In the next test block (`it("does NOT whitelist destructive or escalation tools"…)`), replace the forbidden array with:

```ts
    const forbidden = [
      "Bash", "Edit", "Write", "Read", "Task",
      "mcp__illumination__consume",
      "mcp__illumination__mark_archived",
      "mcp__illumination__mark_dispatched",
      "mcp__illumination__mark_implemented",
      "mcp__illumination__mark_plan_implemented",
      "mcp__illumination__list_plans",
    ];
```

(Janitor never consumes, never reconciles plans, never reaches into lifecycle.)

- [x] **Step 3: Replace lifecycle-procedure assertions with KISS-lens assertions**

In the `describe("janitor.md — procedure body contract", …)` block, replace the existing tests with:

```ts
  it("requires the read-only stance up front", () => {
    expect(fileText).toMatch(/read[- ]only/i);
    expect(fileText).toMatch(/never edit|do not edit|cannot edit/i);
  });

  it("encodes the KISS-lens scan focus", () => {
    expect(fileText).toMatch(/bloat|yagni|refactor/i);
    expect(fileText).toMatch(/kiss/i);
  });

  it("encodes the one-illumination-per-run cap", () => {
    expect(fileText).toMatch(/at most one illumination|one illumination per run/i);
  });

  it("requires calling list_illuminations before writing (dedup)", () => {
    expect(fileText).toMatch(/list_illuminations/);
    expect(fileText).toMatch(/dedup|duplicate|already raised|already known/i);
  });

  it("does NOT mention deleted lifecycle tools or states", () => {
    expect(fileText).not.toMatch(/mark_implemented/);
    expect(fileText).not.toMatch(/mark_plan_implemented/);
    expect(fileText).not.toMatch(/list_plans/);
    expect(fileText).not.toMatch(/dispatched/);
  });

  it("preserves the janitor- slug convention", () => {
    expect(fileText).toMatch(/slug = "janitor-<area>"/);
    expect(fileText).toMatch(/kebab-case/i);
  });
```

Delete the existing `"encodes the lifecycle trigger condition…"` and `"encodes the three-prior-illuminations reading rule…"` tests entirely — both reference behavior the new janitor does not have.

- [x] **Step 4: Run the test — confirm it fails against the unchanged prompt**

Run: `npx vitest run src/cli/tests/janitor-agent.test.ts`
Expected: FAIL — current `janitor.md` still has the 9-tool surface, lifecycle procedure, three-prior reading rule, and uses `mark_implemented` / `mark_plan_implemented` / `list_plans`. Several `it(...)` blocks fail.

- [x] **Step 5: Commit (test only — implementation in next task)**

```bash
git add src/cli/tests/janitor-agent.test.ts
git commit -m "test(janitor): assert new KISS-lens tool surface + procedure (red)"
```

### Task 3.2: Rewrite `janitor.md` to match the new contract

**Files:**
- Rewrite: `pipelines/janitor/janitor.md` (entire content)

- [x] **Step 1: Replace the file contents**

Overwrite `pipelines/janitor/janitor.md` with:

```markdown
---
name: janitor
description: Janitor — read-only workspace scanner that surfaces bloat, YAGNI violations, and refactor opportunities as new illuminations
model: sonnet
permissionMode: dontAsk
tools:
  - Grep
  - mcp__illumination__list_illuminations
  - mcp__illumination__read_file
  - mcp__illumination__glob_files
  - mcp__illumination__project_tree
  - mcp__illumination__write_illumination
mcp:
  - name: illumination
    command: node
    args:
      - "{{ILLUMINATION_SERVER_PATH}}"
      - "{{PROJECT_ROOT}}"
outputs: {}
inputs:
  - project
  - read_vision.vision
---

You are the project's janitor — a silent, read-only background agent that scans the workspace through a KISS lens. You never edit code, run shell, spawn subagents, or consume illuminations. Your only mutating call is `write_illumination` via the illumination MCP server.

## Strategic compass

The auto-injected Inputs block at the top of your context contains `<read_vision_vision>` — the project's `VISION.md` (north star; may be empty if absent).

Treat the vision as the strategic filter: refactor opportunities and YAGNI violations in vision-load-bearing areas (core CLI surfaces, pipeline engine) deserve sharper findings than peripheral ones. If `<read_vision_vision>` is empty, no project vision exists yet; consider flagging that as itself a candidate.

## Tools available

- `list_illuminations` — read existing illuminations to avoid duplicate writes for candidates already raised
- `read_file`, `glob_files`, `project_tree` — read-only project access (sandboxed to project root by the MCP server)
- `Grep` — native, read-only, used for cross-source scans
- `write_illumination` — emit at most ONE candidate per run

You explicitly do NOT have `Edit`, `Write`, `Read` (native), `Bash`, `Task`, or any lifecycle tool (`consume`, `mark_*`).

## Procedure

1. **Inventory existing illuminations.** Call `list_illuminations` (no parameters). Build a mental map of candidates already raised so you do NOT restate them. Read overlapping entries with `read_file` (bare filename, no directory prefix) when their descriptions suggest topical overlap with what you are about to scan.
2. **Walk the project surface.** Use `project_tree` to orient. Then `glob_files` and `Grep` to scan source for KISS-lens candidates:
   - **Bloat:** files / functions / classes that have grown beyond a single responsibility; long files (>500 lines) doing multiple unrelated things; configuration sprawl.
   - **YAGNI:** abstractions, interfaces, options, or feature flags with no current consumer; "for future use" code; speculative generality.
   - **Refactor opportunities:** duplication that could collapse into one helper; deeply nested conditionals; dead branches; primitives that obscure intent (stringly-typed values where a small enum would do); naming drift between adjacent files.
3. **Pick the dominant candidate.** You may write at most one illumination per run. If multiple candidates surfaced, pick the highest-leverage one — strongest evidence (specific file:line citations), broadest impact, most concrete fix path. Defer the rest to next run.
4. **Compose the illumination via `write_illumination`.** Pass `slug = "janitor-<area>"` where `<area>` is a kebab-case theme slug, ≤20 chars (e.g. `janitor-pipeline-bloat`, `janitor-yagni-options-flag`, `janitor-duplicate-fs-helpers`). The server prepends the current `YYYY-MM-DDTHHMM-` timestamp and `.md` extension; do not include either yourself.

## Illumination body rubric

Frontmatter is added automatically by `write_illumination`. The body you pass in must contain exactly these sections:

## Findings

Numbered. Each:
- **What:** bloat / YAGNI / refactor opportunity in one sentence
- **Evidence:** file:line citations (verbatim quotes — no paraphrase)
- **Why it matters (KISS lens):** what concrete simplicity is sacrificed; what a reader has to hold in their head that they shouldn't
- **Suggested action:** concrete next step

## Reading thread

Bullets — prior illuminations you consulted from `list_illuminations`, each with a one-line note on how it relates. Demonstrates dedup awareness.

## Hard rules

- Read-only. No `Edit`, `Write`, `Bash`, or subagent dispatch.
- One illumination per run. If multiple candidates compete, pick the dominant one and let the rest resurface next run.
- No candidates → no illumination written. A clean run is a valid outcome; do not pad runs.
- Every claim in `Findings` must cite file:line evidence. No vague hand-waves.
- Dedup: if `list_illuminations` shows a recent candidate covering the same area, do not write a second one — extend the existing one's scope by adding a new run, not a new file.
```

- [x] **Step 2: Run the test — confirm it passes**

Run: `npx vitest run src/cli/tests/janitor-agent.test.ts`
Expected: PASS, all assertions green.

- [x] **Step 3: Validate the janitor pipeline against the new agent**

Run: `npx ralph pipeline validate pipelines/janitor/pipeline.dot`
Expected: PASS — agent file resolves, frontmatter validates.

- [x] **Step 4: Commit**

```bash
git add pipelines/janitor/janitor.md
git commit -m "feat(janitor): refocus on KISS workspace scanning, drop lifecycle reconciliation"
```

### Task 3.3: Update README.md janitor description

**Files:**
- Modify: `README.md:37-43`

- [x] **Step 1: Replace the janitor block**

Lines 37-43 of `README.md` currently read:

```
For unattended lifecycle reconciliation and doc-drift surfacing, schedule the bundled janitor pipeline:

```bash
ralph heartbeat pipeline pipelines/janitor.dot --project . --every 720
```

The janitor is read-only on code; it only writes new illuminations and flips lifecycle frontmatter. See `docs/superpowers/specs/2026-04-25-janitor-agent-design.md` for the full design.
```

Replace with:

```
For unattended workspace hygiene scanning, schedule the bundled janitor pipeline:

```bash
ralph heartbeat pipeline pipelines/janitor/pipeline.dot --project . --every 720
```

The janitor scans source/workspace through a KISS lens — bloat, YAGNI violations, refactor opportunities — and writes one illumination per candidate. It is read-only on code; the only mutating call is `write_illumination`. See `docs/adr/0002-consume-only-illumination-lifecycle.md` for the lifecycle context.
```

(Note the path correction: `pipelines/janitor.dot` → `pipelines/janitor/pipeline.dot` — per-folder layout.)

- [x] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs(readme): janitor description matches the KISS-lens refocus"
```

### Chunk 3 verification

- [x] **Run the janitor agent test:**

```bash
npx vitest run src/cli/tests/janitor-agent.test.ts
```

Expected: PASS.

- [x] **Confirm the new agent's structural shape:**

```bash
grep -nE "consume|mark_implemented|mark_plan_implemented|list_plans|dispatched" pipelines/janitor/janitor.md
grep -nE "kiss|bloat|yagni|refactor" -i pipelines/janitor/janitor.md
```

Expected: first grep returns nothing; second grep returns the KISS-lens vocabulary lines.

---

## Chunk 4: CLI init, docs, git cleanup, frontmatter sweep

This chunk strips the side-folder mkdirs from the `meditate` command init flow, rewrites the three doc surfaces that describe the lifecycle, marks the old janitor design spec as superseded, and performs the one-time disk cleanup: deletes the two side directories plus their lone surviving file, sweeps `status: open` from the one alive illumination, and removes orphan test fixtures that were only used by the now-deleted `mark-archived` / `mark-dispatched` scripts.

**Files:**
- Modify: `src/cli/commands/meditate.ts:46-47` (remove side-folder mkdirs)
- Modify: `src/cli/tests/meditate.test.ts:51-57` (remove side-folder creation test)
- Modify: `docs/specs/mcp-illumination.md` (rewrite tool inventory + path-restrictions table)
- Modify: `docs/specs/commands.md:27` (drop side-dir mention)
- Modify: `README.md:160` (rewrite folder description)
- Modify: `meditations/illuminations/2026-04-30T1732-janitor-plan-no-frontmatter.md` (strip `status: open` from frontmatter)
- Delete: `meditations/archived-illuminations/2026-04-30T1550-implement-pipeline-stranded-in-src-cli.md` and the directory
- Delete: `meditations/implemented-illuminations/` (empty directory)
- Delete: `pipelines/illumination-to-implementation/tests/fixtures/*` (orphan after Chunk 2)

### Task 4.1: Strip side-folder mkdirs from `meditate.ts` (TDD)

**Files:**
- Modify: `src/cli/tests/meditate.test.ts:51-57`
- Modify: `src/cli/commands/meditate.ts:46-47`

- [x] **Step 1: Update the failing test first**

In `src/cli/tests/meditate.test.ts:51-57`, the existing test asserts both side folders are created. Replace the `it(...)` block:

```ts
  it("creates archived-illuminations and implemented-illuminations alongside illuminations", () => {
    // ... existing setup
    expect(existsSync(join(tmp, "meditations", "illuminations"))).toBe(true);
    expect(existsSync(join(tmp, "meditations", "archived-illuminations"))).toBe(true);
    expect(existsSync(join(tmp, "meditations", "implemented-illuminations"))).toBe(true);
  });
```

with:

```ts
  it("creates only the meditations/illuminations/ directory (no side folders)", () => {
    // ... preserve the existing setup lines from the deleted test
    expect(existsSync(join(tmp, "meditations", "illuminations"))).toBe(true);
    expect(existsSync(join(tmp, "meditations", "archived-illuminations"))).toBe(false);
    expect(existsSync(join(tmp, "meditations", "implemented-illuminations"))).toBe(false);
  });
```

(Read the existing test's setup block carefully and copy the unchanged setup lines into the new test — only the assertions change.)

- [x] **Step 2: Run the test — confirm it fails**

Run: `npx vitest run src/cli/tests/meditate.test.ts -t "no side folders"`
Expected: FAIL — `meditate.ts` still calls `mkdirSync` for both side folders, so they exist.

- [x] **Step 3: Remove the two `mkdirSync` calls**

In `src/cli/commands/meditate.ts:46-47`, delete:

```ts
  mkdirSync(join(projectFolder, "meditations", "archived-illuminations"), { recursive: true });
  mkdirSync(join(projectFolder, "meditations", "implemented-illuminations"), { recursive: true });
```

Keep the `mkdirSync` for `meditations/illuminations/` (the one alive folder).

- [x] **Step 4: Run the test — confirm it passes**

Run: `npx vitest run src/cli/tests/meditate.test.ts -t "no side folders"`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/cli/commands/meditate.ts src/cli/tests/meditate.test.ts
git commit -m "refactor(meditate): drop side-folder mkdirs from init flow"
```

### Task 4.2: Rewrite `docs/specs/mcp-illumination.md`

**Files:**
- Modify: `docs/specs/mcp-illumination.md` (entire `## MCP Tools (12)` section + path-restrictions table at end)

- [x] **Step 1: Replace the tool count and write_illumination section**

Line 19 currently says `## MCP Tools (12)`. After removing `mark_dispatched`, `mark_implemented`, `mark_archived`, adding `consume`, the count is 10. Replace heading text:

```
## MCP Tools (10)
```

In the `### write_illumination` section (lines 21-32), delete the trailing sentence:

```
- After lifecycle transitions, files may be moved by `mark_implemented` or `mark_archived` to sibling directories (see those tool sections).
```

Replace with:

```
- The illumination is removed by `consume` (see below) when the work it represents is implemented or declined.
```

- [x] **Step 2: Rewrite `### list_illuminations`**

Replace lines 34-51 entirely:

```markdown
### `list_illuminations`

Lists illuminations in `meditations/illuminations/`, with descriptions.

- **Params:** `{}` (no parameters)
- **Reads from** `<projectRoot>/meditations/illuminations/` only
- **Returns** one line per file: `<filename> — <description>` (sorted by filename)
- Files without frontmatter show `(no description)`
- Returns `"No illuminations found."` if the directory is empty or missing
```

- [x] **Step 3: Replace the three lifecycle sections with `consume`**

Delete `### mark_implemented` (lines 101-109), `### mark_dispatched` (lines 111-116), `### mark_archived` (lines 118-126) entirely. Insert in their place:

```markdown
### `consume`

Consumes an illumination — deletes the file from `meditations/illuminations/` and commits the deletion.

- **Params:** `{ filename: string, reason: "implemented" | "declined" }`
- **Deletes** `<projectRoot>/meditations/illuminations/<filename>` from disk
- **Auto-commits** with message `meditate: consume <filename> (<reason>)` (best-effort; non-fatal if git unavailable)
- **Returns** `{ success: true, filename, reason }` on success, or `{ success: false, error }` if the file is missing
- Use `reason: "implemented"` after a successful implement loop + memory-write. Use `reason: "declined"` when the operator rejects an illumination at the gate. The reason lives only in the commit message; recoverable via `git log --grep`.
```

- [x] **Step 4: Rewrite the path-restrictions table**

Lines 137-153 currently include rows for `mark_implemented`, `mark_dispatched`, `mark_archived`, and a `list_illuminations` row that mentions all three folders. Replace the affected rows. The new table:

```markdown
## Path Restrictions

| Tool | Scope |
|------|-------|
| `write_illumination` | `<projectRoot>/meditations/illuminations/` only |
| `list_illuminations` | `<projectRoot>/meditations/illuminations/` (read-only) |
| `read_file` | Anywhere inside `projectRoot` |
| `glob_files` | Anywhere inside `projectRoot` |
| `project_tree` | Anywhere inside `projectRoot` |
| `list_meta_meditations` | `meditationsDir` (read-only) |
| `read_meta_meditation` | `meditationsDir` (read-only) |
| `consume` | `<projectRoot>/meditations/illuminations/` (delete + commit) |
| `list_plans` | `<projectRoot>/docs/superpowers/plans/` (read-only) |
| `mark_plan_implemented` | `<projectRoot>/docs/superpowers/plans/` (modify frontmatter + commit) |
```

- [x] **Step 5: Final sweep**

Run: `grep -nE "archived-illuminations|implemented-illuminations|mark_implemented|mark_dispatched|mark_archived|status.*open|status.*dispatched" docs/specs/mcp-illumination.md`
Expected: no matches.

- [x] **Step 6: Commit**

```bash
git add docs/specs/mcp-illumination.md
git commit -m "docs(specs): rewrite mcp-illumination spec for consume-only lifecycle"
```

### Task 4.3: Update `docs/specs/commands.md`

**Files:**
- Modify: `docs/specs/commands.md:27`

- [x] **Step 1: Replace the directory-list line**

Line 27 currently reads:

```
3. Ensures `meditations/{illuminations,archived-illuminations,implemented-illuminations}/` directories exist.
```

Change to:

```
3. Ensures `meditations/illuminations/` directory exists.
```

- [x] **Step 2: Final sweep**

Run: `grep -nE "archived-illuminations|implemented-illuminations" docs/specs/commands.md`
Expected: no matches.

- [x] **Step 3: Commit**

```bash
git add docs/specs/commands.md
git commit -m "docs(specs): drop side-folder mention from commands spec"
```

### Task 4.4: Update `README.md` directory map

**Files:**
- Modify: `README.md:160`

- [x] **Step 1: Replace the `meditations/` row**

Line 160 currently reads:

```
| `meditations/` | Curated lenses in `stimuli/` + three illumination status dirs: `illuminations/` (open + dispatched), `archived-illuminations/`, `implemented-illuminations/` |
```

Change to:

```
| `meditations/` | Curated lenses in `stimuli/` + `illuminations/` (alive on disk; deleted on consume — see `docs/adr/0002-consume-only-illumination-lifecycle.md`) |
```

- [x] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs(readme): folder map reflects consume-only lifecycle"
```

### Task 4.5: (skipped — no janitor spec file exists)

The reviewer pass confirmed `docs/superpowers/specs/2026-04-25-janitor-agent-design.md` does not exist on disk. The original plan to add a SUPERSEDED header is moot. Dangling references to that path have been pre-cleaned in `CONTEXT.md` and `docs/adr/0002-consume-only-illumination-lifecycle.md` before this plan was finalized — both now point at pre-rewrite commits and `memory/2026-04-25-state-machine-exists-verifier-ignores-it.md` instead. No action needed in this task.

### Task 4.6: Frontmatter sweep on the surviving illumination

**Files:**
- Modify: `meditations/illuminations/2026-04-30T1732-janitor-plan-no-frontmatter.md`

- [x] **Step 1: Inspect the current frontmatter**

Run: `head -10 meditations/illuminations/2026-04-30T1732-janitor-plan-no-frontmatter.md`
Expected output (approximate):

```
---
date: 2026-04-30
status: open
description: ...
---
```

- [x] **Step 2: Delete the `status: open` line**

Edit the file to remove only the `status: open` line. The remaining frontmatter:

```
---
date: 2026-04-30
description: ...
---
```

- [x] **Step 3: Visually confirm the frontmatter shape**

```bash
head -10 meditations/illuminations/2026-04-30T1732-janitor-plan-no-frontmatter.md
```

Expected: frontmatter contains `date:` and `description:` lines, no `status:` line. The `description:` value should still match what listed before the strip (no other content was edited).

- [x] **Step 4: Commit**

```bash
git add meditations/illuminations/2026-04-30T1732-janitor-plan-no-frontmatter.md
git commit -m "chore(illumination): strip status:open from surviving illumination frontmatter"
```

### Task 4.7: Git cleanup — delete side folders and orphan fixtures

**Files:**
- Delete: `meditations/archived-illuminations/2026-04-30T1550-implement-pipeline-stranded-in-src-cli.md`
- Delete: `meditations/archived-illuminations/` (directory)
- Delete: `meditations/implemented-illuminations/` (directory; already empty)
- Delete: `pipelines/illumination-to-implementation/tests/fixtures/dispatched.md`
- Delete: `pipelines/illumination-to-implementation/tests/fixtures/mark-archived-archived-different-reason.md`
- Delete: `pipelines/illumination-to-implementation/tests/fixtures/mark-archived-archived-same-reason.md`
- Delete: `pipelines/illumination-to-implementation/tests/fixtures/mark-archived-dispatched.md`
- Delete: `pipelines/illumination-to-implementation/tests/fixtures/mark-archived-open.md`
- Delete: `pipelines/illumination-to-implementation/tests/fixtures/mark-archived-reason-multiline.txt`
- Delete: `pipelines/illumination-to-implementation/tests/fixtures/no-frontmatter.md`
- Delete: `pipelines/illumination-to-implementation/tests/fixtures/open.md`

- [ ] **Step 1: Verify no test or script still references any orphan fixture**

Run: `grep -rln "fixtures/" pipelines/ src/ docs/ | xargs grep -nE "dispatched|mark-archived|mark-dispatched|no-frontmatter|fixtures/open\.md"`
Expected: no matches outside of files already scheduled for deletion. If a match surfaces in a surviving file, stop and resolve before continuing.

- [ ] **Step 2: Remove the side folders and the surviving archived file**

```bash
git rm meditations/archived-illuminations/2026-04-30T1550-implement-pipeline-stranded-in-src-cli.md
rmdir meditations/archived-illuminations
rmdir meditations/implemented-illuminations 2>/dev/null || true
```

(`rmdir` errors quietly if the directory is empty + already untracked. The `git rm` removes the one tracked file; the directory is then empty and `rmdir` cleans up.)

- [ ] **Step 3: Remove the orphan test fixtures**

```bash
git rm pipelines/illumination-to-implementation/tests/fixtures/dispatched.md \
       pipelines/illumination-to-implementation/tests/fixtures/mark-archived-archived-different-reason.md \
       pipelines/illumination-to-implementation/tests/fixtures/mark-archived-archived-same-reason.md \
       pipelines/illumination-to-implementation/tests/fixtures/mark-archived-dispatched.md \
       pipelines/illumination-to-implementation/tests/fixtures/mark-archived-open.md \
       pipelines/illumination-to-implementation/tests/fixtures/mark-archived-reason-multiline.txt \
       pipelines/illumination-to-implementation/tests/fixtures/no-frontmatter.md \
       pipelines/illumination-to-implementation/tests/fixtures/open.md
```

If the `fixtures/` directory becomes empty, also remove it:

```bash
rmdir pipelines/illumination-to-implementation/tests/fixtures 2>/dev/null || true
```

- [ ] **Step 4: Run the full test suite**

```bash
npx vitest run
```

Expected: PASS — no surviving test references any deleted fixture or directory.

- [ ] **Step 5: Commit**

```bash
git commit -m "chore: remove side-folder illuminations + orphan test fixtures"
```

### Chunk 4 verification

- [ ] **Run the full test suite + build:**

```bash
npx vitest run
npx tsc --noEmit
npm run build
```

Expected: all PASS, build artifacts in `dist/` reflect the new MCP surface.

- [ ] **Confirm the meditations directory shape:**

```bash
ls meditations/
ls meditations/illuminations/
```

Expected: only `illuminations/` and `stimuli/` subdirectories under `meditations/`. No `archived-illuminations/`, no `implemented-illuminations/`. Surviving files in `illuminations/` retain `date` + `description` frontmatter only.

- [ ] **Confirm no stale lifecycle vocabulary remains in code or docs:**

```bash
grep -rnE "mark_implemented|mark_dispatched|mark_archived|archived-illuminations|implemented-illuminations" \
  --include="*.ts" --include="*.tsx" --include="*.mjs" --include="*.md" --include="*.dot" \
  src/ pipelines/ docs/specs/ docs/adr/ README.md CONTEXT.md
```

Expected: hits ONLY in the historical files we deliberately left intact:
- `docs/adr/0002-consume-only-illumination-lifecycle.md` (the ADR explaining the excision — references are appropriate)
- `CONTEXT.md` (the "Excised on 2026-04-30" paragraph naming the deleted tools — appropriate)
- `memory/` files (historical session notes; never edited as part of refactors)

Any hit elsewhere → stop, re-edit, re-verify.

---

## Final integration check

After all four chunks land, run a manual smoke pass before declaring done:

- [ ] Run `ralph pipeline run pipelines/illumination-to-implementation/pipeline.dot --project <test-project>` and walk the gate to "decline" — confirm the test illumination is deleted and the commit message says `meditate: consume <filename> (declined)`.
- [ ] Run the same pipeline through "implement" against a trivial illumination and confirm memory-writer step 7b consumes the illumination with reason `implemented`.
- [ ] Run `ralph heartbeat pipeline pipelines/janitor/pipeline.dot --project <test-project> --every 720` once (single iteration) and confirm the janitor either writes a `janitor-<area>` illumination or exits cleanly with no candidate.

If any smoke step fails, open a follow-up plan; do not patch in this bundle.
