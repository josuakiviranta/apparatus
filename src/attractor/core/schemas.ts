import { z } from "zod";

export const BaseNodeSchema = z.object({
  id: z.string(),
  shape: z.string().optional(),
  label: z.string().optional(),
  condition: z.string().optional(),
  class: z.string().optional(),
}).strict();

export const AgentNodeSchema = BaseNodeSchema.extend({
  agent: z.string(),
  prompt: z.string(),
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
