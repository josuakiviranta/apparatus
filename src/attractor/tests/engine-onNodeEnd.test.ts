import { describe, it, expect } from "vitest";
import { readFile } from "fs/promises";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe("engine onNodeEnd callback", () => {
  it("has _willRetry gate around onNodeEnd invocation (source-level contract)", async () => {
    const src = await readFile(join(__dirname, "../core/engine.ts"), "utf8");
    expect(src).toMatch(/_willRetry/);
    expect(src).toMatch(/if \(!_willRetry\)\s*\{\s*opts\.onNodeEnd/);
  });

  it("fires onNodeEnd after each handler resolves with its outcome", async () => {
    // This test requires a real `claude` binary to be installed.
    // Skip unless explicitly opted in via env var.
    if (!process.env.RALPH_ENGINE_TEST_ALLOW_SPAWN) return;

    const { parseDot } = await import("../core/graph.js");
    const { runPipeline } = await import("../core/engine.js");
    const { AutoApproveInterviewer } = await import("../interviewer/auto-approve.js");
    const { mkdtemp } = await import("fs/promises");
    const { tmpdir } = await import("os");

    const dot = `
      digraph t {
        start [shape=Mdiamond];
        a [agent="chat", prompt="noop"];
        done [shape=Msquare];
        start -> a;
        a -> done;
      }
    `;
    const graph = parseDot(dot);
    const logsRoot = await mkdtemp(join(tmpdir(), "engine-end-"));
    const calls: Array<{ id: string; status: string }> = [];

    await runPipeline(graph, {
      logsRoot,
      cwd: process.cwd(),
      interviewer: new AutoApproveInterviewer(),
      onNodeStart: () => {},
      onNodeEnd: (node, outcome) => {
        calls.push({ id: node.id, status: outcome.status });
      },
    });
    expect(calls.map((c) => c.id)).toContain("a");
  });
});
