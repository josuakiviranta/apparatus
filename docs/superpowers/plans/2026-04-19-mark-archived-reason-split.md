---
status: implemented
---

# Mark-Archived Reason-Arg Split Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single `mark_archived` agent node in `pipelines/illumination-to-implementation.dot` with two script-tool nodes (`mark_archived_invalid` and `mark_archived_decline`) backed by a new `pipelines/scripts/mark-archived.mjs`, so archived illuminations record a semantically correct `reason` (verifier invalidity rationale on the false path, literal `Declined at approval gate` on the approval-decline path) instead of the verifier's topic description `$summary`.

**Architecture:** Chunk 1 introduces the script + fixtures + vitest covering literal-reason, file-path-reason (prose carrier), newline collapse, idempotency, and error cases. The script is path-only safe for caller args via a `fs.existsSync` branch: arg2 treated as a reason-file path if it exists on disk, literal string otherwise. Chunk 2 folds the `.dot` edits into T0000's diff — two new script-tool nodes replacing one agent node, edge retargets, and one extension to the `explain_removal` prompt telling it to also write `$explanation` verbatim to `$meditations_dir/.triage/$run_id/invalid-reason.txt` so the invalid-path carrier file exists at invocation time. Chunk 2 is NOT independently landable because introducing `mark_archived_invalid` before T0000 retargets `remove_gate [Yes]` makes it unreachable and fails `ralph pipeline validate` at `src/attractor/core/graph.ts:289`.

**Tech Stack:** Node.js (plain ESM, no deps), vitest, graphviz DOT (pipeline source), ralph-cli pipeline engine (`src/attractor/handlers/tool.ts` raw `sh -c` script_args expansion).

**Design doc:** `specs/2026-04-19-mark-archived-reason-split-design.md`

**Source illumination:** `meditations/illuminations/2026-04-19T0800-mark-archived-script-will-write-the-wrong-reason.md`

**Bundling:** Chunk 2's `.dot` diff lands as part of T0000's unified commit (`meditations/illuminations/2026-04-19T0000-*.md` — the superseded-by-unified-diff spec). Chunk 1 lands independently and is a precondition.

---

## Chunk 1: `mark-archived.mjs` script, fixtures, and vitest

**Scope:** Standalone script + fixtures + tests. No changes to `.dot`. Can merge on its own because it adds files with no import dependency — nothing in the current graph references `scripts/mark-archived.mjs`.

### Task 1: Create fixture — open illumination

**Files:**
- Create: `pipelines/scripts/tests/fixtures/mark-archived-open.md`

- [ ] **Step 1: Write fixture**

Create `pipelines/scripts/tests/fixtures/mark-archived-open.md` with exact contents:

```markdown
---
date: 2026-04-19
status: open
description: Sample open illumination used as a fixture for mark-archived.mjs tests.
---

## Core Idea

Fixture content.
```

- [ ] **Step 2: Verify the file was created**

Run: `ls -la pipelines/scripts/tests/fixtures/mark-archived-open.md`

Expected: file exists, size > 0.

### Task 2: Create fixture — archived with same reason (idempotency)

**Files:**
- Create: `pipelines/scripts/tests/fixtures/mark-archived-archived-same-reason.md`

- [ ] **Step 1: Write fixture**

Create `pipelines/scripts/tests/fixtures/mark-archived-archived-same-reason.md` with exact contents:

```markdown
---
date: 2026-04-19
status: archived
archived_at: 2026-04-19
reason: Declined at approval gate
description: Sample already-archived illumination used to verify idempotent re-archival.
---

## Core Idea

Fixture content.
```

- [ ] **Step 2: Verify**

Run: `ls -la pipelines/scripts/tests/fixtures/mark-archived-archived-same-reason.md`

Expected: file exists.

### Task 3: Create fixture — archived with different reason (conflict)

**Files:**
- Create: `pipelines/scripts/tests/fixtures/mark-archived-archived-different-reason.md`

- [ ] **Step 1: Write fixture**

Create `pipelines/scripts/tests/fixtures/mark-archived-archived-different-reason.md` with exact contents:

```markdown
---
date: 2026-04-19
status: archived
archived_at: 2026-04-19
reason: Some prior reason that will mismatch the test-supplied reason.
description: Sample already-archived illumination used to verify conflicting-reason error path.
---

## Core Idea

Fixture content.
```

- [ ] **Step 2: Verify**

Run: `ls -la pipelines/scripts/tests/fixtures/mark-archived-archived-different-reason.md`

Expected: file exists.

### Task 4: Create fixture — dispatched (non-archivable status)

**Files:**
- Create: `pipelines/scripts/tests/fixtures/mark-archived-dispatched.md`

- [ ] **Step 1: Write fixture**

Create `pipelines/scripts/tests/fixtures/mark-archived-dispatched.md` with exact contents:

```markdown
---
date: 2026-04-19
status: dispatched
dispatched_at: 2026-04-19
plan_path: docs/superpowers/plans/2026-04-19-sample.md
description: Sample dispatched illumination used to verify non-open status is rejected.
---

## Core Idea

Fixture content.
```

- [ ] **Step 2: Verify**

Run: `ls -la pipelines/scripts/tests/fixtures/mark-archived-dispatched.md`

Expected: file exists.

### Task 5: Create fixture — multi-line reason text file

**Files:**
- Create: `pipelines/scripts/tests/fixtures/mark-archived-reason-multiline.txt`

- [ ] **Step 1: Write fixture**

Create `pipelines/scripts/tests/fixtures/mark-archived-reason-multiline.txt` with exact contents:

```
pipelineFailed boolean already present;
process.exitCode   assignment already committed.

```

Note: file ends with a trailing newline. Contains one blank line between the two content lines and one run of multiple spaces inside "exitCode   assignment" to exercise the whitespace-collapse logic.

- [ ] **Step 2: Verify**

Run: `wc -l pipelines/scripts/tests/fixtures/mark-archived-reason-multiline.txt`

Expected: `3 pipelines/scripts/tests/fixtures/mark-archived-reason-multiline.txt` (three newlines — after the first content line, after the blank line, and after the second content line; the trailing newline IS the one after line 2's content). The file still exercises multi-line + multi-space collapse: one run of multiple internal spaces (`exitCode   assignment`) and one inter-line newline to be collapsed.

- [ ] **Step 3: Commit fixtures**

```bash
git add pipelines/scripts/tests/fixtures/mark-archived-open.md \
        pipelines/scripts/tests/fixtures/mark-archived-archived-same-reason.md \
        pipelines/scripts/tests/fixtures/mark-archived-archived-different-reason.md \
        pipelines/scripts/tests/fixtures/mark-archived-dispatched.md \
        pipelines/scripts/tests/fixtures/mark-archived-reason-multiline.txt
git commit -m "test(mark-archived): add fixtures for reason-split script tests"
```

### Task 6: Write failing test — literal reason flips status and writes frontmatter

**Files:**
- Create: `pipelines/scripts/tests/mark-archived.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `pipelines/scripts/tests/mark-archived.test.mjs` with exact contents:

```javascript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync, copyFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(__dirname, "..", "mark-archived.mjs");
const FIXTURES = resolve(__dirname, "fixtures");

function runScript(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: "utf8",
  });
}

describe("mark-archived.mjs", () => {
  let tmp;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "mark-archived-test-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("flips status: open → status: archived and appends archived_at + reason (literal)", () => {
    const target = join(tmp, "open.md");
    copyFileSync(join(FIXTURES, "mark-archived-open.md"), target);

    const reason = "Declined at approval gate";
    const result = runScript([target, reason]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");

    const today = new Date().toISOString().slice(0, 10);
    const after = readFileSync(target, "utf8");
    expect(after).toContain("status: archived\n");
    expect(after).not.toContain("status: open\n");
    expect(after).toContain(`archived_at: ${today}\n`);
    expect(after).toContain(`reason: ${reason}\n`);

    // Body preserved
    expect(after).toContain("## Core Idea");
    expect(after).toContain("Fixture content.");
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

Run: `npx vitest run pipelines/scripts/tests/mark-archived.test.mjs`

Expected: FAIL with `Cannot find module` / `ENOENT` referencing `mark-archived.mjs` (script does not yet exist). Test count: 1 failed.

### Task 7: Write minimal script to pass literal-reason test

**Files:**
- Create: `pipelines/scripts/mark-archived.mjs`

- [ ] **Step 1: Write the script**

Create `pipelines/scripts/mark-archived.mjs` with exact contents:

```javascript
import fs from "node:fs";

const [, , illuminationPath, reasonArg] = process.argv;
if (!illuminationPath || !reasonArg) {
  console.error("usage: mark-archived.mjs <illumination> <reason-or-reason-file>");
  process.exit(2);
}

// Arg2 is either a path to a reason file (used on the invalid path when the
// reason is multi-word prose) or a literal reason string (decline path).
// Resolve to the actual reason text here.
let reason;
if (fs.existsSync(reasonArg) && fs.statSync(reasonArg).isFile()) {
  reason = fs.readFileSync(reasonArg, "utf8");
} else {
  reason = reasonArg;
}
// Collapse newlines and consecutive whitespace so the YAML `reason:` line
// stays single-line regardless of how the caller framed the prose.
reason = reason.replace(/\s+/g, " ").trim();

const today = new Date().toISOString().slice(0, 10);
const raw = fs.readFileSync(illuminationPath, "utf8");
const parts = raw.split("---\n");
if (parts.length < 3) {
  console.error("no frontmatter");
  process.exit(1);
}

const statusMatch = parts[1].match(/status:\s*(.+)\n/);
const status = statusMatch ? statusMatch[1].trim() : "";

if (status === "archived") {
  const existingReason = parts[1].match(/reason:\s*(.+)\n/)?.[1].trim();
  if (existingReason === reason) {
    console.log(JSON.stringify({ marked_archived: illuminationPath, idempotent: true }));
    process.exit(0);
  }
  console.error(`already archived with a different reason: ${existingReason} (wanted ${reason})`);
  process.exit(1);
}

if (status !== "open") {
  console.error(`status not open: ${status}`);
  process.exit(1);
}

const frontmatter =
  parts[1].replace(/status:\s*open\n/, "status: archived\n") +
  `archived_at: ${today}\n` +
  `reason: ${reason}\n`;

fs.writeFileSync(
  illuminationPath,
  `---\n${frontmatter}---\n${parts.slice(2).join("---\n")}`,
);
console.log(JSON.stringify({ marked_archived: illuminationPath }));
```

- [ ] **Step 2: Run test — verify it passes**

Run: `npx vitest run pipelines/scripts/tests/mark-archived.test.mjs`

Expected: PASS. 1 test passed.

- [ ] **Step 3: Commit**

```bash
git add pipelines/scripts/mark-archived.mjs pipelines/scripts/tests/mark-archived.test.mjs
git commit -m "feat(mark-archived): add script with literal-reason path and initial test"
```

### Task 8: Add failing test — file-path reason carrier

**Files:**
- Modify: `pipelines/scripts/tests/mark-archived.test.mjs`

- [ ] **Step 1: Append test case inside the `describe` block, before the closing `});`**

Insert this `it(...)` block after the existing `it("flips status: open → status: archived ...")` test:

```javascript
  it("reads reason from file when arg2 is a path to an existing file (prose carrier)", () => {
    const target = join(tmp, "open.md");
    copyFileSync(join(FIXTURES, "mark-archived-open.md"), target);

    const reasonFile = join(tmp, "invalid-reason.txt");
    writeFileSync(
      reasonFile,
      "pipelineFailed boolean already present; process.exitCode assignment already committed.\n",
    );

    const result = runScript([target, reasonFile]);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");

    const after = readFileSync(target, "utf8");
    expect(after).toContain(
      "reason: pipelineFailed boolean already present; process.exitCode assignment already committed.\n",
    );
  });
```

- [ ] **Step 2: Run test — verify it passes (script already handles the branch)**

Run: `npx vitest run pipelines/scripts/tests/mark-archived.test.mjs`

Expected: PASS. 2 tests passed.

### Task 9: Add test — newline collapse

**Files:**
- Modify: `pipelines/scripts/tests/mark-archived.test.mjs`

- [ ] **Step 1: Append test case**

Insert after the previous `it(...)` block:

```javascript
  it("collapses embedded newlines and consecutive whitespace into single spaces on write", () => {
    const target = join(tmp, "open.md");
    copyFileSync(join(FIXTURES, "mark-archived-open.md"), target);

    // Load the fixture that contains multi-line + multi-space text.
    const reasonFile = join(FIXTURES, "mark-archived-reason-multiline.txt");
    const result = runScript([target, reasonFile]);
    expect(result.status).toBe(0);

    const after = readFileSync(target, "utf8");
    expect(after).toContain(
      "reason: pipelineFailed boolean already present; process.exitCode assignment already committed.\n",
    );
    // Defensively: no raw newline or double-space landed inside the reason line.
    const reasonLine = after.split("\n").find((l) => l.startsWith("reason:"));
    expect(reasonLine).toBeDefined();
    expect(reasonLine).not.toMatch(/  /);
  });
```

- [ ] **Step 2: Run test — verify it passes**

Run: `npx vitest run pipelines/scripts/tests/mark-archived.test.mjs`

Expected: PASS. 3 tests passed.

### Task 10: Add test — idempotent re-run (same reason)

**Files:**
- Modify: `pipelines/scripts/tests/mark-archived.test.mjs`

- [ ] **Step 1: Append test case**

Insert after the previous `it(...)` block:

```javascript
  it("returns idempotent: true when already archived with the same reason", () => {
    const target = join(tmp, "archived-same.md");
    copyFileSync(join(FIXTURES, "mark-archived-archived-same-reason.md"), target);

    const result = runScript([target, "Declined at approval gate"]);
    expect(result.status).toBe(0);

    const trimmed = result.stdout.trim();
    expect(trimmed.includes("\n")).toBe(false);
    const parsed = JSON.parse(trimmed);
    expect(parsed).toEqual({ marked_archived: target, idempotent: true });

    // File should not be rewritten — no duplicate archived_at / reason lines.
    const after = readFileSync(target, "utf8");
    const archivedAtCount = (after.match(/archived_at:/g) || []).length;
    const reasonCount = (after.match(/reason:/g) || []).length;
    expect(archivedAtCount).toBe(1);
    expect(reasonCount).toBe(1);
  });
```

- [ ] **Step 2: Run test — verify it passes**

Run: `npx vitest run pipelines/scripts/tests/mark-archived.test.mjs`

Expected: PASS. 4 tests passed.

### Task 11: Add test — conflicting reason fails

**Files:**
- Modify: `pipelines/scripts/tests/mark-archived.test.mjs`

- [ ] **Step 1: Append test case**

Insert after the previous `it(...)` block:

```javascript
  it("fails with exit 1 when already archived with a different reason", () => {
    const target = join(tmp, "archived-different.md");
    copyFileSync(join(FIXTURES, "mark-archived-archived-different-reason.md"), target);

    const result = runScript([target, "Declined at approval gate"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("already archived with a different reason");
  });
```

- [ ] **Step 2: Run test — verify it passes**

Run: `npx vitest run pipelines/scripts/tests/mark-archived.test.mjs`

Expected: PASS. 5 tests passed.

### Task 12: Add test — dispatched status rejected

**Files:**
- Modify: `pipelines/scripts/tests/mark-archived.test.mjs`

- [ ] **Step 1: Append test case**

Insert after the previous `it(...)` block:

```javascript
  it("fails with exit 1 and 'status not open' when status is dispatched", () => {
    const target = join(tmp, "dispatched.md");
    copyFileSync(join(FIXTURES, "mark-archived-dispatched.md"), target);

    const result = runScript([target, "Some reason"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("status not open");
  });
```

- [ ] **Step 2: Run test — verify it passes**

Run: `npx vitest run pipelines/scripts/tests/mark-archived.test.mjs`

Expected: PASS. 6 tests passed.

### Task 13: Add test — missing args exits 2

**Files:**
- Modify: `pipelines/scripts/tests/mark-archived.test.mjs`

- [ ] **Step 1: Append test case**

Insert after the previous `it(...)` block:

```javascript
  it("fails with exit 2 and usage message when args are missing", () => {
    const result = runScript([]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("usage: mark-archived.mjs");
  });
```

- [ ] **Step 2: Run test — verify it passes**

Run: `npx vitest run pipelines/scripts/tests/mark-archived.test.mjs`

Expected: PASS. 7 tests passed.

### Task 14: Add test — nonexistent file-path arg2 treated as literal

**Files:**
- Modify: `pipelines/scripts/tests/mark-archived.test.mjs`

- [ ] **Step 1: Append test case**

Insert after the previous `it(...)` block:

```javascript
  it("treats arg2 as a literal reason when it is not an existing file path", () => {
    const target = join(tmp, "open.md");
    copyFileSync(join(FIXTURES, "mark-archived-open.md"), target);

    // Path-shaped but nonexistent: script must fall back to literal.
    const literal = "/definitely/does/not/exist/invalid-reason.txt";
    const result = runScript([target, literal]);
    expect(result.status).toBe(0);

    const after = readFileSync(target, "utf8");
    expect(after).toContain(`reason: ${literal}\n`);
  });
```

- [ ] **Step 2: Run test — verify it passes**

Run: `npx vitest run pipelines/scripts/tests/mark-archived.test.mjs`

Expected: PASS. 8 tests passed.

### Task 15: Full-suite verification + commit

- [ ] **Step 1: Run full vitest suite (mark-dispatched still green)**

Run: `npx vitest run pipelines/scripts/tests/`

Expected: ALL PASS (mark-dispatched.test.mjs + mark-archived.test.mjs, ≥13 tests total, 0 failed).

- [ ] **Step 2: Run whole-project test suite**

Run: `npm test`

Expected: green. No new failures introduced. If there are preexisting unrelated failures in the project, record them but do not fix them — they are out of scope for this chunk.

- [ ] **Step 3: Commit**

```bash
git add pipelines/scripts/tests/mark-archived.test.mjs
git commit -m "test(mark-archived): cover file-path carrier, idempotency, errors, fallbacks"
```

---

## Chunk 2: `.dot` wiring (bundled with T0000)

**Scope:** Edits to `pipelines/illumination-to-implementation.dot`. MUST land in the same commit as T0000's unified refactor (the commit that retargets `remove_gate [Yes]` away from `delete_file`). Landing this chunk before that commit would leave `mark_archived_invalid` declared but unreachable, and `ralph pipeline validate` would fail at `src/attractor/core/graph.ts:289` (reachability check, severity error).

**If T0000 is not yet available to bundle with:** do not land Chunk 2. Write Chunk 1 only, and surface this status to the user.

### Task 16: Remove the old `mark_archived` agent node declaration

**Files:**
- Modify: `pipelines/illumination-to-implementation.dot:18` (delete the line)

- [ ] **Step 1: Delete the existing `mark_archived` declaration**

Remove the entire multi-line declaration currently at `pipelines/illumination-to-implementation.dot:18`:

```
  mark_archived [agent="implement", default_refinements="", prompt="Call mcp__illumination__mark_archived with filename from $illumination_path (basename only) and a reason summarizing why the illumination is being archived.\n\nContext sources (combine into one concise reason):\n- Illumination summary: $summary\n- Verifier explanation: $explanation\n- Chat refinements (if any): $refinements\n\nReturn the JSON result."]
```

After deletion, the line count shrinks by 1 (the declaration is a single logical line despite wrapping in the rendered view).

- [ ] **Step 2: Verify removal**

Run: `grep -nE '\bmark_archived\b' pipelines/illumination-to-implementation.dot`

Expected: zero hits. (If any hit remains, it is a stale edge referencing the node — remove it in the task below.)

### Task 17: Add `mark_archived_invalid` and `mark_archived_decline` script-tool nodes

**Files:**
- Modify: `pipelines/illumination-to-implementation.dot` (insert at the position where the deleted `mark_archived` node lived, between `delete_file` and `mark_dispatched`)

- [ ] **Step 1: Insert the two new node declarations**

At the former location of the deleted `mark_archived` node (line ~18, between `delete_file` and `mark_dispatched`), insert:

```
  mark_archived_invalid [type="tool",
                         cwd="$project",
                         script_file="scripts/mark-archived.mjs",
                         script_args="$illumination_path $meditations_dir/.triage/$run_id/invalid-reason.txt"]

  mark_archived_decline [type="tool",
                         cwd="$project",
                         script_file="scripts/mark-archived.mjs",
                         script_args="$illumination_path 'Declined at approval gate'"]
```

Exact quoting matters:
- `mark_archived_invalid`'s `script_args` contains only path-safe variables — `$illumination_path` is a kebab-case path, `$meditations_dir` is a fixed project-relative path, `$run_id` is a UUID. No spaces, no shell metacharacters after raw expansion.
- `mark_archived_decline`'s `script_args` wraps the reason text in **single quotes** in the `.dot` source. Single quotes survive the engine's raw `$var` expansion (it substitutes `$var` literally without re-quoting) and are honored by `sh -c`'s tokenizer, so the subprocess sees a single argv element `Declined at approval gate`.

- [ ] **Step 2: Verify declarations parse**

Run: `grep -nE 'mark_archived_(invalid|decline)' pipelines/illumination-to-implementation.dot`

Expected: 2 hits so far (one declaration line each — the edge hits come next).

### Task 18: Retarget `approval_gate [Decline]` edge to `mark_archived_decline`

**Files:**
- Modify: `pipelines/illumination-to-implementation.dot:71`

- [ ] **Step 1: Edit the edge**

Change:

```
  approval_gate -> mark_archived  [label="Decline"]
```

to:

```
  approval_gate -> mark_archived_decline  [label="Decline"]
```

- [ ] **Step 2: Verify**

Run: `grep -n 'approval_gate -> mark_archived_decline' pipelines/illumination-to-implementation.dot`

Expected: 1 hit.

Run: `grep -nE 'approval_gate -> mark_archived\s' pipelines/illumination-to-implementation.dot`

Expected: 0 hits (old edge fully gone).

### Task 19: Retarget `remove_gate [Yes]` edge to `mark_archived_invalid`

**Files:**
- Modify: `pipelines/illumination-to-implementation.dot:66`

**Note:** This edge-retarget is formally T0000's contribution. If T0000 has already applied it in the same diff, skip Step 1 below and only run Step 2's verification. If Chunk 2 is authored BEFORE T0000's unified commit is assembled, this task is the ONLY way to make `mark_archived_invalid` reachable — coordinate with the person applying T0000 so the edge lands in the same commit as this chunk's node declaration.

- [ ] **Step 1: Edit the edge (skip if T0000 already did this)**

Change:

```
  remove_gate -> delete_file  [label="Yes"]
```

to:

```
  remove_gate -> mark_archived_invalid  [label="Yes"]
```

- [ ] **Step 2: Verify**

Run: `grep -n 'remove_gate -> mark_archived_invalid' pipelines/illumination-to-implementation.dot`

Expected: 1 hit.

Run: `grep -nE 'remove_gate -> delete_file' pipelines/illumination-to-implementation.dot`

Expected: 0 hits (assuming T0000's delete_file retirement has fully occurred in this diff). If T0000's spec keeps `delete_file` as a downstream node, update the edge to go through `mark_archived_invalid -> delete_file` per T0000's graph — that sequencing is T0000's design decision, not this spec's.

### Task 20: Retarget terminator edge(s) — `-> done`

**Files:**
- Modify: `pipelines/illumination-to-implementation.dot:79`

- [ ] **Step 1: Replace the single-node terminator with two edges**

Change:

```
  mark_archived -> done
```

to:

```
  mark_archived_invalid -> done
  mark_archived_decline -> done
```

- [ ] **Step 2: Verify**

Run: `grep -nE 'mark_archived_(invalid|decline) -> done' pipelines/illumination-to-implementation.dot`

Expected: 2 hits.

### Task 21: Extend `explain_removal` prompt to write the reason file

**Files:**
- Modify: `pipelines/illumination-to-implementation.dot:12` (the `explain_removal` node's `prompt` attribute)

- [ ] **Step 1: Edit the prompt string**

The existing `explain_removal` declaration is:

```
  explain_removal [agent="implement", prompt="Read the illumination at $illumination_path.\n\nVerifier explanation: $explanation\n\nIn ONE sentence, explain to the user why this illumination is no longer valid or technically inaccurate. Be specific — reference the code or spec that contradicts it.\n\nDo NOT modify any project files."]
```

Change it to:

```
  explain_removal [agent="implement", prompt="Read the illumination at $illumination_path.\n\nVerifier explanation: $explanation\n\nIn ONE sentence, explain to the user why this illumination is no longer valid or technically inaccurate. Be specific — reference the code or spec that contradicts it.\n\nAlso write the full verifier explanation verbatim to $meditations_dir/.triage/$run_id/invalid-reason.txt — the next pipeline stage reads this file. Create parent directories if missing.\n\nDo NOT modify any files outside $meditations_dir/.triage/$run_id/."]
```

Two substantive changes vs. the original:
1. The "Also write …" sentence tells the agent to produce the reason-file carrier that `mark_archived_invalid`'s `script_args` points at.
2. The final line's "Do NOT modify any project files" is loosened to "Do NOT modify any files outside `$meditations_dir/.triage/$run_id/`" so the agent is actually permitted to write the reason file. The `.triage/$run_id/` directory is ephemeral scratch infrastructure (already used by `chat_session` for `chat-notes.md`) — writing there is not a "project file" modification.

- [ ] **Step 2: Verify the edit**

Run: `grep -n 'invalid-reason.txt' pipelines/illumination-to-implementation.dot`

Expected: 2 hits — one in the `explain_removal` prompt, one in `mark_archived_invalid`'s `script_args`.

### Task 22: Run `ralph pipeline validate` on the updated graph

- [ ] **Step 1: Build ralph first (plan relies on current dist for the CLI)**

Run: `npm run build`

Expected: build succeeds, `dist/cli/index.js` refreshed.

- [ ] **Step 2: Validate the graph**

Run: `./dist/cli/index.js pipeline validate pipelines/illumination-to-implementation.dot`

(Or, if `ralph` is globally linked and points at this checkout's `dist/`, run `ralph pipeline validate pipelines/illumination-to-implementation.dot`.)

Expected: exit 0. No errors. Specifically: no "unreachable node" error from `src/attractor/graph.ts:289`, no "node has no outgoing edges" error for the two new nodes, no "dangling edge target" for the retargeted edges.

- [ ] **Step 3: Cross-check grep invariants**

Run each:
- `grep -nE '\bmark_archived\b' pipelines/illumination-to-implementation.dot` → expect 0 hits
- `grep -n 'mark_archived_invalid' pipelines/illumination-to-implementation.dot` → expect 3 hits (declaration + `remove_gate` edge + `-> done` edge)
- `grep -n 'mark_archived_decline' pipelines/illumination-to-implementation.dot` → expect 3 hits (declaration + `approval_gate` edge + `-> done` edge)

### Task 23: Full verification + T0000-bundled commit

- [ ] **Step 1: Run full test suite**

Run: `npm run build && npm test`

Expected: green. No new failures.

- [ ] **Step 2: Run the mark-archived script tests one more time (regression check)**

Run: `npx vitest run pipelines/scripts/tests/mark-archived.test.mjs`

Expected: all 8 tests green.

- [ ] **Step 3: Commit — bundled with T0000**

**This chunk's `.dot` diff is part of T0000's unified commit, not a standalone commit.** Do NOT create a separate commit for Chunk 2. Instead, stage its hunks alongside T0000's hunks and let the T0000 commit message describe the unified change. The T0000 author is responsible for writing the commit message per their spec.

If Chunk 2 is being applied *before* T0000 is ready, stop here and surface to the user: "Chunk 2's `.dot` edits are staged but must land in T0000's commit. Waiting for T0000 to be assembled." Do not `git commit`.

---

## Out-of-scope (design doc §"What This Does NOT Do")

For the engineer: if you find yourself tempted to do any of these, stop and check with the user. They are explicitly out of scope:

- Engine quoting changes in `src/attractor/handlers/tool.ts:96-101`.
- A decline-reason prompt at `approval_gate`.
- Extracting a shared frontmatter helper between `mark-dispatched.mjs` and `mark-archived.mjs`.
- Retroactive re-archival of existing archived illuminations.
- Schema file for the script's JSON output (script tools use generic stdout-JSON handling — not `json_schema_file`).
- Modifying `delete_file`'s existence or semantics (T0000's concern).
- Modifying `mark-dispatched.mjs` or its tests.
- New pipeline variables.
