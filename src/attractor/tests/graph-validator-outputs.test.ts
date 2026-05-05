import { describe, it, expect } from "vitest";
import { writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { parseDot } from "../core/graph.js";
import { validateGraph } from "../core/graph-validator.js";

describe("validator — agent_missing_outputs + agent_outputs_empty", () => {
  it("emits agent_missing_outputs error for non-interactive agent without outputs:", () => {
    const dir = join(tmpdir(), `agent-missing-outputs-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "my-agent.md"), `---
name: my-agent
description: an agent without outputs
auto_inputs: true
---
Do something useful.
`);
    const dot = `digraph g {
      start [shape=Mdiamond]
      agent_node [agent="my-agent"]
      exit [shape=Msquare]
      start -> agent_node
      agent_node -> exit
    }`;
    writeFileSync(join(dir, "p.dot"), dot);

    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);

    const errorDiag = diags.find(d => d.rule === "agent_missing_outputs");
    expect(errorDiag).toBeDefined();
    expect(errorDiag?.severity).toBe("error");
    expect(errorDiag?.message).toContain("outputs:");
    expect(errorDiag?.message).toContain("json_schema_file");
  });

  it("does NOT emit agent_missing_outputs for agent with outputs: {}", () => {
    const dir = join(tmpdir(), `agent-outputs-empty-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "my-agent.md"), `---
name: my-agent
description: an agent with empty outputs
auto_inputs: true
outputs: {}
---
Do something.
`);
    const dot = `digraph g {
      start [shape=Mdiamond]
      agent_node [agent="my-agent"]
      exit [shape=Msquare]
      start -> agent_node
      agent_node -> exit
    }`;
    writeFileSync(join(dir, "p.dot"), dot);

    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);

    const errorDiag = diags.find(d => d.rule === "agent_missing_outputs");
    expect(errorDiag).toBeUndefined();
  });

  it("emits agent_outputs_empty warning for agent with outputs: {}", () => {
    const dir = join(tmpdir(), `agent-outputs-empty-warn-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "my-agent.md"), `---
name: my-agent
description: an agent with empty outputs
auto_inputs: true
outputs: {}
---
Do something.
`);
    const dot = `digraph g {
      start [shape=Mdiamond]
      agent_node [agent="my-agent"]
      exit [shape=Msquare]
      start -> agent_node
      agent_node -> exit
    }`;
    writeFileSync(join(dir, "p.dot"), dot);

    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);

    const warnDiag = diags.find(d => d.rule === "agent_outputs_empty");
    expect(warnDiag).toBeDefined();
    expect(warnDiag?.severity).toBe("warning");
  });

  it("does NOT emit agent_missing_outputs for interactive=true agent", () => {
    const dir = join(tmpdir(), `agent-interactive-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "chat-agent.md"), `---
name: chat-agent
description: an interactive agent without outputs
auto_inputs: true
---
Chat with the user.
`);
    const dot = `digraph g {
      start [shape=Mdiamond]
      chat_node [agent="chat-agent", interactive="true"]
      exit [shape=Msquare]
      start -> chat_node
      chat_node -> exit
    }`;
    writeFileSync(join(dir, "p.dot"), dot);

    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);

    const errorDiag = diags.find(d => d.rule === "agent_missing_outputs");
    expect(errorDiag).toBeUndefined();
  });
});
