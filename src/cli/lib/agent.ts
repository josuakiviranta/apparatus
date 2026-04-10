import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { Readable } from "node:stream";
import * as readline from "node:readline";

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
  jsonSchema?: string;
}

export interface RunOptions {
  cwd: string;
  signal?: AbortSignal;
  variables?: Record<string, unknown>;
  resume?: string;
  interactive?: boolean;
  onSessionId?: (id: string) => void;
  /** When provided, the caller consumes stdout (e.g. via streamEvents).
   *  The internal readline session-id extractor is skipped. */
  onStdout?: (stdout: NodeJS.ReadableStream) => Promise<void>;
}

export interface RunResult {
  exitCode: number;
  sessionId: string | null;
  stdout: import("stream").Readable | null;
  /** Buffered stdout content — populated when config.jsonSchema is set */
  output?: string;
}

const DEFAULTS: Partial<AgentConfig> = {
  model: "opus",
  permissionMode: "dangerouslySkipPermissions",
  tools: [],
  mcp: [],
};

export class Agent {
  private _mcpConfigPath: string | null = null;
  private _child: ChildProcess | null = null;

  constructor(public readonly config: AgentConfig) {}

  get mcpConfigPath(): string | null {
    return this._mcpConfigPath;
  }

  expandPrompt(variables?: Record<string, unknown>): string {
    if (!variables) return this.config.prompt;
    let result = this.config.prompt;
    for (const [key, value] of Object.entries(variables)) {
      const str = typeof value === "string" ? value : String(value ?? "");
      result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), str);
    }
    return result;
  }

  buildArgs(options: RunOptions): string[] {
    const args: string[] = [];

    // Model
    args.push("--model", this.config.model);

    // Permission mode
    if (this.config.permissionMode === "dangerouslySkipPermissions") {
      args.push("--dangerously-skip-permissions");
    } else {
      args.push("--permission-mode", this.config.permissionMode);
    }

    // Tools
    if (this.config.tools.length > 0) {
      for (const tool of this.config.tools) {
        args.push("--allowedTools", tool);
      }
    }

    // MCP config
    if (this._mcpConfigPath) {
      args.push("--mcp-config", this._mcpConfigPath);
    }

    // Output format (non-interactive only)
    if (!options.interactive) {
      if (this.config.jsonSchema) {
        args.push("--output-format", "json");
        args.push("--json-schema", this.config.jsonSchema);
      } else {
        args.push("--output-format", "stream-json");
      }
    }

    // Resume or prompt
    if (options.resume) {
      args.push("--resume", options.resume);
    }

    return args;
  }

  writeMcpConfig(cwd: string, variables?: Record<string, unknown>): string | null {
    if (this.config.mcp.length === 0) return null;

    const expand = (s: string): string => {
      if (!variables) return s;
      return s.replace(/\{\{(\w+)\}\}/g, (match, key) => {
        const v = variables[key];
        if (v === undefined) return match;
        return typeof v === "string" ? v : String(v);
      });
    };

    const mcpServers: Record<string, { command: string; args: string[] }> = {};
    for (const server of this.config.mcp) {
      mcpServers[server.name] = {
        command: expand(server.command),
        args: server.args.map(expand),
      };
    }

    const configPath = path.join(cwd, `.mcp-${this.config.name}-${Date.now()}.json`);
    fs.writeFileSync(configPath, JSON.stringify({ mcpServers }, null, 2));
    this._mcpConfigPath = configPath;
    return configPath;
  }

  cleanupMcpConfig(): void {
    if (this._mcpConfigPath) {
      try {
        fs.unlinkSync(this._mcpConfigPath);
      } catch {
        // File may already be removed
      }
      this._mcpConfigPath = null;
    }
  }

  async run(options: RunOptions): Promise<RunResult> {
    const expandedPrompt = this.expandPrompt(options.variables);

    // Write MCP config if needed (expand variables in server args)
    this.writeMcpConfig(options.cwd, options.variables);

    try {
      const args = this.buildArgs(options);
      const isInteractive = !!options.interactive;
      const isResume = !!options.resume;

      // Add -p for non-interactive, non-resume runs (prompt piped via stdin)
      if (!isInteractive && !isResume) {
        args.unshift("-p");
      }

      const spawnOptions: any = {
        cwd: options.cwd,
        detached: true,
      };

      if (isInteractive) {
        spawnOptions.stdio = "inherit";
      } else {
        spawnOptions.stdio = ["pipe", "pipe", "inherit"];
      }

      const child = spawn("claude", args, spawnOptions);
      this._child = child;

      // Pipe prompt to stdin for non-interactive, non-resume
      if (!isInteractive && !isResume && child.stdin) {
        child.stdin.write(expandedPrompt);
        child.stdin.end();
      }

      // Capture session ID from stream-json output
      let sessionId: string | null = null;

      // Register close handler BEFORE consuming stdout to avoid race condition:
      // if onStdout awaits stream consumption and close fires before we listen, we'd hang.
      const closePromise = new Promise<number>((resolve) => {
        child.on("close", (code) => {
          resolve(code ?? 1);
        });
      });

      let capturedOutput = "";

      if (this.config.jsonSchema && !isInteractive && child.stdout) {
        // Structured output: buffer stdout for JSON parsing.
        // Skip onStdout — structured nodes produce a single JSON blob, not a stream.
        const rl = readline.createInterface({ input: child.stdout });
        const rlDone = new Promise<void>((resolve) => rl.on("close", resolve));
        rl.on("line", (line) => {
          capturedOutput += line + "\n";
          try {
            const parsed = JSON.parse(line);
            if (parsed.session_id && !sessionId) {
              sessionId = parsed.session_id;
              options.onSessionId?.(sessionId!);
            }
          } catch {
            // Not JSON line, still captured
          }
        });
        // Ensure all buffered lines are processed before returning
        await rlDone;
      } else if (!isInteractive && child.stdout && options.onStdout) {
        // Caller consumes stdout (e.g. streamEvents → output.stream)
        await options.onStdout(child.stdout);
      } else if (!isInteractive && child.stdout) {
        const rl = readline.createInterface({ input: child.stdout });
        rl.on("line", (line) => {
          try {
            const parsed = JSON.parse(line);
            if (parsed.session_id && !sessionId) {
              sessionId = parsed.session_id;
              options.onSessionId?.(sessionId!);
            }
          } catch {
            // Not JSON, ignore
          }
        });
      }

      const exitCode = await closePromise;

      return {
        exitCode,
        sessionId,
        stdout: (isInteractive || this.config.jsonSchema) ? null : (child.stdout as Readable | null),
        output: capturedOutput || undefined,
      };
    } finally {
      this.cleanupMcpConfig();
      this._child = null;
    }
  }

  kill(): void {
    if (this._child?.pid) {
      try {
        process.kill(-this._child.pid, "SIGTERM");
      } catch {
        // Process may already be dead
      }
    }
  }
}

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
