import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentHandler } from "../handlers/agent-handler.js";
import type { Node, PipelineContext } from "../types.js";

function makeAgentDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "auto-inputs-"));
  for (const [k, v] of Object.entries(files)) writeFileSync(join(dir, k), v);
  return dir;
}

describe("agent-handler auto_inputs path", () => {
  it("renders Inputs block when auto_inputs: true", async () => {
    const dotDir = makeAgentDir({
      "v.md": `---
name: v
description: t
inputs: [project, run_id]
outputs:
  result: string
---
# Mission
You are v.`,
    });
    const fakeAgent = {
      run: vi.fn(async () => ({
        exitCode: 0,
        sessionId: "s1",
        output: JSON.stringify({ result: "ok" }),
      })),
    };
    const jsonSchema1 = JSON.stringify({ type: "object", properties: { result: { type: "string" } }, required: ["result"] });
    const handler = new AgentHandler({
      resolveAgent: () => ({
        name: "v",
        description: "t",
        model: "opus",
        permissionMode: "default",
        tools: [],
        mcp: [],
        prompt: "# Mission\nYou are v.",
        inputs: ["project", "run_id"],
        jsonSchema: jsonSchema1,
        outputs: { result: "string" },
      }),
      createAgent: () => fakeAgent as any,
    });
    const node: Node = {
      id: "v_node",
      agent: "v",
      label: "v_node",
      sourceLocation: { line: 1, column: 1 },
    } as any;
    const ctx: PipelineContext = {
      values: { project: "/repo", run_id: "abc-123" },
    };
    const meta = {
      logsRoot: dotDir,
      cwd: dotDir,
      dotDir,
      projectDir: "/repo",
      completedNodes: [],
      nodeRetries: {},
    };
    const out = await handler.execute(node, ctx, meta as any);
    expect(out.status).toBe("success");
    const promptPath = join(dotDir, "v_node", "prompt.md");
    const written = readFileSync(promptPath, "utf-8");
    expect(written).toContain("## Inputs");
    expect(written).toContain("<project>/repo</project>");
    expect(written).toContain("<run_id>abc-123</run_id>");
    expect(written).not.toContain("$project");
  });

  it("falls back to camelCased default_<key> attribute on the node when ctx is missing the input", async () => {
    // Regression: DOT parser camelCases default_illumination_path → defaultIlluminationPath
    // on the Node. inputs-resolver builds fallbackAttr=`default_illumination_path`
    // (snake_case). AgentHandler must invert the camelCase before passing to renderInputsBlock,
    // or the renderer throws "missing input" even when the default attribute is present.
    const fakeAgent = {
      run: vi.fn(async () => ({
        exitCode: 0,
        sessionId: "s1",
        output: JSON.stringify({ result: "ok" }),
      })),
    };
    const jsonSchema = JSON.stringify({ type: "object", properties: { result: { type: "string" } }, required: ["result"] });
    const handler = new AgentHandler({
      resolveAgent: () => ({
        name: "v",
        description: "t",
        model: "opus",
        permissionMode: "default",
        tools: [],
        mcp: [],
        prompt: "# Mission",
        inputs: ["v_node.illumination_path"],
        jsonSchema,
        outputs: { result: "string" },
      }),
      createAgent: () => fakeAgent as any,
    });
    const dotDir = mkdtempSync(join(tmpdir(), "default-camel-"));
    // Simulate DOT-parsed node: default_illumination_path="" lands as camelCased key.
    const node: Node = {
      id: "v_node",
      agent: "v",
      label: "v_node",
      defaultIlluminationPath: "",
    } as any;
    const ctx: PipelineContext = { values: {} };
    const out = await handler.execute(node, ctx, {
      logsRoot: dotDir, cwd: dotDir, dotDir, completedNodes: [], nodeRetries: {},
    } as any);
    expect(out.status).toBe("success");
    const written = readFileSync(join(dotDir, "v_node", "prompt.md"), "utf-8");
    expect(written).toContain("<v_node_illumination_path></v_node_illumination_path>");
  });

  it("namespaces structured updates when auto_inputs: true", async () => {
    const fakeAgent = {
      run: vi.fn(async () => ({
        exitCode: 0,
        sessionId: "s1",
        output: JSON.stringify({ result: "ok" }),
      })),
    };
    const jsonSchema2 = JSON.stringify({ type: "object", properties: { result: { type: "string" } }, required: ["result"] });
    const handler = new AgentHandler({
      resolveAgent: () => ({
        name: "v",
        description: "t",
        model: "opus",
        permissionMode: "default",
        tools: [],
        mcp: [],
        prompt: "# Mission",
        inputs: [],
        jsonSchema: jsonSchema2,
        outputs: { result: "string" },
      }),
      createAgent: () => fakeAgent as any,
    });
    const dotDir = mkdtempSync(join(tmpdir(), "ns-"));
    const node: Node = { id: "v_node", agent: "v", label: "v_node" } as any;
    const ctx: PipelineContext = { values: {} };
    const out = await handler.execute(node, ctx, {
      logsRoot: dotDir, cwd: dotDir, dotDir, completedNodes: [], nodeRetries: {},
    } as any);
    expect(out.status).toBe("success");
    expect(out.contextUpdates).toMatchObject({ "v_node.result": "ok" });
    expect(out.contextUpdates).not.toHaveProperty("result");
  });

});
