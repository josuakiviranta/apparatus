import { mkdirSync, writeFileSync } from "fs";
import { basename, join } from "path";
import type { Node, PipelineContext, CheckpointState } from "../types.js";
import type { HandlerExecutionContext } from "./registry.js";
import { Agent, type AgentConfig } from "../../cli/lib/agent.js";
import { getIlluminationServerPath } from "../../cli/lib/assets.js";
import { buildPreamble } from "../transforms/preamble.js";
import { renderInputsBlock } from "../transforms/inputs-renderer.js";
import { extractDefaults } from "../transforms/variable-expansion.js";
import { isInteractiveAgent } from "../core/graph.js";
import { GROUNDED_OPENING_BLOCK } from "../transforms/grounded-opening.js";

/**
 * Keys auto-injected into every agent's variables by the pipeline engine.
 * Single source of truth: runtime (buildSystemInjectedVars) and graph validator
 * (bare_input_not_in_caller_inputs_or_system rule) both consume this.
 */
export const SYSTEM_INJECTED_VARS = [
  "ILLUMINATION_SERVER_PATH",
  "PROJECT_ROOT",
  "NODE_ID",
  "PIPELINE_NAME",
  "AGENT_FILE_PATH",
] as const;

function buildSystemInjectedVars(
  projectRoot: string,
  nodeId: string,
  pipelineDir: string,
  agentName: string,
): Record<(typeof SYSTEM_INJECTED_VARS)[number], string> {
  return {
    ILLUMINATION_SERVER_PATH: getIlluminationServerPath(),
    PROJECT_ROOT: projectRoot,
    NODE_ID: nodeId,
    PIPELINE_NAME: basename(pipelineDir),
    AGENT_FILE_PATH: join(pipelineDir, `${agentName}.md`),
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

/**
 * Pure prompt-skeleton produced by `buildAgentPrompt`. Carries every piece
 * the runtime wrapper needs to instantiate an Agent and write `prompt.md`,
 * but performs no filesystem I/O itself beyond the caller-injected `load`.
 */
export interface BuiltPrompt {
  prompt: string;
  inputsBlock: string;
  jsonSchema: string | undefined;
  agentVariables: Record<string, unknown>;
  config: AgentConfig;
  /** Path the runtime would `mkdir`+write into. NOT created here. */
  nodeDir: string;
}

/**
 * Pure (modulo the caller-injected `load` reading the agent .md). Used by both
 * the runtime wrapper (`assembleAgentPrompt`) and design-time tools
 * (`apparat pipeline explain <pipeline> <nodeId>`).
 */
export function buildAgentPrompt(
  node: Node,
  ctx: PipelineContext,
  meta: HandlerExecutionContext,
  load: (name: string, pipelineDir: string) => AgentConfig,
): BuiltPrompt | { fail: string } {
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

  if (node.llmModel) config = { ...config, model: node.llmModel as AgentConfig["model"] };

  const { logsRoot, cwd, completedNodes, nodeRetries } = meta;

  // Dev-mode tsx swap (see agent-handler.ts:71-76 for the original justification).
  if (typeof __APPARAT_PROD__ === "undefined") {
    config = {
      ...config,
      mcp: config.mcp.map((m) => (m.command === "node" ? { ...m, command: "tsx" } : m)),
    };
  }

  const agentVariables: Record<string, unknown> = {
    ...buildSystemInjectedVars(meta.projectDir ?? cwd, node.id, meta.dotDir, agentName),
    ...ctx.values,
  };

  const jsonSchema: string | undefined = config.jsonSchema;

  const nodeDir = join(logsRoot, node.id);
  const agentInstructions = (config.prompt ?? "").trim();

  const declaredInputs = (config.inputs as string[] | undefined) ?? [];
  const rawDefaults = extractDefaults(node as unknown as Record<string, unknown>);
  const nodeAttrs: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rawDefaults)) nodeAttrs[`default_${k}`] = v;
  const inputsBlock = renderInputsBlock(declaredInputs, agentVariables, nodeAttrs);
  const steeringRaw = (node.prompt ?? "").trim();
  const steeringBlock = steeringRaw ? `\n\n## Steering\n\n${steeringRaw}\n` : "";
  const orientationBlock = isInteractiveAgent(node)
    ? `\n\n---\n\n${GROUNDED_OPENING_BLOCK}`
    : "";
  const assembledPrompt = `${agentInstructions}\n\n---\n\n${inputsBlock}${steeringBlock}${orientationBlock}`;

  const fidelity = (node.fidelity as string | undefined) ?? "compact";
  const preamble = buildPreamble(
    { timestamp: "", currentNode: node.id, completedNodes, nodeRetries, context: ctx.values } as CheckpointState,
    fidelity,
  );
  const jsonWrappedPrompt = jsonSchema
    ? `IMPORTANT: Your FINAL response MUST be valid JSON matching this schema. No markdown, no preamble, output ONLY the JSON object.\nSchema: ${jsonSchema}\n\n${assembledPrompt}\n\nREMINDER: Output MUST be valid JSON matching the schema above. No markdown, no explanation.`
    : assembledPrompt;
  const prompt = preamble + jsonWrappedPrompt;

  return { prompt, inputsBlock, jsonSchema, agentVariables, config, nodeDir };
}

/**
 * Runtime wrapper. Preserves today's exported signature exactly so the two
 * existing call sites (`looping-agent-handler.ts:27`, `interactive-agent-handler.ts:26`)
 * and the existing tests compile unchanged.
 */
export function assembleAgentPrompt(
  node: Node,
  ctx: PipelineContext,
  meta: HandlerExecutionContext,
  load: (name: string, pipelineDir: string) => AgentConfig,
  create: (config: AgentConfig) => Agent,
): PreparedAgent | { fail: string } {
  const built = buildAgentPrompt(node, ctx, meta, load);
  if ("fail" in built) return built;

  mkdirSync(built.nodeDir, { recursive: true });
  writeFileSync(join(built.nodeDir, "prompt.md"), built.prompt);

  const agent = create({
    ...built.config,
    prompt: built.prompt,
    ...(built.jsonSchema ? { jsonSchema: built.jsonSchema } : {}),
  });

  return {
    agent,
    config: built.config,
    jsonSchema: built.jsonSchema,
    agentVariables: built.agentVariables,
    prompt: built.prompt,
    nodeDir: built.nodeDir,
  };
}
