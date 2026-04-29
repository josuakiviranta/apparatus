import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import type { NodeHandler, HandlerExecutionContext } from "./registry.js";
import type { Node, Outcome, PipelineContext, CheckpointState } from "../types.js";
import { Agent, type AgentConfig, type RunResult, type ChildHandle } from "../../cli/lib/agent.js";
import { resolveAgent as defaultResolveAgent } from "../../cli/lib/agent-registry.js";
import { getIlluminationServerPath, getMetaMeditationsDir } from "../../cli/lib/assets.js";
import { buildPreamble } from "../transforms/preamble.js";
import { expandVariables, extractDefaults } from "../transforms/variable-expansion.js";
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
    const nodeTask = node.prompt ?? node.label;
    const agentRubric = (config.prompt ?? "").trim();
    const defaults = extractDefaults(node as unknown as Record<string, unknown>);
    // Expand ONLY the node task. Rubric bodies are authored manuals —
    // their literal `$var` tokens (e.g. `$run_id` in tmux-tester.md as documentation)
    // must not reach expandVariables or undefined ones throw.
    // Spider case (no node task) keeps the old behavior: rubric IS the template, so expand it.
    const expandedTask = nodeTask ? expandVariables(nodeTask, ctx.values, defaults) : undefined;
    const expandedRawPrompt = expandedTask
      ? (agentRubric ? `${agentRubric}\n\n---\n\n${expandedTask}` : expandedTask)
      : expandVariables(agentRubric, ctx.values, defaults);
    const fidelity = (node.fidelity as string | undefined) ?? "compact";
    const preamble = buildPreamble(
      { timestamp: "", currentNode: node.id, completedNodes, nodeRetries, context: ctx.values } as CheckpointState,
      fidelity,
    );
    const jsonWrappedPrompt = jsonSchema
      ? `IMPORTANT: Your FINAL response MUST be valid JSON matching this schema. No markdown, no preamble, output ONLY the JSON object.\nSchema: ${jsonSchema}\n\n${expandedRawPrompt}\n\nREMINDER: Output MUST be valid JSON matching the schema above. No markdown, no explanation.`
      : expandedRawPrompt;
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

    const rawIter = node.maxIterations;
    const parsedIter = typeof rawIter === "string" ? parseInt(rawIter, 10)
                     : typeof rawIter === "number"  ? rawIter
                     : undefined;
    const maxIterations = parsedIter == null || isNaN(parsedIter) || parsedIter < 0 ? 1
                        : parsedIter === 0 ? Infinity
                        : parsedIter;

    let lastResult: RunResult | null = null;
    let lastSessionId: string | null = null;
    let iteration = 0;

    for (let i = 0; i < maxIterations; i++) {
      if (signal?.aborted) break;

      // Iterations 1+: open a new TUI block (iteration 0's block opened by onNodeStart)
      if (i > 0) {
        meta.onIterationStart?.(node.id, i);
      }

      const result = await agent.run({
        cwd,
        signal,
        variables: agentVariables,
        onStdout,
      });

      lastResult = result;
      iteration++;
      if (result.sessionId) lastSessionId = result.sessionId;

      // More iterations will follow: close current TUI block
      const willContinue = !signal?.aborted && i < maxIterations - 1;
      if (willContinue) {
        meta.onIterationEnd?.(node.id, i);
      }

      // Only fail-fast on non-zero exit for single-iteration nodes
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

    // Validation + retry loop.
    // The first attempt already ran via the iteration loop above
    // (lastResult/lastSessionId hold its result). When jsonSchema is set,
    // validate and possibly retry by resuming the same Claude session.
    let structuredUpdates: Record<string, unknown> = {};
    let preferredLabel: string | undefined;

    if (jsonSchema) {
      const zodSchema = config.outputs ? outputsToZod(config.outputs) : null;

      const writeRaw = (n: number, raw: string) =>
        writeFileSync(join(nodeDir, `raw-attempt-${n}.txt`), raw ?? "");

      writeRaw(1, lastResult?.output ?? "");

      const overrideRetries = (node as any).outputValidationRetries;
      const maxRetries =
        typeof overrideRetries === "number" && overrideRetries >= 0
          ? overrideRetries
          : 1;

      let attempt = 1;
      let evaluation = evaluateAgentOutput(lastResult?.output ?? "", zodSchema);

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
              `(attempt ${attempt}: ${evaluation.errors.map(e => `${e.path}: ${e.message}`).join("; ")})`,
            contextUpdates: { "agent.iterations": String(iteration), "agent.success": "false" },
          };
        }

        attempt += 1;
        meta.onValidationRetryStart?.(node.id, attempt);

        const corrective = buildCorrectiveMessage(evaluation.raw, evaluation.errors, jsonSchema);

        const retryResult = await agent.run({
          cwd, signal, variables: agentVariables, onStdout,
          resume: lastSessionId, message: corrective,
        });
        lastResult = retryResult;
        if (retryResult.sessionId) lastSessionId = retryResult.sessionId;
        iteration += 1;

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
            `Output validation failed after ${attempt} attempts: ` +
            evaluation.errors.map(e => `${e.path}: ${e.message}`).join("; "),
          contextUpdates: { "agent.iterations": String(iteration), "agent.success": "false" },
        };
      }

      for (const [key, value] of Object.entries(evaluation.parsed)) {
        structuredUpdates[key] = typeof value === "string" ? value : String(value);
      }
      if (evaluation.parsed.preferred_label != null) {
        preferredLabel = String(evaluation.parsed.preferred_label);
      }
    }

    return {
      status: "success",
      ...(preferredLabel ? { preferredLabel } : {}),
      contextUpdates: {
        ...structuredUpdates,
        "agent.iterations": String(iteration),
        "agent.success": "true",
        ...(lastSessionId ? { "agent.sessionId": lastSessionId } : {}),
      },
    };
  }
}
