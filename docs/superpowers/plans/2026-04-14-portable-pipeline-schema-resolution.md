---
status: implemented
---

# Portable Pipeline Schema Resolution Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve `json_schema_file` paths relative to the `.dot` file's directory so pipelines are self-contained and portable across projects.

**Architecture:** Thread `dotDir` (dirname of the `.dot` file) from `pipelineRunCommand` through `runPipeline` options and into handler `meta`. In `AgentHandler`, replace `resolve(cwd, jsonSchemaFile)` with `resolve(dotDir, jsonSchemaFile)`. When `dotDir` is absent (e.g. direct `runPipeline` calls in tests), fall back to `cwd` — preserving all existing behaviour.

**Tech Stack:** TypeScript, Node.js `path.dirname`, vitest, tmux harness (`docs/harness/tmux-drive.md`)

---

## Chunk 1: Engine + handler + CLI wiring (TDD)

**Files:**
- Modify: `src/attractor/core/engine.ts` — add `dotDir?: string` to `EngineOptions`, inject into handler `meta`
- Modify: `src/attractor/handlers/agent-handler.ts` — use `meta["dotDir"]` for schema resolution
- Modify: `src/cli/commands/pipeline.ts` — compute `dotDir`, pass to `runPipeline`
- Modify: `src/attractor/tests/agent-handler-json-constraint.test.ts` — add dotDir separation test

### Task 1.1: Write the failing test

Add this test to `src/attractor/tests/agent-handler-json-constraint.test.ts` inside the existing `describe` block (after line 341, before the closing `}`):

- [ ] **Step 1: Add the test**

```ts
it("resolves json_schema_file relative to dotDir, not cwd", async () => {
  const schema = JSON.stringify({ type: "object", properties: { verdict: { type: "string" } }, required: ["verdict"] });
  const dotDir = mkdtempSync(join(tmpdir(), "ralph-dotdir-"));
  const projectDir = mkdtempSync(join(tmpdir(), "ralph-project-"));
  const schemaDir = join(dotDir, "pipelines", "schemas");
  mkdirSync(schemaDir, { recursive: true });
  writeFileSync(join(schemaDir, "test.json"), schema);
  // NOTE: schema is in dotDir, NOT in projectDir — resolution must use dotDir

  mockResolve.mockReturnValue({ ...baseConfig });
  mockAgentRun.mockResolvedValue({
    exitCode: 0, sessionId: null, stdout: null,
    output: JSON.stringify([{ type: "result", result: "", structured_output: { verdict: "pass" } }]),
  });

  const handler = new AgentHandler({
    resolveAgent: mockResolve,
    createAgent: () => ({ run: mockAgentRun, kill: mockAgentKill, config: {} } as any),
  });

  try {
    const outcome = await handler.execute(
      makeNode({ prompt: "Verify", jsonSchemaFile: "pipelines/schemas/test.json" } as any),
      baseCtx(),
      {
        logsRoot: projectDir,
        cwd: projectDir,   // project dir — does NOT contain the schema
        dotDir: dotDir,    // dot file dir — DOES contain the schema
        signal: undefined,
        outgoingLabels: [],
        completedNodes: [],
        nodeRetries: {},
      },
    );

    expect(outcome.status).toBe("success");
  } finally {
    rmSync(dotDir, { recursive: true, force: true });
    rmSync(projectDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
cd /Users/josu/Documents/projects/ralph-cli
npx vitest run src/attractor/tests/agent-handler-json-constraint.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: FAIL — `dotDir` is not a recognized meta key yet, schema lookup falls back to `cwd` (projectDir) and throws ENOENT.

### Task 1.2: Add `dotDir` to `EngineOptions` and inject into meta

- [ ] **Step 1: Open `src/attractor/core/engine.ts`**

In the `EngineOptions` interface (line 19), add one field after `resume?`:

```ts
dotDir?: string;
```

- [ ] **Step 2: Inject `dotDir` into handler `meta`**

In the `handler.execute(...)` call block (around line 200–209), add `dotDir` to the meta object:

```ts
const outcome = await handler.execute(node, ctx, {
  logsRoot: opts.logsRoot,
  cwd: opts.cwd,
  dotDir: opts.dotDir ?? opts.cwd,   // ← add this line
  signal: opts.signal,
  outgoingLabels,
  completedNodes,
  nodeRetries,
  onStdout: opts.onStdout,
  onInteractiveRequest: opts.onInteractiveRequest,
});
```

### Task 1.3: Use `dotDir` in `AgentHandler`

- [ ] **Step 1: Open `src/attractor/handlers/agent-handler.ts`**

Around line 50–62, replace the schema resolution block:

```ts
// Before
if (jsonSchemaFile) {
  try {
    jsonSchema = readFileSync(resolve(cwd, jsonSchemaFile), "utf8");
  } catch (err) {
    return { status: "fail", failureReason: `Failed to read json_schema_file "${jsonSchemaFile}": ${(err as Error).message}` };
  }
}
```

```ts
// After
if (jsonSchemaFile) {
  const dotDir = (meta["dotDir"] ?? meta["cwd"]) as string;
  try {
    jsonSchema = readFileSync(resolve(dotDir, jsonSchemaFile), "utf8");
  } catch (err) {
    return { status: "fail", failureReason: `Failed to read json_schema_file "${jsonSchemaFile}": ${(err as Error).message}` };
  }
}
```

> **Why `?? meta["cwd"]`:** The engine always injects `dotDir` when running a pipeline, but tests that call `handler.execute()` directly without a `dotDir` key in meta must not break. The fallback mirrors the engine's own `opts.dotDir ?? opts.cwd` logic.

### Task 1.4: Pass `dotDir` from `pipeline.ts`

- [ ] **Step 1: Open `src/cli/commands/pipeline.ts`**

Add `dirname` to the existing path import (line 2):

```ts
import { resolve, join, basename, dirname } from "path";
```

- [ ] **Step 2: Compute `dotDir` after `absPath` is resolved (around line 67)**

After `const src = readFileSync(absPath, "utf8");`, add:

```ts
const dotDir = dirname(absPath);
```

- [ ] **Step 3: Pass `dotDir` to `runPipeline` (around line 140)**

```ts
const result = await runPipeline(graph, {
  logsRoot,
  cwd: project,
  dotDir,           // ← add this line
  interviewer: process.stdin.isTTY
    ? new InkInterviewer(callbacks.emit)
    : new AutoApproveInterviewer(),
  signal: ac.signal,
  project: opts.project,
  resume: opts.resume,
  // ... rest unchanged
```

### Task 1.5: Run all tests

- [ ] **Step 1: Run the new test to verify it passes**

```bash
npx vitest run src/attractor/tests/agent-handler-json-constraint.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: ALL PASS — including the new `dotDir` test.

- [ ] **Step 2: Run the full test suite to confirm no regressions**

```bash
npm test 2>&1 | tail -30
```

Expected: all existing tests continue to pass. The `dotDir ?? cwd` fallback in the engine means existing tests that don't pass `dotDir` resolve schemas from `cwd` as before.

- [ ] **Step 3: Commit**

```bash
git add src/attractor/core/engine.ts \
        src/attractor/handlers/agent-handler.ts \
        src/cli/commands/pipeline.ts \
        src/attractor/tests/agent-handler-json-constraint.test.ts
git commit -m "feat(engine): resolve json_schema_file relative to dot file directory

Fixes portability: ralph pipeline run ./pipelines/foo.dot --project ../other
now resolves schemas from the dot file's directory, not the target project.
Fallback to cwd when dotDir is absent preserves all existing behaviour.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Chunk 2: Tmux smoke verification

This chunk is a manual verification step using the tmux harness. It is NOT a vitest test — it drives a real ralph process and visually confirms the schema resolves correctly.

**Prerequisite:** `../jobs-post-worker` must exist and have a `meditations/illuminations/` directory (can be empty — the `verifier` node handles the empty case and routes to `done` without error).

**Files:**
- Read: `docs/harness/tmux-drive.md` — source the bash block before proceeding

### Task 2.1: Set up the target project

- [ ] **Step 1: Ensure `../jobs-post-worker` has an illuminations folder**

```bash
mkdir -p ../jobs-post-worker/meditations/illuminations
```

If the folder is empty, `illumination-to-plan.dot`'s verifier node returns `preferred_label: empty` and routes to `done` — a clean exit that still proves schema resolution succeeded.

### Task 2.2: Source the harness and start a run

- [ ] **Step 1: Source the tmux harness**

Open `docs/harness/tmux-drive.md`, copy the fenced bash block into your shell, and source it.

- [ ] **Step 2: Build ralph**

```bash
npm run build
```

- [ ] **Step 3: Start the run inside tmux**

```bash
start_run "ralph pipeline run $(pwd)/pipelines/illumination-to-plan.dot --project ../jobs-post-worker"
```

### Task 2.3: Assert schema resolution succeeds

- [ ] **Step 1: Wait for the TUI to stabilise**

```bash
wait_stable 15000
```

- [ ] **Step 2: Capture the TUI output**

```bash
capture
```

- [ ] **Step 3: Assert no schema error**

Inspect the capture. It must NOT contain the string:

```
Failed to read json_schema_file
```

- [ ] **Step 4: Assert the pipeline progressed past `verifier`**

The TUI should show either:
- `verifier` marked done + `done` node reached (empty illuminations path), OR
- `verifier` marked done + `explainer` or `explain_removal` started (non-empty path)

Neither outcome is possible if the schema failed to load — a schema failure routes to an immediate pipeline `fail`.

### Task 2.4: Teardown

- [ ] **Step 1: Clean up**

```bash
cleanup_run
```
