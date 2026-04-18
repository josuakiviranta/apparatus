# Surface `failureReason` in Pipeline Traces + CLI Exit — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a pipeline node fails, make its `failureReason` discoverable — persist it in the jsonl trace and print a one-line summary to stderr on pipeline exit.

**Architecture:** Two tiny edits in the observability path. The tracer (`src/attractor/tracer/jsonl-pipeline-tracer.ts`) starts forwarding `outcome.failureReason` into `node-end` events. The CLI (`src/cli/commands/pipeline.ts`) remembers the last failing node inside its existing `onNodeEnd` callback and prints `✗ pipeline failed at node <id>: <reason>` + trace pointer to stderr in the `finally` block when `pipelineFailed === true`. No handler changes; no trace schema version bump (purely additive).

**Tech Stack:** TypeScript, Vitest, Ink (unrelated here), `spawnSync` for the tool fixture.

**Design doc:** `docs/superpowers/specs/2026-04-18-surface-failure-reason-design.md`

---

## File Structure

- **Modify:** `src/attractor/tracer/jsonl-pipeline-tracer.ts` — add `failureReason` field to `node-end` event payload when present on outcome.
- **Modify:** `src/attractor/tracer/jsonl-pipeline-tracer.test.ts` — two new unit tests (present + absent case).
- **Modify:** `src/cli/commands/pipeline.ts` — capture last failing node-id + reason in the `pipelineRunCommand` closure; print one-line stderr summary in `finally`.
- **Create:** `src/cli/tests/pipeline-failure-reason.test.ts` — new vitest that runs the engine in-process with a failing tool node and asserts (a) trace contains `failureReason` and (b) the stderr summary line is printed.

All four live in existing test conventions (vitest, tmpdir fixtures).

---

## Chunk 1: Tracer persists failureReason

### Task 1: Tracer unit test — `failureReason` written when present

**Files:**
- Test: `src/attractor/tracer/jsonl-pipeline-tracer.test.ts` (append to the existing `describe("JsonlPipelineTracer")` block)

- [ ] **Step 1: Write the failing test**

Append inside the `describe` block in `src/attractor/tracer/jsonl-pipeline-tracer.test.ts`:

```ts
  it("writes node-end event with failureReason when outcome has one", () => {
    const tracer = new JsonlPipelineTracer(tracePath);
    tracer.onNodeEnd({
      nodeReceiveId: "run-abcd",
      node: makeNode("run"),
      outcome: { status: "fail", failureReason: "Script exited with code 1: boom\n", contextUpdates: { "tool.output": "" } },
    });
    const lines = readLines();
    expect(lines[0].kind).toBe("node-end");
    expect(lines[0].success).toBe(false);
    expect(lines[0].failureReason).toBe("Script exited with code 1: boom\n");
  });

  it("omits failureReason from node-end event when outcome has none", () => {
    const tracer = new JsonlPipelineTracer(tracePath);
    tracer.onNodeEnd({
      nodeReceiveId: "run-abcd",
      node: makeNode("run"),
      outcome: makeOutcome(true),
    });
    const lines = readLines();
    expect(lines[0].kind).toBe("node-end");
    expect("failureReason" in lines[0]).toBe(false);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/attractor/tracer/jsonl-pipeline-tracer.test.ts`

Expected: The "writes node-end event with failureReason…" test fails (field absent). The "omits failureReason…" test passes incidentally (since the field is never written yet).

- [ ] **Step 3: Implement — extend `onNodeEnd` in the tracer**

Open `src/attractor/tracer/jsonl-pipeline-tracer.ts`. Replace the `onNodeEnd` method (lines 37–45) with:

```ts
  onNodeEnd({ nodeReceiveId, node, outcome }: { nodeReceiveId: string; node: Node; outcome: Outcome }): void {
    const event: Record<string, unknown> = {
      kind: "node-end",
      nodeReceiveId,
      nodeId: node.id,
      success: outcome.status === "success",
      contextUpdates: outcome.contextUpdates ?? {},
    };
    if (outcome.failureReason !== undefined) {
      event.failureReason = outcome.failureReason;
    }
    this.append(event);
  }
```

Two changes: (1) build the event as a mutable record, (2) conditionally set `failureReason` only when defined so the absent-case test keeps passing.

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npm run test -- src/attractor/tracer/jsonl-pipeline-tracer.test.ts`

Expected: all tracer tests pass (new + pre-existing).

- [ ] **Step 5: Commit**

```bash
git add src/attractor/tracer/jsonl-pipeline-tracer.ts src/attractor/tracer/jsonl-pipeline-tracer.test.ts
git commit -m "feat(tracer): persist failureReason on node-end events"
```

---

## Chunk 2: CLI stderr summary on pipeline failure

### Task 2: Integration + CLI-stderr test (drives the CLI change)

**Files:**
- Create: `src/cli/tests/pipeline-failure-reason.test.ts`
- Modify (next task): `src/cli/commands/pipeline.ts`

This test runs `pipelineRunCommand` in-process against a one-node `.dot` fixture whose tool_command exits 1 with stderr. It asserts both observable outcomes: the trace line carries `failureReason`, and the CLI writes the one-line summary to stderr.

- [ ] **Step 1: Write the failing test**

Create `src/cli/tests/pipeline-failure-reason.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { pipelineRunCommand } from "../commands/pipeline.js";

// A minimal pipeline with a single tool node that fails with a known stderr.
const DOT = `digraph fail_fixture {
  goal="exercise failure-reason surfacing"
  start [type="tool", tool_command="echo boom-stderr 1>&2; exit 1"]
  done  [type="exit"]
  start -> done
}`;

describe("pipeline run — failureReason surfacing", () => {
  let work: string;
  let runsRoot: string;
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let writtenStderr = "";

  beforeEach(() => {
    work = mkdtempSync(join(tmpdir(), "ralph-failreason-"));
    runsRoot = join(work, "runs");
    process.env.RALPH_RUNS_ROOT = runsRoot; // pipeline-run respects this if set; see Task 3 note.
    writeFileSync(join(work, "fail.dot"), DOT);
    writtenStderr = "";
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      writtenStderr += typeof chunk === "string" ? chunk : String(chunk);
      return true;
    });
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    delete process.env.RALPH_RUNS_ROOT;
    rmSync(work, { recursive: true, force: true });
  });

  it("writes failureReason into the trace and prints one-line stderr summary", async () => {
    // pipelineRunCommand calls process.exit on failure; intercept it.
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((_code?: number) => {
      throw new Error("__exit__");
    }) as never);

    await expect(
      pipelineRunCommand(join(work, "fail.dot"), { var: [], project: work }),
    ).rejects.toThrow("__exit__");

    exitSpy.mockRestore();

    // Trace assertion.
    expect(existsSync(runsRoot)).toBe(true);
    const [runDir] = readdirSync(runsRoot);
    const trace = readFileSync(join(runsRoot, runDir, "pipeline.jsonl"), "utf8");
    const failingEnd = trace
      .trim()
      .split("\n")
      .map(l => JSON.parse(l) as Record<string, unknown>)
      .find(e => e.kind === "node-end" && e.success === false);
    expect(failingEnd).toBeDefined();
    expect(String(failingEnd!.failureReason)).toContain("boom-stderr");

    // Stderr assertion — one-line summary + trace pointer.
    expect(writtenStderr).toMatch(/^✗ pipeline failed at node start: .*boom-stderr/m);
    expect(writtenStderr).toContain("trace: ");
    expect(writtenStderr).toContain(join(runsRoot, runDir, "pipeline.jsonl"));
  });
});
```

Note: this test needs `pipelineRunCommand` to honour `RALPH_RUNS_ROOT` for test isolation. If it doesn't already, Task 3 also wires that in (small, one-line fallback).

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/cli/tests/pipeline-failure-reason.test.ts`

Expected: two things will fail until Task 3 runs — the trace will already contain `failureReason` (Chunk 1), but the stderr won't match the expected `✗ pipeline failed at node start:` pattern. If `RALPH_RUNS_ROOT` isn't honoured, also expect a directory-not-found assertion before the stderr one.

### Task 3: Wire failureReason summary into CLI exit path

**Files:**
- Modify: `src/cli/commands/pipeline.ts` — capture last failing node in `onNodeEnd`; print in `finally`.

- [ ] **Step 1: (Pre-req) Honour `RALPH_RUNS_ROOT` env var for trace dir**

Locate where `pipelineRunCommand` computes the runs root (search for `.ralph/runs` inside `src/cli/commands/pipeline.ts`; there's an existing `homedir()` / `.ralph/runs` call). Replace it with:

```ts
const runsRoot = process.env.RALPH_RUNS_ROOT ?? join(homedir(), ".ralph", "runs");
```

Reason: integration test isolation. `listRecentTraces` at line 465 already uses the same default; keep that one alone unless it's reached in this test path — if it is, pass `tracesRoot` explicitly or respect the env var there too.

- [ ] **Step 2: Capture last failing node inside the existing `onNodeEnd` callback**

In the `pipelineRunCommand` body (around the `onNodeEnd: (node, outcome) => {` block starting at line 334), declare two closure-scoped variables near the top of the function (next to `pipelineFailed`):

```ts
let lastFailedNodeId: string | null = null;
let lastFailureReason: string | undefined;
```

Inside `onNodeEnd`, **after** the existing `status` computation and `emit(...)` call, add:

```ts
if (outcome.status !== "success" && outcome.failureReason) {
  lastFailedNodeId = node.id;
  lastFailureReason = outcome.failureReason;
}
```

- [ ] **Step 3: Print the one-line summary in `finally`**

Still in `pipelineRunCommand`, in the existing `finally` block (around line 400 — where `printRefineTip(dotFile)` already runs), add the stderr write **before** `printRefineTip(dotFile)`:

```ts
if (pipelineFailed && lastFailedNodeId) {
  const firstLine = (lastFailureReason ?? "pipeline failed").split("\n")[0].slice(0, 500);
  const tracePath = join(runsRoot, runId, "pipeline.jsonl");
  process.stderr.write(`✗ pipeline failed at node ${lastFailedNodeId}: ${firstLine}\n`);
  process.stderr.write(`  trace: ${tracePath}\n`);
}
```

`runId` is already in scope (the tracer receives it). If the local variable is named differently, use whatever holds the 8-char run slug that appears in the opening banner `run: /Users/.../runs/<runId>/pipeline.jsonl`.

- [ ] **Step 4: Run the integration test**

Run: `npm run test -- src/cli/tests/pipeline-failure-reason.test.ts`

Expected: all assertions pass. The test proves both the trace contains `failureReason` (Chunk 1 already landed) and the CLI stderr matches `✗ pipeline failed at node start: …boom-stderr…` plus a `trace: …/pipeline.jsonl` pointer.

- [ ] **Step 5: Run the full suite**

Run: `npm run test`

Expected: no regressions. (Existing pipeline tests don't inspect stderr or the `failureReason` field, so they stay green.)

- [ ] **Step 6: Commit**

```bash
git add src/cli/commands/pipeline.ts src/cli/tests/pipeline-failure-reason.test.ts
git commit -m "feat(cli): print failing node + reason to stderr on pipeline failure"
```

---

## Chunk 3: Manual smoke + close-out

### Task 4: Reproduce the original incident locally

**Files:** (none modified)

- [ ] **Step 1: Build**

Run: `npm run build`

Expected: no errors.

- [ ] **Step 2: Trigger a known failure**

Run (in project root):
```bash
ralph pipeline run pipelines/smoke/tool-fail.dot 2>&1 | tail -n 5
```

If no `smoke/tool-fail.dot` exists, use any pipeline with a deterministic tool-node failure. Otherwise skip to step 3.

- [ ] **Step 3: Verify stderr summary visible**

Expected: last lines include `✗ pipeline failed at node <id>: <first line of stderr>` and `trace: …/pipeline.jsonl`.

- [ ] **Step 4: Verify the trace**

Open the trace jsonl from the `trace:` pointer. Find the last `"kind":"node-end"` line. Confirm it has `"failureReason": "..."` with meaningful content.

- [ ] **Step 5: Done — no commit needed for this verification chunk**

If any assertion above fails, open a new illumination rather than hot-patching this PR — we want the fix to land minimally.

---

## Definition of Done

- [ ] Tracer unit tests (Chunk 1) green.
- [ ] Integration + stderr test (Chunk 2) green.
- [ ] `npm run test` clean.
- [ ] Manual smoke (Chunk 3) shows both stderr summary and trace-enriched failureReason.
- [ ] Two commits on `main` (or the feature branch): one per chunk. (Chunk 3 is verification-only.)
