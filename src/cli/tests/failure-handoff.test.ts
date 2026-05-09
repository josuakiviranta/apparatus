import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  renderFailureFooter,
  type FailureHandoff,
} from "../lib/failure-handoff.js";

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

describe("renderFailureFooter", () => {
  it("renders the full recipe with agent + receive id + raw output + resume", () => {
    expect(renderFailureFooter(FULL)).toBe(
      "✗ failed at runner (agent: pipelines/my/runner.md): boom-stderr\n" +
      "trace: /work/.apparat/runs/a1b2c3d4/pipeline.jsonl\n" +
      "raw output: /work/.apparat/runs/a1b2c3d4/runner/raw-3.txt\n" +
      "inspect: apparat pipeline trace a1b2c3d4 --node-receive 7f3e9c1a --full\n" +
      "\n" +
      "resume: apparat pipeline run /work/pipelines/my.dot --resume a1b2c3d4\n"
    );
  });

  it("omits the agent clause when agentRelPath is null (tool node)", () => {
    const tool: FailureHandoff = { ...FULL, agentRelPath: null };
    const out = renderFailureFooter(tool);
    expect(out).toContain("✗ failed at runner: boom-stderr\n");
    expect(out).not.toContain("(agent:");
  });

  it("omits the inspect line when nodeReceiveId is null (early crash)", () => {
    const early: FailureHandoff = { ...FULL, nodeReceiveId: null, rawOutputPath: null };
    const out = renderFailureFooter(early);
    expect(out).not.toContain("inspect:");
    expect(out).not.toContain("raw output:");
    // Bird's-eye + trace + blank + resume = 4 lines + trailing newline.
    expect(out.split("\n")).toEqual([
      "✗ failed at runner (agent: pipelines/my/runner.md): boom-stderr",
      "trace: /work/.apparat/runs/a1b2c3d4/pipeline.jsonl",
      "",
      "resume: apparat pipeline run /work/pipelines/my.dot --resume a1b2c3d4",
      "",
    ]);
  });

  it("omits the raw output line when rawOutputPath is null but keeps inspect", () => {
    const noRaw: FailureHandoff = { ...FULL, rawOutputPath: null };
    const out = renderFailureFooter(noRaw);
    expect(out).not.toContain("raw output:");
    expect(out).toContain("inspect: apparat pipeline trace a1b2c3d4 --node-receive 7f3e9c1a --full");
  });

  it("always includes the blank-line separator before the resume block", () => {
    const out = renderFailureFooter(FULL);
    expect(out).toMatch(/\n\nresume: /);
  });

  it("ends with a trailing newline", () => {
    expect(renderFailureFooter(FULL).endsWith("\n")).toBe(true);
  });
});
