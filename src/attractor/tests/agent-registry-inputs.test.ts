import { describe, it, expect } from "vitest";
import { writeFileSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { resolveAgent } from "../../cli/lib/agent-registry.js";

describe("resolveAgent — inputs end-to-end", () => {
  it("loads inputs from frontmatter and exposes them on AgentConfig", () => {
    const dir = mkdtempSync(join(tmpdir(), "ralph-resolve-inputs-"));
    try {
      writeFileSync(
        join(dir, "demo-agent.md"),
        `---
name: demo-agent
description: demo
inputs:
  - illumination_path
  - run_id
outputs:
  status: {enum: [ok, fail]}
---
prompt body
`,
      );

      const config = resolveAgent("demo-agent", { projectDir: dir });
      expect(config.inputs).toEqual(["illumination_path", "run_id"]);
      expect(config.outputs).toBeDefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
