export type OutcomeStatus = "success" | "retry" | "fail" | "partial_success";

export interface Outcome {
  status: OutcomeStatus;
  notes?: string;
  failureReason?: string;
  preferredLabel?: string;
  suggestedNextIds?: string[];
  contextUpdates?: Record<string, unknown>;
}

export interface Node {
  id: string;
  shape?: string;
  type?: string;
  label?: string;
  prompt?: string;
  toolCommand?: string;
  goalGate?: boolean;
  loopRestart?: boolean;
  maxRetries?: number;
  fidelity?: string;
  threadId?: string;
  llmModel?: string;
  llmProvider?: string;
  maxIterations?: number | string;
  reasoningEffort?: string;
  retryTarget?: string;
  fallbackRetryTarget?: string;
  agent?: string;
  interactive?: boolean | string;
  jsonSchemaFile?: string;
  class?: string;
  /** 1-based line in the source .dot file where this node was declared. */
  sourceLine?: number;
  [key: string]: unknown;
}

export interface Edge {
  from: string;
  to: string;
  label?: string;
  condition?: string;
  weight?: number;
  loopRestart?: boolean;
  fidelity?: string;
  threadId?: string;
  [key: string]: unknown;
}

export interface Graph {
  name: string;
  goal?: string;
  label?: string;
  modelStylesheet?: string;
  defaultMaxRetries?: number;
  defaultFidelity?: string;
  maxParallel?: number;
  retryTarget?: string;
  fallbackRetryTarget?: string;
  headlessSafe?: boolean;
  /** Caller-provided variable names declared via the `inputs=` graph attribute. */
  inputs?: string[];
  nodes: Map<string, Node>;
  edges: Edge[];
}

export interface CheckpointState {
  timestamp: string;
  currentNode: string;
  completedNodes: string[];
  nodeRetries: Record<string, number>;
  context: Record<string, unknown>;
}

export interface PipelineContext {
  values: Record<string, unknown>;
}

export type Transform = (graph: Graph) => Graph;

export interface Diagnostic {
  rule: string;
  severity: "error" | "warning";
  message: string;
}
