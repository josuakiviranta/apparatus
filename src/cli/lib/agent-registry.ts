import {
  existsSync,
  readFileSync,
  readdirSync,
  copyFileSync,
  mkdirSync,
} from "fs";
import { join, basename } from "path";
import { homedir } from "os";
import { parseFrontmatter } from "./frontmatter.js";
import { validateAgentConfig, type AgentConfig } from "./agent.js";
import { getBundledAgentsDir } from "./assets.js";

export interface RegistryOptions {
  userDir?: string;
  bundledDir?: string;
}

export interface AgentInfo {
  name: string;
  description: string;
  source: "built-in" | "custom";
}

function getUserAgentsDir(opts?: RegistryOptions): string {
  return opts?.userDir ?? join(homedir(), ".ralph", "agents");
}

function getBundledDir(opts?: RegistryOptions): string {
  return opts?.bundledDir ?? getBundledAgentsDir();
}

function parseAgentFile(content: string): AgentConfig {
  const { attributes, body } = parseFrontmatter(content);
  return validateAgentConfig({ ...attributes, prompt: body } as any);
}

export function resolveAgent(
  name: string,
  opts?: RegistryOptions,
): AgentConfig {
  const userDir = getUserAgentsDir(opts);
  const bundledDir = getBundledDir(opts);

  const userPath = join(userDir, `${name}.md`);
  if (existsSync(userPath)) {
    return parseAgentFile(readFileSync(userPath, "utf-8"));
  }

  const bundledPath = join(bundledDir, `${name}.md`);
  if (existsSync(bundledPath)) {
    mkdirSync(userDir, { recursive: true });
    copyFileSync(bundledPath, userPath);
    return parseAgentFile(readFileSync(bundledPath, "utf-8"));
  }

  throw new Error(`Unknown agent: "${name}"`);
}

export function listAgents(opts?: RegistryOptions): AgentInfo[] {
  const userDir = getUserAgentsDir(opts);
  const bundledDir = getBundledDir(opts);
  const seen = new Set<string>();
  const agents: AgentInfo[] = [];

  if (existsSync(userDir)) {
    for (const file of readdirSync(userDir)) {
      if (!file.endsWith(".md")) continue;
      const name = basename(file, ".md");
      seen.add(name);
      try {
        const config = parseAgentFile(
          readFileSync(join(userDir, file), "utf-8"),
        );
        agents.push({
          name,
          description: config.description,
          source: "custom",
        });
      } catch {
        // Skip invalid files
      }
    }
  }

  if (existsSync(bundledDir)) {
    for (const file of readdirSync(bundledDir)) {
      if (!file.endsWith(".md")) continue;
      const name = basename(file, ".md");
      if (seen.has(name)) continue;
      try {
        const config = parseAgentFile(
          readFileSync(join(bundledDir, file), "utf-8"),
        );
        agents.push({
          name,
          description: config.description,
          source: "built-in",
        });
      } catch {
        // Skip invalid files
      }
    }
  }

  return agents.sort((a, b) => a.name.localeCompare(b.name));
}

export function agentExists(
  name: string,
  opts?: RegistryOptions,
): boolean {
  const userDir = getUserAgentsDir(opts);
  const bundledDir = getBundledDir(opts);
  return (
    existsSync(join(userDir, `${name}.md`)) ||
    existsSync(join(bundledDir, `${name}.md`))
  );
}
