import { writeFileSync } from "fs";
import { join } from "path";
import type { NodeHandler, HandlerExecutionContext } from "./registry.js";
import type { Node, Outcome, PipelineContext } from "../types.js";
import { Agent, type AgentConfig } from "../../cli/lib/agent.js";
import { loadAgent as defaultLoadAgent } from "../../cli/lib/agent-loader.js";
import { outputsToZod } from "../../cli/lib/outputs-to-zod.js";
import { buildCorrectiveMessage } from "../../cli/lib/corrective-message.js";
import { evaluateAgentOutput } from "./evaluate-agent-output.js";
import { assembleAgentPrompt } from "./agent-prep.js";

export interface LoopingAgentHandlerDeps {
  loadAgent?: (name: string, pipelineDir: string) => AgentConfig;
  createAgent?: (config: AgentConfig) => Agent;
}

export class LoopingAgentHandler implements NodeHandler {
  private load: (name: string, pipelineDir: string) => AgentConfig;
  private create: (config: AgentConfig) => Agent;

  constructor(deps?: LoopingAgentHandlerDeps) {
    this.load = deps?.loadAgent ?? defaultLoadAgent;
    this.create = deps?.createAgent ?? ((c) => new Agent(c));
  }

  async execute(node: Node, ctx: PipelineContext, meta: HandlerExecutionContext): Promise<Outcome> {
    const prep = assembleAgentPrompt(node, ctx, meta, this.load, this.create);
    if ("fail" in prep) return { status: "fail", failureReason: prep.fail };
    const { agent, config, jsonSchema, agentVariables, nodeDir } = prep;
    const { cwd, signal, onStdout } = meta;

    const nodeCapRaw = node.maxIterations;
    const nodeCapParsed = typeof nodeCapRaw === "string" ? parseInt(nodeCapRaw, 10)
                        : typeof nodeCapRaw === "number"  ? nodeCapRaw
                        : undefined;
    const nodeCapValid = nodeCapParsed != null && !isNaN(nodeCapParsed) && nodeCapParsed >= 0;

    const agentCap = config.maxIterations;
    const loopMode = config.loop === true;

    const maxIterations =
      nodeCapValid
        ? (nodeCapParsed === 0 ? Infinity : nodeCapParsed!)
        : (typeof agentCap === "number" && agentCap >= 0
            ? (agentCap === 0 ? Infinity : agentCap)
            : (loopMode ? Infinity : 1));

    let lastSessionId: string | null = null;
    let iteration = 0;

    let lastParsed: Record<string, unknown> | null = null;
    let preferredLabel: string | undefined;

    const zodSchema = (jsonSchema && config.outputs) ? outputsToZod(config.outputs) : null;

    const overrideRetries = (node as Record<string, unknown>).outputValidationRetries;
    const maxRetries = typeof overrideRetries === "number" && overrideRetries >= 0 ? overrideRetries : 1;

    const writeRaw = (n: number, raw: string) =>
      writeFileSync(join(nodeDir, `raw-attempt-${n}.txt`), raw ?? "");

    const baseAgentVariables: Record<string, unknown> = { ...agentVariables };
    const agentDeclaresNote =
      !!config.outputs && Object.prototype.hasOwnProperty.call(config.outputs, "note");
    let prevNote = "";

    const metaPrefix = node.id;
    const agentName = node.agent ?? "implement";

    for (let i = 0; i < maxIterations; i++) {
      if (signal?.aborted) break;
      if (i > 0) meta.onIterationStart?.(node.id, i);

      const iterVariables = agentDeclaresNote
        ? { ...baseAgentVariables, prev_note: prevNote }
        : baseAgentVariables;

      let result = await agent.run({ cwd, signal, variables: iterVariables, onStdout });
      iteration++;
      if (result.sessionId) lastSessionId = result.sessionId;

      if (result.exitCode !== 0) {
        return {
          status: "fail",
          failureReason: `Agent "${agentName}" exited with code ${result.exitCode}`,
          contextUpdates: {
            [`${metaPrefix}.iterations`]: String(iteration),
            [`${metaPrefix}.success`]: "false",
          },
        };
      }

      let parsed: Record<string, unknown> | undefined;
      if (jsonSchema) {
        writeRaw(1, result.output ?? "");
        let attempt = 1;
        let evaluation = evaluateAgentOutput(result.output ?? "", zodSchema);

        while (!evaluation.ok && attempt <= maxRetries) {
          meta.onValidationFailure?.({
            attempt,
            errors: evaluation.errors,
            rawOutputPath: `${node.id}/raw-attempt-${attempt}.txt`,
          });
          if (!lastSessionId) {
            return {
              status: "fail",
              failureReason:
                `Output validation failed and cannot retry: agent did not report sessionId ` +
                `(iter ${i + 1} attempt ${attempt}: ${evaluation.errors.map(e => `${e.path}: ${e.message}`).join("; ")})`,
              contextUpdates: { [`${metaPrefix}.iterations`]: String(iteration), [`${metaPrefix}.success`]: "false" },
            };
          }
          attempt += 1;
          meta.onValidationRetryStart?.(node.id, attempt);
          const corrective = buildCorrectiveMessage(evaluation.raw, evaluation.errors, jsonSchema);
          const retryResult = await agent.run({
            cwd, signal, variables: iterVariables, onStdout,
            resume: lastSessionId, message: corrective,
          });
          result = retryResult;
          if (retryResult.sessionId) lastSessionId = retryResult.sessionId;
          writeRaw(attempt, retryResult.output ?? "");
          evaluation = evaluateAgentOutput(retryResult.output ?? "", zodSchema);
        }

        if (!evaluation.ok) {
          meta.onValidationFailure?.({
            attempt,
            errors: evaluation.errors,
            rawOutputPath: `${node.id}/raw-attempt-${attempt}.txt`,
          });
          return {
            status: "fail",
            failureReason:
              `Output validation failed in iteration ${i + 1} after ${attempt} attempts: ` +
              evaluation.errors.map(e => `${e.path}: ${e.message}`).join("; "),
            contextUpdates: { [`${metaPrefix}.iterations`]: String(iteration), [`${metaPrefix}.success`]: "false" },
          };
        }

        parsed = evaluation.parsed as Record<string, unknown>;
        lastParsed = parsed;
        if (parsed.preferred_label != null) preferredLabel = String(parsed.preferred_label);
      }

      if (agentDeclaresNote && parsed && typeof parsed.note === "string") {
        prevNote = parsed.note;
      }

      const willBreak = parsed?.done === true;
      if (willBreak) break;

      const willContinue = !signal?.aborted && i < maxIterations - 1;
      if (willContinue) meta.onIterationEnd?.(node.id, i);
    }

    let structuredUpdates: Record<string, unknown> = {};
    if (lastParsed) {
      for (const [key, value] of Object.entries(lastParsed)) {
        const outKey = `${metaPrefix}.${key}`;
        structuredUpdates[outKey] = typeof value === "string" ? value : String(value);
      }
    }

    return {
      status: "success",
      ...(preferredLabel ? { preferredLabel } : {}),
      contextUpdates: {
        ...structuredUpdates,
        [`${metaPrefix}.iterations`]: String(iteration),
        [`${metaPrefix}.success`]: "true",
        ...(lastSessionId ? { [`${metaPrefix}.sessionId`]: lastSessionId } : {}),
      },
    };
  }
}
