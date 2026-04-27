import { resolveAgent, listAgents, type RegistryOptions, type AgentInfo } from "../lib/agent-registry.js";
import { type AgentConfig } from "../lib/agent.js";
import * as output from "../lib/output.js";

export async function agentListAction(opts?: RegistryOptions): Promise<AgentInfo[]> {
  const agents = listAgents(opts);

  if (agents.length === 0) {
    await output.warn("No agents found.");
    return agents;
  }

  const lines = agents.map((a) => {
    const marker = a.source === "built-in" ? "*" : "+";
    return `  ${marker} ${a.name.padEnd(20)} ${a.description}`;
  });

  const header = `  ${"Name".padEnd(22)}Description`;
  await output.info(header + "\n" + lines.join("\n") + "\n\n  * built-in  + custom");
  return agents;
}

export async function agentShowAction(
  name: string,
  opts?: RegistryOptions,
): Promise<AgentConfig> {
  let config: AgentConfig;
  try {
    config = resolveAgent(name, opts);
  } catch {
    const msg = `Unknown agent: "${name}"`;
    await output.error(msg);
    throw new Error(msg);
  }

  const toolsStr = config.tools.length > 0 ? config.tools.join(", ") : "(unrestricted)";
  const mcpStr = config.mcp.length > 0
    ? config.mcp.map((m) => m.name).join(", ")
    : "(none)";

  const display = [
    `  ${config.name} -- ${config.description}`,
    "",
    `  Model:        ${config.model}`,
    `  Permissions:  ${config.permissionMode}`,
    `  Tools:        ${toolsStr}`,
    `  MCP servers:  ${mcpStr}`,
    "",
    "  Prompt:",
    "  ---",
    config.prompt
      .split("\n")
      .map((l) => `  ${l}`)
      .join("\n"),
    "  ---",
  ].join("\n");

  await output.info(display);
  return config;
}
