import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { parseDot } from "../core/graph.js";
import { validateGraph } from "../core/graph-validator.js";

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "ralph-vrule-"));
  return {
    dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
    writeAgent: (name: string, frontmatter: string, body = "agent body\n") => {
      writeFileSync(join(dir, `${name}.md`), `---\n${frontmatter}---\n\n${body}`);
    },
    writeDot: (dot: string) => {
      writeFileSync(join(dir, "g.dot"), dot);
    },
  };
}

describe("interactive_with_outputs_forbidden", () => {
  it("fires when interactive=true node uses an agent with outputs:", () => {
    const { dir, cleanup, writeAgent, writeDot } = setup();
    try {
      writeAgent("chat", `name: chat\ndescription: a chat agent\nmodel: opus\noutputs:\n  note: string\n`);
      const dot = `digraph G {\n  start [shape=Mdiamond];\n  n1 [agent="chat" interactive=true];\n  end [shape=Msquare];\n  start -> n1 -> end;\n}\n`;
      writeDot(dot);
      const graph = parseDot(dot);
      const diags = validateGraph(graph, dir);
      const fired = diags.find(d => d.rule === "interactive_with_outputs_forbidden");
      expect(fired).toBeDefined();
      expect(fired!.severity).toBe("error");
      expect(fired!.message).toContain("n1");
      expect(fired!.message).toContain("chat");
      expect(fired!.location).toBeDefined();
    } finally {
      cleanup();
    }
  });

  it("does NOT fire when interactive=true node uses an agent without outputs:", () => {
    const { dir, cleanup, writeAgent, writeDot } = setup();
    try {
      writeAgent("chat", `name: chat\ndescription: a chat agent\nmodel: opus\n`);
      const dot = `digraph G {\n  start [shape=Mdiamond];\n  n1 [agent="chat" interactive=true];\n  end [shape=Msquare];\n  start -> n1 -> end;\n}\n`;
      writeDot(dot);
      const graph = parseDot(dot);
      const diags = validateGraph(graph, dir);
      expect(diags.find(d => d.rule === "interactive_with_outputs_forbidden")).toBeUndefined();
    } finally {
      cleanup();
    }
  });

  it("does NOT fire when agent has outputs: but node is non-interactive", () => {
    const { dir, cleanup, writeAgent, writeDot } = setup();
    try {
      writeAgent("worker", `name: worker\ndescription: a worker agent\nmodel: opus\noutputs:\n  note: string\n  done: boolean\n`);
      const dot = `digraph G {\n  start [shape=Mdiamond];\n  n1 [agent="worker"];\n  end [shape=Msquare];\n  start -> n1 -> end;\n}\n`;
      writeDot(dot);
      const graph = parseDot(dot);
      const diags = validateGraph(graph, dir);
      expect(diags.find(d => d.rule === "interactive_with_outputs_forbidden")).toBeUndefined();
    } finally {
      cleanup();
    }
  });
});
