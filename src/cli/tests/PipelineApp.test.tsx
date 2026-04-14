import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import { PipelineApp, type PipelineAppCallbacks } from "../components/PipelineApp.js";
import { LiveFooter } from "../components/LiveFooter.js";
import type { ChildHandle } from "../lib/agent.js";
import type { LiveBlock } from "../lib/pipelineEvents.js";

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

  it("body lines appear in PipelineApp output while node is still live (mid-stream)", async () => {
    const { instance, cbs } = mount();
    cbs.emit({ kind: "start", nodeId: "work", label: "agent", blockKind: "agent" });
    cbs.emit({ kind: "text", role: "claude", text: "mid-stream line" });
    // NOTE: no `end` event — block is still live
    await flush();
    const frame = instance.lastFrame() ?? "";
    expect(frame).toContain("mid-stream line");
    expect(frame).toContain("claude:");
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

  it("does not re-raise SIGINT when stdin is not a TTY and ctrl-c is pressed", async () => {
    const kills: Array<number | NodeJS.Signals | string> = [];
    vi.spyOn(process, "kill").mockImplementation((pid, sig) => {
      kills.push(sig as string);
      return true;
    });
    const origDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });

    try {
      let cbs: PipelineAppCallbacks | undefined;
      const instance = render(
        <PipelineApp pipelineName="t" pid={1} nodes={[]} onReady={(c) => { cbs = c; }} />
      );
      if (!cbs) throw new Error("onReady never fired");
      void cbs; // suppress unused warning
      (instance as any).stdin.write("\x03"); // ctrl-c
      await flush();
      expect(kills.filter((s) => s === "SIGINT")).toHaveLength(0);
    } finally {
      vi.restoreAllMocks();
      if (origDescriptor) {
        Object.defineProperty(process.stdin, "isTTY", origDescriptor);
      }
    }
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

  it("renders trace path exactly once even when multiple trace-path events fire", async () => {
    const { instance, cbs } = mount();
    cbs.emit({ kind: "start", nodeId: "work", label: "agent", blockKind: "agent" });
    // Claude CLI emits multiple system events with the same sessionId per session.
    for (let i = 0; i < 7; i++) {
      cbs.emit({ kind: "trace-path", sessionId: "abc123" });
    }
    await flush();
    const frame = instance.lastFrame() ?? "";
    const matches = (frame.match(/abc123/g) ?? []).length;
    expect(matches).toBe(1);
  });
});

function makeLiveBlock(overrides: Partial<LiveBlock> = {}): LiveBlock {
  return {
    id: "work-0",
    nodeId: "work",
    label: "agent",
    kind: "agent",
    startedAt: Date.now() - 1000,
    body: [],
    stats: { turns: 0, tokensIn: 0, tokensOut: 0 },
    ...overrides,
  };
}

describe("LiveFooter", () => {
  it("does not render body lines — body is handled by PipelineApp Static", () => {
    const block = makeLiveBlock({
      body: [
        { kind: "text", role: "claude", text: "streamed content" },
        { kind: "tool_use", name: "Read", summary: "reading file" },
      ],
    });
    const { lastFrame } = render(<LiveFooter block={block} index={1} />);
    const frame = lastFrame() ?? "";
    expect(frame).not.toContain("streamed content");
    expect(frame).not.toContain("claude:");
    expect(frame).not.toContain("[tool_use: Read]");
    // But it must still show the header and status
    expect(frame).toContain("[1] work");
    expect(frame).toContain("streaming");
  });
});
