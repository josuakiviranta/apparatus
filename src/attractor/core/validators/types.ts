import type { ValidationContext } from "./context.js";
import { KNOWN_TYPES, UNIMPLEMENTED_TYPES, resolveHandlerType } from "../graph.js";

export function run(ctx: ValidationContext): void {
  for (const node of ctx.graph.nodes.values()) {
    const t = resolveHandlerType(node);
    if (!KNOWN_TYPES.has(t)) ctx.diags.push({ rule: "type_known", severity: "warning", message: `Unknown handler type "${t}" on node "${node.id}"`, location: node.sourceLocation });
    if (UNIMPLEMENTED_TYPES.has(t)) ctx.diags.push({ rule: "type_unsupported", severity: "error", message: `Node type "${t}" is declared but not yet implemented (node "${node.id}")`, location: node.sourceLocation });
  }
}
