import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { parseFrontmatter } from "./frontmatter.js";
import { validateAgentConfig, type AgentConfig } from "./agent.js";

export function parseAgentFile(content: string): AgentConfig {
  const { attributes, body } = parseFrontmatter(content);
  return validateAgentConfig({ ...attributes, prompt: body } as any);
}

export function loadAgent(name: string, pipelineDir: string): AgentConfig {
  const path = join(pipelineDir, `${name}.md`);
  if (!existsSync(path)) {
    throw new Error(`Agent file not found: ${path}`);
  }
  return parseAgentFile(readFileSync(path, "utf-8"));
}
