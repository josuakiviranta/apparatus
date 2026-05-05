import { writeFileSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import type { NodeHandler, HandlerExecutionContext } from "./registry.js";
import type { Node, Outcome, PipelineContext } from "../types.js";
import { Agent, type AgentConfig, type ChildHandle } from "../../cli/lib/agent.js";
import { loadAgent as defaultLoadAgent } from "../../cli/lib/agent-loader.js";
import { outputsToZod } from "../../cli/lib/outputs-to-zod.js";
import { buildCorrectiveMessage } from "../../cli/lib/corrective-message.js";
import { evaluateAgentOutput } from "./evaluate-agent-output.js";
import { Session, buildSessionDigest } from "../../cli/lib/session.js";
import { assembleAgentPrompt, SYSTEM_INJECTED_VARS } from "./agent-prep.js";

export { SYSTEM_INJECTED_VARS };

export interface AgentHandlerDeps {
  loadAgent?: (name: string, pipelineDir: string) => AgentConfig;
  createAgent?: (config: AgentConfig) => Agent;
}

export class AgentHandler implements NodeHandler {
  private load: (name: string, pipelineDir: string) => AgentConfig;
  private create: (config: AgentConfig) => Agent;

  constructor(deps?: AgentHandlerDeps) {
    this.load = deps?.loadAgent ?? defaultLoadAgent;
    this.create = deps?.createAgent ?? ((c) => new Agent(c));
  }

  async execute(node: Node, ctx: PipelineContext, meta: HandlerExecutionContext): Promise<Outcome> {
    const prep = assembleAgentPrompt(node, ctx, meta, this.load, this.create);
    if ("fail" in prep) {
      return { status: "fail", failureReason: prep.fail };
    }
    const { agent, config, jsonSchema, agentVariables, prompt, nodeDir } = prep;
    const { cwd, signal, onStdout, onInteractiveRequest } = meta;
    // DOT attributes parse as strings; coerce explicitly to boolean
    const interactive = node.interactive === true || node.interactive === "true";

    // --- Path 1.5: interactive branch (verbatim copy of pre-edit agent-handler.ts:126-186) ---
    if (interactive) {
      if (jsonSchema) {
        return {
          status: "fail",
          failureReason: "interactive=true cannot be combined with outputs: structured output is incompatible with live chat streaming",
        };
      }

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
          failureReason:
            "interactive=true node requires onInteractiveRequest in engine options",
        };
      }

      await onInteractiveRequest({ session, child, tracePath: nodeDir });

      // Ensure the child process is actually gone
      try {
        await Promise.race([
          child.exited,
          new Promise<void>((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000)),
        ]);
      } catch {
        try { await child.kill("SIGKILL"); } catch {}
      }

      // Build digest and flatten into contextUpdates
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
    // --- end interactive branch; legacy path below is unchanged ---

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
    const maxRetries =
      typeof overrideRetries === "number" && overrideRetries >= 0
        ? overrideRetries
        : 1;

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

      let result = await agent.run({
        cwd, signal, variables: iterVariables, onStdout,
      });
      iteration++;
      if (result.sessionId) lastSessionId = result.sessionId;

      // D6: any non-zero exit during deep-loop iteration = hard failure.
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
          // Retries are sub-attempts of this iteration; do NOT increment `iteration`.

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

      // Deep-loop break MUST be checked BEFORE onIterationEnd; if we break,
      // we don't end-and-restart — the outer onNodeEnd closes the block.
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
