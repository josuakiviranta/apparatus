---
status: pending
---

# Headless Governance Gates Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent headless pipeline execution from silently auto-approving governance gates by reordering safe defaults first, adding a `headless_safe` graph attribute, and enforcing it at runtime.

**Architecture:** The DOT parser (`graph.ts`) already converts snake_case graph attributes to camelCase and coerces boolean strings via `coerceValue`. We add `headlessSafe` to the `Graph` interface and extract it in `parseDot` alongside `goal`. `pipelineRunCommand` checks `graph.headlessSafe === false && !process.stdin.isTTY` before calling `runPipeline`. The heartbeat `pipeline` subcommand parses the dotfile and warns if `headlessSafe === false`.

**Tech Stack:** TypeScript (ESM), Vitest, Commander.js

**Reference spec:** `docs/superpowers/specs/2026-04-12-headless-governance-gates-design.md`

---

## Chunk 1: Safe defaults and `headlessSafe` attribute (parser + types)

This chunk reorders gate labels in the pipeline dotfile and adds `headlessSafe` parsing. These are the foundation — runtime enforcement (chunk 2) depends on the parser producing the field.

### Task 1.1: Add `headlessSafe` to the `Graph` interface

**Files:**
- Modify: `src/attractor/types.ts:49-61`

- [ ] **Step 1: Add the field**

Add `headlessSafe?: boolean` to the `Graph` interface after `fallbackRetryTarget`:

```ts
  fallbackRetryTarget?: string;
  headlessSafe?: boolean;
  nodes: Map<string, Node>;
  edges: Edge[];
```

- [ ] **Step 2: Commit**

```bash
git add src/attractor/types.ts
git commit -m "feat(types): add headlessSafe field to Graph interface"
```

### Task 1.2: Parse `headless_safe` graph attribute in `parseDot`

**Files:**
- Modify: `src/attractor/core/graph.ts:190-202`
- Test: `src/attractor/tests/graph.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/attractor/tests/graph.test.ts` inside the `describe("parseDot", ...)` block:

```ts
  it("parses headless_safe=false as headlessSafe boolean", () => {
    const dot = `digraph g {
      goal="test"
      headless_safe=false
      start [shape=Mdiamond]
      done [shape=Msquare]
      start -> done
    }`;
    const graph = parseDot(dot);
    expect(graph.headlessSafe).toBe(false);
  });

  it("parses headless_safe=true as headlessSafe boolean", () => {
    const dot = `digraph g {
      headless_safe=true
      start [shape=Mdiamond]
      done [shape=Msquare]
      start -> done
    }`;
    const graph = parseDot(dot);
    expect(graph.headlessSafe).toBe(true);
  });

  it("defaults headlessSafe to undefined when attribute is absent", () => {
    const dot = `digraph g {
      start [shape=Mdiamond]
      done [shape=Msquare]
      start -> done
    }`;
    const graph = parseDot(dot);
    expect(graph.headlessSafe).toBeUndefined();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/attractor/tests/graph.test.ts`
Expected: FAIL — `headlessSafe` not present on returned graph object

- [ ] **Step 3: Write minimal implementation**

In `src/attractor/core/graph.ts`, in the return statement of `parseDot` (line ~190), add `headlessSafe` extraction. The `coerceValue` function already converts `"false"` to `false` and `"true"` to `true`, and `toCamel` converts `headless_safe` to `headlessSafe`, so the value is already in `graphAttrs`:

```ts
  return {
    name,
    goal: graphAttrs["goal"] as string | undefined,
    label: graphAttrs["label"] as string | undefined,
    modelStylesheet: stylesheet || undefined,
    defaultMaxRetries: graphAttrs["defaultMaxRetries"] as number | undefined,
    defaultFidelity: graphAttrs["defaultFidelity"] as string | undefined,
    maxParallel: graphAttrs["maxParallel"] as number | undefined,
    retryTarget: graphAttrs["retryTarget"] as string | undefined,
    fallbackRetryTarget: graphAttrs["fallbackRetryTarget"] as string | undefined,
    headlessSafe: graphAttrs["headlessSafe"] as boolean | undefined,
    nodes,
    edges,
  };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/attractor/tests/graph.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/attractor/core/graph.ts src/attractor/tests/graph.test.ts
git commit -m "feat(parser): extract headlessSafe graph attribute from DOT source"
```

### Task 1.3: Reorder gate labels and add `headless_safe=false` to `illumination-to-plan.dot`

**Files:**
- Modify: `pipelines/illumination-to-plan.dot`

- [ ] **Step 1: Reorder `remove_gate` edges (lines 36-37)**

Change from:
```dot
  remove_gate -> delete_agent  [label="Yes"]
  remove_gate -> done          [label="No"]
```

To (safe default first):
```dot
  remove_gate -> done          [label="No"]
  remove_gate -> delete_agent  [label="Yes"]
```

- [ ] **Step 2: Reorder `approval_gate` edges (lines 42-44)**

Change from:
```dot
  approval_gate -> design_writer [label="Approve"]
  approval_gate -> delete_agent  [label="Decline"]
  approval_gate -> chat_session  [label="Chat"]
```

To (safe default first):
```dot
  approval_gate -> delete_agent  [label="Decline"]
  approval_gate -> design_writer [label="Approve"]
  approval_gate -> chat_session  [label="Chat"]
```

- [ ] **Step 3: Add `headless_safe=false` graph attribute**

After the existing `goal=` line (line 2), add:

```dot
  headless_safe=false
```

- [ ] **Step 4: Verify the dotfile still validates**

Run: `npx tsx src/cli/index.ts pipeline validate illumination-to-plan`
Expected: "Pipeline valid" message

- [ ] **Step 5: Commit**

```bash
git add pipelines/illumination-to-plan.dot
git commit -m "fix(pipeline): reorder gate labels for safe defaults, mark headless_safe=false"
```

---

## Chunk 2: Runtime enforcement (pipeline + heartbeat commands)

With the parser producing `headlessSafe`, we now wire up the two enforcement points: hard block in `pipelineRunCommand` and warning in `heartbeat pipeline`.

### Task 2.1: Block headless-unsafe pipelines in `pipelineRunCommand`

**Files:**
- Modify: `src/cli/commands/pipeline.ts:57-75`
- Test: `src/cli/commands/tests/pipeline-headless.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `src/cli/commands/tests/pipeline-headless.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { pipelineRunCommand } from "../pipeline.js";
import * as output from "../../lib/output.js";

// Minimal headless_safe=false dotfile
const UNSAFE_DOT = `digraph g {
  goal="test"
  headless_safe=false
  start [shape=Mdiamond]
  a [agent="implement", prompt="noop"]
  done [shape=Msquare]
  start -> a -> done
}`;

describe("pipelineRunCommand headless safety", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  const origIsTTY = process.stdin.isTTY;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as any);
    errorSpy = vi.spyOn(output, "error").mockResolvedValue(undefined as any);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    errorSpy.mockRestore();
    Object.defineProperty(process.stdin, "isTTY", { value: origIsTTY, writable: true });
  });

  it("exits with error when headlessSafe=false and not TTY", async () => {
    // Write a temp dotfile
    const { writeFileSync, mkdtempSync } = await import("fs");
    const { join } = await import("path");
    const tmpDir = mkdtempSync(join((await import("os")).tmpdir(), "ralph-test-"));
    const dotPath = join(tmpDir, "unsafe.dot");
    writeFileSync(dotPath, UNSAFE_DOT);

    Object.defineProperty(process.stdin, "isTTY", { value: undefined, writable: true });

    await expect(pipelineRunCommand(dotPath)).rejects.toThrow("process.exit called");
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("headless_safe=false")
    );
    expect(exitSpy).toHaveBeenCalledWith(1);

    // Cleanup
    const { rmSync } = await import("fs");
    rmSync(tmpDir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/cli/commands/tests/pipeline-headless.test.ts`
Expected: FAIL — no headless check exists yet, so the command proceeds past the graph parse

- [ ] **Step 3: Write minimal implementation**

In `src/cli/commands/pipeline.ts`, after the `variableExpansionTransform` call (line 73) and before the `logsRoot` assignment (line 75), add:

```ts
  // Headless safety: refuse to run headless_safe=false pipelines without a TTY
  if (graph.headlessSafe === false && !process.stdin.isTTY) {
    await output.error(
      `This pipeline has headless_safe=false and cannot run without a TTY.\n` +
      `Run it interactively: ralph pipeline run ${dotFile}`
    );
    process.exit(1);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/cli/commands/tests/pipeline-headless.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass (existing tests should not be affected since they don't set `headless_safe=false`)

- [ ] **Step 6: Commit**

```bash
git add src/cli/commands/pipeline.ts src/cli/commands/tests/pipeline-headless.test.ts
git commit -m "feat(pipeline): block headless_safe=false pipelines in non-TTY contexts"
```

### Task 2.2: Warn in heartbeat `pipeline` subcommand

**Files:**
- Modify: `src/cli/commands/heartbeat.ts:161-194`
- Test: `src/cli/commands/tests/heartbeat-headless.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `src/cli/commands/tests/heartbeat-headless.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseDot } from "../../../attractor/core/graph.js";
import * as output from "../../lib/output.js";

const UNSAFE_DOT = `digraph g {
  goal="test"
  headless_safe=false
  start [shape=Mdiamond]
  done [shape=Msquare]
  start -> done
}`;

const SAFE_DOT = `digraph g {
  goal="test"
  start [shape=Mdiamond]
  done [shape=Msquare]
  start -> done
}`;

describe("heartbeat pipeline headless_safe warning", () => {
  it("parseDot returns headlessSafe=false for unsafe pipeline", () => {
    const graph = parseDot(UNSAFE_DOT);
    expect(graph.headlessSafe).toBe(false);
  });

  it("parseDot returns headlessSafe=undefined for safe pipeline", () => {
    const graph = parseDot(SAFE_DOT);
    expect(graph.headlessSafe).toBeUndefined();
  });
});
```

Note: The heartbeat command is tightly coupled to the daemon IPC layer, making it hard to unit test in isolation. The test above validates the parser behavior that the warning depends on. The warning itself is a simple `output.warn` call guarded by a boolean check — low risk of regression.

- [ ] **Step 2: Run tests to confirm parser coverage**

Run: `npx vitest run src/cli/commands/tests/heartbeat-headless.test.ts`
Expected: PASS — these tests validate parser behavior already implemented in Task 1.2. The heartbeat warning itself is not unit-tested because the command is tightly coupled to daemon IPC; the `output.warn` call is a simple boolean guard with low regression risk.

- [ ] **Step 3: Add the warning to heartbeat pipeline action**

In `src/cli/commands/heartbeat.ts`, inside the `.action()` callback of the `pipeline` command, after the `validatePathArg` call (line 174) and before the `stem` assignment (line 175), add the dotfile parse and warning:

```ts
      // Warn if pipeline is marked as headless-unsafe
      const dotSrc = readFileSync(absDotFile, "utf8");
      const dotGraph = parseDot(dotSrc);
      if (dotGraph.headlessSafe === false) {
        await output.warn(
          `Warning: ${basename(absDotFile)} has headless_safe=false and will be ` +
          `rejected when the daemon runs it without a TTY.`
        );
      }
```

Also add the required imports at the top of `heartbeat.ts`:

```ts
import { readFileSync } from "fs";
import { parseDot } from "../../attractor/core/graph.js";
```

The existing import at the top of `heartbeat.ts` is `import { statSync, Stats } from "fs"` — add `readFileSync` to that destructure: `import { statSync, Stats, readFileSync } from "fs"`.

- [ ] **Step 4: Verify the build succeeds**

Run: `npm run build`
Expected: Clean build, no type errors

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/heartbeat.ts src/cli/commands/tests/heartbeat-headless.test.ts
git commit -m "feat(heartbeat): warn when registering headless_safe=false pipeline"
```

### Task 2.3: Final verification

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: Clean build

- [ ] **Step 3: Manual smoke test — validate the updated dotfile**

Run: `npx tsx src/cli/index.ts pipeline validate illumination-to-plan`
Expected: "Pipeline valid" with no errors

- [ ] **Step 4: Final commit (if any fixups needed)**

```bash
git add -A
git commit -m "chore: headless governance gates — final fixups"
```
