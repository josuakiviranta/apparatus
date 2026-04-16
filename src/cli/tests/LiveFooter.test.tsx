import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect, vi } from "vitest";
import { LiveFooter } from "../components/LiveFooter.js";
import type { LiveBlockWithInput } from "../components/LiveFooter.js";

function makeLive(overrides: Partial<LiveBlockWithInput> = {}): LiveBlockWithInput {
  return {
    id: "chat-0",
    nodeId: "chat",
    label: "interactive agent",
    kind: "interactive-agent",
    startedAt: Date.now() - 2300,
    body: [],
    stats: { turns: 1, tokensIn: 19, tokensOut: 182 },
    ...overrides,
  };
}

function makeAgentLive(overrides: Partial<LiveBlockWithInput> = {}): LiveBlockWithInput {
  return makeLive({ kind: "agent", ...overrides });
}

describe("LiveFooter", () => {
  it("does not render block header — header is handled by PipelineApp Static", () => {
    const block = makeLive();
    const { lastFrame } = render(<LiveFooter block={block} />);
    const frame = lastFrame() ?? "";
    expect(frame).not.toContain("━━");
    expect(frame).not.toContain("[1]");
    // Status line is present
    expect(frame).toContain("turns");
  });

  it("does not render trace — trace is handled by PipelineApp Static", () => {
    const block = makeLive({
      tracePath: "/Users/josu/.claude/projects/-cwd/sid-a.jsonl",
    });
    const { lastFrame } = render(<LiveFooter block={block} />);
    const frame = lastFrame() ?? "";
    expect(frame).not.toContain("trace:");
    expect(frame).not.toContain("sid-a.jsonl");
  });

  it("does not render body lines — body is handled by PipelineApp Static", () => {
    const block = makeLive({
      body: [
        { kind: "text", role: "you", text: "summarize the repo" },
        { kind: "text", role: "claude", text: "ralph-cli has 4 layers" },
      ],
    });
    const { lastFrame } = render(<LiveFooter block={block} />);
    const frame = lastFrame() ?? "";
    expect(frame).not.toContain("you:");
    expect(frame).not.toContain("summarize the repo");
    expect(frame).not.toContain("claude:");
  });

  it("renders status line with turn count and token stats", () => {
    const block = makeLive({
      stats: { turns: 3, tokensIn: 891, tokensOut: 634 },
    });
    const { lastFrame } = render(<LiveFooter block={block} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("3 turns");
    expect(frame).toContain("891/634 tok");
  });

  it("renders TextInput when input prop is present", () => {
    const block = makeLive({
      input: {
        value: "what's in src?",
        onChange: vi.fn(),
        onSubmit: vi.fn(),
      },
    });
    const { lastFrame } = render(<LiveFooter block={block} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain(">");
    expect(frame).toContain("what's in src?");
  });

  it("shows a disabled input placeholder when kind is interactive-agent and input is absent", () => {
    const block = makeLive({ input: undefined });
    const { lastFrame } = render(<LiveFooter block={block} />);
    const frame = lastFrame() ?? "";
    // Placeholder prompt row must exist to keep line count stable
    expect(frame).toMatch(/^>/m);
    // But there must be no interactive value content
    expect(frame).not.toContain("what's in src?");
  });

  it("handles empty body gracefully", () => {
    const block = makeLive({ body: [] });
    const { lastFrame } = render(<LiveFooter block={block} />);
    const frame = lastFrame() ?? "";
    // Should still render status, no crash
    expect(frame).toContain("turns");
  });

  it("does not render trace for agent kind — trace is handled by PipelineApp Static", () => {
    const block = makeAgentLive({
      tracePath: "/Users/x/.claude/projects/-cwd/abc.jsonl",
    });
    const { lastFrame } = render(<LiveFooter block={block} />);
    const frame = lastFrame() ?? "";
    expect(frame).not.toContain("trace:");
    expect(frame).not.toContain("abc.jsonl");
  });

  it("does not show trace row for non-agent kinds (wait-human)", () => {
    const { lastFrame } = render(
      <LiveFooter
        block={{
          id: "gate-0",
          nodeId: "g",
          label: "gate",
          kind: "wait-human",
          startedAt: Date.now(),
          body: [],
          stats: { turns: 0, tokensIn: 0, tokensOut: 0 },
          gate: { options: ["Yes"], onChoose: vi.fn() },
        }}
      />
    );
    const frame = lastFrame() ?? "";
    expect(frame).not.toMatch(/trace:/);
  });

  it("does not show input row for agent (non-interactive) kind", () => {
    const block = makeAgentLive({ tracePath: undefined });
    const { lastFrame } = render(<LiveFooter block={block} />);
    const frame = lastFrame() ?? "";
    expect(frame).not.toMatch(/^> /m);
  });
});

describe("LiveFooter — wait-human gate", () => {
  function makeGateLiveBlock(overrides: Partial<LiveBlockWithInput> = {}): LiveBlockWithInput {
    return {
      id: "gate-0",
      nodeId: "approval_gate",
      label: "Do you approve?",
      kind: "wait-human",
      startedAt: Date.now() - 1000,
      body: [],
      stats: { turns: 0, tokensIn: 0, tokensOut: 0 },
      gate: {
        options: ["Approve", "Decline"],
        onChoose: vi.fn(),
      },
      ...overrides,
    };
  }

  it("renders GateSelector options when block.gate is set", () => {
    const { lastFrame } = render(<LiveFooter block={makeGateLiveBlock()} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("▶ 1. Approve");
    expect(frame).toContain("  2. Decline");
  });

  it("shows 'awaiting choice' status instead of streaming spinner", () => {
    const { lastFrame } = render(<LiveFooter block={makeGateLiveBlock()} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("awaiting choice");
    expect(frame).not.toContain("streaming");
  });

  it("does not render GateSelector when block.gate is absent", () => {
    const block = makeGateLiveBlock();
    delete (block as Partial<typeof block>).gate;
    const { lastFrame } = render(<LiveFooter block={block} />);
    const frame = lastFrame() ?? "";
    expect(frame).not.toContain("▶");
    expect(frame).not.toContain("↑↓ navigate");
  });
});
