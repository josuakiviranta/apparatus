---
status: pending
illumination_source: 2026-04-14T0800-plans-have-no-lifecycle.md
---

# Plans Have No Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mirror the illumination state machine onto `docs/superpowers/plans/` with a binary `pending` / `implemented` lifecycle, surfaced via two new MCP tools and a one-time backfill, plus prompt/rubric edits so future pipeline-produced plans ship with the frontmatter.

**Architecture:** Three-chunk shape. Chunk 1 adds three exported helpers (`parsePlanDescription`, `listPlans`, `markPlanImplemented`) plus their `server.tool()` registrations to `src/cli/mcp/illumination-server.ts`, fully exercised by Vitest in `src/cli/tests/illumination-server.test.ts` (TDD red→green→commit per case). Chunk 2 is a one-time backfill of frontmatter on all 48 files in `docs/superpowers/plans/` — every file ends up either `status: pending` or `status: implemented`, verified by a `grep -L`. Chunk 3 wires the autonomy path: one numbered step into `src/cli/agents/plan-writer.md`, one inline prompt edit on `pipelines/illumination-to-plan.dot:30`, and two tool whitelist lines on `src/cli/agents/meditate.md` (the only agent file with the `illumination` MCP server attached today).

**Tech Stack:** TypeScript (Node.js, ESM), Vitest, zod (already imported), `node:child_process` (mocked in tests via `vi.hoisted`), `@modelcontextprotocol/sdk` (deferred dynamic import — server bootstrap is already gated by `isTestEnv`).

---

## Pre-flight (run before Chunk 1)

- [ ] **Confirm clean working tree.** Run `git status -s`. Expected: empty (no uncommitted changes outside this plan file).
- [ ] **Confirm test infra works.** Run `npx vitest run src/cli/tests/illumination-server.test.ts`. Expected: all existing tests pass before any change. If they don't, stop and surface the failure — the chunks below assume green baseline.

---

## Chunk 1: MCP server — `listPlans`, `markPlanImplemented`, `parsePlanDescription`

**Files:**
- Modify: `src/cli/mcp/illumination-server.ts` (add three exported helpers + two `server.tool()` registrations)
- Modify: `src/cli/tests/illumination-server.test.ts` (extend the import line + add two new `describe` blocks)

**TDD discipline:** every test below is written first, run red, then made green by the matching implementation step. Commits at each green checkpoint. `mockExecSync` is already hoisted at the top of the test file (`illumination-server.test.ts:6-12`); reuse it as-is.

### Task 1.1: `listPlans` — empty directory returns sentinel

**Files:**
- Test: `src/cli/tests/illumination-server.test.ts`
- Modify: `src/cli/mcp/illumination-server.ts`

- [ ] **Step 1.1.1: Extend the test file's import line to include the not-yet-exported helpers.**

In `src/cli/tests/illumination-server.test.ts`, replace the existing import line at line 14:

```ts
import { validateFilename, writeIllumination, assertWithinRoot, readFile, validateGlobPattern, globFiles, projectTree, listMetaMeditations, readMetaMeditation, listIlluminations, markImplemented, markDispatched, markArchived } from "../mcp/illumination-server";
```

with:

```ts
import { validateFilename, writeIllumination, assertWithinRoot, readFile, validateGlobPattern, globFiles, projectTree, listMetaMeditations, readMetaMeditation, listIlluminations, markImplemented, markDispatched, markArchived, listPlans, markPlanImplemented } from "../mcp/illumination-server";
```

- [ ] **Step 1.1.2: Append a new `describe("listPlans", ...)` block to the end of the test file.**

Append at the very bottom of `src/cli/tests/illumination-server.test.ts` (after the existing closing `});` of the last describe):

```ts
describe("listPlans", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = realpathSync(mkdtempSync(join(tmpdir(), "ralph-plan-test-")));
    mkdirSync(join(tmpDir, "docs", "superpowers", "plans"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function writePlanFile(filename: string, frontmatter: string | null, body: string) {
    const fm = frontmatter === null ? "" : `---\n${frontmatter}\n---\n`;
    writeFileSync(join(tmpDir, "docs", "superpowers", "plans", filename), fm + body);
  }

  it("returns sentinel when directory is empty", () => {
    expect(listPlans(tmpDir)).toBe("No plans found.");
  });
});
```

- [ ] **Step 1.1.3: Run the test — expect FAIL on the missing import.**

Run: `npx vitest run src/cli/tests/illumination-server.test.ts -t "listPlans"`

Expected: TypeScript / module resolution fails because `listPlans` is not exported. Acceptable failure modes: `SyntaxError: The requested module '../mcp/illumination-server' does not provide an export named 'listPlans'`.

- [ ] **Step 1.1.4: Add `parsePlanDescription` and `listPlans` to `illumination-server.ts`.**

In `src/cli/mcp/illumination-server.ts`, insert the following block immediately after the existing `listIlluminations` function (after the closing brace at the end of the function whose declaration starts on line 312):

```ts
const NO_PLANS_MESSAGE = "No plans found.";

export function parsePlanDescription(filePath: string): string {
  try {
    const content = readFileSync(filePath, "utf8");
    let body = content;
    if (content.startsWith("---\n")) {
      const end = content.indexOf("\n---\n", 4);
      if (end === -1) return "(no description)";
      body = content.slice(end + 5);
    }
    const match = body.match(/^#\s+(.+)$/m);
    return match ? match[1].trim() : "(no description)";
  } catch {
    return "(no description)";
  }
}

export function listPlans(projectRoot: string, status?: string): string {
  const dir = join(projectRoot, "docs", "superpowers", "plans");
  try {
    let files = readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .sort();
    if (status) {
      files = files.filter((f) => {
        const content = readFileSync(join(dir, f), "utf-8");
        const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
        if (!fmMatch) return false;
        const statusMatch = fmMatch[1].match(/^status:\s*(.+)$/m);
        const fileStatus = statusMatch ? statusMatch[1].trim() : null;
        return fileStatus === status;
      });
    }
    if (files.length === 0) return NO_PLANS_MESSAGE;
    return files
      .map((f) => `${f} — ${parsePlanDescription(join(dir, f))}`)
      .join("\n");
  } catch {
    return NO_PLANS_MESSAGE;
  }
}
```

- [ ] **Step 1.1.5: Re-run the empty-directory test — expect PASS.**

Run: `npx vitest run src/cli/tests/illumination-server.test.ts -t "listPlans"`

Expected: 1 passed (`returns sentinel when directory is empty`).

- [ ] **Step 1.1.6: Commit.**

```bash
git add src/cli/mcp/illumination-server.ts src/cli/tests/illumination-server.test.ts
git commit -m "feat(mcp): listPlans + parsePlanDescription with empty-dir test"
```

### Task 1.2: `listPlans` — three-fixture filter cases

**Files:**
- Modify: `src/cli/tests/illumination-server.test.ts`

The implementation already covers these. We are adding test coverage for the four filter behaviors (`pending` only, `implemented` only, no-frontmatter exclusion, no-filter all-three).

- [ ] **Step 1.2.1: Add four assertions inside the existing `describe("listPlans", ...)` block.**

Insert after the existing `it("returns sentinel when directory is empty", ...)` test, before the closing `});` of the describe:

```ts
  it("filter=pending returns only pending files", () => {
    writePlanFile("a-pending.md", "status: pending", "# Plan A\n");
    writePlanFile("b-implemented.md", "status: implemented", "# Plan B\n");
    writePlanFile("c-no-fm.md", null, "# Plan C\n");
    const result = listPlans(tmpDir, "pending");
    expect(result).toBe("a-pending.md — Plan A");
  });

  it("filter=implemented returns only implemented files", () => {
    writePlanFile("a-pending.md", "status: pending", "# Plan A\n");
    writePlanFile("b-implemented.md", "status: implemented", "# Plan B\n");
    writePlanFile("c-no-fm.md", null, "# Plan C\n");
    const result = listPlans(tmpDir, "implemented");
    expect(result).toBe("b-implemented.md — Plan B");
  });

  it("filter excludes no-frontmatter files from any status", () => {
    writePlanFile("c-no-fm.md", null, "# Plan C\n");
    expect(listPlans(tmpDir, "pending")).toBe("No plans found.");
    expect(listPlans(tmpDir, "implemented")).toBe("No plans found.");
  });

  it("no filter returns all files including no-frontmatter", () => {
    writePlanFile("a-pending.md", "status: pending", "# Plan A\n");
    writePlanFile("b-implemented.md", "status: implemented", "# Plan B\n");
    writePlanFile("c-no-fm.md", null, "# Plan C\n");
    const result = listPlans(tmpDir);
    expect(result).toBe(
      "a-pending.md — Plan A\nb-implemented.md — Plan B\nc-no-fm.md — Plan C",
    );
  });

  it("falls back to (no description) when body has no H1", () => {
    writePlanFile("d-no-h1.md", "status: pending", "Body without heading\n");
    const result = listPlans(tmpDir);
    expect(result).toBe("d-no-h1.md — (no description)");
  });
```

- [ ] **Step 1.2.2: Run all `listPlans` tests — expect PASS.**

Run: `npx vitest run src/cli/tests/illumination-server.test.ts -t "listPlans"`

Expected: 6 passed.

- [ ] **Step 1.2.3: Commit.**

```bash
git add src/cli/tests/illumination-server.test.ts
git commit -m "test(mcp): listPlans filter + description fallback cases"
```

### Task 1.3: `markPlanImplemented` — happy path (pending → implemented + auto-commit)

**Files:**
- Modify: `src/cli/tests/illumination-server.test.ts`
- Modify: `src/cli/mcp/illumination-server.ts`

- [ ] **Step 1.3.1: Append a new `describe("markPlanImplemented", ...)` block to the test file.**

Append at the very bottom of `src/cli/tests/illumination-server.test.ts`:

```ts
describe("markPlanImplemented", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = realpathSync(mkdtempSync(join(tmpdir(), "ralph-plan-impl-")));
    mkdirSync(join(tmpDir, "docs", "superpowers", "plans"), { recursive: true });
    mockExecSync.mockReset();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function writePlanFile(filename: string, frontmatter: string | null, body: string) {
    const fm = frontmatter === null ? "" : `---\n${frontmatter}\n---\n`;
    writeFileSync(join(tmpDir, "docs", "superpowers", "plans", filename), fm + body);
  }

  it("transitions pending to implemented and rewrites frontmatter", () => {
    writePlanFile(
      "2026-04-12-meditate-backpressure-guard.md",
      "status: pending\nillumination_source: 2026-04-12T0900-foo.md",
      "# Backpressure plan\n\nBody.\n",
    );
    const result = markPlanImplemented(tmpDir, "2026-04-12-meditate-backpressure-guard.md");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.previous_status).toBe("pending");
      expect(result.new_status).toBe("implemented");
      expect(result.plan_filename).toBe("2026-04-12-meditate-backpressure-guard.md");
    }
    const written = readFileSync(
      join(tmpDir, "docs", "superpowers", "plans", "2026-04-12-meditate-backpressure-guard.md"),
      "utf-8",
    );
    expect(written).toMatch(/status: implemented/);
    expect(written).not.toMatch(/status: pending/);
    expect(written).toMatch(/illumination_source: 2026-04-12T0900-foo\.md/);
    expect(written).toContain("# Backpressure plan");
    expect(written).toContain("Body.");
  });

  it("auto-commits with git add + commit (mirroring markDispatched)", () => {
    writePlanFile(
      "T-commit.md",
      "status: pending",
      "# Commit test\n",
    );
    const result = markPlanImplemented(tmpDir, "T-commit.md");
    expect(result.success).toBe(true);
    expect(mockExecSync).toHaveBeenCalledTimes(2);
    const addCall = mockExecSync.mock.calls[0][0] as string;
    const commitCall = mockExecSync.mock.calls[1][0] as string;
    expect(addCall).toContain("git -C");
    expect(addCall).toContain(tmpDir);
    expect(addCall).toContain("add");
    expect(addCall).toContain("T-commit.md");
    expect(commitCall).toContain("commit");
    expect(commitCall).toContain("meditate: mark plan T-commit.md implemented");
  });
});
```

- [ ] **Step 1.3.2: Run the new tests — expect FAIL on missing export.**

Run: `npx vitest run src/cli/tests/illumination-server.test.ts -t "markPlanImplemented"`

Expected: module-resolution failure on `markPlanImplemented` import.

- [ ] **Step 1.3.3: Add `markPlanImplemented` to `illumination-server.ts`.**

In `src/cli/mcp/illumination-server.ts`, insert immediately after the `listPlans` function added in Task 1.1.4:

```ts
export function markPlanImplemented(
  projectRoot: string,
  planFilename: string,
):
  | { success: true; plan_filename: string; previous_status: string; new_status: string }
  | { success: false; error: string } {
  const fnErr = validateFilename(planFilename);
  if (fnErr) return { success: false, error: fnErr };

  const planDir = join(projectRoot, "docs", "superpowers", "plans");
  const filePath = join(planDir, planFilename);

  if (!existsSync(filePath)) {
    return { success: false, error: `Plan file not found: ${planFilename}` };
  }

  const raw = readFileSync(filePath, "utf-8");
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n/);
  if (!fmMatch) {
    return { success: false, error: "No frontmatter found in plan file" };
  }

  const fmBlock = fmMatch[1];
  const body = raw.slice(fmMatch[0].length);

  const statusMatch = fmBlock.match(/^status:\s*(.+)$/m);
  const currentStatus = statusMatch ? statusMatch[1].trim() : null;

  if (currentStatus !== "pending") {
    return {
      success: false,
      error: `Cannot mark as implemented: current status is ${currentStatus ?? "(missing)"}`,
    };
  }

  const updatedFm = fmBlock.replace(/^status:\s*.+$/m, "status: implemented");
  const updatedContent = `---\n${updatedFm}\n---\n${body}`;
  writeFileSync(filePath, updatedContent);

  try {
    execSync(`git -C "${projectRoot}" add "${filePath}"`, { stdio: "ignore" });
    execSync(
      `git -C "${projectRoot}" commit -m "meditate: mark plan ${planFilename} implemented"`,
      { stdio: "ignore" },
    );
  } catch {
    // git not available, not a git repo, or nothing to commit (idempotent re-run).
  }

  return {
    success: true,
    plan_filename: planFilename,
    previous_status: currentStatus,
    new_status: "implemented",
  };
}
```

- [ ] **Step 1.3.4: Re-run — expect PASS on both happy-path tests.**

Run: `npx vitest run src/cli/tests/illumination-server.test.ts -t "markPlanImplemented"`

Expected: 2 passed.

- [ ] **Step 1.3.5: Commit.**

```bash
git add src/cli/mcp/illumination-server.ts src/cli/tests/illumination-server.test.ts
git commit -m "feat(mcp): markPlanImplemented happy path + auto-commit"
```

### Task 1.4: `markPlanImplemented` — error cases

**Files:**
- Modify: `src/cli/tests/illumination-server.test.ts`

Implementation already handles these (see Task 1.3.3 — guard clauses for invalid filename, missing file, missing frontmatter, wrong current status). Add coverage tests.

- [ ] **Step 1.4.1: Add four error-case tests inside the existing `describe("markPlanImplemented", ...)` block.**

Insert after the auto-commit test, before the closing `});` of the describe:

```ts
  it("rejects already-implemented plan", () => {
    writePlanFile("T-already-impl.md", "status: implemented", "# Done\n");
    const result = markPlanImplemented(tmpDir, "T-already-impl.md");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("implemented");
    }
  });

  it("rejects plan with no frontmatter", () => {
    writePlanFile("T-no-fm.md", null, "# Bare\n");
    const result = markPlanImplemented(tmpDir, "T-no-fm.md");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("No frontmatter found in plan file");
    }
  });

  it("rejects missing file", () => {
    const result = markPlanImplemented(tmpDir, "T-nonexistent.md");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("Plan file not found: T-nonexistent.md");
    }
  });

  it("rejects plan with frontmatter but no status field", () => {
    writePlanFile("T-no-status.md", "illumination_source: foo.md", "# No status field\n");
    const result = markPlanImplemented(tmpDir, "T-no-status.md");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("(missing)");
    }
  });

  it("returns success even when git commands fail (fail-open)", () => {
    mockExecSync.mockImplementation(() => {
      throw new Error("git not found");
    });
    writePlanFile("T-fail-open.md", "status: pending", "# Fail open\n");
    const result = markPlanImplemented(tmpDir, "T-fail-open.md");
    expect(result.success).toBe(true);
  });

  it("rejects invalid filename via validateFilename", () => {
    const result = markPlanImplemented(tmpDir, "../escape.md");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("Invalid filename");
    }
  });
```

- [ ] **Step 1.4.2: Run — expect PASS on all six error-case tests.**

Run: `npx vitest run src/cli/tests/illumination-server.test.ts -t "markPlanImplemented"`

Expected: 8 passed total in this describe.

- [ ] **Step 1.4.3: Commit.**

```bash
git add src/cli/tests/illumination-server.test.ts
git commit -m "test(mcp): markPlanImplemented error-case coverage"
```

### Task 1.5: Register `list_plans` and `mark_plan_implemented` MCP tools

**Files:**
- Modify: `src/cli/mcp/illumination-server.ts`

The bootstrap block at the bottom of the file (gated by `if (!isTestEnv) { ... }` from line 397) does the `Promise.all([...]).then(...)` registration. Add two new `server.tool()` calls inside that block.

- [ ] **Step 1.5.1: Add the two tool registrations.**

In `src/cli/mcp/illumination-server.ts`, insert immediately after the existing `mark_archived` registration (after the closing `);` of the `server.tool("mark_archived", ...)` call near line 575) and before the `process.on("SIGINT", ...)` handler:

```ts
    server.tool(
      "list_plans",
      "List implementation plans in docs/superpowers/plans/, with their H1 titles. " +
        "Optionally filter by lifecycle status (pending or implemented). " +
        "Call this to see what plans remain unimplemented.",
      {
        status: z.enum(["pending", "implemented"]).optional(),
      },
      async ({ status }: { status?: string }) => {
        const result = listPlans(projectRoot, status);
        return { content: [{ type: "text" as const, text: result }] };
      },
    );

    server.tool(
      "mark_plan_implemented",
      "Mark a plan as implemented. Valid only from status pending. " +
        "Auto-commits the frontmatter change. Call this when the plan's feature has shipped.",
      {
        plan_filename: z.string(),
      },
      async ({ plan_filename }: { plan_filename: string }) => {
        const result = markPlanImplemented(projectRoot, plan_filename);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      },
    );
```

- [ ] **Step 1.5.2: Type-check the file.**

Run: `npx tsc --noEmit -p tsconfig.json`

Expected: no errors. (`listPlans` and `markPlanImplemented` were exported in Tasks 1.1 / 1.3; `z` is already destructured in the dynamic-import callback at line 424.)

- [ ] **Step 1.5.3: Run the full illumination-server test file.**

Run: `npx vitest run src/cli/tests/illumination-server.test.ts`

Expected: full file green — pre-existing tests + 6 listPlans + 8 markPlanImplemented = no regressions.

- [ ] **Step 1.5.4: Commit.**

```bash
git add src/cli/mcp/illumination-server.ts
git commit -m "feat(mcp): register list_plans and mark_plan_implemented tools"
```

## Verification targets

- Smokes: None
- Scenario tests: None
- Manual exercises: `node dist/cli/mcp/illumination-server.js .` — confirm tool list now contains `list_plans` and `mark_plan_implemented` (build first via `npm run build`).
- Lint: `npx vitest run src/cli/tests/illumination-server.test.ts` and `npx tsc --noEmit -p tsconfig.json`
- Surfaces touched: `mcp.illumination-server`, `tests.illumination-server`

---

## Chunk 2: Backfill plan frontmatter (48 files)

**Files:**
- Modify: 48 files in `docs/superpowers/plans/*.md` (one of which — `2026-04-25-plans-have-no-lifecycle.md` — is THIS plan and is excluded from the backfill, since it already has the correct frontmatter).
- Note: `2026-04-17-pipeline-script-files.md` already carries frontmatter (`status: proposed`); the backfill rewrites the `status:` line to `implemented` and leaves the other fields (`date`, `design_doc`, `execution_style`) untouched.

**Acceptance bar:** zero unstamped files, zero stale `open` files, zero `pending` files whose feature has shipped, zero `implemented` files whose feature is missing. Verified by `find` + `grep` commands at the end of the chunk.

### Status assignment table

| Filename | Status | Evidence anchor |
|---|---|---|
| 2026-04-03-ralph-new-command.md | implemented | `src/cli/commands/new.ts` |
| 2026-04-10-interactive-ink-overlay.md | implemented | `onInteractiveRequest` at `src/attractor/handlers/agent-handler.ts` |
| 2026-04-12-headless-governance-gates.md | pending | no headless gate routing in engine |
| 2026-04-12-illumination-auto-commit.md | implemented | `writeIllumination` commits at `src/cli/mcp/illumination-server.ts:33-42` |
| 2026-04-12-illumination-state-machine.md | implemented | `markImplemented` at `src/cli/mcp/illumination-server.ts:46` |
| 2026-04-12-mark-implemented-lifecycle.md | implemented | same as above |
| 2026-04-12-meditate-backpressure-guard.md | pending | no `countIlluminations` / `--force` in `src/cli/commands/meditate.ts` |
| 2026-04-12-meditate-tool-whitelist-gap.md | implemented | `mcp__illumination__list_illuminations` in `src/cli/agents/meditate.md` whitelist |
| 2026-04-12-top-level-directory-inventory.md | implemented | `meditations/inventory.md` exists |
| 2026-04-12-top-level-directory-map.md | pending | top-level `tsx-501/` and assorted unmoved scratch dirs still present |
| 2026-04-13-path1-structured-interactive-handoff.md | implemented | `src/cli/lib/session.ts` + `agent.runInteractive` |
| 2026-04-13-undefined-variable-backpressure-guard.md | implemented | `UndefinedVariableError` at `src/attractor/transforms/variable-expansion.ts` |
| 2026-04-14-handler-context-registry-dedup.md | implemented | `src/attractor/handlers/registry.ts` |
| 2026-04-14-ink-native-gate-prompt.md | implemented | `src/cli/components/GateSelector.tsx` |
| 2026-04-14-livefooter-stable-height.md | implemented | `src/cli/components/LiveFooter.tsx` |
| 2026-04-14-mcp-gitignore-pattern-fix.md | implemented | `MCP_CONFIG_GLOB` in `src/cli/lib/agent.ts` |
| 2026-04-14-meditate-steer-flag.md | implemented | `Agent.run` `message` option + steer wired in `meditate.ts` |
| 2026-04-14-pipeline-ctrlc-kill.md | implemented | SIGINT handler in `src/cli/lib/agent.ts` |
| 2026-04-14-pipeline-renderer-redesign.md | implemented | single-`Static` PipelineApp.tsx |
| 2026-04-14-pipeline-static-streaming.md | implemented | Static block + integration test |
| 2026-04-14-pipeline-tui-flicker-fix.md | implemented | grow-only static items in PipelineApp.tsx |
| 2026-04-14-portable-pipeline-schema-resolution.md | implemented | `json_schema_file` resolves relative to `dotDir` in `agent-handler.ts` |
| 2026-04-14-store-node-handler.md | implemented | `src/attractor/handlers/store.ts` |
| 2026-04-14-tmux-drive-harness.md | implemented | `docs/harness/tmux-drive.md` |
| 2026-04-15-pipeline-agent-stream-output.md | implemented | `stream-line` NodeEvent at `src/cli/lib/pipelineEvents.ts` |
| 2026-04-16-implement-as-pipeline.md | implemented | `src/cli/pipelines/implement.dot` |
| 2026-04-16-markdown-rendering.md | implemented | `renderMarkdown` at `src/cli/lib/render-markdown.ts` |
| 2026-04-16-pipeline-context-observability.md | implemented | `src/attractor/tracer/jsonl-pipeline-tracer.ts` |
| 2026-04-16-pipeline-portability.md | implemented | `pipelines/illumination-to-implementation.dot` |
| 2026-04-16-pipeline-refine-command.md | implemented | `pipelineRefineCommand` at `src/cli/commands/pipeline.ts` |
| 2026-04-16-preflight-variable-check.md | implemented | `scanUndeclaredCallerVars` at `src/cli/commands/pipeline.ts` |
| 2026-04-17-pipeline-script-files.md | implemented | `scriptFile` schema at `src/attractor/core/schemas.ts` |
| 2026-04-17-refine-authoring-loop.md | implemented | `pipelineRefineCommand` wired |
| 2026-04-17-refine-run-history-and-failure-tip.md | implemented | `printRefineTip` at `src/cli/commands/pipeline.ts` |
| 2026-04-18-implement-retry-tmux-context.md | pending | `implement_retry` node absent in `pipelines/illumination-to-implementation.dot` |
| 2026-04-18-pipeline-commands-spec-backfill.md | implemented | exit-codes section in `specs/commands.md` |
| 2026-04-18-pipeline-validator-trust-upgrade.md | implemented | zod schemas at `src/attractor/core/schemas.ts` |
| 2026-04-19-fenced-code-block-var-skip.md | implemented | `splitFences` at `src/attractor/transforms/variable-expansion.ts` |
| 2026-04-19-gate-choice-namespacing.md | implemented | `nodeId.choice` contextUpdate in `handlers/wait-human.ts` |
| 2026-04-19-gate-validator-producer-declaration.md | implemented | `wait.human` produces `choice` in `src/attractor/core/graph.ts` |
| 2026-04-19-mark-archived-reason-split.md | implemented | `archive_reason_short` wired in `pipelines/illumination-to-implementation.dot` |
| 2026-04-20-dot-parser-ast-migration.md | implemented | `parseDotV2` |
| 2026-04-20-mark-archived-spec-drift.md | implemented | `archive_reason_short` in `pipelines/schemas/verifier.json` |
| 2026-04-20-schema-description-overrides-agent-rubric.md | implemented | `pipeline-schema-descriptions.test.ts` + ALLOW_LIST |
| 2026-04-20-source-location-diagnostics.md | implemented | `sourceLocation` in `src/attractor/types.ts` + diagnostics |
| 2026-04-20-validator-and-runtime-disagree-on-defaults.md | implemented | tests pin `default_<varname>` parity |
| 2026-04-22-agent-rubric-prepend.md | implemented | `src/cli/agents/task.md` + rubric-prepend in agent-handler |
| 2026-04-25-state-machine-exists-verifier-ignores-it.md | pending | just-landed design; plan in flight |

Counts: 5 pending, 43 implemented. (Total 48; this plan file itself counts as the 49th — it carries `status: pending` from creation and is not part of the backfill set since it sits at the same row but with frontmatter pre-applied. The counts above describe the 48 _backfill targets_.)

### Task 2.1: Author the backfill script

**Files:**
- Create: `scripts/backfill-plan-frontmatter.sh` (one-shot script — committed alongside the result so the diff is auditable; the script itself can stay for future manual checks but is not wired into CI)

- [ ] **Step 2.1.1: Write the script.**

Create `scripts/backfill-plan-frontmatter.sh` with the following content:

```bash
#!/usr/bin/env bash
# One-shot backfill: prepend status frontmatter to every file in
# docs/superpowers/plans/. Idempotent — files that already carry a
# `status: pending` or `status: implemented` frontmatter are skipped.
# Files with `status: proposed` (legacy) have ONLY their status line
# rewritten to `implemented`; other frontmatter fields are preserved.

set -euo pipefail

PLANS_DIR="docs/superpowers/plans"

# status assignment: pending|implemented per file
declare -A STATUS=(
  [2026-04-03-ralph-new-command.md]=implemented
  [2026-04-10-interactive-ink-overlay.md]=implemented
  [2026-04-12-headless-governance-gates.md]=pending
  [2026-04-12-illumination-auto-commit.md]=implemented
  [2026-04-12-illumination-state-machine.md]=implemented
  [2026-04-12-mark-implemented-lifecycle.md]=implemented
  [2026-04-12-meditate-backpressure-guard.md]=pending
  [2026-04-12-meditate-tool-whitelist-gap.md]=implemented
  [2026-04-12-top-level-directory-inventory.md]=implemented
  [2026-04-12-top-level-directory-map.md]=pending
  [2026-04-13-path1-structured-interactive-handoff.md]=implemented
  [2026-04-13-undefined-variable-backpressure-guard.md]=implemented
  [2026-04-14-handler-context-registry-dedup.md]=implemented
  [2026-04-14-ink-native-gate-prompt.md]=implemented
  [2026-04-14-livefooter-stable-height.md]=implemented
  [2026-04-14-mcp-gitignore-pattern-fix.md]=implemented
  [2026-04-14-meditate-steer-flag.md]=implemented
  [2026-04-14-pipeline-ctrlc-kill.md]=implemented
  [2026-04-14-pipeline-renderer-redesign.md]=implemented
  [2026-04-14-pipeline-static-streaming.md]=implemented
  [2026-04-14-pipeline-tui-flicker-fix.md]=implemented
  [2026-04-14-portable-pipeline-schema-resolution.md]=implemented
  [2026-04-14-store-node-handler.md]=implemented
  [2026-04-14-tmux-drive-harness.md]=implemented
  [2026-04-15-pipeline-agent-stream-output.md]=implemented
  [2026-04-16-implement-as-pipeline.md]=implemented
  [2026-04-16-markdown-rendering.md]=implemented
  [2026-04-16-pipeline-context-observability.md]=implemented
  [2026-04-16-pipeline-portability.md]=implemented
  [2026-04-16-pipeline-refine-command.md]=implemented
  [2026-04-16-preflight-variable-check.md]=implemented
  [2026-04-17-pipeline-script-files.md]=implemented
  [2026-04-17-refine-authoring-loop.md]=implemented
  [2026-04-17-refine-run-history-and-failure-tip.md]=implemented
  [2026-04-18-implement-retry-tmux-context.md]=pending
  [2026-04-18-pipeline-commands-spec-backfill.md]=implemented
  [2026-04-18-pipeline-validator-trust-upgrade.md]=implemented
  [2026-04-19-fenced-code-block-var-skip.md]=implemented
  [2026-04-19-gate-choice-namespacing.md]=implemented
  [2026-04-19-gate-validator-producer-declaration.md]=implemented
  [2026-04-19-mark-archived-reason-split.md]=implemented
  [2026-04-20-dot-parser-ast-migration.md]=implemented
  [2026-04-20-mark-archived-spec-drift.md]=implemented
  [2026-04-20-schema-description-overrides-agent-rubric.md]=implemented
  [2026-04-20-source-location-diagnostics.md]=implemented
  [2026-04-20-validator-and-runtime-disagree-on-defaults.md]=implemented
  [2026-04-22-agent-rubric-prepend.md]=implemented
  [2026-04-25-state-machine-exists-verifier-ignores-it.md]=pending
)

for filename in "${!STATUS[@]}"; do
  status="${STATUS[$filename]}"
  path="${PLANS_DIR}/${filename}"
  if [[ ! -f "$path" ]]; then
    echo "MISS: $path not found — table out of sync with filesystem" >&2
    exit 1
  fi
  first_line="$(head -n1 "$path")"
  if [[ "$first_line" == "---" ]]; then
    # Existing frontmatter: rewrite the status line in place.
    if grep -qE '^status: (pending|implemented)$' "$path"; then
      # Already correctly stamped — but verify it matches the assigned status.
      current="$(grep -E '^status: (pending|implemented|proposed|open)$' "$path" | head -n1 | awk '{print $2}')"
      if [[ "$current" != "$status" ]]; then
        # Rewrite mismatched stamp (e.g., `proposed` → `implemented`).
        # Use awk for portability across macOS/Linux sed differences.
        tmp="$(mktemp)"
        awk -v want="$status" '
          BEGIN { in_fm=0; rewritten=0 }
          NR==1 && $0=="---" { in_fm=1; print; next }
          in_fm && $0=="---" { in_fm=0; print; next }
          in_fm && /^status:/ && !rewritten { print "status: " want; rewritten=1; next }
          { print }
        ' "$path" > "$tmp"
        mv "$tmp" "$path"
        echo "REWROTE: $filename (status: $current → $status)"
      else
        echo "SKIP:    $filename (already status: $status)"
      fi
    else
      # Frontmatter exists but no recognized status line — insert one.
      tmp="$(mktemp)"
      awk -v want="$status" '
        BEGIN { in_fm=0; inserted=0 }
        NR==1 && $0=="---" { in_fm=1; print; print "status: " want; inserted=1; next }
        in_fm && $0=="---" { in_fm=0; print; next }
        { print }
      ' "$path" > "$tmp"
      mv "$tmp" "$path"
      echo "INSERTED: $filename (status: $status)"
    fi
  else
    # No frontmatter: prepend a fresh block.
    tmp="$(mktemp)"
    {
      echo "---"
      echo "status: $status"
      echo "---"
      echo
      cat "$path"
    } > "$tmp"
    mv "$tmp" "$path"
    echo "PREPENDED: $filename (status: $status)"
  fi
done
```

- [ ] **Step 2.1.2: Make the script executable.**

```bash
chmod +x scripts/backfill-plan-frontmatter.sh
```

- [ ] **Step 2.1.3: Sanity-check that the table matches the filesystem before running.**

Run:

```bash
ls docs/superpowers/plans/*.md | xargs -n1 basename | sort > /tmp/fs-plans.txt
awk '/^  \[2026-/ {gsub(/[\[\]]/,""); print $1}' scripts/backfill-plan-frontmatter.sh | sort > /tmp/script-plans.txt
diff /tmp/fs-plans.txt /tmp/script-plans.txt
```

Expected: one line of output — `2026-04-25-plans-have-no-lifecycle.md` appears in `/tmp/fs-plans.txt` only (this plan file is not in the script's STATUS table because it already carries correct frontmatter from the moment it was written). No other diff entries. If any other filename appears, the table is out of sync — fix the table before proceeding.

### Task 2.2: Run the backfill

- [ ] **Step 2.2.1: Execute the script.**

Run from repo root:

```bash
bash scripts/backfill-plan-frontmatter.sh
```

Expected output: 48 lines beginning with `PREPENDED:`, `INSERTED:`, `REWROTE:`, or `SKIP:`. No `MISS:` lines (every filename in the table must exist).

- [ ] **Step 2.2.2: Verify acceptance bar — zero unstamped files.**

Run:

```bash
find docs/superpowers/plans -maxdepth 1 -name '*.md' \! -name 'README.md' | xargs grep -L '^status: \(pending\|implemented\)$'
```

Expected output: empty. (One line of output per offending file. An empty result means every plan now carries a `status: pending` or `status: implemented` line as the first non-`---` field of its frontmatter.)

- [ ] **Step 2.2.3: Verify acceptance bar — zero stale labels.**

Run:

```bash
grep -lE '^status: (open|proposed|complete|done)$' docs/superpowers/plans/*.md
```

Expected output: empty. (Catches any leftover legacy `proposed` / `open` / `complete` / `done` labels that the rewrite missed.)

- [ ] **Step 2.2.4: Verify the count.**

Run:

```bash
grep -lE '^status: pending$' docs/superpowers/plans/*.md | wc -l
grep -lE '^status: implemented$' docs/superpowers/plans/*.md | wc -l
ls docs/superpowers/plans/*.md | wc -l
```

Expected output: `6` then `43` then `49`. (5 pending in the table + 1 for THIS plan file = 6. Implemented count is 43. Total file count = 48 backfill targets + this plan = 49. The first two commands count files with at least one matching line; one status line per file is the contract, so files-with-match equals total-occurrences here.)

- [ ] **Step 2.2.5: Spot-check three known anchors.**

Run:

```bash
head -3 docs/superpowers/plans/2026-04-12-meditate-backpressure-guard.md
head -3 docs/superpowers/plans/2026-04-22-agent-rubric-prepend.md
head -7 docs/superpowers/plans/2026-04-17-pipeline-script-files.md
```

Expected outputs:
- `meditate-backpressure-guard.md` — `---\nstatus: pending\n---`
- `agent-rubric-prepend.md` — `---\nstatus: implemented\n---`
- `pipeline-script-files.md` — frontmatter intact with `status: implemented` (was `status: proposed`); other fields (`date`, `design_doc`, `execution_style`) preserved.

### Task 2.3: Commit the backfill

- [ ] **Step 2.3.1: Stage and commit.**

```bash
git add docs/superpowers/plans/ scripts/backfill-plan-frontmatter.sh
git commit -m "meditate: backfill plan lifecycle frontmatter"
```

- [ ] **Step 2.3.2: Verify clean tree.**

Run: `git status -s`

Expected: empty.

## Verification targets

- Smokes: None
- Scenario tests: None
- Manual exercises: After Chunk 1 has shipped, run `node dist/cli/mcp/illumination-server.js .` and call `list_plans` with `status="pending"` from a stdio-connected MCP client (or run a one-shot Node script that imports `listPlans` directly). Expected: 6 lines (5 backfill + this plan).
- Lint: `find docs/superpowers/plans -maxdepth 1 -name '*.md' | xargs grep -L '^status: \(pending\|implemented\)$'` (must be empty)
- Surfaces touched: `docs.plans-corpus`

---

## Chunk 3: Prompt + rubric + agent whitelist edits

**Files:**
- Modify: `src/cli/agents/plan-writer.md` (one numbered step inserted in the Procedure block)
- Modify: `pipelines/illumination-to-plan.dot` (line 30 — inline prompt edit)
- Modify: `src/cli/agents/meditate.md` (two new entries in the `tools:` list)
- Confirm-no-edit: `pipelines/illumination-to-implementation.dot:34` (already delegates to agent rubric — verified by Glob+Grep)

This chunk has no test file — the changes are documentation/prompt strings and a YAML frontmatter list. Verification is structural (grep + Glob asserting expected lines exist).

### Task 3.1: Insert frontmatter step into `plan-writer.md` rubric

**Files:**
- Modify: `src/cli/agents/plan-writer.md`

The current Procedure block has six numbered items (lines 30, 36, 38, 40, 60, 66 in the file as it stands after the prepend-rubric work shipped in v0.1.32). Insert a new step _between current step 3 (Invoke the writing-plans skill) and current step 4 (Structure the plan as chunks)_, renumbering subsequent steps.

- [ ] **Step 3.1.1: Open the file and locate step 3 / step 4.**

Read `src/cli/agents/plan-writer.md`. Confirm:
- Step 3 starts with `3. **Invoke the writing-plans skill.**`
- Step 4 starts with `4. **Structure the plan as chunks.**`
- Step 5 starts with `5. **Run the Plan Review Loop per chunk.**`
- Step 6 starts with `6. **Emit structured JSON**`

- [ ] **Step 3.1.2: Edit — insert new step 4 and renumber 4→5, 5→6, 6→7.**

In `src/cli/agents/plan-writer.md`, replace the line beginning with `4. **Structure the plan as chunks.**` and insert before it:

```
4. **Begin the plan file with a frontmatter block.** Two fields, in this order: `status: pending` and `illumination_source: <basename of $illumination_path>` (filename only, no path). Place the block before the plan's first heading, delimited by `---` lines. The downstream `list_plans` MCP tool reads this frontmatter; omitting it makes the produced plan invisible to lifecycle queries.

5. **Structure the plan as chunks.** Each chunk:
```

Then re-number the existing steps: the block currently labelled `4.` becomes `5.`, `5.` becomes `6.`, `6.` becomes `7.`. Use Edit calls (or `sed -i ''` on macOS) to update each numeral. The exact diff hunks:

- `4. **Structure the plan as chunks.**` → `5. **Structure the plan as chunks.**`
- `5. **Run the Plan Review Loop per chunk.**` → `6. **Run the Plan Review Loop per chunk.**`
- `6. **Emit structured JSON**` → `7. **Emit structured JSON**`

- [ ] **Step 3.1.3: Verify the file structure.**

Run:

```bash
grep -nE '^[0-9]+\. \*\*' src/cli/agents/plan-writer.md
```

Expected output (line numbers approximate):

```
30:1. **Derive the plan filename deterministically** from the illumination slug:
36:2. **Load context.**
38:3. **Invoke the writing-plans skill.**
40:4. **Begin the plan file with a frontmatter block.**
42:5. **Structure the plan as chunks.**
62:6. **Run the Plan Review Loop per chunk.**
68:7. **Emit structured JSON**
```

- [ ] **Step 3.1.4: Commit.**

```bash
git add src/cli/agents/plan-writer.md
git commit -m "docs(plan-writer): require pending+illumination_source frontmatter"
```

### Task 3.2: Inline-edit the `illumination-to-plan.dot` prompt

**Files:**
- Modify: `pipelines/illumination-to-plan.dot`

The legacy pipeline at line 30 has a self-contained prompt string that does NOT delegate to the agent rubric. Edit the prompt body in place.

- [ ] **Step 3.2.1: Locate the current prompt.**

Read `pipelines/illumination-to-plan.dot:30`. Confirm the prompt ends with the literal substring:

```
Follow the conventions of existing plans in $plans_dir/. Include: chunks, tasks with TDD steps, exact file paths, commit messages.\n\nDo NOT modify any other project files.
```

- [ ] **Step 3.2.2: Edit — splice in the frontmatter instruction before the closing "Do NOT modify" sentence.**

Replace, inside the `plan_writer` node's `prompt=` attribute, the substring:

```
Follow the conventions of existing plans in $plans_dir/. Include: chunks, tasks with TDD steps, exact file paths, commit messages.\n\nDo NOT modify any other project files.
```

with:

```
Follow the conventions of existing plans in $plans_dir/. Include: chunks, tasks with TDD steps, exact file paths, commit messages.\n\nBegin the plan file with a frontmatter block containing exactly two fields: `status: pending` and `illumination_source: <basename of $illumination_path>`. Place the frontmatter before the plan's first heading.\n\nDo NOT modify any other project files.
```

- [ ] **Step 3.2.3: Verify the .dot file still parses.**

Run:

```bash
npx ralph pipeline validate pipelines/illumination-to-plan.dot
```

Expected: validator passes (exit code 0). If `ralph` is not on PATH, use `node dist/cli/index.js pipeline validate pipelines/illumination-to-plan.dot` (build first via `npm run build` if dist is stale).

- [ ] **Step 3.2.4: Commit.**

```bash
git add pipelines/illumination-to-plan.dot
git commit -m "feat(pipeline): plan_writer emits pending+illumination_source frontmatter"
```

### Task 3.3: Confirm `illumination-to-implementation.dot:34` needs no edit

**Files:**
- Glob/Grep only — no edits.

- [ ] **Step 3.3.1: Verify line 34 still delegates to agent rubric.**

Run:

```bash
grep -n "Follow your agent-level procedure" pipelines/illumination-to-implementation.dot
```

Expected: one match on line 34, inside the `plan_writer` node's `prompt=` attribute. The phrase "Follow your agent-level procedure" confirms the pipeline defers to the rubric in `src/cli/agents/plan-writer.md` — the Task 3.1 edit covers it transitively.

- [ ] **Step 3.3.2: Glob for any third pipeline owning a plan-writing prompt.**

Run:

```bash
grep -lE '(plan_writer\s*\[|plan-writer)' pipelines/*.dot src/cli/pipelines/*.dot 2>/dev/null
```

Expected: only `pipelines/illumination-to-plan.dot` and `pipelines/illumination-to-implementation.dot` (plus any `src/cli/pipelines/` mirrors that ship as bundled assets — those are copies of the same two files; verify by `diff`). If a third pipeline appears, repeat Task 3.2's inline-edit pattern on it. Otherwise, no action.

### Task 3.4: Whitelist `list_plans` and `mark_plan_implemented` on `meditate.md`

**Files:**
- Modify: `src/cli/agents/meditate.md`

`meditate.md` is the only agent file with the `illumination` MCP server attached today (verified at lines 17-23). Per the design doc constraint ("agents that lack the `mcp:` block cannot reach the tool regardless of whitelist entry"), `meditate.md` is the sole edit target in this chunk.

- [ ] **Step 3.4.1: Read the current `tools:` list.**

Read `src/cli/agents/meditate.md` lines 1-15. Confirm the `tools:` list contains:

```
tools:
  - mcp__illumination__list_illuminations
  - mcp__illumination__read_file
  - mcp__illumination__glob_files
  - mcp__illumination__project_tree
  - mcp__illumination__write_illumination
  - mcp__illumination__mark_implemented
  - mcp__illumination__mark_dispatched
  - mcp__illumination__mark_archived
  - mcp__illumination__list_meta_meditations
  - mcp__illumination__read_meta_meditation
```

- [ ] **Step 3.4.2: Append the two new tool entries.**

Add two lines to the list, immediately after `mcp__illumination__mark_archived`:

```
  - mcp__illumination__list_plans
  - mcp__illumination__mark_plan_implemented
```

The full updated `tools:` block then reads:

```
tools:
  - mcp__illumination__list_illuminations
  - mcp__illumination__read_file
  - mcp__illumination__glob_files
  - mcp__illumination__project_tree
  - mcp__illumination__write_illumination
  - mcp__illumination__mark_implemented
  - mcp__illumination__mark_dispatched
  - mcp__illumination__mark_archived
  - mcp__illumination__list_plans
  - mcp__illumination__mark_plan_implemented
  - mcp__illumination__list_meta_meditations
  - mcp__illumination__read_meta_meditation
```

- [ ] **Step 3.4.3: Verify the YAML frontmatter still parses.**

Run:

```bash
node -e "const m=require('gray-matter');const d=m.read('src/cli/agents/meditate.md');console.log(d.data.tools.length);"
```

Expected: `12` (was 10, plus the two added entries).

If `gray-matter` is not directly importable from a one-liner (ESM project), use a Vitest-style assertion instead:

```bash
npx vitest run src/cli/tests/agent-registry.test.ts
```

Expected: existing agent-registry tests still pass — they enumerate agent files and parse frontmatter.

- [ ] **Step 3.4.4: Commit.**

```bash
git add src/cli/agents/meditate.md
git commit -m "feat(agents): meditate gains list_plans + mark_plan_implemented whitelist"
```

### Task 3.5: Final integration verification

- [ ] **Step 3.5.1: Run the full unit-test suite.**

Run:

```bash
npx vitest run
```

Expected: all tests green. The only behavioral additions are the new helpers covered in Chunk 1 — no existing tests should regress.

- [ ] **Step 3.5.2: Type-check.**

Run:

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: no errors.

- [ ] **Step 3.5.3: Build.**

Run:

```bash
npm run build
```

Expected: build artifacts written under `dist/`. The `dist/cli/mcp/illumination-server.js` should now expose the two new tool registrations.

- [ ] **Step 3.5.4: Smoke check via direct stdio call (optional but recommended).**

Pipe a single `tools/list` request to the bundled server:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | node dist/cli/mcp/illumination-server.js .
```

Expected: response JSON includes a `tools` array containing entries with names `list_plans` and `mark_plan_implemented`.

- [ ] **Step 3.5.5: Auto-flip THIS plan to implemented (closing the loop).**

The implementing agent's last action — once Chunks 1-3 are all green and committed — is to call the new tool on this plan:

```bash
# Equivalent of: agent calls mcp__illumination__mark_plan_implemented(plan_filename="2026-04-25-plans-have-no-lifecycle.md")
node -e "
import('./dist/cli/mcp/illumination-server.js').then(m => {
  const r = m.markPlanImplemented(process.cwd(), '2026-04-25-plans-have-no-lifecycle.md');
  console.log(JSON.stringify(r, null, 2));
});
"
```

Expected: `{ success: true, plan_filename: "2026-04-25-plans-have-no-lifecycle.md", previous_status: "pending", new_status: "implemented" }`. The `try/catch` block auto-commits the frontmatter flip with message `meditate: mark plan 2026-04-25-plans-have-no-lifecycle.md implemented`.

Note: this `node -e` invocation calls the helper function directly — it bypasses the MCP stdio transport. Step 3.5.4 already exercises the transport-level registration via `tools/list`, so the two steps together cover both surfaces (function-level smoke + transport-level smoke).

If running through the agent harness, this same flip happens automatically when the implementing agent calls `mcp__illumination__mark_plan_implemented` after verifying its work — that is the autonomy property the design doc prescribes.

- [ ] **Step 3.5.6: Final clean-tree confirmation.**

```bash
git status -s
git log --oneline -10
```

Expected: empty status; the last 10 commits show the chunk progression (`feat(mcp): listPlans...`, `test(mcp): listPlans filter...`, `feat(mcp): markPlanImplemented happy path...`, `test(mcp): markPlanImplemented error...`, `feat(mcp): register list_plans...`, `meditate: backfill plan lifecycle frontmatter`, `docs(plan-writer): require pending+illumination_source...`, `feat(pipeline): plan_writer emits pending...`, `feat(agents): meditate gains list_plans...`, `meditate: mark plan 2026-04-25-plans-have-no-lifecycle.md implemented`).

## Verification targets

- Smokes: None (no smoke pipeline exercises the lifecycle flip end-to-end yet; the design doc's "no engine change" constraint means the existing smoke set covers everything else)
- Scenario tests: None
- Manual exercises:
  - From a Claude session with `meditate.md` agent: call `mcp__illumination__list_plans` with `status="pending"` — expect 5 entries (after this plan's own auto-flip in Step 3.5.5, the count drops to 4 with this plan removed from the pending set).
  - From the same session: call `mcp__illumination__mark_plan_implemented` with `plan_filename` set to one of the listed pending plans (after a verifier confirms the feature has shipped) — expect `success: true` and a new commit on `git log`.
- Lint: `npx vitest run` and `npx tsc --noEmit -p tsconfig.json`
- Surfaces touched: `mcp.illumination-server`, `agents.meditate`, `pipelines.illumination-to-plan`, `agents.plan-writer`

---

## Open items / disagreements with reviewer

None at write time. The provisional decisions surfaced in the design doc's Open Questions block (omit `implemented_at`; do not whitelist `plan-writer.md`) are honored verbatim in this plan. If the plan reviewer pushes back on either, this section is the place to record the disagreement and surface it to the user via the returned `plan_path`.
