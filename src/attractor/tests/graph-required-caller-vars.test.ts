import { describe, it, expect } from "vitest";
import { writeFileSync, mkdirSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { parseDot } from "../core/graph.js";
import { validateGraph } from "../core/graph-validator.js";

function setupAgents(dir: string, files: Record<string, string>) {
  mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(dir, name), body);
  }
}

describe("validator — required_caller_vars", () => {
  it("emits no diagnostic when all consumed vars are produced internally", () => {
    const dir = join(tmpdir(), `req-caller-vars-1-${Date.now()}`);
    setupAgents(dir, {
      "producer.md": `---
name: producer
description: produces foo
model: sonnet
outputs:
  foo: string
---
body
`,
      "consumer.md": `---
name: consumer
description: consumes foo
model: sonnet
inputs:
  - foo
---
body
`,
    });
    const dot = `digraph g {
      start [shape=Mdiamond]
      p [agent="producer"]
      c [agent="consumer"]
      done [shape=Msquare]
      start -> p -> c -> done
    }`;
    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);
    expect(diags.find(d => d.rule === "required_caller_vars")).toBeUndefined();
  });

  it("emits no diagnostic when graph has no external dependencies", () => {
    const dot = `digraph g {
      start [shape=Mdiamond]
      done [shape=Msquare]
      start -> done
    }`;
    const graph = parseDot(dot);
    const diags = validateGraph(graph, undefined);
    expect(diags.find(d => d.rule === "required_caller_vars")).toBeUndefined();
  });

  it("lists vars from graph inputs= that are not produced internally", () => {
    const dir = join(tmpdir(), `req-caller-vars-2-${Date.now()}`);
    setupAgents(dir, {
      "agent-a.md": `---
name: agent-a
description: no special inputs
model: sonnet
---
body
`,
    });
    const dot = `digraph g {
      inputs="project, foo"
      start [shape=Mdiamond]
      a [agent="agent-a"]
      done [shape=Msquare]
      start -> a -> done
    }`;
    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);
    const info = diags.find(d => d.rule === "required_caller_vars");
    expect(info).toBeDefined();
    expect(info!.severity).toBe("info");
    // foo is not reserved and not produced — must appear
    expect(info!.message).toContain("foo");
    // project IS reserved — must NOT appear
    expect(info!.message).not.toContain("project");
  });

  it("excludes RESERVED_VARS (run_id, goal, project) from the required list", () => {
    const dir = join(tmpdir(), `req-caller-vars-3-${Date.now()}`);
    setupAgents(dir, {
      "agent-a.md": `---
name: agent-a
description: uses reserved vars
model: sonnet
---
Use $run_id and $goal here.
`,
    });
    const dot = `digraph g {
      start [shape=Mdiamond]
      a [agent="agent-a"]
      done [shape=Msquare]
      start -> a -> done
    }`;
    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);
    const info = diags.find(d => d.rule === "required_caller_vars");
    // run_id, goal, project are reserved — none should appear
    expect(info).toBeUndefined();
  });

  it("lists a var consumed via agent inputs: that is not produced anywhere", () => {
    const dir = join(tmpdir(), `req-caller-vars-4-${Date.now()}`);
    setupAgents(dir, {
      "consumer.md": `---
name: consumer
description: needs external_key
model: sonnet
inputs:
  - external_key
---
body
`,
    });
    const dot = `digraph g {
      start [shape=Mdiamond]
      c [agent="consumer"]
      done [shape=Msquare]
      start -> c -> done
    }`;
    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);
    const info = diags.find(d => d.rule === "required_caller_vars");
    expect(info).toBeDefined();
    expect(info!.severity).toBe("info");
    expect(info!.message).toContain("external_key");
  });

  it("does not include a var that IS produced by a node", () => {
    const dir = join(tmpdir(), `req-caller-vars-5-${Date.now()}`);
    setupAgents(dir, {
      "producer.md": `---
name: producer
description: produces my_key
model: sonnet
outputs:
  my_key: string
---
body
`,
      "consumer.md": `---
name: consumer
description: needs my_key
model: sonnet
inputs:
  - my_key
---
body
`,
    });
    const dot = `digraph g {
      start [shape=Mdiamond]
      p [agent="producer"]
      c [agent="consumer"]
      done [shape=Msquare]
      start -> p -> c -> done
    }`;
    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);
    const info = diags.find(d => d.rule === "required_caller_vars");
    // my_key is produced internally — no required_caller_vars diagnostic
    expect(info).toBeUndefined();
  });

  it("excludes tool-node produces= keys and agent default_<key>= vars from required_caller_vars", () => {
    const dir = join(tmpdir(), `req-caller-vars-6-${Date.now()}`);
    setupAgents(dir, {
      "consumer.md": `---
name: consumer
description: needs sha and max_iterations
model: sonnet
inputs:
  - tool_node.sha
  - max_iterations
---
body
`,
    });
    const dot = `digraph g {
      start [shape=Mdiamond]
      tool_node [type="tool",
                 cwd=".",
                 tool_command="printf '{\\"sha\\":\\"abc\\"}\\n'",
                 produces_from_stdout="true",
                 produces="sha"]
      c [agent="consumer", default_max_iterations="0"]
      done [shape=Msquare]
      start -> tool_node -> c -> done
    }`;
    const graph = parseDot(dot);
    const diags = validateGraph(graph, dir);
    const info = diags.find(d => d.rule === "required_caller_vars");
    // tool_node.sha is produced via produces="sha"; max_iterations is silenced
    // via default_max_iterations="0" on the consumer. Neither should appear.
    expect(info).toBeUndefined();
  });

  it("bundled implement pipeline lists scenarios_dir and not llm_model", () => {
    // Snapshot guard for the bundled implement pipeline's [required_caller_vars]
    // banner. After the inputs= edit on pipeline.dot:3, llm_model is no longer a
    // declared input and must not appear in the diagnostic message; scenarios_dir
    // remains the sole caller-supplied key.
    const here = dirname(fileURLToPath(import.meta.url));
    const pipelinePath = resolve(here, "..", "..", "cli", "pipelines", "implement", "pipeline.dot");
    const dot = readFileSync(pipelinePath, "utf8");
    const graph = parseDot(dot);
    const diags = validateGraph(graph, dirname(pipelinePath));
    const info = diags.find(d => d.rule === "required_caller_vars");
    expect(info).toBeDefined();
    expect(info!.severity).toBe("info");
    expect(info!.message).toContain("scenarios_dir");
    expect(info!.message).not.toContain("llm_model");
  });
});
