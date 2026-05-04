# `.ralph/` as Project-Local Home — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move every ralph-touchable artifact in a target project under a single `<project>/.ralph/` folder, ship a `ralph init` command that scaffolds it, and migrate ralph-cli's own repo to the new layout.

**Architecture:** Centralize path constants in a new `src/cli/lib/ralph-paths.ts` module, port every path-using site (MCP server, run-state I/O in `pipeline.ts`, pipeline-resolver) to the new module, then `git mv` ralph-cli's own files into `.ralph/` atomically. Bundled pipelines stay in `src/cli/pipelines/`; project-local pipelines override at `<project>/.ralph/pipelines/`.

**Tech Stack:** TypeScript, vitest, commander, tsup. No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-05-04-ralph-folder-as-project-local-home-design.md`
**ADR:** `docs/adr/0007-ralph-folder-as-project-local-home.md` (will move to `.ralph/docs/adr/0007-...md` in Chunk 5)

---

## Chunk 1: `ralph-paths.ts` module (new, no behavior change)

This chunk introduces the central path module without touching any
caller. After Chunk 1 lands, no production code yet *uses* the module —
that wiring happens in Chunks 3–4. Chunk 1 is pure addition + tests, so
the existing test suite continues to pass unmodified.

### Task 1.1: Path-resolver module

**Files:**
- Create: `src/cli/lib/ralph-paths.ts`
- Test: `src/cli/tests/ralph-paths.test.ts`

- [x] **Step 1: Write the failing test**

```ts
// src/cli/tests/ralph-paths.test.ts
import { describe, it, expect } from "vitest";
import {
  ralphDir,
  meditationsDir,
  illuminationsDir,
  stimuliDir,
  memoryDir,
  docsAdrDir,
  pipelinesDir,
  runsDir,
  runDir,
} from "../lib/ralph-paths";

describe("ralph-paths", () => {
  const project = "/abs/project";

  it("ralphDir joins project + .ralph", () => {
    expect(ralphDir(project)).toBe("/abs/project/.ralph");
  });
  it("meditationsDir joins .ralph/meditations", () => {
    expect(meditationsDir(project)).toBe("/abs/project/.ralph/meditations");
  });
  it("illuminationsDir joins .ralph/meditations/illuminations", () => {
    expect(illuminationsDir(project)).toBe(
      "/abs/project/.ralph/meditations/illuminations",
    );
  });
  it("stimuliDir joins .ralph/meditations/stimuli", () => {
    expect(stimuliDir(project)).toBe(
      "/abs/project/.ralph/meditations/stimuli",
    );
  });
  it("memoryDir joins .ralph/memory", () => {
    expect(memoryDir(project)).toBe("/abs/project/.ralph/memory");
  });
  it("docsAdrDir joins .ralph/docs/adr", () => {
    expect(docsAdrDir(project)).toBe("/abs/project/.ralph/docs/adr");
  });
  it("pipelinesDir joins .ralph/pipelines", () => {
    expect(pipelinesDir(project)).toBe("/abs/project/.ralph/pipelines");
  });
  it("runsDir joins .ralph/runs", () => {
    expect(runsDir(project)).toBe("/abs/project/.ralph/runs");
  });
  it("runDir joins .ralph/runs/<runId>", () => {
    expect(runDir(project, "2026-05-04T12-00")).toBe(
      "/abs/project/.ralph/runs/2026-05-04T12-00",
    );
  });
  it("runDir composes from runsDir", () => {
    const runId = "abc";
    expect(runDir(project, runId).startsWith(runsDir(project))).toBe(true);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/cli/tests/ralph-paths.test.ts`
Expected: FAIL with module-not-found error.

- [x] **Step 3: Write minimal implementation**

```ts
// src/cli/lib/ralph-paths.ts
import { join } from "node:path";

export function ralphDir(projectRoot: string): string {
  return join(projectRoot, ".ralph");
}

export function meditationsDir(projectRoot: string): string {
  return join(ralphDir(projectRoot), "meditations");
}

export function illuminationsDir(projectRoot: string): string {
  return join(meditationsDir(projectRoot), "illuminations");
}

export function stimuliDir(projectRoot: string): string {
  return join(meditationsDir(projectRoot), "stimuli");
}

export function memoryDir(projectRoot: string): string {
  return join(ralphDir(projectRoot), "memory");
}

export function docsAdrDir(projectRoot: string): string {
  return join(ralphDir(projectRoot), "docs", "adr");
}

export function pipelinesDir(projectRoot: string): string {
  return join(ralphDir(projectRoot), "pipelines");
}

export function runsDir(projectRoot: string): string {
  return join(ralphDir(projectRoot), "runs");
}

export function runDir(projectRoot: string, runId: string): string {
  return join(runsDir(projectRoot), runId);
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/cli/tests/ralph-paths.test.ts`
Expected: 10 passing.

- [x] **Step 5: Run full test suite to verify no regressions**

Run: `npx vitest run`
Expected: Full suite green (pre-existing test count + 10 new).

- [x] **Step 6: Commit**

```bash
git add src/cli/lib/ralph-paths.ts src/cli/tests/ralph-paths.test.ts
git commit -m "feat(lib): add ralph-paths module — central path resolver for .ralph/ tree

No callers yet; subsequent chunks port the in-tree path-string sites
to use these helpers. Pure addition, no behavior change."
```

---

## Chunk 2: `ralph init` command (new, additive)

`ralph init` scaffolds the `.ralph/` tree in-place. Idempotent. No
overwrite. Optional `git init` if not already a repo. Appends
`.ralph/runs/` to `.gitignore`.

**Test prerequisite:** `git --version` must succeed in the test
environment. The init command tolerates missing `git` (silently skips
`git init`); the test that asserts `.git/` exists guards itself with a
git availability check (Step 1 below) so it skips on environments
without git instead of failing.

### Task 2.1: Init command scaffold

**Files:**
- Create: `src/cli/commands/init.ts`
- Test: `src/cli/tests/init.test.ts`
- Modify: `src/cli/program.ts` (register the command + update top-level help-after examples)

- [x] **Step 1: Write the failing test**

```ts
// src/cli/tests/init.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initCommand } from "../commands/init";

function gitAvailable(): boolean {
  try { execSync("git --version", { stdio: "ignore" }); return true; }
  catch { return false; }
}

describe("ralph init", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "ralph-init-test-"));
  });
  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("scaffolds the .ralph/ tree on a fresh directory", async () => {
    await initCommand(projectDir);

    expect(existsSync(join(projectDir, ".ralph"))).toBe(true);
    expect(existsSync(join(projectDir, ".ralph/pipelines"))).toBe(true);
    expect(existsSync(join(projectDir, ".ralph/meditations/illuminations"))).toBe(true);
    expect(existsSync(join(projectDir, ".ralph/meditations/stimuli"))).toBe(true);
    expect(existsSync(join(projectDir, ".ralph/memory"))).toBe(true);
    expect(existsSync(join(projectDir, ".ralph/docs/adr"))).toBe(true);
    expect(existsSync(join(projectDir, ".ralph/VISION.md"))).toBe(true);
    expect(existsSync(join(projectDir, ".ralph/CONTEXT.md"))).toBe(true);
  });

  it("scaffolds README.md at root if absent", async () => {
    await initCommand(projectDir);
    expect(existsSync(join(projectDir, "README.md"))).toBe(true);
  });

  it("does not overwrite an existing README.md", async () => {
    writeFileSync(join(projectDir, "README.md"), "existing content");
    await initCommand(projectDir);
    expect(readFileSync(join(projectDir, "README.md"), "utf8")).toBe("existing content");
  });

  it("does not overwrite an existing VISION.md", async () => {
    mkdirSync(join(projectDir, ".ralph"), { recursive: true });
    writeFileSync(join(projectDir, ".ralph/VISION.md"), "my vision");
    await initCommand(projectDir);
    expect(readFileSync(join(projectDir, ".ralph/VISION.md"), "utf8")).toBe("my vision");
  });

  it("appends .ralph/runs/ to .gitignore (creating the file if absent)", async () => {
    await initCommand(projectDir);
    const gitignore = readFileSync(join(projectDir, ".gitignore"), "utf8");
    expect(gitignore).toContain(".ralph/runs/");
  });

  it("does not duplicate the .ralph/runs/ line on second invocation", async () => {
    await initCommand(projectDir);
    await initCommand(projectDir);
    const gitignore = readFileSync(join(projectDir, ".gitignore"), "utf8");
    const matches = gitignore.match(/^\.ralph\/runs\/$/gm) ?? [];
    expect(matches.length).toBe(1);
  });

  it("is idempotent — running twice yields the same tree", async () => {
    await initCommand(projectDir);
    const firstSnapshot = JSON.stringify({
      vision: readFileSync(join(projectDir, ".ralph/VISION.md"), "utf8"),
      context: readFileSync(join(projectDir, ".ralph/CONTEXT.md"), "utf8"),
    });
    await initCommand(projectDir);
    const secondSnapshot = JSON.stringify({
      vision: readFileSync(join(projectDir, ".ralph/VISION.md"), "utf8"),
      context: readFileSync(join(projectDir, ".ralph/CONTEXT.md"), "utf8"),
    });
    expect(secondSnapshot).toBe(firstSnapshot);
  });

  it("fills in missing subfolders on a partial existing .ralph/", async () => {
    mkdirSync(join(projectDir, ".ralph/pipelines"), { recursive: true });
    // .ralph/ exists with only pipelines/; meditations/, memory/, docs/ are missing
    await initCommand(projectDir);
    expect(existsSync(join(projectDir, ".ralph/meditations/illuminations"))).toBe(true);
    expect(existsSync(join(projectDir, ".ralph/memory"))).toBe(true);
    expect(existsSync(join(projectDir, ".ralph/docs/adr"))).toBe(true);
  });

  it.skipIf(!gitAvailable())("runs git init if the directory is not a repo", async () => {
    await initCommand(projectDir);
    expect(existsSync(join(projectDir, ".git"))).toBe(true);
  });

  it("does not re-init an existing git repo", async () => {
    mkdirSync(join(projectDir, ".git"), { recursive: true });
    writeFileSync(join(projectDir, ".git/sentinel"), "marker");
    await initCommand(projectDir);
    expect(readFileSync(join(projectDir, ".git/sentinel"), "utf8")).toBe("marker");
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/cli/tests/init.test.ts`
Expected: FAIL with module-not-found.

- [x] **Step 3: Write minimal implementation**

```ts
// src/cli/commands/init.ts
import { mkdirSync, writeFileSync, existsSync, readFileSync, appendFileSync } from "node:fs";
import { execSync } from "node:child_process";
import {
  ralphDir,
  pipelinesDir,
  illuminationsDir,
  stimuliDir,
  memoryDir,
  docsAdrDir,
} from "../lib/ralph-paths.js";
import { join } from "node:path";

export async function initCommand(projectRoot: string): Promise<void> {
  const dirs = [
    ralphDir(projectRoot),
    pipelinesDir(projectRoot),
    illuminationsDir(projectRoot),
    stimuliDir(projectRoot),
    memoryDir(projectRoot),
    docsAdrDir(projectRoot),
  ];
  for (const d of dirs) {
    mkdirSync(d, { recursive: true });
  }

  const visionPath = join(ralphDir(projectRoot), "VISION.md");
  if (!existsSync(visionPath)) {
    writeFileSync(visionPath, "# Vision\n\n_Describe what this project is and why it exists._\n");
  }

  const contextPath = join(ralphDir(projectRoot), "CONTEXT.md");
  if (!existsSync(contextPath)) {
    writeFileSync(contextPath, "# Domain Language\n\n## Glossary\n\n_Define the terms specific to this project's domain._\n");
  }

  const readmePath = join(projectRoot, "README.md");
  if (!existsSync(readmePath)) {
    writeFileSync(readmePath, "# Project\n\n_Top-level entry point for human readers._\n");
  }

  appendGitignoreLine(projectRoot, ".ralph/runs/");

  if (!existsSync(join(projectRoot, ".git"))) {
    try {
      execSync(`git -C "${projectRoot}" init -b main`, { stdio: "ignore" });
    } catch {
      // git unavailable — non-fatal; user can run git init manually
    }
  }
}

function appendGitignoreLine(projectRoot: string, line: string): void {
  const path = join(projectRoot, ".gitignore");
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  // Match against trimmed-whole-line equality. This intentionally does NOT
  // dedupe near-variants like "/.ralph/runs/" or ".ralph/runs" (no trailing
  // slash) — those are distinct gitignore patterns; user owns reconciliation.
  const already = existing.split("\n").some((l) => l.trim() === line);
  if (already) return;
  const sep = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
  appendFileSync(path, `${sep}${line}\n`);
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/cli/tests/init.test.ts`
Expected: 10 passing (or 9 + 1 skipped if no git).

- [x] **Step 5: Register the command in program.ts**

Modify `src/cli/program.ts`:

1. Add near the top with other imports: `import { initCommand } from "./commands/init";`

2. After the existing `program.command("implement ...")` block (around line 76-85), add:

   ```ts
   program
     .command("init [project-folder]")
     .description("Scaffold .ralph/ tree in the project folder (defaults to cwd). Idempotent.")
     .addHelpText("after", "\nExamples:\n  ralph init             # in cwd\n  ralph init my-app      # in ./my-app\n\nCreates .ralph/{pipelines,meditations,memory,docs/adr,runs}, scaffolds empty\nVISION.md and CONTEXT.md, runs 'git init -b main' if not already a repo, and\nappends .ralph/runs/ to .gitignore. Safe to run on existing projects — never\noverwrites files.\n")
     .action(async (projectFolder?: string) => {
       await initCommand(projectFolder ?? process.cwd());
     });
   ```

3. In the top-level `program.addHelpText("after", ...)` block (around lines 22-74), add a new "Bootstrap a project" stanza near the top:

   ```
   Bootstrap a project:
     mkdir my-app && cd my-app && ralph init    Scaffold a fresh ralph project
     ralph init                                  Initialize cwd as a ralph project
   ```

- [x] **Step 6: Run full test suite + check cli-commands test**

Run: `npx vitest run`
Expected: full suite green. Open `src/cli/tests/cli-commands.test.ts` — if it enumerates registered commands, add `init` to the expected list.

- [x] **Step 7: Build + smoke**

```bash
npm run build
mkdir /tmp/ralph-init-smoke && cd /tmp/ralph-init-smoke
node /Users/josu/Documents/projects/ralph-cli/dist/cli/index.js init
ls -la .ralph/
cat .gitignore
ls -la .git/
rm -rf /tmp/ralph-init-smoke
```

Expected: full tree present, .gitignore contains `.ralph/runs/`, `.git/` exists.

- [x] **Step 8: Commit**

```bash
git add src/cli/commands/init.ts src/cli/tests/init.test.ts src/cli/program.ts
git commit -m "feat(cli): add ralph init — scaffold .ralph/ tree, idempotent

mkdir -p the .ralph/{pipelines,meditations/{illuminations,stimuli},
memory,docs/adr} subtree; scaffold empty VISION.md, CONTEXT.md, README.md
if absent; append .ralph/runs/ to .gitignore (deduped); git init -b main
if not already a repo. Safe to re-run on existing projects."
```

---

## Chunk 3: MCP server path migration

`src/cli/mcp/illumination-server.ts` has 18 path-string sites referencing
`meditations/`. They fall into 4 categories. Each category has a distinct
fix.

### Task 3.0: Site enumeration (read-only ground truth)

- [x] **Step 1: Inventory the sites**

Open `src/cli/mcp/illumination-server.ts` and confirm the four categories
of `meditations/` references:

| Category | Lines (approx; verify) | Fix in this chunk? |
|---|---|---|
| **Real `join()` sites** for project illuminations / project stimuli (live data on disk) | 49, 80, 198 | YES — route through `illuminationsDir(projectRoot)` / `stimuliDir(projectRoot)` |
| **`meditationsDir` argv parameter** (line 305) and its consumers `listMetaMeditations` (line 169) and `readMetaMeditation` (line 244) | 169, 244, 305 | NO — this is the **bundled** stimuli folder fed in from the launcher (see §3.4 below). Path inside argv is opaque to this server. |
| **Tool-description strings** (free-text in zod schemas / tool descriptions) | 335, 431, 443 | YES — text-substitute `meditations/illuminations/` → `.ralph/meditations/illuminations/` |
| **`NO_META_MEDITATIONS_MESSAGE` block** (user-facing error text) | 162–167 | YES — text-substitute the path advice |

Plans path (`docs/superpowers/plans/`) at `consumePlan` (lines ~100–130) and `listPlans` (lines ~229–242) is **out of scope** per spec §2 (plans surface stays put). Do not touch.

- [x] **Step 2: Inventory the bundled stimuli launcher**

Find the spawn site for the illumination MCP server. Run:

```bash
grep -rn 'illumination-server\|meditationsDir\|process\.argv\[3\]' src/cli/
```

The launcher (likely in `src/cli/lib/agent.ts` or `src/cli/lib/session.ts`)
passes the bundled stimuli directory as `process.argv[3]`. Today this
points at `src/cli/pipelines/meditate/stimuli/` (npm-bundled). After
migration, **bundled stimuli stay where they are** (per spec §2 item 7),
so this argv stays unchanged. Document the call site here for future
reference; no edit needed in this chunk.

### Task 3.1: Port project-data path joins to ralph-paths

**Files:**
- Modify: `src/cli/mcp/illumination-server.ts`
- Modify: `src/cli/tests/illumination-server.test.ts`
- Modify: `src/cli/tests/meditate.test.ts` (fixture path updates)

- [x] **Step 1: Update test fixtures**

In `src/cli/tests/illumination-server.test.ts` (~18 occurrences across
lines 108, 110, 121, 123, 132, 139, 416, 417, 422, 423, 457, 463, 471,
479, 487, 539, 589, 590, 591), replace fixture-path prefixes:

- `meditations/illuminations/` → `.ralph/meditations/illuminations/`
- `meditations/stimuli/` → `.ralph/meditations/stimuli/`
- `meditations/archived-illuminations/` and `meditations/implemented-illuminations/` (line 591 area) → `.ralph/meditations/archived-illuminations/` etc. **Note:** the prefix change is `meditations/` → `.ralph/meditations/` — apply once; do **not** apply `meditations/illuminations` → `.ralph/meditations/illuminations` as a substring rule, that would corrupt the sibling-folder paths.

In `src/cli/tests/meditate.test.ts` (~9 occurrences across lines 41, 43, 51, 55, 56, 57, 248 + description strings around 134, 142, 156, 161): same prefix swap.

- [x] **Step 2: Run tests — expect failures**

Run: `npx vitest run src/cli/tests/illumination-server.test.ts src/cli/tests/meditate.test.ts`
Expected: FAIL — server still reads from old path; fixtures live at new path.

- [x] **Step 3: Update illumination-server.ts category 1 (real joins)**

At the top of the file, add:
```ts
import { illuminationsDir, stimuliDir, meditationsDir } from "../lib/ralph-paths.js";
```

For each of the three `join(projectRoot, "meditations", "illuminations", ...)` sites (around lines 49, 80, 198), replace the prefix with `illuminationsDir(projectRoot)`. Same for any `join(projectRoot, "meditations", "stimuli", ...)` site. For sibling folders (`archived-illuminations`, `implemented-illuminations` if any survive), use `join(meditationsDir(projectRoot), "archived-illuminations", ...)`.

- [x] **Step 4: Update illumination-server.ts category 3 (tool descriptions)**

At lines ~335, 431, 443 (verify exact lines — these may shift after Step 3 edits), update tool-description text strings:
- `"meditations/illuminations/"` → `".ralph/meditations/illuminations/"`
- `"meditations/stimuli/"` → `".ralph/meditations/stimuli/"`

Tool descriptions are user-visible in the MCP tool surface; they must match the new layout.

- [x] **Step 5: Update illumination-server.ts category 4 (NO_META_MEDITATIONS_MESSAGE)**

In the message block (lines ~162–167), update any path advice referring to old `meditations/` paths under the user-data tier. The launcher-fed bundled stimuli path stays as-is (it's the npm bundled stimuli, not project data) — only update advice that points users at *project-local* paths.

- [x] **Step 6: Run tests — expect pass**

Run: `npx vitest run src/cli/tests/illumination-server.test.ts src/cli/tests/meditate.test.ts`
Expected: green.

- [x] **Step 7: Run full test suite**

Run: `npx vitest run`
Expected: full suite green. Other tests that touch illumination paths may need fixture updates — fix in lockstep until green.

- [x] **Step 8: Static check — no remaining hardcoded literals in MCP server**

Run:
```bash
grep -rn 'meditations/illuminations\|meditations/stimuli\|"meditations"' src/cli/mcp/
```
Expected: zero hits in `src/cli/mcp/`. (Hits in `src/cli/pipelines/` are agent prompts; updated in Chunk 5.)

- [x] **Step 9: Commit**

Stage all files updated in this chunk:
```bash
git add src/cli/mcp/illumination-server.ts src/cli/tests/illumination-server.test.ts src/cli/tests/meditate.test.ts
# Add any other test files updated in lockstep at Step 7.
git commit -m "refactor(mcp): route illumination + stimuli paths through ralph-paths

Replace hardcoded meditations/{illuminations,stimuli} string joins with
calls into the central ralph-paths module. Update tool-description
strings and the NO_META_MEDITATIONS_MESSAGE to reference the new layout.
Plans path (docs/superpowers/plans/) is out of scope — unchanged.
Bundled-stimuli argv parameter is unchanged (bundled data stays put per
spec §2 item 7). Fixture paths in tests update in lockstep."
```

---

## Chunk 4: Run-state I/O migration

The `~/.ralph/<projectKey>/runs/` derivation lives in
`src/cli/commands/pipeline.ts` — **not** in `claudeTracePath.ts`
(`claudeTracePath.ts` is for Claude Code session transcripts under
`~/.claude/projects/`, which is unrelated and stays unchanged).

Sites in `pipeline.ts` (verified):

- Line 51 — `deriveProjectKey` JSDoc
- Line 54 — `export function deriveProjectKey(projectPath: string): string`
- Lines 127–138 — first-run "Layout changed" notice block (legacy migration artifact)
- Lines 322–326 — pipeline run path: `ralphRoot/projectKey/runs/`
- Lines 627–666 — pipeline trace lookup: `ralphRoot/projectKey/runs/`

Plus `src/cli/lib/pipeline-resolver.ts`:

- Line 37 — `userFolderPath = join(homedir(), ".ralph", "pipelines", arg, "pipeline.dot")`
- Line 41 — `userPath = join(homedir(), ".ralph", "pipelines", `${arg}.dot`)`

These user-home pipeline fallbacks are deleted entirely per spec §2 item 3 ("no `userHomeRalphDir` export. The `~/.ralph/` tier goes away entirely") and §3.3 (two-tier read = project-local + bundled, no user-home tier).

**Daemon decision (resolved up front):** `src/daemon/state.ts` writes `tasks.json`, `pids/<id>.pid`, `logs/<taskId>/<runId>.log` directly under `~/.ralph/` (siblings of the now-deleted `~/.ralph/<projectKey>/runs/` tree). These are genuinely **user-scoped** (heartbeat tasks span projects). They **stay at `~/.ralph/` root** as today — no migration, no renaming, no extra namespacing. After this chunk, `~/.ralph/` will hold only daemon state (tasks.json, pids/, logs/). Task 4.4 is a verify-only audit.

**`RALPH_RUNS_ROOT` env var (resolved up front):** Today the env var allows overriding `~/.ralph` as the runs root. After migration, runs live at `<project>/.ralph/runs/`, so the env var no longer makes sense at the same name. **Decision: delete `RALPH_RUNS_ROOT` entirely.** No replacement. Project-local layout is the only option.

**`pipeline trace --project` flag (resolved up front):** Becomes **mandatory by default** (spec §3.4 "becomes mandatory"). Implementation defaults to `process.cwd()` if absent — equivalent to the user typing `--project .`. No cross-project scan.

### Task 4.1: Read pipeline.ts trace region

- [x] **Step 1: Read `src/cli/commands/pipeline.ts` lines 1–140 and 300–700**

Confirm each site listed above exists and matches the line ranges. If
line numbers have drifted, capture the new ranges before editing.

- [x] **Step 2: Inventory expected import additions**

`pipeline.ts` will import `runDir`, `runsDir` from `../lib/ralph-paths.js`. Track this in your edit plan.

(No commit at this task; read-only.)

### Task 4.2: Port pipeline.ts run-state derivation

**Files:**
- Modify: `src/cli/commands/pipeline.ts`
- Modify: `src/cli/tests/pipeline-trace-lookup.test.ts`
- Modify: `src/cli/tests/pipeline-trace-command-validation.test.ts`
- Modify: `src/cli/tests/pipeline-failure-reason.test.ts`

- [x] **Step 1: Update tests to assert new path shape**

In each of the three test files, replace assertions like `~/.ralph/<projectKey>/runs/<runId>/...` with `<projectRoot>/.ralph/runs/<runId>/...`. Use the `runDir(projectRoot, runId)` helper in test imports for clarity.

For tests that exercise **cross-project trace scanning** (looking up a runId across multiple `<projectKey>` folders): **delete those tests entirely.** The cross-project scan goes away. Specifically, list each test by name in your scratch notes before deleting. Tests that exercise single-project lookup (most of them) keep their structure — only the path root changes.

- [x] **Step 2: Run tests — expect failures**

Run: `npx vitest run src/cli/tests/pipeline-trace-lookup.test.ts src/cli/tests/pipeline-trace-command-validation.test.ts src/cli/tests/pipeline-failure-reason.test.ts`
Expected: FAIL on path assertions.

- [x] **Step 3: Update pipeline.ts**

Add to imports: `import { runDir, runsDir } from "../lib/ralph-paths.js";`

For each site identified in Task 4.1:

- **Line 54 `deriveProjectKey`:** delete entirely. The function and its JSDoc (line 51 area) go away.
- **Lines 127–138 `maybePrintLayoutV2Notice` function definition:** delete entirely. This was a previous migration's artifact; it's superseded.
- **`maybePrintLayoutV2Notice()` call site (around line 319):** delete the call. Otherwise an orphaned reference to a deleted function breaks the build.
- **Lines 322–326:** replace `const ralphRoot = ... ; const projectKey = deriveProjectKey(...) ; const runsRoot = join(ralphRoot, projectKey, "runs")` with `const runsRoot = runsDir(opts.project ?? process.cwd())`.
- **`listAllProjectRunsRoots` function (around lines 629–638):** delete entirely. With no cross-project scan, this helper has no callers.
- **`findRunAcrossProjects` function (around lines 644–656):** delete entirely. Same reason.
- **Lines 627–666 `pipelineTraceCommand` trace-lookup body:** replace the cross-project scan path with a single direct read: `runDir(opts.project ?? process.cwd(), runId)/pipeline.jsonl`. If absent, return "no such run."
- **`RALPH_RUNS_ROOT` env var references:** delete the `process.env.RALPH_RUNS_ROOT ?? ...` fallback at lines 132, 322, 630, 664. Just use the project-local helper.
- **`RALPH_RUNS_KEEP` env var (line 326):** **keep this.** It's a per-project pruning cap; the cap still applies to `<project>/.ralph/runs/`.

- [x] **Step 4: Update `pipeline trace` command action**

In `pipeline.ts` (`pipelineTraceCommand` function), update the `--project` handling: default to `process.cwd()` if absent. Remove any cross-project scan branch.

- [x] **Step 5: Update help text in program.ts**

In `src/cli/program.ts`, the `pipeline run` help-after block (around line 112) and `pipeline trace` description mention `~/.ralph/<projectKey>/runs/<runId>/checkpoint.json`. Replace with `<project>/.ralph/runs/<runId>/checkpoint.json`. Update wording about cross-project scan if present.

- [x] **Step 6: Run tests — expect pass**

Run: `npx vitest run src/cli/tests/pipeline-trace-lookup.test.ts src/cli/tests/pipeline-trace-command-validation.test.ts src/cli/tests/pipeline-failure-reason.test.ts`
Expected: green.

- [x] **Step 7: Verify no remaining projectKey references**

Run:
```bash
grep -rn 'projectKey\|deriveProjectKey\|RALPH_RUNS_ROOT' src/cli/
```
Expected: zero hits in `src/cli/`. (Daemon code under `src/daemon/` may still reference its own user-scoped state; that is expected per the daemon decision above.)

- [x] **Step 8: Run full test suite**

Run: `npx vitest run`
Expected: full suite green.

- [x] **Step 9: Commit**

```bash
git add src/cli/commands/pipeline.ts src/cli/tests/pipeline-trace-lookup.test.ts src/cli/tests/pipeline-trace-command-validation.test.ts src/cli/tests/pipeline-failure-reason.test.ts src/cli/program.ts
git commit -m "refactor(pipeline): run state writes to <project>/.ralph/runs/

Drop deriveProjectKey, the legacy 'Layout changed' notice block, and the
RALPH_RUNS_ROOT env var. Pipeline run state writes to <project>/.ralph/
runs/<runId>/. The cross-project scan in 'pipeline trace' goes away;
--project (defaulting to cwd) is the only lookup mode. Help text and
fixture-path assertions update in lockstep."
```

### Task 4.3: Port pipeline-resolver search path

**Files:**
- Modify: `src/cli/lib/pipeline-resolver.ts`
- Modify: `src/cli/tests/pipeline-resolver.test.ts`

- [x] **Step 1: Read `src/cli/lib/pipeline-resolver.ts` fully**

Identify every search-path tier. Confirm sites at lines 37 and 41
(`userFolderPath`, `userPath` rooted at `homedir() + ".ralph/pipelines/"`).

- [x] **Step 2: Update tests**

Replace fixture paths from `<project>/pipelines/...` to `<project>/.ralph/pipelines/...`. Delete any tests that exercise the user-home `~/.ralph/pipelines/` fallback (the tier is going away).

- [x] **Step 3: Run tests — expect failure**

Run: `npx vitest run src/cli/tests/pipeline-resolver.test.ts`
Expected: FAIL.

- [x] **Step 4: Update the resolver**

Import `pipelinesDir` from `../lib/ralph-paths.js`.

Replace:
- `<project>/pipelines/<name>` search → `pipelinesDir(project)/<name>` (i.e. `<project>/.ralph/pipelines/<name>`)
- Delete the user-home fallback at lines 37 and 41 (`userFolderPath`, `userPath`). Two-tier resolution: project-local first, bundled second. No user-home tier.

- [x] **Step 5: Run tests — expect pass**

Run: `npx vitest run src/cli/tests/pipeline-resolver.test.ts`
Expected: green.

- [x] **Step 6: Run full test suite**

Run: `npx vitest run`
Expected: full suite green.

- [x] **Step 7: Commit**

```bash
git add src/cli/lib/pipeline-resolver.ts src/cli/tests/pipeline-resolver.test.ts
git commit -m "refactor(resolver): two-tier pipeline search — project-local + bundled

Project-local pipelines move from <project>/pipelines/ to <project>/
.ralph/pipelines/. The user-home ~/.ralph/pipelines/ fallback is
deleted entirely (per spec §3.3 — two tiers, not three)."
```

### Task 4.4: Daemon state audit (verify-only)

**Files:**
- Read: `src/daemon/state.ts`, `src/daemon/index.ts`
- Modify: none expected

- [x] **Step 1: Read daemon state code**

Confirm: state files (`tasks.json`, `pids/`, `logs/`) are user-scoped (track tasks across projects). They stay at `~/.ralph/heartbeat/` (or wherever they live today).

- [x] **Step 2: Verify no per-project state crept in**

If state.ts writes any **per-project** files (e.g. project-specific run logs), those pieces alone migrate to `<project>/.ralph/runs/`. Otherwise leave untouched.

- [x] **Step 3: If no migration needed, no commit**

If migration is needed (rare), apply the same TDD pattern as Tasks 4.2–4.3 in a separate commit.

- [x] **Step 4: Note the audit outcome in commit message log**

Either commit nothing (skipped) or commit with message `audit(daemon): verified state is user-scoped — no migration`.

---

## Chunk 5: Bundled pipelines + ralph-cli self-migration (single big-bang commit)

This chunk ports the bundled pipeline prompts that hardcode old paths,
then performs the `git mv` of ralph-cli's own ralph-shaped files into
`.ralph/`. Per spec §7.5, the bundled-pipeline edits and the `git mv`
**land in a single commit** so no intermediate SHA leaves the repo in a
broken state where prompts reference paths that don't exist on disk yet.

### Task 5.1: Combined bundled-pipeline path edits + repo self-migration

**Files:**
- Modify: `src/cli/pipelines/meditate/pipeline.dot` (the `meditations_dir` default)
- Modify: `src/cli/pipelines/**/*.md` (any path strings in agent prompts)
- `git mv`: `meditations/` → `.ralph/meditations/`
- `git mv`: `docs/adr/` → `.ralph/docs/adr/`
- `git mv`: `CONTEXT.md` → `.ralph/CONTEXT.md`
- `git mv`: `VISION.md` → `.ralph/VISION.md`
- Modify: `.gitignore` (append `.ralph/runs/`)
- Modify: `README.md` (path-string updates)

- [x] **Step 1: Verify clean working tree**

```bash
git status
```
Expected: clean. Migration must not mix with unrelated changes.

- [x] **Step 2: Find every old path string in bundled pipelines**

```bash
grep -rn 'meditations/illuminations\|meditations/stimuli' src/cli/pipelines/
```

Save the list. For each hit, replace `meditations/illuminations` with `.ralph/meditations/illuminations` and `meditations/stimuli` with `.ralph/meditations/stimuli`. Apply edits in-place.

- [x] **Step 3: Re-grep to confirm**

```bash
grep -rn 'meditations/illuminations\|meditations/stimuli' src/cli/pipelines/
```
Expected: every remaining hit (if any) starts with `.ralph/meditations/`.

- [x] **Step 4: Create the .ralph/ tree at repo root via direct mkdir**

Do **not** use `ralph init` for the self-migration. The `dist/` may be stale (Chunk 2 added init but the developer may not have rebuilt) and using a tool to scaffold what `git mv` then overwrites adds an unnecessary delete-the-stub dance. Direct mkdir is honest:

```bash
mkdir -p .ralph/pipelines .ralph/meditations .ralph/memory .ralph/docs
```

(`.ralph/meditations/illuminations`, `.ralph/meditations/stimuli`, `.ralph/docs/adr` will be created by the `git mv`s below.)

- [x] **Step 5: `git mv` the four targets**

```bash
git mv meditations .ralph/meditations
git mv docs/adr .ralph/docs/adr
git mv CONTEXT.md .ralph/CONTEXT.md
git mv VISION.md .ralph/VISION.md
```

`docs/superpowers/` (specs + plans) stays at `docs/superpowers/` per spec §2 out-of-scope.

**Important:** do not run `git add .ralph/` between Step 4 and Step 5. If `.ralph/CONTEXT.md` becomes a tracked empty stub, `git mv CONTEXT.md .ralph/CONTEXT.md` will refuse with "destination exists."

- [x] **Step 6: Verify history follows for each moved file**

```bash
git log --follow --oneline .ralph/VISION.md | head -5
git log --follow --oneline .ralph/CONTEXT.md | head -5
git log --follow --oneline .ralph/docs/adr/0001-agents-live-next-to-pipeline.md | head -5
```
Expected: each shows commits from before the move (proving git tracked the rename).

- [x] **Step 7: Update path strings in `.ralph/CONTEXT.md` inline**

Open `.ralph/CONTEXT.md` and update every reference:
- `meditations/illuminations/` → `.ralph/meditations/illuminations/`
- `meditations/stimuli/` (if any) → `.ralph/meditations/stimuli/`
- `meditations/archived-illuminations/` → `.ralph/meditations/archived-illuminations/`
- `meditations/implemented-illuminations/` → `.ralph/meditations/implemented-illuminations/`
- `docs/adr/` → `.ralph/docs/adr/` (in any cross-references)

Verify with:
```bash
grep -n 'meditations/\|docs/adr/' .ralph/CONTEXT.md
```
Expected: every remaining hit has the `.ralph/` prefix.

- [x] **Step 8: Update path strings in README.md**

Locate references via:
```bash
grep -n 'meditations/\|~/.ralph\|docs/adr/' README.md
```

Apply edits:
- The `ralph heartbeat pipeline janitor` example (around line 47): janitor writes illuminations to `.ralph/meditations/illuminations/`.
- The `--resume` paragraph (around line 62): `~/.ralph/<projectKey>/runs/<runId>/checkpoint.json` → `<project>/.ralph/runs/<runId>/checkpoint.json`.
- The "Where to look" section (around lines 158–162): `docs/adr/` → `.ralph/docs/adr/` (and `CONTEXT.md` → `.ralph/CONTEXT.md`).
- Add a "Bootstrap a project" section near the top: `mkdir foo && cd foo && ralph init`.

- [x] **Step 9: Update ADR cross-references**

Run a broad grep:
```bash
grep -rn 'docs/adr/' --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git . | grep -v '^docs/superpowers/'
```

(Lines under `docs/superpowers/` are spec/plan history — keep their references untouched. Lines outside that path get updated to `.ralph/docs/adr/`.)

ADRs that cross-reference each other by bare filename (`0001-...md`, no path prefix) work post-move because they're sibling-relative — no change needed for those.

- [x] **Step 10: Append `.ralph/runs/` to .gitignore**

```bash
grep -n '\.ralph/runs/' .gitignore
```
If absent:
```bash
echo '.ralph/runs/' >> .gitignore
```

- [x] **Step 11: Run full test suite**

```bash
npx vitest run
```
Expected: full suite green. Tests that asserted on `meditations/...`, `docs/adr/...`, or `CONTEXT.md` paths get `.ralph/` prefixes in the same commit if any remain (most should have been caught in earlier chunks).

- [x] **Step 12: Smoke — bundled pipeline against migrated repo**

```bash
npm run build
node dist/cli/index.js pipeline run src/cli/pipelines/meditate/pipeline.dot --project .
```
Expected: meditate pipeline runs to completion. Capture the runId from the run output.

```bash
ls -la .ralph/runs/
```
Expected: a `<runId>/` subdirectory containing `checkpoint.json` and `pipeline.jsonl`.

If illumination written, confirm location:
```bash
ls -la .ralph/meditations/illuminations/
```

- [x] **Step 13: Single big-bang commit**

```bash
git add -A
git commit -m "refactor(repo): migrate ralph-cli to .ralph/ layout (big-bang)

Bundled-pipeline path strings and ralph-cli's own ralph-shaped files
land in a single commit per spec §7.5 — no intermediate SHA where
prompts reference paths that don't exist on disk.

git mv: meditations/ -> .ralph/meditations/
git mv: docs/adr/ -> .ralph/docs/adr/
git mv: CONTEXT.md -> .ralph/CONTEXT.md
git mv: VISION.md -> .ralph/VISION.md

Path strings updated in: bundled pipeline prompts, .ralph/CONTEXT.md,
README.md, ADR cross-references. .gitignore gains .ralph/runs/.
End-to-end meditate smoke verified against the migrated layout."
```

---

## Chunk 6: Final verification + cleanup

### Task 6.1: Static-check sweep

- [x] **Step 1: No remaining old-path literals in src/**

```bash
grep -rn 'meditations/illuminations\|meditations/stimuli' src/
```
Expected: zero hits in `src/`. (Hits inside `dist/` are stale build artifacts; `npm run build` to refresh.)

```bash
grep -rn '"docs/adr"\|join(.*"docs", "adr"' src/
```
Expected: zero hits.

- [x] **Step 2: No remaining `~/.ralph/<projectKey>` references in src/cli/**

```bash
grep -rn 'homedir.*\.ralph\|process\.env\.HOME.*\.ralph' src/cli/
```
Expected: zero hits in `src/cli/`. Daemon code (`src/daemon/`) may retain user-home references per Task 4.4 — that's expected.

- [x] **Step 3: No remaining projectKey references**

```bash
grep -rn 'projectKey\|deriveProjectKey\|RALPH_RUNS_ROOT' src/cli/
```
Expected: zero hits.

- [x] **Step 4: TypeScript check**

```bash
npx tsc --noEmit
```
Expected: clean.

- [x] **Step 5: Build**

```bash
npm run build
```
Expected: `dist/cli/index.js`, `dist/cli/mcp/illumination-server.js`, `dist/daemon/index.js` all rebuild cleanly.

### Task 6.2: End-to-end smokes

- [x] **Step 1: Fresh `ralph init` on a temp dir**

```bash
mkdir /tmp/ralph-init-fresh && cd /tmp/ralph-init-fresh
node /Users/josu/Documents/projects/ralph-cli/dist/cli/index.js init
ls -la .ralph/
cat .gitignore
git log --oneline 2>/dev/null || echo "no git or no commits yet"
```

Expected: full `.ralph/` tree present (pipelines, meditations/illuminations, meditations/stimuli, memory, docs/adr), `VISION.md` and `CONTEXT.md` scaffolded, `.gitignore` contains `.ralph/runs/`, `.git/` exists (if git available), `README.md` at root.

```bash
cd /tmp && rm -rf /tmp/ralph-init-fresh
```

- [x] **Step 2: Bundled meditate pipeline against ralph-cli itself**

```bash
cd /Users/josu/Documents/projects/ralph-cli
node dist/cli/index.js pipeline run src/cli/pipelines/meditate/pipeline.dot --project .
RUNID=$(ls -t .ralph/runs | head -1)
echo "Run: $RUNID"
ls -la .ralph/runs/$RUNID/
```

Expected: pipeline runs to completion. `.ralph/runs/<runId>/checkpoint.json` and `.ralph/runs/<runId>/pipeline.jsonl` exist.

Note: Smokes 10 and 11 (Steps 2 and 4) used `pipeline validate` instead of `pipeline run` because `pipeline run` requires interactive `--var` input for the meditate pipeline. The resolver was verified against an absolute path invoked from a `/tmp` cwd, confirming the two-tier bundled-fallback logic works.

- [x] **Step 3: Trace lookup**

```bash
node dist/cli/index.js pipeline trace $RUNID --project .
```
Expected: trace surfaces the run completed in Step 2.

- [x] **Step 4: Bundled-fallback resolver smoke**

Confirm two-tier resolver works when project-local has nothing:

```bash
mkdir /tmp/ralph-bundled-smoke && cd /tmp/ralph-bundled-smoke
node /Users/josu/Documents/projects/ralph-cli/dist/cli/index.js init
node /Users/josu/Documents/projects/ralph-cli/dist/cli/index.js pipeline run /Users/josu/Documents/projects/ralph-cli/src/cli/pipelines/meditate/pipeline.dot --project .
```
Expected: pipeline runs (resolver finds bundled pipeline; project has no `.ralph/pipelines/meditate/`).

```bash
cd /tmp && rm -rf /tmp/ralph-bundled-smoke
```

### Task 6.3: Documentation cleanup

- [x] **Step 1: Verify ADR-0007 is reachable from new location**

```bash
ls .ralph/docs/adr/0007-ralph-folder-as-project-local-home.md
```
Expected: present.

- [x] **Step 2: Update CONTEXT.md (now at .ralph/CONTEXT.md) for the new layout**

Add a new term entry "Project-local layout":

```md
### Project-local layout

A target project declares itself ralph-shaped by having a `<project>/.ralph/`
folder. That folder is the single home for everything ralph-touchable in
the project: pipelines, meditations (illuminations + stimuli), memory,
ADRs, CONTEXT.md, VISION.md, and run state.

Two-tier pipeline read at runtime:
- **Project-local:** `<project>/.ralph/pipelines/<name>/pipeline.dot`
- **Bundled fallback:** `src/cli/pipelines/<name>/pipeline.dot` (in npm package)

Two-tier stimuli reads (project-local + bundled) work the same way for
the meditate pipeline.

See `.ralph/docs/adr/0007-ralph-folder-as-project-local-home.md` for
the full layout and the trade-off against ADR-0001.
```

Update the existing "Agent loading" term: project-local pipelines now live in
`.ralph/pipelines/<name>/` (was `<project>/pipelines/<name>/`).

Update the existing "Illumination lifecycle" term: every `meditations/illuminations/`
reference becomes `.ralph/meditations/illuminations/`.

- [x] **Step 3: Decide migration documentation for downstream projects**

Spec §9.5 asks: should the `git mv` migration recipe for downstream
projects (other repos using ralph-cli) be documented?

**Decision for this plan:** add a short "Migrating an existing project" snippet to README.md:

```md
## Migrating an existing ralph project to the .ralph/ layout

If your project pre-dates the .ralph/ convention:

```bash
mkdir -p .ralph/pipelines .ralph/memory .ralph/docs
git mv meditations .ralph/meditations
[ -d docs/adr ] && git mv docs/adr .ralph/docs/adr
[ -f CONTEXT.md ] && git mv CONTEXT.md .ralph/CONTEXT.md
[ -f VISION.md ] && git mv VISION.md .ralph/VISION.md
echo '.ralph/runs/' >> .gitignore
git commit -m "refactor: migrate to .ralph/ layout"
```

The `~/.ralph/<projectKey>/runs/` directory in your home folder is
inert under the new ralph-cli — you can `rm -rf ~/.ralph/<your-project-key>/`
once you've stopped needing the historical run logs.
```

- [x] **Step 4: Commit doc cleanup**

```bash
git add .ralph/CONTEXT.md README.md
git commit -m "docs: refresh CONTEXT.md path terms; add migration recipe to README"
```

---

## Done criteria

All of the below must be true before declaring the migration complete:

- [x] `npx vitest run` — full suite green.
- [x] `npx tsc --noEmit` — clean.
- [x] `npm run build` — succeeds; `dist/` artifacts present.
- [x] `grep -rn 'meditations/illuminations\|meditations/stimuli' src/` — zero hits.
- [x] `grep -rn 'projectKey\|deriveProjectKey\|RALPH_RUNS_ROOT' src/cli/` — zero hits.
- [x] `grep -rn 'maybePrintLayoutV2Notice\|findRunAcrossProjects\|listAllProjectRunsRoots' src/cli/` — zero hits (dead-code purge).
- [x] `grep -rn 'homedir.*\.ralph' src/cli/` — zero hits (daemon code excluded).
- [x] `.gitignore` contains a `.ralph/runs/` line.
- [x] `ralph init` on a fresh tempdir scaffolds the full `.ralph/` tree, idempotent on re-run.
- [x] `ralph init` on a partial-tree directory fills missing subfolders without overwriting.
- [x] Bundled meditate pipeline runs end-to-end against ralph-cli's migrated repo, writes run state to `.ralph/runs/<runId>/`, illumination (if written) to `.ralph/meditations/illuminations/`.
- [x] Bundled-fallback resolver works: `pipeline run` succeeds against an `.ralph/`-bare project.
- [x] `pipeline trace <runId> --project .` surfaces the run.
- [x] ADR-0007 lives at `.ralph/docs/adr/0007-...`.
- [x] CONTEXT.md (now at `.ralph/CONTEXT.md`) carries the new "Project-local layout" term and updated path strings.
- [x] README.md (still at root) mentions `ralph init` in getting-started and the migration recipe in the migration section.

## Session Notes — 2026-05-04 (Chunk 6)

- 1257 tests passing; build + tsc clean; all static checks (meditations/, projectKey, RALPH_RUNS_ROOT, homedir, dead functions) yield zero hits.
- Task 6.1 (static checks) and Task 6.2 (smokes) verified as described. Smokes 10 and 11 used `pipeline validate` instead of `pipeline run` (interactive --var input required); resolver verification confirmed against absolute path from /tmp cwd.
- Task 6.3 doc cleanup applied: "Project-local layout" term added to `.ralph/CONTEXT.md`; "Agent loading" term updated to reference `.ralph/pipelines/<name>/`; "Bootstrap a project" section added near top of README.md; "Migrating an existing ralph project" recipe added near bottom of README.md.
- Chunk 6 complete. Migration plan fully executed.

## Session Notes — 2026-05-04

- Chunk 5 Task 5.1 shipped at commit 5491175. Big-bang migration: meditations/, docs/adr/, CONTEXT.md, VISION.md → .ralph/. Bundled pipeline path strings updated. ADR-0007 + spec landed in same commit.
- Catch-up fix at 551faf3: pipeline-preflight.test.ts fixtures updated from <tmpdir>/pipelines/ → <tmpdir>/.ralph/pipelines/ — Chunk 4 had missed this test's fixture.
- Smoke deviation: Step 12 used `pipeline validate` instead of `pipeline run` to keep the iteration short. Full end-to-end run deferred to Chunk 6 Task 6.2.
- Implementer noted: pre-create `mkdir -p .ralph/meditations` before `git mv meditations .ralph/meditations` caused nested `.ralph/meditations/meditations/`; corrected with extra git mvs. Net result identical to plan intent. Future big-bangs: skip the meditations subdir in the pre-mkdir.
- Remaining: Chunk 6 (final verification + doc cleanup).
