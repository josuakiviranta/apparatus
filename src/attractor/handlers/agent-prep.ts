import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import type { Node, PipelineContext, CheckpointState } from "../types.js";
import type { HandlerExecutionContext } from "./registry.js";
import { Agent, type AgentConfig } from "../../cli/lib/agent.js";
import { getIlluminationServerPath, getMetaMeditationsDir } from "../../cli/lib/assets.js";
import { buildPreamble } from "../transforms/preamble.js";
import { renderInputsBlock } from "../transforms/inputs-renderer.js";
import { extractDefaults } from "../transforms/variable-expansion.js";

/**
 * Keys auto-injected into every agent's variables by the pipeline engine.
 * Single source of truth: runtime (buildSystemInjectedVars) and graph validator
 * (bare_input_not_in_caller_inputs_or_system rule) both consume this.
 */
export const SYSTEM_INJECTED_VARS = [
  "ILLUMINATION_SERVER_PATH",
  "PROJECT_ROOT",
  "META_MEDITATIONS_DIR",
] as const;

function buildSystemInjectedVars(projectRoot: string): Record<(typeof SYSTEM_INJECTED_VARS)[number], string> {
  return {
    ILLUMINATION_SERVER_PATH: getIlluminationServerPath(),
    PROJECT_ROOT: projectRoot,
    META_MEDITATIONS_DIR: getMetaMeditationsDir(),
  };
}

export interface PreparedAgent {
  agent: Agent;
  config: AgentConfig;
  jsonSchema: string | undefined;
  agentVariables: Record<string, unknown>;
  prompt: string;
  nodeDir: string;
}

export function assembleAgentPrompt(
  node: Node,
  ctx: PipelineContext,
  meta: HandlerExecutionContext,
  load: (name: string, pipelineDir: string) => AgentConfig,
  create: (config: AgentConfig) => Agent,
): PreparedAgent | { fail: string } {
  const agentName = node.agent ?? "implement";
  if (!agentName) {
    return { fail: "Node has no agent attribute" };
  }

  let config: AgentConfig;
  try {
    config = load(agentName, meta.dotDir);
  } catch (err) {
    return { fail: `Failed to resolve agent "${agentName}": ${(err as Error).message}` };
  }

  if (node.llmModel) config = { ...config, model: node.llmModel as string };

  const { logsRoot, cwd, completedNodes, nodeRetries } = meta;

  // Dev-mode tsx swap (see agent-handler.ts:71-76 for the original justification).
  if (typeof __APPARAT_PROD__ === "undefined") {
    config = {
      ...config,
      mcp: config.mcp.map((m) => (m.command === "node" ? { ...m, command: "tsx" } : m)),
    };
  }

  const agentVariables: Record<string, unknown> = {
    ...buildSystemInjectedVars(meta.projectDir ?? cwd),
    ...ctx.values,
  };

  const jsonSchema: string | undefined = config.jsonSchema;

  const nodeDir = join(logsRoot, node.id);
  mkdirSync(nodeDir, { recursive: true });
  const agentInstructions = (config.prompt ?? "").trim();

  const declaredInputs = (config.inputs as string[] | undefined) ?? [];
  const rawDefaults = extractDefaults(node as unknown as Record<string, unknown>);
  const nodeAttrs: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rawDefaults)) nodeAttrs[`default_${k}`] = v;
  const inputsBlock = renderInputsBlock(declaredInputs, ctx.values, nodeAttrs);
  const steeringRaw = (node.prompt ?? "").trim();
  const steeringBlock = steeringRaw ? `\n\n## Steering\n\n${steeringRaw}\n` : "";
  const assembledPrompt = `${agentInstructions}\n\n---\n\n${inputsBlock}${steeringBlock}`;

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

  const agent = create({ ...config, prompt, ...(jsonSchema ? { jsonSchema } : {}) });

  return { agent, config, jsonSchema, agentVariables, prompt, nodeDir };
}
