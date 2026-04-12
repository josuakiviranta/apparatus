import { spawnSync } from "child_process";
import type { NodeHandler, HandlerExecutionContext } from "./registry.js";
import type { Node, Outcome, PipelineContext } from "../types.js";

export class ToolHandler implements NodeHandler {
  async execute(node: Node, _ctx: PipelineContext, _meta: HandlerExecutionContext): Promise<Outcome> {
    if (!node.toolCommand) {
      return { status: "fail", failureReason: "No tool_command specified on node" };
    }
    const result = spawnSync("sh", ["-c", node.toolCommand], { encoding: "utf8" });
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
