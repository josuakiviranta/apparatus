import { describe, it, expect } from "vitest";
import { writeFileSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
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
auto_inputs: true
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

  it("throws when allowBundledFallback=false and no project-local/user agent exists", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "ralph-resolve-no-fallback-"));
    const userDir = mkdtempSync(join(tmpdir(), "ralph-resolve-user-"));
    const bundledDir = resolve(__dirname, "../../cli/agents");
    try {
      // Bundled "verifier" exists, but allowBundledFallback=false must skip it.
      expect(() =>
        resolveAgent("verifier", {
          projectDir,
          userDir,
          bundledDir,
          allowBundledFallback: false,
        }),
      ).toThrow(/Unknown agent/);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(userDir, { recursive: true, force: true });
    }
  });

  it("with allowBundledFallback=false, project-local agent still resolves", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "ralph-resolve-no-fallback-pl-"));
    const userDir = mkdtempSync(join(tmpdir(), "ralph-resolve-user-pl-"));
    try {
      writeFileSync(
        join(projectDir, "demo.md"),
        `---
name: demo
description: demo
auto_inputs: true
---
body
`,
      );
      const config = resolveAgent("demo", {
        projectDir,
        userDir,
        allowBundledFallback: false,
      });
      expect(config.name).toBe("demo");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(userDir, { recursive: true, force: true });
    }
  });
});
