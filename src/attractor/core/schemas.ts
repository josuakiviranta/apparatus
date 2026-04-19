import { z } from "zod";
import type { Node, Diagnostic } from "../types.js";

export const BaseNodeSchema = z.object({
  id: z.string(),
  shape: z.string().optional(),
  label: z.string().optional(),
  condition: z.string().optional(),
  class: z.string().optional(),
}).strict();

export const AgentNodeSchema = BaseNodeSchema.extend({
  agent: z.string(),
  prompt: z.string().optional(),
  jsonSchemaFile: z.string().optional(),
  produces: z.string().optional(),
  maxRetries: z.coerce.number().int().nonnegative().optional(),
  retryTarget: z.string().optional(),
  fallbackRetryTarget: z.string().optional(),
  interactive: z.union([z.boolean(), z.literal("true"), z.literal("false")]).optional(),
  goalGate: z.boolean().optional(),
  loopRestart: z.boolean().optional(),
  fidelity: z.string().optional(),
  threadId: z.string().optional(),
  llmModel: z.string().optional(),
  llmProvider: z.string().optional(),
  reasoningEffort: z.string().optional(),
  maxIterations: z.union([z.number(), z.string()]).optional(),
  defaultRefinements: z.string().optional(),
  defaultChatNotesPath: z.string().optional(),
  defaultTestResult: z.string().optional(),
  defaultTestSummary: z.string().optional(),
}).strict();

export const ToolNodeSchema = BaseNodeSchema.extend({
  type: z.literal("tool"),
  cwd: z.string().min(1),
  toolCommand: z.string().optional(),
  scriptFile: z.string().optional(),
  scriptArgs: z.string().optional(),
  producesFromStdout: z.union([z.boolean(), z.literal("true")]).optional(),
  produces: z.string().optional(),
}).strict()
  .refine(n => !(n.toolCommand && n.scriptFile), {
    message: "script_command_conflict: toolCommand and scriptFile are mutually exclusive",
  })
  .refine(n => n.toolCommand || n.scriptFile, {
    message: "tool_node_needs_command_or_script",
  });

export const GateNodeSchema = BaseNodeSchema.extend({
  shape: z.literal("hexagon"),
  label: z.string().min(1),
  defaultRefinements: z.string().optional(),
}).strict();

export const StartNodeSchema = BaseNodeSchema.extend({
  shape: z.literal("Mdiamond"),
}).strict();

export const ExitNodeSchema = BaseNodeSchema.extend({
  shape: z.literal("Msquare"),
}).strict();

export type NodeKind = "tool" | "agent" | "gate" | "start" | "exit";

const SCHEMAS = {
  tool: ToolNodeSchema,
  agent: AgentNodeSchema,
  gate: GateNodeSchema,
  start: StartNodeSchema,
  exit: ExitNodeSchema,
} as const;

export function classifyNode(node: Node): NodeKind {
  if (node.type === "tool") return "tool";
  if (node.shape === "Mdiamond") return "start";
  if (node.shape === "Msquare") return "exit";
  if (node.shape === "hexagon") return "gate";
  if (typeof node.agent === "string") return "agent";
  return "agent";
}

export function validateNode(node: Node): Diagnostic[] {
  const kind = classifyNode(node);
  const schema = SCHEMAS[kind];
  const result = schema.safeParse(node);
  if (result.success) return [];
  return result.error.issues.map(issue => ({
    rule: "schema_error",
    severity: "error" as const,
    message: `[${node.id}] ${issue.path.join(".") || "<node>"}: ${issue.message}`,
  }));
}
