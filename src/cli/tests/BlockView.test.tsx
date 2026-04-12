import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect } from "vitest";
import { BlockView, BodyLineView } from "../components/BlockView.js";
import type { Block, BodyLine } from "../lib/pipelineEvents.js";

function makeBlock(overrides: Partial<Block> = {}): Block {
  return {
    id: "chat-0",
    nodeId: "chat",
    label: "interactive agent",
    kind: "interactive-agent",
    body: [],
    outcome: { status: "success" },
    stats: { turns: 2, tokensIn: 42, tokensOut: 417, durationMs: 21300 },
    ...overrides,
  };
}

describe("BlockView", () => {
  it("renders header with index, nodeId, label, and separator", () => {
    const block = makeBlock();
    const { lastFrame } = render(<BlockView block={block} index={1} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("[1]");
    expect(frame).toContain("chat");
    expect(frame).toContain("interactive agent");
    expect(frame).toContain("━━");
  });

  it("shows trace path for agent blocks", () => {
    const block = makeBlock({
      kind: "agent",
      tracePath: "/Users/josu/.claude/projects/-cwd/abc123.jsonl",
    });
    const { lastFrame } = render(<BlockView block={block} index={1} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("trace:");
    expect(frame).toContain("abc123.jsonl");
  });

  it("omits trace path for marker blocks", () => {
    const block = makeBlock({
      kind: "marker",
      nodeId: "done",
      label: "node",
      tracePath: undefined,
    });
    const { lastFrame } = render(<BlockView block={block} index={3} />);
    const frame = lastFrame() ?? "";
    expect(frame).not.toContain("trace:");
  });

  it("renders body text lines with role prefix", () => {
    const block = makeBlock({
      body: [
        { kind: "text", role: "you", text: "summarize the repo" },
        { kind: "text", role: "claude", text: "ralph-cli has 4 layers" },
      ],
    });
    const { lastFrame } = render(<BlockView block={block} index={1} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("you:");
    expect(frame).toContain("summarize the repo");
    expect(frame).toContain("claude:");
    expect(frame).toContain("ralph-cli has 4 layers");
  });

  it("renders tool_use lines", () => {
    const block = makeBlock({
      body: [
        { kind: "tool_use", name: "Write", summary: "specs/chat-summary.md" },
      ],
    });
    const { lastFrame } = render(<BlockView block={block} index={2} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("[tool_use: Write]");
    expect(frame).toContain("specs/chat-summary.md");
  });

  it("shows error outcome with ✗ and reason", () => {
    const block = makeBlock({
      outcome: { status: "fail", reason: "crash: ENOENT spawn claude" },
      stats: { turns: 0, tokensIn: 0, tokensOut: 0, durationMs: 800 },
    });
    const { lastFrame } = render(<BlockView block={block} index={2} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("✗");
    expect(frame).toContain("fail");
    expect(frame).toContain("crash: ENOENT spawn claude");
  });

  it("shows abort outcome with ✗ and reason", () => {
    const block = makeBlock({
      outcome: { status: "abort", reason: "user-interrupt" },
      stats: { turns: 0, tokensIn: 120, tokensOut: 48, durationMs: 1900 },
    });
    const { lastFrame } = render(<BlockView block={block} index={2} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("✗");
    expect(frame).toContain("abort");
    expect(frame).toContain("user-interrupt");
  });

  it("shows success outcome with ✓ and stats", () => {
    const block = makeBlock();
    const { lastFrame } = render(<BlockView block={block} index={1} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("✓");
    expect(frame).toContain("success");
    expect(frame).toContain("2 turns");
    expect(frame).toContain("42/417 tok");
    expect(frame).toContain("21.3s");
  });

  it("handles empty body gracefully", () => {
    const block = makeBlock({ body: [] });
    const { lastFrame } = render(<BlockView block={block} index={1} />);
    const frame = lastFrame() ?? "";
    // Should still render header and outcome, no crash
    expect(frame).toContain("[1]");
    expect(frame).toContain("✓");
  });
});

describe("BodyLineView", () => {
  it("renders text lines with role prefix", () => {
    const line: BodyLine = { kind: "text", role: "you", text: "hello world" };
    const { lastFrame } = render(<BodyLineView line={line} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("you:");
    expect(frame).toContain("hello world");
  });

  it("renders tool_use lines as dim", () => {
    const line: BodyLine = { kind: "tool_use", name: "Read", summary: "src/index.ts" };
    const { lastFrame } = render(<BodyLineView line={line} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("[tool_use: Read]");
    expect(frame).toContain("src/index.ts");
  });
});
