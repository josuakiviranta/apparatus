---
status: implemented
---

# Handler Context, Registry Cleanup, and Deduplication Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace untyped `meta` bag with `HandlerExecutionContext`, remove dead registry code, extract shared arg builder and output parser.

**Architecture:** Four sequential refactors — each self-contained, tested, and committed independently. Steps 1-2 are in the handler layer (`src/attractor/`), steps 3-4 are in the CLI layer (`src/cli/lib/`). Step ordering: 1 before 2 (type must exist before cleaning registry), 3 and 4 are independent but both come after 1-2.

**Tech Stack:** TypeScript, vitest

**Spec:** `docs/superpowers/specs/2026-04-14-handler-context-registry-dedup-design.md`

---

## File Map (all changes)

| Action | File | Purpose |
|--------|------|---------|
| Modify | `src/attractor/handlers/registry.ts` | Add `HandlerExecutionContext` type; update `NodeHandler` interface; delete dead exports |
| Modify | `src/attractor/handlers/agent-handler.ts` | Use typed context; replace inline JSON/NDJSON parsing with shared import |
| Modify | `src/attractor/handlers/wait-human.ts` | Update `execute()` signature to use typed context |
| Modify | `src/attractor/handlers/ralph-meditate.ts` | Update `execute()` signature to use typed context |
| Modify | `src/attractor/handlers/ralph-scenarios.ts` | Update `execute()` signature to use typed context |
| Modify | `src/attractor/handlers/parallel.ts` | Update `execute()` signatures to use typed context |
| Modify | `src/attractor/handlers/conditional.ts` | Update `execute()` signature to use typed context |
| Modify | `src/attractor/handlers/start-exit.ts` | Update `execute()` signatures to use typed context |
| Modify | `src/attractor/handlers/tool.ts` | Update `execute()` signature to use typed context |
| Modify | `src/attractor/handlers/store.ts` | Update `execute()` signature to use typed context |
| Modify | `src/attractor/handlers/manager-loop.ts` | Update `execute()` signature to use typed context |
| Modify | `src/attractor/core/engine.ts` | Type the meta object construction as `HandlerExecutionContext` |
| Modify | `src/cli/lib/agent.ts` | Extract `buildCommonArgs()`; replace inline JSON/NDJSON parsing |
| Create | `src/cli/lib/parse-structured-output.ts` | Shared `parseStructuredOutput()` utility |
| Create | `src/cli/lib/parse-structured-output.test.ts` | Unit tests for shared parser |
| Modify | `src/attractor/tests/handlers.test.ts` | Update test meta objects to match typed context |
| Modify | `src/attractor/tests/agent-handler.test.ts` | Update test meta objects |
| Modify | `src/attractor/tests/agent-handler-interactive.test.ts` | Update test meta objects |
| Modify | `src/attractor/tests/agent-handler-json-constraint.test.ts` | Update test meta objects |
| Modify | `src/attractor/tests/store-handler.test.ts` | Update test meta objects |
| Modify | `src/attractor/handlers/store.test.ts` | Update test meta objects |

---

## Chunk 1: Define `HandlerExecutionContext` and update all handlers

### Task 1: Add `HandlerExecutionContext` type to registry.ts

**Files:**
- Modify: `src/attractor/handlers/registry.ts`

- [ ] **Step 1: Read registry.ts**

Read `src/attractor/handlers/registry.ts` to confirm current contents.

- [ ] **Step 2: Add the `HandlerExecutionContext` interface and update `NodeHandler`**

In `src/attractor/handlers/registry.ts`, add the typed interface and update the `NodeHandler` signature. Keep the existing `registerHandler`/`lookupHandler`/`clearHandlers` for now (deleted in Chunk 2).

Add before the `NodeHandler` interface.

`OnInteractiveRequest` is currently defined in `agent-handler.ts`. Move its type definition (and its dependency `InteractiveRequest`) to `registry.ts` to avoid a circular import. Then delete the original export from `agent-handler.ts` and update its import to pull from `registry.js`.

```typescript
import type { InteractiveRequest } from "../types.js";

export type OnInteractiveRequest = (req: InteractiveRequest) => Promise<void>;

export interface HandlerExecutionContext {
  logsRoot: string;
  cwd: string;
  dotDir: string;
  signal?: AbortSignal;
  outgoingLabels: string[];
  completedNodes: string[];
  nodeRetries: Record<string, number>;
  branchOutcomes?: Record<string, Outcome>;
  onStdout?: (s: NodeJS.ReadableStream) => Promise<void>;
  onInteractiveRequest?: OnInteractiveRequest;
}
```

> `branchOutcomes` is optional — `engine.ts` does not set it in the main meta construction, but `parallel.ts` reads it from meta with a `?? {}` fallback. Including it as optional keeps the Parallel handler type-safe without breaking anything.

Update `NodeHandler.execute` signature:

```typescript
export interface NodeHandler {
  execute(node: Node, ctx: PipelineContext, meta: HandlerExecutionContext): Promise<Outcome>;
}
```

- [ ] **Step 3: Run tests to check for type errors**

```bash
npx vitest run src/attractor/
```

Expected: Type errors in tests that construct `meta` as `Record<string, unknown>` or `{}`. This is expected — we fix tests in Task 3.

- [ ] **Step 4: Commit the type definition only**

```bash
git add src/attractor/handlers/registry.ts
git commit -m "refactor(attractor): add HandlerExecutionContext type to NodeHandler interface"
```

---

### Task 2: Update all handler implementations to use typed context

**Files:**
- Modify: `src/attractor/handlers/agent-handler.ts` (lines 50-76, 110)
- Modify: `src/attractor/handlers/wait-human.ts` (line 9)
- Modify: `src/attractor/handlers/ralph-meditate.ts` (line 6)
- Modify: `src/attractor/handlers/ralph-scenarios.ts` (line 6)
- Modify: `src/attractor/handlers/parallel.ts` (lines 5, 15)
- Modify: `src/attractor/handlers/conditional.ts` (line 5)
- Modify: `src/attractor/handlers/start-exit.ts` (lines 5, 11)
- Modify: `src/attractor/handlers/tool.ts` (line 6)
- Modify: `src/attractor/handlers/store.ts` (line 8)
- Modify: `src/attractor/handlers/manager-loop.ts` (line 22)

- [ ] **Step 5: Read all handler files**

Read each handler file listed above to confirm current signatures and meta usage.

- [ ] **Step 6: Update agent-handler.ts — replace unsafe casts with direct property access**

In `src/attractor/handlers/agent-handler.ts`:

1. Change the import to include `HandlerExecutionContext`:
```typescript
import type { NodeHandler, HandlerExecutionContext } from "./registry.js";
```

2. Update `execute` signature:
```typescript
async execute(node: Node, ctx: PipelineContext, meta: HandlerExecutionContext): Promise<Outcome> {
```

3. Replace all `meta["key"] as Type` casts with direct property access:
```typescript
// Before:
const logsRoot = meta["logsRoot"] as string;
const cwd = meta["cwd"] as string;
const dotDir = (meta["dotDir"] ?? meta["cwd"]) as string;
const signal = meta["signal"] as AbortSignal | undefined;
const onStdout = meta["onStdout"] as ((s: NodeJS.ReadableStream) => Promise<void>) | undefined;
const completedNodes = (meta["completedNodes"] as string[]) ?? [];
const nodeRetries = (meta["nodeRetries"] as Record<string, number>) ?? {};
const onInteractiveRequest = meta["onInteractiveRequest"] as OnInteractiveRequest | undefined;

// After:
const { logsRoot, cwd, dotDir, signal, onStdout, completedNodes, nodeRetries, onInteractiveRequest } = meta;
```

- [ ] **Step 7: Update all other handlers**

For handlers that ignore meta (use `_meta`), change the type annotation only:

**wait-human.ts:**
```typescript
import type { NodeHandler, HandlerExecutionContext } from "./registry.js";
// ...
async execute(node: Node, ctx: PipelineContext, meta: HandlerExecutionContext): Promise<Outcome> {
  // Uses meta.outgoingLabels and meta.signal — replace any casts with direct access
```

**ralph-meditate.ts:**
```typescript
import type { NodeHandler, HandlerExecutionContext } from "./registry.js";
// ...
async execute(node: Node, _ctx: PipelineContext, meta: HandlerExecutionContext): Promise<Outcome> {
  // Uses meta.cwd — replace cast with direct access
```

**ralph-scenarios.ts:**
```typescript
import type { NodeHandler, HandlerExecutionContext } from "./registry.js";
// ...
async execute(_node: Node, _ctx: PipelineContext, meta: HandlerExecutionContext): Promise<Outcome> {
  // Uses meta.cwd — replace cast with direct access
```

**parallel.ts (Parallel handler):**
```typescript
import type { NodeHandler, HandlerExecutionContext } from "./registry.js";
// ...
// Parallel.execute uses meta.branchOutcomes — now typed as optional in HandlerExecutionContext.
// Replace: const branchOutcomes = (meta["branchOutcomes"] as Record<string, Outcome>) ?? {};
// With:    const branchOutcomes = meta.branchOutcomes ?? {};
```

**All handlers that ignore meta** (`conditional.ts`, `start-exit.ts`, `tool.ts`, `store.ts`, `manager-loop.ts`, `parallel.ts` FanIn):
```typescript
import type { NodeHandler, HandlerExecutionContext } from "./registry.js";
// Change parameter type from Record<string, unknown> to HandlerExecutionContext
// Keep the _meta naming convention for unused params
```

- [ ] **Step 8: Update engine.ts meta object construction**

In `src/attractor/core/engine.ts` (lines 203-213):

1. Import `HandlerExecutionContext`:
```typescript
import type { NodeHandler, HandlerExecutionContext } from "../handlers/registry.js";
```

2. Type the meta object:
```typescript
const meta: HandlerExecutionContext = {
  logsRoot: opts.logsRoot,
  cwd: opts.cwd,
  dotDir: opts.dotDir ?? opts.cwd,
  signal: opts.signal,
  outgoingLabels,
  completedNodes,
  nodeRetries,
  onStdout: opts.onStdout,
  onInteractiveRequest: opts.onInteractiveRequest,
};
```

> `branchOutcomes` is NOT set here — it's only read by the Parallel handler with a `?? {}` fallback. The `HandlerExecutionContext` type already declares it as optional, so no changes needed in this meta construction.

- [ ] **Step 9: Run tests to verify type correctness**

```bash
npx vitest run src/attractor/
```

Expected: Type errors in test files that construct `meta` as plain objects. Proceed to Task 3.

---

### Task 3: Fix all handler tests to use typed context

**Files:**
- Modify: `src/attractor/tests/handlers.test.ts`
- Modify: `src/attractor/tests/agent-handler.test.ts`
- Modify: `src/attractor/tests/agent-handler-interactive.test.ts`
- Modify: `src/attractor/tests/agent-handler-json-constraint.test.ts`
- Modify: `src/attractor/tests/store-handler.test.ts`
- Modify: `src/attractor/handlers/store.test.ts`

- [ ] **Step 10: Read all test files**

Read each test file to identify where `meta` / `{}` objects are constructed.

- [ ] **Step 11: Create a test helper for default context**

In each test file (or in a shared test util if one already exists), add a helper to construct a valid `HandlerExecutionContext`:

```typescript
import type { HandlerExecutionContext } from "../handlers/registry.js";

function makeContext(overrides: Partial<HandlerExecutionContext> = {}): HandlerExecutionContext {
  return {
    logsRoot: "/tmp/test-logs",
    cwd: "/tmp/test-cwd",
    dotDir: "/tmp/test-cwd",
    outgoingLabels: [],
    completedNodes: [],
    nodeRetries: {},
    ...overrides,
  };
}
```

> Check if a shared test helper file already exists (e.g., `src/attractor/tests/helpers.ts`). If so, add the helper there. If not, inline it in each test file — do NOT create a new shared file just for this (YAGNI, and the spec says no new files beyond the parser utility).

- [ ] **Step 12: Update all test `meta` / `{}` arguments to use `makeContext()`**

Replace every `{}` or `{ logsRoot: ..., cwd: ... }` passed as the third argument to `handler.execute()` with `makeContext()` or `makeContext({ specificKey: value })`.

- [ ] **Step 13: Run full test suite**

```bash
npm test
```

Expected: All tests PASS

- [ ] **Step 14: Run verification grep**

```bash
grep -r 'meta\[' src/attractor/handlers/
```

Expected: No results. All `meta["key"]` casts have been replaced by typed property access.

- [ ] **Step 15: Commit**

```bash
git add src/attractor/
git commit -m "refactor(attractor): replace untyped meta bag with HandlerExecutionContext"
```

---

## Chunk 2: Registry cleanup and buildCommonArgs extraction

### Task 4: Delete dead registry exports

**Files:**
- Modify: `src/attractor/handlers/registry.ts`

- [ ] **Step 16: Read registry.ts (current state after Chunk 1)**

Confirm that `registry.ts` now has `HandlerExecutionContext`, `NodeHandler`, and the dead `handlers` Map + exports.

- [ ] **Step 17: Delete the module-level Map and its three functions**

Remove from `src/attractor/handlers/registry.ts`:
- The `const handlers = new Map<string, NodeHandler>()` declaration (line ~8)
- The `registerHandler()` function (lines ~10-12)
- The `lookupHandler()` function (lines ~14-16)
- The `clearHandlers()` function (lines ~18-20)

The file should now contain ONLY:
- Imports
- `HandlerExecutionContext` interface
- `NodeHandler` interface

- [ ] **Step 18: Search for any imports of deleted exports**

```bash
grep -r 'registerHandler\|lookupHandler\|clearHandlers' src/
```

Expected: Only hits in test files (if any). If test files import these, update them to remove the imports. The agent-registry.test.ts file (`src/cli/tests/agent-registry.test.ts`) may test these — if so, it should be deleted or gutted since the functions no longer exist.

- [ ] **Step 19: Run tests**

```bash
npm test
```

Expected: All tests PASS (or failures only in tests that imported the deleted functions — fix those).

- [ ] **Step 20: Commit**

```bash
git add -A
git commit -m "refactor(attractor): remove dead registerHandler/lookupHandler/clearHandlers from registry"
```

---

### Task 5: Extract `buildCommonArgs()` in agent.ts

**Files:**
- Modify: `src/cli/lib/agent.ts` (lines 85-120, 372-405)

- [ ] **Step 21: Read agent.ts**

Read `src/cli/lib/agent.ts` to confirm the shared prefix between `buildArgs()` and `buildInteractiveArgs()`.

- [ ] **Step 22: Write a failing test for buildCommonArgs behavior**

Find the existing test file for agent.ts (`src/cli/tests/agent.test.ts` or similar). Add a test that validates the common args are produced correctly. Since `buildCommonArgs` will be private, test it indirectly through `buildArgs()` and `buildInteractiveArgs()` — verify both include model, permission mode, tools, and MCP config flags.

> If existing tests already cover this, skip creating new tests. The refactor is behavior-preserving — existing tests ARE the safety net.

- [ ] **Step 23: Run existing agent tests to establish baseline**

```bash
npx vitest run src/cli/tests/agent
```

Expected: All PASS — this is the baseline before refactoring.

- [ ] **Step 24: Extract `buildCommonArgs()` private method**

In `src/cli/lib/agent.ts`, add a private method:

```typescript
private buildCommonArgs(): string[] {
  const args: string[] = [];
  args.push("--model", this.config.model);

  if (this.config.dangerouslySkipPermissions) {
    args.push("--dangerously-skip-permissions");
  } else if (this.config.permissionMode) {
    args.push("--permission-mode", this.config.permissionMode);
  }

  if (this.config.allowedTools) {
    for (const tool of this.config.allowedTools) {
      args.push("--allowedTools", tool);
    }
  }

  if (this.config.mcpConfig) {
    args.push("--mcp-config", this.config.mcpConfig);
  }

  return args;
}
```

> **Important:** Read the actual code first. The above is derived from the research summary — the exact flag names and config property names may differ slightly. Match the existing code exactly.

- [ ] **Step 25: Update `buildArgs()` to use `buildCommonArgs()`**

Replace the duplicated prefix in `buildArgs()`:

```typescript
buildArgs(): string[] {
  const args = this.buildCommonArgs();
  // ... append mode-specific flags (JSON output, etc.)
  return args;
}
```

- [ ] **Step 26: Update `buildInteractiveArgs()` to use `buildCommonArgs()`**

Replace the duplicated prefix in `buildInteractiveArgs()`:

```typescript
buildInteractiveArgs(): string[] {
  const args = ["-p", ...this.buildCommonArgs()];
  // ... append interactive-specific flags (stream-json I/O, etc.)
  return args;
}
```

- [ ] **Step 27: Run agent tests**

```bash
npx vitest run src/cli/tests/agent
```

Expected: All PASS — behavior unchanged.

- [ ] **Step 28: Commit**

```bash
git add src/cli/lib/agent.ts
git commit -m "refactor(cli): extract buildCommonArgs() to deduplicate arg construction"
```

---

## Chunk 3: Shared output parser and final verification

### Task 6: Extract `parseStructuredOutput()`

**Files:**
- Create: `src/cli/lib/parse-structured-output.ts`
- Create: `src/cli/lib/parse-structured-output.test.ts`
- Modify: `src/attractor/handlers/agent-handler.ts` (lines ~208-258)
- Modify: `src/cli/lib/agent.ts` (lines ~240-280)

- [ ] **Step 29: Read the JSON/NDJSON parsing logic in both files**

Read `src/attractor/handlers/agent-handler.ts` lines 200-260 and `src/cli/lib/agent.ts` lines 230-290 to understand the exact parsing logic.

- [ ] **Step 30: Write failing tests for `parseStructuredOutput()`**

Create `src/cli/lib/parse-structured-output.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseStructuredOutput } from "./parse-structured-output.js";

describe("parseStructuredOutput", () => {
  it("parses a JSON array", () => {
    const input = '[{"type":"result","cost":0.5}]';
    const result = parseStructuredOutput(input);
    expect(result).toEqual([{ type: "result", cost: 0.5 }]);
  });

  it("parses a single JSON object by wrapping in array", () => {
    const input = '{"type":"result","cost":0.5}';
    const result = parseStructuredOutput(input);
    expect(result).toEqual([{ type: "result", cost: 0.5 }]);
  });

  it("parses NDJSON (newline-delimited JSON)", () => {
    const input = '{"type":"a"}\n{"type":"b"}';
    const result = parseStructuredOutput(input);
    expect(result).toEqual([{ type: "a" }, { type: "b" }]);
  });

  it("handles leading/trailing whitespace", () => {
    const input = '  [{"type":"result"}]  ';
    const result = parseStructuredOutput(input);
    expect(result).toEqual([{ type: "result" }]);
  });

  it("skips empty lines in NDJSON", () => {
    const input = '{"a":1}\n\n{"b":2}\n';
    const result = parseStructuredOutput(input);
    expect(result).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("returns empty array for empty input", () => {
    expect(parseStructuredOutput("")).toEqual([]);
    expect(parseStructuredOutput("  ")).toEqual([]);
  });
});
```

> **Important:** Read the actual parsing logic first (Step 29). The tests above are a starting point — adjust to match the exact behavior of the existing implementations (error handling, edge cases, etc.).

- [ ] **Step 31: Run tests to verify they fail**

```bash
npx vitest run src/cli/lib/parse-structured-output.test.ts
```

Expected: FAIL — `Cannot find module './parse-structured-output.js'`

- [ ] **Step 32: Implement `parseStructuredOutput()`**

Create `src/cli/lib/parse-structured-output.ts`:

```typescript
/**
 * Parse structured output that may be a JSON array, single JSON object,
 * or newline-delimited JSON (NDJSON).
 */
export function parseStructuredOutput(rawText: string): unknown[] {
  const trimmed = rawText.trim();
  if (!trimmed) return [];

  // Try parsing as a single JSON value (array or object)
  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    // Fall through to NDJSON parsing
  }

  // Parse as NDJSON — one JSON object per line
  const results: unknown[] = [];
  for (const line of trimmed.split("\n")) {
    const stripped = line.trim();
    if (!stripped) continue;
    results.push(JSON.parse(stripped));
  }
  return results;
}
```

> **Important:** Match the exact logic from the existing implementations. If there are try/catch patterns, error messages, or edge-case handling that differ from the above, replicate them faithfully.

- [ ] **Step 33: Run tests to verify they pass**

```bash
npx vitest run src/cli/lib/parse-structured-output.test.ts
```

Expected: All PASS

- [ ] **Step 34: Commit the shared utility**

```bash
git add src/cli/lib/parse-structured-output.ts src/cli/lib/parse-structured-output.test.ts
git commit -m "refactor(cli): extract parseStructuredOutput() shared utility"
```

---

### Task 7: Replace inline parsing in both consumers

**Files:**
- Modify: `src/attractor/handlers/agent-handler.ts`
- Modify: `src/cli/lib/agent.ts`

- [ ] **Step 35: Read both files to identify the exact code blocks to replace**

Re-read `agent-handler.ts` (lines ~205-260) and `agent.ts` (lines ~240-280) to identify the precise inline parsing blocks.

- [ ] **Step 36: Replace inline parsing in agent-handler.ts**

Add import:
```typescript
import { parseStructuredOutput } from "../../cli/lib/parse-structured-output.js";
```

Replace the inline JSON/NDJSON parsing block with:
```typescript
const messages = parseStructuredOutput(rawText);
```

> Verify the import path is correct — `agent-handler.ts` is in `src/attractor/handlers/`, and the utility is in `src/cli/lib/`. Adjust relative path as needed.

- [ ] **Step 37: Replace inline parsing in agent.ts**

Add import:
```typescript
import { parseStructuredOutput } from "./parse-structured-output.js";
```

Replace the inline JSON/NDJSON parsing block with:
```typescript
const messages = parseStructuredOutput(rawText);
```

- [ ] **Step 38: Run full test suite**

```bash
npm test
```

Expected: All tests PASS

- [ ] **Step 39: Commit**

```bash
git add src/attractor/handlers/agent-handler.ts src/cli/lib/agent.ts
git commit -m "refactor: replace inline JSON/NDJSON parsing with shared parseStructuredOutput()"
```

---

### Task 8: Final verification

- [ ] **Step 40: Run verification grep for untyped meta access**

```bash
grep -r 'meta\[' src/attractor/handlers/
```

Expected: No results.

- [ ] **Step 41: Run verification grep for dead registry imports**

```bash
grep -r 'registerHandler\|lookupHandler\|clearHandlers' src/
```

Expected: No results (or only in this plan/spec docs).

- [ ] **Step 42: Run full test suite one final time**

```bash
npm test
```

Expected: All tests PASS

---

### Task 9: Smoke pipeline regression tests via tmux

> **MANDATORY:** Read `docs/harness/tmux-drive.md` before this task. Use only the patterns documented there. Do not invent custom tmux commands.

**Pipelines to run:**
- `pipelines/smoke/chat-only.dot`
- `pipelines/smoke/agent-implement.dot`
- `pipelines/smoke/gate.dot`
- `pipelines/smoke/tool.dot`
- `pipelines/smoke/chat-end-to-end.dot`
- `pipelines/smoke/conditional.dot`
- `pipelines/smoke/meditate-steer.dot`

- [ ] **Step 43: Read tmux-drive.md**

Read `docs/harness/tmux-drive.md` for the authoritative tmux harness patterns.

- [ ] **Step 44: Run each smoke pipeline**

Source the harness, then run each `.dot` file through the pipeline engine. Use `start_run`, `wait_stable`, `capture`, and `cleanup_run` as documented.

Each pipeline must complete without error. Any failure is a blocking regression — investigate and fix before proceeding.

- [ ] **Step 45: Final commit (if any fixes were needed)**

If smoke tests revealed regressions that required fixes:

```bash
git add -A
git commit -m "fix(attractor): resolve smoke pipeline regressions from handler context refactor"
```

---

## Constraints Recap

- **YAGNI / KISS** — only the changes described above
- **No new files** beyond `src/cli/lib/parse-structured-output.ts` (and its test)
- **Existing tests must pass** at every commit point (`npm test`)
- **Step ordering:** 1 → 2 → (3, 4 independent) → verification → smoke tests
- **Smoke tests are non-negotiable** — the refactoring touches handler execution code that all pipelines depend on
