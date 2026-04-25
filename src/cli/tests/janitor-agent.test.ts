import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFrontmatter } from "../lib/frontmatter.js";
import { validateAgentConfig } from "../lib/agent.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const AGENT_PATH = resolve(__dirname, "../agents/janitor.md");

describe("janitor.md — frontmatter contract", () => {
  const raw = readFileSync(AGENT_PATH, "utf-8");
  const { attributes, body } = parseFrontmatter(raw);
  const config = validateAgentConfig({ ...attributes, prompt: body } as any);

  it("declares the expected identity fields", () => {
    expect(config.name).toBe("janitor");
    expect(config.model).toBe("sonnet");
    expect(config.permissionMode).toBe("dontAsk");
    expect(config.description).toMatch(/janitor/i);
  });

  it("whitelists exactly the lean tool surface from the spec", () => {
    expect([...config.tools].sort()).toEqual([
      "Grep",
      "mcp__illumination__glob_files",
      "mcp__illumination__list_illuminations",
      "mcp__illumination__list_plans",
      "mcp__illumination__mark_implemented",
      "mcp__illumination__mark_plan_implemented",
      "mcp__illumination__project_tree",
      "mcp__illumination__read_file",
      "mcp__illumination__write_illumination",
    ]);
  });

  it("does NOT whitelist destructive or escalation tools", () => {
    const forbidden = [
      "Bash", "Edit", "Write", "Read", "Task",
      "mcp__illumination__mark_archived",
      "mcp__illumination__mark_dispatched",
    ];
    for (const t of forbidden) expect(config.tools).not.toContain(t);
  });

  it("declares the illumination MCP server with template variables", () => {
    expect(config.mcp).toHaveLength(1);
    const [server] = config.mcp;
    expect(server.name).toBe("illumination");
    expect(server.command).toBe("node");
    expect(server.args).toContain("{{ILLUMINATION_SERVER_PATH}}");
    expect(server.args).toContain("{{PROJECT_ROOT}}");
  });
});
