import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import type { NodeHandler, HandlerExecutionContext } from "./registry.js";
import type { Node, Outcome, PipelineContext, CheckpointState } from "../types.js";
import { Agent, type AgentConfig, type ChildHandle } from "../../cli/lib/agent.js";
import { resolveAgent as defaultResolveAgent } from "../../cli/lib/agent-registry.js";
import { getIlluminationServerPath, getMetaMeditationsDir } from "../../cli/lib/assets.js";
import { buildPreamble } from "../transforms/preamble.js";
import { expandVariables, extractDefaults } from "../transforms/variable-expansion.js";
import { renderInputsBlock } from "../transforms/inputs-renderer.js";
import { outputsToZod } from "../../cli/lib/outputs-to-zod.js";
import { buildCorrectiveMessage } from "../../cli/lib/corrective-message.js";
import { evaluateAgentOutput } from "./evaluate-agent-output.js";
import { Session, buildSessionDigest } from "../../cli/lib/session.js";

export interface AgentHandlerDeps {
  resolveAgent?: (name: string, opts?: import("../../cli/lib/agent-registry.js").RegistryOptions) => AgentConfig;
  createAgent?: (config: AgentConfig) => Agent;
}

export class AgentHandler implements NodeHandler {
  private resolve: (name: string, opts?: import("../../cli/lib/agent-registry.js").RegistryOptions) => AgentConfig;
  private create: (config: AgentConfig) => Agent;

  constructor(deps?: AgentHandlerDeps) {
    this.resolve = deps?.resolveAgent ?? defaultResolveAgent;
    this.create = deps?.createAgent ?? ((c) => new Agent(c));
  }

  async execute(node: Node, ctx: PipelineContext, meta: HandlerExecutionContext): Promise<Outcome> {
    const agentName = node.agent ?? "implement";
    if (!agentName) {
      return { status: "fail", failureReason: "Node has no agent attribute" };
    }

    let config: AgentConfig;
    try {
      // Per-folder layout (Chunk 4): the pipeline directory holds its agent
      // files. No bundled fallback for project pipelines — a missing agent
      // must surface as an error, not silently resolve via src/cli/agents/.
      config = this.resolve(agentName, { projectDir: meta.dotDir, allowBundledFallback: false });
    } catch (err) {
      return { status: "fail", failureReason: `Failed to resolve agent "${agentName}": ${(err as Error).message}` };
    }

    // Apply node-level overrides
    if (node.llmModel) config = { ...config, model: node.llmModel as string };

    const { logsRoot, cwd, signal, onStdout, completedNodes, nodeRetries, onInteractiveRequest } = meta;

    // Dev-mode: tsx is needed to run .ts MCP servers (the bundled paths from
    // getIlluminationServerPath() etc point at .ts in dev, .js in prod).
    if (typeof __RALPH_PROD__ === "undefined") {
      config = {
        ...config,
        mcp: config.mcp.map((m) => (m.command === "node" ? { ...m, command: "tsx" } : m)),
      };
    }

    // Auto-inject standard MCP infra variables so agents using the illumination
    // server (e.g. meditate, janitor) get their {{ILLUMINATION_SERVER_PATH}} /
    // {{PROJECT_ROOT}} / {{META_MEDITATIONS_DIR}} placeholders resolved without
    // every pipeline command re-declaring them. Caller-provided values win.
    const agentVariables: Record<string, unknown> = {
      ILLUMINATION_SERVER_PATH: getIlluminationServerPath(),
      PROJECT_ROOT: meta.projectDir ?? cwd,
      META_MEDITATIONS_DIR: getMetaMeditationsDir(),
      ...ctx.values,
    };

    // JSON schema comes exclusively from agent frontmatter outputs:
    const jsonSchema: string | undefined = config.jsonSchema;
    // DOT attributes parse as strings; coerce explicitly to boolean
    const interactive = node.interactive === true || node.interactive === "true";

    // Build prompt with pipeline context preamble
    const nodeDir = join(logsRoot, node.id);
    mkdirSync(nodeDir, { recursive: true });
    const agentInstructions = (config.prompt ?? "").trim();
    const defaults = extractDefaults(node as unknown as Record<string, unknown>);

    let assembledPrompt: string;
    if (config.autoInputs === true) {
      // Auto-inputs path: inject Inputs block from declared inputs, treat node.prompt as optional prose steering
      const declaredInputs = (config.inputs as string[] | undefined) ?? [];
      const nodeAttrs = node as unknown as Record<string, unknown>;
      const inputsBlock = renderInputsBlock(declaredInputs, ctx.values, nodeAttrs);
      const steeringRaw = (node.prompt ?? "").trim();
      const steeringBlock = steeringRaw
        ? `\n\n## Steering\n\n${steeringRaw}\n`
        : "";
      assembledPrompt = `${agentInstructions}\n\n---\n\n${inputsBlock}${steeringBlock}`;
    } else {
      // Legacy path: expand $variables in node task / rubric
      const nodeTask = node.prompt ?? node.label;
      // Expand ONLY the node task. Rubric bodies are authored manuals —
      // their literal `$var` tokens (e.g. `$run_id` in tmux-tester.md as documentation)
      // must not reach expandVariables or undefined ones throw.
      // Spider case (no node task) keeps the old behavior: rubric IS the template, so expand it.
      const expandedTask = nodeTask ? expandVariables(nodeTask, ctx.values, defaults) : undefined;
      assembledPrompt = expandedTask
        ? (agentInstructions ? `${agentInstructions}\n\n---\n\n${expandedTask}` : expandedTask)
        : expandVariables(agentInstructions, ctx.values, defaults);
    }

    const fidelity = (node.fidelity as string | undefined) ?? "compact";
    const preamble = buildPreamble(
      { timestamp: "", currentNode: node.id, completedNodes, nodeRetries, context: ctx.values } as CheckpointState,
      fidelity,
    );
    const jsonWrappedPrompt = jsonSchema
      ? `IMPORTANT: Your FINAL response MUST be valid JSON matching this schema. No markdown, no preamble, output ONLY the JSON object.\nSchema: ${jsonSchema}\n\n${assembledPrompt}\n\nREMINDER: Output MUST be valid JSON matching the schema above. No markdown, no explanation.`
      : assembledPrompt;
    const prompt = preamble + jsonWrappedPrompt;
    writeFileSync(join(nodeDir, "prompt.md"), prompt);

    // Override config.prompt so Agent.run() delivers the assembled preamble + node prompt
    const agent = this.create({ ...config, prompt, ...(jsonSchema ? { jsonSchema } : {}) });

    // --- Path 1.5: interactive branch ---
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

    // When auto_inputs is true, namespace meta keys under node.id; otherwise use legacy "agent" prefix.
    const metaPrefix = config.autoInputs === true ? node.id : "agent";

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
        // When auto_inputs is true metaPrefix === node.id, so namespace under node.id.key;
        // otherwise metaPrefix === "agent" and legacy path keeps bare key.
        const outKey = config.autoInputs === true ? `${metaPrefix}.${key}` : key;
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
