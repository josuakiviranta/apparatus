import { describe, it, expect } from "vitest";
import { writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { parseDot, validateGraph } from "../core/graph.js";

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
outputs:
  foo: string
---
body
`,
      "consumer.md": `---
name: consumer
description: consumes foo
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
outputs:
  my_key: string
---
body
`,
      "consumer.md": `---
name: consumer
description: needs my_key
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
});
