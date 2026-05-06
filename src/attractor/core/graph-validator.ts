import type { Graph, Diagnostic } from "../types.js";
import { createValidationContext } from "./validators/context.js";
import { runAllValidators } from "./validators/index.js";

export function validateGraph(graph: Graph, dotDir?: string): Diagnostic[] {
  const ctx = createValidationContext(graph, dotDir);
  runAllValidators(ctx);
  return ctx.diags;
}

export function validateOrRaise(graph: Graph): void {
  const diags = validateGraph(graph);
  const errors = diags.filter(d => d.severity === "error");
  if (errors.length > 0) {
    throw new Error("Pipeline validation failed:\n" + errors.map(e => `  [${e.rule}] ${e.message}`).join("\n"));
  }
}
