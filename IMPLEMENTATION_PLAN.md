# Prod Detection via tsup Define Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Replace all `basename(__dirname)` prod/dev detection with a single `__RALPH_PROD__` constant injected by tsup at build time.

**Architecture:** Add a `define` entry to `tsup.config.ts` that injects `__RALPH_PROD__ = true` into compiled output. In dev (tsx), the constant is undefined. All three files that currently do string comparisons on `basename(__dirname)` are updated to use `typeof __RALPH_PROD__ !== "undefined"` instead. A smoke test verifies the compiled binary starts cleanly in production mode.

**Tech Stack:** TypeScript, tsup 8.x (`define` API), vitest, Node.js `spawnSync`

---

## Chunk 1: Inject the constant

### Task 1: Add TypeScript ambient declaration for `__RALPH_PROD__`

**Files:**
- Create: `src/types/globals.d.ts`

- [x] **Step 1: Create the ambient declaration file**

```typescript
// src/types/globals.d.ts
declare const __RALPH_PROD__: true | undefined;
```

- [x] **Step 2: Verify TypeScript accepts it**

Run: `npx tsc --noEmit`
Expected: no errors about `__RALPH_PROD__`

- [x] **Step 3: Commit**

```bash
git add src/types/globals.d.ts
git commit -m "chore: add ambient declaration for __RALPH_PROD__ build constant"
```

---

### Task 2: Add `define` to tsup config

**Files:**
- Modify: `tsup.config.ts`

- [x] **Step 1: Add `define` to the config**

In `tsup.config.ts`, add `define: { __RALPH_PROD__: "true" }` to the `defineConfig` object:

```typescript
export default defineConfig({
  entry: ["src/cli/index.ts", "src/cli/mcp/illumination-server.ts", "src/daemon/index.ts"],
  format: ["esm"],
  outDir: "dist",
  clean: true,
  define: { __RALPH_PROD__: "true" },
  banner: {
    js: "#!/usr/bin/env node",
  },
  // ... onSuccess unchanged
});
```

- [x] **Step 2: Build and confirm the constant appears in output**

Run: `npm run build 2>&1 | tail -5 && grep -r '__RALPH_PROD__' dist/cli/index.js | head -3`
Expected: build succeeds, grep finds `true` where `__RALPH_PROD__` was referenced (or no matches if the constant was already inlined/replaced — both are correct)

- [x] **Step 3: Commit**

```bash
git add tsup.config.ts
git commit -m "build: inject __RALPH_PROD__ constant via tsup define"
```

---

## Chunk 2: Replace basename checks

### Task 3: Replace `isProduction()` in `assets.ts`

**Files:**
- Modify: `src/cli/lib/assets.ts`

- [x] **Step 1: Replace `isProduction()` body and clean up import**

Remove `basename` from the `path` import (no longer needed). Replace the function body:

```typescript
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function isProduction(): boolean {
  return typeof __RALPH_PROD__ !== "undefined";
}
```

All other functions (`getAssetPath`, `getMetaMeditationsDir`, `getIlluminationServerPath`, etc.) are unchanged.

- [x] **Step 2: Run existing asset tests**

Run: `npx vitest run src/cli/tests/assets.test.ts`
Expected: all tests pass (they run under tsx, so `isProduction()` returns false — dev paths)

- [x] **Step 3: Commit**

```bash
git add src/cli/lib/assets.ts
git commit -m "refactor: replace basename(__dirname) in assets.ts with __RALPH_PROD__ constant"
```

---

### Task 4: Replace `getDaemonBin()` detection in `daemon-client.ts`

**Files:**
- Modify: `src/lib/daemon-client.ts`

- [x] **Step 1: Replace `getDaemonBin()` and clean up import**

Remove `basename` from the `path` import. Collapse the three branches (multi-entry prod, legacy flat prod, dev) into two (prod, dev):

```typescript
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function getDaemonBin(): { command: string; args: string[] } {
  if (typeof __RALPH_PROD__ !== "undefined") {
    // prod: dist/cli/ — daemon is at dist/daemon/index.js
    return { command: process.execPath, args: [join(__dirname, "..", "daemon", "index.js")] };
  }
  // dev mode — __dirname is somewhere in src/
  return { command: "tsx", args: [join(__dirname, "..", "daemon", "index.ts")] };
}
```

- [x] **Step 2: Run daemon-client tests**

Run: `npx vitest run src/cli/tests/`
Expected: all tests pass

- [x] **Step 3: Commit**

```bash
git add src/lib/daemon-client.ts
git commit -m "refactor: replace basename(__dirname) in daemon-client.ts with __RALPH_PROD__ constant"
```

---

### Task 5: Replace `isDevMode()` in `meditate.ts`

**Files:**
- Modify: `src/cli/commands/meditate.ts`

- [x] **Step 1: Replace `isDevMode()` body and clean up import**

Remove `basename` from the `path` import:

```typescript
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function isDevMode(): boolean {
  return typeof __RALPH_PROD__ === "undefined";
}
```

- [x] **Step 2: Run full test suite**

Run: `npx vitest run`
Expected: all tests pass

- [x] **Step 3: Commit**

```bash
git add src/cli/commands/meditate.ts
git commit -m "refactor: replace basename(__dirname) in meditate.ts with __RALPH_PROD__ constant"
```

---

## Chunk 3: Smoke test + cleanup

### Task 6: Add production smoke test

**Files:**
- Create: `src/cli/tests/smoke.test.ts`

- [x] **Step 1: Write the failing test**

```typescript
// src/cli/tests/smoke.test.ts
import { spawnSync } from "child_process";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { describe, it, expect } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distBin = join(__dirname, "../../../dist/cli/index.js");

describe("production smoke", () => {
  it("compiled binary exits 0 for --version (skips if dist not built)", () => {
    if (!existsSync(distBin)) {
      console.warn("Skipping smoke test: dist/cli/index.js not found. Run npm run build first.");
      return;
    }
    const result = spawnSync(process.execPath, [distBin, "--version"], {
      encoding: "utf8",
      timeout: 5000,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/\d+\.\d+\.\d+/);
  });
});
```

- [x] **Step 2: Run test without dist — verify it skips gracefully**

Run: `npx vitest run src/cli/tests/smoke.test.ts`
Expected: test passes (skips with warning because dist may or may not exist)

- [x] **Step 3: Build and run test against compiled output**

Run: `npm run build && npx vitest run src/cli/tests/smoke.test.ts`
Expected: test passes, output contains a version string like `0.1.0`

- [x] **Step 4: Commit**

```bash
git add src/cli/tests/smoke.test.ts
git commit -m "test: add production smoke test for compiled binary"
```

---

### Task 7: Update memory and remove correction note

**Files:**
- Modify: `memory/tsup-multi-entry-path-issues.md`
- Modify: `IMPLEMENTATION_PLAN.md` (remove correction note if the ESM migration tasks are complete)

- [x] **Step 1: Update `memory/tsup-multi-entry-path-issues.md`**

Read the file, then append a "Resolution" section documenting that the `__RALPH_PROD__` define approach supersedes the workaround described in the file:

```markdown
## Resolution (2026-04-05)

The `basename(__dirname)` pattern has been replaced with a tsup `define` constant.
`tsup.config.ts` now injects `__RALPH_PROD__: "true"` at compile time.
All prod/dev detection uses `typeof __RALPH_PROD__ !== "undefined"`.
The ambient type is declared in `src/types/globals.d.ts`.
Future topology changes to tsup entry points will not affect prod detection.
```

- [x] **Step 2: Remove the correction note from `IMPLEMENTATION_PLAN.md`**

Locate the note warning developers not to change `dir === "cli"` to `dir === "lib"` in `daemon-client.ts`. Delete that note — the `__RALPH_PROD__` constant makes the confusion impossible.

- [x] **Step 3: Run full test suite one final time**

Run: `npm run build && npx vitest run`
Expected: all tests pass

- [x] **Step 4: Commit**

```bash
git add memory/tsup-multi-entry-path-issues.md IMPLEMENTATION_PLAN.md
git commit -m "docs: document __RALPH_PROD__ resolution, remove stale correction note"
```

---

## Completion Notes (2026-04-05)

All 7 tasks completed. Tagged as **0.0.12**. 144 tests pass (142 existing + 2 new smoke tests).

### Work beyond the original plan

- **`runner.ts` updated:** Same `basename(__dirname)` pattern was present in `src/cli/lib/runner.ts` and was replaced with `typeof __RALPH_PROD__ !== "undefined"` to match the other files.
- **`tsconfig.json` fixed:** Changed `module` from `"CommonJS"` to `"ESNext"` to align with the ESM output format (`type: "module"` in `package.json`).
- **Stale `@ts-expect-error` directives removed:** `src/cli/mcp/illumination-server.ts` had `@ts-expect-error` comments that were no longer triggering errors after the ESM migration; these were cleaned up to avoid future confusion.
- **Smoke test expanded:** The smoke test file includes two tests (one for `--version`, one for `--help`) rather than the single test originally planned.
