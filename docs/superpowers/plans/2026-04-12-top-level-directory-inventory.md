---
status: implemented
---

# Top-Level Directory Inventory Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a standalone orientation reference document listing all top-level directories, `src/` sub-roots, and "where to put X" implementation steps, so new sessions can orient quickly.

**Architecture:** This is a documentation-only change. A single markdown file is created. No runtime code, tests, or configuration are modified.

**Tech Stack:** Markdown, git

---

## Chunk 1: Create the inventory reference document

### File Map

| Action | File | Purpose |
|--------|------|---------|
| Create | `docs/orientation/directory-inventory.md` | Flat inventory of all top-level dirs, src/ sub-roots, and placement rules |

---

### Task 1: Verify current directory structure

- [ ] **Step 1: Audit top-level directories**

List the actual top-level directories to confirm the design doc's inventory is accurate:

```bash
ls -d */ .*/ 2>/dev/null | grep -v node_modules | grep -v dist | sort
```

Confirm these eight directories exist: `src/`, `docs/`, `specs/`, `pipelines/`, `meditations/`, `scenario-tests/`, `memory/`, `.claude/`.

- [ ] **Step 2: Audit src/ sub-roots**

```bash
ls -d src/*/
```

Confirm five sub-roots: `cli/`, `attractor/`, `daemon/`, `lib/`, `types/`.

- [ ] **Step 3: Audit src/cli/ and src/attractor/ contents**

```bash
ls -d src/cli/*/
ls -d src/attractor/*/
```

Confirm `cli/` contains: `commands/`, `components/`, `lib/`, `mcp/`, `agents/`, `prompts/`, `tests/`.
Confirm `attractor/` contains: `handlers/`, `core/`, `transforms/`, `tests/`.

---

### Task 2: Create the orientation reference

**Files:**
- Create: `docs/orientation/directory-inventory.md`

- [ ] **Step 4: Create the docs/orientation/ directory**

```bash
mkdir -p docs/orientation
```

- [ ] **Step 5: Write the inventory document**

Create `docs/orientation/directory-inventory.md` with the following content. If the audit in Task 1 revealed any discrepancies with the design doc, adjust the content accordingly.

```markdown
# ralph-cli Directory Inventory

> Quick-orientation reference for new sessions (human or agent).
> Consult this before exploring the codebase.

## Top-Level Directories

| Directory | Role |
|---|---|
| `src/` | All TypeScript source. Five sub-roots: `cli/`, `attractor/`, `daemon/`, `lib/`, `types/`. |
| `docs/` | Design specs (`superpowers/specs/`), code-review records (`superpowers/reviews/`), implementation plans (`superpowers/plans/`), orientation docs (`orientation/`), and the tmux harness guide (`harness/`). |
| `specs/` | Authoritative feature specs (`architecture.md`, `commands.md`, `meditate.md`, etc.). Source of truth for what each subsystem is supposed to do. |
| `pipelines/` | `.dot` pipeline definitions, JSON output schemas (`schemas/`), and `smoke/` sub-folder for CI-level pipeline fixtures. |
| `meditations/` | Meta-meditation lenses (`.md` pattern files) and the `illuminations/` sub-folder for generated insights. |
| `scenario-tests/` | Shell-based integration tests that drive the CLI end-to-end, organized by feature. Complement vitest unit/component tests in `src/`. |
| `memory/` | Claude auto-memory files persisted across sessions. Session logs and architectural decisions. |
| `.claude/` | Local Claude Code settings (`settings.local.json`). Machine-local only, not checked in. |

## src/ Sub-Roots

| Sub-root | Contents |
|---|---|
| `cli/` | `commands/`, `components/`, `lib/`, `mcp/`, `agents/`, `prompts/`, `tests/` |
| `attractor/` | `handlers/`, `core/`, `transforms/`, `tests/` |
| `daemon/` | Background scheduler + socket server |
| `lib/` | Shared utilities used across cli, attractor, and daemon |
| `types/` | Ambient type declarations (`globals.d.ts`) |

## Where to Put Things

1. **New feature:** Check `specs/` first -- the spec likely already exists.
2. **New pipeline:** Place `.dot` files under `pipelines/smoke/` (CI fixtures) or `pipelines/` root (production workflows); add output schemas to `pipelines/schemas/`.
3. **New CLI command:** Touch `src/cli/commands/`, register in `src/cli/program.ts`, add agent prompt to `src/cli/agents/`, write tests in `src/cli/tests/`.
4. **New attractor handler:** Place implementation in `src/attractor/handlers/`, register in `registry.ts`, add tests in `src/attractor/tests/`.
5. **Debugging Ink TUI:** Consult `docs/harness/tmux-drive.md` before writing any tmux commands.

## Clarifications

- **specs/ vs docs/superpowers/specs/:** `specs/` holds current authoritative behavioral specs. `docs/superpowers/specs/` holds historical design documents that motivated those specs.
- **src/ has five sub-roots, not three:** Earlier references to "three sub-roots" (cli, attractor, daemon) are outdated. `lib/` and `types/` are first-class sub-roots.
```

- [ ] **Step 6: Verify the document renders correctly**

Visually inspect the markdown. Confirm:
- 8 rows in the top-level directory table
- 5 rows in the src/ sub-roots table
- 5 numbered implementation steps
- 2 clarification bullets
- No runtime code was modified

---

### Task 3: Commit

- [ ] **Step 7: Commit the new document**

```bash
git add docs/orientation/directory-inventory.md
git commit -m "docs: add top-level directory inventory orientation reference"
```
