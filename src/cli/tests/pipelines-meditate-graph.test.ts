import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseDot } from "../../attractor/core/graph.js";
import { validateGraph } from "../../attractor/core/graph-validator.js";

const REPO_ROOT = resolve(__dirname, "../../..");
const MEDITATE_DIR = join(REPO_ROOT, "src", "cli", "pipelines", "meditate");
const JANITOR_DIR = join(REPO_ROOT, "src", "cli", "pipelines", "janitor");

describe("meditate pipeline — sibling read-vision.mjs", () => {
  it("exists at src/cli/pipelines/meditate/read-vision.mjs", () => {
    expect(existsSync(join(MEDITATE_DIR, "read-vision.mjs"))).toBe(true);
  });

  it("is byte-identical to janitor's read-vision.mjs (file-copy reuse per ADR-0001)", () => {
    const meditateScript = readFileSync(join(MEDITATE_DIR, "read-vision.mjs"), "utf-8");
    const janitorScript = readFileSync(join(JANITOR_DIR, "read-vision.mjs"), "utf-8");
    expect(meditateScript).toBe(janitorScript);
  });
});

describe("meditate pipeline — pipeline.dot graph shape", () => {
  it("declares only `steer` as caller-supplied input", () => {
    const dotPath = join(MEDITATE_DIR, "pipeline.dot");
    const graph = parseDot(readFileSync(dotPath, "utf-8"));
    expect(graph.inputs).toEqual(["steer"]);
  });

  it("contains a read_vision tool node with cwd=$project + script_file=read-vision.mjs + produces_from_stdout", () => {
    const dotPath = join(MEDITATE_DIR, "pipeline.dot");
    const graph = parseDot(readFileSync(dotPath, "utf-8"));
    // Graph.nodes is a Map<string, Node>; parser converts snake_case attributes to camelCase
    const rv = graph.nodes.get("read_vision");
    expect(rv).toBeDefined();
    expect(rv!.type).toBe("tool");
    expect((rv as Record<string, unknown>).cwd).toBe("$project");
    expect((rv as Record<string, unknown>).scriptFile).toBe("read-vision.mjs");
    // producesFromStdout: parser may return string "true" or boolean true depending on quoting
    expect(String((rv as Record<string, unknown>).producesFromStdout)).toBe("true");
  });

  it("has default_vision=\"\" on the meditate agent node so a missing VISION.md still resolves", () => {
    const dotPath = join(MEDITATE_DIR, "pipeline.dot");
    const graph = parseDot(readFileSync(dotPath, "utf-8"));
    const meditate = graph.nodes.get("meditate");
    expect(meditate).toBeDefined();
    expect((meditate as Record<string, unknown>).defaultVision).toBe("");
  });

  it("has default_notes=\"\" on the meditate agent node so a missing notes.md still resolves", () => {
    const dotPath = join(MEDITATE_DIR, "pipeline.dot");
    const graph = parseDot(readFileSync(dotPath, "utf-8"));
    const meditate = graph.nodes.get("meditate");
    expect(meditate).toBeDefined();
    expect((meditate as Record<string, unknown>).defaultNotes).toBe("");
  });

  it("contains a read_notes tool node with cwd=$project + script_file=read-notes.mjs + produces_from_stdout", () => {
    const dotPath = join(MEDITATE_DIR, "pipeline.dot");
    const graph = parseDot(readFileSync(dotPath, "utf-8"));
    const rn = graph.nodes.get("read_notes");
    expect(rn).toBeDefined();
    expect(rn!.type).toBe("tool");
    expect((rn as Record<string, unknown>).cwd).toBe("$project");
    expect((rn as Record<string, unknown>).scriptFile).toBe("read-notes.mjs");
    expect(String((rn as Record<string, unknown>).producesFromStdout)).toBe("true");
  });

  it("wires start -> read_vision -> read_notes -> meditate -> end", () => {
    const dotPath = join(MEDITATE_DIR, "pipeline.dot");
    const graph = parseDot(readFileSync(dotPath, "utf-8"));
    const edgeKeys = graph.edges.map((e) => `${e.from}->${e.to}`);
    expect(edgeKeys).toContain("start->read_vision");
    expect(edgeKeys).toContain("read_vision->read_notes");
    expect(edgeKeys).toContain("read_notes->meditate");
    expect(edgeKeys).toContain("meditate->end");
  });

  it("validateGraph emits zero error-level diagnostics", () => {
    const dotPath = join(MEDITATE_DIR, "pipeline.dot");
    const graph = parseDot(readFileSync(dotPath, "utf-8"));
    const diags = validateGraph(graph, dirname(dotPath));
    const errors = diags.filter((d) => d.severity === "error");
    expect(errors).toEqual([]);
  });
});

describe("meditate pipeline — meditate.md rubric", () => {
  it("frontmatter inputs: declares [steer, read_vision.vision, read_notes.notes]", () => {
    const md = readFileSync(join(MEDITATE_DIR, "meditate.md"), "utf-8");
    const fm = md.match(/^---\n([\s\S]+?)\n---\n/);
    expect(fm).not.toBeNull();
    const inputsMatch = fm![1].match(/inputs:\n((?:\s+-\s+.+\n?)+)/);
    expect(inputsMatch).not.toBeNull();
    const inputs = inputsMatch![1]
      .split("\n")
      .map((l) => l.replace(/^\s+-\s+/, "").trim())
      .filter(Boolean);
    expect(inputs).toEqual(["steer", "read_vision.vision", "read_notes.notes"]);
  });

  it("body uses <read_vision_vision> placeholder, not the bare <vision> tag", () => {
    const md = readFileSync(join(MEDITATE_DIR, "meditate.md"), "utf-8");
    const fm = md.match(/^---\n[\s\S]+?\n---\n/);
    const body = md.slice(fm![0].length);
    expect(body).toContain("<read_vision_vision>");
    expect(body).not.toMatch(/<vision>/);
  });

  it("body uses <read_notes_notes> placeholder and references mark_note_picked", () => {
    const md = readFileSync(join(MEDITATE_DIR, "meditate.md"), "utf-8");
    const fm = md.match(/^---\n[\s\S]+?\n---\n/);
    const body = md.slice(fm![0].length);
    expect(body).toContain("<read_notes_notes>");
    expect(body).toContain("mark_note_picked");
  });

  it("frontmatter tools: declares mark_note_picked MCP tool", () => {
    const md = readFileSync(join(MEDITATE_DIR, "meditate.md"), "utf-8");
    const fm = md.match(/^---\n([\s\S]+?)\n---\n/);
    expect(fm).not.toBeNull();
    expect(fm![1]).toContain("mcp__illumination__mark_note_picked");
  });
});
