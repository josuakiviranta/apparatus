import type { Node } from "../../types.js";
import type { AgentConfig } from "../../../cli/lib/agent.js";
import { loadAgent } from "../../../cli/lib/agent-loader.js";

export function tryResolveAgent(node: Node, dotDir: string | undefined): AgentConfig | undefined {
  if (!node.agent || !dotDir) return undefined;
  try {
    return loadAgent(node.agent as string, dotDir);
  } catch {
    return undefined;
  }
}
