import type { NodeHandler } from "./registry.js";
import type { Node, Outcome, PipelineContext } from "../types.js";

export interface ChildStatus {
  status: "running" | "success" | "fail";
  currentNode?: string;
}

type PollFn = () => Promise<ChildStatus>;

export interface ManagerLoopConfig {
  pollIntervalMs?: number;
  maxCycles?: number;
}

export class ManagerLoopHandler implements NodeHandler {
  constructor(
    private pollChild: PollFn,
    private config: ManagerLoopConfig = {}
  ) {}

  async execute(_node: Node, _ctx: PipelineContext, _meta: Record<string, unknown>): Promise<Outcome> {
    const maxCycles = this.config.maxCycles ?? 1000;
    const pollMs = this.config.pollIntervalMs ?? 45_000;

    for (let cycle = 0; cycle < maxCycles; cycle++) {
      const child = await this.pollChild();
      if (child.status === "success") {
        return {
          status: "success",
          contextUpdates: { "stack.child.status": "success", "stack.child.outcome": "success" },
        };
      }
      if (child.status === "fail") {
        return {
          status: "fail",
          failureReason: "Child pipeline failed",
          contextUpdates: { "stack.child.status": "fail", "stack.child.outcome": "fail" },
        };
      }
      if (pollMs > 0) await new Promise(r => setTimeout(r, pollMs));
    }
    return { status: "fail", failureReason: `manager_loop exceeded max_cycles (${maxCycles})` };
  }
}
