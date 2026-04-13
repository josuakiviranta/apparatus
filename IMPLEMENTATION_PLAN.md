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

## Chunk 2: Static validation — `variable_coverage` rule in `validateGraph()` ✅ DONE

Completed: `validateGraph()` now includes a `variable_coverage` rule that warns when a `$variable` used in a node's prompt/toolCommand may be undefined because all producer nodes can be bypassed via conditional routing. Uses BFS reachability algorithm (remove all producers, check if consumer still reachable from start).

**Producer detection:** handler type conventions (tool→tool.output, store→store.path, wait.human→chat.output), interactive nodes→chat.output, explicit `produces` attribute on nodes. Consumer `default_<var>` attributes suppress warnings.

**Also completed:** ToolHandler now calls `expandVariables` on `toolCommand` at runtime.

8 new test cases, all 48 graph tests pass. Tagged v0.1.14.

---

## Chunk 3: Graceful shutdown + structured error trace ✅ DONE

Completed: Engine catches `UndefinedVariableError` thrown by any handler during `handler.execute()`. On catch: immediately returns `{ status: "fail" }` with structured `failureReason` containing variable name, node name, execution path, and full variable context dump. Fires `onNodeEnd` with fail status for TUI updates. Non-variable errors re-thrown. 3 new tests (24 total engine tests), all pass.

**Remaining spec items deferred to future work:**
- Producer node detection (requires graph analysis from variable_coverage rule)
- Skipped node analysis (requires comparing actual vs possible paths)
- Trace file output to `meditations/.triage/<run-id>/error-trace.json`
- Agent teardown is a no-op in the current sequential engine (no concurrent in-flight agents)

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
