import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { resolveAgentFileForNode } from "../lib/agent-paths.js";
import type { Node } from "../../attractor/types.js";

describe("resolveAgentFileForNode", () => {
  let dotDir: string;

  beforeEach(() => {
    dotDir = mkdtempSync(join(tmpdir(), "apparat-agent-paths-"));
  });

  afterEach(() => {
    rmSync(dotDir, { recursive: true, force: true });
  });

  it("returns the relative path when an agent node has an .md sibling", () => {
    writeFileSync(join(dotDir, "implement.md"), "---\noutputs:\n  ok: bool\n---\n");
    const node = { id: "implement", agent: "implement" } as Node;
    const result = resolveAgentFileForNode(node, dotDir);
    expect(result).not.toBeNull();
    expect(result).toContain("implement.md");
  });

  it("returns the relative path for a wait.human (gate) node with an .md sibling", () => {
    writeFileSync(join(dotDir, "approval.md"), "---\nchoices: [Approve, Reject]\n---\nDo we ship?");
    const node = { id: "approval", shape: "hexagon" } as Node;
    const result = resolveAgentFileForNode(node, dotDir);
    expect(result).not.toBeNull();
    expect(result).toContain("approval.md");
  });

  it("returns null for tool nodes (no .md sibling expected)", () => {
    const node = { id: "runner", type: "tool", shape: "parallelogram" } as Node;
    const result = resolveAgentFileForNode(node, dotDir);
    expect(result).toBeNull();
  });

  it("returns null for start/exit marker nodes", () => {
    const start = { id: "start", shape: "Mdiamond" } as Node;
    const exitNode = { id: "done", shape: "Msquare" } as Node;
    expect(resolveAgentFileForNode(start, dotDir)).toBeNull();
    expect(resolveAgentFileForNode(exitNode, dotDir)).toBeNull();
  });

  it("returns null for conditional / store nodes", () => {
    const cond = { id: "branch", shape: "diamond" } as Node;
    const store = { id: "save", shape: "cylinder" } as Node;
    expect(resolveAgentFileForNode(cond, dotDir)).toBeNull();
    expect(resolveAgentFileForNode(store, dotDir)).toBeNull();
  });

  it("returns null when an agent node's .md sibling does not exist on disk", () => {
    const node = { id: "missing", agent: "missing" } as Node;
    expect(resolveAgentFileForNode(node, dotDir)).toBeNull();
  });

  it("returns the absolute path when the file lives outside cwd (relative diverges)", () => {
    writeFileSync(join(dotDir, "external.md"), "---\noutputs:\n  ok: bool\n---\n");
    const node = { id: "external", agent: "external" } as Node;
    const result = resolveAgentFileForNode(node, dotDir);
    // Either `<somepath>/external.md` (relative) or `/.../external.md` (absolute fallback).
    expect(result).toMatch(/external\.md$/);
  });
});
