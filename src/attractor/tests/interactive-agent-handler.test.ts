import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { InteractiveAgentHandler } from "../handlers/interactive-agent-handler.js";
import type { OnInteractiveRequest, HandlerExecutionContext } from "../handlers/registry.js";
import { Session } from "../../cli/lib/session.js";
import type { AgentConfig } from "../../cli/lib/agent.js";
import type { Node, PipelineContext } from "../types.js";
import { createFakeChildHandle } from "../../cli/tests/helpers/fake-child-handle.js";

function makeAgentConfig(tools: string[] = []): AgentConfig {
  return {
    name: "chat",
    description: "",
    model: "opus",
    permissionMode: "dangerouslySkipPermissions",
    tools,
    mcp: [],
    prompt: "BODY",
  } as AgentConfig;
}

function makeFakeAgent(config: AgentConfig) {
  return {
    config,
    run: async () => ({ exitCode: 0, sessionId: null, stdout: null }),
    runInteractive: (opts: { session: Session; systemPrompt: string; cwd: string }) => {
      const ctrl = createFakeChildHandle(opts.session.id);
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

const baseMeta = (
  cwd: string,
  logsRoot: string,
  onInteractiveRequest?: OnInteractiveRequest,
): HandlerExecutionContext => ({
  cwd,
  logsRoot,
  dotDir: cwd,
  completedNodes: [] as string[],
  nodeRetries: {},
  outgoingLabels: [] as string[],
  onInteractiveRequest,
});

const endStub: OnInteractiveRequest = async ({ session, child }) => {
  session.exitReason = "user_end";
  try { await child.end(); } catch {}
};

describe("InteractiveAgentHandler", () => {
  afterEach(() => {
    process.removeAllListeners("SIGINT");
  });

  it("is a NodeHandler with execute() method", () => {
    const h = new InteractiveAgentHandler();
    expect(typeof h.execute).toBe("function");
  });

  it("adds 'Edit' to the loaded agent config's tools allowlist", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "apparat-interactive-tools-"));
    try {
      let capturedConfig: AgentConfig | undefined;
      const baseConfig = makeAgentConfig([]);
      const fakeCreate = (cfg: AgentConfig) => {
        capturedConfig = cfg;
        return makeFakeAgent(cfg);
      };

      const handler = new InteractiveAgentHandler({
        loadAgent: () => baseConfig,
        createAgent: fakeCreate,
      });

      const node: Node = { id: "chat_session", agent: "chat", interactive: true };
      await handler.execute(node, baseCtx(), baseMeta(tmp, tmp, endStub));
      expect(capturedConfig?.tools).toContain("Edit");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("does not duplicate 'Edit' if already present in tools", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "apparat-interactive-tools-"));
    try {
      let capturedConfig: AgentConfig | undefined;
      const baseConfig = makeAgentConfig(["Read", "Edit", "Bash"]);
      const fakeCreate = (cfg: AgentConfig) => {
        capturedConfig = cfg;
        return makeFakeAgent(cfg);
      };

      const handler = new InteractiveAgentHandler({
        loadAgent: () => baseConfig,
        createAgent: fakeCreate,
      });

      const node: Node = { id: "chat_session", agent: "chat", interactive: true };
      await handler.execute(node, baseCtx(), baseMeta(tmp, tmp, endStub));
      const editCount = capturedConfig?.tools?.filter((t) => t === "Edit").length ?? 0;
      expect(editCount).toBe(1);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
