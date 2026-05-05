import { describe, it, expect, vi } from "vitest";
import { LoopingAgentHandler } from "../handlers/looping-agent-handler.js";

describe("AgentHandler — frontmatter outputs activates parse path", () => {
  it("uses config.jsonSchema when node has no json_schema_file", async () => {
    const fakeAgent = {
      run: vi.fn().mockResolvedValue({
        exitCode: 0,
        sessionId: "s-1",
        output: JSON.stringify([
          { type: "system", subtype: "init", session_id: "s-1" },
          { type: "result", subtype: "success", result: '{"foo":"bar"}' },
        ]),
      }),
    };
    const handler = new LoopingAgentHandler({
      loadAgent: () => ({
        name: "a", description: "d", model: "opus",
        permissionMode: "default", tools: [], mcp: [], prompt: "",

        outputs: { foo: "string" },
        jsonSchema: '{"type":"object","properties":{"foo":{"type":"string"}},"required":["foo"],"additionalProperties":false}',
      }) as any,
      createAgent: () => fakeAgent as any,
    });
    const node: any = { id: "n1", agent: "a", prompt: "do it" };
    const ctx: any = { values: {} };
    const meta: any = {
      logsRoot: "/tmp/test-runs", cwd: process.cwd(), dotDir: "/tmp",
      completedNodes: [], nodeRetries: {},
    };
    const outcome = await handler.execute(node, ctx, meta);
    expect(outcome.status).toBe("success");
    expect(outcome.contextUpdates).toMatchObject({ "n1.foo": "bar" });
  });
});
