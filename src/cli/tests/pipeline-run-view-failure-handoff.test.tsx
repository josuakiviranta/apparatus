import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { PipelineRunView } from "../components/PipelineRunView.js";
import type { PipelineRunViewCallbacks } from "../components/PipelineRunView.js";
import {
  renderFailureFooter,
  type FailureHandoff,
} from "../lib/failure-handoff.js";
import { plainFrame } from "./helpers/plain-frame.js";

const flush = () => new Promise<void>((r) => setTimeout(r, 20));

const FULL: FailureHandoff = {
  nodeId: "runner",
  nodeReceiveId: "7f3e9c1a",
  agentRelPath: "pipelines/my/runner.md",
  reason: "boom-stderr",
  tracePath: "/work/.apparat/runs/a1b2c3d4/pipeline.jsonl",
  runId: "a1b2c3d4",
  rawOutputPath: "/work/.apparat/runs/a1b2c3d4/runner/raw-3.txt",
  resumeCommand: "apparat pipeline run /work/pipelines/my.dot --resume a1b2c3d4",
};

interface Mount {
  cbs: PipelineRunViewCallbacks;
  lastFrame: () => string | undefined;
  unmount: () => void;
}

async function mount(): Promise<Mount> {
  let captured: PipelineRunViewCallbacks | null = null;
  const { lastFrame, unmount } = render(
    <PipelineRunView
      pipelineName="demo"
      pid={1}
      nodes={[]}
      runId="a1b2c3d4"
      tracePath="/tmp/a1b2c3d4/pipeline.jsonl"
      onReady={(cbs) => { captured = cbs; }}
    />
  );
  await flush();
  if (!captured) throw new Error("onReady was not called");
  return { cbs: captured, lastFrame, unmount };
}

function failureFooterBlock(frame: string): string {
  const plain = plainFrame(frame);
  const idx = plain.indexOf("✗ failed");
  if (idx < 0) throw new Error("frame did not contain failure footer");
  return plain.slice(idx).replace(/\n+$/, "");
}

function cliExpected(h: FailureHandoff): string {
  return renderFailureFooter(h).replace(/\n$/, "");
}

describe("PipelineRunView failure-handoff TUI/CLI parity", () => {
  it("matches CLI bytes for the full footer (agent + raw output + inspect + resume)", async () => {
    const m = await mount();
    m.cbs.emit({ kind: "failure-handoff", handoff: FULL });
    await flush();
    const tui = failureFooterBlock(m.lastFrame() ?? "");
    expect(tui).toBe(cliExpected(FULL));
    m.unmount();
  });

  it("matches CLI bytes when agentRelPath is null (tool node)", async () => {
    const tool: FailureHandoff = { ...FULL, agentRelPath: null };
    const m = await mount();
    m.cbs.emit({ kind: "failure-handoff", handoff: tool });
    await flush();
    expect(failureFooterBlock(m.lastFrame() ?? "")).toBe(cliExpected(tool));
    m.unmount();
  });

  it("matches CLI bytes for an early crash (nodeReceiveId null, rawOutputPath null)", async () => {
    const early: FailureHandoff = { ...FULL, nodeReceiveId: null, rawOutputPath: null };
    const m = await mount();
    m.cbs.emit({ kind: "failure-handoff", handoff: early });
    await flush();
    expect(failureFooterBlock(m.lastFrame() ?? "")).toBe(cliExpected(early));
    m.unmount();
  });

  it("matches CLI bytes when rawOutputPath is null but inspect is present", async () => {
    const noRaw: FailureHandoff = { ...FULL, rawOutputPath: null };
    const m = await mount();
    m.cbs.emit({ kind: "failure-handoff", handoff: noRaw });
    await flush();
    expect(failureFooterBlock(m.lastFrame() ?? "")).toBe(cliExpected(noRaw));
    m.unmount();
  });
});
