# Undefined Variable Backpressure Guard Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make pipeline variable expansion fail loudly on undefined variables, add static validation to catch coverage gaps before execution, and scope chat notes per-run to prevent cross-illumination contamination.

**Architecture:** Three layers — (1) `expandVariables` throws `UndefinedVariableError` instead of silent passthrough, (2) a `variable_coverage` rule in `validateGraph()` warns about unreachable producers, (3) the engine catches pipeline-fatal errors, tears down agents, and emits a structured error trace. Chat notes move from a global path to a per-run scoped path.

**Tech Stack:** TypeScript, vitest

**Design Spec:** `docs/superpowers/specs/2026-04-13-undefined-variable-backpressure-guard-design.md`

---

## Chunk 1: Runtime guard — `expandVariables` throws on undefined variables ✅ DONE

Completed: `expandVariables` now throws `UndefinedVariableError` on undefined variables with optional `defaults` parameter support. `variableExpansionTransform` catches the error gracefully (pre-expansion pass). All 45 transform tests pass.

**Note:** Runtime callers (tool.ts, agent-handler.ts, wait-human.ts, store.ts) will throw unhandled `UndefinedVariableError` until Chunk 3 adds the engine-level catch boundary. This is the intended intermediate state.

---

## Chunk 2: Static validation — `variable_coverage` rule in `validateGraph()`

### File Map

| Action | File | Purpose |
|--------|------|---------|
| Modify | `src/attractor/core/graph.ts` | Add variable_coverage diagnostic rule to `validateGraph()` |
| Create or Modify | `src/attractor/tests/graph.test.ts` | Tests for variable_coverage rule |

---

### Task 3: Write variable_coverage tests (red)

**Files:**
- Create or Modify: `src/attractor/tests/graph.test.ts`

- [ ] **Step 13: Read the current graph test file (if it exists)**

```bash
find src/attractor -name "graph.test.ts" -o -name "graph.test.ts"
```

- [ ] **Step 14: Write test for unreachable variable producer detection**

Create a test graph where node B references `$output` produced by node C, but node C is on a branch that can be skipped. `validateGraph` should return a warning about `$output` in node B.

```typescript
it("warns when variable producer is unreachable on some paths", () => {
  // Graph: start -> conditional -> [path A -> consumer] | [path B -> producer -> consumer]
  // consumer references $output, producer sets it, path A skips producer
  const result = validateGraph(graph);
  const warnings = result.filter(d => d.rule === "variable_coverage");
  expect(warnings).toHaveLength(1);
  expect(warnings[0].message).toContain("$output");
});
```

- [ ] **Step 15: Write test for fully-covered variables (no warning)**

```typescript
it("does not warn when all paths to consumer pass through producer", () => {
  // Graph: start -> producer -> consumer -> exit
  // consumer references $output, producer always runs before it
  const result = validateGraph(graph);
  const warnings = result.filter(d => d.rule === "variable_coverage");
  expect(warnings).toHaveLength(0);
});
```

- [ ] **Step 16: Run tests to confirm they fail**

```bash
npx vitest run src/attractor/tests/graph.test.ts
```

Expected: FAIL — no `variable_coverage` rule exists

---

### Task 4: Implement variable_coverage rule (green)

**Files:**
- Modify: `src/attractor/core/graph.ts`

- [ ] **Step 17: Read `validateGraph` in graph.ts**

```bash
cat -n src/attractor/core/graph.ts
```

- [ ] **Step 18: Add variable_coverage rule to validateGraph**

Inside `validateGraph()`, after the existing rules, add:

**Algorithm:**
1. For each node, extract `$variableName` references from its `prompt` field using the regex `/\$([a-zA-Z_][\w.]*)/g`.
2. Skip reserved variables (`$goal`, `$project`).
3. For each referenced variable, find nodes whose `contextUpdates` (or whose handler type is known to produce that key) could set it.
4. For each consuming node, check if all paths from `start` to that node pass through at least one producer. If not, emit a warning diagnostic.

The warning diagnostic should use the same format as existing diagnostics, with `rule: "variable_coverage"` and `severity: "warning"`.

- [ ] **Step 19: Run tests to confirm they pass**

```bash
npx vitest run src/attractor/tests/graph.test.ts
```

Expected: All tests PASS

- [ ] **Step 20: Run full test suite**

```bash
npm test
```

Expected: All tests PASS

- [ ] **Step 21: Commit**

```bash
git add src/attractor/core/graph.ts src/attractor/tests/graph.test.ts
git commit -m "feat(pipeline): add variable_coverage validation rule to validateGraph"
```

---

## Chunk 3: Graceful shutdown + structured error trace

### File Map

| Action | File | Purpose |
|--------|------|---------|
| Modify | `src/attractor/core/engine.ts` | Catch UndefinedVariableError, halt dispatch, tear down agents, emit trace |
| Create | `src/attractor/errors.ts` | (optional) Centralize error trace formatting if not inline |
| Modify | `src/attractor/tests/engine.test.ts` | Tests for graceful shutdown on variable error |

---

### Task 5: Write graceful shutdown tests (red)

**Files:**
- Create or Modify: `src/attractor/tests/engine.test.ts`

- [ ] **Step 22: Read existing engine test file**

```bash
find src/attractor -name "engine.test.ts"
cat -n src/attractor/tests/engine.test.ts  # if it exists
```

- [ ] **Step 23: Write test for graceful shutdown on UndefinedVariableError**

Test that when a node's prompt expansion throws `UndefinedVariableError`:
1. The pipeline stops dispatching new nodes
2. The pipeline exits with a failure status
3. An error trace is emitted containing the variable name, node name, and path taken

```typescript
it("halts pipeline and emits error trace on UndefinedVariableError", async () => {
  // Set up a graph where a node references $missing which is never produced
  // Run the pipeline
  // Verify: pipeline status is "fail", error trace contains "$missing", no further nodes dispatched
});
```

- [ ] **Step 24: Run tests to confirm they fail**

```bash
npx vitest run src/attractor/tests/engine.test.ts
```

Expected: FAIL

---

### Task 6: Implement graceful shutdown (green)

**Files:**
- Modify: `src/attractor/core/engine.ts`

- [ ] **Step 25: Read the engine execution loop**

```bash
cat -n src/attractor/core/engine.ts
```

- [ ] **Step 26: Add error boundary around node execution**

In the node dispatch/execution loop, wrap the prompt expansion + handler execution in a try/catch for `UndefinedVariableError`. On catch:

1. **Halt dispatch** — set a flag to prevent further node scheduling
2. **Tear down running agents** — iterate over in-flight child processes and send SIGTERM (reuse Ctrl+C kill pattern from `agent.ts` if applicable)
3. **Emit structured error trace** — write to stderr with format from design spec section 7:
   - Node name
   - Variable name
   - Producer node (if identifiable)
   - Path taken through the graph
   - Full variable context at failure point

- [ ] **Step 27: Run tests to confirm they pass**

```bash
npx vitest run src/attractor/tests/engine.test.ts
```

Expected: All tests PASS

- [ ] **Step 28: Run full test suite**

```bash
npm test
```

Expected: All tests PASS

- [ ] **Step 29: Commit**

```bash
git add src/attractor/core/engine.ts src/attractor/tests/engine.test.ts
git commit -m "feat(pipeline): graceful shutdown with structured error trace on variable errors"
```

---

## Chunk 4: Chat notes per-run scoping

### File Map

| Action | File | Purpose |
|--------|------|---------|
| Modify | Handler(s) that write/read `chat-notes.md` | Use per-run scoped path |
| Modify | `src/attractor/core/engine.ts` (or run lifecycle) | Generate run ID, pass to context, cleanup on completion |
| Modify | Pipeline dot files | Update `chat-notes.md` path references if hardcoded |

---

### Task 7: Scope chat notes to per-run directory

- [ ] **Step 30: Find all references to chat-notes.md**

```bash
grep -rn "chat-notes" src/ pipelines/ --include="*.ts" --include="*.dot"
```

- [ ] **Step 31: Write test for per-run chat notes isolation**

Test that two successive pipeline runs do not share the same chat-notes.md file. The second run should start with a clean file (or no file).

- [ ] **Step 32: Implement per-run scoping**

Replace the global `meditations/.triage/chat-notes.md` path with `meditations/.triage/<run-id>/chat-notes.md`. The `<run-id>` should be generated at pipeline start and passed through the context so handlers can use it.

- [ ] **Step 33: Add cleanup on pipeline completion**

After the pipeline finishes (success or failure), remove the per-run directory `meditations/.triage/<run-id>/`.

- [ ] **Step 34: Run full test suite**

```bash
npm test
```

Expected: All tests PASS

- [ ] **Step 35: Commit**

```bash
git add -A
git commit -m "fix(pipeline): scope chat-notes.md per-run to prevent cross-illumination contamination"
```

---

## Chunk 5: Pipeline dot file defaults for optional variables

### File Map

| Action | File | Purpose |
|--------|------|---------|
| Modify | `pipelines/illumination-to-plan.dot` | Add `default_refinements` attribute to `design_writer` node |

---

### Task 8: Add default value for $refinements in illumination-to-plan.dot

- [ ] **Step 36: Read the pipeline dot file**

```bash
cat -n pipelines/illumination-to-plan.dot
```

- [ ] **Step 37: Add default_refinements attribute to design_writer**

On the `design_writer` node, add:

```dot
default_refinements="No interactive refinements were requested."
```

This ensures the Approve-without-Chat path produces a sensible prompt instead of throwing.

- [ ] **Step 38: Run pipeline validation**

```bash
ralph pipeline validate pipelines/illumination-to-plan.dot
```

Expected: No errors. The `variable_coverage` rule may emit a warning about `$refinements` being optional with a default — this is informational.

- [ ] **Step 39: Run full test suite**

```bash
npm test
```

Expected: All tests PASS

- [ ] **Step 40: Commit**

```bash
git add pipelines/illumination-to-plan.dot
git commit -m "fix(pipeline): add default_refinements to design_writer for Approve-without-Chat path"
```

---

## Smoke Test

After all chunks, validate end-to-end:

1. **Approve-without-Chat path:** Run `illumination-to-plan.dot` and take the Approve path. Verify `design_writer` receives the default refinements text instead of `$refinements` literal.

2. **Undefined variable error:** Create a test dot file with a node that references `$nonexistent` with no default. Run it and verify:
   - Pipeline stops with a clear error message
   - Error trace includes node name, variable name, and path taken
   - No orphan processes remain

3. **Static validation:** Run `ralph pipeline validate` against the test dot file and verify the `variable_coverage` warning appears.

4. **Chat notes isolation:** Run the pipeline twice in succession. Verify the second run's chat notes are clean (no leftover from the first run).
