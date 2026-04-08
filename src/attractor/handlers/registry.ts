import type { Node, Outcome, PipelineContext } from "../types.js";

export interface NodeHandler {
  execute(node: Node, ctx: PipelineContext, meta: Record<string, unknown>): Promise<Outcome>;
}

const handlers = new Map<string, NodeHandler>();

export function registerHandler(type: string, handler: NodeHandler): void {
  handlers.set(type, handler);
}

export function lookupHandler(type: string): NodeHandler | null {
  return handlers.get(type) ?? null;
}

export function clearHandlers(): void {
  handlers.clear();
}
