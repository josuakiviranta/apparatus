export interface McpServerConfig {
  name: string;
  command: string;
  args: string[];
}

export interface AgentConfig {
  name: string;
  description: string;
  model: string;
  permissionMode: string;
  tools: string[];
  mcp: McpServerConfig[];
  prompt: string;
}

export interface RunOptions {
  cwd: string;
  signal?: AbortSignal;
  variables?: Record<string, string>;
  resume?: string;
  interactive?: boolean;
  onSessionId?: (id: string) => void;
}

export interface RunResult {
  exitCode: number;
  sessionId: string | null;
  stdout: import("stream").Readable | null;
}

const DEFAULTS: Partial<AgentConfig> = {
  model: "opus",
  permissionMode: "dangerouslySkipPermissions",
  tools: [],
  mcp: [],
};

export function validateAgentConfig(
  config: Partial<AgentConfig> & { prompt?: string },
): AgentConfig {
  if (!config.name) throw new Error("name is required");
  if (!config.description) throw new Error("description is required");
  if (!config.prompt) throw new Error("prompt body is required");

  return {
    name: config.name,
    description: config.description,
    model: config.model ?? DEFAULTS.model!,
    permissionMode: config.permissionMode ?? DEFAULTS.permissionMode!,
    tools: config.tools ?? DEFAULTS.tools!,
    mcp: config.mcp ?? DEFAULTS.mcp!,
    prompt: config.prompt,
  };
}
