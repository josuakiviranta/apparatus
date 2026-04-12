import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { PipelineApp, type PipelineAppCallbacks } from "../components/PipelineApp.js";
import type { ChildHandle } from "../lib/agent.js";

// Ink re-renders asynchronously — wait for state updates to flush.
const flush = () => new Promise((r) => setTimeout(r, 50));

function mount() {
  let cbs: PipelineAppCallbacks | undefined;
  const instance = render(
    <PipelineApp
      pipelineName="chat_end_to_end"
      pid={13198}
      nodes={["chat", "summarize", "done"]}
      onReady={(c) => { cbs = c; }}
    />,
  );
  if (!cbs) throw new Error("onReady never fired");
  return { instance, cbs };
}

describe("PipelineApp", () => {
  it("renders header with pipeline name and nodes list", () => {
    const { instance } = mount();
    const frame = instance.lastFrame() ?? "";
    expect(frame).toContain("chat_end_to_end");
    expect(frame).toMatch(/chat.*summarize.*done/);
  });

  it("freezes a single node: start → text → text → end produces one frozen block", async () => {
    const { instance, cbs } = mount();
    cbs.emit({ kind: "start", nodeId: "chat", label: "agent", blockKind: "agent" });
    cbs.emit({ kind: "text", role: "claude", text: "hello" });
    cbs.emit({ kind: "text", role: "claude", text: " world" });
    cbs.emit({
      kind: "end",
      outcome: { status: "success" },
      stats: { turns: 1, tokensIn: 5, tokensOut: 2, durationMs: 100 },
    });

    await flush();
    const frame = instance.lastFrame() ?? "";
    expect(frame).toContain("[1] chat");
    expect(frame).toContain("claude:");
    expect(frame).toContain("hello");
    expect(frame).toContain("world");
    expect(frame).toMatch(/✓/);
  });

  it("sequential nodes produce two frozen blocks with live=null between them", async () => {
    const { instance, cbs } = mount();
    cbs.emit({ kind: "start", nodeId: "a", label: "agent", blockKind: "agent" });
    cbs.emit({
      kind: "end", outcome: { status: "success" },
      stats: { turns: 1, tokensIn: 0, tokensOut: 0, durationMs: 10 },
    });
    cbs.emit({ kind: "start", nodeId: "b", label: "agent", blockKind: "agent" });
    cbs.emit({ kind: "text", role: "claude", text: "second body" });
    cbs.emit({
      kind: "end", outcome: { status: "success" },
      stats: { turns: 1, tokensIn: 0, tokensOut: 0, durationMs: 10 },
    });

    await flush();
    const frame = instance.lastFrame() ?? "";
    expect(frame).toContain("[1] a");
    expect(frame).toContain("[2] b");
    expect(frame).toContain("second body");
    // Both are frozen; no live footer spinner text
    expect(frame).not.toMatch(/● awaiting/);
  });

  it("interactive-ready wires child + invokes onDone exactly once when the block freezes", async () => {
    const { cbs } = mount();
    let onDoneCalls = 0;
    const fakeChild = {} as ChildHandle;
    const onDone = () => { onDoneCalls++; };

    cbs.emit({
      kind: "start", nodeId: "chat", label: "interactive agent", blockKind: "interactive-agent",
    });
    cbs.emit({ kind: "interactive-ready", child: fakeChild, onDone });
    cbs.emit({ kind: "text", role: "you", text: "hi" });
    cbs.emit({ kind: "text", role: "claude", text: "hi there" });

    await flush();
    expect(onDoneCalls).toBe(0); // not yet frozen

    cbs.emit({
      kind: "end", outcome: { status: "success" },
      stats: { turns: 1, tokensIn: 10, tokensOut: 5, durationMs: 200 },
    });
    await flush();
    expect(onDoneCalls).toBe(1);

    // A subsequent freeze does not re-trigger the old onDone.
    cbs.emit({ kind: "start", nodeId: "next", label: "agent", blockKind: "agent" });
    cbs.emit({
      kind: "end", outcome: { status: "success" },
      stats: { turns: 1, tokensIn: 0, tokensOut: 0, durationMs: 10 },
    });
    await flush();
    expect(onDoneCalls).toBe(1);
  });
});
