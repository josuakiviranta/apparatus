import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect } from "vitest";
import { PipelineDisplay } from "./PipelineDisplay.js";
import type { PipelineDisplayCallbacks } from "./PipelineDisplay.js";

describe("PipelineDisplay", () => {
  it("calls onReady with push/setStatus/done", async () => {
    let cbs: PipelineDisplayCallbacks | null = null;
    render(
      <PipelineDisplay
        pipelineName="smoke"
        pid={1234}
        onReady={(c) => { cbs = c; }}
      />
    );
    await new Promise(r => setTimeout(r, 50));
    expect(cbs).not.toBeNull();
    expect(typeof cbs!.push).toBe("function");
    expect(typeof cbs!.setStatus).toBe("function");
    expect(typeof cbs!.done).toBe("function");
  });

  it("renders pushed info lines", async () => {
    let cbs: PipelineDisplayCallbacks | null = null;
    const { lastFrame } = render(
      <PipelineDisplay
        pipelineName="my-pipe"
        pid={42}
        onReady={(c) => { cbs = c; }}
      />
    );
    await new Promise(r => setTimeout(r, 50));
    cbs!.push({ kind: "info", text: "goal: Do the thing" });
    await new Promise(r => setTimeout(r, 50));
    expect(lastFrame()).toContain("goal: Do the thing");
  });

  it("bottom bar always shows pipeline name and pid", async () => {
    let cbs: PipelineDisplayCallbacks | null = null;
    const { lastFrame } = render(
      <PipelineDisplay
        pipelineName="my-pipeline"
        pid={9999}
        onReady={(c) => { cbs = c; }}
      />
    );
    await new Promise(r => setTimeout(r, 50));
    cbs!.push({ kind: "step", text: "[work] [agent] Do work" });
    cbs!.setStatus("[work] [agent] Do work");
    await new Promise(r => setTimeout(r, 50));
    const frame = lastFrame() ?? "";
    expect(frame).toContain("my-pipeline");
    expect(frame).toContain("9999");
    expect(frame).toContain("[work]");
  });
});
