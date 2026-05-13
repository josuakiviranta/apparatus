import { z } from "zod";
import type { Node, Diagnostic } from "../types.js";

export const DEFAULT_SEED_KEY_RE = /^default[A-Z]/;
export function isDefaultSeedKey(camelKey: string): boolean {
  return DEFAULT_SEED_KEY_RE.test(camelKey);
}

export const BaseNodeSchema = z.object({
  id: z.string().describe("Node identifier (unique within the graph)."),
  shape: z.string().optional().describe("Graphviz shape; drives node-kind classification."),
  label: z.string().optional().describe("Human-readable node label shown in the TUI."),
  condition: z.string().optional().describe("Condition expression controlling edge selection."),
  class: z.string().optional().describe("Graphviz class attribute; applied by model_stylesheet."),
}).strict();

export const AgentNodeSchema = BaseNodeSchema.extend({
  agent: z.string().describe("Agent identifier (e.g. claude-code) or $variable."),
  prompt: z.string().optional().describe("Prompt text sent to the agent."),
  produces: z.string().optional().describe("Context key under which the agent result is stored."),
  maxRetries: z.coerce.number().int().nonnegative().optional().describe("Retry count on agent failure before giving up."),
  outputValidationRetries: z.coerce.number().int().nonnegative().optional()
    .describe("Number of times to retry the agent on output validation failure (default 1)."),
  retryTarget: z.string().optional().describe("Node id to jump to on retry."),
  fallbackRetryTarget: z.string().optional().describe("Node id to jump to when maxRetries exhausted."),
  interactive: z.union([z.boolean(), z.literal("true"), z.literal("false")]).optional().describe("Run the agent as an interactive TUI session."),
  goalGate: z.boolean().optional().describe("Block graph progression until agent confirms goal met."),
  loopRestart: z.boolean().optional().describe("Restart the containing loop when this node returns."),
  fidelity: z.string().optional().describe("Fidelity tier hint for model selection."),
  threadId: z.string().optional().describe("Conversation thread id to resume."),
  llmModel: z.string().optional().describe("Override LLM model for this node."),
  llmProvider: z.string().optional().describe("Override LLM provider for this node."),
  reasoningEffort: z.string().optional().describe("Reasoning-effort budget hint (low/medium/high)."),
  maxIterations: z.union([z.number(), z.string()]).optional().describe("Cap on agent loop iterations."),
}).strict();

export const ToolNodeSchema = BaseNodeSchema.extend({
  type: z.literal("tool").describe("Must be the literal \"tool\" for tool nodes."),
  cwd: z.string().min(1).describe("Required working directory (literal or $project / $run_id)."),
  toolCommand: z.string().optional().describe("Inline shell command (mutually exclusive with scriptFile)."),
  scriptFile: z.string().optional().describe("Path to script file resolved relative to the .dot file's dir."),
  scriptArgs: z.string().optional().describe("Whitespace-split args passed after the script path."),
  producesFromStdout: z.union([z.boolean(), z.literal("true")]).optional().describe("Parse last stdout line as JSON and merge into context."),
  produces: z.string().optional().describe("Context key under which the tool stdout is stored."),
}).strict()
  .refine(n => !(n.toolCommand && n.scriptFile), {
    message: "script_command_conflict: toolCommand and scriptFile are mutually exclusive",
  })
  .refine(n => n.toolCommand || n.scriptFile, {
    message: "tool_node_needs_command_or_script",
  });

export const GateNodeSchema = BaseNodeSchema.extend({
  shape: z.literal("hexagon").describe("Must be the literal \"hexagon\" for gate nodes."),
  label: z.string().min(1).optional().describe("Inline question/choice label shown to the user. Omit when using a sibling <id>.md file instead."),
}).strict();

export const GateMdFrontmatterSchema = z.object({
  type: z.literal("gate").describe("Discriminator — must be the literal \"gate\"."),
  choices: z.array(z.string().min(1)).min(1, "gate choices: must declare at least one choice").describe("Ordered list of choices presented to the user at this gate."),
  inputs: z.array(z.string().min(1)).optional().describe("Context keys this gate reads from upstream nodes."),
  // model + thinking on gate frontmatter is accepted for uniformity with agent
  // frontmatter (design 2026-05-14 §3.5). Gates do not spawn claude, so the
  // values are documentary — they surface in the `apparat pipeline show` label
  // render. The validator pass (Chunk 2) is the source of enforcement; here we
  // simply allow the keys so .strict() does not reject migrated gate files.
  model: z.string().optional().describe("Optional model tier for documentation/rendering — gates do not spawn claude."),
  thinking: z.string().optional().describe("Optional thinking budget for documentation/rendering — gates do not spawn claude."),
}).strict();

export type GateMdFrontmatter = z.infer<typeof GateMdFrontmatterSchema>;

export const StartNodeSchema = BaseNodeSchema.extend({
  shape: z.literal("Mdiamond").describe("Must be the literal \"Mdiamond\" for the start node."),
}).strict();

export const ExitNodeSchema = BaseNodeSchema.extend({
  shape: z.literal("Msquare").describe("Must be the literal \"Msquare\" for the exit node."),
}).strict();

export type NodeKind = "tool" | "agent" | "gate" | "start" | "exit";

const SCHEMAS = {
  tool: ToolNodeSchema,
  agent: AgentNodeSchema,
  gate: GateNodeSchema,
  start: StartNodeSchema,
  exit: ExitNodeSchema,
} as const;

export function classifyNode(node: Node): NodeKind | null {
  if (node.type === "tool") return "tool";
  if (node.shape === "Mdiamond") return "start";
  if (node.shape === "Msquare") return "exit";
  if (node.shape === "hexagon") return "gate";
  if (typeof node.agent === "string") return "agent";
  // Nodes with custom type= or unrecognized shapes fall through to unknown —
  // they already receive a `type_known` warning from validateGraph; skip schema.
  return null;
}

export interface AttrDescriptor {
  camelKey: string;
  snakeKey: string;
  description: string;
  required: boolean;
}

export function camelToSnake(key: string): string {
  return key.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`);
}

function rootShape(schema: z.ZodTypeAny): z.ZodRawShape | null {
  // Unwrap ZodEffects (from .refine()) until we hit the underlying ZodObject.
  let s: any = schema;
  while (s && s._def && s._def.typeName === "ZodEffects") s = s._def.schema;
  if (s && typeof s.shape === "object") return s.shape;
  return null;
}

export function describeKind(kind: NodeKind): AttrDescriptor[] {
  const schema = SCHEMAS[kind];
  const shape = rootShape(schema);
  if (!shape) return [];
  return Object.entries(shape).map(([camelKey, field]) => {
    const f = field as z.ZodTypeAny;
    return {
      camelKey,
      snakeKey: camelToSnake(camelKey),
      description: f._def.description ?? "",
      required: !f.isOptional(),
    };
  });
}

export function formatAllowedAttrs(kind: NodeKind): string {
  const entries = describeKind(kind);
  const width = Math.max(...entries.map(e => e.snakeKey.length), 0);
  const lines = entries.map(e => {
    const req = e.required ? " (required)" : "";
    const pad = e.snakeKey.padEnd(width);
    return `  ${pad}  ${e.description}${req}`;
  });
  const seedRule = (kind === "agent" || kind === "gate" || kind === "tool")
    ? `\n  default_<varname>  seeds $varname when no upstream node has produced it.`
    : "";
  return `Allowed keys for kind=${kind}:\n${lines.join("\n")}${seedRule}`;
}

export function validateNode(node: Node): Diagnostic[] {
  const kind = classifyNode(node);
  if (kind === null) return [];
  const schema = SCHEMAS[kind];
  // Strip internal parser metadata before schema validation so strict schemas
  // don't flag these fields as unrecognized keys.
  const {
    sourceLine: _sl,
    sourceLocation: _slo,
    attrLocations: _al,
    ...nodeForValidation
  } = node as Node & { sourceLocation?: unknown; attrLocations?: unknown };
  const result = schema.safeParse(nodeForValidation);
  if (result.success) return [];
  const diags: Diagnostic[] = [];
  for (const issue of result.error.issues) {
    if (issue.code === "unrecognized_keys") {
      const keys = (issue as { keys?: string[] }).keys ?? [];
      const filtered = (kind === "agent" || kind === "gate" || kind === "tool")
        ? keys.filter(k => !isDefaultSeedKey(k))
        : keys;
      for (const key of filtered) {
        const snake = camelToSnake(key);
        diags.push({
          rule: "schema_error",
          severity: "error",
          message: `[${node.id}]: unrecognized key '${snake}'`,
          hint: formatAllowedAttrs(kind),
          location: (node.attrLocations?.[key] as import("../types.js").SourceLocation | undefined) ?? node.sourceLocation,
        });
      }
      continue;
    }
    const path = issue.path.join(".");
    const loc = path ? camelToSnake(path) : "node";
    const firstPath = typeof issue.path[0] === "string" ? issue.path[0] : undefined;
    const attrLoc = firstPath ? node.attrLocations?.[firstPath] : undefined;
    diags.push({
      rule: "schema_error",
      severity: "error",
      message: `[${node.id}] ${loc}: ${issue.message}`,
      location: (attrLoc as import("../types.js").SourceLocation | undefined) ?? node.sourceLocation,
    });
  }
  return diags;
}
