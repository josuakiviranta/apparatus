export type OutcomeStatus = "success" | "retry" | "fail" | "partial_success";

export interface Outcome {
  status: OutcomeStatus;
  notes?: string;
  failureReason?: string;
  preferredLabel?: string;
  suggestedNextIds?: string[];
  contextUpdates?: Record<string, string>;
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
  maxIterations?: number;
  reasoningEffort?: string;
  retryTarget?: string;
  fallbackRetryTarget?: string;
  agent?: string;
  class?: string;
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
  nodes: Map<string, Node>;
  edges: Edge[];
}

export interface CheckpointState {
  timestamp: string;
  currentNode: string;
  completedNodes: string[];
  nodeRetries: Record<string, number>;
  context: Record<string, string>;
}

export interface PipelineContext {
  values: Record<string, string>;
}

export type Transform = (graph: Graph) => Graph;

export interface Diagnostic {
  rule: string;
  severity: "error" | "warning";
  message: string;
}
