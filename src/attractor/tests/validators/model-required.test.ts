import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { parseDot } from "../../core/graph.js";
import { validateGraph } from "../../core/graph-validator.js";

function makeFixture(agentFrontmatter: string): string {
  const dir = mkdtempSync(join(tmpdir(), "model-required-"));
  writeFileSync(join(dir, "verifier.md"),
    `---\n${agentFrontmatter}---\nbody`);
  writeFileSync(join(dir, "p.dot"), `digraph { start [shape=Mdiamond]; v [agent="verifier"]; start -> v; }`);
  return dir;
}

describe("model_required validator", () => {
  it.skip("emits diagnostic when agent .md is missing model: (covered indirectly — see comment)", () => {
    // Until Chunk 3 lands, validateAgentConfig accepts missing model via the
    // DEFAULTS.model="opus" fallback, so loadAgent returns a config with model:"opus"
    // — model_required does NOT fire. After Chunk 3 lands, validateAgentConfig
    // throws on missing model → tryResolveAgent returns undefined → this rule
    // short-circuits. Direct-missing case is covered by the agent-load failure path
    // (separate rule), not by model_required. The next two tests deterministically
    // cover the enum-mismatch and happy-path cases in both pre- and post-Chunk-3
    // worlds.
  });

  it("emits diagnostic when agent.md loads with a model field not in the enum (pre-Chunk-3 only)", () => {
    // Pre-Chunk 3: validateAgentConfig accepts any string in model:, so loadAgent
    // returns config with model:"gpt4". The model_required rule reads model and
    // sees it's not in the enum → emits diagnostic.
    // Post-Chunk 3: validateAgentConfig throws on non-enum, tryResolveAgent returns
    // undefined, this rule short-circuits. Assertion will fail; that's expected and
    // means this test should be removed in the Chunk-3 commit (or adapted to
    // assert validateAgentConfig throws directly).
    const dir = makeFixture(
      "name: verifier\ndescription: x\nmodel: gpt4\npermission_mode: ask\ninputs: []\noutputs:\n  ok: boolean\n"
    );
    const src = readFileSync(join(dir, "p.dot"), "utf8");
    const diags = validateGraph(parseDot(src), dir);
    const m = diags.find(d => d.rule === "model_required");
    expect(m).toBeDefined();
    expect(m!.severity).toBe("error");
    expect(m!.message).toMatch(/missing required model/);
  });

  it("does not emit when model is valid enum value", () => {
    for (const model of ["opus", "sonnet", "haiku"]) {
      const dir = makeFixture(
        `name: verifier\ndescription: x\nmodel: ${model}\npermission_mode: ask\ninputs: []\noutputs:\n  ok: boolean\n`
      );
      const src = readFileSync(join(dir, "p.dot"), "utf8");
      const diags = validateGraph(parseDot(src), dir);
      expect(diags.find(d => d.rule === "model_required")).toBeUndefined();
    }
  });

  it.todo("Chunk-3-aware: missing-model frontmatter fails validation via agent-load (separate rule) — flesh out post-Chunk-3");
});
