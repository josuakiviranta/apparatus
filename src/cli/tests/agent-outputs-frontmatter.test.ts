import { describe, it, expect } from "vitest";
import { parseFrontmatter } from "../lib/frontmatter.js";
import { validateAgentConfig } from "../lib/agent.js";

describe("parseFrontmatter — outputs block", () => {
  it("parses a typed outputs map with inline JSON Schema fragments", () => {
    // YAML reserved-word quirk: `true` / `false` / `yes` / `no` / `null` are
    // parsed as their typed values by js-yaml. Authors who want them as string
    // enum members MUST quote them. The verifier's `preferred_label` is a
    // string enum, so we quote here and document the gotcha for migrators.
    const input = `---
name: verifier
model: opus
outputs:
  preferred_label: {enum: ["true", "false", empty]}
  illumination_path: string
  archive_reason_short: {type: string, maxLength: 100}
---
# Mission
Body here.`;

    const { attributes } = parseFrontmatter(input);

    expect(attributes.name).toBe("verifier");
    expect(attributes.outputs).toEqual({
      preferred_label: { enum: ["true", "false", "empty"] },
      illumination_path: "string",
      archive_reason_short: { type: "string", maxLength: 100 },
    });
  });

  it("treats unquoted YAML reserved words as their typed values (gotcha doc)", () => {
    // Locks the gotcha: unquoted `true`/`false` become booleans. Migrators
    // must quote when they need string members in an enum.
    const input = `---
name: x
outputs:
  flag: {enum: [true, false, empty]}
---
body`;
    const { attributes } = parseFrontmatter(input);
    expect((attributes.outputs as any).flag).toEqual({
      enum: [true, false, "empty"],
    });
  });

  it("returns no outputs key when frontmatter omits it", () => {
    const input = `---
name: legacy-agent
model: sonnet
---
# Mission`;

    const { attributes } = parseFrontmatter(input);
    expect(attributes.outputs).toBeUndefined();
  });
});

describe("validateAgentConfig — outputs", () => {
  it("attaches outputs and serializes a JSON Schema into jsonSchema string", () => {
    const config = validateAgentConfig({
      name: "verifier",
      description: "Verifier agent",
      outputs: {
        preferred_label: { enum: ["true", "false", "empty"] },
        illumination_path: "string",
      },
      prompt: "Body",
    } as any);

    expect(config.outputs).toEqual({
      preferred_label: { enum: ["true", "false", "empty"] },
      illumination_path: "string",
    });

    expect(config.jsonSchema).toBeDefined();
    const parsed = JSON.parse(config.jsonSchema!);
    expect(parsed).toEqual({
      type: "object",
      properties: {
        preferred_label: { enum: ["true", "false", "empty"] },
        illumination_path: { type: "string" },
      },
      required: ["preferred_label", "illumination_path"],
      additionalProperties: false,
    });
  });

  it("normalizes shorthand strings to {type: ...} fragments", () => {
    const config = validateAgentConfig({
      name: "x", description: "x agent",
      outputs: { foo: "string", bar: "number", baz: "boolean" },
      prompt: "",
    } as any);
    const parsed = JSON.parse(config.jsonSchema!);
    expect(parsed.properties).toEqual({
      foo: { type: "string" },
      bar: { type: "number" },
      baz: { type: "boolean" },
    });
  });

  it("does not set outputs or jsonSchema when outputs absent", () => {
    const config = validateAgentConfig({
      name: "x", description: "x agent", prompt: "Body",
    } as any);
    expect(config.outputs).toBeUndefined();
    expect(config.jsonSchema).toBeUndefined();
  });

  it("treats outputs with zero keys as empty schema (degenerate but valid)", () => {
    const config = validateAgentConfig({
      name: "x", description: "x agent",
      outputs: {},
      prompt: "",
    } as any);
    expect(config.outputs).toEqual({});
    const parsed = JSON.parse(config.jsonSchema!);
    expect(parsed).toEqual({
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    });
  });

  it("does NOT overwrite an explicit jsonSchema string when outputs is also set", () => {
    const explicit = '{"type":"object","properties":{},"required":[]}';
    const config = validateAgentConfig({
      name: "x", description: "x agent",
      jsonSchema: explicit,
      outputs: { foo: "string" },
      prompt: "",
    } as any);
    expect(config.jsonSchema).toBe(explicit);
    expect(config.outputs).toEqual({ foo: "string" });
  });
});

import { writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { resolveAgent } from "../lib/agent-registry.js";

describe("resolveAgent — outputs end-to-end", () => {
  it("loads outputs from frontmatter and exposes them on AgentConfig", () => {
    const dir = join(tmpdir(), `resolve-outputs-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "demo-agent.md"), `---
name: demo-agent
description: demo
outputs:
  foo: string
  status: {enum: [ok, fail]}
---
prompt body
`);

    const config = resolveAgent("demo-agent", { projectDir: dir });

    expect(config.outputs).toEqual({
      foo: "string",
      status: { enum: ["ok", "fail"] },
    });
    expect(config.jsonSchema).toBeDefined();
    expect(JSON.parse(config.jsonSchema!).required).toEqual(["foo", "status"]);
  });
});

describe("verifier migration — preserves verifier.json contract", () => {
  // Asserts the bundled verifier.md outputs: block produces a JSON Schema that
  // satisfies the runtime contract previously held by pipelines/schemas/verifier.json:
  // same required keys, same preferred_label enum members, all string-typed fields.
  // Bypasses resolveAgent so a stale user-dir cache (~/.ralph/agents/verifier.md)
  // can't mask an authoring slip in the bundled source file.
  it("derives a jsonSchema with the same required keys and preferred_label enum", () => {
    const { readFileSync } = require("fs");
    const bundledPath = join(__dirname, "..", "agents", "verifier.md");
    const { attributes, body } = parseFrontmatter(readFileSync(bundledPath, "utf-8"));
    const config = validateAgentConfig({ ...attributes, prompt: body } as any);

    expect(config.outputs).toBeDefined();
    expect(config.jsonSchema).toBeDefined();
    const schema = JSON.parse(config.jsonSchema!);

    expect([...schema.required].sort()).toEqual([
      "archive_reason_short",
      "explanation",
      "illumination_path",
      "preferred_label",
      "summary",
    ]);
    expect([...schema.properties.preferred_label.enum].sort()).toEqual([
      "empty", "false", "true",
    ]);
    expect(schema.properties.illumination_path.type).toBe("string");
    expect(schema.properties.summary.type).toBe("string");
    expect(schema.properties.explanation.type).toBe("string");
    expect(schema.properties.archive_reason_short.type).toBe("string");
    expect(schema.additionalProperties).toBe(false);
  });
});
