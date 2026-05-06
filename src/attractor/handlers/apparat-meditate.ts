import type { NodeHandler, HandlerExecutionContext } from "./registry.js";
import type { Node, Outcome, PipelineContext } from "../types.js";
import { spawnSync } from "child_process";

export class ApparatMeditateHandler implements NodeHandler {
  async execute(node: Node, _ctx: PipelineContext, meta: HandlerExecutionContext): Promise<Outcome> {
    const cwd = meta.cwd;
    const steer = typeof node.steer === "string" ? node.steer : undefined;
    const extraArgs = steer ? ["--var", `steer=${steer}`] : [];
    const result = spawnSync(process.execPath, [process.argv[1], "meditate", cwd, ...extraArgs], {
      encoding: "utf8",
      stdio: "inherit",
    });
    if (result.status !== 0) {
      return { status: "fail", failureReason: "apparat meditate exited non-zero" };
    }
    return { status: "success" };
  }
}
