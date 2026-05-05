import { writeFileSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import type { NodeHandler, HandlerExecutionContext } from "./registry.js";
import type { Node, Outcome, PipelineContext } from "../types.js";
import { Agent, type AgentConfig, type ChildHandle } from "../../cli/lib/agent.js";
import { loadAgent as defaultLoadAgent } from "../../cli/lib/agent-loader.js";
import { Session, buildSessionDigest } from "../../cli/lib/session.js";
import { assembleAgentPrompt } from "./agent-prep.js";

export interface InteractiveAgentHandlerDeps {
  loadAgent?: (name: string, pipelineDir: string) => AgentConfig;
  createAgent?: (config: AgentConfig) => Agent;
}

export class InteractiveAgentHandler implements NodeHandler {
  private load: (name: string, pipelineDir: string) => AgentConfig;
  private create: (config: AgentConfig) => Agent;

  constructor(deps?: InteractiveAgentHandlerDeps) {
    this.load = deps?.loadAgent ?? defaultLoadAgent;
    this.create = deps?.createAgent ?? ((c) => new Agent(c));
  }

  async execute(node: Node, ctx: PipelineContext, meta: HandlerExecutionContext): Promise<Outcome> {
    const prep = assembleAgentPrompt(node, ctx, meta, this.load, this.create);
    if ("fail" in prep) return { status: "fail", failureReason: prep.fail };
    const { agent, agentVariables, prompt, nodeDir } = prep;
    const { cwd, onInteractiveRequest } = meta;

    const sessionId = randomUUID();
    const session = new Session(sessionId);
    const systemPrompt = prompt;

    const child: ChildHandle = agent.runInteractive({
      session,
      systemPrompt,
      cwd,
      variables: agentVariables,
    });

    if (!onInteractiveRequest) {
      try { await child.kill("SIGKILL"); } catch {}
      return {
        status: "fail",
        failureReason: "interactive=true node requires onInteractiveRequest in engine options",
      };
    }

    await onInteractiveRequest({ session, child, tracePath: nodeDir });

    try {
      await Promise.race([
        child.exited,
        new Promise<void>((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000)),
      ]);
    } catch {
      try { await child.kill("SIGKILL"); } catch {}
    }

    const digest = buildSessionDigest(session);
    const prefix = node.id;
    const contextUpdates: Record<string, unknown> = {
      [`${prefix}.output`]: digest.output,
      [`${prefix}.success`]: digest.success,
      [`${prefix}.turnsUsed`]: digest.turnsUsed,
      [`${prefix}.sessionId`]: digest.sessionId,
      [`${prefix}.exitReason`]: digest.exitReason,
      [`${prefix}.transcriptPath`]: digest.transcriptPath,
      [`${prefix}.digest`]: digest.digest,
    };

    writeFileSync(join(nodeDir, "digest.json"), JSON.stringify(digest, null, 2));

    return {
      status: digest.success ? "success" : "fail",
      failureReason: digest.success ? undefined : `Interactive session ended with ${digest.exitReason}`,
      contextUpdates,
    };
  }
}
