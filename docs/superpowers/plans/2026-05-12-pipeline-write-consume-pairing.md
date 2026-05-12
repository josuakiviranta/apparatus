# Asymmetric Success/Failure GC of Run-Scoped Scratch Paths — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a success-gated tail GC for `.apparat/runs/<run_id>/` and `.apparat/meditations/illuminations/.triage/<run_id>/` so green runs self-clean while red runs retain debug artefacts.

**Architecture:** One new ~10-LOC helper `gcRunScopedArtefactsOnSuccess(project, runId)` exported from `src/cli/commands/pipeline/runs-gc.ts`. Called once from the existing `finally` block in `src/cli/commands/pipeline/run.ts` gated on `!pipelineFailed`. `apparat pipeline trace <runId>` gets one hint line pointing at the new ADR-0015 for the green-run miss case. README retention paragraph and ADR-0015 codify the rule. No engine change, no tracer schema change, no agent rubric change, no `.dot` schema change, no MCP tool, no validator rule.

**Tech Stack:** TypeScript, Node `fs.rmSync` with `force: true`, vitest, Commander-based CLI. Source: `src/cli/`. Tests: `src/cli/tests/`.

**Source of truth:** `docs/superpowers/specs/2026-05-12-pipeline-write-consume-pairing-design.md`.

---

## Chunk 1: GC helper + unit tests

Adds the new export to `runs-gc.ts` and ships its unit test file. No call site touched yet — this chunk is self-contained: the helper exists, is unit-tested, and the export is callable.

**Files:**
- Modify: `src/cli/commands/pipeline/runs-gc.ts`
- Create: `src/cli/tests/post-tail-gc.test.ts`

### Task 1.1: Write failing unit tests for the helper

- [x] **Step 1: Create the test file with the case list**

Create `src/cli/tests/post-tail-gc.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, existsSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { gcRunScopedArtefactsOnSuccess } from "../commands/pipeline/runs-gc.js";

describe("gcRunScopedArtefactsOnSuccess", () => {
  let project: string;
  beforeEach(() => {
    project = mkdtempSync(join(tmpdir(), "apparat-post-tail-gc-"));
  });
  afterEach(() => {
    rmSync(project, { recursive: true, force: true });
  });

  it("removes a populated .apparat/runs/<runId>/ dir", () => {
    const runId = "meditate-abc12345";
    const runDir = join(project, ".apparat", "runs", runId);
    mkdirSync(join(runDir, "some-node"), { recursive: true });
    writeFileSync(join(runDir, "pipeline.jsonl"), "{}\n");
    writeFileSync(join(runDir, "some-node", "prompt.md"), "x");

    gcRunScopedArtefactsOnSuccess(project, runId);

    expect(existsSync(runDir)).toBe(false);
  });

  it("removes a populated .triage/<runId>/ dir (chat-notes)", () => {
    const runId = "meditate-abc12345";
    const triageDir = join(project, ".apparat", "meditations", "illuminations", ".triage", runId);
    mkdirSync(triageDir, { recursive: true });
    writeFileSync(join(triageDir, "chat-notes.md"), "notes");

    gcRunScopedArtefactsOnSuccess(project, runId);

    expect(existsSync(triageDir)).toBe(false);
  });

  it("is a no-op when neither path exists (does not throw)", () => {
    expect(() => gcRunScopedArtefactsOnSuccess(project, "never-existed-xyz")).not.toThrow();
  });

  it("is a no-op for the missing path when the other exists", () => {
    const runId = "meditate-only-runs";
    const runDir = join(project, ".apparat", "runs", runId);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, "pipeline.jsonl"), "{}\n");

    expect(() => gcRunScopedArtefactsOnSuccess(project, runId)).not.toThrow();
    expect(existsSync(runDir)).toBe(false);
  });

  it("does not touch sibling runs/<otherId>/ dirs", () => {
    const targetId = "meditate-target";
    const otherId = "meditate-other";
    mkdirSync(join(project, ".apparat", "runs", targetId), { recursive: true });
    mkdirSync(join(project, ".apparat", "runs", otherId), { recursive: true });
    writeFileSync(join(project, ".apparat", "runs", otherId, "pipeline.jsonl"), "{}\n");

    gcRunScopedArtefactsOnSuccess(project, targetId);

    expect(existsSync(join(project, ".apparat", "runs", targetId))).toBe(false);
    expect(existsSync(join(project, ".apparat", "runs", otherId))).toBe(true);
  });

  it("does not touch sibling .triage/<otherId>/ dirs", () => {
    const targetId = "meditate-target";
    const otherId = "meditate-other";
    const triageRoot = join(project, ".apparat", "meditations", "illuminations", ".triage");
    mkdirSync(join(triageRoot, targetId), { recursive: true });
    mkdirSync(join(triageRoot, otherId), { recursive: true });
    writeFileSync(join(triageRoot, otherId, "chat-notes.md"), "keep");

    gcRunScopedArtefactsOnSuccess(project, targetId);

    expect(existsSync(join(triageRoot, targetId))).toBe(false);
    expect(existsSync(join(triageRoot, otherId))).toBe(true);
  });

  it("does not touch sessions/, specs/, or non-.triage illuminations siblings", () => {
    const runId = "meditate-abc12345";
    mkdirSync(join(project, ".apparat", "runs", runId), { recursive: true });
    mkdirSync(join(project, ".apparat", "sessions"), { recursive: true });
    writeFileSync(join(project, ".apparat", "sessions", "2026-05-12-x.md"), "session");
    mkdirSync(join(project, "docs", "superpowers", "specs"), { recursive: true });
    writeFileSync(join(project, "docs", "superpowers", "specs", "x-design.md"), "spec");
    mkdirSync(join(project, ".apparat", "meditations", "illuminations"), { recursive: true });
    writeFileSync(
      join(project, ".apparat", "meditations", "illuminations", "2026-05-12T0900-keep.md"),
      "illumination",
    );

    gcRunScopedArtefactsOnSuccess(project, runId);

    expect(existsSync(join(project, ".apparat", "sessions", "2026-05-12-x.md"))).toBe(true);
    expect(existsSync(join(project, "docs", "superpowers", "specs", "x-design.md"))).toBe(true);
    expect(
      existsSync(join(project, ".apparat", "meditations", "illuminations", "2026-05-12T0900-keep.md")),
    ).toBe(true);
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/cli/tests/post-tail-gc.test.ts
```

Expected: FAIL — `gcRunScopedArtefactsOnSuccess` is not exported from `../commands/pipeline/runs-gc.js`. The module imports themselves will fail at resolution.

### Task 1.2: Implement the helper

- [x] **Step 3: Add the export to `runs-gc.ts`**

Open `src/cli/commands/pipeline/runs-gc.ts`. Append this export below the existing `gcOldRunsPerPipeline` function (after the closing `}` at line 93, before the trailing `safeMtime` helper at line 95). Final file order: `resolveResumeLogsRoot` → `GcRetention` → `CRASH_BUCKET_KEY` → `gcOldRunsPerPipeline` → **new export** → `safeMtime`.

```ts
/**
 * Tail GC for two run-scoped scratch paths, fired only on a green pipeline
 * outcome (see ADR-0015 + design 2026-05-12-pipeline-write-consume-pairing).
 *
 *   <project>/.apparat/runs/<runId>/
 *   <project>/.apparat/meditations/illuminations/.triage/<runId>/
 *
 * `force: true` makes a missing path a silent no-op so pipelines that never
 * invoke chat-summarizer (no .triage/<runId>/ written) do not error here.
 */
export function gcRunScopedArtefactsOnSuccess(project: string, runId: string): void {
  const runDir = join(project, ".apparat", "runs", runId);
  const triageDir = join(project, ".apparat", "meditations", "illuminations", ".triage", runId);
  rmSync(runDir, { recursive: true, force: true });
  rmSync(triageDir, { recursive: true, force: true });
}
```

The required imports (`rmSync`, `join`) are already imported at lines 1 and 3 of the file.

- [x] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/cli/tests/post-tail-gc.test.ts
```

Expected: PASS — all 7 cases green.

- [x] **Step 5: Type-check**

```bash
npx tsc --noEmit
```

Expected: clean (no diagnostics).

- [x] **Step 6: Commit**

```bash
git add src/cli/commands/pipeline/runs-gc.ts src/cli/tests/post-tail-gc.test.ts
git commit -m "$(cat <<'EOF'
feat(gc): add gcRunScopedArtefactsOnSuccess helper for tail GC

Helper removes .apparat/runs/<runId>/ and
.apparat/meditations/illuminations/.triage/<runId>/ keyed by run_id.
force: true makes missing paths a silent no-op. Unit tests assert removal
of both paths, no-op behaviour on missing inputs, and sibling-safety for
out-of-scope folders (sessions/, specs/, illuminations/).

No call site wired yet — that lands in the next commit.

Refs: docs/superpowers/specs/2026-05-12-pipeline-write-consume-pairing-design.md
EOF
)"
```

## Verification targets

- Smokes: None
- Manual exercises: None
- Lint: `npx vitest run src/cli/tests/post-tail-gc.test.ts`; `npx tsc --noEmit`
- Surfaces touched: pipeline runner / GC module (`src/cli/commands/pipeline/runs-gc.ts`), tests

---

## Chunk 2: Wire the helper into `run.ts` finally

Adds one guarded call into the existing `finally` block of `pipelineRunCommand` after `await waitUntilExit()` and before the `if (pipelineFailed) { … process.exit(1); }` block. On green, the helper fires; on red, the existing failure footer / exit path runs unchanged.

**Files:**
- Modify: `src/cli/commands/pipeline/run.ts`
- Modify: `src/cli/tests/pipeline-runs-gc.test.ts` (add export-presence assertion)

### Task 2.1: Pin the new export's visibility in the existing GC test

- [x] **Step 1: Extend `pipeline-runs-gc.test.ts` with an export-presence case**

Open `src/cli/tests/pipeline-runs-gc.test.ts`. Append a new `describe` block after the existing one (after the closing `});` of `describe("gcOldRuns is removed in favour of gcOldRunsPerPipeline", … )` at line 13). Final file:

```ts
// Compat shim: `gcOldRuns` was replaced by `gcOldRunsPerPipeline` in
// docs/superpowers/specs/2026-05-10-runs-folder-is-an-opaque-graveyard-design.md.
// This file's per-pipeline coverage lives in runs-gc-per-pipeline.test.ts;
// here we only pin the env-var → retention plumbing the run command does.
import { describe, it, expect } from "vitest";

describe("gcOldRuns is removed in favour of gcOldRunsPerPipeline", () => {
  it("does not export the old name from the barrel", async () => {
    const mod = await import("../commands/pipeline.js") as Record<string, unknown>;
    expect(mod.gcOldRuns).toBeUndefined();
    expect(typeof mod.gcOldRunsPerPipeline).toBe("function");
  });
});

describe("gcRunScopedArtefactsOnSuccess is exported from runs-gc", () => {
  it("is callable from the module path used by run.ts", async () => {
    const mod = await import("../commands/pipeline/runs-gc.js") as Record<string, unknown>;
    expect(typeof mod.gcRunScopedArtefactsOnSuccess).toBe("function");
  });
});
```

The new helper is intentionally **not** added to the `pipeline.ts` barrel (`src/cli/commands/pipeline.ts:17`) because the only caller is `run.ts` in the same folder, and the GC export surface from the barrel was historically narrow (only `gcOldRunsPerPipeline` + `resolveResumeLogsRoot`). The test imports from the same folder-relative path the runner will use.

- [x] **Step 2: Run the test to verify it passes (helper already exists from Chunk 1)**

```bash
npx vitest run src/cli/tests/pipeline-runs-gc.test.ts
```

Expected: PASS — both `describe` blocks green.

### Task 2.2: Write the wiring test (red)

The wiring is best tested at the unit boundary because `pipelineRunCommand` spawns real pipelines. Confirm correctness by reading the diff against the design's prescribed insertion point and by the smoke check in Chunk 4. No new automated test in this task — `npx tsc --noEmit` is the regression net for the surrounding code, and the smoke in Chunk 4's manual exercises covers the end-to-end.

- [x] **Step 3: Sanity — confirm the call site is currently absent**

```bash
grep -n "gcRunScopedArtefactsOnSuccess" src/cli/commands/pipeline/run.ts
```

Expected: no output (zero matches).

### Task 2.3: Insert the guarded call

- [x] **Step 4: Add the import**

Open `src/cli/commands/pipeline/run.ts`. Find the existing `runs-gc` import (search for `gcOldRunsPerPipeline`). The line currently imports `gcOldRunsPerPipeline, resolveResumeLogsRoot` from `./runs-gc.js`. Replace it to add the new symbol:

Before (one line, currently in the import block near the top of the file):

```ts
import { gcOldRunsPerPipeline, resolveResumeLogsRoot } from "./runs-gc.js";
```

After:

```ts
import {
  gcOldRunsPerPipeline,
  gcRunScopedArtefactsOnSuccess,
  resolveResumeLogsRoot,
} from "./runs-gc.js";
```

If the existing import in your branch is split across multiple lines, just add `gcRunScopedArtefactsOnSuccess` to the destructured list — preserve the existing format. Use `grep -n "gcOldRunsPerPipeline" src/cli/commands/pipeline/run.ts` to locate the exact line.

- [x] **Step 5: Insert the guarded call in the `finally` block**

In the same file, find the `finally` block. The reference anchor is the line `await waitUntilExit();` (currently at `src/cli/commands/pipeline/run.ts:414`). Replace this region:

Before:

```ts
    done();
    await waitUntilExit();

    if (pipelineFailed) {
      if (handoff) {
        process.stderr.write(renderFailureFooter(handoff));
      }
      process.exit(1);
    }
  }
```

After:

```ts
    done();
    await waitUntilExit();

    if (!pipelineFailed) {
      gcRunScopedArtefactsOnSuccess(project, runId);
    }

    if (pipelineFailed) {
      if (handoff) {
        process.stderr.write(renderFailureFooter(handoff));
      }
      process.exit(1);
    }
  }
```

Notes on placement (per design §3.2, §4.2):
- **After** `await waitUntilExit()` — the Ink TUI has unmounted; no consumer is mid-read.
- **Before** `if (pipelineFailed) { … process.exit(1); }` — keeps control flow linear; the guard skips the GC on red anyway.
- **Synchronous** — `rmSync` blocks the event loop ≤ 5 ms for a typical run dir; no `await`, no second SIGINT-to-exit window opens.
- Both `project` and `runId` are already in scope (declared at `:228` and `:227` respectively as inputs to `runPipeline`).

- [x] **Step 6: Type-check**

```bash
npx tsc --noEmit
```

Expected: clean.

- [x] **Step 7: Run the relevant test files to confirm no regression**

```bash
npx vitest run src/cli/tests/pipeline-runs-gc.test.ts src/cli/tests/runs-gc-per-pipeline.test.ts src/cli/tests/runs-index.test.ts src/cli/tests/post-tail-gc.test.ts
```

Expected: PASS — all green. If `runs-gc-per-pipeline.test.ts` or `runs-index.test.ts` go red because they invoke a live `pipelineRunCommand` and then assert on a green-run dir being present, retarget that assertion to a pre-staged fixture (per design §4.8). The expected outcome is that these two files do **not** trigger the conditional edit because they only pre-stage run dirs and exercise `gcOldRunsPerPipeline` / `listAllRuns` directly, never the live finally path.

- [x] **Step 8: Commit**

```bash
git add src/cli/commands/pipeline/run.ts src/cli/tests/pipeline-runs-gc.test.ts
git commit -m "$(cat <<'EOF'
feat(pipeline): GC run-scoped scratch dirs on green pipeline tail

run.ts finally block now calls gcRunScopedArtefactsOnSuccess after
waitUntilExit when pipelineFailed === false. On green, .apparat/runs/<runId>/
and .apparat/meditations/illuminations/.triage/<runId>/ self-delete; on
red, both paths are preserved untouched for `pipeline trace <runId>`
and post-mortem inspection.

Refs: docs/superpowers/specs/2026-05-12-pipeline-write-consume-pairing-design.md §3.2, §4.2
EOF
)"
```

## Verification targets

- Smokes: None at this stage — the end-to-end smoke runs in Chunk 4 after the trace hint is in place
- Manual exercises: `apparat pipeline run <name> <project>` on any green pipeline → `ls <project>/.apparat/runs/` shows the runId is gone (deferred to Chunk 4 for a single combined run)
- Lint: `npx vitest run src/cli/tests/pipeline-runs-gc.test.ts src/cli/tests/runs-gc-per-pipeline.test.ts src/cli/tests/runs-index.test.ts src/cli/tests/post-tail-gc.test.ts`; `npx tsc --noEmit`
- Surfaces touched: pipeline runner (`src/cli/commands/pipeline/run.ts` finally block), GC module export surface, tests

---

## Chunk 3: `trace.ts` hint line + test coverage

Adds one stderr hint line in both missing-trace branches of `pipeline trace <runId>` so users hitting the new green-run-cleaned wall see the ADR-0015 pointer immediately.

**Files:**
- Modify: `src/cli/commands/pipeline/trace.ts`
- Modify: `src/cli/tests/pipeline-trace-command-validation.test.ts` (or whichever existing test exercises the missing-trace branch; locate by grep)

### Task 3.1: Locate the existing missing-trace test

- [x] **Step 1: Find which test asserts on the "No trace found" message**

```bash
grep -nR "No trace found" src/cli/tests/
```

Expected: at least one match in `src/cli/tests/pipeline-trace-*.test.ts`. Note the file path and the exact assertion shape (likely a `toContain("No trace found")` against captured stderr).

If **no** match exists, use `src/cli/tests/pipeline-trace-command-validation.test.ts` as the host file and add a new test case (it already exercises `pipelineTraceCommand`).

- [x] **Step 2: Read the located test to understand its capture-and-assert pattern**

Use the `Read` tool on the file from Step 1 and identify how it mocks/captures `output.error`. Reuse that pattern in Task 3.2.

### Task 3.2: Write the failing hint-line test

- [x] **Step 3: Add a test case asserting the ADR-0015 hint is emitted on a missing trace**

Add this case to the test file from Step 1 (adapt the `errors` capture to match the file's existing helper):

```ts
it("emits an ADR-0015 hint line when the trace is missing", async () => {
  const errors: string[] = [];
  const errSpy = vi.spyOn(output, "error").mockImplementation(async (msg: string) => {
    errors.push(msg);
  });
  const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`exit:${code ?? 0}`);
  }) as never);

  const tmp = mkdtempSync(join(tmpdir(), "apparat-trace-hint-"));
  try {
    await expect(pipelineTraceCommand("ghost-runid", { project: tmp })).rejects.toThrow(/exit:1/);
    expect(errors.some(l => l.includes("ADR-0015"))).toBe(true);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
    errSpy.mockRestore();
    exitSpy.mockRestore();
  }
});
```

If the host test file does not yet import `mkdtempSync`, `rmSync`, `tmpdir`, `join`, `vi`, `pipelineTraceCommand`, or the `output` namespace, add the missing imports at the top (match the import style of the file).

- [x] **Step 4: Run the test to verify it fails**

```bash
npx vitest run src/cli/tests/<host-file-from-step-1>.test.ts
```

Expected: FAIL — the new case fails because `trace.ts` does not yet emit any `ADR-0015` string.

### Task 3.3: Add the hint line

- [x] **Step 5: Edit `trace.ts` to emit the hint in both missing-trace branches**

Open `src/cli/commands/pipeline/trace.ts`. Two edits — both branches that print `No trace found for run:`.

**Edit 1:** `:13-18` (the `if (!existsSync(tracePath))` branch).

Before:

```ts
  if (!existsSync(tracePath)) {
    await output.error(`No trace found for run: ${runId}`);
    await output.error(`Expected: ${tracePath}`);
    process.exit(1);
    return;
  }
```

After:

```ts
  if (!existsSync(tracePath)) {
    await output.error(`No trace found for run: ${runId}`);
    await output.error(`Expected: ${tracePath}`);
    await output.error(`(successful runs are cleaned at tail; trace is retained only for failed runs — see ADR-0015)`);
    process.exit(1);
    return;
  }
```

**Edit 2:** `:23-28` (the `catch` on `readFileSync`).

Before:

```ts
  } catch {
    await output.error(`No trace found for run: ${runId}`);
    await output.error(`Expected: ${tracePath}`);
    process.exit(1);
    return;
  }
```

After:

```ts
  } catch {
    await output.error(`No trace found for run: ${runId}`);
    await output.error(`Expected: ${tracePath}`);
    await output.error(`(successful runs are cleaned at tail; trace is retained only for failed runs — see ADR-0015)`);
    process.exit(1);
    return;
  }
```

- [x] **Step 6: Run the test to verify it passes**

```bash
npx vitest run src/cli/tests/<host-file-from-step-1>.test.ts
```

Expected: PASS — the hint case green, all prior cases still green.

- [x] **Step 7: Type-check**

```bash
npx tsc --noEmit
```

Expected: clean.

- [x] **Step 8: Commit**

```bash
git add src/cli/commands/pipeline/trace.ts src/cli/tests/<host-file-from-step-1>.test.ts
git commit -m "$(cat <<'EOF'
feat(trace): hint at ADR-0015 when run trace is missing

`apparat pipeline trace <runId>` now emits a third stderr line —
"(successful runs are cleaned at tail; trace is retained only for failed
runs — see ADR-0015)" — alongside the existing "No trace found" /
"Expected:" lines. Pre-explains the most common new failure mode
introduced by the tail GC on green pipelines.

Refs: docs/superpowers/specs/2026-05-12-pipeline-write-consume-pairing-design.md §3.6, §4.3
EOF
)"
```

## Verification targets

- Smokes: None
- Manual exercises: `apparat pipeline trace ghost-runid` → exit 1 with three stderr lines including `ADR-0015` (deferred to Chunk 4 for the combined smoke)
- Lint: `npx vitest run src/cli/tests/pipeline-trace-command-validation.test.ts src/cli/tests/pipeline-trace-lookup.test.ts`; `npx tsc --noEmit`
- Surfaces touched: trace command (`src/cli/commands/pipeline/trace.ts`), trace command tests

---

## Chunk 4: ADR-0015 + README retention paragraph + end-to-end smoke

Ships the documentation half of the change and verifies the asymmetric rule end-to-end with a real pipeline run.

**Files:**
- Create: `docs/adr/0015-asymmetric-gc-pipeline-tail-success.md`
- Modify: `README.md` (line 79 paragraph)

### Task 4.1: Write ADR-0015

- [x] **Step 1: Create `docs/adr/0015-asymmetric-gc-pipeline-tail-success.md`**

Use this content (matches the §3.8 skeleton; ADR-0002 voice — terse, decision-first):

```markdown
# Asymmetric success/failure GC of run-scoped scratch paths

**Status:** accepted (2026-05-12)

## Context

Two pipeline-internal scratch paths grow forever today and nothing reads
them after the run that wrote them, but nothing deletes them either:

- `.apparat/runs/<run_id>/` — per-run `checkpoint.json`, per-node `prompt.md`
  / `raw-attempt-N.txt` / `status.json`, and `pipeline.jsonl`. Written by
  the pipeline runner and the engine's JSONL tracer.
- `.apparat/meditations/illuminations/.triage/<run_id>/chat-notes.md` — a
  same-run handoff between the `chat_session` / `chat_summarizer` agents
  and the next-node `verifier` / `explainer`. The write path is hardcoded
  at `.apparat/pipelines/illumination-to-implementation/chat-summarizer.md`
  (the agent writes via `Bash`); no `src/` code touches it.

Existing retention is **quantity-based at pipeline start**, not outcome-
aware: `gcOldRunsPerPipeline` (`src/cli/commands/pipeline/runs-gc.ts`)
runs from the `onPipelineStart` tracer hook and caps the per-pipeline
bucket via `APPARAT_RUNS_KEEP` (default 10). A green run can be evicted
while a red run survives; that is the inverse of the debugging contract.

The janitor pipeline is read-only by design — `src/cli/pipelines/janitor/janitor.md`
declares only `Grep` + `mcp__illumination__*` in its `tools:` block (no
`Edit`, no `Write`, no shell `rm`), so accumulation is unbounded at the
agent layer.

The precedent for outcome-gated cleanup already lives in the
illumination-to-implementation pipeline at
`.apparat/pipelines/illumination-to-implementation/memory-writer.md`:

> Pre-check. If `$tmux_tester_test_result` equals the literal string
> `"fail"`, skip both 7a and 7b entirely.

That gate protects the per-illumination plan + illumination on red. This
ADR extends the **same** asymmetric shape to two more run-scoped paths
at the **pipeline tail**.

## Decision

On `result.status === "success"` in the pipeline runner's `finally` block
(`src/cli/commands/pipeline/run.ts`), `gcRunScopedArtefactsOnSuccess(project, runId)`
removes both run-scoped paths keyed by `<run_id>`:

- `<project>/.apparat/runs/<run_id>/`
- `<project>/.apparat/meditations/illuminations/.triage/<run_id>/`

On any non-success outcome (engine failure, SIGINT, hard crash), both
paths are preserved untouched. The asymmetric guard is one variable
(`pipelineFailed`) already in scope; the helper is one ~10-LOC export
from `src/cli/commands/pipeline/runs-gc.ts`; the rmSync uses `force: true`
so missing paths are silent no-ops (pipelines that never invoke
`chat-summarizer` have no `.triage/<run_id>/` to delete).

No new declarative system, no validator rule, no MCP tool, no
`lifecycle:` frontmatter across agents.

## Precedent cited

- ADR-0002 — `consume(filename, reason: "implemented" | "declined")`
  establishes outcome-gated cleanup for illuminations and plans.
- `.apparat/pipelines/illumination-to-implementation/memory-writer.md`
  — the success-gated `consume` calls inside the existing pipeline.

## Considered alternatives

- **Universal `lifecycle:` frontmatter system across all agents +
  validator artefact-flow rule + `consume_design` MCP tool.** Rejected:
  only `runs/` and `.triage/` are unambiguously trash; specs, sessions,
  illuminations, and stimuli function as institutional memory that
  survives context resets.
- **Quantity-based tail GC (keep-newest-N regardless of outcome).**
  Rejected: the operator wants red runs preserved for debugging, green
  runs disposable. Symmetry destroys the contract.
- **Move chat-notes under `.apparat/runs/<run_id>/` so one GC handles
  both paths.** Rejected: requires atomic update of the
  `chat-summarizer.md` hardcoded write path and any node reading from
  `.triage/`. The current-path GC is mechanically identical (same key,
  same `rmSync`); the repath is a folder-layout question, not a GC
  correctness question, and may happen later if `.triage/` is dropped
  as a directory entirely.
- **Retroactive cleanup of the ~110 pre-rule run dirs + triage dirs.**
  Rejected: out of scope per the originating refinement bullet
  ("forward-looking only"). A sibling `chore` commit may follow at the
  operator's discretion.

## Consequences

- `apparat pipeline trace <runId>` on a green run exits 1 with the
  standard `No trace found` message. `src/cli/commands/pipeline/trace.ts`
  adds one stderr hint line pointing at this ADR. External callers that
  depended on green-run trace persistence must read the ADR.
- `APPARAT_RUNS_KEEP=N` semantics shift from "the newest N runs survive
  per pipeline" to "the newest N **failed** runs survive per pipeline"
  (greens self-evict at tail). The bucket cap still bounds disk; the
  practical contract is now "K failed-run survivors per pipeline."
  Documented in `README.md`.
- The parallel-illumination-to-implementation pipeline inherits this
  rule automatically because the GC lives at the runner level
  (`run.ts`), not in any agent file. No second-pipeline re-validation.
- Pre-rule accumulation (~93 `runs/` dirs + ~18 `.triage/` dirs already
  on disk) remains until the operator runs a one-shot `chore` cleanup.
  Not part of this ADR.
- No new env var, no new CLI flag, no new MCP tool. No new tracer
  field; `pipeline-start` / `pipeline-end` JSONL events are byte-
  identical.
```

- [x] **Step 2: Verify the ADR is well-formed**

```bash
test -f docs/adr/0015-asymmetric-gc-pipeline-tail-success.md && head -3 docs/adr/0015-asymmetric-gc-pipeline-tail-success.md
```

Expected: `# Asymmetric success/failure GC of run-scoped scratch paths` + blank line + `**Status:** accepted (2026-05-12)`.

### Task 4.2: Update the README retention paragraph

- [x] **Step 3: Replace the existing retention sentence in `README.md`**

Open `README.md`. Find the paragraph at line 79 (the one starting with `Pass --resume [runId]…`). The sentence to replace is:

> Older runs are pruned lazily (last 50 per project, override with `APPARAT_RUNS_KEEP`).

Replace **only that sentence** with this multi-sentence block (preserve the surrounding sentences in the same paragraph):

> Older runs are pruned in two ways. **At pipeline tail**, a successful run removes its own `.apparat/runs/<runId>/` and `.apparat/meditations/illuminations/.triage/<runId>/` directories — only failed runs leave debug artefacts on disk. **At pipeline start**, `APPARAT_RUNS_KEEP` (default 10) caps the newest K failed-run survivors per pipeline; a stricter `APPARAT_CRASH_AT_START_KEEP` bucket (default 5) covers crash-at-start dirs. The asymmetric rule is documented in ADR-0015 (`docs/adr/0015-asymmetric-gc-pipeline-tail-success.md`).

The "(last 50 per project, override with `APPARAT_RUNS_KEEP`)" parenthetical was already stale — the actual default is 10, not 50. The new paragraph also corrects that.

- [x] **Step 4: Confirm the README still parses**

```bash
grep -n "ADR-0015\|APPARAT_RUNS_KEEP" README.md
```

Expected: at least one match for each. `ADR-0015` appears in the new sentence; `APPARAT_RUNS_KEEP` was already present and remains.

### Task 4.3: End-to-end smoke

- [x] **Step 5: Build and run a real green pipeline; assert the run dir is gone after exit**

Build the CLI:

```bash
npm run build
```

Expected: clean build, no errors.

Then run a quick green pipeline. The `janitor` pipeline is the simplest green path with no `chat-summarizer` (exercises the missing-`.triage/` no-op branch):

```bash
cd /tmp && rm -rf smoke-tail-gc && mkdir smoke-tail-gc && cd smoke-tail-gc
git init -q -b main
mkdir -p .apparat
apparat pipeline run janitor . 2>&1 | tail -5
ls .apparat/runs/ 2>/dev/null
ls .apparat/meditations/illuminations/.triage/ 2>/dev/null
```

Expected: the `janitor` run prints its TUI, exits 0, and **both** `ls` commands print nothing (the dirs do not exist, or exist but are empty). If `.apparat/runs/` still contains a directory matching the runId after the green exit, the wiring in Chunk 2 is wrong.

- [x] **Step 6: Smoke a red run; assert the run dir survives**

Force a red outcome by attempting a pipeline that fails (e.g., a missing-variable invocation, or use a known-failing fixture pipeline if one exists; otherwise SIGINT during a long run):

```bash
cd /tmp/smoke-tail-gc
# Trigger a missing-variable failure (illumination-to-implementation expects --var inputs)
apparat pipeline run illumination-to-implementation . 2>&1 | tail -5 || true
ls .apparat/runs/
```

Expected: at least one directory under `.apparat/runs/`, named `illumination-to-implementation-<8hex>`. The dir's `pipeline.jsonl` is intact for `pipeline trace <runId>`.

- [x] **Step 7: Smoke `pipeline trace` on a green run hits the new hint**

Pick any runId that has been GC'd (any green run from Step 5). Or invent one:

```bash
cd /tmp/smoke-tail-gc
apparat pipeline trace ghost-runid . 2>&1 | grep -E "No trace found|ADR-0015"
```

Expected: three lines — `No trace found for run: ghost-runid`, `Expected: …/pipeline.jsonl`, and the parenthetical hint line containing `ADR-0015`. Exit 1.

- [x] **Step 8: Clean up the scratch project**

```bash
rm -rf /tmp/smoke-tail-gc
```

### Task 4.4: Final regression sweep

- [x] **Step 9: Full test suite**

```bash
npx vitest run
```

Expected: PASS — all suites green. Pay particular attention to:
- `src/cli/tests/post-tail-gc.test.ts` (new, Chunk 1)
- `src/cli/tests/pipeline-runs-gc.test.ts` (extended, Chunk 2)
- `src/cli/tests/runs-gc-per-pipeline.test.ts` (untouched, but must stay green)
- `src/cli/tests/runs-index.test.ts` (untouched, but must stay green)
- `src/cli/tests/pipeline-trace-*.test.ts` (extended, Chunk 3)

If `runs-gc-per-pipeline.test.ts` or `runs-index.test.ts` go red, audit per design §4.8 — they likely pre-stage fixtures and do **not** exercise the live finally path, so the conditional edit should not be needed. If a real conflict surfaces, retarget the assertion to a pre-staged dir rather than a live-run-output dir, then re-commit alongside the rest of this chunk.

- [x] **Step 10: Final type-check**

```bash
npx tsc --noEmit
```

Expected: clean.

- [x] **Step 11: Final grep invariants (per design §10.1)**

```bash
grep -n "gcRunScopedArtefactsOnSuccess" src/cli/commands/pipeline/runs-gc.ts src/cli/commands/pipeline/run.ts src/cli/tests/post-tail-gc.test.ts src/cli/tests/pipeline-runs-gc.test.ts
grep -nR "ADR-0015" docs/ src/cli/commands/pipeline/trace.ts README.md
```

Expected:
- `gcRunScopedArtefactsOnSuccess` present in `runs-gc.ts` (1 export), `run.ts` (1 import + 1 call), `post-tail-gc.test.ts` (≥ 7 uses), `pipeline-runs-gc.test.ts` (≥ 1 use).
- `ADR-0015` present in `docs/adr/0015-asymmetric-gc-pipeline-tail-success.md` (filename + status), `trace.ts` (2 hint emissions, one per missing-trace branch), `README.md` (1 paragraph mention).

- [x] **Step 12: Commit**

```bash
git add docs/adr/0015-asymmetric-gc-pipeline-tail-success.md README.md
git commit -m "$(cat <<'EOF'
docs(adr): codify asymmetric tail GC rule as ADR-0015

ADR-0015 documents the success-gated tail GC of .apparat/runs/<run_id>/
and .apparat/meditations/illuminations/.triage/<run_id>/. Cites ADR-0002
and the existing memory-writer.md gate as precedent. Records the two
contained behavioural shifts: pipeline trace exits 1 on green-cleaned
runs; APPARAT_RUNS_KEEP semantics reframe to failed-run survivors per
pipeline.

README.md retention paragraph rewritten — replaces the stale "(last 50
per project)" with the correct two-step phrasing and points at ADR-0015.

Refs: docs/superpowers/specs/2026-05-12-pipeline-write-consume-pairing-design.md §3.7, §3.8
EOF
)"
```

## Verification targets

- Smokes: None automated. Manual smoke covered in Task 4.3 Steps 5–7
- Manual exercises:
  - `apparat pipeline run janitor <scratch-project>` → green exit, `.apparat/runs/` empty
  - `apparat pipeline run illumination-to-implementation <scratch-project>` → red exit, `.apparat/runs/<runId>/` present
  - `apparat pipeline trace ghost-runid <scratch-project>` → exit 1 with three stderr lines incl. `ADR-0015`
- Lint: `npx vitest run`; `npx tsc --noEmit`
- Surfaces touched: ADR layer (new `docs/adr/0015-…md`), README retention paragraph

---

## Out-of-scope reminders (refinement-locked, do not implement)

Per the chat refinements and design §2:

- **Do NOT** add a `lifecycle:` frontmatter field to agent prompts.
- **Do NOT** add a graph-validator artefact-flow rule.
- **Do NOT** add a `consume_design` MCP tool.
- **Do NOT** GC `docs/superpowers/specs/`, `.apparat/sessions/`, `.apparat/meditations/illuminations/`, or `.apparat/meditations/stimuli/`.
- **Do NOT** retroactively `git rm` the 93 + 18 pre-rule dirs already on disk. (A sibling `chore(lifecycle): clean pre-protocol artefacts` commit may follow at the operator's discretion outside this plan.)
- **Do NOT** modify `src/attractor/core/engine.ts` or `src/attractor/tracer/pipeline-tracer.ts` — `onPipelineEnd` already carries outcome (`engine.ts:124-130`); this design uses `result.status` one layer up in `run.ts`.
- **Do NOT** add a new env var (e.g., `APPARAT_KEEP_SUCCESSFUL_TRACES`). Lock per design §9.2.
- **Do NOT** add a new CLI flag. Lock per design §8 invariants.
- **Do NOT** re-validate the parallel pipeline — it inherits the rule because the GC lives at the runner level. Lock per design §2.

## Open question (carried from design §9.1)

Pipelines that do not invoke `chat-summarizer` produce a missing
`.triage/<runId>/`. The helper uses `force: true`, so missing paths are
silent no-ops — this is the contract. An `existsSync` probe before each
`rmSync` is editorial; the implementer may add it if it improves the
test fixture story without changing the behavioural contract.
