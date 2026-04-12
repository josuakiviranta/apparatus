import { mkdir, writeFile } from "fs/promises";
import { dirname } from "path";
import type { NodeHandler, HandlerExecutionContext } from "./registry.js";
import type { Node, Outcome, PipelineContext } from "../types.js";
import { expandVariables } from "../transforms/variable-expansion.js";

export class StoreHandler implements NodeHandler {
  async execute(node: Node, ctx: PipelineContext, _meta: HandlerExecutionContext): Promise<Outcome> {
    const storeKey = node.storeKey as string | undefined;
    const storeFile = node.storeFile as string | undefined;

    if (!storeKey) {
      return { status: "fail", failureReason: "store_key attribute required" };
    }
    if (!storeFile) {
      return { status: "fail", failureReason: "store_file attribute required" };
    }

    const value = ctx.values[storeKey];
    if (value === undefined) {
      return { status: "fail", failureReason: `store_key '${storeKey}' not found in context` };
    }

    const resolvedPath = expandVariables(storeFile, ctx.values);
    const content = typeof value === "string" ? value : JSON.stringify(value);

    try {
      await mkdir(dirname(resolvedPath), { recursive: true });
      await writeFile(resolvedPath, content, "utf8");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { status: "fail", failureReason: msg };
    }

    return { status: "success", contextUpdates: { "store.path": resolvedPath } };
  }
}
