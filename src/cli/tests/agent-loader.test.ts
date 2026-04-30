import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { loadAgent, parseAgentFile } from "../lib/agent-loader.js";

describe("agent-loader", () => {
  let pipelineDir: string;

  beforeEach(() => {
    pipelineDir = mkdtempSync(join(tmpdir(), "ralph-pipeline-"));
  });

  afterEach(() => {
    rmSync(pipelineDir, { recursive: true, force: true });
  });

  it("loadAgent returns AgentConfig from sibling .md in pipelineDir", () => {
    const md = `---
name: reviewer
description: Reviews code
model: sonnet
permissionMode: dontAsk
auto_inputs: true
---

You are a reviewer.`;
    writeFileSync(join(pipelineDir, "reviewer.md"), md);

    const config = loadAgent("reviewer", pipelineDir);

    expect(config.name).toBe("reviewer");
    expect(config.model).toBe("sonnet");
    expect(config.prompt.trim()).toBe("You are a reviewer.");
  });

  it("loadAgent throws with the missing path when sibling .md absent", () => {
    expect(() => loadAgent("ghost", pipelineDir)).toThrow(
      `Agent file not found: ${join(pipelineDir, "ghost.md")}`,
    );
  });

  describe("parseAgentFile", () => {
    it("parses valid frontmatter + body into AgentConfig", () => {
      const md = `---
name: foo
description: x
auto_inputs: true
inputs: [a, b]
---
body content`;
      const cfg = parseAgentFile(md);
      expect(cfg.name).toBe("foo");
      expect(cfg.inputs).toEqual(["a", "b"]);
      expect(cfg.prompt.trim()).toBe("body content");
    });

    it("round-trips deep-loop frontmatter (loop, maxIterations, outputs)", () => {
      const md = `---
name: deep
description: deep loop agent
auto_inputs: true
loop: true
maxIterations: 5
outputs:
  done: boolean
  note: string
---
prompt`;
      const cfg = parseAgentFile(md);
      expect(cfg.loop).toBe(true);
      expect(cfg.maxIterations).toBe(5);
      expect(cfg.outputs?.done).toBeDefined();
      expect(cfg.outputs?.note).toBeDefined();
    });

    it("throws on invalid frontmatter (missing required name)", () => {
      const md = `---
description: nameless
auto_inputs: true
---
body`;
      expect(() => parseAgentFile(md)).toThrow();
    });
  });
});
