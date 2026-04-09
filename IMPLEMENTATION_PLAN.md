# NDJSON Parsing Fix Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Fix structured output parsing in `agent-handler.ts` so pipeline nodes with `json_schema_file` work in long agentic sessions that produce NDJSON output.

**Architecture:** Replace the single `JSON.parse()` call (which fails on multi-line NDJSON) with line-by-line parsing that extracts the last `{type:"result"}` event. Add raw output instrumentation and explicit missing-output handling.

**Status:** ✅ Chunk 1 complete — committed as 8706da0, tagged 0.0.50

> **Note:** 4 existing tests in `agent-handler.test.ts` also needed updating to use NDJSON mock format (merges parsed JSON, unwraps array wrapper, preferredLabel, and cannot-be-parsed tests). This was discovered during implementation and resolved in the same commit.

**Tech Stack:** TypeScript, vitest

**Spec:** `docs/superpowers/specs/2026-04-09-empty-json-output-fix-design.md`

---

## Chunk 1: Tests and Implementation

### Task 1: Write failing tests for NDJSON parsing

**Files:**
- Modify: `src/attractor/tests/agent-handler-json-constraint.test.ts`

- [x] **Step 1: Write test — NDJSON with `{type:"result"}` parses correctly**

Add after the existing 4 tests, inside the same `describe` block:

```typescript
it("parses NDJSON output and extracts {type:'result'} event", async () => {
  const schema = JSON.stringify({ type: "object", properties: { verdict: { type: "string" } } });
  const logsDir = mkdtempSync(join(tmpdir(), "ralph-ah-json-constraint-"));
  const schemaDir = join(logsDir, "schemas");
  mkdirSync(schemaDir, { recursive: true });
  writeFileSync(join(schemaDir, "test.json"), schema);

  mockResolve.mockReturnValue({ ...baseConfig });
  // Simulate NDJSON output: multiple event lines, result is last
  const ndjson = [
    JSON.stringify({ type: "assistant", message: { content: "thinking..." } }),
    JSON.stringify({ type: "tool_use", tool: "Read", input: { path: "/tmp/x" } }),
    JSON.stringify({ type: "result", result: JSON.stringify({ verdict: "pass", notes: "all good" }) }),
  ].join("\n");
  mockAgentRun.mockResolvedValue({ exitCode: 0, sessionId: null, stdout: null, output: ndjson });

  const handler = new AgentHandler({
    resolveAgent: mockResolve,
    createAgent: () => ({ run: mockAgentRun, kill: mockAgentKill, config: {} } as any),
  });

  try {
    const outcome = await handler.execute(
      makeNode({ jsonSchemaFile: "schemas/test.json" } as any),
      baseCtx(),
      { logsRoot: logsDir, cwd: logsDir, signal: undefined, outgoingLabels: [], completedNodes: [], nodeRetries: {} },
    );

    expect(outcome.status).toBe("success");
    expect(outcome.contextUpdates?.verdict).toBe("pass");
    expect(outcome.contextUpdates?.notes).toBe("all good");
  } finally {
    rmSync(logsDir, { recursive: true, force: true });
  }
});
```

- [x] **Step 2: Write test — NDJSON without `{type:"result"}` fails descriptively**

```typescript
it("returns descriptive failure when NDJSON has no {type:'result'} event", async () => {
  const schema = JSON.stringify({ type: "object", properties: { verdict: { type: "string" } } });
  const logsDir = mkdtempSync(join(tmpdir(), "ralph-ah-json-constraint-"));
  const schemaDir = join(logsDir, "schemas");
  mkdirSync(schemaDir, { recursive: true });
  writeFileSync(join(schemaDir, "test.json"), schema);

  mockResolve.mockReturnValue({ ...baseConfig });
  // Simulate truncated session: events but no result
  const ndjson = [
    JSON.stringify({ type: "assistant", message: { content: "working..." } }),
    JSON.stringify({ type: "tool_use", tool: "Bash", input: { command: "ls" } }),
  ].join("\n");
  mockAgentRun.mockResolvedValue({ exitCode: 0, sessionId: null, stdout: null, output: ndjson });

  const handler = new AgentHandler({
    resolveAgent: mockResolve,
    createAgent: () => ({ run: mockAgentRun, kill: mockAgentKill, config: {} } as any),
  });

  try {
    const outcome = await handler.execute(
      makeNode({ jsonSchemaFile: "schemas/test.json" } as any),
      baseCtx(),
      { logsRoot: logsDir, cwd: logsDir, signal: undefined, outgoingLabels: [], completedNodes: [], nodeRetries: {} },
    );

    expect(outcome.status).toBe("fail");
    expect(outcome.failureReason).toContain("no {type:\"result\"} event found");
  } finally {
    rmSync(logsDir, { recursive: true, force: true });
  }
});
```

- [x] **Step 3: Write test — NDJSON with object-typed `result` (not string) parses correctly**

```typescript
it("parses NDJSON when result is a raw object (not stringified)", async () => {
  const schema = JSON.stringify({ type: "object", properties: { verdict: { type: "string" } } });
  const logsDir = mkdtempSync(join(tmpdir(), "ralph-ah-json-constraint-"));
  const schemaDir = join(logsDir, "schemas");
  mkdirSync(schemaDir, { recursive: true });
  writeFileSync(join(schemaDir, "test.json"), schema);

  mockResolve.mockReturnValue({ ...baseConfig });
  // result is a raw object, not a JSON string — exercises the non-string branch
  const ndjson = [
    JSON.stringify({ type: "assistant", message: { content: "done" } }),
    JSON.stringify({ type: "result", result: { verdict: "pass" } }),
  ].join("\n");
  mockAgentRun.mockResolvedValue({ exitCode: 0, sessionId: null, stdout: null, output: ndjson });

  const handler = new AgentHandler({
    resolveAgent: mockResolve,
    createAgent: () => ({ run: mockAgentRun, kill: mockAgentKill, config: {} } as any),
  });

  try {
    const outcome = await handler.execute(
      makeNode({ jsonSchemaFile: "schemas/test.json" } as any),
      baseCtx(),
      { logsRoot: logsDir, cwd: logsDir, signal: undefined, outgoingLabels: [], completedNodes: [], nodeRetries: {} },
    );

    expect(outcome.status).toBe("success");
    expect(outcome.contextUpdates?.verdict).toBe("pass");
  } finally {
    rmSync(logsDir, { recursive: true, force: true });
  }
});
```

- [x] **Step 4: Write test — `raw-output.txt` is written for post-mortem debugging**

Add `existsSync` to the imports at the top of the file (alongside `writeFileSync, mkdirSync`), then add:

```typescript
it("writes raw-output.txt to nodeDir when jsonSchema output is present", async () => {
  const schema = JSON.stringify({ type: "object", properties: { verdict: { type: "string" } } });
  const logsDir = mkdtempSync(join(tmpdir(), "ralph-ah-json-constraint-"));
  const schemaDir = join(logsDir, "schemas");
  mkdirSync(schemaDir, { recursive: true });
  writeFileSync(join(schemaDir, "test.json"), schema);

  mockResolve.mockReturnValue({ ...baseConfig });
  const ndjson = JSON.stringify({ type: "result", result: JSON.stringify({ verdict: "pass" }) });
  mockAgentRun.mockResolvedValue({ exitCode: 0, sessionId: null, stdout: null, output: ndjson });

  const handler = new AgentHandler({
    resolveAgent: mockResolve,
    createAgent: () => ({ run: mockAgentRun, kill: mockAgentKill, config: {} } as any),
  });

  try {
    await handler.execute(
      makeNode({ jsonSchemaFile: "schemas/test.json" } as any),
      baseCtx(),
      { logsRoot: logsDir, cwd: logsDir, signal: undefined, outgoingLabels: [], completedNodes: [], nodeRetries: {} },
    );

    expect(existsSync(join(logsDir, "work", "raw-output.txt"))).toBe(true);
  } finally {
    rmSync(logsDir, { recursive: true, force: true });
  }
});
```

- [x] **Step 5: Write test — empty output returns descriptive failure**

```typescript
it("returns descriptive failure when agent produces no output", async () => {
  const schema = JSON.stringify({ type: "object", properties: { verdict: { type: "string" } } });
  const logsDir = mkdtempSync(join(tmpdir(), "ralph-ah-json-constraint-"));
  const schemaDir = join(logsDir, "schemas");
  mkdirSync(schemaDir, { recursive: true });
  writeFileSync(join(schemaDir, "test.json"), schema);

  mockResolve.mockReturnValue({ ...baseConfig });
  // Simulate timeout: agent exits without producing output
  mockAgentRun.mockResolvedValue({ exitCode: 0, sessionId: null, stdout: null, output: undefined });

  const handler = new AgentHandler({
    resolveAgent: mockResolve,
    createAgent: () => ({ run: mockAgentRun, kill: mockAgentKill, config: {} } as any),
  });

  try {
    const outcome = await handler.execute(
      makeNode({ jsonSchemaFile: "schemas/test.json" } as any),
      baseCtx(),
      { logsRoot: logsDir, cwd: logsDir, signal: undefined, outgoingLabels: [], completedNodes: [], nodeRetries: {} },
    );

    expect(outcome.status).toBe("fail");
    expect(outcome.failureReason).toContain("agent produced no output");
  } finally {
    rmSync(logsDir, { recursive: true, force: true });
  }
});
```

- [x] **Step 6: Run tests to verify the new tests fail**

Run: `npx vitest run src/attractor/tests/agent-handler-json-constraint.test.ts`
Expected: 5 new tests FAIL (NDJSON string-result, object-result, raw-output.txt, no-result, empty output). Existing 4 tests still pass.

---

### Task 2: Update existing test 4 mock format

**Files:**
- Modify: `src/attractor/tests/agent-handler-json-constraint.test.ts:137-175`

- [x] **Step 1: Update markdown-fail test to use NDJSON-aware assertion**

The existing test 4 returns markdown prose as `output`. The mock stays as-is (markdown is a real failure mode worth testing). With the new NDJSON parser, markdown lines won't parse as JSON and no `{type:"result"}` will be found — same failure, different error message. Update the assertion only:

Replace the assertion at line 171:
```typescript
// Old:
expect(outcome.failureReason).toContain("Structured output parsing failed");
// New:
expect(outcome.failureReason).toContain("no {type:\"result\"} event found");
```

- [x] **Step 2: Run test to verify it still fails (pre-implementation)**

Run: `npx vitest run src/attractor/tests/agent-handler-json-constraint.test.ts`
Expected: test 4 FAILS (old code returns "Structured output parsing failed", new assertion expects "no {type:\"result\"}")

---

### Task 3: Implement NDJSON parsing in agent-handler

**Files:**
- Modify: `src/attractor/handlers/agent-handler.ts:113-142`

- [x] **Step 1: Add missing-output guard before the existing parse block**

Insert at line 113, before `let structuredUpdates`:

```typescript
    // Fail explicitly if jsonSchema was set but agent produced no output
    if (jsonSchema && !lastResult?.output) {
      return {
        status: "fail",
        failureReason: "Structured output: agent produced no output (possible timeout or token limit)",
        contextUpdates: {
          "agent.iterations": String(iteration),
          "agent.success": "false",
        },
      };
    }
```

- [x] **Step 2: Replace the array-based parser with NDJSON line-by-line parser**

Replace lines 117-141 (the `if (jsonSchema && lastResult?.output) { ... }` block) with:

```typescript
    if (jsonSchema && lastResult?.output) {
      writeFileSync(join(nodeDir, "raw-output.txt"), lastResult.output);
      try {
        // Claude CLI emits newline-delimited JSON events.
        // Find the last {type:"result"} line and extract its .result field.
        const lines = lastResult.output.trim().split("\n");
        let resultPayload: string | undefined;

        for (const line of lines) {
          try {
            const event = JSON.parse(line);
            if (event?.type === "result" && event.result != null) {
              resultPayload = typeof event.result === "string"
                ? event.result
                : JSON.stringify(event.result);
            }
          } catch {
            // Skip non-JSON lines
          }
        }

        if (!resultPayload) {
          return {
            status: "fail",
            failureReason: `Structured output: no {type:"result"} event found in ${lines.length} output lines`,
            contextUpdates: {
              "agent.iterations": String(iteration),
              "agent.success": "false",
            },
          };
        }

        const parsed = JSON.parse(resultPayload);
        for (const [key, value] of Object.entries(parsed)) {
          structuredUpdates[key] = String(value);
        }
        if (parsed.preferred_label != null) {
          preferredLabel = String(parsed.preferred_label);
        }
      } catch (err) {
        return {
          status: "fail",
          failureReason: `Structured output parsing failed: ${(err as Error).message}`,
          contextUpdates: {
            "agent.iterations": String(iteration),
            "agent.success": "false",
          },
        };
      }
    }
```

- [x] **Step 3: Run all tests**

Run: `npx vitest run src/attractor/tests/agent-handler-json-constraint.test.ts`
Expected: All 9 tests PASS

- [x] **Step 4: Run full test suite to check for regressions**

Run: `npx vitest run`
Expected: All tests pass

- [x] **Step 5: Build**

Run: `npm run build`
Expected: Clean build, no errors

- [x] **Step 6: Commit**

```bash
git add src/attractor/handlers/agent-handler.ts src/attractor/tests/agent-handler-json-constraint.test.ts
git commit -m "fix: parse NDJSON output in agent-handler for long agentic sessions

Replace single JSON.parse() (fails on multi-line NDJSON) with line-by-line
parsing that extracts the last {type:\"result\"} event. Add raw output dump
for post-mortem debugging and explicit missing-output guard.

Closes: empty JSON output in pipeline verifier nodes (50+ subagent sessions)"
```
