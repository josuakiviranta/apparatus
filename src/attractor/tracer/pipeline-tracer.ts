// src/attractor/tracer/pipeline-tracer.ts
import type { Graph, Node, PipelineContext, Outcome } from "../types.js";

export interface PipelineTracer {
  onPipelineStart(meta: { runId: string; graph: Graph; ctx: PipelineContext }): void;
  onNodeStart(meta: { nodeReceiveId: string; node: Node; ctx: PipelineContext }): void;
  onNodeEnd(meta: { nodeReceiveId: string; node: Node; outcome: Outcome }): void;
  onPipelineEnd(meta: { runId: string; outcome: "success" | "failure" }): void;
}
