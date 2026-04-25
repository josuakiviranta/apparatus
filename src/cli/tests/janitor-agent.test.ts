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

describe("janitor.md — procedure body contract", () => {
  // Whole-file read (not just the body); rubric strings only appear post-frontmatter,
  // so regex matches do not collide with frontmatter keys.
  const fileText = readFileSync(AGENT_PATH, "utf-8");

  it("requires the read-only stance up front", () => {
    expect(fileText).toMatch(/read[- ]only/i);
    expect(fileText).toMatch(/never edit|do not edit|cannot edit/i);
  });

  it("encodes the lifecycle trigger condition (plan status=implemented)", () => {
    expect(fileText).toMatch(/status:\s*implemented/);
    expect(fileText).toMatch(/mark_implemented/);
  });

  it("encodes the one-illumination-per-run cap", () => {
    expect(fileText).toMatch(/at most one illumination|one illumination per run/i);
  });

  it("encodes the three-prior-illuminations reading rule with fresh-project fallback", () => {
    expect(fileText).toMatch(/three prior illuminations/i);
    expect(fileText).toMatch(/fewer than three|all of them/i);
  });

  it("encodes the body rubric headings", () => {
    expect(fileText).toMatch(/^## Findings/m);
    expect(fileText).toMatch(/^## Lifecycle changes this run/m);
    expect(fileText).toMatch(/^## Reading thread/m);
  });

  it("encodes the filename convention with kebab area slug", () => {
    expect(fileText).toMatch(/YYYY-MM-DDTHHMM-janitor-/);
    expect(fileText).toMatch(/kebab-case/i);
  });
});
