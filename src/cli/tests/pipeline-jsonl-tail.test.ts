import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, writeFileSync, appendFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { tailPipelineJsonl } from "../lib/pipeline-jsonl-tail.js";
import type { NodeEvent } from "../lib/pipelineEvents.js";

function flush(ms = 50): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

describe("tailPipelineJsonl", () => {
  it("seeds emit() with events already on disk before watching", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tail-seed-"));
    const file = join(dir, "pipeline.jsonl");
    writeFileSync(file,
      JSON.stringify({ kind: "node-start", nodeId: "a", contextSnapshot: {} }) + "\n" +
      JSON.stringify({ kind: "node-end",   success: true }) + "\n"
    );
    const events: NodeEvent[] = [];
    const handle = tailPipelineJsonl(file, (ev) => events.push(ev));
    await flush();
    handle.stop();
    expect(events.map(e => e.kind)).toEqual(["start", "end"]);
    rmSync(dir, { recursive: true });
  });

  it("emits new events when the file is appended after mount", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tail-append-"));
    const file = join(dir, "pipeline.jsonl");
    writeFileSync(file, JSON.stringify({ kind: "pipeline-start" }) + "\n");
    const events: NodeEvent[] = [];
    const handle = tailPipelineJsonl(file, (ev) => events.push(ev));
    await flush();
    appendFileSync(file,
      JSON.stringify({ kind: "node-start", nodeId: "b", contextSnapshot: { x: 1 } }) + "\n"
    );
    await flush(150);
    handle.stop();
    const starts = events.filter(e => e.kind === "start");
    expect(starts.length).toBe(1);
    expect((starts[0] as any).nodeId).toBe("b");
    rmSync(dir, { recursive: true });
  });

  it("fires onPipelineEnd when a pipeline-end line is appended", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tail-end-"));
    const file = join(dir, "pipeline.jsonl");
    writeFileSync(file, "");
    const onEnd = vi.fn();
    const handle = tailPipelineJsonl(file, () => {}, onEnd);
    await flush();
    appendFileSync(file, JSON.stringify({ kind: "pipeline-end", outcome: "success" }) + "\n");
    await flush(150);
    handle.stop();
    expect(onEnd).toHaveBeenCalledTimes(1);
    rmSync(dir, { recursive: true });
  });

  it("survives a missing file (no throw, no events)", async () => {
    const handle = tailPipelineJsonl("/nonexistent/never-exists.jsonl", () => {});
    await flush();
    handle.stop();
  });

  it("ignores malformed lines and partial trailing fragments", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tail-malformed-"));
    const file = join(dir, "pipeline.jsonl");
    writeFileSync(file, "{not json\n" +
      JSON.stringify({ kind: "node-start", nodeId: "a", contextSnapshot: {} }) + "\n" +
      "{partial");
    const events: NodeEvent[] = [];
    const handle = tailPipelineJsonl(file, (ev) => events.push(ev));
    await flush();
    handle.stop();
    expect(events.map(e => e.kind)).toEqual(["start"]);
    rmSync(dir, { recursive: true });
  });
});

describe("tailPipelineJsonl ceremony filter", () => {
  it("calls cleanJsonlEvents per emitted line when full is not set", async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import("fs");
    const { tmpdir } = await import("os");
    const { join } = await import("path");
    const cleaner = vi.fn((lines: unknown[]) => lines);
    vi.resetModules();
    vi.doMock("../lib/trace-cleaner.js", () => ({ cleanJsonlEvents: cleaner }));

    const dir = mkdtempSync(join(tmpdir(), "apparat-tail-clean-"));
    const tracePath = join(dir, "pipeline.jsonl");
    writeFileSync(
      tracePath,
      JSON.stringify({ kind: "node-start", nodeId: "n", nodeReceiveId: "n-1", timestamp: "t1" }) + "\n",
    );

    const mod = await import("../lib/pipeline-jsonl-tail.js");
    const handle = mod.tailPipelineJsonl(tracePath, vi.fn());

    expect(cleaner).toHaveBeenCalled();
    handle.stop();

    rmSync(dir, { recursive: true, force: true });
    vi.doUnmock("../lib/trace-cleaner.js");
    vi.resetModules();
  });

  it("skips the cleaner when full=true", async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import("fs");
    const { tmpdir } = await import("os");
    const { join } = await import("path");
    const cleaner = vi.fn((lines: unknown[]) => lines);
    vi.resetModules();
    vi.doMock("../lib/trace-cleaner.js", () => ({ cleanJsonlEvents: cleaner }));

    const dir = mkdtempSync(join(tmpdir(), "apparat-tail-full-"));
    const tracePath = join(dir, "pipeline.jsonl");
    writeFileSync(
      tracePath,
      JSON.stringify({ kind: "node-start", nodeId: "n", nodeReceiveId: "n-1", timestamp: "t1" }) + "\n",
    );

    const mod = await import("../lib/pipeline-jsonl-tail.js");
    const handle = mod.tailPipelineJsonl(tracePath, vi.fn(), undefined, { full: true });

    expect(cleaner).not.toHaveBeenCalled();
    handle.stop();

    rmSync(dir, { recursive: true, force: true });
    vi.doUnmock("../lib/trace-cleaner.js");
    vi.resetModules();
  });
});
