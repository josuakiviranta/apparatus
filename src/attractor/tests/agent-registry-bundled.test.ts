import { describe, it, expect } from "vitest";
import { resolveAgent } from "../../cli/lib/agent-registry.js";
import { resolve } from "path";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("resolveAgent — verifier via bundledDir", () => {
  it("loads outputs from bundled verifier.md (registry path, not direct read)", () => {
    const bundledDir = resolve(__dirname, "../../cli/agents");
    // Hermetic: override userDir to a fresh tmp dir so the registry falls
    // through to bundledDir instead of returning a stale ~/.ralph/agents copy.
    const userDir = mkdtempSync(join(tmpdir(), "ralph-agents-bundled-"));
    try {
      const config = resolveAgent("verifier", { bundledDir, userDir });
      expect(config.name).toBe("verifier");
      expect(config.outputs).toBeDefined();
      expect(Object.keys(config.outputs!)).toEqual(
        expect.arrayContaining([
          "preferred_label",
          "illumination_path",
          "summary",
          "explanation",
          "archive_reason_short",
        ]),
      );
      expect(config.jsonSchema).toBeDefined();
      const schema = JSON.parse(config.jsonSchema!);
      expect(schema.required).toContain("preferred_label");
    } finally {
      rmSync(userDir, { recursive: true, force: true });
    }
  });
});
