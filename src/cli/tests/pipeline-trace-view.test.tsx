import React from "react";
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, appendFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { render } from "ink-testing-library";
import { PipelineTraceView } from "../components/PipelineTraceView.js";

function flush(ms = 50): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

describe("PipelineTraceView", () => {
  it("renders block-open headers for each node-start in a finished trace", async () => {
    const dir = mkdtempSync(join(tmpdir(), "trace-static-"));
    const file = join(dir, "pipeline.jsonl");
    writeFileSync(file,
      JSON.stringify({ kind: "node-start", nodeId: "alpha", contextSnapshot: {} }) + "\n" +
      JSON.stringify({ kind: "node-end",   success: true }) + "\n"
    );
    const { lastFrame, unmount } = render(
      <PipelineTraceView tracePath={file} runId="r1" isLive={false} />
    );
    await flush();
    const out = lastFrame() ?? "";
    expect(out).toContain("alpha");
    unmount();
    rmSync(dir, { recursive: true });
  });

  it("appends new headers when file grows in live mode", async () => {
    const dir = mkdtempSync(join(tmpdir(), "trace-live-"));
    const file = join(dir, "pipeline.jsonl");
    writeFileSync(file, JSON.stringify({ kind: "pipeline-start" }) + "\n");
    const { lastFrame, unmount } = render(
      <PipelineTraceView tracePath={file} runId="r2" isLive={true} />
    );
    await flush();
    appendFileSync(file,
      JSON.stringify({ kind: "node-start", nodeId: "beta", contextSnapshot: {} }) + "\n"
    );
    await flush(150);
    expect(lastFrame() ?? "").toContain("beta");
    unmount();
    rmSync(dir, { recursive: true });
  });

  it("fires onPipelineEnd callback when pipeline-end appears (live mode)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "trace-end-"));
    const file = join(dir, "pipeline.jsonl");
    writeFileSync(file, "");
    let ended = false;
    const { unmount } = render(
      <PipelineTraceView
        tracePath={file} runId="r3" isLive={true}
        onPipelineEnd={() => { ended = true; }}
      />
    );
    await flush();
    appendFileSync(file, JSON.stringify({ kind: "pipeline-end", outcome: "success" }) + "\n");
    await flush(150);
    expect(ended).toBe(true);
    unmount();
    rmSync(dir, { recursive: true });
  });
});
