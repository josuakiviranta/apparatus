# Project Tree Orientation Is Polluted by Static SKIP_DIRS

## Core Idea

`projectTree` in `illumination-server.ts` uses a hardcoded `SKIP_DIRS` set to filter noise. `node-compile-cache/` is not in that set, so every session on this project begins with the agent receiving hundreds of hash-named files before seeing a single source file. The first thing the meditate agent does — orient itself via `project_tree` — is immediately degraded. The root cause is not a missing entry in the list; it's that a static list cannot adapt to what any given project actually generates.

## Why It Matters

The `SKIP_DIRS` constant in `illumination-server.ts` is:

```typescript
const SKIP_DIRS = new Set([
  ".git", "node_modules", "dist", "build", "coverage",
  ".next", ".turbo", "__pycache__", ".cache",
]);
```

`node-compile-cache/` appears in this project's root and contains one subdirectory with roughly 400 hash-named files. When `project_tree` runs, the agent sees all of them before reaching `src/`. The orientation snapshot — which is meant to give the agent a fast, clean mental model of the project — instead opens with a wall of cache artifacts.

This is not unique to `node-compile-cache`. Any project with `vendor/`, `.yarn/`, `__generated__/`, `.venv/`, or custom artifact directories will hit the same problem. The static list will need indefinite patching.

The correct substrate already exists in every project: `.gitignore`. Projects that generate noise directories tell git to ignore them. If `projectTree` read and applied `.gitignore` patterns, it would automatically filter whatever the project itself considers noise — without any ralph-side maintenance. The agent's orientation step would be as clean as a `git status`.

There is a cost: parsing `.gitignore` correctly (including negation patterns, directory-only patterns, recursive globs) is non-trivial. But the `fast-glob` package is already imported in `illumination-server.ts`, and `fg.sync` with `ignore` patterns handles `.gitignore`-style exclusion natively.

## Revised Implementation Steps

1. **Immediate patch: add `"node-compile-cache"` to `SKIP_DIRS`** in `illumination-server.ts`. This unblocks the current project without architectural change. Ship it today.

2. **Design the principled fix: gitignore-aware `projectTree`.** Read `.gitignore` in the project root at walk time. Parse it with a minimal parser (or use the `ignore` npm package, which is already a transitive dep via `fast-glob`). Pass the resulting filter to the directory walker alongside `SKIP_DIRS`.

3. **Keep `SKIP_DIRS` as a baseline.** Projects without a `.gitignore` still need basic noise filtering. `SKIP_DIRS` becomes the fallback, not the primary mechanism.

4. **Add a test for `projectTree` that asserts gitignored directories are excluded.** Write a temp dir, create a `.gitignore` that ignores `vendor/`, create `vendor/` with files, call `projectTree`, assert `vendor/` does not appear. This test does not exist yet — `illumination-server.test.ts` has no `projectTree` tests at all.

5. **After the gitignore fix lands, remove entries from `SKIP_DIRS` that are universally gitignored** (`.next`, `__pycache__`, `.cache`). Keeping them is harmless, but removing them makes the mechanism's intent explicit: `SKIP_DIRS` = truly universal noise (`.git`, `node_modules`, `dist`), everything else = project-specific via `.gitignore`.
