import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import type { NodeHandler } from "./registry.js";
import type { Node, Outcome, PipelineContext } from "../types.js";
import type { LoopOptions, LoopResult } from "../../cli/lib/loop.js";

type RunLoopFn = (opts: LoopOptions) => Promise<LoopResult>;

export class CodergenHandler implements NodeHandler {
  constructor(private runLoop: RunLoopFn) {}

  async execute(node: Node, _ctx: PipelineContext, meta: Record<string, unknown>): Promise<Outcome> {
    const logsRoot = meta["logsRoot"] as string;
    const cwd = meta["cwd"] as string;
    const signal = meta["signal"] as AbortSignal | undefined;

    const nodeDir = join(logsRoot, node.id);
    await mkdir(nodeDir, { recursive: true });

    const prompt = (node.prompt ?? node.label ?? "");
    const promptFile = join(nodeDir, "prompt.md");
    await writeFile(promptFile, prompt, "utf8");

    let result: LoopResult;
    try {
      result = await this.runLoop({
        promptFile,
        cwd,
        model: (node.llmModel as string | undefined) ?? "sonnet",
        max: (node.maxIterations as number | undefined),
        signal,
      });
    } catch (err) {
      return { status: "fail", failureReason: (err as Error).message };
    }

    const contextUpdates: Record<string, string> = {
      "implement.iterations": String(result.iterations),
      "implement.success": String(result.success),
    };
    if (result.sessionId) contextUpdates["implement.sessionId"] = result.sessionId;

    return {
      status: result.success ? "success" : "fail",
      contextUpdates,
      failureReason: result.success ? undefined : (result.errorMessage ?? result.exitReason),
    };
  }
}
