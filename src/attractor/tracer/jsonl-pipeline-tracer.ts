import { appendFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import type { PipelineTracer } from "./pipeline-tracer.js";
import type { Graph, Node, PipelineContext, Outcome } from "../types.js";
import { resolveHandlerType } from "../core/graph.js";

export class JsonlPipelineTracer implements PipelineTracer {
  constructor(private tracePath: string) {
    mkdirSync(dirname(tracePath), { recursive: true });
  }

  onPipelineStart({ runId, graph }: { runId: string; graph: Graph; ctx: PipelineContext }): void {
    const nodes = graph.nodes instanceof Map
      ? [...graph.nodes.values()].map(n => n.id)
      : (graph.nodes as unknown as Node[]).map(n => n.id);
    this.append({
      kind: "pipeline-start",
      runId,
      pipelineName: graph.name,
      goal: graph.goal,
      nodes,
      timestamp: new Date().toISOString(),
    });
  }

  onNodeStart({ nodeReceiveId, node, ctx }: { nodeReceiveId: string; node: Node; ctx: PipelineContext }): void {
    this.append({
      kind: "node-start",
      nodeReceiveId,
      nodeId: node.id,
      nodeKind: resolveHandlerType(node),
      timestamp: new Date().toISOString(),
      contextSnapshot: ctx.values,
    });
  }

  onNodeEnd({ nodeReceiveId, node, outcome }: { nodeReceiveId: string; node: Node; outcome: Outcome }): void {
    const event: Record<string, unknown> = {
      kind: "node-end",
      nodeReceiveId,
      nodeId: node.id,
      success: outcome.status === "success",
      contextUpdates: outcome.contextUpdates ?? {},
    };
    if (outcome.failureReason !== undefined) {
      event.failureReason = outcome.failureReason;
    }
    this.append(event);
  }

  onPipelineEnd({ runId, outcome }: { runId: string; outcome: "success" | "failure" }): void {
    this.append({
      kind: "pipeline-end",
      runId,
      outcome,
      timestamp: new Date().toISOString(),
    });
  }

  onValidationFailure({ nodeReceiveId, node, attempt, errors, rawOutputPath }: {
    nodeReceiveId: string;
    node: Node;
    attempt: number;
    errors: Array<{ path: string; message: string }>;
    rawOutputPath: string;
  }): void {
    this.append({
      kind: "validation-failure",
      nodeReceiveId,
      nodeId: node.id,
      attempt,
      errors,
      rawOutputPath,
      timestamp: new Date().toISOString(),
    });
  }

  private append(event: object): void {
    appendFileSync(this.tracePath, JSON.stringify(event) + "\n");
  }
}
