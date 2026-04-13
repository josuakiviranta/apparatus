import { spawnSync } from "child_process";
import type { NodeHandler, HandlerExecutionContext } from "./registry.js";
import type { Node, Outcome, PipelineContext } from "../types.js";
import { expandVariables, extractDefaults } from "../transforms/variable-expansion.js";

export class ToolHandler implements NodeHandler {
  async execute(node: Node, ctx: PipelineContext, _meta: HandlerExecutionContext): Promise<Outcome> {
    if (!node.toolCommand) {
      return { status: "fail", failureReason: "No tool_command specified on node" };
    }
    const command = expandVariables(node.toolCommand, ctx.values, extractDefaults(node as unknown as Record<string, unknown>));
    const result = spawnSync("sh", ["-c", command], { encoding: "utf8" });
    const stdout = result.stdout ?? "";
    if (result.status !== 0) {
      return {
        status: "fail",
        failureReason: `Command exited with code ${result.status}: ${result.stderr ?? ""}`,
        contextUpdates: { "tool.output": stdout },
      };
    }
    return { status: "success", contextUpdates: { "tool.output": stdout } };
  }
}
