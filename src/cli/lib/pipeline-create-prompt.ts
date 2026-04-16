import { readFileSync } from "fs";
import { join } from "path";
import { getPipelineCreatePromptPath } from "./assets.js";
import { listAgents, type RegistryOptions } from "./agent-registry.js";

function buildAgentSection(project: string): string {
  const opts: RegistryOptions = { userDir: join(project, ".ralph", "agents") };
  const agents = listAgents(opts);
  if (agents.length === 0) return "";
  const rows = agents
    .map((a) => `| \`${a.name}\` | ${a.description} | ${a.source} |`)
    .join("\n");
  return [
    "",
    "## Available agents in this project",
    "",
    "Use `agent=\"name\"` to route a node to one of these agents.",
    "Prefer `agent=\"$variable_name\"` and declare the variable in `inputs=` for portability.",
    "",
    "| name | description | source |",
    "|------|-------------|--------|",
    rows,
    "",
  ].join("\n");
}

export function composeCreatePrompt(project: string): string {
  const base = readFileSync(getPipelineCreatePromptPath(), "utf-8");
  const agentSection = buildAgentSection(project);
  return agentSection ? base + agentSection : base;
}
