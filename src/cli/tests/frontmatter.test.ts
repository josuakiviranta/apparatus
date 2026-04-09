import { describe, it, expect } from "vitest";
import { parseFrontmatter } from "../lib/frontmatter.js";

describe("parseFrontmatter", () => {
  it("parses YAML frontmatter and markdown body", () => {
    const input = `---
name: reviewer
description: Reviews code
model: sonnet
---

You are a code reviewer.`;

    const result = parseFrontmatter(input);
    expect(result.attributes.name).toBe("reviewer");
    expect(result.attributes.description).toBe("Reviews code");
    expect(result.attributes.model).toBe("sonnet");
    expect(result.body.trim()).toBe("You are a code reviewer.");
  });

  it("returns empty attributes when no frontmatter", () => {
    const input = "Just a plain markdown file.";
    const result = parseFrontmatter(input);
    expect(result.attributes).toEqual({});
    expect(result.body).toBe("Just a plain markdown file.");
  });

  it("parses array fields", () => {
    const input = `---
name: test
description: test agent
tools:
  - read_file
  - glob_files
---

Prompt body.`;

    const result = parseFrontmatter(input);
    expect(result.attributes.tools).toEqual(["read_file", "glob_files"]);
  });

  it("parses MCP server config objects", () => {
    const input = `---
name: test
description: test agent
mcp:
  - name: illumination
    command: node
    args:
      - /path/to/server.js
---

Prompt.`;

    const result = parseFrontmatter(input);
    expect(result.attributes.mcp).toEqual([
      { name: "illumination", command: "node", args: ["/path/to/server.js"] },
    ]);
  });
});
