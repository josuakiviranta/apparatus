import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { PipelineApp } from "../components/PipelineApp.js";
import type { PipelineAppCallbacks } from "../components/PipelineApp.js";
import { createFakeChildHandle } from "./helpers/fake-child-handle.js";

// React 18 batches dispatch() calls made outside event handlers. Flushing
// to the Ink frame requires yielding a microtask so the scheduler commits.
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe("PipelineApp integration: chat → summarize full flow", () => {
  it("renders chat block, freezes on end, then renders summarize block — no stacked borders", async () => {
    let captured: PipelineAppCallbacks | null = null;
    const { lastFrame } = render(
      <PipelineApp
        pipelineName="chat_end_to_end"
        pid={12345}
        goal={undefined}
        nodes={["chat", "summarize"]}
        onReady={(cbs) => { captured = cbs; }}
      />,
    );
    expect(captured).not.toBeNull();
    const { emit, done } = captured!;

    // 1. Start + run the interactive chat block.
    const chatController = createFakeChildHandle("sid-abc");
    const chatChild = chatController.handle;
    let chatDone!: () => void;
    const chatDonePromise = new Promise<void>((res) => { chatDone = res; });

    emit({ kind: "start", nodeId: "chat", label: "interactive", blockKind: "interactive-agent" });
    emit({ kind: "interactive-ready", child: chatChild, onDone: chatDone });
    emit({ kind: "trace-path", sessionId: "sid-abc" });
    emit({ kind: "text", role: "you", text: "hello" });
    emit({ kind: "text", role: "claude", text: "hi, what did you learn today?" });

    // Yield so React 18 flushes batched dispatches into the Ink frame.
    await flush();

    // The chat block should now be LIVE (in the footer, not in <Static>)
    let frame = lastFrame() ?? "";
    expect(frame).toContain("[1] chat");
    expect(frame).toContain("trace: ");
    expect(frame).toMatch(/sid-abc\.jsonl/);
    expect(frame).toContain("hello");
    expect(frame).toContain("hi, what did you learn today?");
    // regression: no <Box borderStyle="single"> output from old PipelineDisplay
    expect(frame).not.toMatch(/┌─+┐/);

    // 2. End the chat — this freezes block [1] into <Static> and fires onDone.
    emit({ kind: "end", outcome: { status: "success" } });
    await chatDonePromise;

    // 3. Now run the non-interactive summarize block.
    emit({ kind: "start", nodeId: "summarize", label: "agent", blockKind: "agent" });
    emit({ kind: "trace-path", sessionId: "sid-xyz" });
    emit({ kind: "text", role: "claude", text: "You learned about React 18 batching." });
    emit({ kind: "end", outcome: { status: "success" } });

    await flush();
    frame = lastFrame() ?? "";

    // 4. Assertions — each maps to one of the three original bugs.
    //    (a) Stacked border bug:
    expect(frame).not.toMatch(/┌─+┐/);
    //    (b) Mid-chat trace header bug: trace line appears BEFORE the body.
    const chatBlockMatch = frame.match(/\[1\] chat[\s\S]*?(?=\[2\] summarize)/);
    expect(chatBlockMatch).not.toBeNull();
    const chatBlock = chatBlockMatch![0];
    const traceIdx = chatBlock.indexOf("trace: ");
    const claudeIdx = chatBlock.indexOf("claude");
    expect(traceIdx).toBeGreaterThan(-1);
    expect(claudeIdx).toBeGreaterThan(-1);
    expect(traceIdx).toBeLessThan(claudeIdx);
    //    (c) Downstream output loss: summarize block header + body both visible
    expect(frame).toContain("[2] summarize");
    expect(frame).toContain("You learned about React 18 batching.");

    //    (d) Outcome glyph appears for BOTH blocks
    const glyphCount = (frame.match(/[✓✗]/g) ?? []).length;
    expect(glyphCount).toBeGreaterThanOrEqual(2);

    //    (e) Exactly one header line per block — no duplicates.
    expect((frame.match(/━━ \[1\] chat/g) ?? []).length).toBe(1);
    expect((frame.match(/━━ \[2\] summarize/g) ?? []).length).toBe(1);

    done();
  });

  it("abort path: emitting end with status=abort freezes live block and does not crash", () => {
    let captured: PipelineAppCallbacks | null = null;
    render(
      <PipelineApp
        pipelineName="p"
        pid={1}
        goal={undefined}
        nodes={["chat"]}
        onReady={(cbs) => { captured = cbs; }}
      />,
    );
    const { emit, done } = captured!;

    emit({ kind: "start", nodeId: "chat", label: "interactive", blockKind: "interactive-agent" });
    emit({ kind: "text", role: "you", text: "partial" });
    // First abort end must freeze cleanly.
    expect(() => emit({ kind: "end", outcome: { status: "abort", reason: "user-interrupt" } })).not.toThrow();
    // Second end with no live block must be a silent no-op (reducer guard).
    expect(() => emit({ kind: "end", outcome: { status: "fail", reason: "late" } })).not.toThrow();
    done();
  });
});
