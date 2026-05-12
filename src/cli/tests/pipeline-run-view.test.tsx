import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import { PipelineRunView } from "../components/PipelineRunView.js";
import type { PipelineRunViewCallbacks } from "../components/PipelineRunView.js";
import type { ChildHandle } from "../lib/agent.js";

const flush = () => new Promise<void>((r) => setTimeout(r, 20));

interface Mount {
  cbs: PipelineRunViewCallbacks;
  currentFrame: () => string;
  stdin: { write: (s: string) => void };
  unmount: () => void;
}

async function mountPipelineRunView(): Promise<Mount> {
  // Pretend stdin is a TTY so PipelineRunView's useInput is active.
  // ink-testing-library still delivers stdin.write() to the registered handlers.
  Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
  let captured: PipelineRunViewCallbacks | null = null;
  const { lastFrame, stdin, unmount } = render(
    <PipelineRunView
      pipelineName="demo"
      pid={1}
      nodes={[]}
      runId="r1"
      tracePath="/tmp/r1/pipeline.jsonl"
      onReady={(cbs) => { captured = cbs; }}
    />
  );
  // Yield so the onReady callback fires.
  await flush();
  if (!captured) throw new Error("onReady was not called");
  return {
    cbs: captured,
    currentFrame: () => lastFrame() ?? "",
    stdin: { write: (s: string) => stdin.write(s) },
    unmount,
  };
}

describe("PipelineRunView", () => {
  it("renders header with pipeline name, pid, and trace path", async () => {
    const { lastFrame, unmount } = render(
      <PipelineRunView
        pipelineName="demo"
        pid={1234}
        nodes={["start", "work", "done"]}
        runId="r1"
        tracePath="/tmp/r1/pipeline.jsonl"
        onReady={() => {}}
      />
    );
    const out = lastFrame() ?? "";
    expect(out).toContain("demo");
    expect(out).toContain("PID 1234");
    expect(out).toContain("/tmp/r1/pipeline.jsonl");
    unmount();
  });

  it("emits onReady with emit + done callbacks", async () => {
    let captured: { emit: Function; done: Function } | null = null;
    const { unmount } = render(
      <PipelineRunView
        pipelineName="demo"
        pid={1}
        nodes={[]}
        runId="r2"
        tracePath="/tmp/r2/pipeline.jsonl"
        onReady={(cbs) => { captured = cbs as any; }}
      />
    );
    await flush();
    expect(captured).not.toBeNull();
    expect(typeof captured!.emit).toBe("function");
    expect(typeof captured!.done).toBe("function");
    unmount();
  });

  it("driver-event with agent.ready payload mounts the TextInput footer", async () => {
    const m = await mountPipelineRunView();
    m.cbs.emit({ kind: "start", nodeId: "chat", label: "agent", blockKind: "interactive-agent" });
    const child = { kill: vi.fn().mockResolvedValue(undefined), submit: vi.fn(), end: vi.fn() } as unknown as ChildHandle;
    const onDone = vi.fn();
    m.cbs.emit({
      kind: "driver-event",
      payload: { driver: "interactive-agent", kind: "agent.ready", child, onDone },
    });
    await flush();
    expect(m.currentFrame()).toContain(">");
    m.unmount();
  });

  it("driver-event with gate.ready payload mounts the GateSelector footer", async () => {
    const m = await mountPipelineRunView();
    m.cbs.emit({ kind: "start", nodeId: "g", label: "Gate?", blockKind: "wait-human" });
    m.cbs.emit({
      kind: "driver-event",
      payload: { driver: "wait-human", kind: "gate.ready", options: ["A", "B"], onChoose: vi.fn() },
    });
    await flush();
    const out = m.currentFrame();
    expect(out).toContain("A");
    expect(out).toContain("B");
    m.unmount();
  });

  it("Esc on a live gate calls drivers['wait-human'].keymap.escape", async () => {
    const { __gateStatesForTest, ABORT_CHOICE } = await import("../lib/interactions/drivers/gate.js");
    __gateStatesForTest.clear();
    const m = await mountPipelineRunView();
    m.cbs.emit({ kind: "start", nodeId: "g", label: "Gate?", blockKind: "wait-human" });
    const onChoose = vi.fn();
    m.cbs.emit({
      kind: "driver-event",
      payload: { driver: "wait-human", kind: "gate.ready", options: ["A"], onChoose },
    });
    await flush();
    m.stdin.write("\u001b");
    await flush();
    expect(onChoose).toHaveBeenCalledWith(ABORT_CHOICE);
    __gateStatesForTest.clear();
    m.unmount();
  });

  it("Esc on a live interactive-agent calls child.kill('SIGTERM')", async () => {
    const { __agentStatesForTest } = await import("../lib/interactions/drivers/agent.js");
    __agentStatesForTest.clear();
    const m = await mountPipelineRunView();
    m.cbs.emit({ kind: "start", nodeId: "chat", label: "agent", blockKind: "interactive-agent" });
    const kill = vi.fn().mockResolvedValue(undefined);
    const child = { kill, submit: vi.fn(), end: vi.fn() } as unknown as ChildHandle;
    m.cbs.emit({
      kind: "driver-event",
      payload: { driver: "interactive-agent", kind: "agent.ready", child, onDone: vi.fn() },
    });
    await flush();
    m.stdin.write("\u001b");
    await flush();
    expect(kill).toHaveBeenCalledWith("SIGTERM");
    __agentStatesForTest.clear();
    m.unmount();
  });
});
