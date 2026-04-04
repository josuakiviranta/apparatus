# Design: CJS → ESM Migration + Bug Fixes

**Date:** 2026-04-05
**Status:** Approved

## Problem

`ralph heartbeat watch` crashes with `ERR_REQUIRE_ASYNC_MODULE` because tsup outputs CJS but `ink` (used by the watch TUI) is ESM-only with top-level await. Investigation also uncovered two pre-existing prod/dev detection bugs in `daemon-client.ts` and `meditate.ts`.

## Scope

Fix `ralph heartbeat watch` by migrating the entire build from CJS to ESM. Keep `ralph heartbeat logs` in mind — it uses the same async IPC stream path and will benefit from the same fix.

## Section 1: Build Configuration

Three config changes, no source logic changes.

### `tsup.config.ts`
```
format: ["cjs"]  →  format: ["esm"]
```
Output files stay `.js`. Node treats them as ESM because of `"type": "module"` in package.json.

### `package.json`
Add `"type": "module"`. The `bin` path (`./dist/cli/index.js`) and shebang stay unchanged.

### `tsconfig.json`
Change `"moduleResolution": "node"` → `"moduleResolution": "bundler"`. Keep `"module": "CommonJS"` — tsup/esbuild ignores it. `"bundler"` resolution doesn't require explicit `.js` extensions on imports, so type-checking stays green across all 16 relative imports.

## Section 2: `__dirname` Rewrites (4 files)

In ESM, `__dirname` doesn't exist. The replacement is `import.meta.url`, which is a `file://` URL string. `fileURLToPath` from Node's built-in `url` module converts it to a plain filesystem path.

**Pattern applied to every affected file:**
```typescript
import { fileURLToPath } from "url";
import { dirname } from "path"; // already imported in most files

const __dirname = dirname(fileURLToPath(import.meta.url));
```

All downstream path logic is unchanged — `basename(__dirname)` checks continue to work since the resolved directory names (`cli`, `daemon`, `lib`) are identical before and after.

**Files touched:**

| File | `__dirname` refs |
|---|---|
| `src/cli/lib/assets.ts` | 8 |
| `src/lib/daemon-client.ts` | 5 (+ bug fix) |
| `src/daemon/runner.ts` | 3 |
| `src/cli/commands/meditate.ts` | 1 (+ bug fix) |

## Section 3: Pre-existing Bug Fixes

Two bugs in prod/dev detection uncovered during investigation. Both exist in the current CJS build and are independent of the ESM migration.

### Bug 1: `src/lib/daemon-client.ts`

`daemon-client.ts` compiles to `dist/lib/`, so `basename(__dirname)` is `"lib"`. The production branch checks for `"cli"` and never fires — the daemon is always spawned via the dev `tsx` fallback in production.

```typescript
// before
if (dir === "cli") return join(__dirname, "..", "daemon", "index.js");

// after
if (dir === "lib") return join(__dirname, "..", "daemon", "index.js");
```

### Bug 2: `src/cli/commands/meditate.ts`

`isDevMode()` checks `basename(__dirname) !== "dist"`. With the current layout, `basename` is `"cli"` — always truthy in production. Meditate incorrectly runs with `tsx` instead of `node` in production.

```typescript
// before
const isDevMode = () => basename(__dirname) !== "dist";

// after
const isDevMode = () => basename(__dirname) !== "cli" && basename(__dirname) !== "dist";
```

## Section 4: Testing

No new tests required. Verification plan:

1. **Build**: `npm run build` — confirms tsup outputs valid ESM for all 3 entries.
2. **Test suite**: `npm test` — vitest is ESM-native; tests should pass unchanged.
3. **Smoke tests** (manual, in order):
   - `ralph heartbeat list` — confirms daemon IPC and basic commands work
   - `ralph heartbeat watch` — the primary fix; ink TUI should render cleanly
   - `ralph meditate <folder>` — exercises the bug fix in `meditate.ts`
   - `ralph implement <folder>` — exercises asset path resolution in `assets.ts`
4. **`npm link` check**: verify global symlink still resolves correctly after rebuild.

## Non-Changes

- Bin path, shebang, dist file extensions — all unchanged
- Daemon IPC protocol — unchanged
- All relative imports — no `.js` extensions needed (bundler resolution)
- External dependencies — all compatible (`ink` ESM-only, `commander` dual, `react` CJS importable from ESM, `vitest` ESM-native)
