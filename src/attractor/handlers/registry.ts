import type { Node, Outcome, PipelineContext } from "../types.js";
import type { Session } from "../../cli/lib/session.js";
import type { ChildHandle } from "../../cli/lib/agent.js";

export interface InteractiveRequest {
  session: Session;
  child: ChildHandle;
  tracePath: string;
}

export type OnInteractiveRequest = (req: InteractiveRequest) => Promise<void>;

export interface HandlerExecutionContext {
  logsRoot: string;
  cwd: string;
  dotDir: string;
  signal?: AbortSignal;
  outgoingLabels: string[];
  completedNodes: string[];
  nodeRetries: Record<string, number>;
  branchOutcomes?: Record<string, Outcome>;
  onStdout?: (s: NodeJS.ReadableStream) => Promise<void>;
  onInteractiveRequest?: OnInteractiveRequest;
  /** Called before iteration i (i > 0) — pipeline.ts opens a new TUI block */
  onIterationStart?: (nodeId: string, iterationIndex: number) => void;
  /** Called after iteration i when more iterations will follow — pipeline.ts closes current TUI block */
  onIterationEnd?: (nodeId: string, iterationIndex: number) => void;
  /** Absolute path to the project root — used for project-local agent resolution */
  projectDir?: string;
}

export interface NodeHandler {
  execute(node: Node, ctx: PipelineContext, meta: HandlerExecutionContext): Promise<Outcome>;
}
