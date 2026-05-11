import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { PipelineRunView } from "../components/PipelineRunView.js";

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
    await new Promise(r => setTimeout(r, 20));
    expect(captured).not.toBeNull();
    expect(typeof captured!.emit).toBe("function");
    expect(typeof captured!.done).toBe("function");
    unmount();
  });
});
