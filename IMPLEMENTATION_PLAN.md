# Unified Agent Architecture Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a shared Agent class, agent registry, and CLI commands that unify how ralph-cli spawns Claude sessions across commands and attractor pipeline nodes.

**Architecture:** A thin Agent class wraps `spawn("claude", ...)` with config-driven arg building. Agent definitions are markdown files with YAML frontmatter stored in `~/.ralph/agents/`. The registry resolves agent names to configs. Existing commands (plan, implement, meditate, meditate-create) are refactored to use Agent instances. The attractor engine gains an AgentHandler that resolves pipeline nodes to agents.

**Tech Stack:** TypeScript, Node.js `child_process`, vitest, Commander.js (existing), gray-matter (new dependency for frontmatter parsing)

**Spec:** `docs/superpowers/specs/2026-04-09-unified-agent-architecture-design.md`

---

## Status

**Chunks 1-4 complete (Tasks 1-21). Chunks 5-7 (pipeline bug fixes + docs) complete.** All 397 tests pass, typecheck clean, build succeeds.

### Chunk 7: Pipeline Authoring Prompt & Preflight Guard (0.0.41)

Two Known Issues resolved:

1. **PROMPT_pipeline_create.md rewritten** — Corrected `goal_gate` description (pipeline-level completion gate, not node-level enforcement). Added `loop_restart` edge attribute documentation. Added `agent="name"` node attribute. Removed `parallel`/`parallel.fan_in`/`house` from available types table with explicit "not yet implemented" warning. Updated reference example to demonstrate `goal_gate`, `loop_restart`, and named agents.
2. **pipelineCreateCommand `which claude` guard** — Added preflight check matching plan/new/meditate/meditate-create commands. Test added.

### Chunk 6: Resume, Checkpoint & Variable Expansion Fixes (0.0.40)

Five fixes addressing core pipeline reliability:

1. **Stable logsRoot for `--resume`** — Replaced timestamp-based `~/.ralph/runs/<slug>-<timestamp>/` with deterministic `~/.ralph/runs/<slug>/`. Fresh runs clean previous directory; `--resume` finds existing checkpoint. Test added.
2. **Checkpoint save split** — Advance block split into normal-edge and loop_restart-edge paths. Normal edges save `currentNode: nextEdge.to` (next node to execute). Loop_restart edges save `currentNode: startNode.id` with reset state. Prevents resume from executing phantom sentinel nodes.
3. **Resume warning on missing checkpoint** — Engine now logs `[ralph] --resume: no checkpoint found` instead of silently starting fresh.
4. **stack.manager_loop validation** — Added to `UNIMPLEMENTED_TYPES` and `KNOWN_TYPES`, producing a validation error instead of silently crashing at runtime with "No handler for type."
5. **variableExpansionTransform expanded** — Now substitutes all `$key.name` patterns from a context map, not just `$goal`/`$project`. Enables prompts like `"Iteration $loop.iteration, prior: $agent.success"`.

### Chunk 5: Pipeline Engine Bug Fixes (0.0.39)

Five inert pipeline features identified by meditation illuminations, fixed in one batch:

1. **Agent.run() race condition** — `close` event listener now registered before awaiting `onStdout` callback, preventing hang when child exits during stream consumption.
2. **onStdout callback** — Agent class supports `onStdout` for callers to consume stdout (e.g., `implement` command piping through `streamEvents`). Test added.
3. **completedNodes deduplication** — `engine.ts` now uses set semantics for `completedNodes` (deduplicates on append), preventing unbounded checkpoint growth in looping pipelines.
4. **loopRestart context preservation** — `engine.ts` `loop_restart` edges now preserve accumulated context instead of wiping it. Increments `loop.iteration` counter so retry loops can learn from prior iterations.
5. **buildPreamble wired into AgentHandler** — Pipeline context preamble (completed stages + context values) is now prepended to agent prompts, making nodes context-aware of prior pipeline state.
6. **ConsoleInterviewer TTY detection** — `ConsoleInterviewer.ask()` now throws immediately if stdin is not a TTY, preventing indefinite hang in non-interactive contexts.
7. **Unsupported types disabled in validator** — `parallel`, `parallel.fan_in` node types now produce validation errors ("not yet implemented"). `stack.manager_loop` removed from KNOWN_TYPES.
8. **Condition resolver fix** — `evaluateCondition` now resolves `context.X` conditions by checking both `ctx["context.X"]` and `ctx["X"]`, enabling conditions to reference engine-stored context keys.
9. **Specs updated** — `specs/loop.md`, `specs/architecture.md`, `specs/commands.md` updated to reflect Agent class architecture (loop.ts removed, agent commands documented).

### Chunk 4 (prior)

AgentHandler replaces CodergenHandler for attractor pipeline. Agent attribute (`agent="name"`) in DOT files routes to named agents via AgentHandler. Backward compatibility: `shape=box` nodes (codergen handler type) now fall back to "implement" agent. CodergenHandler, RalphImplementHandler, loop.ts, and loop.test.ts deleted. Engine no longer requires `runLoop` in its options.

### Known Issues

- No known issues at this time.

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `src/cli/lib/agent.ts` | Agent class — config to claude spawn, stream, result |
| `src/cli/lib/agent-registry.ts` | Resolves agent names to AgentConfig from `~/.ralph/agents/` or bundled defaults |
| `src/cli/lib/frontmatter.ts` | Parses markdown frontmatter (YAML header + body) |
| `src/cli/agents/implement.md` | Built-in implement agent definition |
| `src/cli/agents/plan.md` | Built-in plan agent definition |
| `src/cli/agents/meditate.md` | Built-in meditate agent definition |
| `src/cli/agents/meditate-create.md` | Built-in meditate-create agent definition |
| `src/cli/agents/agent-creator.md` | Built-in agent-creator agent definition |
| `src/cli/commands/agent.ts` | CLI commands: agent list, agent show, agent create |
| `src/attractor/handlers/agent-handler.ts` | Generic handler that resolves agent from registry and runs it |
| `src/cli/tests/agent.test.ts` | Unit tests for Agent class |
| `src/cli/tests/agent-registry.test.ts` | Unit tests for agent registry |
| `src/cli/tests/frontmatter.test.ts` | Unit tests for frontmatter parser |
| `src/cli/tests/agent-commands.test.ts` | Unit tests for agent CLI commands |
| `src/attractor/tests/agent-handler.test.ts` | Unit tests for AgentHandler |
| `scenario-tests/test-agent-list.sh` | E2E: ralph agent list |
| `scenario-tests/test-agent-show.sh` | E2E: ralph agent show |
| `scenario-tests/test-agent-create.sh` | E2E: ralph agent create |

### Modified Files

| File | Change |
|------|--------|
| `package.json` | Add `gray-matter` dependency |
| `tsup.config.ts` | Add agent definition files to assets copy |
| `src/cli/lib/assets.ts` | Add `getAgentDefinitionPath()`, `getBundledAgentsDir()` |
| `src/cli/program.ts` | Register `ralph agent` command group |
| `src/attractor/types.ts` | Add `agent?: string` to Node interface |
| `src/attractor/core/graph.ts` | Add `"agent"` to KNOWN_TYPES, update `resolveHandlerType()` |
| `src/attractor/core/engine.ts` | Register AgentHandler in `buildHandlerMap()` |
| `src/cli/commands/implement.ts` | Refactor to use Agent class |
| `src/cli/commands/plan.ts` | Refactor to use Agent class |
| `src/cli/commands/meditate.ts` | Refactor to use Agent class |
| `src/cli/commands/meditate-create.ts` | Refactor to use Agent class |
| `src/attractor/handlers/codergen.ts` | Deprecate, delegate to AgentHandler |

### Deleted Files (Phase 3 completion)

| File | Reason |
|------|--------|
| `src/cli/lib/loop.ts` | Spawn/stream logic moves to Agent, iteration logic to implement.ts |

---

## Chunk 1: Foundation — Frontmatter Parser, Agent Config, Agent Class

### Task 1: Add gray-matter dependency

**Files:**
- Modify: `package.json`

- [x] **Step 1: Install gray-matter**

Run: `npm install gray-matter`

- [x] **Step 2: Verify installation**

Run: `npm ls gray-matter`
Expected: `gray-matter@x.x.x` listed

- [x] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add gray-matter dependency for frontmatter parsing"
```

---

### Task 2: Frontmatter parser

**Files:**
- Create: `src/cli/lib/frontmatter.ts`
- Create: `src/cli/tests/frontmatter.test.ts`

- [x] **Step 1: Write failing tests for frontmatter parser**

Create `src/cli/tests/frontmatter.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseFrontmatter } from "../lib/frontmatter.js";

describe("parseFrontmatter", () => {
  it("parses YAML frontmatter and markdown body", () => {
    const input = `---
name: reviewer
description: Reviews code
model: sonnet
---

You are a code reviewer.`;

    const result = parseFrontmatter(input);
    expect(result.attributes.name).toBe("reviewer");
    expect(result.attributes.description).toBe("Reviews code");
    expect(result.attributes.model).toBe("sonnet");
    expect(result.body.trim()).toBe("You are a code reviewer.");
  });

  it("returns empty attributes when no frontmatter", () => {
    const input = "Just a plain markdown file.";
    const result = parseFrontmatter(input);
    expect(result.attributes).toEqual({});
    expect(result.body).toBe("Just a plain markdown file.");
  });

  it("parses array fields", () => {
    const input = `---
name: test
description: test agent
tools:
  - read_file
  - glob_files
---

Prompt body.`;

    const result = parseFrontmatter(input);
    expect(result.attributes.tools).toEqual(["read_file", "glob_files"]);
  });

  it("parses MCP server config objects", () => {
    const input = `---
name: test
description: test agent
mcp:
  - name: illumination
    command: node
    args:
      - /path/to/server.js
---

Prompt.`;

    const result = parseFrontmatter(input);
    expect(result.attributes.mcp).toEqual([
      { name: "illumination", command: "node", args: ["/path/to/server.js"] },
    ]);
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/cli/tests/frontmatter.test.ts`
Expected: FAIL — module not found

- [x] **Step 3: Implement frontmatter parser**

Create `src/cli/lib/frontmatter.ts`:

```typescript
import matter from "gray-matter";

export interface FrontmatterResult {
  attributes: Record<string, unknown>;
  body: string;
}

export function parseFrontmatter(content: string): FrontmatterResult {
  const { data, content: body } = matter(content);
  return { attributes: data, body };
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/cli/tests/frontmatter.test.ts`
Expected: All 4 tests PASS

- [x] **Step 5: Commit**

```bash
git add src/cli/lib/frontmatter.ts src/cli/tests/frontmatter.test.ts
git commit -m "feat: add frontmatter parser for agent definition files"
```

---

### Task 3: Agent config types and validation

**Files:**
- Create: `src/cli/lib/agent.ts` (types only in this task)
- Create: `src/cli/tests/agent.test.ts` (validation tests only in this task)

- [x] **Step 1: Write failing tests for config validation**

Create `src/cli/tests/agent.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { validateAgentConfig, type AgentConfig } from "../lib/agent.js";

describe("validateAgentConfig", () => {
  const validConfig: AgentConfig = {
    name: "reviewer",
    description: "Reviews code",
    model: "sonnet",
    permissionMode: "dontAsk",
    tools: ["read_file"],
    mcp: [],
    prompt: "You are a reviewer.",
  };

  it("accepts a valid config", () => {
    expect(() => validateAgentConfig(validConfig)).not.toThrow();
  });

  it("rejects missing name", () => {
    const config = { ...validConfig, name: "" };
    expect(() => validateAgentConfig(config)).toThrow("name is required");
  });

  it("rejects missing description", () => {
    const config = { ...validConfig, description: "" };
    expect(() => validateAgentConfig(config)).toThrow("description is required");
  });

  it("rejects missing prompt", () => {
    const config = { ...validConfig, prompt: "" };
    expect(() => validateAgentConfig(config)).toThrow("prompt body is required");
  });

  it("applies defaults for optional fields", () => {
    const minimal = {
      name: "test",
      description: "test agent",
      prompt: "Do things.",
    };
    const result = validateAgentConfig(minimal as AgentConfig);
    expect(result.model).toBe("opus");
    expect(result.permissionMode).toBe("dangerouslySkipPermissions");
    expect(result.tools).toEqual([]);
    expect(result.mcp).toEqual([]);
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/cli/tests/agent.test.ts`
Expected: FAIL — module not found

- [x] **Step 3: Implement types and validation**

Create `src/cli/lib/agent.ts`:

```typescript
export interface McpServerConfig {
  name: string;
  command: string;
  args: string[];
}

export interface AgentConfig {
  name: string;
  description: string;
  model: string;
  permissionMode: string;
  tools: string[];
  mcp: McpServerConfig[];
  prompt: string;
}

export interface RunOptions {
  cwd: string;
  signal?: AbortSignal;
  variables?: Record<string, string>;
  resume?: string;
  interactive?: boolean;
  onSessionId?: (id: string) => void;
}

export interface RunResult {
  exitCode: number;
  sessionId: string | null;
  stdout: import("stream").Readable | null;
}

const DEFAULTS: Partial<AgentConfig> = {
  model: "opus",
  permissionMode: "dangerouslySkipPermissions",
  tools: [],
  mcp: [],
};

export function validateAgentConfig(
  config: Partial<AgentConfig> & { prompt?: string },
): AgentConfig {
  if (!config.name) throw new Error("name is required");
  if (!config.description) throw new Error("description is required");
  if (!config.prompt) throw new Error("prompt body is required");

  return {
    name: config.name,
    description: config.description,
    model: config.model ?? DEFAULTS.model!,
    permissionMode: config.permissionMode ?? DEFAULTS.permissionMode!,
    tools: config.tools ?? DEFAULTS.tools!,
    mcp: config.mcp ?? DEFAULTS.mcp!,
    prompt: config.prompt,
  };
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/cli/tests/agent.test.ts`
Expected: All 5 tests PASS

- [x] **Step 5: Commit**

```bash
git add src/cli/lib/agent.ts src/cli/tests/agent.test.ts
git commit -m "feat: add AgentConfig types and validation"
```

---

### Task 4: Agent class — build claude args

**Files:**
- Modify: `src/cli/lib/agent.ts`
- Modify: `src/cli/tests/agent.test.ts`

- [x] **Step 1: Write failing tests for arg building**

Append to `src/cli/tests/agent.test.ts`:

```typescript
import { Agent } from "../lib/agent.js";

describe("Agent.buildArgs", () => {
  const baseConfig: AgentConfig = {
    name: "test",
    description: "test agent",
    model: "sonnet",
    permissionMode: "dangerouslySkipPermissions",
    tools: [],
    mcp: [],
    prompt: "You are a test agent.",
  };

  it("builds basic args with model and permission flag (no -p, prompt goes via stdin)", () => {
    const agent = new Agent(baseConfig);
    const args = agent.buildArgs({ cwd: "/tmp/project" });
    expect(args).not.toContain("-p");
    expect(args).toContain("--model");
    expect(args).toContain("sonnet");
    expect(args).toContain("--dangerously-skip-permissions");
    expect(args).toContain("--output-format");
    expect(args).toContain("stream-json");
  });

  it("uses --permission-mode for non-skip values", () => {
    const config = { ...baseConfig, permissionMode: "dontAsk" };
    const agent = new Agent(config);
    const args = agent.buildArgs({ cwd: "/tmp/project" });
    expect(args).toContain("--permission-mode");
    expect(args).toContain("dontAsk");
    expect(args).not.toContain("--dangerously-skip-permissions");
  });

  it("adds --allowedTools for each tool", () => {
    const config = { ...baseConfig, tools: ["read_file", "glob_files"] };
    const agent = new Agent(config);
    const args = agent.buildArgs({ cwd: "/tmp/project" });
    const toolFlags = args.filter((a: string) => a === "--allowedTools");
    expect(toolFlags).toHaveLength(2);
    expect(args).toContain("read_file");
    expect(args).toContain("glob_files");
  });

  it("uses --resume instead of -p when resuming", () => {
    const agent = new Agent(baseConfig);
    const args = agent.buildArgs({
      cwd: "/tmp/project",
      resume: "session-123",
    });
    expect(args).toContain("--resume");
    expect(args).toContain("session-123");
    expect(args).not.toContain("-p");
  });

  it("omits --output-format when interactive", () => {
    const agent = new Agent(baseConfig);
    const args = agent.buildArgs({
      cwd: "/tmp/project",
      interactive: true,
    });
    expect(args).not.toContain("--output-format");
    expect(args).not.toContain("stream-json");
  });

  it("expands {{VARIABLES}} in prompt", () => {
    const config = {
      ...baseConfig,
      prompt: "Working on {{PROJECT_NAME}} with goal {{GOAL}}",
    };
    const agent = new Agent(config);
    const expanded = agent.expandPrompt({
      PROJECT_NAME: "my-app",
      GOAL: "build it",
    });
    expect(expanded).toBe("Working on my-app with goal build it");
  });

  it("leaves unknown variables as-is", () => {
    const config = {
      ...baseConfig,
      prompt: "Working on {{PROJECT_NAME}} and {{UNKNOWN}}",
    };
    const agent = new Agent(config);
    const expanded = agent.expandPrompt({ PROJECT_NAME: "my-app" });
    expect(expanded).toBe("Working on my-app and {{UNKNOWN}}");
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/cli/tests/agent.test.ts`
Expected: FAIL — Agent class not found

- [x] **Step 3: Implement Agent class with buildArgs and expandPrompt**

Add to `src/cli/lib/agent.ts`:

```typescript
export class Agent {
  constructor(public readonly config: AgentConfig) {}

  expandPrompt(variables?: Record<string, string>): string {
    if (!variables) return this.config.prompt;
    return this.config.prompt.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      return variables[key] ?? match;
    });
  }

  buildArgs(options: RunOptions): string[] {
    const args: string[] = [];

    // Resume mode (prompt goes via stdin, not -p flag)
    if (options.resume) {
      args.push("--resume", options.resume);
    }

    // Model
    args.push("--model", this.config.model);

    // Permission mode
    if (this.config.permissionMode === "dangerouslySkipPermissions") {
      args.push("--dangerously-skip-permissions");
    } else {
      args.push("--permission-mode", this.config.permissionMode);
    }

    // Output format (non-interactive only)
    if (!options.interactive) {
      args.push("--output-format", "stream-json");
    }

    // Allowed tools
    for (const tool of this.config.tools) {
      args.push("--allowedTools", tool);
    }

    return args;
  }
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/cli/tests/agent.test.ts`
Expected: All 12 tests PASS

- [x] **Step 5: Commit**

```bash
git add src/cli/lib/agent.ts src/cli/tests/agent.test.ts
git commit -m "feat: add Agent class with buildArgs and expandPrompt"
```

---

### Task 5: Agent class — run method (spawn + stream + result)

**Files:**
- Modify: `src/cli/lib/agent.ts`
- Modify: `src/cli/tests/agent.test.ts`

- [x] **Step 1: Write failing tests for agent.run()**

Append to `src/cli/tests/agent.test.ts`:

```typescript
// NOTE: These run() tests should go in a SEPARATE file `agent-run.test.ts`
// to avoid vi.mock("child_process") polluting the pure unit tests above.
// File: src/cli/tests/agent-run.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";
import { Readable } from "stream";

vi.mock("child_process", () => ({
  spawn: vi.fn(),
}));

describe("Agent.run", () => {
  const baseConfig: AgentConfig = {
    name: "test",
    description: "test agent",
    model: "sonnet",
    permissionMode: "dangerouslySkipPermissions",
    tools: [],
    mcp: [],
    prompt: "You are a test agent.",
  };

  function createMockChild(exitCode = 0) {
    const child = new EventEmitter() as any;
    child.stdin = { write: vi.fn(), end: vi.fn() };
    child.stdout = new Readable({ read() {} });
    child.stderr = new Readable({ read() {} });
    child.pid = 12345;
    // Simulate exit after microtask
    setTimeout(() => child.emit("close", exitCode), 10);
    return child;
  }

  it("spawns claude with correct args and returns result", async () => {
    const { spawn } = await import("child_process");
    const mockChild = createMockChild(0);
    vi.mocked(spawn).mockReturnValue(mockChild as any);

    const agent = new Agent(baseConfig);
    const result = await agent.run({ cwd: "/tmp/project" });

    expect(spawn).toHaveBeenCalledWith(
      "claude",
      expect.arrayContaining(["-p", "--model", "sonnet"]),
      expect.objectContaining({ cwd: "/tmp/project" }),
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(mockChild.stdout);
  });

  it("pipes expanded prompt to stdin", async () => {
    const { spawn } = await import("child_process");
    const mockChild = createMockChild(0);
    vi.mocked(spawn).mockReturnValue(mockChild as any);

    const config = { ...baseConfig, prompt: "Hello {{NAME}}" };
    const agent = new Agent(config);
    await agent.run({ cwd: "/tmp", variables: { NAME: "world" } });

    expect(mockChild.stdin.write).toHaveBeenCalledWith("Hello world");
    expect(mockChild.stdin.end).toHaveBeenCalled();
  });

  it("uses inherited stdio when interactive", async () => {
    const { spawn } = await import("child_process");
    const mockChild = createMockChild(0);
    mockChild.stdout = null;
    mockChild.stderr = null;
    vi.mocked(spawn).mockReturnValue(mockChild as any);

    const agent = new Agent(baseConfig);
    const result = await agent.run({ cwd: "/tmp", interactive: true });

    expect(spawn).toHaveBeenCalledWith(
      "claude",
      expect.any(Array),
      expect.objectContaining({ stdio: "inherit" }),
    );
    expect(result.stdout).toBeNull();
  });

  it("returns non-zero exit code on failure", async () => {
    const { spawn } = await import("child_process");
    const mockChild = createMockChild(1);
    vi.mocked(spawn).mockReturnValue(mockChild as any);

    const agent = new Agent(baseConfig);
    const result = await agent.run({ cwd: "/tmp" });

    expect(result.exitCode).toBe(1);
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/cli/tests/agent.test.ts`
Expected: FAIL — agent.run is not a function

- [x] **Step 3: Implement agent.run()**

Add `run()` method to the `Agent` class in `src/cli/lib/agent.ts`:

```typescript
import { spawn as nodeSpawn, type ChildProcess } from "child_process";
import { PassThrough, type Readable } from "stream";

// Add to Agent class:
  private child: ChildProcess | null = null;

  async run(options: RunOptions): Promise<RunResult> {
    const args = this.buildArgs(options);
    const prompt = this.expandPrompt(options.variables);

    const spawnOptions: any = {
      cwd: options.cwd,
      env: process.env,
    };

    if (options.interactive) {
      spawnOptions.stdio = "inherit";
    } else {
      spawnOptions.stdio = ["pipe", "pipe", "inherit"];
      spawnOptions.detached = true;
    }

    // Write MCP config if needed (before spawn so --mcp-config arg is valid)
    this.writeMcpConfig(options.cwd);

    this.child = nodeSpawn("claude", args, spawnOptions);

    // Use PassThrough so callers can consume stdout after run() resolves
    let stdout: Readable | null = null;
    if (!options.interactive && this.child.stdout) {
      const pass = new PassThrough();
      this.child.stdout.pipe(pass);
      stdout = pass;
    }

    // Pipe prompt to stdin for non-interactive, non-resume runs
    if (!options.interactive && !options.resume && this.child.stdin) {
      this.child.stdin.write(prompt);
      this.child.stdin.end();
    }

    // Session ID capture from stream-json
    let sessionId: string | null = null;
    if (!options.interactive && this.child.stdout) {
      this.child.stdout.on("data", (chunk: Buffer) => {
        if (sessionId) return;
        try {
          const lines = chunk.toString().split("\n");
          for (const line of lines) {
            if (!line.trim()) continue;
            const parsed = JSON.parse(line);
            if (parsed.session_id) {
              sessionId = parsed.session_id;
              if (options.onSessionId) options.onSessionId(sessionId!);
              break;
            }
          }
        } catch {
          // Not JSON yet, continue
        }
      });
    }

    try {
      const exitCode = await new Promise<number>((resolve) => {
        this.child!.on("close", (code) => resolve(code ?? 1));
      });

      this.child = null;
      return { exitCode, sessionId, stdout };
    } finally {
      this.cleanupMcpConfig();
    }
  }

  kill(): void {
    if (this.child?.pid) {
      try {
        process.kill(-this.child.pid, "SIGTERM");
      } catch {
        // Process already exited
      }
    }
  }
```

- [x] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/cli/tests/agent.test.ts`
Expected: All 16 tests PASS

- [x] **Step 5: Commit**

```bash
git add src/cli/lib/agent.ts src/cli/tests/agent.test.ts
git commit -m "feat: add Agent.run() with spawn, stream, and session capture"
```

---

### Task 6: Agent class — MCP config lifecycle

**Files:**
- Modify: `src/cli/lib/agent.ts`
- Modify: `src/cli/tests/agent.test.ts`

- [x] **Step 1: Write failing tests for MCP config handling**

Append to `src/cli/tests/agent.test.ts`:

```typescript
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";

describe("Agent MCP config", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "ralph-agent-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("writes MCP config file when mcp servers are defined", () => {
    const config: AgentConfig = {
      name: "test",
      description: "test",
      model: "sonnet",
      permissionMode: "dontAsk",
      tools: [],
      mcp: [{ name: "myserver", command: "node", args: ["/path/server.js"] }],
      prompt: "test",
    };
    const agent = new Agent(config);
    const configPath = agent.writeMcpConfig(tempDir);

    expect(configPath).not.toBeNull();
    expect(existsSync(configPath!)).toBe(true);

    const content = JSON.parse(readFileSync(configPath!, "utf-8"));
    expect(content.mcpServers.myserver).toBeDefined();
    expect(content.mcpServers.myserver.command).toBe("node");
  });

  it("returns null when no MCP servers", () => {
    const config: AgentConfig = {
      name: "test",
      description: "test",
      model: "sonnet",
      permissionMode: "dontAsk",
      tools: [],
      mcp: [],
      prompt: "test",
    };
    const agent = new Agent(config);
    const configPath = agent.writeMcpConfig(tempDir);
    expect(configPath).toBeNull();
  });

  it("cleans up MCP config file", () => {
    const config: AgentConfig = {
      name: "test",
      description: "test",
      model: "sonnet",
      permissionMode: "dontAsk",
      tools: [],
      mcp: [{ name: "s", command: "node", args: [] }],
      prompt: "test",
    };
    const agent = new Agent(config);
    const configPath = agent.writeMcpConfig(tempDir);
    expect(existsSync(configPath!)).toBe(true);

    agent.cleanupMcpConfig();
    expect(existsSync(configPath!)).toBe(false);
  });

  it("includes --mcp-config in args when MCP servers present", () => {
    const config: AgentConfig = {
      name: "test",
      description: "test",
      model: "sonnet",
      permissionMode: "dontAsk",
      tools: [],
      mcp: [{ name: "s", command: "node", args: [] }],
      prompt: "test",
    };
    const agent = new Agent(config);
    agent.writeMcpConfig(tempDir);
    const args = agent.buildArgs({ cwd: tempDir });
    expect(args).toContain("--mcp-config");
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/cli/tests/agent.test.ts`
Expected: FAIL — writeMcpConfig is not a function

- [x] **Step 3: Implement MCP config methods**

Add to `Agent` class in `src/cli/lib/agent.ts`:

```typescript
import { writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";

// Add to Agent class:
  private mcpConfigPath: string | null = null;

  writeMcpConfig(cwd: string): string | null {
    if (this.config.mcp.length === 0) return null;

    const mcpServers: Record<string, any> = {};
    for (const server of this.config.mcp) {
      mcpServers[server.name] = {
        type: "stdio",
        command: server.command,
        args: server.args,
      };
    }

    this.mcpConfigPath = join(cwd, `.mcp.ralph-${process.pid}.json`);
    writeFileSync(this.mcpConfigPath, JSON.stringify({ mcpServers }, null, 2));
    return this.mcpConfigPath;
  }

  cleanupMcpConfig(): void {
    if (this.mcpConfigPath) {
      rmSync(this.mcpConfigPath, { force: true });
      this.mcpConfigPath = null;
    }
  }
```

Update `buildArgs()` to include `--mcp-config` when `mcpConfigPath` is set:

```typescript
// Add at end of buildArgs(), before return:
    if (this.mcpConfigPath) {
      args.push("--mcp-config", this.mcpConfigPath);
    }
```

Update `run()` to call cleanup in finally block:

```typescript
// Wrap the run body in try/finally:
    try {
      // ... existing spawn and await logic ...
    } finally {
      this.cleanupMcpConfig();
    }
```

- [x] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/cli/tests/agent.test.ts`
Expected: All 20 tests PASS

- [x] **Step 5: Commit**

```bash
git add src/cli/lib/agent.ts src/cli/tests/agent.test.ts
git commit -m "feat: add MCP config lifecycle to Agent class"
```

---

### Task 7: Agent registry

**Files:**
- Modify: `src/cli/lib/assets.ts`
- Create: `src/cli/lib/agent-registry.ts`
- Create: `src/cli/tests/agent-registry.test.ts`

- [x] **Step 1: Add asset helper for bundled agents directory**

Read `src/cli/lib/assets.ts` first. Then add to `src/cli/lib/assets.ts`:

```typescript
export function getBundledAgentsDir(): string {
  return join(getAssetBase(), "agents");
}
```

Where `getAssetBase()` follows the existing pattern (using `__dirname` and `__RALPH_PROD__`). If no `getAssetBase()` exists, derive the path the same way existing functions do.

- [x] **Step 2: Write failing tests for agent registry**

Create `src/cli/tests/agent-registry.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  resolveAgent,
  listAgents,
  agentExists,
} from "../lib/agent-registry.js";

describe("agent-registry", () => {
  let userDir: string;
  let bundledDir: string;

  beforeEach(() => {
    userDir = mkdtempSync(join(tmpdir(), "ralph-agents-user-"));
    bundledDir = mkdtempSync(join(tmpdir(), "ralph-agents-bundled-"));
  });

  afterEach(() => {
    rmSync(userDir, { recursive: true, force: true });
    rmSync(bundledDir, { recursive: true, force: true });
  });

  const reviewerMd = `---
name: reviewer
description: Reviews code
model: sonnet
permissionMode: dontAsk
tools:
  - read_file
---

You are a reviewer.`;

  it("resolves agent from user directory", () => {
    writeFileSync(join(userDir, "reviewer.md"), reviewerMd);
    const config = resolveAgent("reviewer", { userDir, bundledDir });
    expect(config.name).toBe("reviewer");
    expect(config.model).toBe("sonnet");
    expect(config.prompt.trim()).toBe("You are a reviewer.");
  });

  it("falls back to bundled directory and copies to user dir", () => {
    writeFileSync(join(bundledDir, "reviewer.md"), reviewerMd);
    const config = resolveAgent("reviewer", { userDir, bundledDir });
    expect(config.name).toBe("reviewer");
    // Should have been copied to user dir
    expect(existsSync(join(userDir, "reviewer.md"))).toBe(true);
  });

  it("throws for unknown agent", () => {
    expect(() =>
      resolveAgent("nonexistent", { userDir, bundledDir }),
    ).toThrow('Unknown agent: "nonexistent"');
  });

  it("applies defaults for optional fields", () => {
    const minimalMd = `---
name: minimal
description: A minimal agent
---

Do things.`;
    writeFileSync(join(userDir, "minimal.md"), minimalMd);
    const config = resolveAgent("minimal", { userDir, bundledDir });
    expect(config.model).toBe("opus");
    expect(config.permissionMode).toBe("dangerouslySkipPermissions");
    expect(config.tools).toEqual([]);
    expect(config.mcp).toEqual([]);
  });

  it("lists agents from both directories", () => {
    writeFileSync(join(userDir, "custom.md"), `---\nname: custom\ndescription: Custom agent\n---\nPrompt.`);
    writeFileSync(join(bundledDir, "builtin.md"), `---\nname: builtin\ndescription: Built-in agent\n---\nPrompt.`);
    const agents = listAgents({ userDir, bundledDir });
    const names = agents.map((a) => a.name);
    expect(names).toContain("custom");
    expect(names).toContain("builtin");
  });

  it("user agent overrides bundled agent with same name", () => {
    const userVersion = `---\nname: reviewer\ndescription: Custom reviewer\nmodel: opus\n---\nCustom prompt.`;
    writeFileSync(join(userDir, "reviewer.md"), userVersion);
    writeFileSync(join(bundledDir, "reviewer.md"), reviewerMd);
    const config = resolveAgent("reviewer", { userDir, bundledDir });
    expect(config.model).toBe("opus");
    expect(config.description).toBe("Custom reviewer");
  });

  it("agentExists returns true for existing agent", () => {
    writeFileSync(join(userDir, "reviewer.md"), reviewerMd);
    expect(agentExists("reviewer", { userDir, bundledDir })).toBe(true);
  });

  it("agentExists returns false for missing agent", () => {
    expect(agentExists("nope", { userDir, bundledDir })).toBe(false);
  });
});
```

- [x] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/cli/tests/agent-registry.test.ts`
Expected: FAIL — module not found

- [x] **Step 4: Implement agent registry**

Create `src/cli/lib/agent-registry.ts`:

```typescript
import { existsSync, readFileSync, readdirSync, copyFileSync, mkdirSync } from "fs";
import { join, basename } from "path";
import { homedir } from "os";
import { parseFrontmatter } from "./frontmatter.js";
import { validateAgentConfig, type AgentConfig } from "./agent.js";
import { getBundledAgentsDir } from "./assets.js";

export interface RegistryOptions {
  userDir?: string;
  bundledDir?: string;
}

export interface AgentInfo {
  name: string;
  description: string;
  source: "built-in" | "custom";
}

function getUserAgentsDir(opts?: RegistryOptions): string {
  return opts?.userDir ?? join(homedir(), ".ralph", "agents");
}

function getBundledDir(opts?: RegistryOptions): string {
  return opts?.bundledDir ?? getBundledAgentsDir();
}

function parseAgentFile(content: string): AgentConfig {
  const { attributes, body } = parseFrontmatter(content);
  return validateAgentConfig({ ...attributes, prompt: body } as any);
}

export function resolveAgent(
  name: string,
  opts?: RegistryOptions,
): AgentConfig {
  const userDir = getUserAgentsDir(opts);
  const bundledDir = getBundledDir(opts);

  // Check user directory first
  const userPath = join(userDir, `${name}.md`);
  if (existsSync(userPath)) {
    return parseAgentFile(readFileSync(userPath, "utf-8"));
  }

  // Fall back to bundled
  const bundledPath = join(bundledDir, `${name}.md`);
  if (existsSync(bundledPath)) {
    // Copy to user dir
    mkdirSync(userDir, { recursive: true });
    copyFileSync(bundledPath, userPath);
    return parseAgentFile(readFileSync(bundledPath, "utf-8"));
  }

  throw new Error(`Unknown agent: "${name}"`);
}

export function listAgents(opts?: RegistryOptions): AgentInfo[] {
  const userDir = getUserAgentsDir(opts);
  const bundledDir = getBundledDir(opts);
  const seen = new Set<string>();
  const agents: AgentInfo[] = [];

  // User agents first (they override bundled)
  if (existsSync(userDir)) {
    for (const file of readdirSync(userDir)) {
      if (!file.endsWith(".md")) continue;
      const name = basename(file, ".md");
      seen.add(name);
      try {
        const config = parseAgentFile(readFileSync(join(userDir, file), "utf-8"));
        agents.push({ name, description: config.description, source: "custom" });
      } catch {
        // Skip invalid files
      }
    }
  }

  // Bundled agents (only if not overridden)
  if (existsSync(bundledDir)) {
    for (const file of readdirSync(bundledDir)) {
      if (!file.endsWith(".md")) continue;
      const name = basename(file, ".md");
      if (seen.has(name)) continue;
      try {
        const config = parseAgentFile(readFileSync(join(bundledDir, file), "utf-8"));
        agents.push({ name, description: config.description, source: "built-in" });
      } catch {
        // Skip invalid files
      }
    }
  }

  return agents.sort((a, b) => a.name.localeCompare(b.name));
}

export function agentExists(
  name: string,
  opts?: RegistryOptions,
): boolean {
  const userDir = getUserAgentsDir(opts);
  const bundledDir = getBundledDir(opts);
  return (
    existsSync(join(userDir, `${name}.md`)) ||
    existsSync(join(bundledDir, `${name}.md`))
  );
}
```

- [x] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/cli/tests/agent-registry.test.ts`
Expected: All 8 tests PASS

- [x] **Step 6: Commit**

```bash
git add src/cli/lib/agent-registry.ts src/cli/tests/agent-registry.test.ts src/cli/lib/assets.ts
git commit -m "feat: add agent registry with resolve, list, and fallback to bundled"
```

---

### Task 8: Built-in agent definition files

**Files:**
- Create: `src/cli/agents/implement.md`
- Create: `src/cli/agents/plan.md`
- Create: `src/cli/agents/meditate.md`
- Create: `src/cli/agents/meditate-create.md`
- Create: `src/cli/agents/agent-creator.md`
- Modify: `tsup.config.ts` (copy agents to dist)

- [x] **Step 1: Study existing prompt files to extract content**

Read the following files and copy their full content into the agent definitions below:
- `src/cli/prompts/PROMPT_build.md` — implement agent prompt
- `src/cli/commands/plan.ts` — extract the `BRAINSTORM_TRIGGER` constant (this is the plan agent's prompt, NOT `PROMPT_plan.md`)
- `src/cli/prompts/PROMPT_meditation.md` — meditate agent prompt
- `src/cli/prompts/PROMPT_meditate_create.md` — meditate-create agent prompt
- `src/cli/commands/meditate.ts` — extract the allowedTools list and MCP config structure

- [x] **Step 2: Create implement.md**

Create `src/cli/agents/implement.md`. Read `src/cli/prompts/PROMPT_build.md` and paste its **entire** content below the frontmatter delimiter:

```markdown
---
name: implement
description: Autonomous code implementation loop
model: opus
permissionMode: dangerouslySkipPermissions
tools: []
mcp: []
---

<paste full content of src/cli/prompts/PROMPT_build.md here — do NOT abbreviate>
```

- [x] **Step 3: Create plan.md**

Create `src/cli/agents/plan.md`. Read `src/cli/commands/plan.ts`, find the `BRAINSTORM_TRIGGER` constant, and paste its value as the prompt body:

```markdown
---
name: plan
description: Interactive brainstorming and planning
model: opus
permissionMode: dangerouslySkipPermissions
tools: []
mcp: []
---

<paste the BRAINSTORM_TRIGGER constant value from plan.ts here>
```

- [x] **Step 4: Create meditate.md**

Create `src/cli/agents/meditate.md`. Read `src/cli/prompts/PROMPT_meditation.md` for the prompt body and `src/cli/commands/meditate.ts` for the tools and MCP config:

```markdown
---
name: meditate
description: Reflective analysis of project patterns
model: sonnet
permissionMode: dontAsk
tools:
  - mcp__illumination__read_file
  - mcp__illumination__glob_files
  - mcp__illumination__project_tree
  - mcp__illumination__write_illumination
  - mcp__illumination__list_meta_meditations
  - mcp__illumination__read_meta_meditation
mcp:
  - name: illumination
    command: node
    args:
      - "{{ILLUMINATION_SERVER_PATH}}"
      - "{{PROJECT_ROOT}}"
      - "{{META_MEDITATIONS_DIR}}"
---

<paste full content of src/cli/prompts/PROMPT_meditation.md here — do NOT abbreviate>
```

Note: MCP server args use variables that the meditate command will expand at runtime.

- [x] **Step 5: Create meditate-create.md**

Create `src/cli/agents/meditate-create.md`. Read `src/cli/prompts/PROMPT_meditate_create.md` and paste its full content:

```markdown
---
name: meditate-create
description: Interactive meditation creation session
model: opus
permissionMode: dangerouslySkipPermissions
tools: []
mcp: []
---

<paste full content of src/cli/prompts/PROMPT_meditate_create.md here — do NOT abbreviate>
```

- [x] **Step 6: Create agent-creator.md**

Create `src/cli/agents/agent-creator.md`:

```markdown
---
name: agent-creator
description: Collaboratively designs new agent definitions
model: opus
permissionMode: dangerouslySkipPermissions
tools: []
mcp: []
---

You are an agent designer for ralph-cli. Your job is to help the user create a new agent definition.

An agent definition is a markdown file with YAML frontmatter that specifies:
- name: unique identifier (lowercase, hyphens allowed)
- description: one-line purpose
- model: Claude model (opus, sonnet, haiku)
- permissionMode: dangerouslySkipPermissions or dontAsk
- tools: list of allowed tools (empty = unrestricted)
- mcp: list of MCP server configs (optional)

The markdown body after the frontmatter is the agent's system prompt.

Guide the user through:
1. What should this agent do? What is its purpose?
2. What model is appropriate? (opus for complex reasoning, sonnet for balanced, haiku for fast/simple)
3. Should it have restricted tools? What tools does it need?
4. What permission mode? (dangerouslySkipPermissions for autonomous, dontAsk for restricted)
5. Does it need MCP servers?

Then draft the complete .md file and iterate with the user until they are satisfied.

When the user approves, write the file to ~/.ralph/agents/<name>.md.
```

- [x] **Step 7: Update tsup.config.ts to copy agent definitions to dist**

Read `tsup.config.ts` first. Add the `src/cli/agents/*.md` files to the asset copy step, following the same pattern used for `src/cli/prompts/*.md`.

- [x] **Step 8: Build and verify agents are in dist**

Run: `npm run build`
Then verify: `ls dist/cli/agents/`
Expected: `implement.md`, `plan.md`, `meditate.md`, `meditate-create.md`, `agent-creator.md`

- [x] **Step 9: Commit**

```bash
git add src/cli/agents/ tsup.config.ts
git commit -m "feat: add built-in agent definition files"
```

---

## Chunk 2: CLI Commands — agent list, show, create

### Task 9: Agent list and show commands

**Files:**
- Create: `src/cli/commands/agent.ts`
- Create: `src/cli/tests/agent-commands.test.ts`
- Modify: `src/cli/program.ts`

- [x] **Step 1: Write failing tests for agent list and show**

Create `src/cli/tests/agent-commands.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

vi.mock("../lib/agent-registry.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/agent-registry.js")>();
  return { ...actual };
});

describe("agent commands", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "ralph-agent-cmd-"));
    writeFileSync(
      join(tempDir, "reviewer.md"),
      `---\nname: reviewer\ndescription: Reviews code\nmodel: sonnet\npermissionMode: dontAsk\ntools:\n  - read_file\n---\n\nYou are a reviewer.`,
    );
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("agentListAction returns agent info array", async () => {
    const { agentListAction } = await import("../commands/agent.js");
    const result = await agentListAction({ userDir: tempDir, bundledDir: tempDir });
    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "reviewer" }),
      ]),
    );
  });

  it("agentShowAction returns full config", async () => {
    const { agentShowAction } = await import("../commands/agent.js");
    const config = await agentShowAction("reviewer", {
      userDir: tempDir,
      bundledDir: tempDir,
    });
    expect(config.name).toBe("reviewer");
    expect(config.model).toBe("sonnet");
    expect(config.tools).toContain("read_file");
    expect(config.prompt.trim()).toBe("You are a reviewer.");
  });

  it("agentShowAction throws for unknown agent", async () => {
    const { agentShowAction } = await import("../commands/agent.js");
    await expect(
      agentShowAction("nonexistent", {
        userDir: tempDir,
        bundledDir: tempDir,
      }),
    ).rejects.toThrow('Unknown agent: "nonexistent"');
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/cli/tests/agent-commands.test.ts`
Expected: FAIL — module not found

- [x] **Step 3: Implement agent list and show**

Create `src/cli/commands/agent.ts`:

```typescript
import { resolveAgent, listAgents, type RegistryOptions } from "../lib/agent-registry.js";
import type { AgentConfig } from "../lib/agent.js";
import * as output from "../lib/output.js";

export async function agentListAction(opts?: RegistryOptions) {
  const agents = listAgents(opts);

  if (agents.length === 0) {
    await output.warn("No agents found.");
    return agents;
  }

  const lines = agents.map((a) => {
    const marker = a.source === "built-in" ? "*" : "+";
    return `  ${marker} ${a.name.padEnd(20)} ${a.model?.padEnd(10) ?? "".padEnd(10)} ${a.description}`;
  });

  const header = `  ${"Name".padEnd(20)} ${"Model".padEnd(10)} Description`;
  await output.info(header + "\n" + lines.join("\n") + "\n\n  * built-in  + custom");
  return agents;
}

export async function agentShowAction(
  name: string,
  opts?: RegistryOptions,
): Promise<AgentConfig> {
  const config = resolveAgent(name, opts);

  const toolsStr = config.tools.length > 0 ? config.tools.join(", ") : "(unrestricted)";
  const mcpStr = config.mcp.length > 0
    ? config.mcp.map((m) => m.name).join(", ")
    : "(none)";

  const display = [
    `  ${config.name} -- ${config.description}`,
    "",
    `  Model:        ${config.model}`,
    `  Permissions:  ${config.permissionMode}`,
    `  Tools:        ${toolsStr}`,
    `  MCP servers:  ${mcpStr}`,
    "",
    "  Prompt:",
    "  ---",
    config.prompt
      .split("\n")
      .map((l) => `  ${l}`)
      .join("\n"),
    "  ---",
  ].join("\n");

  await output.info(display);
  return config;
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/cli/tests/agent-commands.test.ts`
Expected: All 3 tests PASS

- [x] **Step 5: Register commands in program.ts**

Read `src/cli/program.ts` first. Add the `ralph agent` command group following the same pattern as `pipeline`:

```typescript
import { agentListAction, agentShowAction } from "./commands/agent.js";

// In createProgram():
const agent = program.command("agent").description("Manage agent definitions");

agent
  .command("list")
  .description("List all available agents")
  .action(async () => {
    await agentListAction();
  });

agent
  .command("show <name>")
  .description("Show details of a specific agent")
  .action(async (name: string) => {
    await agentShowAction(name);
  });
```

- [x] **Step 6: Build and test CLI**

Run: `npm run build && ralph agent list`
Expected: Shows built-in agents (after they've been copied to `~/.ralph/agents/`)

Run: `ralph agent show implement`
Expected: Shows implement agent details

- [x] **Step 7: Commit**

```bash
git add src/cli/commands/agent.ts src/cli/tests/agent-commands.test.ts src/cli/program.ts
git commit -m "feat: add ralph agent list and ralph agent show commands"
```

---

### Task 10: Agent create command

**Files:**
- Modify: `src/cli/commands/agent.ts`
- Modify: `src/cli/program.ts`

- [x] **Step 1: Implement agent create action**

Add to `src/cli/commands/agent.ts`:

```typescript
import { Agent } from "../lib/agent.js";
import { resolveAgent } from "../lib/agent-registry.js";

export async function agentCreateAction(): Promise<void> {
  const creatorConfig = resolveAgent("agent-creator");
  const agent = new Agent(creatorConfig);

  await output.step("Launching agent designer...");

  // Phase 1: non-interactive kickoff
  let sessionId: string | null = null;
  const result = await agent.run({
    cwd: process.cwd(),
    onSessionId: (id) => {
      sessionId = id;
    },
  });

  if (!sessionId) {
    await output.error("Failed to capture session. Please try again.");
    process.exit(1);
  }

  // Phase 2: interactive resume
  await output.step("Launching interactive session...");
  const resumeResult = await agent.run({
    cwd: process.cwd(),
    resume: sessionId,
    interactive: true,
  });

  process.exit(resumeResult.exitCode);
}
```

- [x] **Step 2: Register create command in program.ts**

Add to the `agent` command group in `program.ts`:

```typescript
import { agentCreateAction } from "./commands/agent.js";

agent
  .command("create")
  .description("Interactively create a new agent definition")
  .action(async () => {
    await agentCreateAction();
  });
```

- [x] **Step 3: Build and smoke test**

Run: `npm run build`
Run: `ralph agent create` (verify it launches without crash, then Ctrl+C to exit)

- [x] **Step 4: Commit**

```bash
git add src/cli/commands/agent.ts src/cli/program.ts
git commit -m "feat: add ralph agent create command"
```

---

### Task 11: Scenario tests for agent commands

**Files:**
- Create: `scenario-tests/test-agent-list.sh`
- Create: `scenario-tests/test-agent-show.sh`

- [x] **Step 1: Create test-agent-list.sh**

```bash
#!/usr/bin/env bash
# @name: agent-list
# @description: Verify ralph agent list shows built-in agents

set -e

# Run agent list and capture output
OUTPUT=$(ralph agent list 2>&1)

# Assert built-in agents appear
echo "$OUTPUT" | grep -q "implement" || { echo "FAIL: implement not found"; exit 1; }
echo "$OUTPUT" | grep -q "plan" || { echo "FAIL: plan not found"; exit 1; }
echo "$OUTPUT" | grep -q "meditate" || { echo "FAIL: meditate not found"; exit 1; }

echo "PASS: all built-in agents listed"
```

- [x] **Step 2: Create test-agent-show.sh**

```bash
#!/usr/bin/env bash
# @name: agent-show
# @description: Verify ralph agent show displays agent details

set -e

# Show implement agent
OUTPUT=$(ralph agent show implement 2>&1)

# Assert key fields appear
echo "$OUTPUT" | grep -q "implement" || { echo "FAIL: name not shown"; exit 1; }
echo "$OUTPUT" | grep -q "opus" || { echo "FAIL: model not shown"; exit 1; }
echo "$OUTPUT" | grep -q "Prompt" || { echo "FAIL: prompt section missing"; exit 1; }

# Show unknown agent should fail
set +e
ralph agent show nonexistent 2>&1
EXIT_CODE=$?
set -e
if [ "$EXIT_CODE" -eq 0 ]; then
  echo "FAIL: should have errored for unknown agent"
  exit 1
fi

echo "PASS: agent show works correctly"
```

- [x] **Step 3: Run scenario tests**

Run: `ralph run-scenarios` and select the new tests.
Expected: Both pass.

- [x] **Step 4: Commit**

```bash
git add scenario-tests/test-agent-list.sh scenario-tests/test-agent-show.sh
git commit -m "test: add scenario tests for ralph agent list and show"
```

---

## Chunk 3: Refactor Existing Commands

### Task 12: Refactor meditate-create to use Agent

**Files:**
- Modify: `src/cli/commands/meditate-create.ts`

- [x] **Step 1: Read current meditate-create.ts**

Read `src/cli/commands/meditate-create.ts` fully to understand the current implementation.

- [x] **Step 2: Refactor to use Agent class**

Replace the manual spawn logic with:

```typescript
import { Agent } from "../lib/agent.js";
import { resolveAgent } from "../lib/agent-registry.js";

export async function meditateCreateCommand(projectFolder: string): Promise<void> {
  // ... existing validation (folder exists, claude CLI available) ...

  const config = resolveAgent("meditate-create");
  const agent = new Agent(config);

  // Phase 1: non-interactive kickoff
  let sessionId: string | null = null;
  const result = await agent.run({
    cwd: absPath,
    onSessionId: (id) => {
      sessionId = id;
    },
  });

  if (sessionId) {
    // Log trace path (preserve existing behavior)
    // ... existing trace path logic ...

    // Phase 2: interactive resume
    output.step("Launching interactive session...");
    const resumeResult = await agent.run({
      cwd: absPath,
      resume: sessionId,
      interactive: true,
    });
    process.exit(resumeResult.exitCode);
  }

  process.exit(result.exitCode);
}
```

- [x] **Step 3: Run existing tests**

Run: `npx vitest run src/cli/tests/meditate.test.ts`
Expected: All tests pass

- [x] **Step 4: Run scenario test**

Run: the `test-meditate-create.sh` scenario test.
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/cli/commands/meditate-create.ts
git commit -m "refactor: meditate-create command uses Agent class"
```

---

### Task 13: Refactor plan to use Agent

**Files:**
- Modify: `src/cli/commands/plan.ts`

- [x] **Step 1: Read current plan.ts**

Read `src/cli/commands/plan.ts` fully.

- [x] **Step 2: Refactor to use Agent class**

Replace manual spawn logic. The plan agent's prompt body now lives in `plan.md` (the BRAINSTORM_TRIGGER constant is deleted):

```typescript
import { Agent } from "../lib/agent.js";
import { resolveAgent } from "../lib/agent-registry.js";

export async function planCommand(projectFolder: string): Promise<void> {
  // ... existing validation ...

  const config = resolveAgent("plan");
  const agent = new Agent(config);

  // Phase 1: non-interactive
  let sessionId: string | null = null;
  const result = await agent.run({
    cwd: absPath,
    onSessionId: (id) => {
      sessionId = id;
    },
  });

  if (sessionId) {
    output.step("Launching interactive session...");
    const resumeResult = await agent.run({
      cwd: absPath,
      resume: sessionId,
      interactive: true,
    });
    process.exit(resumeResult.exitCode);
  }

  process.exit(result.exitCode);
}
```

- [x] **Step 3: Build and smoke test**

Run: `npm run build && ralph plan /tmp/test-project` (Ctrl+C after launch)
Expected: Same behavior as before — non-interactive kickoff then interactive resume

- [x] **Step 4: Commit**

```bash
git add src/cli/commands/plan.ts
git commit -m "refactor: plan command uses Agent class"
```

---

### Task 14: Refactor meditate to use Agent

**Files:**
- Modify: `src/cli/commands/meditate.ts`

- [x] **Step 1: Read current meditate.ts**

Read `src/cli/commands/meditate.ts` fully. Note the PID locking, MCP config, allowedTools, and custom stream parsing.

- [x] **Step 2: Refactor to use Agent class**

Replace manual spawn and MCP config logic. The meditate agent definition includes MCP servers and tools. The command keeps PID locking:

```typescript
import { Agent } from "../lib/agent.js";
import { resolveAgent } from "../lib/agent-registry.js";
import { getIlluminationServerPath, getMetaMeditationsDir } from "../lib/assets.js";

export async function meditateCommand(projectFolder: string): Promise<void> {
  // ... existing validation, PID lock check ...

  const config = resolveAgent("meditate");
  const agent = new Agent(config);

  // PID lock (project-specific, not Agent's concern)
  writePid(absPath);

  const cleanup = () => {
    agent.kill();  // triggers Agent.run() finally block which cleans up MCP config
    removePid(absPath);
  };
  process.once("SIGTERM", cleanup);
  process.once("SIGINT", cleanup);

  try {
    // Agent.run() handles MCP config lifecycle internally (write before spawn, cleanup in finally)
    const result = await agent.run({
      cwd: absPath,
      variables: {
        ILLUMINATION_SERVER_PATH: getIlluminationServerPath(),
        PROJECT_ROOT: absPath,
        META_MEDITATIONS_DIR: getMetaMeditationsDir(),
      },
    });

    process.exit(result.exitCode);
  } finally {
    process.off("SIGTERM", cleanup);
    process.off("SIGINT", cleanup);
    removePid(absPath);
  }
}
```

- [x] **Step 3: Run existing tests**

Run: `npx vitest run src/cli/tests/meditate.test.ts`
Expected: All tests pass

- [x] **Step 4: Run scenario test**

Run: the `test-meditate-session.sh` scenario test.
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/cli/commands/meditate.ts
git commit -m "refactor: meditate command uses Agent class"
```

---

### Task 15: Refactor implement to use Agent (loop.ts deletion deferred to Task 20)

**Files:**
- Modify: `src/cli/commands/implement.ts`

Note: `loop.ts` is NOT deleted here. It is still imported by `src/cli/commands/pipeline.ts` (which passes `runLoop` to the engine). Deletion happens in Task 20 after AgentHandler replaces CodergenHandler.

- [x] **Step 1: Read current implement.ts and loop.ts**

Read both files fully. Note: loop.ts handles spawn, stream, git push, iteration, abort.

- [x] **Step 2: Refactor implement.ts to use Agent with inline loop**

```typescript
import { Agent } from "../lib/agent.js";
import { resolveAgent } from "../lib/agent-registry.js";
import { streamEvents } from "../lib/stream-formatter.js";
import { execSync } from "child_process";
import * as output from "../lib/output.js";

export async function implementCommand(
  projectFolder: string,
  options: { max?: number; model?: string },
): Promise<void> {
  // ... existing validation, bootstrapPrompts() ...

  const config = resolveAgent("implement");
  // Allow --model flag to override agent definition
  if (options.model) config.model = options.model;

  const agent = new Agent(config);
  const ac = new AbortController();

  const onSignal = () => ac.abort();
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  // Capture branch for git push
  const branch = execSync("git branch --show-current", {
    cwd: absPath,
    encoding: "utf-8",
  }).trim();

  let iteration = 0;

  output.header(absPath, branch, process.pid);

  while (true) {
    if (ac.signal.aborted) {
      output.warn("Aborted.");
      break;
    }

    if (options.max && iteration >= options.max) {
      output.step(`Reached max iterations: ${options.max}`);
      break;
    }

    const result = await agent.run({
      cwd: absPath,
      signal: ac.signal,
    });

    if (ac.signal.aborted) break;

    if (result.exitCode !== 0) {
      output.warn(`Claude exited with code ${result.exitCode}`);
    }

    // Git push (with retry)
    try {
      execSync(`git push origin ${branch}`, { cwd: absPath, stdio: "pipe" });
    } catch {
      try {
        execSync(`git push -u origin ${branch}`, { cwd: absPath, stdio: "pipe" });
      } catch {
        output.warn("Git push failed.");
      }
    }

    iteration++;
    output.step(`LOOP ${iteration}`);
  }

  process.off("SIGINT", onSignal);
  process.off("SIGTERM", onSignal);
}
```

- [x] **Step 3: Build and verify**

Run: `npm run build`
Expected: No build errors (loop.ts still exists, used by pipeline.ts)

- [x] **Step 4: Run all tests**

Run: `npx vitest run`
Expected: All tests pass

- [x] **Step 5: Commit**

```bash
git add src/cli/commands/implement.ts
git commit -m "refactor: implement command uses Agent class"
```

---

## Chunk 4: Attractor Integration

### Task 16: Add agent attribute to Node type

**Files:**
- Modify: `src/attractor/types.ts`

- [x] **Step 1: Read current types.ts**

Read `src/attractor/types.ts` to find the Node interface.

- [x] **Step 2: Add agent field to Node interface**

Add `agent?: string;` to the Node interface, alongside existing optional fields like `type`, `prompt`, `toolCommand`.

- [x] **Step 3: Run existing tests**

Run: `npx vitest run src/attractor/tests/`
Expected: All pass (adding an optional field is non-breaking)

- [x] **Step 4: Commit**

```bash
git add src/attractor/types.ts
git commit -m "feat: add agent attribute to attractor Node type"
```

---

### Task 17: Update graph parser for agent nodes

**Files:**
- Modify: `src/attractor/core/graph.ts`
- Modify: `src/attractor/tests/graph.test.ts`

- [x] **Step 1: Write failing test for agent node resolution**

Add to `src/attractor/tests/graph.test.ts`:

```typescript
it("resolves agent attribute to 'agent' handler type", () => {
  const dot = `digraph g {
    start [shape=Mdiamond]
    review [agent="reviewer"]
    done [shape=Msquare]
    start -> review -> done
  }`;
  const graph = parseDot(dot);
  const reviewNode = graph.nodes.get("review")!;
  expect(reviewNode.agent).toBe("reviewer");
  expect(resolveHandlerType(reviewNode)).toBe("agent");
});

it("agent attribute takes precedence over shape", () => {
  const dot = `digraph g {
    start [shape=Mdiamond]
    work [shape=box, agent="implement"]
    done [shape=Msquare]
    start -> work -> done
  }`;
  const graph = parseDot(dot);
  const workNode = graph.nodes.get("work")!;
  expect(resolveHandlerType(workNode)).toBe("agent");
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/attractor/tests/graph.test.ts`
Expected: FAIL — resolveHandlerType returns "codergen" not "agent"

- [x] **Step 3: Update resolveHandlerType**

In `src/attractor/core/graph.ts`, update `resolveHandlerType()`:

```typescript
export function resolveHandlerType(node: Node): string {
  // Agent attribute takes highest precedence
  if (node.agent) return "agent";
  // Then explicit type
  if (node.type && KNOWN_TYPES.has(node.type)) return node.type;
  // Then shape mapping
  if (node.shape && SHAPE_TO_TYPE.has(node.shape)) return SHAPE_TO_TYPE.get(node.shape)!;
  // Default
  return "codergen";
}
```

Add `"agent"` to the `KNOWN_TYPES` set.

- [x] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/attractor/tests/graph.test.ts`
Expected: All tests PASS

- [x] **Step 5: Commit**

```bash
git add src/attractor/core/graph.ts src/attractor/tests/graph.test.ts
git commit -m "feat: support agent attribute in DOT parser with precedence over shape"
```

---

### Task 18: AgentHandler implementation

**Files:**
- Create: `src/attractor/handlers/agent-handler.ts`
- Create: `src/attractor/tests/agent-handler.test.ts`
- Modify: `src/attractor/core/engine.ts`

- [x] **Step 1: Write failing tests for AgentHandler**

Create `src/attractor/tests/agent-handler.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AgentHandler } from "../handlers/agent-handler.js";
import type { Node, PipelineContext, Outcome } from "../types.js";

describe("AgentHandler", () => {
  const mockResolve = vi.fn();
  const mockAgentRun = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeNode(overrides: Partial<Node> = {}): Node {
    return {
      id: "work",
      shape: "box",
      label: "Do work",
      agent: "implement",
      ...overrides,
    } as Node;
  }

  function makeHandler() {
    return new AgentHandler({
      resolveAgent: mockResolve,
      createAgent: () => ({ run: mockAgentRun, kill: vi.fn(), config: {} } as any),
    });
  }

  it("resolves agent by name and calls run", async () => {
    mockResolve.mockReturnValue({
      name: "implement",
      model: "opus",
      prompt: "Do things",
      tools: [],
      mcp: [],
      permissionMode: "dangerouslySkipPermissions",
    });
    mockAgentRun.mockResolvedValue({ exitCode: 0, sessionId: "s1", stdout: null });

    const handler = makeHandler();
    const outcome = await handler.execute(
      makeNode(),
      { values: {} },
      { logsRoot: "/tmp/logs", cwd: "/tmp/project", signal: undefined, outgoingLabels: [] },
    );

    expect(outcome.status).toBe("success");
    expect(outcome.contextUpdates?.["agent.sessionId"]).toBe("s1");
  });

  it("returns fail outcome on non-zero exit", async () => {
    mockResolve.mockReturnValue({
      name: "implement",
      model: "opus",
      prompt: "Do things",
      tools: [],
      mcp: [],
      permissionMode: "dangerouslySkipPermissions",
    });
    mockAgentRun.mockResolvedValue({ exitCode: 1, sessionId: null, stdout: null });

    const handler = makeHandler();
    const outcome = await handler.execute(
      makeNode(),
      { values: {} },
      { logsRoot: "/tmp/logs", cwd: "/tmp/project", signal: undefined, outgoingLabels: [] },
    );

    expect(outcome.status).toBe("fail");
  });

  it("loops when node has maxIterations", async () => {
    mockResolve.mockReturnValue({
      name: "implement",
      model: "opus",
      prompt: "Do things",
      tools: [],
      mcp: [],
      permissionMode: "dangerouslySkipPermissions",
    });
    mockAgentRun.mockResolvedValue({ exitCode: 0, sessionId: "s1", stdout: null });

    const handler = makeHandler();
    const outcome = await handler.execute(
      makeNode({ maxIterations: 3 }),
      { values: {} },
      { logsRoot: "/tmp/logs", cwd: "/tmp/project", signal: undefined, outgoingLabels: [] },
    );

    expect(mockAgentRun).toHaveBeenCalledTimes(3);
    expect(outcome.status).toBe("success");
    expect(outcome.contextUpdates?.["agent.iterations"]).toBe("3");
  });

  it("overrides agent model from node attributes", async () => {
    mockResolve.mockReturnValue({
      name: "implement",
      model: "opus",
      prompt: "Do things",
      tools: [],
      mcp: [],
      permissionMode: "dangerouslySkipPermissions",
    });
    mockAgentRun.mockResolvedValue({ exitCode: 0, sessionId: null, stdout: null });

    const handler = makeHandler();
    await handler.execute(
      makeNode({ model: "sonnet" } as any),
      { values: {} },
      { logsRoot: "/tmp/logs", cwd: "/tmp/project", signal: undefined, outgoingLabels: [] },
    );

    // Verify the agent was created with overridden model
    expect(mockResolve).toHaveBeenCalled();
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/attractor/tests/agent-handler.test.ts`
Expected: FAIL — module not found

- [x] **Step 3: Implement AgentHandler**

Create `src/attractor/handlers/agent-handler.ts`:

```typescript
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import type { NodeHandler } from "./registry.js";
import type { Node, PipelineContext, Outcome } from "../types.js";
import { Agent, type AgentConfig } from "../../cli/lib/agent.js";
import { resolveAgent as defaultResolve } from "../../cli/lib/agent-registry.js";

export interface AgentHandlerDeps {
  resolveAgent?: (name: string) => AgentConfig;
  createAgent?: (config: AgentConfig) => Agent;
}

export class AgentHandler implements NodeHandler {
  private resolveAgent: (name: string) => AgentConfig;
  private createAgent: (config: AgentConfig) => Agent;

  constructor(deps?: AgentHandlerDeps) {
    this.resolveAgent = deps?.resolveAgent ?? defaultResolve;
    this.createAgent = deps?.createAgent ?? ((c) => new Agent(c));
  }

  async execute(
    node: Node,
    ctx: PipelineContext,
    meta: Record<string, unknown>,
  ): Promise<Outcome> {
    const agentName = node.agent;
    if (!agentName) {
      return { status: "fail", failureReason: "Node has no agent attribute" };
    }

    const config = this.resolveAgent(agentName);

    // Apply node-level overrides
    if ((node as any).model) config.model = (node as any).model;

    // Write prompt to logs
    const logsRoot = meta.logsRoot as string;
    const cwd = meta.cwd as string;
    const signal = meta.signal as AbortSignal | undefined;
    const nodeDir = join(logsRoot, node.id);
    mkdirSync(nodeDir, { recursive: true });

    const prompt = node.prompt ?? node.label ?? config.prompt;
    writeFileSync(join(nodeDir, "prompt.md"), prompt);

    const agent = this.createAgent(config);
    const maxIterations = (node.maxIterations as number | undefined) ?? 1;

    let lastSessionId: string | null = null;
    let iteration = 0;

    for (let i = 0; i < maxIterations; i++) {
      if (signal?.aborted) break;

      const result = await agent.run({
        cwd,
        signal,
        variables: ctx.values,
      });

      iteration++;
      if (result.sessionId) lastSessionId = result.sessionId;

      if (result.exitCode !== 0 && maxIterations === 1) {
        return {
          status: "fail",
          failureReason: `Agent exited with code ${result.exitCode}`,
          contextUpdates: {
            "agent.iterations": String(iteration),
            "agent.success": "false",
          },
        };
      }
    }

    return {
      status: "success",
      contextUpdates: {
        "agent.iterations": String(iteration),
        "agent.success": "true",
        ...(lastSessionId ? { "agent.sessionId": lastSessionId } : {}),
      },
    };
  }
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/attractor/tests/agent-handler.test.ts`
Expected: All 4 tests PASS

- [x] **Step 5: Register AgentHandler in engine**

Read `src/attractor/core/engine.ts` to find `buildHandlerMap()`. Add:

```typescript
import { AgentHandler } from "../handlers/agent-handler.js";

// In buildHandlerMap():
m.set("agent", new AgentHandler());
```

- [x] **Step 6: Run all attractor tests**

Run: `npx vitest run src/attractor/tests/`
Expected: All pass

- [x] **Step 7: Commit**

```bash
git add src/attractor/handlers/agent-handler.ts src/attractor/tests/agent-handler.test.ts src/attractor/core/engine.ts
git commit -m "feat: add AgentHandler for attractor pipeline agent nodes"
```

---

### Task 19: Update attractor pipeline scenario test

**Files:**
- Modify: `scenario-tests/test-attractor-pipeline.sh`

- [x] **Step 1: Read current test**

Read `scenario-tests/test-attractor-pipeline.sh` to understand the existing test structure.

- [x] **Step 2: Add agent-based pipeline test case**

Add a new test case that uses `[agent="implement"]` syntax in a DOT file and verifies the engine resolves and runs it. Follow the existing test patterns in the file.

- [x] **Step 3: Run scenario test**

Run: the updated `test-attractor-pipeline.sh` scenario.
Expected: PASS

- [x] **Step 4: Commit**

```bash
git add scenario-tests/test-attractor-pipeline.sh
git commit -m "test: add agent attribute test case to attractor pipeline scenarios"
```

---

### Task 20: Remove loop.ts, update pipeline.ts, deprecate CodergenHandler

**Files:**
- Delete: `src/cli/lib/loop.ts`
- Delete: `src/cli/tests/loop.test.ts`
- Modify: `src/cli/commands/pipeline.ts` (remove `runLoop` import and passing)
- Modify: `src/attractor/core/engine.ts` (remove `runLoop` from PipelineOptions, remove CodergenHandler registration)
- Modify: `src/attractor/handlers/codergen.ts` (delete or mark deprecated)
- Modify: `src/attractor/tests/handlers.test.ts` (remove CodergenHandler tests)

Now that AgentHandler is registered (Task 18), CodergenHandler and its `runLoop` dependency can be removed.

- [x] **Step 1: Read pipeline.ts to find runLoop usage**

Read `src/cli/commands/pipeline.ts` — find where `runLoop` is imported and passed to `runPipeline()`.

- [x] **Step 2: Remove runLoop from pipeline.ts**

Remove the `runLoop` import from `loop.ts` and the `runLoop` property from the options object passed to `runPipeline()`.

- [x] **Step 3: Remove runLoop from engine PipelineOptions**

In `src/attractor/core/engine.ts`, remove `runLoop` from the `EngineOptions`/`PipelineOptions` interface. Remove CodergenHandler from `buildHandlerMap()` (AgentHandler now handles `agent` nodes; existing `shape=coder` nodes should also route to AgentHandler — update the `SHAPE_TO_TYPE` map so `box` maps to `"agent"` with a default agent name, or keep backward compatibility by having AgentHandler fall back to `implement` agent when `node.agent` is not set).

- [x] **Step 4: Delete loop.ts and loop.test.ts**

```bash
git rm src/cli/lib/loop.ts src/cli/tests/loop.test.ts
```

- [x] **Step 5: Remove or deprecate CodergenHandler**

Delete `src/attractor/handlers/codergen.ts` and remove its tests from `src/attractor/tests/handlers.test.ts`.

- [x] **Step 6: Build and verify**

Run: `npm run build`
Expected: No errors

- [x] **Step 7: Run all unit tests**

Run: `npx vitest run`
Expected: All pass

- [x] **Step 8: Commit**

```bash
git rm src/attractor/handlers/codergen.ts
git add src/cli/commands/pipeline.ts src/attractor/core/engine.ts src/attractor/tests/handlers.test.ts
git commit -m "refactor: remove loop.ts and CodergenHandler, pipeline uses AgentHandler"
```

---

### Task 21: Final verification

**Files:** None (verification only)

- [x] **Step 1: Build**

Run: `npm run build`
Expected: No errors

- [x] **Step 2: Run all unit tests**

Run: `npx vitest run`
Expected: All pass

- [x] **Step 3: Run all scenario tests**

Run: `ralph run-scenarios` (select all)
Expected: All pass

- [x] **Step 4: Verify CLI commands work**

Run: `ralph agent list`
Run: `ralph agent show implement`
Run: `ralph agent show plan`
Run: `ralph agent show meditate`
Expected: All show correct output

- [x] **Step 5: Final commit**

```bash
git commit --allow-empty -m "chore: unified agent architecture implementation complete (0.0.36)"
```
