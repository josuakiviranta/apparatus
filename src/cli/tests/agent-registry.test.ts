import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  resolveAgent,
  listAgents,
  agentExists,
} from "../lib/agent-registry.js";

describe("agent-registry", () => {
  let userDir: string;
  let bundledDir: string;

  beforeEach(() => {
    userDir = mkdtempSync(join(tmpdir(), "ralph-agents-user-"));
    bundledDir = mkdtempSync(join(tmpdir(), "ralph-agents-bundled-"));
  });

  afterEach(() => {
    rmSync(userDir, { recursive: true, force: true });
    rmSync(bundledDir, { recursive: true, force: true });
  });

  const reviewerMd = `---
name: reviewer
description: Reviews code
model: sonnet
permissionMode: dontAsk
tools:
  - read_file
---

You are a reviewer.`;

  it("resolves agent from user directory", () => {
    writeFileSync(join(userDir, "reviewer.md"), reviewerMd);
    const config = resolveAgent("reviewer", { userDir, bundledDir });
    expect(config.name).toBe("reviewer");
    expect(config.model).toBe("sonnet");
    expect(config.prompt.trim()).toBe("You are a reviewer.");
  });

  it("falls back to bundled directory and copies to user dir", () => {
    writeFileSync(join(bundledDir, "reviewer.md"), reviewerMd);
    const config = resolveAgent("reviewer", { userDir, bundledDir });
    expect(config.name).toBe("reviewer");
    expect(existsSync(join(userDir, "reviewer.md"))).toBe(true);
  });

  it("throws for unknown agent", () => {
    expect(() =>
      resolveAgent("nonexistent", { userDir, bundledDir }),
    ).toThrow('Unknown agent: "nonexistent"');
  });

  it("applies defaults for optional fields", () => {
    const minimalMd = `---
name: minimal
description: A minimal agent
---

Do things.`;
    writeFileSync(join(userDir, "minimal.md"), minimalMd);
    const config = resolveAgent("minimal", { userDir, bundledDir });
    expect(config.model).toBe("opus");
    expect(config.permissionMode).toBe("dangerouslySkipPermissions");
    expect(config.tools).toEqual([]);
    expect(config.mcp).toEqual([]);
  });

  it("lists agents from both directories", () => {
    writeFileSync(
      join(userDir, "custom.md"),
      `---\nname: custom\ndescription: Custom agent\n---\nPrompt.`,
    );
    writeFileSync(
      join(bundledDir, "builtin.md"),
      `---\nname: builtin\ndescription: Built-in agent\n---\nPrompt.`,
    );
    const agents = listAgents({ userDir, bundledDir });
    const names = agents.map((a) => a.name);
    expect(names).toContain("custom");
    expect(names).toContain("builtin");
  });

  it("user agent overrides bundled agent with same name", () => {
    const userVersion = `---\nname: reviewer\ndescription: Custom reviewer\nmodel: opus\n---\nCustom prompt.`;
    writeFileSync(join(userDir, "reviewer.md"), userVersion);
    writeFileSync(join(bundledDir, "reviewer.md"), reviewerMd);
    const config = resolveAgent("reviewer", { userDir, bundledDir });
    expect(config.model).toBe("opus");
    expect(config.description).toBe("Custom reviewer");
  });

  it("agentExists returns true for existing agent", () => {
    writeFileSync(join(userDir, "reviewer.md"), reviewerMd);
    expect(agentExists("reviewer", { userDir, bundledDir })).toBe(true);
  });

  it("agentExists returns false for missing agent", () => {
    expect(agentExists("nope", { userDir, bundledDir })).toBe(false);
  });
});
