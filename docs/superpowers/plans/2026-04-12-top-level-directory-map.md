---
status: pending
---

# Top-Level Directory Map Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clean up `tsx-501/`, add a compact directory map table to `README.md`, and clarify the `specs/` vs `docs/superpowers/specs/` distinction.

**Architecture:** This is a documentation-only change with a cleanup side-effect. No runtime code is modified. Three files are touched: `tsx-501/` (deleted), `.gitignore` (add exclusion pattern), and `README.md` (add `## Directory Map` section).

**Tech Stack:** Markdown, git

---

## Chunk 1: Investigate and clean up `tsx-501/`

### Task 1: Investigate `tsx-501/` contents

- [ ] **Step 1: Inspect the directory**

List the files in `tsx-501/` and examine a sample of their contents and creation timestamps:

```bash
ls -la tsx-501/ | head -20
file tsx-501/* | head -10
head -5 tsx-501/* | head -40
```

Determine the source: these are likely `tsx` runner cache files (hash-named temporary outputs from the `tsx` TypeScript execution engine).

- [ ] **Step 2: Confirm safe to delete**

Verify that no source file imports from or references `tsx-501/`:

```bash
grep -r "tsx-501" src/ specs/ pipelines/ scenario-tests/ docs/ --include="*.ts" --include="*.md" --include="*.json"
```

Expected: no references found. The directory is a build/runner artifact.

---

### Task 2: Delete `tsx-501/` and update `.gitignore`

**Files:**
- Delete: `tsx-501/`
- Modify: `.gitignore`

- [ ] **Step 1: Delete the directory**

```bash
rm -rf tsx-501/
```

- [ ] **Step 2: Add exclusion pattern to `.gitignore`**

Open `.gitignore` and add a `tsx-*` pattern to prevent future `tsx` runner cache directories from being tracked. Add it near the existing `node_modules` or build artifact entries:

```
# tsx runner cache
tsx-*/
```

- [ ] **Step 3: Commit Chunk 1**

```bash
git add -A tsx-501/
git add .gitignore
git commit -m "chore: remove tsx-501/ artifact and gitignore tsx-* cache dirs"
```

---

## Chunk 2: Add directory map to README.md

### Task 3: Read existing README.md structure

- [ ] **Step 1: Read README.md**

Read the full `README.md` to identify the right insertion point for the `## Directory Map` section. It should go after any introductory/usage sections and before any contributing or license sections.

---

### Task 4: Add the `## Directory Map` section

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Insert the directory map table**

Add a new `## Directory Map` section to `README.md` at the appropriate location identified in Task 3. Use this exact content:

```markdown
## Directory Map

| Directory | Purpose |
|---|---|
| `src/` | All TypeScript source: `cli/`, `attractor/`, `daemon/`, `lib/`, `types/` |
| `specs/` | Behavioral specs per subsystem (current, authoritative) |
| `docs/` | Harness docs + `superpowers/specs/` (design history, not authoritative specs) |
| `pipelines/` | `.dot` pipeline definitions + JSON schemas; `smoke/` for smoke tests |
| `scenario-tests/` | Shell-based end-to-end scenario tests per command |
| `meditations/` | Curated lenses (meta-meditations) + `illuminations/` subfolder |
| `memory/` | Session memory written by Claude agents across conversations |

> **specs/ vs docs/superpowers/specs/:** `specs/` holds current behavioral specifications that are authoritative. `docs/superpowers/specs/` holds historical design documents that motivated those specs.
```

- [ ] **Step 2: Verify the table renders correctly**

Visually inspect the markdown. Confirm:
- 7 rows in the table (one per directory, `tsx-501/` intentionally omitted)
- One-line clarifying note below the table about `specs/` vs `docs/superpowers/specs/`
- No new files were created

- [ ] **Step 3: Commit Chunk 2**

```bash
git add README.md
git commit -m "docs: add directory map table to README.md"
```
