# Collapse Two Run-State Homes + Cross-Project Operator View — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse daemon-scheduled runs onto the existing project-local `JsonlPipelineTracer` seam (one runId scheme, one log home), then ship the bundled operator-payoff features (`projects.json` registry, `apparat status`, composed `apparat watch`, runId cross-link in `heartbeat logs`, CONTEXT.md doc).

**Architecture:** Steps 1–2 are the depth work — the engine seam already accepts an injected `runId`/`logsRoot` (`src/attractor/core/engine.ts:150`, `src/cli/commands/pipeline/run.ts:32-38`). Daemon adopts the 8-char shape via a new `newRunId()` helper and injects `--run-id`/`--logs-root` into the spawned `apparat pipeline run` child so the engine writes the canonical trace once, in one place. Steps 3–7 are bundled feature work on top: a best-effort operator-state index, a glance command, a single Ink dashboard composing both existing TUIs as child components, a daemon-authored cross-link breadcrumb, and a CONTEXT.md operator-global subsection.

**Tech Stack:** Node.js, TypeScript, Commander (CLI), Ink (React for terminals), vitest, `@ts-graphviz/ast` (unrelated here), JSONL (engine trace format).

**Source-of-truth design doc:** `docs/superpowers/specs/2026-05-09-two-run-homes-no-cross-project-view-design.md`

**Originating illumination:** `.apparat/meditations/illuminations/2026-05-07T2037-two-run-homes-no-cross-project-view.md`

---

## Chunk 1: `newRunId()` helper + migrate two call sites

This chunk is invisible to users — same observable behaviour, two call sites converge on one helper. It exists as its own chunk so the runId rename to 8-char in the daemon log filename ships behind the smallest possible diff and a clean test-first commit. Subsequent chunks (daemon plumbing, registry, status) build on the helper.

**Files:**
- Modify: `src/cli/lib/apparat-paths.ts` (add `newRunId()` export)
- Modify: `src/cli/commands/pipeline/run.ts:127` (use helper)
- Modify: `src/daemon/runner.ts:54` (use helper)
- Test: `src/cli/tests/apparat-paths.test.ts` (extend — add `newRunId()` shape contract)

### Task 1.1: Add a failing test for `newRunId()` in `src/cli/tests/apparat-paths.test.ts`

- [x] **Step 1: Read the existing test file**

Open `src/cli/tests/apparat-paths.test.ts` (Read tool) to confirm the existing imports and `describe` shape. The new test block goes at the bottom of the file.

- [x] **Step 2: Append the failing test block**

Add at the bottom of `src/cli/tests/apparat-paths.test.ts`:

```ts
import { newRunId } from "../lib/apparat-paths.js";

describe("newRunId", () => {
  it("returns an 8-char hex slice of randomUUID", () => {
    const id = newRunId();
    expect(id).toMatch(/^[0-9a-f]{8}$/);
  });

  it("returns a different id on each call (collision-resistant for solo dev tooling)", () => {
    const a = newRunId();
    const b = newRunId();
    expect(a).not.toBe(b);
  });
});
```

- [x] **Step 3: Run the test to confirm it fails**

Run: `npx vitest run src/cli/tests/apparat-paths.test.ts -t newRunId`
Expected: FAIL with `"newRunId" is not exported by "src/cli/lib/apparat-paths.ts"` (or equivalent module-resolution error).

### Task 1.2: Implement `newRunId()`

- [x] **Step 1: Edit `src/cli/lib/apparat-paths.ts`**

Add at the top of the file (after the existing `import { join }` line):

```ts
import { randomUUID } from "node:crypto";
```

Add at the bottom of the file:

```ts
/**
 * Canonical 8-char runId shape used by both interactive runs
 * (src/cli/commands/pipeline/run.ts) and the daemon (src/daemon/runner.ts).
 * One source of truth for the truncation rule.
 */
export function newRunId(): string {
  return randomUUID().slice(0, 8);
}
```

- [x] **Step 2: Run the new test to confirm it passes**

Run: `npx vitest run src/cli/tests/apparat-paths.test.ts -t newRunId`
Expected: PASS (both `it` cases).

- [x] **Step 3: Commit**

```bash
git add src/cli/lib/apparat-paths.ts src/cli/tests/apparat-paths.test.ts
git commit -m "feat(paths): add newRunId() helper — single source for 8-char runId"
```

### Task 1.3: Migrate `src/cli/commands/pipeline/run.ts:127`

- [x] **Step 1: Edit the import block**

Replace this line near the top of `src/cli/commands/pipeline/run.ts`:

```ts
import { runsDir } from "../../lib/apparat-paths.js";
```

with:

```ts
import { newRunId, runsDir } from "../../lib/apparat-paths.js";
```

- [x] **Step 2: Replace the runId allocation**

Anchor: find `const runId = randomUUID().slice(0, 8);` inside `pipelineRunCommand`. Replace with:

```ts
const runId = newRunId();
```

- [x] **Step 2b: Verify and remove the now-unused `randomUUID` import**

Run: `grep -n "randomUUID" src/cli/commands/pipeline/run.ts`
If only the import line `import { randomUUID } from "crypto";` matches (no body uses), delete that import. If other body uses remain, keep the import.

- [x] **Step 3: Run the existing pipeline tests to confirm no regression**

Run: `npx vitest run src/cli/tests/pipeline-runs-gc.test.ts`
Expected: PASS (gc behaviour is shape-agnostic; this is a sanity check).

Run: `npx tsc --noEmit`
Expected: PASS — no type errors from the import shuffle.

- [x] **Step 4: Commit**

```bash
git add src/cli/commands/pipeline/run.ts
git commit -m "refactor(pipeline/run): use newRunId() helper"
```

### Task 1.4: Migrate `src/daemon/runner.ts:54`

- [x] **Step 1: Edit the import block**

Add this import after the existing `import { randomUUID } from "crypto";` line:

```ts
import { newRunId } from "../cli/lib/apparat-paths.js";
```

- [x] **Step 2: Edit line 54**

Replace:

```ts
const runId = randomUUID();
```

with:

```ts
const runId = newRunId();
```

Then remove the now-unused `import { randomUUID } from "crypto";` line. Verify with `grep -n randomUUID src/daemon/runner.ts` returns no matches before committing.

- [x] **Step 3: Run daemon-runner tests to confirm no regression**

Run: `npx vitest run src/daemon/tests/runner.test.ts`
Expected: PASS — existing tests assert `result.runId` is truthy and the `lines` contain `"Session started"`; the runId shape change does not break them.

- [x] **Step 4: Run the full suite**

Run: `npx vitest run`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/daemon/runner.ts
git commit -m "refactor(daemon): use newRunId() — daemon adopts 8-char runId scheme"
```

## Verification targets

- Smokes: None
- Manual exercises: `apparat heartbeat pipeline meditate --project /tmp/test-app --every 1` then wait for the daemon to fire — confirm the file at `~/.apparat/logs/<taskId>/<runId>.log` has an 8-char runId in the filename
- Lint: `npx tsc --noEmit`; `npx vitest run src/cli/tests/apparat-paths.test.ts`; `npx vitest run src/daemon/tests/runner.test.ts`
- Surfaces touched: cli-lib (apparat-paths), cli-commands (pipeline/run), daemon (runner)

---

## Chunk 2: Daemon plumbing — `--run-id` flag + `--logs-root` injection + cross-link breadcrumb

The daemon today spawns `apparat pipeline run` blind: child allocates its own 8-char runId, writes its own JSONL, and the daemon writes a parallel home-global log of stdout/stderr only. After this chunk the daemon owns the runId and routes the child to write the engine trace into `<project>/.apparat/runs/<runId>/`. The home-global log shrinks to an orchestration breadcrumb (start/end/exit + cross-link to the project-local trace).

**Files:**
- Modify: `src/cli/program.ts` (add `--run-id <id>` option to `pipeline run`)
- Modify: `src/cli/commands/pipeline/run.ts` (accept `runId` option, prefer it over `newRunId()`; pass through to engine)
- Modify: `src/daemon/runner.ts` (resolve `projectRoot` from `task.args`; inject `--run-id` + `--logs-root` for `pipeline run` tasks; emit synthetic `system`-stream breadcrumbs)
- Create (new): `src/daemon/runner-args.ts` — small helper module owning `resolveProjectFromArgs` + `injectRunArgs` (keeps `runner.ts` focused on lifecycle; helpers are pure & easily testable)
- Test: `src/daemon/tests/runner-args.test.ts` (new — pure helpers)
- Test: `src/daemon/tests/runner.test.ts` (extend — assert daemon spawns the child with `--run-id` and `--logs-root` for `pipeline run` tasks; assert breadcrumb lines)

### Task 2.1: Failing test for `resolveProjectFromArgs`

- [x] **Step 1: Create `src/daemon/tests/runner-args.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { resolveProjectFromArgs, injectRunArgs } from "../runner-args.js";

describe("resolveProjectFromArgs", () => {
  it("returns the value following --project", () => {
    expect(resolveProjectFromArgs(["pipeline.dot", "--project", "/work/app"])).toBe("/work/app");
  });

  it("returns null when --project is absent", () => {
    expect(resolveProjectFromArgs(["pipeline.dot"])).toBe(null);
  });

  it("returns null when --project is the last arg with no value", () => {
    expect(resolveProjectFromArgs(["pipeline.dot", "--project"])).toBe(null);
  });

  it("tolerates --project appearing anywhere in argv", () => {
    expect(resolveProjectFromArgs(["--project", "/work/app", "pipeline.dot"])).toBe("/work/app");
  });
});

describe("injectRunArgs", () => {
  it("appends --run-id and --logs-root", () => {
    const out = injectRunArgs(["pipeline.dot", "--project", "/work/app"], "abcd1234", "/work/app/.apparat/runs/abcd1234");
    expect(out).toEqual([
      "pipeline.dot",
      "--project", "/work/app",
      "--run-id", "abcd1234",
      "--logs-root", "/work/app/.apparat/runs/abcd1234",
    ]);
  });

  it("is idempotent: skips --run-id if already present", () => {
    const out = injectRunArgs(
      ["pipeline.dot", "--run-id", "manualxx"],
      "abcd1234",
      "/runs/abcd1234",
    );
    // --run-id already present → keep manualxx, only inject --logs-root
    expect(out).toContain("manualxx");
    expect(out).not.toContain("abcd1234");
    expect(out).toContain("--logs-root");
  });

  it("is idempotent: skips --logs-root if already present", () => {
    const out = injectRunArgs(
      ["pipeline.dot", "--logs-root", "/manual/path"],
      "abcd1234",
      "/runs/abcd1234",
    );
    expect(out).toContain("/manual/path");
    expect(out).not.toContain("/runs/abcd1234");
    expect(out).toContain("--run-id");
  });

  it("does not mutate the input array", () => {
    const input = ["pipeline.dot"];
    injectRunArgs(input, "abcd1234", "/runs/abcd1234");
    expect(input).toEqual(["pipeline.dot"]);
  });
});
```

- [x] **Step 2: Run the test to confirm it fails**

Run: `npx vitest run src/daemon/tests/runner-args.test.ts`
Expected: FAIL with module-not-found error on `../runner-args.js`.

### Task 2.2: Implement `runner-args.ts`

- [x] **Step 1: Create `src/daemon/runner-args.ts`**

```ts
/**
 * Pure argv helpers for daemon → child plumbing.
 * Kept separate from runner.ts so runTask stays focused on lifecycle.
 */

export function resolveProjectFromArgs(args: string[]): string | null {
  const idx = args.indexOf("--project");
  if (idx === -1) return null;
  const val = args[idx + 1];
  if (val === undefined) return null;
  return val;
}

export function injectRunArgs(args: string[], runId: string, logsRoot: string): string[] {
  const out = [...args];
  if (!out.includes("--run-id")) {
    out.push("--run-id", runId);
  }
  if (!out.includes("--logs-root")) {
    out.push("--logs-root", logsRoot);
  }
  return out;
}
```

- [x] **Step 2: Run the test to confirm all cases pass**

Run: `npx vitest run src/daemon/tests/runner-args.test.ts`
Expected: PASS (all 7 `it` cases).

- [x] **Step 3: Commit**

```bash
git add src/daemon/runner-args.ts src/daemon/tests/runner-args.test.ts
git commit -m "feat(daemon): add resolveProjectFromArgs/injectRunArgs helpers"
```

### Task 2.3: Add `--run-id <id>` and `--logs-root <path>` flags to `apparat pipeline run`

- [x] **Step 1: Edit `src/cli/program.ts` — extend the `pipeline run` registration**

Find the `.option("--var <key=value>", "pass caller variable (repeatable)", collectKV, {} as Record<string, string>)` line in the `pipeline.command("run …")` block (around `:135`). Insert two new option lines immediately above it:

```ts
    .option("--run-id <id>", "Override the runId allocated for this run (used by the daemon to align home-global and project-local logs)")
    .option("--logs-root <path>", "Override the logs directory; defaults to <project>/.apparat/runs/<runId>")
```

Then update the `.action` callback to thread the new options through:

```ts
    .action(async (dotFile: string, opts: { project?: string; resume?: boolean | string; runId?: string; logsRoot?: string }) => {
      await pipelineRunCommand(dotFile, {
        project: opts.project,
        resume: opts.resume,
        runId: opts.runId,
        logsRoot: opts.logsRoot,
        variables: (opts as Record<string, unknown>)["var"] as Record<string, string> | undefined,
      });
    });
```

Note: `--logs-root` is *already* honoured by `pipelineRunCommand` via `PipelineRunOptions.logsRoot` at `src/cli/commands/pipeline/run.ts:35`; this step only registers the CLI flag so users (and the daemon) can pass it. `--run-id` is new on both sides — the run command receives it in Task 2.4.

- [x] **Step 2: Verify the flag registration compiles**

Run: `npx tsc --noEmit`
Expected: PASS.

- [x] **Step 3: Commit**

```bash
git add src/cli/program.ts
git commit -m "feat(pipeline/run): add --run-id and --logs-root CLI flags"
```

### Task 2.4: Failing test — `pipelineRunCommand` honours `opts.runId`

- [x] **Step 1: Create `src/cli/tests/pipeline-run-runid.test.ts`** (new file — keeps blast radius clean and easier to grep)

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { rmSync } from "fs";
import { pipelineRunCommand } from "../commands/pipeline/run.js";

afterEach(() => vi.restoreAllMocks());

describe("pipelineRunCommand --run-id override", () => {
  it("uses opts.runId instead of allocating a fresh one", async () => {
    const project = mkdtempSync(join(tmpdir(), "apparat-runid-"));
    const dotFile = join(project, "smoke.dot");
    writeFileSync(
      dotFile,
      'digraph smoke { goal="t"; start [shape=Mdiamond]; done [shape=Msquare]; start -> done; }\n',
    );
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((c?: number) => { throw new Error(`exit:${c}`); }) as any);
    try {
      await pipelineRunCommand(dotFile, { project, runId: "deadbeef" });
    } catch {} finally { exitSpy.mockRestore(); }
    const tracePath = join(project, ".apparat", "runs", "deadbeef", "pipeline.jsonl");
    expect(existsSync(tracePath)).toBe(true);
    rmSync(project, { recursive: true, force: true });
  });
});
```

- [x] **Step 3: Run the test to confirm it fails**

Run: `npx vitest run src/cli/tests/pipeline-run-runid.test.ts` (or the file you appended to)
Expected: FAIL — `existsSync(...)` is `false` because today the run command allocates a fresh runId regardless of `opts.runId`.

### Task 2.5: Implement `runId` plumbing inside `pipelineRunCommand`

- [x] **Step 1: Edit `src/cli/commands/pipeline/run.ts`**

Extend `PipelineRunOptions` (at `:32-38`) to include the two new options:

```ts
export interface PipelineRunOptions {
  project?: string;
  resume?: boolean | string;
  logsRoot?: string;
  runId?: string;
  /** Extra key=value pairs injected as $variable context for variableExpansionTransform */
  variables?: Record<string, string>;
}
```

At line 127, replace:

```ts
const runId = newRunId();
```

with:

```ts
const runId = opts.runId ?? newRunId();
```

The engine already accepts `opts.runId` at `src/attractor/core/engine.ts:150`. The downstream `runPipeline({ logsRoot, runId, ... })` call at `:212-214` is unchanged — it already threads `runId` through.

- [x] **Step 2: Run the new test to confirm it passes**

Run: `npx vitest run src/cli/tests/pipeline-run-runid.test.ts`
Expected: PASS — the trace file now lands at `<project>/.apparat/runs/deadbeef/pipeline.jsonl`.

- [x] **Step 3: Commit**

```bash
git add src/cli/commands/pipeline/run.ts src/cli/tests/pipeline-run-runid.test.ts
git commit -m "feat(pipeline/run): honour opts.runId override"
```

### Task 2.6: Failing test — daemon spawns child with `--run-id` and `--logs-root` for `pipeline run` tasks

- [x] **Step 1: Append to `src/daemon/tests/runner.test.ts`**

```ts
import { spawn } from "child_process";
vi.mock("child_process", () => ({
  spawn: vi.fn(),
}));

describe("runTask — pipeline run argv augmentation", () => {
  it("injects --run-id and --logs-root when task is a pipeline run with --project", async () => {
    // Arrange a pipeline-run task (command="pipeline", args=["run", "<dot>", "--project", <project>])
    const project = join(testHome, "fake-project");
    mkdirSync(project, { recursive: true });
    const task = makeTask({
      id: "pipeline:fake-project",
      command: "pipeline",
      args: ["run", "smoke.dot", "--project", project],
    });

    // Stub spawn: capture argv, then synthesise immediate close
    const captured: { command: string; args: string[] }[] = [];
    vi.mocked(spawn).mockImplementation((cmd: any, args: any) => {
      captured.push({ command: cmd as string, args: args as string[] });
      const fakeChild: any = {
        pid: 99999,
        stdout: { on: () => {} },
        stderr: { on: () => {} },
        on: (ev: string, cb: any) => { if (ev === "close") setImmediate(() => cb(0)); },
      };
      return fakeChild;
    });

    const { runId } = await runTask(task);

    // Assert: child argv contains --run-id <runId> and --logs-root <project>/.apparat/runs/<runId>
    expect(captured.length).toBe(1);
    const argv = captured[0].args.join(" ");
    expect(argv).toContain(`--run-id ${runId}`);
    expect(argv).toContain(`--logs-root ${join(project, ".apparat", "runs", runId)}`);
  });

  it("does NOT inject for non-pipeline tasks (e.g. meditate)", async () => {
    const project = join(testHome, "fake-project");
    mkdirSync(project, { recursive: true });
    const task = makeTask({ id: "meditate:proj", command: "meditate", args: [project] });

    const captured: { args: string[] }[] = [];
    vi.mocked(spawn).mockImplementation((_cmd: any, args: any) => {
      captured.push({ args: args as string[] });
      const fakeChild: any = {
        pid: 99999,
        stdout: { on: () => {} },
        stderr: { on: () => {} },
        on: (ev: string, cb: any) => { if (ev === "close") setImmediate(() => cb(0)); },
      };
      return fakeChild;
    });

    await runTask(task);

    const argv = captured[0].args.join(" ");
    expect(argv).not.toContain("--run-id");
    expect(argv).not.toContain("--logs-root");
  });
});
```

Note: the existing test file already imports `mkdirSync` and `join`. If not, add to the existing import block at the top.

- [x] **Step 2: Run the test to confirm both `it` cases fail**

Run: `npx vitest run src/daemon/tests/runner.test.ts -t "argv augmentation"`
Expected: FAIL — first case fails on `expect(argv).toContain("--run-id …")` because today the daemon does not augment argv.

### Task 2.7a: Implement argv augmentation in `runTask` (no breadcrumbs yet)

Anchor edits on identifiers, not line numbers — line numbers will drift mid-chunk.

- [x] **Step 1: Edit `src/daemon/runner.ts` — imports**

Add (after existing imports):

```ts
import { runsDir } from "../cli/lib/apparat-paths.js";
import { resolveProjectFromArgs, injectRunArgs } from "./runner-args.js";
```

- [x] **Step 2: Replace the `cliPath` + `fullArgs` block**

Anchor: find the line `const cliPath = getRalphCliPath();` inside `runTask`. Replace from that line through the next blank line (the existing `const fullArgs = cliPath.shell ? [] : [...cliPath.args, task.command, ...task.args];`) with:

```ts
const cliPath = getRalphCliPath();

// For `pipeline run` tasks with --project, route the engine trace into the
// project-local tree so we collapse onto the existing JsonlPipelineTracer
// seam rather than maintaining a parallel home-global stream.
const projectRoot =
  task.command === "pipeline" && task.args[0] === "run"
    ? resolveProjectFromArgs(task.args)
    : null;

let augmentedArgs = task.args;
let logsRoot: string | null = null;
if (projectRoot) {
  logsRoot = join(runsDir(projectRoot), runId);
  augmentedArgs = injectRunArgs(task.args, runId, logsRoot);
}

// In test mode, the test command replaces the entire invocation (no task args appended).
const fullArgs = cliPath.shell ? [] : [...cliPath.args, task.command, ...augmentedArgs];
```

- [x] **Step 3: Run the augmentation test**

Run: `npx vitest run src/daemon/tests/runner.test.ts -t "argv augmentation"`
Expected: PASS — both `it` cases pass.

- [x] **Step 4: Run the full daemon-runner suite to catch mock-spawn flakes**

Run: `npx vitest run src/daemon/tests/runner.test.ts`

Expected: PASS for all cases. **Caution:** Task 2.6 added `vi.mock("child_process", ...)` at file-top. vitest hoist-mock + ESM means the mock applies to ALL preceding tests in the file. Verify the existing tests (returns runId+exitCode, writes header, captures non-zero exit, env var stripping, pid file lifecycle) still pass — they rely on real `spawn`. If the mock now intercepts them, scope the mock with `vi.doMock` inside the `describe("argv augmentation")` block and call `vi.doUnmock("child_process")` after, OR move the new tests into a separate file `src/daemon/tests/runner-augmentation.test.ts` so existing tests run unaffected.

- [x] **Step 5: Commit**

```bash
git add src/daemon/runner.ts
git commit -m "feat(daemon): inject --run-id/--logs-root for pipeline-run tasks"
```

### Task 2.7b: Add the breadcrumb log lines

- [x] **Step 1: Add the start-of-run breadcrumb**

Anchor: find the existing line `appendLogLine(task.id, runId, { ts: startedAt, stream: "system", content: "Session started" });` inside `runTask`. Immediately after it, add:

```ts
if (logsRoot) {
  appendLogLine(task.id, runId, {
    ts: startedAt,
    stream: "system",
    content: `Engine trace: ${join(logsRoot, "pipeline.jsonl")}`,
  });
}
```

- [x] **Step 2: Add the close-of-run breadcrumb**

Anchor: inside the `child.on("close", (code) => { … })` handler, find the existing `appendLogLine(task.id, runId, { …, content: ` ``Session ended (exit ${exitCode})`` ` })` line. Immediately BEFORE that line, add:

```ts
if (logsRoot && projectRoot) {
  appendLogLine(task.id, runId, {
    ts: endedAt,
    stream: "system",
    content: `→ apparat pipeline trace ${runId} --project ${projectRoot}`,
  });
}
```

- [x] **Step 3: Run the full daemon-runner suite**

Run: `npx vitest run src/daemon/tests/runner.test.ts`
Expected: PASS.

- [x] **Step 4: Run the full suite**

Run: `npx vitest run`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/daemon/runner.ts
git commit -m "feat(daemon): emit Engine-trace + cross-link breadcrumbs for pipeline-run tasks"
```

### Task 2.8: Failing test — breadcrumb lines land in the home-global log

- [x] **Step 1: Append a third `it` to the same `describe` block in `src/daemon/tests/runner.test.ts`**

```ts
it("writes Engine trace breadcrumb on start and cross-link on close (pipeline-run task)", async () => {
  const project = join(testHome, "fake-project");
  mkdirSync(project, { recursive: true });
  const task = makeTask({
    id: "pipeline:fake-project",
    command: "pipeline",
    args: ["run", "smoke.dot", "--project", project],
  });

  vi.mocked(spawn).mockImplementation(() => {
    const fakeChild: any = {
      pid: 99999,
      stdout: { on: () => {} },
      stderr: { on: () => {} },
      on: (ev: string, cb: any) => { if (ev === "close") setImmediate(() => cb(0)); },
    };
    return fakeChild;
  });

  const { runId } = await runTask(task);
  const { lines } = readRunLogs(task.id, runId);

  const startCrumb = lines.find((l) => l.stream === "system" && l.content.startsWith("Engine trace: "));
  const closeCrumb = lines.find((l) => l.stream === "system" && l.content.startsWith("→ apparat pipeline trace"));

  expect(startCrumb?.content).toBe(`Engine trace: ${join(project, ".apparat", "runs", runId, "pipeline.jsonl")}`);
  expect(closeCrumb?.content).toBe(`→ apparat pipeline trace ${runId} --project ${project}`);
});
```

- [x] **Step 2: Run the test**

Run: `npx vitest run src/daemon/tests/runner.test.ts -t "breadcrumb"`
Expected: PASS (already implemented in Task 2.7; this test just asserts the contract is locked).

- [x] **Step 3: Commit**

```bash
git add src/daemon/tests/runner.test.ts
git commit -m "test(daemon): lock breadcrumb contract for pipeline-run tasks"
```

## Verification targets

- Smokes: None (no `pipelines/smoke/*.dot` exists in this repo; closest approximation is `src/cli/tests/smoke/implement-pipeline-smoke.dot`, exercised by the existing `smoke.test.ts` — confirm `npx vitest run src/cli/tests/smoke.test.ts` passes after the chunk)
- Manual exercises: `apparat heartbeat pipeline meditate --project /tmp/test-app --every 1`, wait one cycle; confirm `~/.apparat/logs/<taskId>/<runId>.log` contains an `Engine trace:` line and a `→ apparat pipeline trace <runId> --project /tmp/test-app` line, AND `/tmp/test-app/.apparat/runs/<sameRunId>/pipeline.jsonl` exists with the engine trace
- Lint: `npx tsc --noEmit`; `npx vitest run src/daemon/tests/runner-args.test.ts`; `npx vitest run src/daemon/tests/runner.test.ts`; `npx vitest run src/cli/tests/pipeline-run-runid.test.ts`
- Surfaces touched: daemon (runner, runner-args), cli-commands (pipeline/run), cli-program (flags)

**Status:** Chunk 2 complete. Commits 2476777..df6c41b. All 20 tests pass (runner-args 8, runner-augmentation 3, runner 8, pipeline-run-runid 1). tsc clean, full vitest 1382/1382 pass.

---

## Chunk 3: `projects.json` operator-state index + `recordProject` hook

This chunk adds a best-effort `~/.apparat/projects.json` written every time `apparat pipeline run` (or any caller of `pipelineRunCommand`) resolves a `--project`. It is the data source for `apparat status` (Chunk 4). Writes never throw; reads tolerate missing/malformed files. No schema migration — the file is additive and best-effort.

**Files:**
- Create: `src/cli/lib/projects-registry.ts` — `readProjects`, `recordProject`, `projectsFilePath`, `ProjectEntry`
- Modify: `src/cli/commands/pipeline/run.ts` — call `recordProject(project)` after project resolution
- Test: `src/cli/tests/projects-registry.test.ts` (new)

### Task 3.1: Failing test for `projects-registry.ts`

- [ ] **Step 1: Create `src/cli/tests/projects-registry.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, chmodSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { readProjects, recordProject, projectsFilePath } from "../lib/projects-registry.js";

let testHome: string;

beforeEach(() => {
  testHome = mkdtempSync(join(tmpdir(), "apparat-registry-"));
  process.env.HOME = testHome;
});

afterEach(() => {
  rmSync(testHome, { recursive: true, force: true });
  delete process.env.HOME;
});

describe("readProjects", () => {
  it("returns [] when projects.json does not exist", () => {
    expect(readProjects()).toEqual([]);
  });

  it("returns [] on malformed JSON without throwing", () => {
    writeFileSync(projectsFilePath(), "{not valid json");
    expect(readProjects()).toEqual([]);
  });

  it("returns parsed entries on valid JSON", () => {
    const entries = [{ path: "/work/a", lastSeen: 100 }];
    writeFileSync(projectsFilePath(), JSON.stringify(entries));
    expect(readProjects()).toEqual(entries);
  });
});

describe("recordProject", () => {
  it("creates the file with one entry on first call", () => {
    recordProject("/work/app");
    const entries = readProjects();
    expect(entries).toHaveLength(1);
    expect(entries[0].path).toBe("/work/app");
    expect(typeof entries[0].lastSeen).toBe("number");
  });

  it("is idempotent: second call updates lastSeen, no duplicate", () => {
    recordProject("/work/app");
    const first = readProjects()[0].lastSeen;
    // Simulate elapsed time
    const later = first + 1000;
    const origNow = Date.now;
    Date.now = () => later;
    try {
      recordProject("/work/app");
    } finally {
      Date.now = origNow;
    }
    const entries = readProjects();
    expect(entries).toHaveLength(1);
    expect(entries[0].lastSeen).toBe(later);
  });

  it("appends distinct paths", () => {
    recordProject("/work/a");
    recordProject("/work/b");
    const paths = readProjects().map((e) => e.path).sort();
    expect(paths).toEqual(["/work/a", "/work/b"]);
  });

  it("does not throw when home directory is unwritable", function () {
    // Skip on root: chmod 500 doesn't restrict root, so the test is moot.
    if (typeof process.getuid === "function" && process.getuid() === 0) {
      return; // skip on root (CI may run as root)
    }
    chmodSync(testHome, 0o500);
    try {
      // Must not throw.
      expect(() => recordProject("/work/c")).not.toThrow();
    } finally {
      chmodSync(testHome, 0o700);
    }
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run src/cli/tests/projects-registry.test.ts`
Expected: FAIL — module-not-found on `../lib/projects-registry.js`.

### Task 3.2: Implement `projects-registry.ts`

- [ ] **Step 1: Create `src/cli/lib/projects-registry.ts`**

```ts
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { getApparatHome } from "../../daemon/state.js";

export interface ProjectEntry {
  path: string;       // absolute path
  lastSeen: number;   // epoch ms
}

const PROJECTS_FILE = "projects.json";

export function projectsFilePath(): string {
  return join(getApparatHome(), PROJECTS_FILE);
}

export function readProjects(): ProjectEntry[] {
  const p = projectsFilePath();
  if (!existsSync(p)) return [];
  try {
    return JSON.parse(readFileSync(p, "utf8")) as ProjectEntry[];
  } catch {
    return [];
  }
}

/**
 * Idempotent: insert when absent, refresh `lastSeen` when present.
 * Never throws — operator-state index is best-effort and must not fail the caller.
 */
export function recordProject(absPath: string): void {
  try {
    mkdirSync(getApparatHome(), { recursive: true });
    const list = readProjects();
    const idx = list.findIndex((e) => e.path === absPath);
    const now = Date.now();
    if (idx === -1) list.push({ path: absPath, lastSeen: now });
    else list[idx] = { ...list[idx], lastSeen: now };
    writeFileSync(projectsFilePath(), JSON.stringify(list, null, 2) + "\n");
  } catch {
    // Best-effort. Swallow.
  }
}
```

- [ ] **Step 2: Run the new tests**

Run: `npx vitest run src/cli/tests/projects-registry.test.ts`
Expected: PASS (all 7 `it` cases).

- [ ] **Step 3: Commit**

```bash
git add src/cli/lib/projects-registry.ts src/cli/tests/projects-registry.test.ts
git commit -m "feat(registry): add projects.json operator-state index"
```

### Task 3.3: Wire `recordProject` into `pipelineRunCommand`

- [ ] **Step 1: Edit `src/cli/commands/pipeline/run.ts`**

Add the import near the existing `import { runsDir } …` line:

```ts
import { recordProject } from "../../lib/projects-registry.js";
```

After the existing `const project = loaded.projectRoot;` at `:57`, insert:

```ts
if (project) recordProject(project);
```

The guard against `null`/`undefined` avoids polluting `projects.json` for runs that never resolved a project (interactive headless runs are already rejected upstream at `:120-125`, but defence-in-depth is cheap).

- [ ] **Step 2: Failing test — `pipelineRunCommand` records the project**

Append to `src/cli/tests/pipeline-run-runid.test.ts` (or create `src/cli/tests/pipeline-run-records-project.test.ts`):

```ts
import { readProjects } from "../lib/projects-registry.js";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("pipelineRunCommand records the project in ~/.apparat/projects.json", () => {
  it("appends the absolute project path with lastSeen", async () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "apparat-rec-home-"));
    const origHome = process.env.HOME;
    process.env.HOME = fakeHome;
    const project = mkdtempSync(join(tmpdir(), "apparat-rec-proj-"));
    const dotFile = join(project, "smoke.dot");
    writeFileSync(
      dotFile,
      'digraph smoke { goal="t"; start [shape=Mdiamond]; done [shape=Msquare]; start -> done; }\n',
    );
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((c?: number) => { throw new Error(`exit:${c}`); }) as any);
    try {
      await pipelineRunCommand(dotFile, { project });
    } catch {} finally { exitSpy.mockRestore(); }

    const entries = readProjects();
    expect(entries.find((e) => e.path === project)).toBeTruthy();

    process.env.HOME = origHome;
    rmSync(fakeHome, { recursive: true, force: true });
    rmSync(project, { recursive: true, force: true });
  });
});
```

- [ ] **Step 3: Run the test**

Run: `npx vitest run src/cli/tests/pipeline-run-runid.test.ts -t "records the project"`
Expected: PASS — `recordProject` was wired in Step 1.

- [ ] **Step 4: Run the full suite**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/pipeline/run.ts src/cli/tests/pipeline-run-runid.test.ts
git commit -m "feat(pipeline/run): record --project in ~/.apparat/projects.json"
```

## Verification targets

- Smokes: None
- Manual exercises: Run `apparat pipeline run pipelines/foo.dot --project ./bar` → `cat ~/.apparat/projects.json` shows `[{"path":"<abs>/bar","lastSeen":…}]`. Re-run → entry count unchanged, `lastSeen` advances. `chmod 500 ~/.apparat` → re-run → command exits normally (writes silently no-op).
- Lint: `npx tsc --noEmit`; `npx vitest run src/cli/tests/projects-registry.test.ts`; `npx vitest run src/cli/tests/pipeline-run-runid.test.ts`
- Surfaces touched: cli-lib (projects-registry), cli-commands (pipeline/run)

---

## Chunk 4: `readLastRunOutcome` helper + `apparat status` command

`apparat status` is the cross-project glance command. It reads `projects.json`, asks the daemon for tasks (with a timeout to degrade gracefully when offline), and looks up each project's last completed run by walking `<project>/.apparat/runs/<runId>/pipeline.jsonl` for the latest `pipeline-end` event. Output is plain `output.info` text — scriptable, copy-pasteable, no Ink overhead (Ink is reserved for `apparat watch` in Chunk 5).

The `readLastRunOutcome` helper is **shared infrastructure** with the `2026-05-07-pipeline-mission-control-fragmentation-design.md` design. If that design landed first and the file `src/cli/lib/pipeline-status.ts` already exists, **skip the create step in Task 4.2** and re-use the existing export. Verify with `ls src/cli/lib/pipeline-status.ts`. If the file does not exist, this chunk creates it.

**Files:**
- Create (or reuse): `src/cli/lib/pipeline-status.ts` — `readLastRunOutcome`, `LastRunOutcome` type
- Create: `src/cli/commands/status.ts` — `statusCommand`
- Modify: `src/cli/program.ts` — register `apparat status`
- Test: `src/cli/tests/pipeline-status.test.ts` (new — only if creating the helper this chunk; skip if already exists)
- Test: `src/cli/tests/status.test.ts` (new)

### Task 4.1: Sanity-check whether `pipeline-status.ts` already exists

- [ ] **Step 1: Check the file**

Run: `ls src/cli/lib/pipeline-status.ts 2>/dev/null && echo EXISTS || echo MISSING`

If `EXISTS`: skip to **Task 4.3**. The helper is already in place; `apparat status` consumes the existing export.

If `MISSING`: continue with Task 4.2.

### Task 4.2: Failing test + implementation for `readLastRunOutcome` (only if missing)

- [ ] **Step 0: Lock the on-disk event shape**

Read `src/attractor/tracer/jsonl-pipeline-tracer.ts` and find `onPipelineEnd`. Confirm the appended record shape. Verified at plan-write time:

```ts
this.append({
  kind: "pipeline-end",
  runId,
  outcome,            // "success" | "failure"
  timestamp,          // ISO string from new Date().toISOString()
});
```

Field names: `kind` (NOT `event`), `outcome` (NOT `status`), `timestamp` (ISO string, NOT `ts` epoch ms). Both the fixtures and the implementation below use these names — do NOT regress to the field names from the original review feedback.

- [ ] **Step 1: Create `src/cli/tests/pipeline-status.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { readLastRunOutcome } from "../lib/pipeline-status.js";

let runsRoot: string;

beforeEach(() => {
  runsRoot = mkdtempSync(join(tmpdir(), "apparat-runs-"));
});
afterEach(() => rmSync(runsRoot, { recursive: true, force: true }));

function writeJsonl(runId: string, lines: object[]): void {
  const dir = join(runsRoot, runId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "pipeline.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
}

describe("readLastRunOutcome", () => {
  it("returns null when runs root does not exist", () => {
    expect(readLastRunOutcome(join(runsRoot, "nope"))).toBeNull();
  });

  it("returns null when no runs are present", () => {
    expect(readLastRunOutcome(runsRoot)).toBeNull();
  });

  it("returns null when the latest run has no pipeline-end event", () => {
    writeJsonl("aaaaaaaa", [{ kind: "pipeline-start", runId: "aaaaaaaa", timestamp: "2026-05-09T00:00:00Z" }]);
    expect(readLastRunOutcome(runsRoot)).toBeNull();
  });

  it("returns success outcome when the latest pipeline-end has outcome=success", () => {
    writeJsonl("aaaaaaaa", [
      { kind: "pipeline-start", runId: "aaaaaaaa", timestamp: "2026-05-09T00:00:00Z" },
      { kind: "pipeline-end", runId: "aaaaaaaa", outcome: "success", timestamp: "2026-05-09T00:01:00Z" },
    ]);
    const out = readLastRunOutcome(runsRoot);
    expect(out?.outcome).toBe("success");
    expect(out?.runId).toBe("aaaaaaaa");
  });

  it("returns failure outcome when the latest pipeline-end has outcome=failure", () => {
    writeJsonl("aaaaaaaa", [
      { kind: "pipeline-end", runId: "aaaaaaaa", outcome: "failure", timestamp: "2026-05-09T00:01:00Z" },
    ]);
    const out = readLastRunOutcome(runsRoot);
    expect(out?.outcome).toBe("failure");
  });

  it("picks the most recent run by directory mtime when multiple exist", async () => {
    writeJsonl("oldoldoo", [{ kind: "pipeline-end", runId: "oldoldoo", outcome: "success", timestamp: "2026-05-09T00:01:00Z" }]);
    await new Promise((r) => setTimeout(r, 20));
    writeJsonl("newnewno", [{ kind: "pipeline-end", runId: "newnewno", outcome: "failure", timestamp: "2026-05-09T00:02:00Z" }]);
    const out = readLastRunOutcome(runsRoot);
    expect(out?.runId).toBe("newnewno");
    expect(out?.outcome).toBe("failure");
  });

  it("tolerates malformed lines (skips them)", () => {
    const dir = join(runsRoot, "aaaaaaaa");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "pipeline.jsonl"),
      "garbage line\n" + JSON.stringify({ kind: "pipeline-end", runId: "aaaaaaaa", outcome: "success", timestamp: "2026-05-09T00:01:00Z" }) + "\n",
    );
    const out = readLastRunOutcome(runsRoot);
    expect(out?.outcome).toBe("success");
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run src/cli/tests/pipeline-status.test.ts`
Expected: FAIL — module-not-found.

- [ ] **Step 3: Implement `src/cli/lib/pipeline-status.ts`**

```ts
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

export interface LastRunOutcome {
  runId: string;
  outcome: "success" | "failure";
  timestamp: string;   // ISO string — matches JsonlPipelineTracer.onPipelineEnd
}

interface PipelineEndEvent {
  kind: "pipeline-end";
  runId: string;
  outcome: "success" | "failure";
  timestamp: string;
}

export function readLastRunOutcome(runsRoot: string): LastRunOutcome | null {
  if (!existsSync(runsRoot)) return null;
  let entries: string[];
  try {
    entries = readdirSync(runsRoot);
  } catch {
    return null;
  }
  if (entries.length === 0) return null;

  // Pick the most-recent run dir by mtime — runIds are random 8-char, no
  // lexicographic ordering signal.
  const ranked = entries
    .map((name) => {
      try {
        return { name, mtime: statSync(join(runsRoot, name)).mtimeMs };
      } catch {
        return null;
      }
    })
    .filter((x): x is { name: string; mtime: number } => x !== null)
    .sort((a, b) => b.mtime - a.mtime);

  for (const { name } of ranked) {
    const tracePath = join(runsRoot, name, "pipeline.jsonl");
    if (!existsSync(tracePath)) continue;
    let content: string;
    try {
      content = readFileSync(tracePath, "utf8");
    } catch {
      continue;
    }
    const lines = content.split("\n").filter(Boolean);
    let last: PipelineEndEvent | null = null;
    for (const line of lines) {
      try {
        const ev = JSON.parse(line);
        if (ev?.kind === "pipeline-end") last = ev as PipelineEndEvent;
      } catch {
        // skip malformed lines
      }
    }
    if (last) {
      return {
        runId: name,
        outcome: last.outcome === "success" ? "success" : "failure",
        timestamp: last.timestamp,
      };
    }
  }
  return null;
}
```

Field names locked in Step 0 above against `src/attractor/tracer/jsonl-pipeline-tracer.ts:51-58`: `kind`, `outcome`, `timestamp` (ISO). The tracer is the on-disk source of truth.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/cli/tests/pipeline-status.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/lib/pipeline-status.ts src/cli/tests/pipeline-status.test.ts
git commit -m "feat(pipeline-status): add readLastRunOutcome helper"
```

### Task 4.3: Failing test for `apparat status`

- [ ] **Step 1: Create `src/cli/tests/status.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// Path string MUST match the import inside src/cli/commands/status.ts
// (verify with `grep -n "from \"../../lib/daemon-client" src/cli/commands/status.ts`).
// vitest hoist-mock matching is path-string sensitive in ESM.
vi.mock("../../lib/daemon-client.js", () => ({
  request: vi.fn(),
}));

import { request } from "../../lib/daemon-client.js";
import { recordProject } from "../lib/projects-registry.js";
import { statusCommand } from "../commands/status.js";

let testHome: string;
let captured: string[];

beforeEach(() => {
  testHome = mkdtempSync(join(tmpdir(), "apparat-status-"));
  process.env.HOME = testHome;
  captured = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: any) => {
    captured.push(String(chunk));
    return true;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(testHome, { recursive: true, force: true });
  delete process.env.HOME;
});

function output(): string {
  return captured.join("");
}

describe("apparat status", () => {
  it("prints empty-registry message when no projects are registered", async () => {
    vi.mocked(request).mockResolvedValue({ type: "tasks", data: [] });
    await statusCommand();
    expect(output()).toContain("No projects registered yet");
  });

  it("lists registered projects with task counts", async () => {
    const project = mkdtempSync(join(tmpdir(), "apparat-status-proj-"));
    recordProject(project);
    vi.mocked(request).mockResolvedValue({
      type: "tasks",
      data: [{ id: "pipeline:" + project, command: "pipeline", args: ["run", "x.dot", "--project", project] }],
    });
    await statusCommand();
    const out = output();
    expect(out).toContain(project);
    expect(out).toContain("heartbeat tasks");
    rmSync(project, { recursive: true, force: true });
  });

  it("renders (daemon offline) when request times out / rejects", async () => {
    const project = mkdtempSync(join(tmpdir(), "apparat-status-proj-"));
    recordProject(project);
    vi.mocked(request).mockRejectedValue(new Error("ECONNREFUSED"));
    await statusCommand();
    expect(output()).toContain("(daemon offline)");
    rmSync(project, { recursive: true, force: true });
  });

  it("prints '(no runs yet)' for projects with no runs dir", async () => {
    const project = mkdtempSync(join(tmpdir(), "apparat-status-proj-"));
    recordProject(project);
    vi.mocked(request).mockResolvedValue({ type: "tasks", data: [] });
    await statusCommand();
    expect(output()).toContain("(no runs yet)");
    rmSync(project, { recursive: true, force: true });
  });

  it("prints last run outcome when project has a run with pipeline-end", async () => {
    const project = mkdtempSync(join(tmpdir(), "apparat-status-proj-"));
    recordProject(project);
    const runDir = join(project, ".apparat", "runs", "abcd1234");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, "pipeline.jsonl"),
      JSON.stringify({ kind: "pipeline-end", runId: "abcd1234", outcome: "success", timestamp: "2026-05-09T12:00:00Z" }) + "\n");
    vi.mocked(request).mockResolvedValue({ type: "tasks", data: [] });
    await statusCommand();
    const out = output();
    expect(out).toContain("abcd1234");
    expect(out).toContain("success");
    rmSync(project, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run src/cli/tests/status.test.ts`
Expected: FAIL — `../commands/status.js` does not exist.

### Task 4.4: Implement `apparat status`

- [ ] **Step 1: Create `src/cli/commands/status.ts`**

```ts
import { request } from "../../lib/daemon-client.js";
import { readProjects } from "../lib/projects-registry.js";
import { runsDir } from "../lib/apparat-paths.js";
import { readLastRunOutcome } from "../lib/pipeline-status.js";
import * as output from "../lib/output.js";
import type { Task } from "../../daemon/state.js";

interface ListTasksResponse {
  type: "tasks";
  data: Task[];
}

const DAEMON_TIMEOUT_MS = 1500;

async function listTasksWithTimeout(): Promise<Task[] | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), DAEMON_TIMEOUT_MS);
    request("list_tasks")
      .then((res) => {
        clearTimeout(timer);
        const r = res as ListTasksResponse;
        resolve(r?.data ?? []);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(null);
      });
  });
}

export async function statusCommand(): Promise<void> {
  const projects = readProjects();
  if (projects.length === 0) {
    await output.info("No projects registered yet. Run `apparat pipeline run …` in a project to register it.");
    return;
  }
  const tasks = await listTasksWithTimeout();
  await output.info(`Apparat status — ${projects.length} project(s)\n`);
  for (const p of [...projects].sort((a, b) => b.lastSeen - a.lastSeen)) {
    const projTasks = tasks === null
      ? null
      : tasks.filter((t) => t.args.includes(p.path));
    const last = readLastRunOutcome(runsDir(p.path));
    await output.info(`  ${p.path}`);
    await output.info(`    last seen: ${new Date(p.lastSeen).toLocaleString()}`);
    if (projTasks === null) {
      await output.info(`    heartbeat tasks: (daemon offline)`);
    } else {
      await output.info(`    heartbeat tasks: ${projTasks.length === 0 ? "(none)" : projTasks.map((t) => t.id).join(", ")}`);
    }
    if (last) {
      await output.info(`    last run: ${last.runId} — ${last.outcome} at ${last.timestamp}`);
    } else {
      await output.info(`    last run: (no runs yet)`);
    }
    await output.info("");
  }
}
```

- [ ] **Step 2: Verify the output sink before running tests**

Required preflight: read `src/cli/lib/output.ts` and confirm what `output.info` writes to (stdout via `process.stdout.write`, `console.log`, or a custom sink). The Chunk 4 Task 4.3 status test spies on `process.stdout.write`. If `output.info` does NOT eventually write to `process.stdout`, change the spy target in the test to match the actual sink (e.g. `vi.spyOn(console, "log")`). The contract is: `apparat status` produces operator-readable text that the test can capture; the spy target is implementation-coupled.

- [ ] **Step 3: Run the status tests**

Run: `npx vitest run src/cli/tests/status.test.ts`
Expected: PASS (all 5 `it` cases).

- [ ] **Step 4: Commit**

```bash
git add src/cli/commands/status.ts src/cli/tests/status.test.ts
git commit -m "feat(status): add apparat status command"
```

### Task 4.5: Register `apparat status` in `src/cli/program.ts`

- [ ] **Step 1: Edit `src/cli/program.ts`**

Add the import at the top, alongside other command imports:

```ts
import { statusCommand } from "./commands/status.js";
```

In the body of `createProgram`, immediately before the `registerHeartbeatCommand(program);` line, add:

```ts
program
  .command("status")
  .description("Cross-project status: registered projects, heartbeats, and recent runs")
  .action(async () => {
    await statusCommand();
  });
```

- [ ] **Step 2: Wire the help text**

In the existing `program.addHelpText("after", …)` template literal (anchor on the literal — line numbers will have drifted as Chunks 4 and 5 add imports), append a new section after the `Meditation (restricted insight sessions):` block:

```
Cross-project status:
  apparat status                            Cross-project status: projects, heartbeats, recent runs
```

- [ ] **Step 3: Compile-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Smoke the registration**

Run: `npx tsx src/cli/index.ts status`
Expected: command runs (prints "No projects registered yet" when home is fresh, or lists projects). No "unknown command" error.

- [ ] **Step 5: Commit**

```bash
git add src/cli/program.ts
git commit -m "feat(cli): register apparat status top-level command"
```

## Verification targets

- Smokes: None
- Manual exercises: `apparat status` (empty registry → prints onboarding message, exit 0); `apparat pipeline run smoke.dot --project ./bar` then `apparat status` (lists `./bar`, shows last run outcome, shows registered heartbeats); kill daemon then `apparat status` (shows `(daemon offline)` for tasks line, exits 0)
- Lint: `npx tsc --noEmit`; `npx vitest run src/cli/tests/pipeline-status.test.ts`; `npx vitest run src/cli/tests/status.test.ts`
- Surfaces touched: cli-lib (pipeline-status), cli-commands (status), cli-program

---

## Chunk 5: `apparat watch` — composed Ink app + `HeartbeatPane` extraction + deprecation alias

This chunk is the load-bearing constraint flagged in `chat_summarizer.refinements` bullet 4: `apparat watch` MUST be a single Ink root composing `HeartbeatPane` (renamed from the current inner `WatchApp` in `HeartbeatWatch.tsx`) AND `PipelineApp` as child components. **Not a wrapper that shells out** — that would re-introduce the fragmentation the design is meant to remove. If during implementation the existing `HeartbeatPane`/`PipelineApp` make composition difficult (e.g. both grab the Ink root's `q`-to-quit), the right fix is to lift input handling into `WatchApp` and thread callbacks down — not to fall back to two separate processes.

The existing `apparat heartbeat watch` is preserved as a deprecation alias with a stderr notice for one release.

**Files:**
- Modify: `src/cli/components/HeartbeatWatch.tsx` — rename inner `WatchApp` → `HeartbeatPane` and **export it**; rewrite `renderWatch` as a deprecation shim
- Create: `src/cli/components/WatchApp.tsx` — Ink root composing `HeartbeatPane` + `PipelineApp`; project selection drives which pipeline trace is rendered
- Create: `src/cli/commands/watch.ts` — entry that calls `renderWatchApp()`
- Modify: `src/cli/program.ts` — register `apparat watch` (top-level)
- (No direct edit to `src/cli/commands/heartbeat.ts` needed — the existing `hb.command("watch")` action already calls `renderWatch()` from `HeartbeatWatch.tsx`, which prints the deprecation notice and forwards to `renderWatchApp` after the Task 5.1 edit. Verify by reading the action at `hb.command("watch")` in `heartbeat.ts`; it should still resolve to the updated `renderWatch`.)
- Test: `src/cli/tests/watch.test.ts` (new — minimal smoke: command registered, deprecation notice fires)

### Task 5.0: Composition feasibility check — required prerequisite

The design's load-bearing constraint (refinement #4) is that `apparat watch` MUST compose `HeartbeatPane` AND `PipelineApp` as React children inside one Ink root — NOT a wrapper that shells out to two separate processes. This task verifies whether the existing `PipelineApp` can be composed as-is, or whether a small refactor is required first.

- [ ] **Step 1: Read `src/cli/components/PipelineApp.tsx` lines 1-60**

Locate the `PipelineApp` Props interface and the export. Verified at plan-write time: `PipelineApp` is exported as a React component (`export function PipelineApp(...)`) at line 50, but its Props are:

```ts
interface Props {
  pipelineName: string;
  pid: number;
  goal?: string;
  nodes: string[];
  runId: string;
  tracePath: string;
  onReady: (cbs: PipelineAppCallbacks) => void;   // event-driven, NOT static
}
```

`PipelineApp` is event-driven: it expects `onReady` to receive an `emit(NodeEvent)` callback that the parent uses to push live events. It does NOT consume a static JSONL trace and replay it.

- [ ] **Step 2: Decide the composition path**

**Option A — replay JSONL into `emit()` (preferred):** the implementing session writes a small `replayTraceIntoApp(tracePath, emit)` helper that reads `<runDir>/pipeline.jsonl`, maps each event to the corresponding `NodeEvent` (`{kind: "start", ...}`, `{kind: "stream-line", ...}`, `{kind: "end", ...}`, etc.), and calls `emit(...)` per event. `WatchApp` mounts `<PipelineApp ... onReady={(cbs) => replayTraceIntoApp(tracePath, cbs.emit)} />`. The trace replays once on mount; the user sees the latest completed run rendered exactly the way it looked live.

**Option B — split `PipelineApp` into a pure-static-renderer subcomponent:** factor the `staticItems`-rendering portion of `PipelineApp` into a new `<PipelineTraceView staticItems={...} />` component. `WatchApp` builds `staticItems` from the JSONL directly. More invasive — touches `PipelineApp.tsx`'s internals.

**Decision rule:** default to Option A. It is a strictly additive change (new helper, no `PipelineApp.tsx` edits) and matches the engine→reducer→render pipeline that already produces the same `staticItems` shape from a live `emit` stream. Option B is the fallback if Option A's mapping turns out to be lossy or invasive.

If neither option is achievable in this chunk's scope, **STOP and surface to the user** — do NOT fall back to a shell-out wrapper. The design's load-bearing constraint is non-negotiable.

- [ ] **Step 3: If Option A is chosen, sketch the helper signature**

```ts
// src/cli/lib/replayTraceIntoApp.ts (NEW)
import { readFileSync } from "fs";
import type { NodeEvent } from "./pipelineEvents.js";

export function replayTraceIntoApp(tracePath: string, emit: (ev: NodeEvent) => void): void {
  const lines = readFileSync(tracePath, "utf8").split("\n").filter(Boolean);
  for (const line of lines) {
    let ev: any;
    try { ev = JSON.parse(line); } catch { continue; }
    // Map JsonlPipelineTracer events → NodeEvent shape consumed by PipelineApp.
    // The exact mapping is implementation-defined and lives behind this seam;
    // verify against src/cli/lib/pipelineEvents.ts NodeEvent union and
    // src/attractor/tracer/jsonl-pipeline-tracer.ts emit shapes.
  }
}
```

The mapping body is intentionally a stub at plan time — the implementer reads both files and writes the explicit case-by-case mapping. Mapping correctness is covered by Task 5.6 below.

### Task 5.1: Extract `HeartbeatPane` from `HeartbeatWatch.tsx`

- [ ] **Step 1: Edit `src/cli/components/HeartbeatWatch.tsx`**

Rename the function `WatchApp` → `HeartbeatPane` and add `export` to the declaration. Preserve the body verbatim.

```ts
export function HeartbeatPane(): React.ReactElement {
  // … existing body unchanged …
}
```

Update `renderWatch` (the deprecation shim — line numbers will have drifted as Tasks 5.0 land; anchor on the function name):

```ts
import { renderWatchApp } from "./WatchApp.js";

export async function renderWatch(): Promise<void> {
  process.stderr.write("[apparat] `heartbeat watch` is deprecated; use `apparat watch` instead.\n");
  await renderWatchApp();
}
```

Static import is safe: `WatchApp.tsx` imports `HeartbeatPane` from this file, but does not import `renderWatch`. No cycle.

- [ ] **Step 2: Compile-check**

Run: `npx tsc --noEmit`
Expected: FAIL with "Cannot find module './WatchApp.js'" — that's expected; we create it next.

### Task 5.2: Create `src/cli/components/WatchApp.tsx` — composed Ink root

- [ ] **Step 1: Create `src/cli/lib/replayTraceIntoApp.ts` (Option A from Task 5.0)**

Write the helper. The implementer must read `src/cli/lib/pipelineEvents.ts` for the `NodeEvent` union and `src/attractor/tracer/jsonl-pipeline-tracer.ts` for the on-disk event shapes (`pipeline-start`, `node-start`, `node-end`, `pipeline-end`, `validation-failure`). Then write the explicit mapping. Skeleton:

```ts
// src/cli/lib/replayTraceIntoApp.ts
import { readFileSync, existsSync } from "fs";
import type { NodeEvent } from "./pipelineEvents.js";

export function replayTraceIntoApp(tracePath: string, emit: (ev: NodeEvent) => void): void {
  if (!existsSync(tracePath)) return;
  const lines = readFileSync(tracePath, "utf8").split("\n").filter(Boolean);
  for (const line of lines) {
    let trace: any;
    try { trace = JSON.parse(line); } catch { continue; }
    // Map JsonlPipelineTracer event kinds → NodeEvent. Fill in concretely
    // after reading both source files. Examples (verify exact shapes):
    //   trace.kind === "node-start" → emit({ kind: "start", nodeId, label, ... })
    //   trace.kind === "node-end"   → emit({ kind: "end",   outcome })
    //   trace.kind === "pipeline-end" → no-op (PipelineApp draws its own footer)
  }
}
```

- [ ] **Step 2: Create a unit test for the helper**

`src/cli/tests/replayTraceIntoApp.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { replayTraceIntoApp } from "../lib/replayTraceIntoApp.js";

describe("replayTraceIntoApp", () => {
  it("emits a start+end pair for a node-start/node-end pair in the trace", () => {
    const dir = mkdtempSync(join(tmpdir(), "apparat-replay-"));
    const tracePath = join(dir, "pipeline.jsonl");
    writeFileSync(tracePath, [
      JSON.stringify({ kind: "pipeline-start", runId: "abcd1234", graph: { name: "t", nodes: [] }, timestamp: "t0" }),
      JSON.stringify({ kind: "node-start", nodeId: "work", nodeReceiveId: "work-1", timestamp: "t1" }),
      JSON.stringify({ kind: "node-end", nodeId: "work", success: true, contextUpdates: {}, timestamp: "t2" }),
      JSON.stringify({ kind: "pipeline-end", runId: "abcd1234", outcome: "success", timestamp: "t3" }),
    ].join("\n") + "\n");

    const emit = vi.fn();
    replayTraceIntoApp(tracePath, emit);

    // Concrete assertions depend on the explicit mapping the implementer writes.
    // At minimum: emit must have been called with at least one start-shaped event.
    expect(emit).toHaveBeenCalled();
    const kinds = emit.mock.calls.map((c) => (c[0] as any).kind);
    expect(kinds).toContain("start");
    expect(kinds).toContain("end");

    rmSync(dir, { recursive: true, force: true });
  });

  it("returns silently when the trace file does not exist", () => {
    const emit = vi.fn();
    replayTraceIntoApp("/no/such/path.jsonl", emit);
    expect(emit).not.toHaveBeenCalled();
  });

  it("tolerates malformed lines (skips them)", () => {
    const dir = mkdtempSync(join(tmpdir(), "apparat-replay-bad-"));
    const tracePath = join(dir, "pipeline.jsonl");
    writeFileSync(tracePath, "garbage\n" + JSON.stringify({ kind: "node-start", nodeId: "x", nodeReceiveId: "x-1" }) + "\n");
    const emit = vi.fn();
    expect(() => replayTraceIntoApp(tracePath, emit)).not.toThrow();
    rmSync(dir, { recursive: true, force: true });
  });
});
```

Run: `npx vitest run src/cli/tests/replayTraceIntoApp.test.ts`
Expected: FAIL initially (mapping is stubbed), then PASS once the mapping is implemented.

- [ ] **Step 3: Create `src/cli/components/WatchApp.tsx`**

```tsx
// src/cli/components/WatchApp.tsx
//
// Composed Ink root for `apparat watch`. REUSES HeartbeatPane and PipelineApp
// as React children — design REQUIRES composition, not a shell-out facade. See
// docs/superpowers/specs/2026-05-09-two-run-homes-no-cross-project-view-design.md §3.6.

import React, { useState, useEffect } from "react";
import { render, Box, Text, useInput, useApp } from "ink";
import { HeartbeatPane } from "./HeartbeatWatch.js";
import { PipelineApp, type PipelineAppCallbacks } from "./PipelineApp.js";
import { readProjects } from "../lib/projects-registry.js";
import { runsDir } from "../lib/apparat-paths.js";
import { readLastRunOutcome } from "../lib/pipeline-status.js";
import { replayTraceIntoApp } from "../lib/replayTraceIntoApp.js";
import { existsSync } from "fs";
import { join } from "path";

function WatchApp(): React.ReactElement {
  const { exit } = useApp();
  const projects = readProjects();
  const [selectedIdx, setSelectedIdx] = useState(0);
  const selectedProject = projects[selectedIdx];

  // Resolve the latest completed run for the selected project, if any.
  let tracePath: string | null = null;
  let lastRunId: string | null = null;
  if (selectedProject) {
    const last = readLastRunOutcome(runsDir(selectedProject.path));
    if (last) {
      lastRunId = last.runId;
      const candidate = join(runsDir(selectedProject.path), last.runId, "pipeline.jsonl");
      if (existsSync(candidate)) tracePath = candidate;
    }
  }

  useInput((input, key) => {
    if (input === "q") exit();
    if (key.tab) setSelectedIdx((i) => (i + 1) % Math.max(1, projects.length));
  });

  return (
    <Box flexDirection="column">
      <Text bold>apparat watch — {projects.length} project(s)</Text>
      <Text dimColor>tab: switch project ({selectedProject?.path ?? "—"})  •  q: quit</Text>
      <Box marginTop={1}>
        <HeartbeatPane />
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text bold>Latest run for {selectedProject?.path ?? "(no projects)"}</Text>
        {tracePath && lastRunId ? (
          <PipelineApp
            pipelineName="(replayed)"
            pid={process.pid}
            nodes={[]}
            runId={lastRunId}
            tracePath={tracePath}
            onReady={(cbs: PipelineAppCallbacks) => replayTraceIntoApp(tracePath!, cbs.emit)}
          />
        ) : (
          <Text dimColor>(no completed runs)</Text>
        )}
      </Box>
    </Box>
  );
}

export async function renderWatchApp(): Promise<void> {
  const { waitUntilExit } = render(<WatchApp />);
  await waitUntilExit();
}
```

This is the *real* composition: `<PipelineApp>` is mounted as a child of `<WatchApp>`, and the trace replay drives its `emit`-callback API. If at run time `PipelineApp` proves incompatible with composition (e.g. it captures `useInput` for `q` and steals it from the parent, or `useApp().exit` collides with the parent's exit), the implementer's options are:
1. Lift input handling into `WatchApp` and thread props down (small refactor inside `PipelineApp`).
2. Wrap `PipelineApp`'s `useApp`/`useInput` calls in a "child-mode" guard.

**Do NOT fall back to a shell-out wrapper.** Surface to the user instead — the design's load-bearing constraint is non-negotiable.

- [ ] **Step 4: Compile-check**

Run: `npx tsc --noEmit`
Expected: PASS.

### Task 5.3: Create `src/cli/commands/watch.ts`

- [ ] **Step 1: Create the file**

```ts
// src/cli/commands/watch.ts
import { renderWatchApp } from "../components/WatchApp.js";

export async function watchCommand(): Promise<void> {
  await renderWatchApp();
}
```

- [ ] **Step 2: Register in `src/cli/program.ts`**

Add the import:

```ts
import { watchCommand } from "./commands/watch.js";
```

Add the registration immediately after the new `program.command("status")` block (Chunk 4):

```ts
program
  .command("watch")
  .description("Live cross-project dashboard (composes heartbeat watch and pipeline run TUIs)")
  .action(async () => {
    await watchCommand();
  });
```

Also update the help-text block: replace the existing `apparat heartbeat watch                                 Live TUI dashboard` line with:

```
  apparat heartbeat watch                                 Live TUI dashboard (deprecated alias for `apparat watch`)
```

And add a new entry in the new `Cross-project status:` block (introduced in Chunk 4):

```
  apparat watch                             Live cross-project dashboard
```

- [ ] **Step 3: Smoke the registration**

Run: `npx tsx src/cli/index.ts --help`
Expected: help text lists `apparat watch` as a top-level command.

- [ ] **Step 4: Commit (so far — Tasks 5.1–5.3)**

```bash
git add src/cli/components/HeartbeatWatch.tsx src/cli/components/WatchApp.tsx src/cli/commands/watch.ts src/cli/program.ts
git commit -m "feat(watch): apparat watch — composed Ink dashboard; deprecation alias for heartbeat watch"
```

### Task 5.4: Failing test for the deprecation notice

- [ ] **Step 1: Create `src/cli/tests/watch.test.ts`**

```ts
import { describe, it, expect, vi } from "vitest";

// Mock WatchApp BEFORE the static import inside HeartbeatWatch resolves.
// vitest hoist-mock + ESM: the path string here MUST match the import string
// in HeartbeatWatch.tsx ("./WatchApp.js"). Verify with:
//   grep -n "WatchApp" src/cli/components/HeartbeatWatch.tsx
vi.mock("../components/WatchApp.js", () => ({
  renderWatchApp: vi.fn().mockResolvedValue(undefined),
}));

import { renderWatch } from "../components/HeartbeatWatch";
import { renderWatchApp } from "../components/WatchApp.js";

describe("`heartbeat watch` deprecation alias", () => {
  it("prints a deprecation notice to stderr and forwards to renderWatchApp", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await renderWatch();
    const stderrCalls = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stderrCalls).toContain("`heartbeat watch` is deprecated");
    expect(renderWatchApp).toHaveBeenCalled();
    stderrSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run src/cli/tests/watch.test.ts`
Expected: PASS — the deprecation forwarding was wired in Task 5.1.

- [ ] **Step 3: Commit**

```bash
git add src/cli/tests/watch.test.ts
git commit -m "test(watch): lock heartbeat-watch deprecation forwarding"
```

### Task 5.5a: Lock the composition contract with `ink-testing-library`

This automated assertion guards the load-bearing refinement from regressing into a shell-out facade.

- [ ] **Step 1: Confirm `ink-testing-library` is available**

Run: `npm ls ink-testing-library 2>/dev/null || npm view ink-testing-library version`
If missing: `npm install --save-dev ink-testing-library` and commit `package.json` + lockfile changes in a separate prep commit before continuing.

- [ ] **Step 2: Create `src/cli/tests/watch-composition.test.tsx`**

```tsx
import { describe, it, expect, vi } from "vitest";
import React from "react";

// The composition test renders WatchApp into ink-testing-library's render()
// and asserts the component tree contains BOTH HeartbeatPane and PipelineApp.
// Stub the heavy children (daemon stream, JSONL replay) so the render is pure.

vi.mock("../components/HeartbeatWatch.js", () => ({
  HeartbeatPane: () => React.createElement("Text", null, "[HeartbeatPane stub]"),
}));

vi.mock("../components/PipelineApp.js", () => ({
  PipelineApp: ({ tracePath }: any) => React.createElement("Text", null, `[PipelineApp stub: ${tracePath}]`),
}));

vi.mock("../lib/projects-registry.js", () => ({
  readProjects: () => [{ path: "/work/app", lastSeen: 100 }],
}));

vi.mock("../lib/pipeline-status.js", () => ({
  readLastRunOutcome: () => ({ runId: "abcd1234", outcome: "success", timestamp: "t" }),
}));

vi.mock("fs", async (orig) => ({
  ...(await orig<typeof import("fs")>()),
  existsSync: () => true,
}));

import { render } from "ink-testing-library";
import { HeartbeatPane } from "../components/HeartbeatWatch.js";
import { PipelineApp } from "../components/PipelineApp.js";

describe("WatchApp composition", () => {
  it("renders HeartbeatPane AND PipelineApp as children (not a shell-out)", async () => {
    const { default: WatchAppModule } = await import("../components/WatchApp.js");
    // The default export shape may differ — adjust to whatever WatchApp.tsx exports.
    // The contract: rendering produces output containing both stub markers.
    const WatchApp = (WatchAppModule as any) ?? (await import("../components/WatchApp.js"));
    const tree = render(React.createElement((WatchApp as any).WatchApp ?? (WatchApp as any).default ?? (() => null)));
    const output = tree.lastFrame() ?? "";
    expect(output).toContain("[HeartbeatPane stub]");
    expect(output).toContain("[PipelineApp stub:");
    tree.unmount();
  });
});
```

Note: the test's import shape depends on what `WatchApp.tsx` exports (currently the named function `WatchApp` is internal, only `renderWatchApp` is exported). To make the component testable, **export the `WatchApp` function** from `WatchApp.tsx`:

```ts
export function WatchApp(): React.ReactElement { /* … */ }
export async function renderWatchApp(): Promise<void> { /* … */ }
```

Then the test imports `{ WatchApp }` directly:

```ts
import { WatchApp } from "../components/WatchApp.js";
const tree = render(<WatchApp />);
```

- [ ] **Step 3: Run the composition test**

Run: `npx vitest run src/cli/tests/watch-composition.test.tsx`
Expected: PASS — the rendered output contains both `[HeartbeatPane stub]` AND `[PipelineApp stub: …]`.

If the test fails because `PipelineApp` is NOT rendered (e.g. `WatchApp`'s conditional fell through), revisit Task 5.2 and the composition feasibility analysis from Task 5.0. **Do NOT delete this test to make Chunk 5 ship.** It exists specifically to guard the design constraint.

- [ ] **Step 4: Commit**

```bash
git add src/cli/components/WatchApp.tsx src/cli/tests/watch-composition.test.tsx
git commit -m "test(watch): lock WatchApp composition — HeartbeatPane + PipelineApp as children"
```

### Task 5.5: Smoke the live TUIs end-to-end

- [ ] **Step 1: Manual smoke — `apparat watch`**

Run in a real terminal:
1. `apparat heartbeat pipeline meditate --project /tmp/test-app --every 1` — schedules a task
2. `apparat watch` — confirm the heartbeat pane lists the task, the lower pane shows the project name and run path (or `(no completed runs)` if the daemon has not fired yet)
3. Press `q` → exits cleanly, no orphaned processes (`ps aux | grep apparat`)
4. Press `Tab` (with multiple registered projects) → selection moves; lower pane updates

- [ ] **Step 2: Manual smoke — `apparat heartbeat watch` deprecation**

1. Run `apparat heartbeat watch`
2. Confirm stderr line: `[apparat] heartbeat watch is deprecated; use apparat watch instead.`
3. Confirm the same composed dashboard renders
4. Press `q` → exits cleanly

If either smoke fails, the implementing session should NOT swap to a shell-out wrapper — surface the failure mode (e.g. "PipelineApp grabs the Ink root's input handler and `Tab` is consumed by it") and revisit the design's §9 open question with the user.

## Verification targets

- Smokes: None (smoke pipelines do not exist in this repo; manual TUI smoke is the right tool here)
- Manual exercises: `apparat watch` end-to-end (heartbeat pane lists tasks, lower pane shows trace path, `Tab` switches project, `q` quits cleanly); `apparat heartbeat watch` (deprecation notice prints to stderr, same dashboard renders, `q` quits cleanly); `ps aux | grep apparat` after quit (no orphans)
- Lint: `npx tsc --noEmit`; `npx vitest run src/cli/tests/watch.test.ts`
- Surfaces touched: cli-components (HeartbeatWatch, WatchApp), cli-commands (watch, heartbeat), cli-program

---

## Chunk 6: Cross-link in `heartbeat logs` output + docs (CONTEXT.md, README, ADR-0008)

The cross-link breadcrumb is *already authored by the daemon in Chunk 2*. The `heartbeat logs` consumer at `src/cli/commands/heartbeat.ts:268-291` already prints `[${msg.stream}] ${msg.content}` for every log line — so the breadcrumb passes through verbatim with no consumer-side change required. This chunk locks that behaviour with a test, then adds the documentation ripple (CONTEXT.md operator-global subsection, README command-table updates, optional ADR-0008 paragraph).

**Files:**
- Modify: `src/cli/tests/heartbeat-headless.test.ts` (or create `src/cli/tests/heartbeat-logs-crosslink.test.ts`) — assert pass-through
- Modify: `CONTEXT.md` — add "Operator-global tier" subsection
- Modify: `README.md` — add `apparat status` and `apparat watch` to the command table; mark `apparat heartbeat watch` as deprecated alias
- Modify: `docs/adr/0008-partial-revert-of-ralph-folder.md` — append paragraph documenting `~/.apparat/` as the explicit Clause-A operator-global tier (or write a new ADR-0012 if the implementing session prefers — design §9 open question)

### Task 6.1: Lock breadcrumb pass-through with a test

- [ ] **Step 1: Read the daemon-client contract first**

Read `src/lib/daemon-client.ts` and locate the exports `request` and `stream`. Confirm:
- `request(action, payload)` — returns a `Promise<...>` with the response payload (single value)
- `stream(action, payload, callback, signal)` — async function that drives `callback(msg)` for each message; the heartbeat `logs --follow` path uses `stream`, the non-follow path uses `request`

The mock shape in Step 3 below MUST match the actual return contract — otherwise the test passes against a fiction. If `request("stream_logs", { follow: false })` returns a structured object (e.g. `{ type: "logs", lines: LogLine[] }`) rather than a string, adapt the mock and the assertion accordingly.

- [ ] **Step 2: Read the existing heartbeat-logs test surface**

Run: `grep -nR "stream_logs\|heartbeat.*logs" src/cli/tests/`
Purpose: identify the right test file to extend. If `heartbeat-headless.test.ts` or `heartbeat.test.ts` already exercises the `logs` action, append there. Otherwise create `heartbeat-logs-crosslink.test.ts`.

- [ ] **Step 3: Create the test (path-string in `vi.mock` MUST match the import in `heartbeat.ts`)**

The consumer implementation at `src/cli/commands/heartbeat.ts` (logs action) uses `stream("stream_logs", ...)` for `--follow` and `request("stream_logs", ...)` otherwise. The follow path is the right one to test because it exercises per-line callbacks (closer to the production user flow).

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Command } from "commander";
import { registerHeartbeatCommand } from "../commands/heartbeat";

// Adjust the path string to whatever heartbeat.ts imports from
// (verify with: grep -n "from \"../../lib/daemon-client" src/cli/commands/heartbeat.ts)
vi.mock("../../lib/daemon-client", () => ({
  request: vi.fn(),
  stream: vi.fn(),
}));

import { request, stream } from "../../lib/daemon-client";

beforeEach(() => vi.clearAllMocks());

describe("apparat heartbeat logs --follow prints daemon-authored cross-link verbatim", () => {
  it("a system-stream line containing `→ apparat pipeline trace …` is emitted to stdout unchanged", async () => {
    // stream() drives callback per message
    vi.mocked(stream).mockImplementation(async (_action, _payload, cb) => {
      cb({ type: "log_line", stream: "system", content: "Engine trace: /work/.apparat/runs/abcd1234/pipeline.jsonl" });
      cb({ type: "log_line", stream: "stdout", content: "[engine] node: start" });
      cb({ type: "log_line", stream: "system", content: "→ apparat pipeline trace abcd1234 --project /work" });
      cb({ type: "log_line", stream: "system", content: "Session ended (exit 0)" });
    });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const program = new Command();
    program.exitOverride();
    registerHeartbeatCommand(program);
    await program.parseAsync(["node", "apparat", "heartbeat", "logs", "pipeline:work", "--follow"]);
    const out = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).toContain("→ apparat pipeline trace abcd1234 --project /work");
    logSpy.mockRestore();
  });
});
```

This test asserts the consumer prints the daemon-authored line verbatim — no transformation, no filter. That is the contract: the cross-link is *data*, not formatting.

- [ ] **Step 4: Run**

Run: `npx vitest run -t "cross-link verbatim"`
Expected: PASS — the consumer is already pass-through.

- [ ] **Step 5: Commit**

```bash
git add src/cli/tests/heartbeat-headless.test.ts  # or src/cli/tests/heartbeat-logs-crosslink.test.ts
git commit -m "test(heartbeat-logs): lock cross-link pass-through contract"
```

### Task 6.2: CONTEXT.md operator-global subsection

- [ ] **Step 1: Read CONTEXT.md to find the right insertion point**

Run: `grep -n "^##\|^###" CONTEXT.md`
Purpose: locate a suitable sibling subsection (e.g. an existing "Project-local apparat tree" section). If no such section exists, append the new subsection at the bottom under a new top-level `## Operator-global tier` heading.

- [ ] **Step 2: Add the subsection**

Insert (or append) the following block. Adjust the heading depth to match neighbouring sections:

```markdown
### Operator-global tier — `~/.apparat/`

apparat persists state at two tiers, mirroring ADR-0008's partition principle one
level up:

- **Project-local** — `<project>/.apparat/`: pipelines, agents, run traces, run
  checkpoints. Owned by the project's repo. One folder per project.
- **Operator-global** — `~/.apparat/`: orchestration state across all projects on
  this machine. Contents:
  - `tasks.json` — daemon-scheduled heartbeat tasks
  - `pids/` — running session PID files
  - `logs/<taskId>/<runId>.log` — daemon-authored orchestration breadcrumbs
    (start, end, exit code, cross-link to the project-local engine trace)
  - `projects.json` — index of project paths the operator has invoked apparat
    against, with `lastSeen` timestamps. Read by `apparat status`. Best-effort
    write per `--project`-resolving CLI invocation.

`~/.apparat/` is operator-state only. Agent definitions remain project-local
per ADR-0001.
```

- [ ] **Step 3: Commit**

```bash
git add CONTEXT.md
git commit -m "docs(context): document ~/.apparat/ operator-global tier"
```

### Task 6.3: README.md command-table updates

- [ ] **Step 1: Locate the README command table**

Run: `grep -n "apparat status\|apparat watch\|heartbeat watch\|## Commands\|^### " README.md`
Purpose: find the section listing apparat commands.

- [ ] **Step 2: Add rows for `apparat status` and `apparat watch`; mark `heartbeat watch` deprecated**

In the command table (or list) area, add:

- `apparat status` — Cross-project status: registered projects, scheduled heartbeats, recent runs.
- `apparat watch` — Live cross-project Ink dashboard (composes heartbeat tasks + recent runs).

And edit the existing `apparat heartbeat watch` row (if present) to read:

- `apparat heartbeat watch` — _Deprecated alias for `apparat watch`. Will be removed in a future release._

If README does not have a command table, surface to the user — adding a new table is out of scope for this docs ripple.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs(readme): add apparat status / watch; mark heartbeat watch deprecated"
```

### Task 6.4: ADR-0008 paragraph

- [ ] **Step 1: Read `docs/adr/0008-partial-revert-of-ralph-folder.md` to find the right insertion point**

Run: `cat docs/adr/0008-partial-revert-of-ralph-folder.md`
Purpose: read the partition principle in context. The new paragraph applies it to `~/.apparat/`.

- [ ] **Step 2: Append a paragraph at the end of the ADR**

```markdown
### Application: `~/.apparat/` as the operator-global tier

The same partition principle (Clause A: apparat-defined state, Clause B: no
pre-existing convention) applies one level up at the operator layer. `~/.apparat/`
holds orchestration state shared across all projects on the machine: scheduled
heartbeat tasks, PID files, orchestration breadcrumb logs, and a `projects.json`
index of paths the operator has run apparat against. Project-local
`.apparat/` continues to own the per-project state per the original ruling;
the operator-global tier is strictly orchestration state, not agent
definitions (ADR-0001 still holds — agent definitions remain project-local).
```

- [ ] **Step 3: Commit**

```bash
git add docs/adr/0008-partial-revert-of-ralph-folder.md
git commit -m "docs(adr-0008): append operator-global tier paragraph"
```

### Task 6.5: Final verification pass

- [ ] **Step 1: Full test suite**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Repo-wide grep invariants from design §8**

Run each, confirm expected counts:

- `grep -nR "randomUUID()" src/cli/commands/pipeline/run.ts src/daemon/runner.ts` — zero matches
- `grep -n "newRunId" src/cli/lib/apparat-paths.ts` — at least one
- `grep -nR "import.*projects-registry" src` — at least two importers (`pipeline/run.ts`, `commands/status.ts`)
- `grep -nR "apparat pipeline trace.*--project" src/daemon` — at least one match (cross-link breadcrumb)
- `grep -n 'command("status"' src/cli/program.ts` — one match
- `grep -n 'command("watch"' src/cli/program.ts` — one match (top-level watch)

- [ ] **Step 4: Final manual smoke**

End-to-end exercise per design §10.3:

1. `apparat heartbeat pipeline meditate --project /tmp/test-app --every 1`
2. Wait one cycle; confirm `~/.apparat/logs/<taskId>/<runId>.log` exists with 8-char runId, `Engine trace:` breadcrumb, `→ apparat pipeline trace` cross-link
3. Confirm `/tmp/test-app/.apparat/runs/<sameRunId>/pipeline.jsonl` exists with the engine trace
4. `apparat status` — `/tmp/test-app` appears with the heartbeat task and the run outcome
5. `apparat watch` — heartbeat pane lists task, lower pane shows trace path, `q` quits cleanly
6. `apparat heartbeat watch` — prints deprecation notice, same dashboard renders, `q` quits cleanly
7. `apparat heartbeat logs <task>` — output contains the cross-link line; pasting `apparat pipeline trace <runId> --project /tmp/test-app` lands on the matching JSONL

## Verification targets

- Smokes: None
- Manual exercises: end-to-end smoke per Task 6.5 Step 4 (7 steps)
- Lint: `npx tsc --noEmit`; `npx vitest run` (full suite)
- Surfaces touched: cli-tests (heartbeat consumer pass-through), docs (CONTEXT.md, README.md, docs/adr/0008-*)

---

## Open questions surfaced from the design

These mirror design §9 — flagged here so the executing session does not silently pick a side:

1. **`PipelineApp` may not expose a static-trace-viewer subcomponent.** Chunk 5 Task 5.2 Step 1 instructs the implementer to grep for the export shape. If `PipelineApp` only exposes the stream-driven `renderPipelineApp({ callbacks, waitUntilExit })`, the design's "single Ink app composing children" constraint may require first splitting `PipelineApp` into a pure-renderer subcomponent. Surface to user before falling back to a shell-out wrapper.
2. **`apparat watch` layout.** Tab-between-projects vs. column-side-by-side. The plan defaults to tab; implementer may switch — both compose the same children.
3. **Trace-event field names** (Chunk 4 Task 4.2 Step 3). The `readLastRunOutcome` implementation assumes the `pipeline-end` event has fields `event`, `status`, `ts`. If the actual `JsonlPipelineTracer` emits a different shape, adjust both the test fixtures and the implementation. The contract: locate the latest pipeline-completion record and read its terminal status.
4. **ADR-0008 paragraph vs. new ADR.** Default is paragraph appended to ADR-0008. Implementer may write ADR-0012 if the partition surfaces implications worth a dedicated record.
5. **README command table format.** If README does not have a command table, do NOT introduce one — surface to user.
