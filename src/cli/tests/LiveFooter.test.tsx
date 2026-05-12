import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render } from "ink-testing-library";
import { LiveFooter } from "../components/LiveFooter.js";
import type { LiveBlock } from "../lib/pipelineEvents.js";
import { __agentStatesForTest } from "../lib/interactions/drivers/agent.js";
import { __gateStatesForTest } from "../lib/interactions/drivers/gate.js";

function block(kind: LiveBlock["kind"], id = "blk"): LiveBlock {
  return {
    id,
    nodeId: id,
    label: "label",
    kind,
    startedAt: Date.now() - 100,
    body: [],
    stats: { turns: 0, tokensIn: 0, tokensOut: 0 },
  };
}

afterEach(() => {
  __agentStatesForTest.clear();
  __gateStatesForTest.clear();
});

describe("LiveFooter", () => {
  it("renders the agent driver's TextInput for interactive-agent kind", () => {
    const blk = block("interactive-agent", "a-1");
    __agentStatesForTest.set("a-1", {
      child: { kill: vi.fn() } as never,
      onDone: vi.fn(),
    });
    const { lastFrame } = render(
      <LiveFooter
        block={blk}
        inputBuffer="hello"
        onInputChange={() => {}}
        onInputSubmit={async () => {}}
      />,
    );
    const out = lastFrame() ?? "";
    expect(out).toContain(">");
    expect(out).toContain("hello");
  });

  it("renders the gate driver's GateSelector for wait-human kind", () => {
    const blk = block("wait-human", "g-1");
    __gateStatesForTest.set("g-1", {
      options: ["Approve", "Decline"],
      onChoose: vi.fn(),
    });
    const { lastFrame } = render(
      <LiveFooter
        block={blk}
        inputBuffer=""
        onInputChange={() => {}}
        onInputSubmit={async () => {}}
      />,
    );
    const out = lastFrame() ?? "";
    expect(out).toContain("Approve");
    expect(out).toContain("Decline");
  });

  it("renders the shared status line for every kind", () => {
    const blk = block("wait-human", "g-2");
    __gateStatesForTest.set("g-2", { options: ["X"], onChoose: () => {} });
    const { lastFrame } = render(
      <LiveFooter
        block={blk}
        inputBuffer=""
        onInputChange={() => {}}
        onInputSubmit={async () => {}}
      />,
    );
    const out = lastFrame() ?? "";
    expect(out).toMatch(/awaiting choice/);
  });

  it("renders no driver footer for non-interactive kinds (e.g. agent)", () => {
    const blk = block("agent", "a-2");
    const { lastFrame } = render(
      <LiveFooter
        block={blk}
        inputBuffer=""
        onInputChange={() => {}}
        onInputSubmit={async () => {}}
      />,
    );
    const out = lastFrame() ?? "";
    expect(out).not.toContain(">");
    expect(out).not.toContain("Approve");
  });
});
