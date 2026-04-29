import { describe, it, expect, vi, beforeEach } from "vitest";
import { AgentHandler } from "../handlers/agent-handler.js";
import type { HandlerExecutionContext } from "../handlers/registry.js";
import type { Node, PipelineContext } from "../types.js";

const baseCtx = (): PipelineContext => ({ values: {} });
function makeContext(overrides: Partial<HandlerExecutionContext> = {}): HandlerExecutionContext {
  return { logsRoot: "/tmp/logs", cwd: "/tmp/project", dotDir: "/tmp/project", outgoingLabels: [], completedNodes: [], nodeRetries: {}, ...overrides };
}

const streamJsonResult = (result: object): string => JSON.stringify([
  { type: "system", subtype: "init", session_id: "s-1" },
  { type: "result", subtype: "success", result: JSON.stringify(result) },
]);

const loopBaseConfig = {
  name: "looper",
  description: "x",
  model: "opus",
  prompt: "Do things",
  tools: [] as string[],
  mcp: [] as any[],
  permissionMode: "dangerouslySkipPermissions",

  loop: true,
  outputs: { done: "boolean" },
  jsonSchema: JSON.stringify({
    type: "object",
    properties: { done: { type: "boolean" } },
    required: ["done"],
    additionalProperties: false,
  }),
};

describe("AgentHandler deep loop — done break", () => {
  const mockResolve = vi.fn();
  const mockAgentRun = vi.fn();

  function makeHandler() {
    return new AgentHandler({
      resolveAgent: mockResolve,
      createAgent: () => ({ run: mockAgentRun, kill: vi.fn(), config: {} } as any),
    });
  }

  function makeNode(overrides: Partial<Node> = {}): Node {
    return { id: "deep", shape: "box", label: "Deep work", agent: "looper", ...overrides } as Node;
  }

  beforeEach(() => { vi.clearAllMocks(); });

  it("breaks on iteration 3 of cap=10 when done=true emitted", async () => {
    mockResolve.mockReturnValue({ ...loopBaseConfig });
    let i = 0;
    mockAgentRun.mockImplementation(async () => {
      i++;
      return {
        exitCode: 0, sessionId: `s${i}`, stdout: null,
        output: streamJsonResult({ done: i >= 3 }),
      };
    });

    const handler = makeHandler();
    const outcome = await handler.execute(
      makeNode({ maxIterations: 10 }),
      baseCtx(),
      makeContext(),
    );
    expect(mockAgentRun).toHaveBeenCalledTimes(3);
    expect(outcome.status).toBe("success");
    expect(outcome.contextUpdates?.["deep.done"]).toBe("true");
    expect(outcome.contextUpdates?.["deep.iterations"]).toBe("3");
  });

  it("runs to cap when done never emits true", async () => {
    mockResolve.mockReturnValue({ ...loopBaseConfig });
    mockAgentRun.mockResolvedValue({
      exitCode: 0, sessionId: "s", stdout: null,
      output: streamJsonResult({ done: false }),
    });

    const handler = makeHandler();
    const outcome = await handler.execute(
      makeNode({ maxIterations: 5 }),
      baseCtx(),
      makeContext(),
    );
    expect(mockAgentRun).toHaveBeenCalledTimes(5);
    expect(outcome.status).toBe("success");
    expect(outcome.contextUpdates?.["deep.done"]).toBe("false");
  });

  it("agent.success=true when loop terminates via done", async () => {
    mockResolve.mockReturnValue({ ...loopBaseConfig });
    mockAgentRun.mockResolvedValue({
      exitCode: 0, sessionId: "s", stdout: null,
      output: streamJsonResult({ done: true }),
    });

    const handler = makeHandler();
    const outcome = await handler.execute(
      makeNode({ maxIterations: 5 }),
      baseCtx(),
      makeContext(),
    );
    expect(outcome.contextUpdates?.["deep.success"]).toBe("true");
  });
});

describe("AgentHandler deep loop — crash mid-iteration", () => {
  const mockResolve = vi.fn();
  const mockAgentRun = vi.fn();

  function makeHandler() {
    return new AgentHandler({
      resolveAgent: mockResolve,
      createAgent: () => ({ run: mockAgentRun, kill: vi.fn(), config: {} } as any),
    });
  }
  function makeNode(overrides: Partial<Node> = {}): Node {
    return { id: "deep", shape: "box", label: "x", agent: "looper", ...overrides } as Node;
  }

  beforeEach(() => { vi.clearAllMocks(); });

  it("exits loop with agent.success=false when iteration 2 crashes (deep-loop mode)", async () => {
    mockResolve.mockReturnValue({ ...loopBaseConfig });
    let i = 0;
    mockAgentRun.mockImplementation(async () => {
      i++;
      if (i === 2) return { exitCode: 137, sessionId: "s2", stdout: null, output: "" };
      return {
        exitCode: 0, sessionId: `s${i}`, stdout: null,
        output: streamJsonResult({ done: false }),
      };
    });

    const handler = makeHandler();
    const outcome = await handler.execute(
      makeNode({ maxIterations: 5 }),
      baseCtx(),
      makeContext(),
    );
    expect(outcome.status).toBe("fail");
    expect(mockAgentRun).toHaveBeenCalledTimes(2);
    expect(outcome.contextUpdates?.["deep.success"]).toBe("false");
  });

  it("non-loop agent (loop:false) — single iteration crash still fails (regression)", async () => {
    mockResolve.mockReturnValue({
      ...loopBaseConfig,
      loop: undefined,
      outputs: undefined,
      jsonSchema: undefined,
    });
    mockAgentRun.mockResolvedValue({ exitCode: 1, sessionId: null, stdout: null });

    const handler = makeHandler();
    const outcome = await handler.execute(
      makeNode(),
      baseCtx(),
      makeContext(),
    );
    expect(outcome.status).toBe("fail");
    expect(mockAgentRun).toHaveBeenCalledTimes(1);
  });
});

describe("AgentHandler deep loop — chunk-2 retry composition", () => {
  const mockResolve = vi.fn();
  const mockAgentRun = vi.fn();

  function makeHandler() {
    return new AgentHandler({
      resolveAgent: mockResolve,
      createAgent: () => ({ run: mockAgentRun, kill: vi.fn(), config: {} } as any),
    });
  }
  function makeNode(overrides: Partial<Node> = {}): Node {
    return { id: "deep", shape: "box", label: "x", agent: "looper", ...overrides } as Node;
  }

  beforeEach(() => { vi.clearAllMocks(); });

  it("malformed done triggers chunk-2 retry within iteration; loop continues if retry succeeds", async () => {
    mockResolve.mockReturnValue({ ...loopBaseConfig });
    let calls = 0;
    mockAgentRun.mockImplementation(async (opts: any) => {
      calls++;
      if (calls === 1) {
        return {
          exitCode: 0, sessionId: "s1", stdout: null,
          output: streamJsonResult({ done: "true" }),
        };
      }
      if (calls === 2) {
        expect(opts.resume).toBe("s1");
        return {
          exitCode: 0, sessionId: "s1", stdout: null,
          output: streamJsonResult({ done: true }),
        };
      }
      throw new Error("unexpected extra call");
    });

    const handler = makeHandler();
    const outcome = await handler.execute(
      makeNode({ maxIterations: 5, outputValidationRetries: 1 }),
      baseCtx(),
      makeContext(),
    );
    expect(calls).toBe(2);
    expect(outcome.status).toBe("success");
    expect(outcome.contextUpdates?.["deep.done"]).toBe("true");
  });

  it("retry exhaustion within iteration 1 aborts deep loop", async () => {
    mockResolve.mockReturnValue({ ...loopBaseConfig });
    mockAgentRun.mockResolvedValue({
      exitCode: 0, sessionId: "s1", stdout: null,
      output: streamJsonResult({ done: "true" }),
    });

    const handler = makeHandler();
    const outcome = await handler.execute(
      makeNode({ maxIterations: 5, outputValidationRetries: 1 }),
      baseCtx(),
      makeContext(),
    );
    expect(outcome.status).toBe("fail");
    expect(mockAgentRun).toHaveBeenCalledTimes(2);
  });

  it("agent.iterations reflects only outer iterations, not retry attempts", async () => {
    mockResolve.mockReturnValue({ ...loopBaseConfig });
    let calls = 0;
    mockAgentRun.mockImplementation(async () => {
      calls++;
      if (calls === 1) {
        return { exitCode: 0, sessionId: "s1", stdout: null, output: streamJsonResult({ done: "no" }) };
      }
      if (calls === 2) {
        return { exitCode: 0, sessionId: "s1", stdout: null, output: streamJsonResult({ done: false }) };
      }
      if (calls === 3) {
        return { exitCode: 0, sessionId: "s2", stdout: null, output: streamJsonResult({ done: true }) };
      }
      throw new Error("unexpected");
    });

    const handler = makeHandler();
    const outcome = await handler.execute(
      makeNode({ maxIterations: 5, outputValidationRetries: 1 }),
      baseCtx(),
      makeContext(),
    );
    expect(calls).toBe(3);
    expect(outcome.contextUpdates?.["deep.iterations"]).toBe("2");
  });
});

const noteConfig = {
  ...loopBaseConfig,
  outputs: { done: "boolean", note: "string" },
  jsonSchema: JSON.stringify({
    type: "object",
    properties: { done: { type: "boolean" }, note: { type: "string" } },
    required: ["done", "note"],
    additionalProperties: false,
  }),
};

describe("AgentHandler deep loop — $prev_note carry-over", () => {
  const mockResolve = vi.fn();
  const mockAgentRun = vi.fn();
  function makeHandler() {
    return new AgentHandler({
      resolveAgent: mockResolve,
      createAgent: () => ({ run: mockAgentRun, kill: vi.fn(), config: {} } as any),
    });
  }
  function makeNode(overrides: Partial<Node> = {}): Node {
    return { id: "deep", shape: "box", label: "x", agent: "looper", ...overrides } as Node;
  }
  beforeEach(() => { vi.clearAllMocks(); });

  it("first iteration sees prev_note empty; second sees iteration-1's note", async () => {
    mockResolve.mockReturnValue({ ...noteConfig });
    let i = 0;
    const captured: string[] = [];
    mockAgentRun.mockImplementation(async (opts: any) => {
      i++;
      captured.push(String(opts.variables?.prev_note ?? ""));
      return {
        exitCode: 0, sessionId: `s${i}`, stdout: null,
        output: streamJsonResult({
          done: i >= 2,
          note: i === 1 ? "started chunk A" : "",
        }),
      };
    });
    const handler = makeHandler();
    await handler.execute(
      makeNode({ maxIterations: 5 }),
      baseCtx(),
      makeContext(),
    );
    expect(captured[0]).toBe("");
    expect(captured[1]).toBe("started chunk A");
  });

  it("note replaces, does not accumulate", async () => {
    mockResolve.mockReturnValue({ ...noteConfig });
    let i = 0;
    const captured: string[] = [];
    mockAgentRun.mockImplementation(async (opts: any) => {
      i++;
      captured.push(String(opts.variables?.prev_note ?? ""));
      return {
        exitCode: 0, sessionId: `s${i}`, stdout: null,
        output: streamJsonResult({ done: i >= 3, note: `note-${i}` }),
      };
    });
    const handler = makeHandler();
    await handler.execute(
      makeNode({ maxIterations: 5 }),
      baseCtx(),
      makeContext(),
    );
    expect(captured).toEqual(["", "note-1", "note-2"]);
  });

  it("agent without note declaration does not receive prev_note variable", async () => {
    mockResolve.mockReturnValue({ ...loopBaseConfig });
    let i = 0;
    const sawPrevNote: boolean[] = [];
    mockAgentRun.mockImplementation(async (opts: any) => {
      i++;
      sawPrevNote.push("prev_note" in (opts.variables ?? {}));
      return {
        exitCode: 0, sessionId: `s${i}`, stdout: null,
        output: streamJsonResult({ done: i >= 2 }),
      };
    });
    const handler = makeHandler();
    await handler.execute(
      makeNode({ maxIterations: 5 }),
      baseCtx(),
      makeContext(),
    );
    expect(sawPrevNote.every(b => b === false)).toBe(true);
  });
});
