# Shallow Control-Flow Handlers Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Delete `ConditionalHandler` (no-op) and `ParallelHandler` / `FanInHandler` (dead code), inline a one-line conditional passthrough at the engine dispatch site, and collapse `partial_success` out of the internal `OutcomeStatus` union — all in a single commit.

**Architecture:** The `NodeHandler` seam stays meaningful for handlers that encapsulate real per-type work (`agent`, `tool`, `wait.human`, `store`, `start`/`exit`, `stack.manager_loop`). Two control-flow primitives that previously had handler files lose them: `conditional` collapses into one `if (handlerType === "conditional")` short-circuit at `engine.ts` next to the existing `isExitNode` check; the actual edge selection already lives in `selectNextEdge`. `parallel` / `parallel.fan_in` were never end-to-end implemented (no fan-out coordinator; `meta.branchOutcomes` is only populated by handler-test fixtures) and were already error-rejected by `UNIMPLEMENTED_TYPES`; both are deleted outright. The `OutcomeStatus.partial_success` member follows its sole producer (`FanInHandler`) to the bin; the renderer special-case at `pipeline.ts:454-462` becomes unreachable.

**Tech Stack:** TypeScript, Node.js, vitest, tsup. No new dependencies. Touches `src/attractor/handlers/`, `src/attractor/core/{engine,graph}.ts`, `src/attractor/types.ts`, `src/attractor/handlers/registry.ts`, `src/cli/commands/pipeline.ts`, `src/attractor/tests/handlers.test.ts`.

---

## Source-of-truth references

- Design doc: `docs/superpowers/specs/2026-05-05-shallow-control-flow-handlers-design.md` — authoritative for scope.
- Originating illumination: `.ralph/meditations/illuminations/2026-05-05T1030-shallow-control-flow-handlers.md`.
- Adjacent illumination superseded by this work: `.ralph/meditations/illuminations/2026-05-01T0423-janitor-parallel-handler-yagni.md`.

## Pre-flight verification (run once before starting)

These commands establish that the starting state matches the design doc's premises. Do **not** edit code until they all return as expected.

- [x] Confirm starting test suite is green:

      Run: `npx vitest run`
      Expected: pass.

- [x] Confirm starting type-check is clean:

      Run: `npx tsc --noEmit`
      Expected: zero errors.

- [x] Confirm conditional smoke pipeline exists and uses a `diamond` shape:

      Run: `cat .ralph/scenarios/conditional/pipeline.dot`
      Expected: file prints; contains a node `router [shape=diamond]` with two `condition=` outgoing edges.

- [x] Confirm no `.dot` file in the repo references `type=parallel`, `type=parallel.fan_in`, or shapes `component` / `tripleoctagon`:

      Run: `grep -rE 'type="?parallel(\.fan_in)?"?|shape="?(component|tripleoctagon)"?' --include='*.dot' .`
      Expected: zero hits.

- [x] Confirm `partial_success` lives only in the four expected files:

      Run: `grep -rn 'partial_success' --include='*.ts' src/`
      Expected: 5 hits — `src/attractor/types.ts:1` (union member), `src/attractor/handlers/parallel.ts:20` (producer), `src/cli/commands/pipeline.ts:454` (comment) and `:462` (consumer), `src/attractor/tests/handlers.test.ts:165` (test asserting the producer's output).

If any pre-flight check fails, **stop and surface the divergence to the user** — the design doc's premises no longer hold and the plan must be revisited.

---

## Chunk 1: Delete shallow control-flow handlers + collapse `partial_success`

This is the only chunk. All edits land in **one commit** per the design doc's "Constraints" section. The chunk is structured as TDD-shaped sub-steps so each edit is verified individually before commit, but the working tree is staged once and committed once at the end.

**File map:**

- Delete: `src/attractor/handlers/conditional.ts`
- Delete: `src/attractor/handlers/parallel.ts`
- Modify: `src/attractor/handlers/registry.ts` (drop `branchOutcomes?` field at line 21)
- Modify: `src/attractor/core/engine.ts` (drop 2 imports at lines 9, 14; drop 3 `m.set` calls at lines 57, 62, 63; add inline conditional passthrough at the dispatch site near lines 222-226 + 256-258)
- Modify: `src/attractor/core/graph.ts` (trim `KNOWN_TYPES` lines 30-35, `UNIMPLEMENTED_TYPES` lines 38-41, `SHAPE_TO_TYPE` lines 43-49)
- Modify: `src/attractor/types.ts` (narrow `OutcomeStatus` union at line 1)
- Modify: `src/cli/commands/pipeline.ts` (simplify `onNodeEnd` mapping at lines 451-470)
- Modify: `src/attractor/tests/handlers.test.ts` (delete `ConditionalHandler` describe lines 20-27; delete `ParallelHandler` describe lines 117-151; delete `FanInHandler` describe lines 153-187; drop the two related imports at lines 3, 7)

### Step 1.1: Add a regression test that pins conditional dispatch through the engine

The current handler-level test (`describe("ConditionalHandler")`) goes away with the file. We need engine-level coverage that proves a `diamond`-shaped routing node still resolves to `success` after the inline passthrough lands. The conditional smoke test at `src/cli/tests/pipeline-smoke-conditional-folder.test.ts` already exercises this end-to-end via `validateGraph` + `runPipeline` against `.ralph/scenarios/conditional/pipeline.dot`. We pin the inline behavior with a focused unit test.

- [x] **Step 1.1.1: Write the failing engine-level conditional test**

  Open `src/attractor/tests/engine.test.ts` for editing. (If it does not exist, create it; otherwise append.)

  First, confirm whether the file exists:

  Run: `ls src/attractor/tests/engine.test.ts 2>/dev/null && echo EXISTS || echo MISSING`
  Expected: one of `EXISTS` / `MISSING` — branch on result.

  **If `MISSING`:** create the file with this content:

  ```ts
  import { describe, it, expect } from "vitest";
  import { runPipeline } from "../core/engine.js";
  import { parseDot } from "../core/graph.js";
  import { AutoApproveInterviewer } from "../interviewer/auto-approve.js";
  import { mkdtemp } from "fs/promises";
  import { tmpdir } from "os";
  import { join } from "path";

  describe("engine — conditional inline passthrough", () => {
    it("treats a diamond-shaped node as success without a registered handler", async () => {
      const src = `digraph t {
        start [shape=Mdiamond]
        router [shape=diamond]
        done [shape=Msquare]
        start -> router
        router -> done
      }`;
      const graph = parseDot(src);
      const logsRoot = await mkdtemp(join(tmpdir(), "ralph-engine-cond-"));
      const result = await runPipeline(graph, {
        logsRoot,
        cwd: logsRoot,
        interviewer: new AutoApproveInterviewer(),
      });
      expect(result.status).toBe("success");
      expect(result.completedNodes).toEqual(expect.arrayContaining(["router"]));
    });
  });
  ```

  **If `EXISTS`:** append the same `describe` block to the file (preserve existing imports — add only those not already present).

- [x] **Step 1.1.2: Run the new test against the unmodified engine — expect PASS**

  Run: `npx vitest run src/attractor/tests/engine.test.ts -t "conditional inline passthrough"`
  Expected: PASS (the current `ConditionalHandler` already returns `{ status: "success" }`, so this is a baseline that will continue to pass after the refactor).

  This step is a baseline guard, not a red bar. The point is to lock in the externally-observable behavior so the refactor cannot accidentally regress it.

### Step 1.2: Delete the parallel handler file and its tests

- [x] **Step 1.2.1: Delete `src/attractor/handlers/parallel.ts`**

  Run: `rm src/attractor/handlers/parallel.ts`
  Expected: file removed.

- [x] **Step 1.2.2: Delete the `ParallelHandler` and `FanInHandler` test blocks + import**

  In `src/attractor/tests/handlers.test.ts`:

  - Remove the import line at line 7: `import { ParallelHandler, FanInHandler } from "../handlers/parallel.js";`
  - Remove the entire `describe("ParallelHandler", () => { ... });` block at lines 117-151.
  - Remove the entire `describe("FanInHandler", () => { ... });` block at lines 153-187.

  Survivors (`StartHandler`/`ExitHandler`, `WaitHumanHandler`, `ToolHandler`, `ManagerLoopHandler`, and the `ConditionalHandler` block which we delete in Step 1.4) are untouched here.

- [x] **Step 1.2.3: Verify type-check fails with expected import errors**

  Run: `npx tsc --noEmit`
  Expected: errors mentioning `Cannot find module '../handlers/parallel.js'` from `src/attractor/core/engine.ts`. This is the planned breakage — fixed in Step 1.3.

### Step 1.3: Drop the parallel + conditional registrations from the engine handler map (keep `conditional` working through the inline passthrough added in Step 1.4)

- [x] **Step 1.3.1: Edit `src/attractor/core/engine.ts` imports**

  Remove the line at line 14:
  ```ts
  import { ParallelHandler, FanInHandler } from "../handlers/parallel.js";
  ```

  Remove the line at line 9:
  ```ts
  import { ConditionalHandler } from "../handlers/conditional.js";
  ```

- [x] **Step 1.3.2: Edit `buildHandlerMap` (around lines 49-67) — drop three `m.set` calls**

  Remove these lines from the function body:
  ```ts
  m.set("conditional", new ConditionalHandler());
  ```
  (line 57)

  ```ts
  m.set("parallel", new ParallelHandler());
  m.set("parallel.fan_in", new FanInHandler());
  ```
  (lines 62-63)

  Survivors (`start`, `exit`, `codergen`, `wait.human`, `tool`, `ralph.implement`, `ralph.meditate`, `store`, `agent`) stay in place.

- [x] **Step 1.3.3: Verify type-check fails for a different reason now (missing handler at runtime)**

  Run: `npx tsc --noEmit`
  Expected: clean — no compile errors from the import deletions. (Runtime breakage for diamond nodes is fixed in Step 1.4.)

  If type-check still fails, double-check that no leftover reference to `ConditionalHandler`, `ParallelHandler`, or `FanInHandler` remains in `engine.ts`.

- [x] **Step 1.3.4: Confirm the engine conditional test now FAILS at runtime**

  Run: `npx vitest run src/attractor/tests/engine.test.ts -t "conditional inline passthrough"`
  Expected: FAIL — error message contains `No handler for type "conditional"` (the engine's existing `if (!handler) { return finalize({ status: "fail", ..., failureReason: \`No handler for type "${handlerType}"\` }, ...); }` at lines 224-226 fires now).

  This is the red bar that the inline passthrough in Step 1.4 will turn green.

### Step 1.4: Inline the conditional passthrough at the engine dispatch site + delete the conditional handler file

- [x] **Step 1.4.1: Modify the dispatch loop in `src/attractor/core/engine.ts`**

  Locate this block (currently at lines 222-226 + 256-258):

  ```ts
  const handlerType = resolveHandlerType(node);
  const handler = handlers.get(handlerType);
  if (!handler) {
    return finalize({ status: "fail", completedNodes, context, failureReason: `No handler for type "${handlerType}"` }, opts, runId);
  }
  ```

  ...followed (after the `meta` build) by:

  ```ts
  let outcome: Outcome;
  try {
    outcome = await handler.execute(node, ctx, meta);
  } catch (err) {
    if (err instanceof UndefinedVariableError) {
      // ... existing UndefinedVariableError handling ...
    }
    throw err;
  }
  ```

  Replace **both** sections with:

  ```ts
  const handlerType = resolveHandlerType(node);
  let handler: NodeHandler | undefined;
  if (handlerType !== "conditional") {
    handler = handlers.get(handlerType);
    if (!handler) {
      return finalize({ status: "fail", completedNodes, context, failureReason: `No handler for type "${handlerType}"` }, opts, runId);
    }
  }
  ```

  ...and the dispatch:

  ```ts
  let outcome: Outcome;
  if (handlerType === "conditional") {
    outcome = { status: "success" };
  } else {
    try {
      outcome = await handler!.execute(node, ctx, meta);
    } catch (err) {
      if (err instanceof UndefinedVariableError) {
        const pathTaken = [...completedNodes, node.id].join(" → ");
        const varDump = Object.entries(context)
          .map(([k, v]) => `  ${k} = ${v === undefined ? "<UNDEFINED>" : JSON.stringify(v)}`)
          .join("\n");
        const reason = [
          `Undefined variable $${err.variableName}`,
          `Node: ${node.id}`,
          `Path: ${pathTaken}`,
          `Variable context at failure:`,
          varDump,
        ].join("\n");
        opts.traceWriter?.onNodeEnd({ nodeReceiveId, node, outcome: { status: "fail", failureReason: reason } });
        opts.onNodeEnd?.(node, { status: "fail", failureReason: reason });
        return finalize({ status: "fail", completedNodes, context, failureReason: reason }, opts, runId);
      }
      throw err;
    }
  }
  ```

  Notes:
  - The `UndefinedVariableError` branch keeps its full body — copy it verbatim from the pre-edit code.
  - `handler!.execute(...)` uses the non-null assertion because the `if (handlerType !== "conditional")` block guarantees `handler` is defined when we reach the `else` branch. TypeScript narrowing across the intermediate `meta`-build block does not flow through; the assertion is the cheapest fix and is correct.
  - The `meta` object construction (between the handler-resolution block and the dispatch block) stays unchanged — it sits between the two edits.

- [x] **Step 1.4.2: Delete `src/attractor/handlers/conditional.ts`**

  Run: `rm src/attractor/handlers/conditional.ts`
  Expected: file removed.

- [x] **Step 1.4.3: Delete the `ConditionalHandler` describe block in handlers.test.ts**

  In `src/attractor/tests/handlers.test.ts`:

  - Remove the import at line 3: `import { ConditionalHandler } from "../handlers/conditional.js";`
  - Remove the entire `describe("ConditionalHandler", () => { ... });` block at lines 20-27.

- [x] **Step 1.4.4: Verify type-check is clean**

  Run: `npx tsc --noEmit`
  Expected: zero errors.

  If errors remain mentioning `OutcomeStatus`, `branchOutcomes`, or `partial_success`, those are the targets of Steps 1.5 / 1.6 / 1.7 — proceed in order.

- [x] **Step 1.4.5: Verify the engine conditional test PASSES**

  Run: `npx vitest run src/attractor/tests/engine.test.ts -t "conditional inline passthrough"`
  Expected: PASS.

- [x] **Step 1.4.6: Verify the conditional smoke pipeline test still passes**

  Run: `npx vitest run src/cli/tests/pipeline-smoke-conditional-folder.test.ts`
  Expected: PASS — the smoke pipeline at `.ralph/scenarios/conditional/pipeline.dot` (which uses `router [shape=diamond]`) routes successfully through the inline passthrough.

### Step 1.5: Drop `branchOutcomes` from `HandlerExecutionContext`

- [x] **Step 1.5.1: Edit `src/attractor/handlers/registry.ts`**

  Remove the line at line 21:
  ```ts
  branchOutcomes?: Record<string, Outcome>;
  ```

  The rest of `HandlerExecutionContext` and the `NodeHandler` interface stay.

- [x] **Step 1.5.2: Verify no references remain**

  Run: `grep -rn 'branchOutcomes' src/`
  Expected: zero hits.

  If any hit is shown, it is a leftover that the Step 1.2.2 deletion should already have removed (handler-test fixtures used the field). Remove it.

- [x] **Step 1.5.3: Verify type-check is clean**

  Run: `npx tsc --noEmit`
  Expected: zero errors.

### Step 1.6: Trim the validator type tables in `graph.ts`

- [x] **Step 1.6.1: Edit `KNOWN_TYPES` (lines 30-35)**

  Replace:
  ```ts
  const KNOWN_TYPES = new Set([
    "codergen", "tool", "wait.human", "conditional", "parallel", "parallel.fan_in",
    "start", "exit", "store",
    "ralph.implement", "ralph.meditate",
    "agent", "stack.manager_loop",
  ]);
  ```

  With:
  ```ts
  const KNOWN_TYPES = new Set([
    "codergen", "tool", "wait.human", "conditional",
    "start", "exit", "store",
    "ralph.implement", "ralph.meditate",
    "agent", "stack.manager_loop",
  ]);
  ```

  (Drop `"parallel"` and `"parallel.fan_in"`; keep `"conditional"` since the engine handles it inline and the validator still needs to recognize it as a valid authoring-time type.)

- [x] **Step 1.6.2: Edit `UNIMPLEMENTED_TYPES` (lines 38-41)**

  Replace:
  ```ts
  const UNIMPLEMENTED_TYPES = new Set([
    "parallel", "parallel.fan_in",     // fan-out execution not yet implemented
    "stack.manager_loop",              // no handler registered
  ]);
  ```

  With:
  ```ts
  const UNIMPLEMENTED_TYPES = new Set([
    "stack.manager_loop",              // no handler registered
  ]);
  ```

- [x] **Step 1.6.3: Edit `SHAPE_TO_TYPE` (lines 43-49)**

  Replace:
  ```ts
  const SHAPE_TO_TYPE: Record<string, string> = {
    Mdiamond: "start", Msquare: "exit", box: "codergen",
    hexagon: "wait.human", diamond: "conditional", component: "parallel",
    tripleoctagon: "parallel.fan_in", parallelogram: "tool", house: "stack.manager_loop",
    circle: "ralph.implement", octagon: "ralph.meditate",
    cylinder: "store",
  };
  ```

  With:
  ```ts
  const SHAPE_TO_TYPE: Record<string, string> = {
    Mdiamond: "start", Msquare: "exit", box: "codergen",
    hexagon: "wait.human", diamond: "conditional",
    parallelogram: "tool", house: "stack.manager_loop",
    circle: "ralph.implement", octagon: "ralph.meditate",
    cylinder: "store",
  };
  ```

  (Drop the `component → parallel` and `tripleoctagon → parallel.fan_in` entries; keep `diamond → conditional`.)

- [x] **Step 1.6.4: Verify the validator changes**

  Run: `npx vitest run src/attractor/tests/`
  Expected: PASS for the existing test suite. (No test asserts on the literal "not yet implemented" wording — verified by `grep -rn "not yet implemented" src/` returning no test-file hits per the design doc §7.6.)

### Step 1.7: Narrow `OutcomeStatus` and simplify the renderer mapping

- [x] **Step 1.7.1: Edit `src/attractor/types.ts` line 1**

  Replace:
  ```ts
  export type OutcomeStatus = "success" | "retry" | "fail" | "partial_success";
  ```

  With:
  ```ts
  export type OutcomeStatus = "success" | "retry" | "fail";
  ```

- [x] **Step 1.7.2: Verify type-check surfaces the renderer's now-unreachable branch**

  Run: `npx tsc --noEmit`
  Expected: error in `src/cli/commands/pipeline.ts` around line 462 — TypeScript now knows `outcome.status === "partial_success"` is impossible because the union no longer contains that member. The exact diagnostic is typically of the form: `This comparison appears to be unintentional because the types '"success" | "retry" | "fail"' and '"partial_success"' have no overlap.`

  This is the planned breakage — fixed in Step 1.7.3.

- [x] **Step 1.7.3: Edit `src/cli/commands/pipeline.ts` lines 451-470**

  Locate the `onNodeEnd` callback. Replace this section (lines 451-470):

  ```ts
  onNodeEnd: (node, outcome) => {
    if (node.id === abortHandledFor) return;
    if (classifyNode(node) === "marker") return;
    // Engine OutcomeStatus is "success"|"retry"|"fail"|"partial_success".
    // Map to the renderer's 3-value union. Abort is only emitted by
    // the signal handler above, never by the engine itself.
    const status = outcome.status === "success" ? "success" as const : "fail" as const;
    emit({
      kind: "end",
      outcome: {
        status,
        reason: outcome.failureReason ?? (outcome.status === "partial_success" ? "partial success" : undefined),
      },
    });
    if (outcome.status !== "success" && outcome.failureReason) {
      lastFailedNodeId = node.id;
      lastFailureReason = outcome.failureReason;
    }
    currentBlockNodeId = null;
  },
  ```

  With:

  ```ts
  onNodeEnd: (node, outcome) => {
    if (node.id === abortHandledFor) return;
    if (classifyNode(node) === "marker") return;
    // Engine OutcomeStatus is "success" | "retry" | "fail". Map to the
    // renderer's 3-value union (success/fail). Abort is only emitted by
    // the signal handler above, never by the engine itself.
    const status = outcome.status === "success" ? "success" as const : "fail" as const;
    emit({
      kind: "end",
      outcome: { status, reason: outcome.failureReason },
    });
    if (outcome.status !== "success" && outcome.failureReason) {
      lastFailedNodeId = node.id;
      lastFailureReason = outcome.failureReason;
    }
    currentBlockNodeId = null;
  },
  ```

  Changes versus the original:
  - Comment updated to reflect the narrowed union.
  - `reason:` no longer carries the `partial_success → "partial success"` fallback string.
  - Body of `outcome:` simplifies to `{ status, reason: outcome.failureReason }`.

- [x] **Step 1.7.4: Verify type-check is clean**

  Run: `npx tsc --noEmit`
  Expected: zero errors.

### Step 1.8: Static verification grid

- [x] **Step 1.8.1: Run all positive existence checks**

  Run: `grep -rn 'handlerType === "conditional"' src/attractor/core/engine.ts`
  Expected: at least 2 hits — the new `if (handlerType !== "conditional")` guard and the dispatch-site `if (handlerType === "conditional")` short-circuit.

- [x] **Step 1.8.2: Run all negative existence checks**

  Run: `grep -rn 'class ConditionalHandler\b' src/`
  Expected: zero hits.

  Run: `grep -rn 'class ParallelHandler\b\|class FanInHandler\b' src/`
  Expected: zero hits.

  Run: `grep -rn 'from "\.\./handlers/conditional"\|from "\.\./handlers/parallel"' src/`
  Expected: zero hits.

  Run: `grep -rn 'partial_success' src/`
  Expected: zero hits.

  Run: `grep -rn 'branchOutcomes' src/`
  Expected: zero hits.

- [x] **Step 1.8.3: Run the full test suite**

  Run: `npx vitest run`
  Expected: PASS. Test count drops by 9 (4 from `ConditionalHandler` block — 1 test, 5 from `ParallelHandler` — 4 tests, and 5 from `FanInHandler` — 5 tests). Net drop: ~10 tests removed, 1 test added (the engine-level conditional passthrough test).

- [x] **Step 1.8.4: Run the type-check + build**

  Run: `npx tsc --noEmit`
  Expected: zero errors.

  Run: `npm run build`
  Expected: success. `dist/attractor/handlers/` no longer emits `conditional.js` or `parallel.js`. No new bin entries, no removed bin entries.

### Step 1.9: Smoke-pipeline verification (manual exercise — diff `pipeline.jsonl`)

- [x] **Step 1.9.1: Validate every bundled per-folder pipeline**

  Run: `for d in src/cli/pipelines/*/; do echo "--- $d ---"; npx tsx src/cli/index.ts pipeline validate "$d/pipeline.dot" || true; done`
  Expected: identical diagnostic output to the pre-change run. No bundled pipeline uses `component`, `tripleoctagon`, `type=parallel`, or `type=parallel.fan_in` (verified by Pre-flight check), so none should regress.

- [x] **Step 1.9.2: Run the conditional scenario pipeline end-to-end**

  Run: `npx tsx src/cli/index.ts pipeline run .ralph/scenarios/conditional/pipeline.dot --auto-approve` (or equivalent run command for that scenario — adjust per the scenario's authoring conventions; see `src/cli/tests/pipeline-smoke-conditional-folder.test.ts` for the canonical invocation).
  Expected: same exit code as pre-change. The `pipeline.jsonl` trace has `nodeKind: "conditional"` for the `router` node before and after.

  If the scenario requires authentication-gated agent runs (`classify`, `pass-handler`, etc.) that you cannot invoke in this environment, **skip this manual check and rely on `pipeline-smoke-conditional-folder.test.ts` for end-to-end coverage** — that test is run as part of Step 1.8.3.

### Step 1.10: Stage and commit (single commit per design constraint)

- [x] **Step 1.10.1: Review the staged diff**

  Run: `git status` and `git diff --stat`
  Expected: ~7 modified files + 2 deleted files. Modified set should match the file map at the top of this chunk. No `.dot`, no agent rubrics, no docs touched.

- [x] **Step 1.10.2: Stage by name (avoid `git add -A`)**

  Run:
  ```bash
  git add \
    src/attractor/handlers/conditional.ts \
    src/attractor/handlers/parallel.ts \
    src/attractor/handlers/registry.ts \
    src/attractor/core/engine.ts \
    src/attractor/core/graph.ts \
    src/attractor/types.ts \
    src/cli/commands/pipeline.ts \
    src/attractor/tests/handlers.test.ts \
    src/attractor/tests/engine.test.ts
  ```

  Expected: stages all eight existing-file edits + the new (or appended) engine test. Deletions are picked up automatically by `git add` on the deleted paths.

- [x] **Step 1.10.3: Commit**

  Run:
  ```bash
  git commit -m "$(cat <<'EOF'
  refactor(attractor): inline conditional, delete parallel handlers

  - Delete src/attractor/handlers/conditional.ts (no-op handler) and inline
    a one-line passthrough in engine.ts at the dispatch site, sibling to
    the existing isExitNode shape-marker check. selectNextEdge already
    owns conditional edge selection.
  - Delete src/attractor/handlers/parallel.ts (ParallelHandler + FanInHandler).
    The fan-out feature was never end-to-end implemented; UNIMPLEMENTED_TYPES
    already rejected those types in validation.
  - Drop "parallel", "parallel.fan_in" from KNOWN_TYPES / UNIMPLEMENTED_TYPES;
    drop component / tripleoctagon shape mappings. diamond -> conditional
    stays so authored diamond nodes keep routing through the engine.
  - Narrow OutcomeStatus to "success" | "retry" | "fail" — partial_success
    had a single producer (FanInHandler) and a single non-test consumer
    (renderer in pipeline.ts), both removed here.
  - Drop branchOutcomes from HandlerExecutionContext — no readers post-delete.
  - Replace handler-level ConditionalHandler/ParallelHandler/FanInHandler
    test blocks with a focused engine-level test that pins the inline
    conditional passthrough end-to-end.

  No public flag, schema, .dot syntax, agent rubric, or doc surface changes.
  No bundled pipeline edits (verified zero .dot files use the deleted
  shapes/types). pipeline.jsonl byte-equivalent for any pre-change valid
  graph (modulo timestamps + nondeterministic IDs).

  Originating illumination: 2026-05-05T1030-shallow-control-flow-handlers.md
  Design doc: docs/superpowers/specs/2026-05-05-shallow-control-flow-handlers-design.md
  Supersedes: 2026-05-01T0423-janitor-parallel-handler-yagni.md
  EOF
  )"
  ```

- [x] **Step 1.10.4: Verify post-commit state**

  Run: `git status`
  Expected: working tree clean.

  Run: `git log -1 --stat`
  Expected: one new commit listing the eight modified files + two deletions (`conditional.ts`, `parallel.ts`).

## Verification targets

- Smokes: `src/cli/tests/pipeline-smoke-conditional-folder.test.ts` (exercises diamond-shaped routing via `.ralph/scenarios/conditional/pipeline.dot`); the rest of `src/cli/tests/pipeline-smoke-*-folder.test.ts` as a regression net (none use deleted shapes/types).
- Manual exercises: `npx tsx src/cli/index.ts pipeline validate <bundled-pipeline>` against each of `src/cli/pipelines/{implement,meditate,janitor}/pipeline.dot` — expect identical diagnostic output before and after; optional `pipeline run` against `.ralph/scenarios/conditional/pipeline.dot` if the scenario's agents are runnable in the executor's environment.
- Lint: `npx tsc --noEmit`; `npx vitest run src/attractor/tests/handlers.test.ts`; `npx vitest run src/attractor/tests/engine.test.ts`; `npx vitest run src/cli/tests/pipeline-smoke-conditional-folder.test.ts`; `npx vitest run` for the whole suite.
- Surfaces touched: pipeline-engine (handler module + dispatch loop + validator type tables + outcome union); CLI renderer (one mapping simplification in `pipeline.ts`). No CLI command/flag surface, no MCP surface, no agent surface, no `.dot` syntax surface, no docs.

## Open questions / disagreements (none expected, surfaced for transparency)

The design doc's §9 lists three reviewer-loop nits that are out of scope of this plan: (1) whether `diamond` should be promoted to a first-class authoring concept; (2) whether the inline passthrough belongs at the dispatch site vs next to `isExitNode` — the plan picks the dispatch-site placement per design §3.3 and §7.1; (3) whether `partial_success` should ship as a deprecated alias for one release — the plan does direct deletion per design §7.3. If a reviewer wants any of these reconsidered, raise as a follow-up illumination, not as a blocker on this plan.
