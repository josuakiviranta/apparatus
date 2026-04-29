import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentHandler } from "../handlers/agent-handler.js";

function makeAgent(responses: Array<{ raw: string; sessionId?: string }>) {
  let i = 0;
  return {
    run: vi.fn(async (_args: { resume?: string; message?: string }) => {
      const r = responses[Math.min(i, responses.length - 1)];
      i++;
      return {
        exitCode: 0,
        sessionId: r.sessionId ?? "sess-1",
        output: JSON.stringify([
          { type: "system", subtype: "init", session_id: r.sessionId ?? "sess-1" },
          { type: "result", subtype: "success", result: r.raw },
        ]),
      };
    }),
  };
}

function makeMeta(extra: Partial<any> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "handler-retry-"));
  return {
    logsRoot: dir, cwd: process.cwd(), dotDir: "/tmp",
    completedNodes: [], nodeRetries: {},
    ...extra,
  };
}

const config = (extras: any = {}) => ({
  name: "v", description: "d", model: "opus",
  permissionMode: "default", tools: [], mcp: [], prompt: "",

  outputs: { foo: "string" },
  jsonSchema: '{"type":"object","properties":{"foo":{"type":"string"}},"required":["foo"],"additionalProperties":false}',
  ...extras,
});

describe("AgentHandler — validation retry loop", () => {
  it("invalid first attempt + valid retry → success on attempt 2", async () => {
    const fakeAgent = makeAgent([
      { raw: '{"wrong":"key"}', sessionId: "s-1" },
      { raw: '{"foo":"bar"}', sessionId: "s-1" },
    ]);
    const handler = new AgentHandler({
      resolveAgent: () => config() as any,
      createAgent: () => fakeAgent as any,
    });
    const meta = makeMeta();
    const outcome = await handler.execute(
      { id: "v", agent: "v", prompt: "do" } as any,
      { values: {} } as any,
      meta as any,
    );
    expect(outcome.status).toBe("success");
    expect(outcome.contextUpdates?.["v.foo"]).toBe("bar");
    expect(fakeAgent.run).toHaveBeenCalledTimes(2);
    const secondCall = fakeAgent.run.mock.calls.at(1)!;
    expect(secondCall[0]).toMatchObject({ resume: "s-1" });
    expect(secondCall[0].message).toMatch(/schema validation/i);
    expect(existsSync(join(meta.logsRoot, "v", "raw-attempt-1.txt"))).toBe(true);
    expect(existsSync(join(meta.logsRoot, "v", "raw-attempt-2.txt"))).toBe(true);
  });

  it("empty output → corrective uses no-text-content phrasing", async () => {
    const fakeAgent = makeAgent([
      { raw: "", sessionId: "s-2" },
      { raw: '{"foo":"x"}', sessionId: "s-2" },
    ]);
    const handler = new AgentHandler({
      resolveAgent: () => config() as any,
      createAgent: () => fakeAgent as any,
    });
    const meta = makeMeta();
    const outcome = await handler.execute(
      { id: "v", agent: "v", prompt: "do" } as any,
      { values: {} } as any,
      meta as any,
    );
    expect(outcome.status).toBe("success");
    expect(fakeAgent.run.mock.calls.at(1)![0].message).toMatch(/no text content/i);
  });

  it("invalid 2 attempts → hard fail with attempts logged", async () => {
    const fakeAgent = makeAgent([
      { raw: '{"wrong":"a"}', sessionId: "s-3" },
      { raw: '{"wrong":"b"}', sessionId: "s-3" },
    ]);
    const onValidationFailure = vi.fn();
    const handler = new AgentHandler({
      resolveAgent: () => config() as any,
      createAgent: () => fakeAgent as any,
    });
    const meta = makeMeta({ onValidationFailure });
    const outcome = await handler.execute(
      { id: "v", agent: "v", prompt: "do" } as any,
      { values: {} } as any,
      meta as any,
    );
    expect(outcome.status).toBe("fail");
    expect(outcome.failureReason).toMatch(/output validation failed.*2 attempts/i);
    expect(outcome.contextUpdates?.["v.success"]).toBe("false");
    expect(onValidationFailure).toHaveBeenCalledTimes(2);
    expect(existsSync(join(meta.logsRoot, "v", "raw-attempt-1.txt"))).toBe(true);
    expect(existsSync(join(meta.logsRoot, "v", "raw-attempt-2.txt"))).toBe(true);
  });

  it("per-node output_validation_retries=0 → no retry (single attempt only)", async () => {
    const fakeAgent = makeAgent([
      { raw: '{"wrong":"a"}', sessionId: "s-4" },
    ]);
    const handler = new AgentHandler({
      resolveAgent: () => config() as any,
      createAgent: () => fakeAgent as any,
    });
    const outcome = await handler.execute(
      { id: "v", agent: "v", prompt: "do", outputValidationRetries: 0 } as any,
      { values: {} } as any,
      makeMeta() as any,
    );
    expect(outcome.status).toBe("fail");
    expect(fakeAgent.run).toHaveBeenCalledTimes(1);
  });
});
