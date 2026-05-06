import type { Graph, Diagnostic } from "../types.js";
import { validateNode } from "./schemas.js";
import { createValidationContext } from "./validators/context.js";
import * as flow from "./validators/flow.js";
import * as types from "./validators/types.js";
import * as scripts from "./validators/scripts.js";
import * as variables from "./validators/variables.js";
import * as gates from "./validators/gates.js";
import * as inputsRefs from "./validators/inputs-refs.js";

export function validateGraph(graph: Graph, dotDir?: string): Diagnostic[] {
  const ctx = createValidationContext(graph, dotDir);
  const diags: Diagnostic[] = ctx.diags;
  for (const node of graph.nodes.values()) {
    diags.push(...validateNode(node));
  }
  flow.run(ctx);

  // type_known warning + unimplemented type errors
  types.run(ctx);

  variables.runEarly(ctx);

  scripts.run(ctx);

  inputsRefs.run(ctx);

  // required_caller_vars — info banner listing vars that must be supplied via --var
  variables.runLate(ctx);

  gates.run(ctx);

  return diags;
}

export function validateOrRaise(graph: Graph): void {
  const diags = validateGraph(graph);
  const errors = diags.filter(d => d.severity === "error");
  if (errors.length > 0) {
    throw new Error("Pipeline validation failed:\n" + errors.map(e => `  [${e.rule}] ${e.message}`).join("\n"));
  }
}
