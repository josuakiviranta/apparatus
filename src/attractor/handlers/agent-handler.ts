import { mkdirSync, writeFileSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { randomUUID } from "crypto";
import type { NodeHandler } from "./registry.js";
import type { Node, Outcome, PipelineContext, CheckpointState } from "../types.js";
import { Agent, type AgentConfig, type RunResult, type ChildHandle } from "../../cli/lib/agent.js";
import { resolveAgent as defaultResolveAgent } from "../../cli/lib/agent-registry.js";
import { buildPreamble } from "../transforms/preamble.js";
import { expandVariables } from "../transforms/variable-expansion.js";
import { Session, buildSessionDigest, type ExitReason } from "../../cli/lib/session.js";
import React from "react";

export interface InteractiveRequest {
  session: Session;
  child: ChildHandle;
  tracePath: string;
}

export type OnInteractiveRequest = (req: InteractiveRequest) => Promise<void>;

export type InkRenderFn = (
  element: React.ReactElement,
) => { unmount: () => void; waitUntilExit: () => Promise<void> };

export interface AgentHandlerDeps {
  resolveAgent?: (name: string) => AgentConfig;
  createAgent?: (config: AgentConfig) => Agent;
  render?: InkRenderFn;
}

export class AgentHandler implements NodeHandler {
  private resolve: (name: string) => AgentConfig;
  private create: (config: AgentConfig) => Agent;
  private render: InkRenderFn | null;

  constructor(deps?: AgentHandlerDeps) {
    this.resolve = deps?.resolveAgent ?? defaultResolveAgent;
    this.create = deps?.createAgent ?? ((c) => new Agent(c));
    this.render = deps?.render ?? null;
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

    // Read JSON schema from file if specified
    const jsonSchemaFile = node.jsonSchemaFile as string | undefined;
    let jsonSchema: string | undefined;
    if (jsonSchemaFile) {
      try {
        jsonSchema = readFileSync(resolve(cwd, jsonSchemaFile), "utf8");
      } catch (err) {
        return { status: "fail", failureReason: `Failed to read json_schema_file "${jsonSchemaFile}": ${(err as Error).message}` };
      }
    }
    const signal = meta["signal"] as AbortSignal | undefined;
    const onStdout = meta["onStdout"] as ((s: NodeJS.ReadableStream) => Promise<void>) | undefined;
    // DOT attributes parse as strings; coerce explicitly to boolean
    const interactive = node.interactive === true || node.interactive === "true";

    // Build prompt with pipeline context preamble
    const nodeDir = join(logsRoot, node.id);
    mkdirSync(nodeDir, { recursive: true });
    const rawPrompt = node.prompt ?? node.label ?? config.prompt;
    const expandedRawPrompt = expandVariables(rawPrompt, ctx.values);
    const fidelity = (node.fidelity as string | undefined) ?? "compact";
    const completedNodes = (meta["completedNodes"] as string[]) ?? [];
    const nodeRetries = (meta["nodeRetries"] as Record<string, number>) ?? {};
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
          failureReason: "interactive=true cannot be combined with json_schema_file: structured output is incompatible with live chat streaming",
        };
      }

      const sessionId = randomUUID();
      const session = new Session(sessionId);
      const systemPrompt = prompt;

      const child: ChildHandle = agent.runInteractive({
        session,
        systemPrompt,
        cwd,
        variables: ctx.values,
      });

      // Lazy-load Ink render and ChatUI
      let renderFn = this.render;
      let ChatUIComponent: any;
      if (!renderFn) {
        const ink = await import("ink");
        renderFn = ink.render as unknown as InkRenderFn;
      }
      const chatUiModule = await import("../../cli/components/ChatUI.js");
      ChatUIComponent = chatUiModule.ChatUI;

      await new Promise<ExitReason>((resolvePromise) => {
        let handled = false;
        const handleExit = (reason: ExitReason) => {
          if (handled) return;
          handled = true;
          resolvePromise(reason);
        };
        const instance = renderFn!(
          React.createElement(ChatUIComponent, { session, child, onExit: handleExit }),
        );
        child.exited.finally(() => {
          try { instance.unmount(); } catch {}
        });
      });

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

    const maxIterations = (node.maxIterations as number | undefined) ?? 1;

    let lastResult: RunResult | null = null;
    let lastSessionId: string | null = null;
    let iteration = 0;

    for (let i = 0; i < maxIterations; i++) {
      if (signal?.aborted) break;

      const result = await agent.run({
        cwd,
        signal,
        variables: ctx.values,
        onStdout,
      });

      lastResult = result;
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

    // Parse structured output if jsonSchema was set
    let structuredUpdates: Record<string, unknown> = {};
    let preferredLabel: string | undefined;

    // Fail explicitly if jsonSchema was set but agent produced no output
    if (jsonSchema && !lastResult?.output) {
      return {
        status: "fail",
        failureReason: "Structured output: agent produced no output (possible timeout or token limit)",
        contextUpdates: {
          "agent.iterations": String(iteration),
          "agent.success": "false",
        },
      };
    }

    if (jsonSchema && lastResult?.output) {
      writeFileSync(join(nodeDir, "raw-output.txt"), lastResult.output);
      try {
        // Claude CLI --output-format json emits a JSON array of events on one line.
        // Claude CLI --output-format stream-json emits NDJSON (one event per line).
        // Handle both: try JSON array first, fall back to NDJSON line-by-line.
        const trimmed = lastResult.output.trim();
        const events: unknown[] = [];

        try {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed)) {
            events.push(...parsed);
          } else {
            events.push(parsed);
          }
        } catch {
          // Not a single JSON value — try NDJSON line-by-line
          for (const line of trimmed.split("\n")) {
            try { events.push(JSON.parse(line)); } catch { /* skip non-JSON */ }
          }
        }

        // Find the last {type:"result"} event.
        // structured_output (json-schema mode) takes priority over result field.
        let resultPayload: string | undefined;

        for (const evt of events) {
          const event = evt as Record<string, unknown>;
          if (event?.type !== "result") continue;

          if (event.structured_output != null) {
            resultPayload = typeof event.structured_output === "string"
              ? event.structured_output
              : JSON.stringify(event.structured_output);
          } else if (event.result != null && event.result !== "") {
            resultPayload = typeof event.result === "string"
              ? event.result
              : JSON.stringify(event.result);
          }
        }

        if (!resultPayload) {
          return {
            status: "fail",
            failureReason: `Structured output: no {type:"result"} event found in ${events.length} events`,
            contextUpdates: {
              "agent.iterations": String(iteration),
              "agent.success": "false",
            },
          };
        }

        const parsed = JSON.parse(resultPayload);
        for (const [key, value] of Object.entries(parsed)) {
          structuredUpdates[key] = String(value);
        }
        if (parsed.preferred_label != null) {
          preferredLabel = String(parsed.preferred_label);
        }
      } catch (err) {
        return {
          status: "fail",
          failureReason: `Structured output parsing failed: ${(err as Error).message}`,
          contextUpdates: {
            "agent.iterations": String(iteration),
            "agent.success": "false",
          },
        };
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
