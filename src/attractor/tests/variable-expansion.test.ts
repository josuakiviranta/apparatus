import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { variableExpansionTransform, scanUndeclaredCallerVars, splitFences, expandVariables, UndefinedVariableError } from "../transforms/variable-expansion.js";
import { parseDot } from "../core/graph.js";
import type { Graph, Node } from "../types.js";

function makeTempProjectWithAgent(name: string, body: string): string {
  const root = mkdtempSync(join(tmpdir(), "ralph-test-"));
  const agentsDir = join(root, ".ralph/agents");
  mkdirSync(agentsDir, { recursive: true });
  writeFileSync(join(agentsDir, `${name}.md`), body);
  return root;
}

function parseInlineDot(src: string): Graph {
  return parseDot(src);
}

function makeGraph(nodeAttrs: Record<string, unknown>): Graph {
  return {
    name: "test",
    nodes: new Map([["run", { id: "run", label: "run", shape: "box", ...nodeAttrs }]]),
    edges: [],
  } as unknown as Graph;
}

describe("variableExpansionTransform — maxIterations", () => {
  it("expands $max_iterations in maxIterations node attribute", () => {
    const graph = makeGraph({ maxIterations: "$max_iterations" });
    const result = variableExpansionTransform(graph, {
      context: { max_iterations: "5" },
    });
    const node = result.nodes.get("run")!;
    expect(node.maxIterations).toBe("5");
  });

  it("leaves numeric maxIterations unchanged", () => {
    const graph = makeGraph({ maxIterations: 3 });
    const result = variableExpansionTransform(graph, { context: {} });
    expect(result.nodes.get("run")!.maxIterations).toBe(3);
  });
});

describe("variableExpansionTransform — cwd attribute", () => {
  it("expands $project inside node.cwd", () => {
    const graph = makeGraph({ type: "tool", cwd: "$project", toolCommand: "echo" });
    const out = variableExpansionTransform(graph, { project: "/proj" });
    expect((out.nodes.get("run") as Node & { cwd?: string }).cwd).toBe("/proj");
  });
});

function makeGraphMulti(nodes: Node[], inputs?: string[]): Graph {
  const map = new Map<string, Node>();
  for (const n of nodes) map.set(n.id, n);
  return {
    name: "g",
    nodes: map,
    edges: [],
    inputs,
  } as unknown as Graph;
}

describe("scanUndeclaredCallerVars", () => {
  it("returns no missing when every $var is in initialContext", () => {
    const g = makeGraphMulti(
      [{ id: "a", prompt: "use $foo and $bar" } as unknown as Node],
      ["foo", "bar"],
    );
    const r = scanUndeclaredCallerVars(g, { foo: "1", bar: "2" });
    expect(r.missing).toEqual([]);
    expect(r.declared).toEqual([]);
    expect(r.undeclared).toEqual([]);
  });

  it("reports missing vars not in context", () => {
    const g = makeGraphMulti([{ id: "a", prompt: "use $foo" } as unknown as Node]);
    const r = scanUndeclaredCallerVars(g, {});
    expect(r.missing.map((m) => m.name)).toEqual(["foo"]);
  });

  it("ignores $goal and $project (reserved)", () => {
    const g = makeGraphMulti([{ id: "a", prompt: "$goal in $project for $bar" } as unknown as Node]);
    const r = scanUndeclaredCallerVars(g, {});
    expect(r.missing.map((m) => m.name)).toEqual(["bar"]);
  });

  it("ignores variables produced by an upstream node (produces attribute)", () => {
    const g = makeGraphMulti([
      { id: "p", jsonSchemaFile: "schema.json", produces: "agent_success" } as unknown as Node,
      { id: "c", prompt: "uses $agent_success and $foo" } as unknown as Node,
    ]);
    const r = scanUndeclaredCallerVars(g, {});
    expect(r.missing.map((m) => m.name)).toEqual(["foo"]);
  });

  it("partitions missing into declared (in inputs=) vs undeclared (not in inputs=)", () => {
    const g = makeGraphMulti(
      [{ id: "a", prompt: "$foo and $bar" } as unknown as Node],
      ["foo"],
    );
    const r = scanUndeclaredCallerVars(g, {});
    expect(r.missing.map((m) => m.name).sort()).toEqual(["bar", "foo"]);
    expect(r.declared.map((m) => m.name)).toEqual(["foo"]);
    expect(r.undeclared.map((m) => m.name)).toEqual(["bar"]);
  });

  it("walks prompt and toolCommand attributes for $var references", () => {
    const g = makeGraphMulti([
      { id: "a", prompt: "$one" } as unknown as Node,
      { id: "b", toolCommand: "echo $two" } as unknown as Node,
    ]);
    const r = scanUndeclaredCallerVars(g, {});
    expect(r.missing.map((m) => m.name).sort()).toEqual(["one", "two"]);
  });

  it("strips trailing dots from $var names extracted from prose (e.g. $plan_path.)", () => {
    const g = makeGraphMulti([
      { id: "p", produces: "plan_path" } as unknown as Node,
      { id: "c", prompt: "Read the plan at $plan_path. Then implement it." } as unknown as Node,
    ]);
    const r = scanUndeclaredCallerVars(g, {});
    expect(r.missing).toEqual([]);
  });

  it("treats run_id as a reserved variable (engine-injected)", () => {
    const g = makeGraphMulti([
      { id: "a", toolCommand: "tmux new-window -n test-$run_id" } as unknown as Node,
    ]);
    const r = scanUndeclaredCallerVars(g, {});
    expect(r.missing).toEqual([]);
  });
});

describe("splitFences", () => {
  it("returns a single non-fenced segment when no fences", () => {
    const out = splitFences("plain $foo text");
    expect(out).toEqual([{ fenced: false, text: "plain $foo text" }]);
  });

  it("splits a single fenced bash block", () => {
    const src = "before\n```bash\nRUN=$HOME\n```\nafter";
    const out = splitFences(src);
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({ fenced: false, text: "before\n" });
    expect(out[1].fenced).toBe(true);
    expect(out[1].text).toContain("RUN=$HOME");
    expect(out[2]).toEqual({ fenced: false, text: "\nafter" });
  });

  it("treats an unclosed opening fence as fenced to EOF", () => {
    const src = "prose\n```bash\nRUN=$HOME\nmore shell\n";
    const out = splitFences(src);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ fenced: false, text: "prose\n" });
    expect(out[1].fenced).toBe(true);
    expect(out[1].text).toContain("RUN=$HOME");
  });

  it("does NOT treat inline single-backtick spans as fenced", () => {
    const out = splitFences("see `$foo` here");
    expect(out).toEqual([{ fenced: false, text: "see `$foo` here" }]);
  });
});

describe("expandVariables fence behavior", () => {
  it("leaves $HOME literal when inside a triple-backtick fence", () => {
    const src = "prose\n```bash\nRUN=$HOME\n```\n";
    const out = expandVariables(src, {});
    expect(out).toBe(src); // no throw; fenced content passed through
  });

  it("still expands prose $foo outside fences", () => {
    const out = expandVariables("hello $name", { name: "world" });
    expect(out).toBe("hello world");
  });

  it("still expands $foo inside inline single-backtick spans", () => {
    const out = expandVariables("see `$name`", { name: "w" });
    expect(out).toBe("see `w`");
  });

  it("throws UndefinedVariableError for unknown $foo outside fence", () => {
    expect(() => expandVariables("hi $typo", {})).toThrow(UndefinedVariableError);
  });

  it("does NOT throw for unknown $foo inside fence", () => {
    expect(() => expandVariables("```\n$typo\n```", {})).not.toThrow();
  });

  it("expands dotted $<nodeId>.choice references against flat keys", () => {
    const out = expandVariables("picked $approval_gate.choice", { "approval_gate.choice": "Approve" });
    expect(out).toBe("picked Approve");
  });

  it("expands bare $choice alias", () => {
    const out = expandVariables("last pick: $choice", { choice: "Decline" });
    expect(out).toBe("last pick: Decline");
  });
});

describe("scanUndeclaredCallerVars with agent body", () => {
  it("flags unfenced $typo inside an agent .md body", async () => {
    const projectDir = makeTempProjectWithAgent(
      "fake-agent",
      "---\nname: fake-agent\n---\n# body\nValue: $typo_var\n",
    );
    const graph = parseInlineDot(`
      digraph test {
        inputs="project"
        start -> n1 [label="go"]
        n1 [agent="fake-agent"]
        n1 -> exit
      }
    `);
    const res = scanUndeclaredCallerVars(graph, { project: projectDir });
    expect(res.missing.some((m) =>
      typeof m === "object" && m.name === "typo_var" && m.source?.file.endsWith("fake-agent.md")
    )).toBe(true);
  });

  it("does NOT flag $HOME inside a triple-backtick fence in agent body", async () => {
    const fenced = "---\nname: fake-agent\n---\nPre-fence prose.\n```bash\nRUN=$HOME\n```\n";
    const projectDir = makeTempProjectWithAgent("fake-agent", fenced);
    const graph = parseInlineDot(`
      digraph test {
        inputs="project"
        start -> n1 [label="go"]
        n1 [agent="fake-agent"]
        n1 -> exit
      }
    `);
    const res = scanUndeclaredCallerVars(graph, { project: projectDir });
    expect(res.missing.some((m) => typeof m === "object" && m.name === "HOME")).toBe(false);
  });

  it("skips agent body when node.prompt is set (override)", async () => {
    const projectDir = makeTempProjectWithAgent("fake-agent", "$typo_var\n");
    const graph = parseInlineDot(`
      digraph test {
        inputs="project"
        start -> n1 [label="go"]
        n1 [agent="fake-agent", prompt="no var here"]
        n1 -> exit
      }
    `);
    const res = scanUndeclaredCallerVars(graph, { project: projectDir });
    expect(res.missing.some((m) => typeof m === "object" && m.name === "typo_var")).toBe(false);
  });
});
