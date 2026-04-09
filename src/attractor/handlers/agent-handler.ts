import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import type { NodeHandler } from "./registry.js";
import type { Node, Outcome, PipelineContext, CheckpointState } from "../types.js";
import { Agent, type AgentConfig } from "../../cli/lib/agent.js";
import { resolveAgent as defaultResolveAgent } from "../../cli/lib/agent-registry.js";
import { buildPreamble } from "../transforms/preamble.js";

export interface AgentHandlerDeps {
  resolveAgent?: (name: string) => AgentConfig;
  createAgent?: (config: AgentConfig) => Agent;
}

export class AgentHandler implements NodeHandler {
  private resolve: (name: string) => AgentConfig;
  private create: (config: AgentConfig) => Agent;

  constructor(deps?: AgentHandlerDeps) {
    this.resolve = deps?.resolveAgent ?? defaultResolveAgent;
    this.create = deps?.createAgent ?? ((c) => new Agent(c));
  }

  async execute(node: Node, ctx: PipelineContext, meta: Record<string, unknown>): Promise<Outcome> {
    const agentName = node.agent ?? "implement";
    if (!agentName) {
      return { status: "fail", failureReason: "Node has no agent attribute" };
    }

    let config: AgentConfig;
    try {
      config = this.resolve(agentName);
    } catch (err) {
      return { status: "fail", failureReason: `Failed to resolve agent "${agentName}": ${(err as Error).message}` };
    }

    // Apply node-level overrides
    if (node.llmModel) config = { ...config, model: node.llmModel as string };

    const logsRoot = meta["logsRoot"] as string;
    const cwd = meta["cwd"] as string;
    const signal = meta["signal"] as AbortSignal | undefined;
    const onStdout = meta["onStdout"] as ((s: NodeJS.ReadableStream) => Promise<void>) | undefined;
    // DOT attributes parse as strings; coerce explicitly to boolean
    const interactive = node.interactive === true || node.interactive === "true";

    // Build prompt with pipeline context preamble
    const nodeDir = join(logsRoot, node.id);
    mkdirSync(nodeDir, { recursive: true });
    const rawPrompt = node.prompt ?? node.label ?? config.prompt;
    const fidelity = (node.fidelity as string | undefined) ?? "compact";
    const completedNodes = (meta["completedNodes"] as string[]) ?? [];
    const nodeRetries = (meta["nodeRetries"] as Record<string, number>) ?? {};
    const preamble = buildPreamble(
      { timestamp: "", currentNode: node.id, completedNodes, nodeRetries, context: ctx.values } as CheckpointState,
      fidelity,
    );
    const prompt = preamble + rawPrompt;
    writeFileSync(join(nodeDir, "prompt.md"), prompt);

    // Override config.prompt so Agent.run() delivers the assembled preamble + node prompt
    const agent = this.create({ ...config, prompt });
    const maxIterations = (node.maxIterations as number | undefined) ?? 1;

    let lastSessionId: string | null = null;
    let iteration = 0;

    for (let i = 0; i < maxIterations; i++) {
      if (signal?.aborted) break;

      const result = await agent.run({
        cwd,
        signal,
        variables: ctx.values,
        // interactive nodes use stdio:inherit — no stdout stream to pipe
        onStdout: interactive ? undefined : onStdout,
        interactive: interactive ? true : undefined,
      });

      iteration++;
      if (result.sessionId) lastSessionId = result.sessionId;

      // Single iteration: fail immediately on non-zero exit
      if (result.exitCode !== 0 && maxIterations === 1) {
        return {
          status: "fail",
          failureReason: `Agent "${agentName}" exited with code ${result.exitCode}`,
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
