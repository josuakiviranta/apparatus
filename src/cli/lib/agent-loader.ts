import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { parseFrontmatter } from "./frontmatter.js";
import {
  validateAgentConfig,
  type AgentConfig,
  type AgentMetadata,
} from "./agent.js";

export function parseAgentFile(content: string): AgentConfig {
  const { attributes, body } = parseFrontmatter(content);
  return validateAgentConfig({ ...attributes, prompt: body } as any);
}

/**
 * Project an AgentConfig into the renderer-visible label set used by
 * `apparat pipeline show`. Single reader of "what's a label?" — callers
 * import metadata, never re-derive from AgentConfig field names.
 *
 * Pure: no I/O, no caching.
 */
export function extractAgentMetadata(config: AgentConfig): AgentMetadata {
  return {
    inputs: Array.isArray(config.inputs) ? config.inputs : [],
    outputs: config.outputs ? Object.keys(config.outputs) : [],
    model: config.model,
    ...(config.thinking !== undefined ? { thinking: config.thinking } : {}),
  };
}

export function loadAgent(
  name: string,
  pipelineDir: string,
): AgentConfig & { metadata: AgentMetadata } {
  const path = join(pipelineDir, `${name}.md`);
  if (!existsSync(path)) {
    throw new Error(`Agent file not found: ${path}`);
  }
  const config = parseAgentFile(readFileSync(path, "utf-8"));
  return Object.assign(config, { metadata: extractAgentMetadata(config) });
}
