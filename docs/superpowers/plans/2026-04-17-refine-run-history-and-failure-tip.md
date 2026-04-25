---
status: implemented
---

# Refine Post-Failure Tip Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a user-visible pipeline failure in `ralph pipeline run`, print a single stdout line pointing at `ralph pipeline refine <name>`, so the iteration-loop command is discoverable at the moment the developer needs it.

**Architecture:** Add a module-private helper `printRefineTip(invokedAs)` to `src/cli/commands/pipeline.ts`. Call it at three pre-engine `process.exit(1)` sites (invalid DOT, missing declared inputs, headless-safe rejection) and in the `finally` branch of engine-failure (after the Ink app unmounts via `waitUntilExit()`). Suppress the tip when the dot file does not exist or when the pipeline succeeds. Name resolution reuses `isNameShorthand` (from `src/cli/lib/pipeline-resolver.ts`) so copy-paste always produces a valid `ralph pipeline refine` command.

**Tech Stack:** TypeScript, Node.js, Vitest. No new runtime deps. Edits confined to `src/cli/commands/pipeline.ts` and two test files.

**Source spec:** `specs/2026-04-17-refine-run-history-and-failure-tip-design.md`

**Out of scope (explicitly superseded by design doc — DO NOT implement):**
- Run-history injection into the refine trigger — **already shipped**. `pipelineRefineCommand` already composes `traceBlock` via `listRecentTraces` + `digestTraceFile` (`src/cli/commands/pipeline.ts:442, 468, 679-689`). Do NOT add `buildRunHistorySection` or any similar helper.
- Two-phase Claude session extraction — **already shipped** at `src/cli/lib/session.ts:114`.
- Edge-label diff after refine — **already shipped** via `diffEdgeLabels()` called by `pipelineRefineCommand` passing `previousGraph`.
- TTY gate, `--no-tips` flag, config knob, env suppression — YAGNI per design doc.
- Auto-invoking `refine` on failure — the tip points; it does not run.
- Restructuring `pipelineRunCommand` exit paths — instrument existing sites only.

---

## Chunk 1: `printRefineTip` helper + wire-up at four failure sites

Single chunk because the diff is ~40 LOC across 4 call sites plus tests; the four sites must ship together for the discoverability story to hold.

### Task 1: Add failing test for tip emission at headless-safe rejection (site c)

**Files:**
- Modify: `src/cli/tests/pipeline-headless.test.ts`

Reuse the existing `pipeline-headless.test.ts` because it already has a `headless_safe=false` + non-TTY fixture with `process.exit` spying and all the needed mocks — cheapest surface for a stdout assertion.

- [ ] **Step 1: Spy `console.log` and assert the tip line in the existing rejection test**

Edit `src/cli/tests/pipeline-headless.test.ts`. Replace the body of `it("exits with error when headlessSafe=false and not TTY", …)` with:

```ts
  it("exits with error when headlessSafe=false and not TTY", async () => {
    const dotPath = join(dir, "unsafe.dot");
    writeFileSync(dotPath, UNSAFE_DOT);

    Object.defineProperty(process.stdin, "isTTY", { value: undefined, writable: true, configurable: true });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(pipelineRunCommand(dotPath, { logsRoot: dir })).rejects.toThrow("process.exit called");
    expect(output.error).toHaveBeenCalledWith(
      expect.stringContaining("headless_safe=false"),
    );
    expect(exitSpy).toHaveBeenCalledWith(1);

    const tipLine = logSpy.mock.calls
      .map((c) => c[0])
      .find((line): line is string => typeof line === "string" && line.startsWith("Tip: ralph pipeline refine"));
    expect(tipLine).toBeDefined();
    expect(tipLine).toContain("unsafe");

    logSpy.mockRestore();
  });
```

- [ ] **Step 2: Run the test; confirm it fails**

Run: `npx vitest run src/cli/tests/pipeline-headless.test.ts -t "exits with error when headlessSafe=false and not TTY"`
Expected: FAIL — `tipLine` is `undefined` because the helper does not exist yet.

### Task 2: Implement `printRefineTip` + wire the three pre-engine exits (sites a, b, c)

**Files:**
- Modify: `src/cli/commands/pipeline.ts`

- [ ] **Step 1: Verify/add required imports**

Open `src/cli/commands/pipeline.ts`. Confirm `basename` is imported from `path` and `isNameShorthand` is imported from `./lib/pipeline-resolver.js` (the existing `resolvePipelineArg` import on the same module). If `basename` is not already in the `path` import list, add it. If `isNameShorthand` is not already present, add it to the existing resolver import.

- [ ] **Step 2: Add the `printRefineTip` helper**

Add this helper above the `pipelineRunCommand` export. Module-private (no `export`):

```ts
function printRefineTip(invokedAs: string): void {
  const name = isNameShorthand(invokedAs) ? invokedAs : basename(invokedAs, ".dot");
  console.log(
    `Tip: ralph pipeline refine ${name} to improve this pipeline with agent assistance.`,
  );
}
```

Rationale: plain stdout, no color codes, no Ink integration. `isNameShorthand` is already how `pipelineRunCommand` resolves its own argument on line 117 — reusing it guarantees the tip's `<name>` token mirrors the user's invocation style.

- [ ] **Step 3: Wire the tip into the invalid-DOT `catch` (site a)**

Currently lines 129-130 read:

```ts
  try { validateOrRaise(graph); }
  catch (err) { await output.error((err as Error).message); process.exit(1); }
```

Replace with:

```ts
  try { validateOrRaise(graph); }
  catch (err) {
    await output.error((err as Error).message);
    printRefineTip(dotFile);
    process.exit(1);
  }
```

- [ ] **Step 4: Wire the tip into the missing-inputs exit (site b)**

Inside `if (graph.inputs && preflight.declared.length > 0) { … }` (around line 135-146), insert `printRefineTip(dotFile);` on the line immediately before `process.exit(1);`. Final block:

```ts
  if (graph.inputs && preflight.declared.length > 0) {
    console.error(
      formatMissingInputsError({
        pipelineName: graph.name,
        declared: graph.inputs,
        provided: opts.variables ?? {},
        missing: preflight.declared,
        invokedAs: dotFile,
      }),
    );
    printRefineTip(dotFile);
    process.exit(1);
  }
```

- [ ] **Step 5: Wire the tip into the headless-safe rejection exit (site c)**

Inside `if (graph.headlessSafe === false && !process.stdin.isTTY) { … }` (around line 164-170), insert `printRefineTip(dotFile);` immediately before `process.exit(1);`:

```ts
  if (graph.headlessSafe === false && !process.stdin.isTTY) {
    await output.error(
      `This pipeline has headless_safe=false and cannot run without a TTY.\n` +
      `Run it interactively: ralph pipeline run ${dotFile}`,
    );
    printRefineTip(dotFile);
    process.exit(1);
  }
```

Do **NOT** touch the `if (!existsSync(absPath))` block around line 120-123. File-not-found must remain tip-free per design doc §Explicit non-call-sites.

- [ ] **Step 6: Run the headless-safe test — confirm it now passes**

Run: `npx vitest run src/cli/tests/pipeline-headless.test.ts -t "exits with error when headlessSafe=false and not TTY"`
Expected: PASS.

- [ ] **Step 7: Run the full `pipeline-headless.test.ts` file — confirm no regression**

Run: `npx vitest run src/cli/tests/pipeline-headless.test.ts`
Expected: all 3 tests PASS. The two success-path tests must not be affected because those branches never call `printRefineTip`.

### Task 3: Add tests for missing-inputs tip (site b), file-not-found negative, success negative, shorthand name

**Files:**
- Create: `src/cli/tests/pipeline-refine-tip.test.ts`

A new test file, because the missing-inputs and file-not-found paths have no existing co-located fixture. Mirrors `pipeline-headless.test.ts` mocking structure.

- [ ] **Step 1: Create the new test file**

Write to `src/cli/tests/pipeline-refine-tip.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

vi.mock("../../attractor/core/engine.js", () => ({
  runPipeline: vi.fn(async () => ({ status: "success", completedNodes: ["start", "done"], context: {} })),
}));
vi.mock("../../attractor/core/graph.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../attractor/core/graph.js")>();
  return { ...actual };
});
vi.mock("../lib/output.js", () => ({
  error: vi.fn(async () => {}),
  warn: vi.fn(async () => {}),
  success: vi.fn(async () => {}),
  info: vi.fn(async () => {}),
  step: vi.fn(async () => {}),
  stream: vi.fn(async () => {}),
}));
vi.mock("child_process", () => ({
  spawn: vi.fn(() => ({
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn((event: string, cb: () => void) => { if (event === "close") cb(); }),
  })),
  spawnSync: vi.fn(() => ({ status: 0, stdout: "main\n" })),
}));
vi.mock("../components/PipelineApp.js", () => ({
  renderPipelineApp: vi.fn(async () => ({
    callbacks: { emit: vi.fn(), done: vi.fn() },
    waitUntilExit: vi.fn(async () => {}),
  })),
}));
vi.mock("../lib/assets.js", () => ({}));
vi.mock("../lib/pipeline-create-prompt.js", () => ({
  composeCreatePrompt: vi.fn().mockReturnValue("# Test prompt"),
}));
vi.mock("../lib/stream-formatter.js", () => ({
  streamEvents: vi.fn(async function* () {}),
  parseStreamJsonEvents: vi.fn(async function* () {}),
}));

import { pipelineRunCommand } from "../commands/pipeline.js";

const MISSING_INPUTS_DOT = `digraph g {
  goal="test"
  inputs=[foo]
  start [shape=Mdiamond]
  a [agent="implement", prompt="uses \${foo}"]
  done [shape=Msquare]
  start -> a -> done
}`;

const SUCCESS_DOT = `digraph g {
  goal="ok"
  start [shape=Mdiamond]
  a [agent="implement", prompt="noop"]
  done [shape=Msquare]
  start -> a -> done
}`;

function findTipLine(spy: ReturnType<typeof vi.spyOn>): string | undefined {
  return spy.mock.calls
    .map((c) => c[0])
    .find((line): line is string => typeof line === "string" && line.startsWith("Tip: ralph pipeline refine"));
}

describe("pipelineRunCommand refine tip", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let exitSpy: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let logSpy: any;
  let dir: string;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as any);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    dir = mkdtempSync(join(tmpdir(), "ralph-tip-test-"));
  });

  afterEach(() => {
    exitSpy.mockRestore();
    logSpy.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  });

  it("prints tip when declared inputs are missing", async () => {
    const dotPath = join(dir, "needs-foo.dot");
    writeFileSync(dotPath, MISSING_INPUTS_DOT);

    await expect(pipelineRunCommand(dotPath, { logsRoot: dir })).rejects.toThrow("process.exit called");

    const tipLine = findTipLine(logSpy);
    expect(tipLine).toBeDefined();
    expect(tipLine).toContain("needs-foo");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("does NOT print tip when the dot file does not exist", async () => {
    const dotPath = join(dir, "does-not-exist.dot");

    await expect(pipelineRunCommand(dotPath, { logsRoot: dir })).rejects.toThrow("process.exit called");

    expect(findTipLine(logSpy)).toBeUndefined();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("does NOT print tip on success", async () => {
    const dotPath = join(dir, "ok.dot");
    writeFileSync(dotPath, SUCCESS_DOT);

    await pipelineRunCommand(dotPath, { logsRoot: dir });

    expect(findTipLine(logSpy)).toBeUndefined();
  });

  it("uses shorthand name verbatim when invoked as a shorthand", async () => {
    const pipelinesDir = join(dir, "pipelines");
    mkdirSync(pipelinesDir, { recursive: true });
    writeFileSync(join(pipelinesDir, "myflow.dot"), MISSING_INPUTS_DOT);

    await expect(pipelineRunCommand("myflow", { logsRoot: dir, project: dir })).rejects.toThrow(
      "process.exit called",
    );

    const tipLine = findTipLine(logSpy);
    expect(tipLine).toBeDefined();
    expect(tipLine).toContain("ralph pipeline refine myflow ");
  });
});
```

- [ ] **Step 2: Run the new test file**

Run: `npx vitest run src/cli/tests/pipeline-refine-tip.test.ts`
Expected: all 4 tests PASS. (The helper + three pre-engine wire-ups from Task 2 already cover site b, file-not-found, success, and the shorthand-name path.)

### Task 4: Add engine-failure tip in the `finally` branch (site d)

**Files:**
- Modify: `src/cli/commands/pipeline.ts`
- Modify: `src/cli/tests/pipeline-refine-tip.test.ts`

- [ ] **Step 1: Add a failing test for engine-failure tip emission**

Append inside the existing `describe("pipelineRunCommand refine tip", …)` block in `src/cli/tests/pipeline-refine-tip.test.ts`:

```ts
  it("prints tip after engine failure, after Ink unmounts", async () => {
    const { runPipeline } = await import("../../attractor/core/engine.js");
    (runPipeline as unknown as { mockImplementationOnce: (fn: () => unknown) => void })
      .mockImplementationOnce(async () => ({
        status: "fail",
        failureReason: "synthetic",
        completedNodes: [],
        context: {},
      }));

    const dotPath = join(dir, "will-fail.dot");
    writeFileSync(dotPath, SUCCESS_DOT);

    await pipelineRunCommand(dotPath, { logsRoot: dir });

    const tipLine = findTipLine(logSpy);
    expect(tipLine).toBeDefined();
    expect(tipLine).toContain("will-fail");
  });
```

- [ ] **Step 2: Run the engine-failure test — confirm it fails**

Run: `npx vitest run src/cli/tests/pipeline-refine-tip.test.ts -t "prints tip after engine failure"`
Expected: FAIL — tip is not yet emitted in the engine-failure path.

- [ ] **Step 3: Hoist a `pipelineFailed` flag + emit the tip in `finally`**

Edit `src/cli/commands/pipeline.ts` inside `pipelineRunCommand`. Three changes:

1. **Declare the flag.** Immediately before `const ac = new AbortController();` (around line 223), insert:

```ts
  let pipelineFailed = false;
```

2. **Set the flag after `runPipeline` resolves.** After the existing block at lines 376-382 (the `if (result.status !== "success" && abortHandledFor === null && currentBlockNodeId !== null) { … }`), append a second check:

```ts
    if (result.status !== "success") {
      pipelineFailed = true;
    }
```

3. **Emit the tip in `finally`, after `await waitUntilExit()`.** The existing `finally` (lines 383-389) ends with `await waitUntilExit();`. Add one line after it:

```ts
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    await new Promise((resolve) => setImmediate(resolve));
    done();
    await waitUntilExit();
    if (pipelineFailed) printRefineTip(dotFile);
  }
```

Rationale: the tip is emitted AFTER `waitUntilExit()` so Ink's live region has fully unmounted; the plain-text line lands below the final painted frame instead of inside the TUI. The flag is read only in `finally` so an exception inside `try` cannot leave `pipelineFailed` in a misleading state — the caller does not rely on engine-failure exit codes (per design doc §Current state).

- [ ] **Step 4: Run the engine-failure test — confirm it passes**

Run: `npx vitest run src/cli/tests/pipeline-refine-tip.test.ts -t "prints tip after engine failure"`
Expected: PASS.

- [ ] **Step 5: Run the full test file**

Run: `npx vitest run src/cli/tests/pipeline-refine-tip.test.ts`
Expected: all 5 tests PASS.

### Task 5: Full-suite gate (build + tests) + commit

**Files:** none (verification only)

- [ ] **Step 1: Run the build**

Run: `npm run build`
Expected: builds with no TypeScript errors.

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: all tests PASS. Pay special attention to `pipeline.test.ts`, `pipeline-app-integration.test.tsx`, `pipeline-preflight.test.ts`, and `pipeline-headless.test.ts` — they touch `pipelineRunCommand` or its exit paths.

- [ ] **Step 3: Commit**

```bash
git add src/cli/commands/pipeline.ts src/cli/tests/pipeline-refine-tip.test.ts src/cli/tests/pipeline-headless.test.ts
git commit -m "feat(pipeline): tip toward refine on run failure"
```

Commit message rationale: `feat(pipeline):` matches the repo's existing convention (see recent commits `feat(pipeline): migrate mark_dispatched to script_file=` and `feat(prompt): steer pipeline authors toward script_file=`).

---

## Post-completion

After Chunk 1 is green:

1. Full test suite: `npm test` — all green.
2. Rebuild: `npm run build` — clean.
3. Tmux-harness smoke per `docs/harness/tmux-drive.md`:
   - **Run failure emits tip** — force a pipeline failure (e.g. invoke a smoke pipeline with missing `inputs=`), confirm `Tip: ralph pipeline refine <name> to improve this pipeline with agent assistance.` appears on stdout.
   - **Run success emits no tip** — run a known-passing smoke pipeline, grep stdout for `Tip: ralph pipeline refine`; expect zero matches.
   - **File-not-found emits no tip** — invoke `ralph pipeline run <bogus>` against a non-existent name, confirm no tip line appears.
4. Confirm the source illumination still exists:
   ```bash
   ls meditations/illuminations/2026-04-17T1100-refine-changes-the-authoring-model-not-just-the-command-set.md
   ```
5. Mark the illumination dispatched via `mcp__illumination__mark_dispatched` with `filename="2026-04-17T1100-refine-changes-the-authoring-model-not-just-the-command-set.md"` and `plan_path="docs/superpowers/plans/2026-04-17-refine-run-history-and-failure-tip.md"`.
