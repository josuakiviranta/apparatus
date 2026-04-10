import { describe, it, expect, vi, afterEach } from "vitest";
import { AgentHandler, type InkRenderFn } from "../handlers/agent-handler.js";
import { Session } from "../../cli/lib/session.js";
import type { AgentConfig } from "../../cli/lib/agent.js";
import type { Node, PipelineContext } from "../types.js";
import { mkdtempSync, rmSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createFakeChildHandle } from "../../cli/tests/helpers/fake-child-handle.js";

function makeFakeAgent(
  controllerSetup: (ctrl: ReturnType<typeof createFakeChildHandle>, session: Session) => void,
) {
  return {
    config: {
      name: "chat",
      description: "",
      model: "opus",
      permissionMode: "dangerouslySkipPermissions",
      tools: [],
      mcp: [],
      prompt: "",
    } as AgentConfig,
    run: async () => ({ exitCode: 0, sessionId: null, stdout: null }),
    runInteractive: (opts: { session: Session; systemPrompt: string; cwd: string }) => {
      const ctrl = createFakeChildHandle(opts.session.id);
      controllerSetup(ctrl, opts.session);
      return ctrl.handle;
    },
    kill: () => {},
    expandPrompt: () => "",
    buildArgs: () => [],
    buildInteractiveArgs: () => [],
    writeMcpConfig: () => null,
    cleanupMcpConfig: () => {},
    mcpConfigPath: null,
  } as any;
}

const baseCtx = (): PipelineContext => ({ values: {} });

const baseMeta = (cwd: string, logsRoot: string) => ({
  cwd,
  logsRoot,
  completedNodes: [] as string[],
  nodeRetries: {},
  outgoingLabels: [] as string[],
});

describe("AgentHandler — interactive branch", () => {
  afterEach(() => {
    process.removeAllListeners("SIGINT");
  });

  it("passes non-interactive nodes through the legacy path unchanged", async () => {
    const legacyRun = vi.fn().mockResolvedValue({ exitCode: 0, sessionId: "legacy", stdout: null });
    const agent = {
      ...makeFakeAgent(() => {}),
      run: legacyRun,
    };
    const handler = new AgentHandler({
      resolveAgent: () => agent.config,
      createAgent: () => agent,
    });
    const tmp = mkdtempSync(join(tmpdir(), "ralph-handler-"));
    try {
      const node: Node = { id: "n1", prompt: "do stuff" };
      const out = await handler.execute(node, baseCtx(), baseMeta(tmp, tmp));
      expect(legacyRun).toHaveBeenCalled();
      expect(out.status).toBe("success");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("rejects interactive=true combined with jsonSchemaFile", async () => {
    const agent = makeFakeAgent(() => {});
    const handler = new AgentHandler({
      resolveAgent: () => agent.config,
      createAgent: () => agent,
    });
    const tmp = mkdtempSync(join(tmpdir(), "ralph-handler-"));
    try {
      const { writeFileSync } = await import("fs");
      const schemaPath = join(tmp, "schema.json");
      writeFileSync(schemaPath, "{}");
      const node: Node = {
        id: "n1",
        prompt: "chat",
        interactive: true,
        jsonSchemaFile: "schema.json",
      };
      const out = await handler.execute(node, baseCtx(), baseMeta(tmp, tmp));
      expect(out.status).toBe("fail");
      expect(out.failureReason).toMatch(/interactive.*json_schema|json_schema.*interactive/i);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("interactive success path: flattens digest into contextUpdates", async () => {
    const agent = makeFakeAgent((ctrl) => {
      // Simulate: assistant responds, then user ends session
      setTimeout(() => {
        ctrl.emit({
          type: "result",
          stopReason: "end_turn",
          text: "summary text",
          usage: { inputTokens: 10, outputTokens: 5 },
          raw: {},
        });
      }, 5);
    });

    const stubRender: InkRenderFn = (element: any) => {
      const props = element.props;
      const { session, child, onExit } = props;
      (async () => {
        for await (const ev of child.events) {
          if (ev.type === "result") {
            session.history.push({
              role: "assistant",
              text: ev.text,
              toolCalls: [],
              usage: ev.usage,
              at: Date.now(),
            });
            session.exitReason = "user_end";
            try { await child.end(); } catch {}
            onExit("user_end");
            return;
          }
        }
      })();
      return { unmount: () => {}, waitUntilExit: async () => {} };
    };

    const handler = new AgentHandler({
      resolveAgent: () => agent.config,
      createAgent: () => agent,
      render: stubRender,
    });

    const tmp = mkdtempSync(join(tmpdir(), "ralph-handler-"));
    try {
      const node: Node = {
        id: "chat_node",
        prompt: "talk to the user",
        interactive: true,
      };
      const out = await handler.execute(node, baseCtx(), baseMeta(tmp, tmp));
      expect(out.status).toBe("success");
      expect(out.contextUpdates!["chat_node.output"]).toBe("summary text");
      expect(out.contextUpdates!["chat_node.success"]).toBe(true);
      expect(out.contextUpdates!["chat_node.exitReason"]).toBe("user_end");
      expect(out.contextUpdates!["chat_node.turnsUsed"]).toBe(0);
      expect(typeof out.contextUpdates!["chat_node.digest"]).toBe("object");

      // Verify digest.json was written
      const digestPath = join(tmp, "chat_node", "digest.json");
      const digestOnDisk = JSON.parse(readFileSync(digestPath, "utf8"));
      expect(digestOnDisk.success).toBe(true);
      expect(digestOnDisk.sessionId).toBeTruthy();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("interactive abort path: status='fail', contextUpdates contain partial digest", async () => {
    const agent = makeFakeAgent(() => {});

    const stubRender: InkRenderFn = (element: any) => {
      const { session, child, onExit } = element.props;
      setTimeout(() => {
        session.exitReason = "abort";
        child.kill("SIGTERM").finally(() => onExit("abort"));
      }, 5);
      return { unmount: () => {}, waitUntilExit: async () => {} };
    };

    const handler = new AgentHandler({
      resolveAgent: () => agent.config,
      createAgent: () => agent,
      render: stubRender,
    });

    const tmp = mkdtempSync(join(tmpdir(), "ralph-handler-"));
    try {
      const node: Node = { id: "chat_node", prompt: "p", interactive: true };
      const out = await handler.execute(node, baseCtx(), baseMeta(tmp, tmp));
      expect(out.status).toBe("fail");
      expect(out.contextUpdates!["chat_node.success"]).toBe(false);
      expect(out.contextUpdates!["chat_node.exitReason"]).toBe("abort");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("interactive=true with string 'true' is handled (DOT attribute coercion)", async () => {
    const agent = makeFakeAgent(() => {});

    const stubRender: InkRenderFn = (element: any) => {
      const { session, child, onExit } = element.props;
      setTimeout(() => {
        session.exitReason = "user_end";
        child.end().then(() => onExit("user_end"));
      }, 5);
      return { unmount: () => {}, waitUntilExit: async () => {} };
    };

    const handler = new AgentHandler({
      resolveAgent: () => agent.config,
      createAgent: () => agent,
      render: stubRender,
    });

    const tmp = mkdtempSync(join(tmpdir(), "ralph-handler-"));
    try {
      // DOT attributes parse as strings, so interactive="true" is common
      const node: Node = { id: "chat", prompt: "hi", interactive: "true" };
      const out = await handler.execute(node, baseCtx(), baseMeta(tmp, tmp));
      expect(out.status).toBe("success");
      expect(out.contextUpdates!["chat.exitReason"]).toBe("user_end");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("writes prompt.md to nodeDir even for interactive nodes", async () => {
    const agent = makeFakeAgent(() => {});

    const stubRender: InkRenderFn = (element: any) => {
      const { session, child, onExit } = element.props;
      setTimeout(() => {
        session.exitReason = "user_end";
        child.end().then(() => onExit("user_end"));
      }, 5);
      return { unmount: () => {}, waitUntilExit: async () => {} };
    };

    const handler = new AgentHandler({
      resolveAgent: () => agent.config,
      createAgent: () => agent,
      render: stubRender,
    });

    const tmp = mkdtempSync(join(tmpdir(), "ralph-handler-"));
    try {
      const node: Node = { id: "chat", prompt: "talk about $topic", interactive: true };
      const ctx: PipelineContext = { values: { topic: "testing" } };
      await handler.execute(node, ctx, baseMeta(tmp, tmp));

      const promptPath = join(tmp, "chat", "prompt.md");
      const written = readFileSync(promptPath, "utf8");
      expect(written).toContain("talk about testing");
      expect(written).not.toContain("$topic");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
