# Attractor Pipeline Engine Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add a DOT-graph pipeline engine (Attractor) to ralph-cli so users can define agentic workflows as `.dot` files and run them with `ralph pipeline run <dotfile>`.

**Architecture:** The engine lives in `src/attractor/` and is bundled into the existing ralph binary. It parses a supported DOT subset into a typed `Graph`, validates it, applies transforms, then executes nodes via typed handlers. The `runLoop()` function is refactored to return `LoopResult` and accept `AbortSignal` so handlers can drive it without taking over the process.

**Tech Stack:** TypeScript, Node.js, vitest, tsup, commander. No new npm packages — DOT parsing is hand-rolled (the subset is small enough).

---

## Chunk 1: Types + loop.ts Refactor

### Task 1: Shared types

**Files:**
- Create: `src/attractor/types.ts`
- Create: `src/attractor/tests/types.test.ts`

- [x] **Step 1: Write `src/attractor/types.ts`**

```typescript
// src/attractor/types.ts

export type OutcomeStatus = "success" | "retry" | "fail" | "partial_success";

export interface Outcome {
  status: OutcomeStatus;
  notes?: string;
  failureReason?: string;
  preferredLabel?: string;
  suggestedNextIds?: string[];
  contextUpdates?: Record<string, string>;
}

export interface Node {
  id: string;
  shape?: string;
  type?: string;
  label?: string;
  prompt?: string;
  toolCommand?: string;
  goalGate?: boolean;
  loopRestart?: boolean;
  maxRetries?: number;
  fidelity?: string;
  threadId?: string;
  llmModel?: string;
  llmProvider?: string;
  reasoningEffort?: string;
  retryTarget?: string;
  fallbackRetryTarget?: string;
  class?: string;
  [key: string]: unknown;
}

export interface Edge {
  from: string;
  to: string;
  label?: string;
  condition?: string;
  weight?: number;
  loopRestart?: boolean;
  fidelity?: string;
  threadId?: string;
  [key: string]: unknown;
}

export interface Graph {
  name: string;
  goal?: string;
  label?: string;
  modelStylesheet?: string;
  defaultMaxRetries?: number;
  defaultFidelity?: string;
  maxParallel?: number;
  retryTarget?: string;
  fallbackRetryTarget?: string;
  nodes: Map<string, Node>;
  edges: Edge[];
}

export interface CheckpointState {
  timestamp: string;
  currentNode: string;
  completedNodes: string[];
  nodeRetries: Record<string, number>;
  context: Record<string, string>;
}

export interface PipelineContext {
  values: Record<string, string>;
}

export type Transform = (graph: Graph) => Graph;

export interface Diagnostic {
  rule: string;
  severity: "error" | "warning";
  message: string;
}
```

- [x] **Step 2: Write a trivial type-shape test**

```typescript
// src/attractor/tests/types.test.ts
import { describe, it, expect } from "vitest";
import type { Graph, Node, Edge, Outcome } from "../types.js";

describe("types", () => {
  it("Graph accepts nodes and edges", () => {
    const g: Graph = {
      name: "test",
      nodes: new Map([["start", { id: "start", shape: "Mdiamond" }]]),
      edges: [],
    };
    expect(g.nodes.size).toBe(1);
  });

  it("Outcome has required status", () => {
    const o: Outcome = { status: "success" };
    expect(o.status).toBe("success");
  });
});
```

- [x] **Step 3: Run test**

```bash
cd /Users/josu/Documents/projects/ralph-cli && npm test -- --reporter=verbose src/attractor/tests/types.test.ts
```
Expected: 2 passing

- [x] **Step 4: Commit**

```bash
git add src/attractor/types.ts src/attractor/tests/types.test.ts
git commit -m "feat(attractor): add shared types"
```

---

### Task 2: Refactor loop.ts to return LoopResult and accept AbortSignal

**Files:**
- Modify: `src/cli/lib/loop.ts`
- Modify: `src/cli/tests/loop.test.ts`
- Modify: `src/cli/commands/implement.ts`

- [x] **Step 1: Add `LoopResult` to loop.ts and update `LoopOptions`**

Replace the `LoopOptions` interface and function signature at the top of `src/cli/lib/loop.ts`:

```typescript
export interface LoopOptions {
  promptFile: string;
  cwd: string;
  max?: number;
  model?: string;
  signal?: AbortSignal;
  onSessionId?: (id: string) => void;
}

export interface LoopResult {
  success: boolean;
  iterations: number;
  sessionId?: string;
  exitReason: "completed" | "maxReached" | "aborted" | "error";
  errorMessage?: string;
}

export async function runLoop(options: LoopOptions): Promise<LoopResult> {
```

- [x] **Step 2: Replace `process.exit` pre-flights with thrown errors**

Change the two pre-flight checks:

```typescript
  // Pre-flight: prompt file
  if (!existsSync(promptFile)) {
    await output.error(`Prompt file not found: ${promptFile}`);
    throw new Error(`Prompt file not found: ${promptFile}`);
  }

  // Pre-flight: claude CLI
  const which = spawnSync("which", ["claude"], { encoding: "utf8" });
  if (which.status !== 0) {
    await output.error("claude CLI not found. Install: npm install -g @anthropic-ai/claude-code");
    throw new Error("claude CLI not found");
  }
```

- [x] **Step 3: Replace SIGINT/SIGTERM handlers with AbortSignal and return LoopResult**

Remove the `onSignal` / `process.on` block. Add abort-signal checking. Track `sessionId` via `onSessionId`. Return `LoopResult` at all exit points. The full updated function body after pre-flights:

```typescript
  const branchResult = spawnSync("git", ["branch", "--show-current"], {
    cwd,
    encoding: "utf8",
  });
  const branch = branchResult.stdout.trim() || "main";

  await output.header({ mode: "implement", project: cwd, branch, pid: process.pid });

  let iteration = 0;
  let currentPid: number | undefined;
  let capturedSessionId: string | undefined;

  const killCurrent = () => {
    if (currentPid !== undefined) {
      try { process.kill(-currentPid, "SIGTERM"); } catch {}
    }
  };

  if (signal?.aborted) {
    return { success: false, iterations: 0, exitReason: "aborted" };
  }

  const abortListener = () => { killCurrent(); };
  signal?.addEventListener("abort", abortListener);

  try {
    while (true) {
      if (signal?.aborted) {
        return { success: false, iterations, sessionId: capturedSessionId, exitReason: "aborted" };
      }

      if (max !== undefined && iteration >= max) {
        await output.info(`Reached max iterations: ${max}`);
        return { success: true, iterations, sessionId: capturedSessionId, exitReason: "maxReached" };
      }

      const child = spawn(
        "claude",
        ["-p", "--dangerously-skip-permissions", "--output-format=stream-json", "--model", model],
        { cwd, stdio: ["pipe", "pipe", "inherit"], detached: true }
      );

      currentPid = child.pid;

      let exitCode = 0;
      const exitPromise = new Promise<void>((resolve) => {
        child.on("exit", (code) => { exitCode = code ?? 0; resolve(); });
      });

      const readStream = createReadStream(promptFile);
      readStream.pipe(child.stdin as NodeJS.WritableStream);

      await output.stream(streamEvents(child.stdout as NodeJS.ReadableStream, {
        onSessionId: (id) => {
          capturedSessionId = id;
          onSessionId?.(id);
        },
      }));
      await exitPromise;

      currentPid = undefined;

      if (exitCode !== 0) {
        await output.warn(`claude exited with code ${exitCode}`);
      }

      const push = spawnSync("git", ["push", "origin", branch], { cwd, encoding: "utf8" });
      if (push.status !== 0) {
        const retry = spawnSync("git", ["push", "-u", "origin", branch], { cwd, encoding: "utf8" });
        if (retry.status !== 0) {
          await output.warn(`git push failed: ${retry.stderr ?? "unknown error"}`);
        }
      }

      iteration++;
      await output.step(`LOOP ${iteration}`);
    }
  } finally {
    signal?.removeEventListener("abort", abortListener);
  }
}
```

- [x] **Step 4: Check streamEvents signature — add onSessionId option if needed**

Open `src/cli/lib/stream-formatter.ts` and verify `streamEvents` already accepts or needs an `options` param. If the current signature is `streamEvents(stream)`, update it to:

```typescript
export async function* streamEvents(
  stream: NodeJS.ReadableStream,
  options?: { onSessionId?: (id: string) => void }
): AsyncGenerator<StreamEvent>
```

Wire `onSessionId` by firing it when a `session_id` event is encountered in the stream.

- [x] **Step 5: Update implement.ts to wrap runLoop in try/catch + own AbortController**

Replace the `runLoop` call in `src/cli/commands/implement.ts`:

```typescript
  const promptFile = resolve(absPath, "PROMPT_build.md");

  const ac = new AbortController();
  const onSignal = () => ac.abort();
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  try {
    await runLoop({ promptFile, cwd: absPath, max: options.max, signal: ac.signal });
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  }
  process.exit(0);
```

- [x] **Step 6: Update loop tests for new return type**

In `src/cli/tests/loop.test.ts`, update tests that called `await runLoop(...)` without checking return value — they still work. Update the pre-flight tests to check for thrown errors instead of `process.exit`:

```typescript
  it("throws if promptFile does not exist", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    await expect(
      runLoop({ promptFile: "/no/such/file.md", cwd: "/proj" })
    ).rejects.toThrow("Prompt file not found");
    expect(out.error).toHaveBeenCalled();
    expect(cp.spawn).not.toHaveBeenCalled();
  });

  it("throws if claude is not in PATH", async () => {
    vi.mocked(cp.spawnSync).mockReturnValue({ stdout: "", status: 1 } as any);
    await expect(
      runLoop({ promptFile: "/proj/PROMPT_build.md", cwd: "/proj" })
    ).rejects.toThrow("claude CLI not found");
    expect(out.error).toHaveBeenCalled();
    expect(cp.spawn).not.toHaveBeenCalled();
  });
```

Add a test for `exitReason`:

```typescript
  it("returns exitReason=maxReached when max iterations hit", async () => {
    makeMockChild(0);
    mockGitBranch("main");
    const result = await runLoop({ promptFile: "/proj/PROMPT_build.md", cwd: "/proj", max: 1 });
    expect(result.exitReason).toBe("maxReached");
    expect(result.iterations).toBe(1);
  });

  it("returns exitReason=aborted when signal is pre-aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    const result = await runLoop({ promptFile: "/proj/PROMPT_build.md", cwd: "/proj", signal: ac.signal });
    expect(result.exitReason).toBe("aborted");
    expect(cp.spawn).not.toHaveBeenCalled();
  });
```

- [x] **Step 7: Run all tests**

```bash
cd /Users/josu/Documents/projects/ralph-cli && npm test
```
Expected: all passing

- [x] **Step 8: Commit**

```bash
git add src/cli/lib/loop.ts src/cli/lib/stream-formatter.ts src/cli/commands/implement.ts src/cli/tests/loop.test.ts
git commit -m "feat(loop): return LoopResult, accept AbortSignal, remove internal signal handlers"
```

---

## Chunk 2: DOT Parser

### Task 3: graph.ts — DOT parser

**Files:**
- Create: `src/attractor/core/graph.ts`
- Create: `src/attractor/tests/graph.test.ts`

- [x] **Step 1: Write failing tests for basic DOT parsing**

```typescript
// src/attractor/tests/graph.test.ts
import { describe, it, expect } from "vitest";
import { parseDot } from "../core/graph.js";

describe("parseDot", () => {
  it("parses a minimal digraph with start and exit nodes", () => {
    const dot = `digraph test {
      goal="Do something"
      start [shape=Mdiamond]
      done  [shape=Msquare]
      start -> done
    }`;
    const graph = parseDot(dot);
    expect(graph.name).toBe("test");
    expect(graph.goal).toBe("Do something");
    expect(graph.nodes.has("start")).toBe(true);
    expect(graph.nodes.get("start")?.shape).toBe("Mdiamond");
    expect(graph.nodes.has("done")).toBe(true);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]).toMatchObject({ from: "start", to: "done" });
  });

  it("strips // line comments", () => {
    const dot = `digraph g {
      // this is a comment
      start [shape=Mdiamond]
      done [shape=Msquare]
      start -> done
    }`;
    const graph = parseDot(dot);
    expect(graph.nodes.size).toBe(2);
  });

  it("strips /* */ block comments", () => {
    const dot = `digraph g {
      /* block comment */
      start [shape=Mdiamond]
      done [shape=Msquare]
      start -> done
    }`;
    const graph = parseDot(dot);
    expect(graph.nodes.size).toBe(2);
  });

  it("parses node with multiple attributes", () => {
    const dot = `digraph g {
      start [shape=Mdiamond]
      done [shape=Msquare]
      implement [shape=box, prompt="Do the work", max_retries=3]
      start -> implement -> done
    }`;
    const graph = parseDot(dot);
    const n = graph.nodes.get("implement")!;
    expect(n.shape).toBe("box");
    expect(n.prompt).toBe("Do the work");
    expect(n.maxRetries).toBe(3);
  });

  it("parses chained edges A -> B -> C as two edges", () => {
    const dot = `digraph g {
      start [shape=Mdiamond]
      mid [shape=box]
      done [shape=Msquare]
      start -> mid -> done
    }`;
    const graph = parseDot(dot);
    expect(graph.edges).toHaveLength(2);
    expect(graph.edges[0]).toMatchObject({ from: "start", to: "mid" });
    expect(graph.edges[1]).toMatchObject({ from: "mid", to: "done" });
  });

  it("parses edge with label and condition", () => {
    const dot = `digraph g {
      start [shape=Mdiamond]
      done [shape=Msquare]
      start -> done [label="OK", condition="outcome=success", weight=2]
    }`;
    const graph = parseDot(dot);
    expect(graph.edges[0]).toMatchObject({
      label: "OK",
      condition: "outcome=success",
      weight: 2,
    });
  });

  it("applies node default blocks to subsequent declarations", () => {
    const dot = `digraph g {
      node [shape=box]
      start [shape=Mdiamond]
      work []
      done [shape=Msquare]
      start -> work -> done
    }`;
    const graph = parseDot(dot);
    expect(graph.nodes.get("work")?.shape).toBe("box");
    expect(graph.nodes.get("start")?.shape).toBe("Mdiamond"); // explicit overrides
  });

  it("parses graph-level attributes", () => {
    const dot = `digraph pipeline {
      goal="Ship it"
      label="My Pipeline"
      default_max_retries=2
      start [shape=Mdiamond]
      done [shape=Msquare]
      start -> done
    }`;
    const graph = parseDot(dot);
    expect(graph.goal).toBe("Ship it");
    expect(graph.label).toBe("My Pipeline");
    expect(graph.defaultMaxRetries).toBe(2);
  });

  it("flattens subgraph blocks", () => {
    const dot = `digraph g {
      start [shape=Mdiamond]
      done [shape=Msquare]
      subgraph cluster_1 {
        work [shape=box]
      }
      start -> work -> done
    }`;
    const graph = parseDot(dot);
    expect(graph.nodes.has("work")).toBe(true);
    expect(graph.edges).toHaveLength(2);
  });

  it("parses multi-line attribute blocks", () => {
    const dot = `digraph g {
      start [shape=Mdiamond]
      done [shape=Msquare]
      work [
        shape=box,
        prompt="Do the thing"
      ]
      start -> work -> done
    }`;
    const graph = parseDot(dot);
    expect(graph.nodes.get("work")?.prompt).toBe("Do the thing");
  });

  it("converts snake_case attribute names to camelCase on nodes", () => {
    const dot = `digraph g {
      start [shape=Mdiamond]
      done [shape=Msquare, goal_gate=true]
      start -> done
    }`;
    const graph = parseDot(dot);
    expect(graph.nodes.get("done")?.goalGate).toBe(true);
  });

  it("merges class attributes from model_stylesheet", () => {
    const dot = `digraph g {
      model_stylesheet="
        .fast { llm_model: claude-haiku-4-5-20251001 }
      "
      start [shape=Mdiamond]
      done [shape=Msquare]
      work [class=fast, shape=box]
      start -> work -> done
    }`;
    const graph = parseDot(dot);
    // After stylesheet transform this gets resolved; parser just preserves class
    expect(graph.nodes.get("work")?.class).toBe("fast");
  });
});
```

- [x] **Step 2: Run tests to confirm they fail**

```bash
cd /Users/josu/Documents/projects/ralph-cli && npm test -- src/attractor/tests/graph.test.ts 2>&1 | head -20
```
Expected: fails with "Cannot find module"

- [x] **Step 3: Implement `src/attractor/core/graph.ts`**

```typescript
// src/attractor/core/graph.ts
import type { Graph, Node, Edge } from "../types.js";

// Convert snake_case to camelCase
function toCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

// Convert attribute value string to typed value
function coerceValue(val: string): unknown {
  if (val === "true") return true;
  if (val === "false") return false;
  const n = Number(val);
  if (!isNaN(n) && val.trim() !== "") return n;
  return val;
}

// Strip // and /* */ comments from DOT source
function stripComments(src: string): string {
  // Block comments first
  src = src.replace(/\/\*[\s\S]*?\*\//g, "");
  // Line comments
  src = src.replace(/\/\/.*/g, "");
  return src;
}

// Parse key=value attribute list from a string like: shape=box, label="foo bar", max_retries=3
function parseAttrs(attrStr: string): Record<string, unknown> {
  const attrs: Record<string, unknown> = {};
  // Match key="value" or key=value (no quotes)
  const re = /(\w+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s,\]]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(attrStr)) !== null) {
    const key = toCamel(m[1]);
    const val = m[2] !== undefined ? m[2] : m[3];
    attrs[key] = coerceValue(val);
  }
  return attrs;
}

// Parse the model_stylesheet block into a simple structure
function parseStylesheet(css: string): Array<{ selector: string; selectorType: "shape" | "class" | "id" | "universal"; props: Record<string, string> }> {
  const rules: Array<{ selector: string; selectorType: "shape" | "class" | "id" | "universal"; props: Record<string, string> }> = [];
  const ruleRe = /([^\{]+)\{([^\}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = ruleRe.exec(css)) !== null) {
    const selectorRaw = m[1].trim();
    const body = m[2];
    const props: Record<string, string> = {};
    const propRe = /([\w_-]+)\s*:\s*([^\s;]+)/g;
    let pm: RegExpExecArray | null;
    while ((pm = propRe.exec(body)) !== null) {
      props[toCamel(pm[1])] = pm[2].replace(/['"]/g, "");
    }
    let selectorType: "shape" | "class" | "id" | "universal";
    let selector = selectorRaw;
    if (selectorRaw === "*") { selectorType = "universal"; }
    else if (selectorRaw.startsWith(".")) { selectorType = "class"; selector = selectorRaw.slice(1); }
    else if (selectorRaw.startsWith("#")) { selectorType = "id"; selector = selectorRaw.slice(1); }
    else { selectorType = "shape"; }
    rules.push({ selector, selectorType, props });
  }
  return rules;
}

// Apply stylesheet rules to a node (lowest specificity first, explicit attrs win)
function applyStylesheet(
  node: Node,
  rules: Array<{ selector: string; selectorType: "shape" | "class" | "id" | "universal"; props: Record<string, string> }>
): Node {
  const specificity = (t: string) =>
    t === "universal" ? 0 : t === "shape" ? 1 : t === "class" ? 2 : 3;
  const sorted = [...rules].sort((a, b) => specificity(a.selectorType) - specificity(b.selectorType));
  const resolved: Record<string, string> = {};
  for (const rule of sorted) {
    const matches =
      (rule.selectorType === "universal") ||
      (rule.selectorType === "shape" && node.shape === rule.selector) ||
      (rule.selectorType === "class" && node.class === rule.selector) ||
      (rule.selectorType === "id" && node.id === rule.selector);
    if (matches) Object.assign(resolved, rule.props);
  }
  // Merge resolved (stylesheet) props, but explicit node attrs take precedence
  return { ...resolved, ...node };
}

export function parseDot(src: string): Graph {
  src = stripComments(src);

  // Extract digraph name
  const nameMatch = src.match(/digraph\s+(\w+)\s*\{/);
  const name = nameMatch?.[1] ?? "unnamed";

  // Remove digraph wrapper
  const inner = src.replace(/digraph\s+\w+\s*\{/, "").replace(/\}\s*$/, "");

  const nodes = new Map<string, Node>();
  const edges: Edge[] = [];
  const graphAttrs: Record<string, unknown> = {};
  let nodeDefaults: Record<string, unknown> = {};
  let edgeDefaults: Record<string, unknown> = {};

  // Flatten subgraph blocks (recursively remove subgraph wrappers, keep contents)
  function flattenSubgraphs(s: string): string {
    return s.replace(/subgraph\s+\w*\s*\{([^{}]*)\}/g, (_, body) => body);
  }
  let flat = flattenSubgraphs(inner);
  // Handle nested subgraphs (up to 3 levels)
  flat = flattenSubgraphs(flattenSubgraphs(flat));

  // Tokenize by lines for simpler processing
  // Normalize multi-line attribute blocks to single lines
  // Strategy: collapse [...] spans that cross lines
  let normalized = flat.replace(/\[([^\]]*)\]/gs, (_, body) => {
    return "[" + body.replace(/\s*\n\s*/g, " ") + "]";
  });

  const lines = normalized.split("\n").map(l => l.trim()).filter(l => l.length > 0);

  for (const line of lines) {
    // Graph-level attribute: key="value" or key=value (no -> , no [ at start)
    if (!line.includes("->") && !line.startsWith("[") && !line.startsWith("node") && !line.startsWith("edge") && line.includes("=") && !line.includes("[")) {
      const m = line.match(/^(\w+)\s*=\s*"?(.*?)"?\s*;?\s*$/);
      if (m) {
        graphAttrs[toCamel(m[1])] = coerceValue(m[2]);
        continue;
      }
    }

    // Node/edge default block: node [...] or edge [...]
    const defaultMatch = line.match(/^(node|edge)\s*\[([^\]]*)\]/);
    if (defaultMatch) {
      const attrs = parseAttrs(defaultMatch[2]);
      if (defaultMatch[1] === "node") nodeDefaults = { ...nodeDefaults, ...attrs };
      else edgeDefaults = { ...edgeDefaults, ...attrs };
      continue;
    }

    // Graph attribute block: graph [...]
    const graphBlockMatch = line.match(/^graph\s*\[([^\]]*)\]/);
    if (graphBlockMatch) {
      Object.assign(graphAttrs, parseAttrs(graphBlockMatch[1]));
      continue;
    }

    // Edge declaration: A -> B -> C [...] or A -> B [...]
    if (line.includes("->")) {
      // Split off trailing attribute block
      const edgeAttrMatch = line.match(/^(.*?)\s*(?:\[([^\]]*)\])?\s*;?\s*$/);
      const edgePart = edgeAttrMatch?.[1] ?? "";
      const attrPart = edgeAttrMatch?.[2] ?? "";
      const edgeAttrs = { ...edgeDefaults, ...parseAttrs(attrPart) };

      const nodeIds = edgePart.split("->").map(s => s.trim()).filter(Boolean);
      for (let i = 0; i < nodeIds.length - 1; i++) {
        edges.push({ from: nodeIds[i], to: nodeIds[i + 1], ...edgeAttrs } as Edge);
      }
      continue;
    }

    // Node declaration: node_id [...] or node_id [...]
    const nodeMatch = line.match(/^(\w+)\s*(?:\[([^\]]*)\])?\s*;?\s*$/);
    if (nodeMatch && nodeMatch[1] !== "graph" && nodeMatch[1] !== "node" && nodeMatch[1] !== "edge") {
      const id = nodeMatch[1];
      const attrStr = nodeMatch[2] ?? "";
      const attrs = { ...nodeDefaults, ...parseAttrs(attrStr) };
      nodes.set(id, { id, ...attrs } as Node);
      continue;
    }
  }

  // Build Graph object from graphAttrs
  const stylesheet = (graphAttrs["modelStylesheet"] as string) ?? "";
  const rules = stylesheet ? parseStylesheet(stylesheet) : [];

  // Apply stylesheet to all nodes
  if (rules.length > 0) {
    for (const [id, node] of nodes) {
      nodes.set(id, applyStylesheet(node, rules));
    }
  }

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
    nodes,
    edges,
  };
}
```

- [x] **Step 4: Run graph tests**

```bash
cd /Users/josu/Documents/projects/ralph-cli && npm test -- src/attractor/tests/graph.test.ts
```
Expected: all passing

- [x] **Step 5: Commit**

```bash
git add src/attractor/core/graph.ts src/attractor/tests/graph.test.ts
git commit -m "feat(attractor): DOT parser — parseDot()"
```

---

### Task 4: Validation and linting

**Files:**
- Modify: `src/attractor/core/graph.ts` (add `validateGraph`)
- Modify: `src/attractor/tests/graph.test.ts` (add validation tests)

- [x] **Step 1: Write failing validation tests**

Append to `src/attractor/tests/graph.test.ts`:

```typescript
import { validateGraph } from "../core/graph.js";

describe("validateGraph", () => {
  function makeValid() {
    return parseDot(`digraph g {
      start [shape=Mdiamond]
      done  [shape=Msquare]
      start -> done
    }`);
  }

  it("returns no errors for a valid graph", () => {
    const diags = validateGraph(makeValid());
    expect(diags.filter(d => d.severity === "error")).toHaveLength(0);
  });

  it("errors when no start node", () => {
    const g = makeValid();
    g.nodes.delete("start");
    g.edges = [];
    const diags = validateGraph(g);
    expect(diags.some(d => d.rule === "start_node")).toBe(true);
  });

  it("errors when no exit node", () => {
    const g = makeValid();
    g.nodes.delete("done");
    g.edges = [];
    const diags = validateGraph(g);
    expect(diags.some(d => d.rule === "terminal_node")).toBe(true);
  });

  it("errors on orphan node (unreachable from start)", () => {
    const g = makeValid();
    g.nodes.set("orphan", { id: "orphan", shape: "box" });
    const diags = validateGraph(g);
    expect(diags.some(d => d.rule === "reachability")).toBe(true);
  });

  it("errors on edge targeting unknown node", () => {
    const g = makeValid();
    g.edges.push({ from: "start", to: "ghost" });
    const diags = validateGraph(g);
    expect(diags.some(d => d.rule === "edge_target_exists")).toBe(true);
  });

  it("errors when start node has incoming edges", () => {
    const g = makeValid();
    g.edges.push({ from: "done", to: "start" });
    const diags = validateGraph(g);
    expect(diags.some(d => d.rule === "start_no_incoming")).toBe(true);
  });

  it("errors when exit node has outgoing edges", () => {
    const g = makeValid();
    g.edges.push({ from: "done", to: "start" });
    const diags = validateGraph(g);
    expect(diags.some(d => d.rule === "exit_no_outgoing")).toBe(true);
  });

  it("warns on unknown node type", () => {
    const g = makeValid();
    g.nodes.get("start")!.type = "unknown.handler";
    const diags = validateGraph(g);
    expect(diags.some(d => d.rule === "type_known" && d.severity === "warning")).toBe(true);
  });

  it("errors on bad condition expression syntax", () => {
    const g = makeValid();
    g.edges[0].condition = "outcome == success"; // double-equals not supported
    const diags = validateGraph(g);
    expect(diags.some(d => d.rule === "condition_syntax")).toBe(true);
  });
});
```

- [x] **Step 2: Run to confirm fail**

```bash
cd /Users/josu/Documents/projects/ralph-cli && npm test -- src/attractor/tests/graph.test.ts 2>&1 | grep "FAIL\|validateGraph"
```

- [x] **Step 3: Implement `validateGraph` and `validateOrRaise` in `src/attractor/core/graph.ts`**

Add these exports to the bottom of `graph.ts`:

```typescript
const KNOWN_TYPES = new Set([
  "codergen", "tool", "wait.human", "conditional", "parallel", "parallel.fan_in",
  "stack.manager_loop", "start", "exit",
  "ralph.implement", "ralph.meditate", "ralph.run-scenarios",
]);

const SHAPE_TO_TYPE: Record<string, string> = {
  Mdiamond: "start", Msquare: "exit", box: "codergen",
  hexagon: "wait.human", diamond: "conditional", component: "parallel",
  tripleoctagon: "parallel.fan_in", parallelogram: "tool", house: "stack.manager_loop",
  circle: "ralph.implement", octagon: "ralph.meditate", square: "ralph.run-scenarios",
};

export function resolveHandlerType(node: Node): string {
  if (node.type) return node.type;
  if (node.shape && SHAPE_TO_TYPE[node.shape]) return SHAPE_TO_TYPE[node.shape];
  return "codergen";
}

export function validateGraph(graph: Graph): Diagnostic[] {
  const diags: Diagnostic[] = [];
  const { nodes, edges } = graph;

  const isStart = (n: Node) => n.shape === "Mdiamond" || n.id === "start" || n.id === "Start";
  const isExit  = (n: Node) => n.shape === "Msquare"  || n.id === "exit"  || n.id === "end";

  const startNodes = [...nodes.values()].filter(isStart);
  const exitNodes  = [...nodes.values()].filter(isExit);

  if (startNodes.length !== 1) diags.push({ rule: "start_node", severity: "error", message: `Expected exactly 1 start node, found ${startNodes.length}` });
  if (exitNodes.length !== 1)  diags.push({ rule: "terminal_node", severity: "error", message: `Expected exactly 1 exit node, found ${exitNodes.length}` });

  // Reachability BFS from start
  if (startNodes.length === 1) {
    const reachable = new Set<string>();
    const queue = [startNodes[0].id];
    while (queue.length) {
      const cur = queue.shift()!;
      if (reachable.has(cur)) continue;
      reachable.add(cur);
      for (const e of edges.filter(e => e.from === cur)) queue.push(e.to);
    }
    for (const id of nodes.keys()) {
      if (!reachable.has(id)) diags.push({ rule: "reachability", severity: "error", message: `Node "${id}" is unreachable from start` });
    }

    // start has no incoming
    if (edges.some(e => e.to === startNodes[0].id)) {
      diags.push({ rule: "start_no_incoming", severity: "error", message: "Start node must not have incoming edges" });
    }
  }

  // exit has no outgoing
  if (exitNodes.length === 1 && edges.some(e => e.from === exitNodes[0].id)) {
    diags.push({ rule: "exit_no_outgoing", severity: "error", message: "Exit node must not have outgoing edges" });
  }

  // Edge targets exist
  for (const e of edges) {
    if (!nodes.has(e.to)) diags.push({ rule: "edge_target_exists", severity: "error", message: `Edge target "${e.to}" not declared` });
    if (!nodes.has(e.from)) diags.push({ rule: "edge_source_exists", severity: "error", message: `Edge source "${e.from}" not declared` });
  }

  // Condition syntax (basic: only allow key=value and key!=value with &&)
  for (const e of edges) {
    if (e.condition) {
      // valid tokens: word chars, dots, =, !=, &&, spaces, single-quoted strings
      const valid = /^[\w.'= !&\s]+$/.test(e.condition) && !/==|=>|<=/.test(e.condition);
      if (!valid) diags.push({ rule: "condition_syntax", severity: "error", message: `Invalid condition syntax: "${e.condition}"` });
    }
  }

  // type_known warning
  for (const node of nodes.values()) {
    const t = resolveHandlerType(node);
    if (!KNOWN_TYPES.has(t)) diags.push({ rule: "type_known", severity: "warning", message: `Unknown handler type "${t}" on node "${node.id}"` });
  }

  return diags;
}

export function validateOrRaise(graph: Graph): void {
  const diags = validateGraph(graph);
  const errors = diags.filter(d => d.severity === "error");
  if (errors.length > 0) {
    throw new Error("Pipeline validation failed:\n" + errors.map(e => `  [${e.rule}] ${e.message}`).join("\n"));
  }
}
```

- [x] **Step 4: Run validation tests**

```bash
cd /Users/josu/Documents/projects/ralph-cli && npm test -- src/attractor/tests/graph.test.ts
```
Expected: all passing

- [x] **Step 5: Commit**

```bash
git add src/attractor/core/graph.ts src/attractor/tests/graph.test.ts
git commit -m "feat(attractor): add validateGraph() and validateOrRaise()"
```

---

## Chunk 3: Conditions + Checkpoint

### Task 5: Condition expression evaluator

**Files:**
- Create: `src/attractor/core/conditions.ts`
- Create: `src/attractor/tests/conditions.test.ts`

- [x] **Step 1: Write failing condition tests**

```typescript
// src/attractor/tests/conditions.test.ts
import { describe, it, expect } from "vitest";
import { evaluateCondition } from "../core/conditions.js";
import type { Outcome } from "../types.js";

describe("evaluateCondition", () => {
  const ctx = { "context.scenarios.passed": "true", "context.count": "3" };
  const outcome: Outcome = { status: "success", preferredLabel: "Yes" };

  it("empty condition is always true", () => {
    expect(evaluateCondition("", outcome, ctx)).toBe(true);
  });

  it("outcome= matches outcome status", () => {
    expect(evaluateCondition("outcome=success", outcome, ctx)).toBe(true);
    expect(evaluateCondition("outcome=fail", outcome, ctx)).toBe(false);
  });

  it("outcome!= works", () => {
    expect(evaluateCondition("outcome!=fail", outcome, ctx)).toBe(true);
    expect(evaluateCondition("outcome!=success", outcome, ctx)).toBe(false);
  });

  it("preferred_label= matches", () => {
    expect(evaluateCondition("preferred_label=Yes", outcome, ctx)).toBe(true);
    expect(evaluateCondition("preferred_label=No", outcome, ctx)).toBe(false);
  });

  it("context.key= matches context value", () => {
    expect(evaluateCondition("context.scenarios.passed=true", outcome, ctx)).toBe(true);
    expect(evaluateCondition("context.scenarios.passed=false", outcome, ctx)).toBe(false);
  });

  it("missing context key resolves to empty string", () => {
    expect(evaluateCondition("context.missing=", outcome, ctx)).toBe(true);
    expect(evaluateCondition("context.missing=value", outcome, ctx)).toBe(false);
  });

  it("&& combines clauses with AND", () => {
    expect(evaluateCondition("outcome=success && preferred_label=Yes", outcome, ctx)).toBe(true);
    expect(evaluateCondition("outcome=success && preferred_label=No", outcome, ctx)).toBe(false);
  });
});
```

- [x] **Step 2: Run to confirm fail**

```bash
cd /Users/josu/Documents/projects/ralph-cli && npm test -- src/attractor/tests/conditions.test.ts 2>&1 | head -5
```

- [x] **Step 3: Implement `src/attractor/core/conditions.ts`**

```typescript
// src/attractor/core/conditions.ts
import type { Outcome } from "../types.js";

type ContextMap = Record<string, string>;

function resolveKey(key: string, outcome: Outcome, ctx: ContextMap): string {
  if (key === "outcome") return outcome.status;
  if (key === "preferred_label") return outcome.preferredLabel ?? "";
  if (key.startsWith("context.")) return ctx[key] ?? "";
  return "";
}

function evaluateClause(clause: string, outcome: Outcome, ctx: ContextMap): boolean {
  clause = clause.trim();
  const neq = clause.indexOf("!=");
  const eq  = clause.indexOf("=");

  if (neq !== -1) {
    const key = clause.slice(0, neq).trim();
    const val = clause.slice(neq + 2).trim().replace(/^'|'$/g, "");
    return resolveKey(key, outcome, ctx) !== val;
  } else if (eq !== -1) {
    const key = clause.slice(0, eq).trim();
    const val = clause.slice(eq + 1).trim().replace(/^'|'$/g, "");
    return resolveKey(key, outcome, ctx) === val;
  }
  return true;
}

export function evaluateCondition(condition: string, outcome: Outcome, ctx: ContextMap): boolean {
  if (!condition || condition.trim() === "") return true;
  const clauses = condition.split("&&");
  return clauses.every(c => evaluateClause(c, outcome, ctx));
}
```

- [x] **Step 4: Run condition tests**

```bash
cd /Users/josu/Documents/projects/ralph-cli && npm test -- src/attractor/tests/conditions.test.ts
```
Expected: all passing

- [x] **Step 5: Commit**

```bash
git add src/attractor/core/conditions.ts src/attractor/tests/conditions.test.ts
git commit -m "feat(attractor): edge condition expression evaluator"
```

---

### Task 6: Checkpoint save/load

**Files:**
- Create: `src/attractor/checkpoint.ts`
- Create: `src/attractor/tests/checkpoint.test.ts`

- [x] **Step 1: Write failing checkpoint tests**

```typescript
// src/attractor/tests/checkpoint.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { saveCheckpoint, loadCheckpoint } from "../checkpoint.js";
import type { CheckpointState } from "../types.js";

describe("checkpoint", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "ralph-test-")); });
  afterEach(() => { rmSync(dir, { recursive: true }); });

  const state: CheckpointState = {
    timestamp: "2026-04-08T12:00:00Z",
    currentNode: "implement",
    completedNodes: ["start", "meditate"],
    nodeRetries: { implement: 1 },
    context: { "meditate.sessionId": "abc123" },
  };

  it("saves and loads checkpoint", async () => {
    await saveCheckpoint(dir, state);
    const loaded = await loadCheckpoint(dir);
    expect(loaded).toMatchObject(state);
  });

  it("returns null when no checkpoint exists", async () => {
    const loaded = await loadCheckpoint(dir);
    expect(loaded).toBeNull();
  });

  it("overwrites existing checkpoint on save", async () => {
    await saveCheckpoint(dir, state);
    const updated = { ...state, currentNode: "scenarios" };
    await saveCheckpoint(dir, updated);
    const loaded = await loadCheckpoint(dir);
    expect(loaded?.currentNode).toBe("scenarios");
  });
});
```

- [x] **Step 2: Implement `src/attractor/checkpoint.ts`**

```typescript
// src/attractor/checkpoint.ts
import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import type { CheckpointState } from "./types.js";

const FILENAME = "checkpoint.json";

export async function saveCheckpoint(logsRoot: string, state: CheckpointState): Promise<void> {
  const path = join(logsRoot, FILENAME);
  await writeFile(path, JSON.stringify(state, null, 2), "utf8");
}

export async function loadCheckpoint(logsRoot: string): Promise<CheckpointState | null> {
  const path = join(logsRoot, FILENAME);
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as CheckpointState;
  } catch {
    return null;
  }
}
```

- [x] **Step 3: Run checkpoint tests**

```bash
cd /Users/josu/Documents/projects/ralph-cli && npm test -- src/attractor/tests/checkpoint.test.ts
```
Expected: all passing

- [x] **Step 4: Commit**

```bash
git add src/attractor/checkpoint.ts src/attractor/tests/checkpoint.test.ts
git commit -m "feat(attractor): checkpoint save/load"
```

---

## Chunk 4: Interviewer + Transforms

### Task 7: Interviewer interface and implementations

**Files:**
- Create: `src/attractor/interviewer/index.ts`
- Create: `src/attractor/interviewer/auto-approve.ts`
- Create: `src/attractor/interviewer/queue.ts`
- Create: `src/attractor/interviewer/console.ts`
- Create: `src/attractor/interviewer/callback.ts`
- Create: `src/attractor/tests/interviewer.test.ts`

- [x] **Step 1: Write interviewer tests**

```typescript
// src/attractor/tests/interviewer.test.ts
import { describe, it, expect, vi } from "vitest";
import { AutoApproveInterviewer } from "../interviewer/auto-approve.js";
import { QueueInterviewer } from "../interviewer/queue.js";
import { CallbackInterviewer } from "../interviewer/callback.js";
import type { Question, Answer } from "../interviewer/index.js";

describe("AutoApproveInterviewer", () => {
  it("always returns first option for MULTIPLE_CHOICE", async () => {
    const i = new AutoApproveInterviewer();
    const q: Question = { type: "MULTIPLE_CHOICE", prompt: "Pick one", options: ["Yes", "No", "Redo"] };
    const a = await i.ask(q);
    expect(a.value).toBe("Yes");
  });

  it("returns yes for YES_NO", async () => {
    const i = new AutoApproveInterviewer();
    const a = await i.ask({ type: "YES_NO", prompt: "Continue?" });
    expect(a.value).toBe("yes");
  });

  it("returns empty string for FREEFORM", async () => {
    const i = new AutoApproveInterviewer();
    const a = await i.ask({ type: "FREEFORM", prompt: "Comments?" });
    expect(a.value).toBe("");
  });

  it("returns confirmed=true for CONFIRMATION", async () => {
    const i = new AutoApproveInterviewer();
    const a = await i.ask({ type: "CONFIRMATION", prompt: "Proceed?" });
    expect(a.value).toBe("yes");
  });
});

describe("QueueInterviewer", () => {
  it("returns queued answers in order", async () => {
    const i = new QueueInterviewer(["Yes", "No"]);
    const a1 = await i.ask({ type: "YES_NO", prompt: "Q1" });
    const a2 = await i.ask({ type: "YES_NO", prompt: "Q2" });
    expect(a1.value).toBe("Yes");
    expect(a2.value).toBe("No");
  });

  it("throws when queue is empty", async () => {
    const i = new QueueInterviewer([]);
    await expect(i.ask({ type: "YES_NO", prompt: "Q" })).rejects.toThrow();
  });
});

describe("CallbackInterviewer", () => {
  it("delegates to callback", async () => {
    const cb = vi.fn(async (q: Question): Promise<Answer> => ({ value: "custom" }));
    const i = new CallbackInterviewer(cb);
    const a = await i.ask({ type: "FREEFORM", prompt: "Q" });
    expect(a.value).toBe("custom");
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ prompt: "Q" }));
  });
});
```

- [x] **Step 2: Implement interviewer files**

`src/attractor/interviewer/index.ts`:
```typescript
export type QuestionType = "YES_NO" | "MULTIPLE_CHOICE" | "FREEFORM" | "CONFIRMATION";

export interface Question {
  type: QuestionType;
  prompt: string;
  options?: string[];
}

export interface Answer {
  value: string;
}

export interface Interviewer {
  ask(question: Question): Promise<Answer>;
}
```

`src/attractor/interviewer/auto-approve.ts`:
```typescript
import type { Interviewer, Question, Answer } from "./index.js";

export class AutoApproveInterviewer implements Interviewer {
  async ask(q: Question): Promise<Answer> {
    if (q.type === "MULTIPLE_CHOICE") return { value: q.options?.[0] ?? "" };
    if (q.type === "YES_NO" || q.type === "CONFIRMATION") return { value: "yes" };
    return { value: "" };
  }
}
```

`src/attractor/interviewer/queue.ts`:
```typescript
import type { Interviewer, Question, Answer } from "./index.js";

export class QueueInterviewer implements Interviewer {
  private queue: string[];
  constructor(answers: string[]) { this.queue = [...answers]; }
  async ask(_q: Question): Promise<Answer> {
    if (this.queue.length === 0) throw new Error("QueueInterviewer: no more answers in queue");
    return { value: this.queue.shift()! };
  }
}
```

`src/attractor/interviewer/callback.ts`:
```typescript
import type { Interviewer, Question, Answer } from "./index.js";

export class CallbackInterviewer implements Interviewer {
  constructor(private fn: (q: Question) => Promise<Answer>) {}
  async ask(q: Question): Promise<Answer> { return this.fn(q); }
}
```

`src/attractor/interviewer/console.ts`:
```typescript
import { createInterface } from "readline";
import type { Interviewer, Question, Answer } from "./index.js";

export class ConsoleInterviewer implements Interviewer {
  async ask(q: Question): Promise<Answer> {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
      let prompt = q.prompt;
      if (q.type === "YES_NO") prompt += " [yes/no]: ";
      else if (q.type === "MULTIPLE_CHOICE" && q.options) {
        prompt += "\n" + q.options.map((o, i) => `  ${i + 1}. ${o}`).join("\n") + "\nChoice: ";
      } else if (q.type === "CONFIRMATION") prompt += " [yes/no]: ";
      else prompt += ": ";

      rl.question(prompt, (answer) => {
        rl.close();
        if (q.type === "MULTIPLE_CHOICE" && q.options) {
          const idx = parseInt(answer) - 1;
          resolve({ value: q.options[idx] ?? answer });
        } else {
          resolve({ value: answer.trim().toLowerCase() });
        }
      });
    });
  }
}
```

- [x] **Step 3: Run interviewer tests**

```bash
cd /Users/josu/Documents/projects/ralph-cli && npm test -- src/attractor/tests/interviewer.test.ts
```
Expected: all passing

- [x] **Step 4: Commit**

```bash
git add src/attractor/interviewer/
git commit -m "feat(attractor): Interviewer interface + AutoApprove, Queue, Callback, Console"
```

---

### Task 8: Transforms (variable expansion + preamble)

**Files:**
- Create: `src/attractor/transforms/variable-expansion.ts`
- Create: `src/attractor/transforms/preamble.ts`
- Create: `src/attractor/tests/transforms.test.ts`

- [x] **Step 1: Write transform tests**

```typescript
// src/attractor/tests/transforms.test.ts
import { describe, it, expect } from "vitest";
import { variableExpansionTransform } from "../transforms/variable-expansion.js";
import { buildPreamble } from "../transforms/preamble.js";
import type { Graph, CheckpointState } from "../types.js";

function makeGraph(overrides: Partial<Graph> = {}): Graph {
  return {
    name: "test",
    goal: "Ship it",
    nodes: new Map([
      ["start", { id: "start", shape: "Mdiamond" }],
      ["work",  { id: "work", shape: "box", prompt: "Do $goal in $project" }],
      ["done",  { id: "done", shape: "Msquare" }],
    ]),
    edges: [
      { from: "start", to: "work" },
      { from: "work", to: "done" },
    ],
    ...overrides,
  };
}

describe("variableExpansionTransform", () => {
  it("replaces $goal in node prompts", () => {
    const g = variableExpansionTransform(makeGraph(), { project: "/my/project" });
    expect(g.nodes.get("work")?.prompt).toBe("Do Ship it in /my/project");
  });

  it("replaces $goal in tool_command", () => {
    const g = makeGraph();
    g.nodes.get("work")!.toolCommand = "run $goal";
    const result = variableExpansionTransform(g, { project: "/proj" });
    expect(result.nodes.get("work")?.toolCommand).toBe("run Ship it");
  });

  it("does not mutate original graph", () => {
    const g = makeGraph();
    const original = g.nodes.get("work")?.prompt;
    variableExpansionTransform(g, { project: "/proj" });
    expect(g.nodes.get("work")?.prompt).toBe(original);
  });
});

describe("buildPreamble", () => {
  const checkpoint: CheckpointState = {
    timestamp: "2026-04-08T12:00:00Z",
    currentNode: "work",
    completedNodes: ["start", "meditate"],
    nodeRetries: {},
    context: { "meditate.sessionId": "abc", "meditate.illuminations": "3" },
  };

  it("returns non-empty string for compact fidelity", () => {
    const preamble = buildPreamble(checkpoint, "compact");
    expect(preamble).toContain("meditate");
    expect(preamble.length).toBeGreaterThan(0);
  });

  it("returns empty string for full fidelity", () => {
    const preamble = buildPreamble(checkpoint, "full");
    expect(preamble).toBe("");
  });
});
```

- [x] **Step 2: Implement transforms**

`src/attractor/transforms/variable-expansion.ts`:
```typescript
import type { Graph } from "../types.js";

export function variableExpansionTransform(graph: Graph, vars: { project?: string }): Graph {
  const goal = graph.goal ?? "";
  const project = vars.project ?? "";

  const newNodes = new Map(
    [...graph.nodes.entries()].map(([id, node]) => {
      const n = { ...node };
      if (n.prompt) n.prompt = n.prompt.replace(/\$goal/g, goal).replace(/\$project/g, project);
      if (n.toolCommand) n.toolCommand = n.toolCommand.replace(/\$goal/g, goal).replace(/\$project/g, project);
      return [id, n];
    })
  );
  return { ...graph, nodes: newNodes };
}
```

`src/attractor/transforms/preamble.ts`:
```typescript
import type { CheckpointState } from "../types.js";

export function buildPreamble(checkpoint: CheckpointState, fidelity: string): string {
  if (fidelity === "full") return "";

  const lines: string[] = [
    "## Pipeline Context (auto-generated)",
    `Completed stages: ${checkpoint.completedNodes.join(", ") || "(none)"}`,
  ];

  if (Object.keys(checkpoint.context).length > 0) {
    lines.push("Key context values:");
    for (const [k, v] of Object.entries(checkpoint.context)) {
      lines.push(`  ${k}: ${v}`);
    }
  }

  return lines.join("\n") + "\n\n";
}
```

- [x] **Step 3: Run transform tests**

```bash
cd /Users/josu/Documents/projects/ralph-cli && npm test -- src/attractor/tests/transforms.test.ts
```
Expected: all passing

- [x] **Step 4: Commit**

```bash
git add src/attractor/transforms/ src/attractor/tests/transforms.test.ts
git commit -m "feat(attractor): variable expansion and preamble transforms"
```

---

## Chunk 5: Handlers

### Task 9: Handler registry and base handlers

**Files:**
- Create: `src/attractor/handlers/registry.ts`
- Create: `src/attractor/handlers/conditional.ts`
- Create: `src/attractor/handlers/wait-human.ts`
- Create: `src/attractor/handlers/tool.ts`
- Create: `src/attractor/tests/handlers.test.ts`

- [x] **Step 1: Write failing handler tests**

```typescript
// src/attractor/tests/handlers.test.ts
import { describe, it, expect, vi } from "vitest";
import { registerBuiltinHandlers, lookupHandler } from "../handlers/registry.js";
import { ConditionalHandler } from "../handlers/conditional.js";
import { WaitHumanHandler } from "../handlers/wait-human.js";
import { ToolHandler } from "../handlers/tool.js";
import { AutoApproveInterviewer } from "../interviewer/auto-approve.js";
import { QueueInterviewer } from "../interviewer/queue.js";
import type { Node, PipelineContext } from "../types.js";

const baseCtx = (): PipelineContext => ({ values: {} });

describe("registry", () => {
  it("lookupHandler returns handler for known type", () => {
    registerBuiltinHandlers();
    const h = lookupHandler("conditional");
    expect(h).toBeDefined();
  });

  it("lookupHandler returns null for unknown type", () => {
    const h = lookupHandler("does.not.exist");
    expect(h).toBeNull();
  });
});

describe("ConditionalHandler", () => {
  it("returns success immediately", async () => {
    const h = new ConditionalHandler();
    const node: Node = { id: "c", shape: "diamond" };
    const outcome = await h.execute(node, baseCtx(), {});
    expect(outcome.status).toBe("success");
  });
});

describe("WaitHumanHandler", () => {
  it("presents outgoing edge labels and returns preferredLabel", async () => {
    const interviewer = new QueueInterviewer(["Yes"]);
    const h = new WaitHumanHandler(interviewer);
    const node: Node = { id: "gate", shape: "hexagon", label: "Accept?" };
    const outcome = await h.execute(node, baseCtx(), { outgoingLabels: ["Yes", "No"] });
    expect(outcome.status).toBe("success");
    expect(outcome.preferredLabel).toBe("Yes");
  });

  it("auto-approves with AutoApproveInterviewer", async () => {
    const h = new WaitHumanHandler(new AutoApproveInterviewer());
    const node: Node = { id: "gate", shape: "hexagon" };
    const outcome = await h.execute(node, baseCtx(), { outgoingLabels: ["Approve", "Reject"] });
    expect(outcome.preferredLabel).toBe("Approve");
  });
});

describe("ToolHandler", () => {
  it("returns success when command exits 0", async () => {
    const h = new ToolHandler();
    const node: Node = { id: "t", shape: "parallelogram", toolCommand: "echo hello" };
    const outcome = await h.execute(node, baseCtx(), {});
    expect(outcome.status).toBe("success");
    expect(outcome.contextUpdates?.["tool.output"]).toContain("hello");
  });

  it("returns fail when command exits non-zero", async () => {
    const h = new ToolHandler();
    const node: Node = { id: "t", shape: "parallelogram", toolCommand: "exit 1" };
    const outcome = await h.execute(node, baseCtx(), {});
    expect(outcome.status).toBe("fail");
  });

  it("returns fail when no toolCommand", async () => {
    const h = new ToolHandler();
    const node: Node = { id: "t", shape: "parallelogram" };
    const outcome = await h.execute(node, baseCtx(), {});
    expect(outcome.status).toBe("fail");
    expect(outcome.failureReason).toContain("tool_command");
  });
});
```

- [x] **Step 2: Implement handler registry**

`src/attractor/handlers/registry.ts`:
```typescript
import type { Node, Outcome, PipelineContext } from "../types.js";

export interface NodeHandler {
  execute(node: Node, ctx: PipelineContext, meta: Record<string, unknown>): Promise<Outcome>;
}

const handlers = new Map<string, NodeHandler>();

export function registerHandler(type: string, handler: NodeHandler): void {
  handlers.set(type, handler);
}

export function lookupHandler(type: string): NodeHandler | null {
  return handlers.get(type) ?? null;
}

export function registerBuiltinHandlers(): void {
  // Imported lazily to avoid circular deps — populated by engine.ts at startup
}
```

`src/attractor/handlers/conditional.ts`:
```typescript
import type { NodeHandler } from "./registry.js";
import type { Node, Outcome, PipelineContext } from "../types.js";

export class ConditionalHandler implements NodeHandler {
  async execute(_node: Node, _ctx: PipelineContext, _meta: Record<string, unknown>): Promise<Outcome> {
    return { status: "success" };
  }
}
```

`src/attractor/handlers/wait-human.ts`:
```typescript
import type { NodeHandler } from "./registry.js";
import type { Node, Outcome, PipelineContext } from "../types.js";
import type { Interviewer } from "../interviewer/index.js";

export class WaitHumanHandler implements NodeHandler {
  constructor(private interviewer: Interviewer) {}

  async execute(node: Node, _ctx: PipelineContext, meta: Record<string, unknown>): Promise<Outcome> {
    const labels = (meta["outgoingLabels"] as string[]) ?? [];
    const answer = await this.interviewer.ask({
      type: "MULTIPLE_CHOICE",
      prompt: node.label ?? node.id,
      options: labels.length > 0 ? labels : ["continue"],
    });
    return { status: "success", preferredLabel: answer.value };
  }
}
```

`src/attractor/handlers/tool.ts`:
```typescript
import { spawnSync } from "child_process";
import type { NodeHandler } from "./registry.js";
import type { Node, Outcome, PipelineContext } from "../types.js";

export class ToolHandler implements NodeHandler {
  async execute(node: Node, _ctx: PipelineContext, _meta: Record<string, unknown>): Promise<Outcome> {
    if (!node.toolCommand) {
      return { status: "fail", failureReason: "No tool_command specified on node" };
    }
    const result = spawnSync("sh", ["-c", node.toolCommand], { encoding: "utf8" });
    const stdout = result.stdout ?? "";
    if (result.status !== 0) {
      return {
        status: "fail",
        failureReason: `Command exited with code ${result.status}: ${result.stderr ?? ""}`,
        contextUpdates: { "tool.output": stdout },
      };
    }
    return { status: "success", contextUpdates: { "tool.output": stdout } };
  }
}
```

- [x] **Step 3: Run handler tests**

```bash
cd /Users/josu/Documents/projects/ralph-cli && npm test -- src/attractor/tests/handlers.test.ts
```
Expected: all passing

- [x] **Step 4: Commit**

```bash
git add src/attractor/handlers/ src/attractor/tests/handlers.test.ts
git commit -m "feat(attractor): handler registry, conditional, wait-human, tool handlers"
```

---

### Task 10: Codergen and ralph-native handlers

**Files:**
- Create: `src/attractor/handlers/codergen.ts`
- Create: `src/attractor/handlers/ralph-implement.ts`
- Create: `src/attractor/handlers/ralph-meditate.ts`
- Create: `src/attractor/handlers/ralph-scenarios.ts`
- Create: `src/attractor/handlers/start-exit.ts`
- Modify: `src/attractor/tests/handlers.test.ts`

- [x] **Step 1: Write failing codergen + ralph handler tests**

Append to `src/attractor/tests/handlers.test.ts`:

```typescript
import { CodergenHandler } from "../handlers/codergen.js";
import { StartHandler, ExitHandler } from "../handlers/start-exit.js";

describe("StartHandler / ExitHandler", () => {
  it("start returns success immediately", async () => {
    const h = new StartHandler();
    const outcome = await h.execute({ id: "start" }, baseCtx(), {});
    expect(outcome.status).toBe("success");
  });

  it("exit returns success immediately", async () => {
    const h = new ExitHandler();
    const outcome = await h.execute({ id: "done" }, baseCtx(), {});
    expect(outcome.status).toBe("success");
  });
});

describe("CodergenHandler", () => {
  it("returns fail if runLoop throws", async () => {
    const fakeRunLoop = vi.fn().mockRejectedValue(new Error("claude not found"));
    const h = new CodergenHandler(fakeRunLoop);
    const node = { id: "work", shape: "box", prompt: "Do the work" };
    const outcome = await h.execute(node, baseCtx(), { logsRoot: "/tmp", cwd: "/proj" });
    expect(outcome.status).toBe("fail");
    expect(outcome.failureReason).toContain("claude not found");
  });

  it("returns success when runLoop returns success=true", async () => {
    const fakeRunLoop = vi.fn().mockResolvedValue({
      success: true, iterations: 1, exitReason: "completed", sessionId: "s1"
    });
    const h = new CodergenHandler(fakeRunLoop);
    const node = { id: "work", shape: "box", prompt: "Do the work" };
    const outcome = await h.execute(node, baseCtx(), { logsRoot: "/tmp", cwd: "/proj" });
    expect(outcome.status).toBe("success");
    expect(outcome.contextUpdates?.["implement.sessionId"]).toBe("s1");
  });
});
```

- [x] **Step 2: Implement start-exit handler**

`src/attractor/handlers/start-exit.ts`:
```typescript
import type { NodeHandler } from "./registry.js";
import type { Node, Outcome, PipelineContext } from "../types.js";

export class StartHandler implements NodeHandler {
  async execute(_node: Node, _ctx: PipelineContext, _meta: Record<string, unknown>): Promise<Outcome> {
    return { status: "success" };
  }
}

export class ExitHandler implements NodeHandler {
  async execute(_node: Node, _ctx: PipelineContext, _meta: Record<string, unknown>): Promise<Outcome> {
    return { status: "success" };
  }
}
```

- [x] **Step 3: Implement codergen handler**

`src/attractor/handlers/codergen.ts`:
```typescript
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import type { NodeHandler } from "./registry.js";
import type { Node, Outcome, PipelineContext } from "../types.js";
import type { LoopOptions, LoopResult } from "../../cli/lib/loop.js";

type RunLoopFn = (opts: LoopOptions) => Promise<LoopResult>;

export class CodergenHandler implements NodeHandler {
  constructor(private runLoop: RunLoopFn) {}

  async execute(node: Node, _ctx: PipelineContext, meta: Record<string, unknown>): Promise<Outcome> {
    const logsRoot = meta["logsRoot"] as string;
    const cwd = meta["cwd"] as string;
    const signal = meta["signal"] as AbortSignal | undefined;

    const nodeDir = join(logsRoot, node.id);
    await mkdir(nodeDir, { recursive: true });

    const prompt = (node.prompt ?? node.label ?? "");
    const promptFile = join(nodeDir, "prompt.md");
    await writeFile(promptFile, prompt, "utf8");

    let result: LoopResult;
    try {
      result = await this.runLoop({
        promptFile,
        cwd,
        model: (node.llmModel as string | undefined) ?? "opus",
        signal,
      });
    } catch (err) {
      return { status: "fail", failureReason: (err as Error).message };
    }

    const contextUpdates: Record<string, string> = {
      "implement.iterations": String(result.iterations),
      "implement.success": String(result.success),
    };
    if (result.sessionId) contextUpdates["implement.sessionId"] = result.sessionId;

    return {
      status: result.success ? "success" : "fail",
      contextUpdates,
      failureReason: result.success ? undefined : (result.errorMessage ?? result.exitReason),
    };
  }
}
```

- [x] **Step 4: Implement ralph-native handlers**

`src/attractor/handlers/ralph-implement.ts`:
```typescript
// Re-exports CodergenHandler with same interface — ralph.implement is the circle shape variant
export { CodergenHandler as RalphImplementHandler } from "./codergen.js";
```

`src/attractor/handlers/ralph-meditate.ts`:
```typescript
import type { NodeHandler } from "./registry.js";
import type { Node, Outcome, PipelineContext } from "../types.js";

// v1: meditate via subprocess (ralph meditate <cwd>)
import { spawnSync } from "child_process";
import { join } from "path";

export class RalphMeditateHandler implements NodeHandler {
  async execute(node: Node, _ctx: PipelineContext, meta: Record<string, unknown>): Promise<Outcome> {
    const cwd = meta["cwd"] as string;
    const result = spawnSync(process.execPath, [process.argv[1], cwd, "meditate"], {
      encoding: "utf8",
      stdio: "inherit",
    });
    if (result.status !== 0) {
      return { status: "fail", failureReason: "ralph meditate exited non-zero" };
    }
    return { status: "success" };
  }
}
```

`src/attractor/handlers/ralph-scenarios.ts`:
```typescript
import type { NodeHandler } from "./registry.js";
import type { Node, Outcome, PipelineContext } from "../types.js";
import { spawnSync } from "child_process";

export class RalphScenariosHandler implements NodeHandler {
  async execute(node: Node, _ctx: PipelineContext, meta: Record<string, unknown>): Promise<Outcome> {
    const cwd = meta["cwd"] as string;
    const result = spawnSync(process.execPath, [process.argv[1], cwd, "run-scenarios"], {
      encoding: "utf8",
      stdio: "inherit",
    });
    const passed = result.status === 0;
    return {
      status: passed ? "success" : "fail",
      contextUpdates: { "scenarios.passed": String(passed) },
    };
  }
}
```

- [x] **Step 5: Wire all handlers into registry**

Update `src/attractor/handlers/registry.ts` — replace the empty `registerBuiltinHandlers` body:

```typescript
export function registerBuiltinHandlers(deps: { runLoop: (opts: LoopOptions) => Promise<LoopResult>; interviewer: Interviewer }): void {
  const { ConditionalHandler }    = await import("./conditional.js");
  const { WaitHumanHandler }      = await import("./wait-human.js");
  const { ToolHandler }           = await import("./tool.js");
  const { CodergenHandler }       = await import("./codergen.js");
  const { StartHandler, ExitHandler } = await import("./start-exit.js");
  const { RalphMeditateHandler }  = await import("./ralph-meditate.js");
  const { RalphScenariosHandler } = await import("./ralph-scenarios.js");

  registerHandler("start",              new StartHandler());
  registerHandler("exit",               new ExitHandler());
  registerHandler("codergen",           new CodergenHandler(deps.runLoop));
  registerHandler("conditional",        new ConditionalHandler());
  registerHandler("wait.human",         new WaitHumanHandler(deps.interviewer));
  registerHandler("tool",               new ToolHandler());
  registerHandler("ralph.implement",    new CodergenHandler(deps.runLoop));
  registerHandler("ralph.meditate",     new RalphMeditateHandler());
  registerHandler("ralph.run-scenarios", new RalphScenariosHandler());
}
```

Note: `registerBuiltinHandlers` must be synchronous or async-friendly. Since dynamic imports are async, change signature to `async`:

```typescript
import type { LoopOptions, LoopResult } from "../../cli/lib/loop.js";
import type { Interviewer } from "../interviewer/index.js";

export async function registerBuiltinHandlers(deps: {
  runLoop: (opts: LoopOptions) => Promise<LoopResult>;
  interviewer: Interviewer;
}): Promise<void> { ... }
```

- [x] **Step 6: Run handler tests**

```bash
cd /Users/josu/Documents/projects/ralph-cli && npm test -- src/attractor/tests/handlers.test.ts
```
Expected: all passing

- [x] **Step 7: Commit**

```bash
git add src/attractor/handlers/ src/attractor/tests/handlers.test.ts
git commit -m "feat(attractor): codergen, start/exit, ralph-native handlers; wire registry"
```

---

### Task 10b: Parallel, fan-in, and manager-loop handlers

**Files:**
- Create: `src/attractor/handlers/parallel.ts`
- Create: `src/attractor/handlers/manager-loop.ts`
- Modify: `src/attractor/tests/handlers.test.ts`
- Modify: `src/attractor/handlers/registry.ts`

> **Scope note:** `parallel` and `parallel.fan_in` are implemented with `Promise.all` for v1 concurrent branch execution. `stack.manager_loop` is implemented as a polling loop over a child `ralph implement` run — per spec §5.10, full cross-pipeline DOT file supervision is deferred to v2.

- [x] **Step 1: Write failing tests for parallel and manager-loop handlers**

Append to `src/attractor/tests/handlers.test.ts`:

```typescript
import { ParallelHandler } from "../handlers/parallel.js";
import { FanInHandler } from "../handlers/parallel.js";
import { ManagerLoopHandler } from "../handlers/manager-loop.js";

describe("ParallelHandler", () => {
  it("returns success and stores parallel.results in contextUpdates", async () => {
    const h = new ParallelHandler();
    const node: Node = { id: "fan", shape: "component" };
    // meta carries branch outcomes (engine pre-computes them)
    const outcome = await h.execute(node, baseCtx(), {
      branchOutcomes: { branch_a: { status: "success" }, branch_b: { status: "success" } },
    });
    expect(outcome.status).toBe("success");
    expect(outcome.contextUpdates?.["parallel.results"]).toBeDefined();
  });
});

describe("FanInHandler", () => {
  it("aggregates all-success to success", async () => {
    const h = new FanInHandler();
    const ctx = { values: { "parallel.results": JSON.stringify([{ status: "success" }, { status: "success" }]) } };
    const outcome = await h.execute({ id: "join", shape: "tripleoctagon" }, ctx, {});
    expect(outcome.status).toBe("success");
  });

  it("aggregates mixed to partial_success", async () => {
    const h = new FanInHandler();
    const ctx = { values: { "parallel.results": JSON.stringify([{ status: "success" }, { status: "fail" }]) } };
    const outcome = await h.execute({ id: "join", shape: "tripleoctagon" }, ctx, {});
    expect(outcome.status).toBe("partial_success");
  });

  it("aggregates all-fail to fail", async () => {
    const h = new FanInHandler();
    const ctx = { values: { "parallel.results": JSON.stringify([{ status: "fail" }, { status: "fail" }]) } };
    const outcome = await h.execute({ id: "join", shape: "tripleoctagon" }, ctx, {});
    expect(outcome.status).toBe("fail");
  });
});

describe("ManagerLoopHandler", () => {
  it("returns success when child completes (status=success)", async () => {
    const fakeChild = vi.fn()
      .mockResolvedValueOnce({ status: "running", currentNode: "work" })
      .mockResolvedValueOnce({ status: "success" });
    const h = new ManagerLoopHandler(fakeChild, { pollIntervalMs: 0, maxCycles: 10 });
    const node: Node = { id: "mgr", shape: "house" };
    const outcome = await h.execute(node, baseCtx(), {});
    expect(outcome.status).toBe("success");
  });

  it("returns fail when max_cycles exceeded", async () => {
    const fakeChild = vi.fn().mockResolvedValue({ status: "running", currentNode: "work" });
    const h = new ManagerLoopHandler(fakeChild, { pollIntervalMs: 0, maxCycles: 3 });
    const node: Node = { id: "mgr", shape: "house" };
    const outcome = await h.execute(node, baseCtx(), {});
    expect(outcome.status).toBe("fail");
    expect(fakeChild).toHaveBeenCalledTimes(3);
  });
});
```

- [x] **Step 2: Implement `src/attractor/handlers/parallel.ts`**

```typescript
// src/attractor/handlers/parallel.ts
import type { NodeHandler } from "./registry.js";
import type { Node, Outcome, PipelineContext } from "../types.js";

export class ParallelHandler implements NodeHandler {
  async execute(_node: Node, _ctx: PipelineContext, meta: Record<string, unknown>): Promise<Outcome> {
    const branchOutcomes = (meta["branchOutcomes"] as Record<string, Outcome>) ?? {};
    return {
      status: "success",
      contextUpdates: { "parallel.results": JSON.stringify(Object.values(branchOutcomes)) },
    };
  }
}

export class FanInHandler implements NodeHandler {
  async execute(_node: Node, ctx: PipelineContext, _meta: Record<string, unknown>): Promise<Outcome> {
    const raw = ctx.values["parallel.results"];
    const results: Outcome[] = raw ? JSON.parse(raw) : [];
    const allSucceeded = results.every(r => r.status === "success");
    const anySucceeded = results.some(r => r.status === "success");
    const status = allSucceeded ? "success" : anySucceeded ? "partial_success" : "fail";
    return { status };
  }
}
```

- [x] **Step 3: Implement `src/attractor/handlers/manager-loop.ts`**

```typescript
// src/attractor/handlers/manager-loop.ts
import type { NodeHandler } from "./registry.js";
import type { Node, Outcome, PipelineContext } from "../types.js";

export interface ChildStatus {
  status: "running" | "success" | "fail";
  currentNode?: string;
}

type PollFn = () => Promise<ChildStatus>;

export interface ManagerLoopConfig {
  pollIntervalMs?: number;
  maxCycles?: number;
}

export class ManagerLoopHandler implements NodeHandler {
  constructor(
    private pollChild: PollFn,
    private config: ManagerLoopConfig = {}
  ) {}

  async execute(node: Node, _ctx: PipelineContext, _meta: Record<string, unknown>): Promise<Outcome> {
    const maxCycles = this.config.maxCycles ?? 1000;
    const pollMs = this.config.pollIntervalMs ?? 45_000;

    for (let cycle = 0; cycle < maxCycles; cycle++) {
      const child = await this.pollChild();
      if (child.status === "success") {
        return {
          status: "success",
          contextUpdates: { "stack.child.status": "success", "stack.child.outcome": "success" },
        };
      }
      if (child.status === "fail") {
        return {
          status: "fail",
          failureReason: "Child pipeline failed",
          contextUpdates: { "stack.child.status": "fail", "stack.child.outcome": "fail" },
        };
      }
      if (pollMs > 0) await new Promise(r => setTimeout(r, pollMs));
    }
    return { status: "fail", failureReason: `manager_loop exceeded max_cycles (${maxCycles})` };
  }
}
```

- [x] **Step 4: Register parallel, fan-in, and manager-loop in registry**

In `src/attractor/handlers/registry.ts`, add to `registerBuiltinHandlers`:

```typescript
import { ParallelHandler, FanInHandler } from "./parallel.js";
import { ManagerLoopHandler } from "./manager-loop.js";

// Add inside registerBuiltinHandlers():
registerHandler("parallel",          new ParallelHandler());
registerHandler("parallel.fan_in",   new FanInHandler());
// manager_loop requires a pollChild function wired at runtime by the engine — not registered here.
// The engine creates ManagerLoopHandler with a real pollChild when executing a house node.
// Registering a stub would silently pass all manager_loop nodes in production.
```

- [x] **Step 5: Run handler tests**

```bash
cd /Users/josu/Documents/projects/ralph-cli && npm test -- src/attractor/tests/handlers.test.ts
```
Expected: all passing

- [x] **Step 6: Update engine.ts to wire ManagerLoopHandler with a real pollChild**

In `src/attractor/core/engine.ts`, in `buildHandlerMap`, add after the other handler registrations:

```typescript
import { ManagerLoopHandler } from "../handlers/manager-loop.js";
import { ParallelHandler, FanInHandler } from "../handlers/parallel.js";

// In buildHandlerMap():
m.set("parallel",          new ParallelHandler());
m.set("parallel.fan_in",   new FanInHandler());
// manager_loop: pollChild polls the child pipeline state from logsRoot
m.set("stack.manager_loop", new ManagerLoopHandler(async () => {
  // v1: child is ralph.implement running in same process — status derived from checkpoint
  const cp = await import("../checkpoint.js").then(m => m.loadCheckpoint(opts.logsRoot));
  if (!cp) return { status: "running" };
  const exitNode = [...graph.nodes.values()].find(n => n.shape === "Msquare" || n.id === "exit" || n.id === "end");
  if (exitNode && cp.completedNodes.includes(exitNode.id)) return { status: "success" };
  return { status: "running", currentNode: cp.currentNode };
}));
```

- [x] **Step 7: Commit**

```bash
git add src/attractor/handlers/parallel.ts src/attractor/handlers/manager-loop.ts src/attractor/tests/handlers.test.ts src/attractor/handlers/registry.ts src/attractor/core/engine.ts
git commit -m "feat(attractor): parallel, fan-in, manager-loop handlers; wire into engine"
```

---

## Chunk 6: Execution Engine

### Task 11: Engine — traversal, edge selection, retry, goal gate

**Files:**
- Create: `src/attractor/core/engine.ts`
- Create: `src/attractor/tests/engine.test.ts`

- [x] **Step 1: Write failing engine tests**

```typescript
// src/attractor/tests/engine.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { runPipeline, type EngineOptions } from "../core/engine.js";
import { parseDot } from "../core/graph.js";
import { AutoApproveInterviewer } from "../interviewer/auto-approve.js";
import { QueueInterviewer } from "../interviewer/queue.js";
import type { LoopResult } from "../../cli/lib/loop.js";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const fakeRunLoop = vi.fn(async (): Promise<LoopResult> => ({
  success: true, iterations: 1, exitReason: "completed", sessionId: "s1",
}));

function makeOpts(logsRoot: string, overrides: Partial<EngineOptions> = {}): EngineOptions {
  return {
    logsRoot,
    cwd: "/proj",
    runLoop: fakeRunLoop,
    interviewer: new AutoApproveInterviewer(),
    ...overrides,
  };
}

describe("runPipeline", () => {
  let dir: string;
  beforeEach(() => {
    vi.clearAllMocks();
    dir = mkdtempSync(join(tmpdir(), "ralph-engine-test-"));
  });
  afterEach(() => { rmSync(dir, { recursive: true }); });

  it("runs a minimal pipeline to completion", async () => {
    const dot = `digraph g {
      start [shape=Mdiamond]
      done  [shape=Msquare]
      start -> done
    }`;
    const result = await runPipeline(parseDot(dot), makeOpts(dir));
    expect(result.status).toBe("success");
    expect(result.completedNodes).toContain("start");
    expect(result.completedNodes).toContain("done");
  });

  it("executes a codergen node via runLoop", async () => {
    const dot = `digraph g {
      start [shape=Mdiamond]
      work  [shape=box, prompt="Do the work"]
      done  [shape=Msquare]
      start -> work -> done
    }`;
    await runPipeline(parseDot(dot), makeOpts(dir));
    expect(fakeRunLoop).toHaveBeenCalledTimes(1);
  });

  it("selects edge by condition match", async () => {
    const dot = `digraph g {
      start [shape=Mdiamond]
      work  [shape=box]
      done  [shape=Msquare]
      start -> work -> done [condition="outcome=success"]
    }`;
    const result = await runPipeline(parseDot(dot), makeOpts(dir));
    expect(result.status).toBe("success");
  });

  it("retries node up to maxRetries then fails pipeline", async () => {
    fakeRunLoop.mockResolvedValue({ success: false, iterations: 1, exitReason: "error", errorMessage: "boom" });
    const dot = `digraph g {
      start [shape=Mdiamond]
      work  [shape=box, max_retries=2]
      done  [shape=Msquare]
      start -> work -> done
    }`;
    const result = await runPipeline(parseDot(dot), makeOpts(dir));
    expect(result.status).toBe("fail");
    expect(fakeRunLoop).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });

  it("waits at human gate and routes by label", async () => {
    const interviewer = new QueueInterviewer(["Yes"]);
    const dot = `digraph g {
      start  [shape=Mdiamond]
      gate   [shape=hexagon, label="Proceed?"]
      impl   [shape=box]
      done   [shape=Msquare]
      start -> gate
      gate  -> impl [label="Yes"]
      gate  -> done [label="No"]
      impl  -> done
    }`;
    const result = await runPipeline(parseDot(dot), makeOpts(dir, { interviewer }));
    expect(result.completedNodes).toContain("impl");
  });

  it("resumes from checkpoint", async () => {
    const dot = `digraph g {
      start [shape=Mdiamond]
      work  [shape=box]
      done  [shape=Msquare]
      start -> work -> done
    }`;
    const checkpoint = {
      timestamp: new Date().toISOString(),
      currentNode: "work",
      completedNodes: ["start"],
      nodeRetries: {},
      context: {},
    };
    const { writeFile } = await import("fs/promises");
    await writeFile(join(dir, "checkpoint.json"), JSON.stringify(checkpoint), "utf8");
    const result = await runPipeline(parseDot(dot), makeOpts(dir, { resume: true }));
    expect(result.status).toBe("success");
    // start was already complete, should not re-run
    expect(fakeRunLoop).toHaveBeenCalledTimes(1); // only "work"
  });
});
```

- [x] **Step 2: Implement `src/attractor/core/engine.ts`**

```typescript
// src/attractor/core/engine.ts
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import type { Graph, Node, Edge, Outcome, PipelineContext } from "../types.js";
import type { Interviewer } from "../interviewer/index.js";
import type { LoopOptions, LoopResult } from "../../cli/lib/loop.js";
import { evaluateCondition } from "./conditions.js";
import { resolveHandlerType } from "./graph.js";
import { saveCheckpoint, loadCheckpoint } from "../checkpoint.js";
import { ConditionalHandler } from "../handlers/conditional.js";
import { StartHandler, ExitHandler } from "../handlers/start-exit.js";
import { WaitHumanHandler } from "../handlers/wait-human.js";
import { ToolHandler } from "../handlers/tool.js";
import { CodergenHandler } from "../handlers/codergen.js";
import { RalphMeditateHandler } from "../handlers/ralph-meditate.js";
import { RalphScenariosHandler } from "../handlers/ralph-scenarios.js";
import type { NodeHandler } from "../handlers/registry.js";

export interface EngineOptions {
  logsRoot: string;
  cwd: string;
  runLoop: (opts: LoopOptions) => Promise<LoopResult>;
  interviewer: Interviewer;
  signal?: AbortSignal;
  project?: string;
  resume?: boolean;
}

export interface PipelineResult {
  status: "success" | "fail";
  completedNodes: string[];
  context: Record<string, string>;
  failureReason?: string;
}

function buildHandlerMap(opts: EngineOptions): Map<string, NodeHandler> {
  const m = new Map<string, NodeHandler>();
  const cg = new CodergenHandler(opts.runLoop);
  m.set("start", new StartHandler());
  m.set("exit", new ExitHandler());
  m.set("codergen", cg);
  m.set("conditional", new ConditionalHandler());
  m.set("wait.human", new WaitHumanHandler(opts.interviewer));
  m.set("tool", new ToolHandler());
  m.set("ralph.implement", cg);
  m.set("ralph.meditate", new RalphMeditateHandler());
  m.set("ralph.run-scenarios", new RalphScenariosHandler());
  return m;
}

function selectNextEdge(
  node: Node,
  outcome: Outcome,
  ctx: Record<string, string>,
  edges: Edge[]
): Edge | null {
  const outgoing = edges.filter(e => e.from === node.id);
  if (outgoing.length === 0) return null;

  // Step 1: condition-matching edges
  const condMatch = outgoing.filter(e => e.condition && evaluateCondition(e.condition, outcome, ctx));
  if (condMatch.length > 0) return condMatch[0];

  // Step 2: preferred_label match (normalize: lowercase, trim)
  const normalize = (s: string) => s.toLowerCase().trim().replace(/^\[.\]\s+|^.\)\s+|^.-\s+/, "");
  if (outcome.preferredLabel) {
    const label = normalize(outcome.preferredLabel);
    const labelMatch = outgoing.find(e => !e.condition && e.label && normalize(e.label) === label);
    if (labelMatch) return labelMatch;
  }

  // Step 3: suggested next IDs
  if (outcome.suggestedNextIds?.length) {
    const suggested = outgoing.find(e => !e.condition && outcome.suggestedNextIds!.includes(e.to));
    if (suggested) return suggested;
  }

  // Step 4: highest weight among unconditional
  const unconditional = outgoing.filter(e => !e.condition);
  if (unconditional.length === 0) return null;
  unconditional.sort((a, b) => {
    const wa = a.weight ?? 0;
    const wb = b.weight ?? 0;
    if (wb !== wa) return wb - wa;
    return a.to.localeCompare(b.to); // lexical tiebreak
  });
  return unconditional[0];
}

export async function runPipeline(graph: Graph, opts: EngineOptions): Promise<PipelineResult> {
  const handlers = buildHandlerMap(opts);
  const { nodes, edges } = graph;

  // Find start node
  const startNode = [...nodes.values()].find(n => n.shape === "Mdiamond" || n.id === "start" || n.id === "Start");
  if (!startNode) return { status: "fail", completedNodes: [], context: {}, failureReason: "No start node" };

  let currentNodeId = startNode.id;
  let completedNodes: string[] = [];
  let context: Record<string, string> = { "$goal": graph.goal ?? "" };
  if (opts.project) context["$project"] = opts.project;
  let nodeRetries: Record<string, number> = {};

  // Resume from checkpoint if requested
  if (opts.resume) {
    const cp = await loadCheckpoint(opts.logsRoot);
    if (cp) {
      currentNodeId = cp.currentNode;
      completedNodes = cp.completedNodes;
      context = { ...context, ...cp.context };
      nodeRetries = cp.nodeRetries;
    }
  }

  await mkdir(opts.logsRoot, { recursive: true });

  const isExitNode = (n: Node) => n.shape === "Msquare" || n.id === "exit" || n.id === "end";

  while (true) {
    if (opts.signal?.aborted) {
      return { status: "fail", completedNodes, context, failureReason: "Aborted" };
    }

    const node = nodes.get(currentNodeId);
    if (!node) {
      return { status: "fail", completedNodes, context, failureReason: `Node not found: ${currentNodeId}` };
    }

    if (isExitNode(node)) {
      completedNodes = [...completedNodes, node.id];
      await saveCheckpoint(opts.logsRoot, {
        timestamp: new Date().toISOString(),
        currentNode: node.id,
        completedNodes,
        nodeRetries,
        context,
      });
      return { status: "success", completedNodes, context };
    }

    const handlerType = resolveHandlerType(node);
    const handler = handlers.get(handlerType);
    if (!handler) {
      return { status: "fail", completedNodes, context, failureReason: `No handler for type "${handlerType}"` };
    }

    // Gather outgoing labels for wait.human
    const outgoingLabels = edges.filter(e => e.from === node.id).map(e => e.label ?? e.to).filter(Boolean);

    const ctx: PipelineContext = { values: context };
    const outcome = await handler.execute(node, ctx, {
      logsRoot: opts.logsRoot,
      cwd: opts.cwd,
      signal: opts.signal,
      outgoingLabels,
    });

    // Merge context updates
    if (outcome.contextUpdates) {
      context = { ...context, ...outcome.contextUpdates };
    }

    // Write status artifact
    const nodeDir = join(opts.logsRoot, node.id);
    await mkdir(nodeDir, { recursive: true });
    await writeFile(join(nodeDir, "status.json"), JSON.stringify(outcome, null, 2), "utf8");

    // Handle retry
    const maxRetries = node.maxRetries ?? graph.defaultMaxRetries ?? 0;
    if (outcome.status === "retry" || (outcome.status === "fail" && maxRetries > 0)) {
      const retryCount = nodeRetries[node.id] ?? 0;
      if (retryCount < maxRetries) {
        nodeRetries[node.id] = retryCount + 1;
        // stay on same node
        await saveCheckpoint(opts.logsRoot, { timestamp: new Date().toISOString(), currentNode: node.id, completedNodes, nodeRetries, context });
        continue;
      }
      // exhausted retries — check fallback
      const fallback = node.retryTarget ?? node.fallbackRetryTarget ?? graph.retryTarget ?? graph.fallbackRetryTarget;
      if (fallback && nodes.has(fallback)) {
        currentNodeId = fallback;
        continue;
      }
      return { status: "fail", completedNodes, context, failureReason: `Node "${node.id}" failed after ${maxRetries} retries` };
    }

    if (outcome.status === "fail") {
      return { status: "fail", completedNodes, context, failureReason: outcome.failureReason ?? `Node "${node.id}" failed` };
    }

    // Advance
    completedNodes = [...completedNodes, node.id];
    await saveCheckpoint(opts.logsRoot, { timestamp: new Date().toISOString(), currentNode: node.id, completedNodes, nodeRetries, context });

    const nextEdge = selectNextEdge(node, outcome, context, edges);
    if (!nextEdge) {
      return { status: "fail", completedNodes, context, failureReason: `No outgoing edge from "${node.id}"` };
    }

    // loop_restart: reset and start over
    if (nextEdge.loopRestart) {
      completedNodes = [];
      nodeRetries = {};
      context = { "$goal": graph.goal ?? "" };
      if (opts.project) context["$project"] = opts.project;
      currentNodeId = startNode.id;
      continue;
    }

    currentNodeId = nextEdge.to;
  }
}
```

- [x] **Step 3: Run engine tests**

```bash
cd /Users/josu/Documents/projects/ralph-cli && npm test -- src/attractor/tests/engine.test.ts
```
Expected: all passing

- [x] **Step 4: Commit**

```bash
git add src/attractor/core/engine.ts src/attractor/tests/engine.test.ts
git commit -m "feat(attractor): pipeline execution engine — traversal, edge selection, retry, checkpoint"
```

---

## Chunk 7: Pipeline Command + Integration

### Task 12: `ralph pipeline` command

**Files:**
- Create: `src/cli/commands/pipeline.ts`
- Create: `src/cli/tests/pipeline.test.ts`
- Modify: `src/cli/program.ts`

- [x] **Step 1: Write pipeline command tests**

```typescript
// src/cli/tests/pipeline.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

vi.mock("../../attractor/core/engine.js", () => ({
  runPipeline: vi.fn(async () => ({ status: "success", completedNodes: ["start", "done"], context: {} })),
}));
vi.mock("../../attractor/core/graph.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../attractor/core/graph.js")>();
  return { ...actual };
});
vi.mock("../../cli/lib/loop.js", () => ({
  runLoop: vi.fn(async () => ({ success: true, iterations: 1, exitReason: "completed" })),
}));

import { pipelineRunCommand, pipelineValidateCommand } from "../commands/pipeline.js";
import * as engine from "../../attractor/core/engine.js";

const VALID_DOT = `digraph g {
  start [shape=Mdiamond]
  done  [shape=Msquare]
  start -> done
}`;

describe("pipelineValidateCommand", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "ralph-pipeline-test-")); });
  afterEach(() => { rmSync(dir, { recursive: true }); });

  it("returns 0 for a valid dot file", async () => {
    const dotFile = join(dir, "test.dot");
    writeFileSync(dotFile, VALID_DOT);
    const code = await pipelineValidateCommand(dotFile);
    expect(code).toBe(0);
  });

  it("returns 1 for a dot file with validation errors", async () => {
    const dotFile = join(dir, "bad.dot");
    writeFileSync(dotFile, `digraph g { work [shape=box] }`);
    const code = await pipelineValidateCommand(dotFile);
    expect(code).toBe(1);
  });

  it("returns 1 if file does not exist", async () => {
    const code = await pipelineValidateCommand(join(dir, "missing.dot"));
    expect(code).toBe(1);
  });
});

describe("pipelineRunCommand", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "ralph-pipeline-test-")); });
  afterEach(() => { rmSync(dir, { recursive: true }); });

  it("calls runPipeline with parsed graph", async () => {
    const dotFile = join(dir, "test.dot");
    writeFileSync(dotFile, VALID_DOT);
    await pipelineRunCommand(dotFile, { logsRoot: dir });
    expect(engine.runPipeline).toHaveBeenCalledTimes(1);
  });

  it("exits 1 if dotFile does not exist", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });
    await expect(pipelineRunCommand(join(dir, "nope.dot"), { logsRoot: dir })).rejects.toThrow();
    exitSpy.mockRestore();
  });
});
```

- [x] **Step 2: Implement `src/cli/commands/pipeline.ts`**

```typescript
// src/cli/commands/pipeline.ts
import { readFileSync, existsSync } from "fs";
import { resolve, join } from "path";
import { homedir } from "os";
import { parseDot, validateGraph, validateOrRaise } from "../../attractor/core/graph.js";
import { runPipeline } from "../../attractor/core/engine.js";
import { runLoop } from "../lib/loop.js";
import { variableExpansionTransform } from "../../attractor/transforms/variable-expansion.js";
import { ConsoleInterviewer } from "../../attractor/interviewer/console.js";
import * as output from "../lib/output.js";

export interface PipelineRunOptions {
  project?: string;
  resume?: boolean;
  logsRoot?: string;
}

export async function pipelineValidateCommand(dotFile: string): Promise<number> {
  const absPath = resolve(dotFile);
  if (!existsSync(absPath)) {
    await output.error(`Dot file not found: ${absPath}`);
    return 1;
  }
  let src: string;
  try { src = readFileSync(absPath, "utf8"); }
  catch (err) { await output.error(`Cannot read file: ${absPath}`); return 1; }

  const graph = parseDot(src);
  const diags = validateGraph(graph);
  const errors   = diags.filter(d => d.severity === "error");
  const warnings = diags.filter(d => d.severity === "warning");

  for (const w of warnings) output.warn(`[${w.rule}] ${w.message}`);
  for (const e of errors)   output.error(`[${e.rule}] ${e.message}`);

  if (errors.length === 0) {
    await output.success(`Pipeline valid (${graph.nodes.size} nodes, ${graph.edges.length} edges)`);
    return 0;
  }
  return 1;
}

export async function pipelineRunCommand(dotFile: string, opts: PipelineRunOptions = {}): Promise<void> {
  const absPath = resolve(dotFile);
  if (!existsSync(absPath)) {
    await output.error(`Dot file not found: ${absPath}`);
    process.exit(1);
  }

  const src = readFileSync(absPath, "utf8");
  let graph = parseDot(src);

  try { validateOrRaise(graph); }
  catch (err) { await output.error((err as Error).message); process.exit(1); }

  // Apply variable expansion transform
  graph = variableExpansionTransform(graph, { project: opts.project });

  // Build logs root
  const slug = graph.name.replace(/\s+/g, "-").toLowerCase();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const logsRoot = opts.logsRoot ?? join(homedir(), ".ralph", "runs", `${slug}-${timestamp}`);

  const ac = new AbortController();
  const onSignal = () => ac.abort();
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  try {
    const result = await runPipeline(graph, {
      logsRoot,
      cwd: opts.project ? resolve(opts.project) : process.cwd(),
      runLoop,
      interviewer: new ConsoleInterviewer(),
      signal: ac.signal,
      project: opts.project,
      resume: opts.resume,
    });

    if (result.status === "success") {
      await output.success(`Pipeline completed (${result.completedNodes.length} nodes)`);
    } else {
      await output.error(`Pipeline failed: ${result.failureReason}`);
      process.exit(1);
    }
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  }
}
```

- [x] **Step 3: Register pipeline command in program.ts**

In `src/cli/program.ts`, add after the last command registration:

```typescript
import { pipelineRunCommand, pipelineValidateCommand } from "./commands/pipeline.js";

// Inside createProgram():
const pipeline = program.command("pipeline").description("Pipeline engine commands");

pipeline
  .command("run <dotfile>")
  .description("Run a .dot pipeline file")
  .option("--project <folder>", "Project folder ($project variable and cwd)")
  .option("--resume", "Resume from last checkpoint")
  .action(async (dotFile: string, opts: { project?: string; resume?: boolean }) => {
    await pipelineRunCommand(dotFile, opts);
  });

pipeline
  .command("validate <dotfile>")
  .description("Validate a .dot pipeline file")
  .action(async (dotFile: string) => {
    const code = await pipelineValidateCommand(dotFile);
    process.exit(code);
  });
```

- [x] **Step 4: Run pipeline tests**

```bash
cd /Users/josu/Documents/projects/ralph-cli && npm test -- src/cli/tests/pipeline.test.ts
```
Expected: all passing

- [x] **Step 5: Run full test suite**

```bash
cd /Users/josu/Documents/projects/ralph-cli && npm test
```
Expected: all passing

- [x] **Step 6: Build**

```bash
cd /Users/josu/Documents/projects/ralph-cli && npm run build
```
Expected: exits 0, `dist/cli/index.js` updated

- [x] **Step 7: Smoke test**

```bash
ralph pipeline --help
```
Expected: shows `run` and `validate` subcommands

- [x] **Step 8: Commit**

```bash
git add src/cli/commands/pipeline.ts src/cli/program.ts src/cli/tests/pipeline.test.ts
git commit -m "feat(attractor): ralph pipeline run/validate command"
```

---

### Task 13: Final wiring and DoD verification

**Files:**
- Modify: none (verification only)

- [x] **Step 1: Run full test suite and confirm all pass**

```bash
cd /Users/josu/Documents/projects/ralph-cli && npm test -- --reporter=verbose 2>&1 | tail -20
```
Expected: all passing, no failures

- [x] **Step 2: Build and verify binary**

```bash
npm run build && ralph --version && ralph pipeline --help && ralph pipeline validate --help
```
Expected: no errors, help text shows for both subcommands

- [x] **Step 3: Create a real test pipeline and validate it**

```bash
cat > /tmp/test-pipeline.dot << 'EOF'
digraph coding_pipeline {
  goal="Ship quality code"
  start       [shape=Mdiamond]
  done        [shape=Msquare]
  start -> done
}
EOF
ralph pipeline validate /tmp/test-pipeline.dot
```
Expected: `Pipeline valid (2 nodes, 1 edges)`

- [x] **Step 4: Verify implement command still works (no regression)**

```bash
ralph --help | grep implement
```
Expected: implement command still listed

- [x] **Step 5: Commit DoD verification**

```bash
git add -A
git commit -m "feat(attractor): pipeline engine complete — all DoD items verified"
```

---

## File Map Summary

| File | Status | Responsibility |
|------|--------|----------------|
| `src/attractor/types.ts` | NEW | Shared types: Node, Edge, Graph, Outcome, CheckpointState |
| `src/attractor/core/graph.ts` | NEW | DOT parser (`parseDot`), validator (`validateGraph`, `validateOrRaise`), `resolveHandlerType` |
| `src/attractor/core/engine.ts` | NEW | Pipeline traversal, edge selection, retry, goal gate, checkpoint |
| `src/attractor/core/conditions.ts` | NEW | Edge condition expression evaluator |
| `src/attractor/checkpoint.ts` | NEW | `saveCheckpoint` / `loadCheckpoint` |
| `src/attractor/handlers/registry.ts` | NEW | Handler interface + lookup map |
| `src/attractor/handlers/codergen.ts` | NEW | Box node handler — wraps `runLoop()` |
| `src/attractor/handlers/tool.ts` | NEW | Parallelogram node — shell command execution |
| `src/attractor/handlers/wait-human.ts` | NEW | Hexagon node — blocks for interviewer input |
| `src/attractor/handlers/conditional.ts` | NEW | Diamond node — no-op pass-through |
| `src/attractor/handlers/start-exit.ts` | NEW | Mdiamond/Msquare no-op handlers |
| `src/attractor/handlers/parallel.ts` | NEW | `ParallelHandler` (fan-out) + `FanInHandler` (tripleoctagon) |
| `src/attractor/handlers/manager-loop.ts` | NEW | `ManagerLoopHandler` — polling supervisor loop (house shape) |
| `src/attractor/handlers/ralph-implement.ts` | NEW | `ralph.implement` alias for codergen |
| `src/attractor/handlers/ralph-meditate.ts` | NEW | `ralph.meditate` subprocess handler |
| `src/attractor/handlers/ralph-scenarios.ts` | NEW | `ralph.run-scenarios` subprocess handler |
| `src/attractor/interviewer/index.ts` | NEW | Interviewer interface + types |
| `src/attractor/interviewer/auto-approve.ts` | NEW | AutoApproveInterviewer |
| `src/attractor/interviewer/queue.ts` | NEW | QueueInterviewer (for tests) |
| `src/attractor/interviewer/callback.ts` | NEW | CallbackInterviewer |
| `src/attractor/interviewer/console.ts` | NEW | ConsoleInterviewer (stdin readline) |
| `src/attractor/transforms/variable-expansion.ts` | NEW | `$goal`/`$project` substitution |
| `src/attractor/transforms/preamble.ts` | NEW | Context carryover preamble synthesis |
| `src/cli/commands/pipeline.ts` | NEW | `ralph pipeline run/validate` |
| `src/cli/lib/loop.ts` | MODIFIED | Returns `LoopResult`, accepts `AbortSignal`, throws instead of `process.exit` |
| `src/cli/commands/implement.ts` | MODIFIED | Wraps `runLoop` in try/catch + own `AbortController` |
| `src/cli/program.ts` | MODIFIED | Registers `pipeline` subcommand |
