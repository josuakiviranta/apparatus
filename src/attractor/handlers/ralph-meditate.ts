import type { NodeHandler } from "./registry.js";
import type { Node, Outcome, PipelineContext } from "../types.js";
import { spawnSync } from "child_process";

export class RalphMeditateHandler implements NodeHandler {
  async execute(_node: Node, _ctx: PipelineContext, meta: Record<string, unknown>): Promise<Outcome> {
    const cwd = meta["cwd"] as string;
    const result = spawnSync(process.execPath, [process.argv[1], cwd, "meditate"], {
      encoding: "utf8",
      stdio: "inherit",
    });
    if (result.status !== 0) {
      return { status: "fail", failureReason: "ralph meditate exited non-zero" };
    }
    return { status: "success" };
  }
}
