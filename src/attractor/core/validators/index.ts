import type { ValidationContext } from "./context.js";
import { validateNode } from "../schemas.js";
import * as flow from "./flow.js";
import * as types from "./types.js";
import * as variables from "./variables.js";
import * as scripts from "./scripts.js";
import * as inputsRefs from "./inputs-refs.js";
import * as gates from "./gates.js";

export function runAllValidators(ctx: ValidationContext): void {
  for (const node of ctx.graph.nodes.values()) {
    ctx.diags.push(...validateNode(node));
  }
  flow.run(ctx);
  types.run(ctx);
  variables.runEarly(ctx);
  scripts.run(ctx);
  inputsRefs.run(ctx);
  variables.runLate(ctx);
  gates.run(ctx);
}
