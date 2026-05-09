import { describe, it, expect, vi } from "vitest";
import React from "react";

// Stub heavy children so the render is pure (no daemon stream, no JSONL I/O).
// Note: vi.mock factories are hoisted and cannot reference module-level imports,
// so we import ink inside the factory.
vi.mock("../components/HeartbeatWatch.js", async () => {
  const { Text } = await import("ink");
  return {
    HeartbeatPane: () => React.createElement(Text, null, "[HeartbeatPane stub]"),
  };
});

vi.mock("../components/PipelineApp.js", async () => {
  const { Text } = await import("ink");
  return {
    PipelineApp: ({ tracePath }: { tracePath: string }) =>
      React.createElement(Text, null, `[PipelineApp stub: ${tracePath ?? "none"}]`),
  };
});

vi.mock("../lib/projects-registry.js", () => ({
  readProjects: () => [{ path: "/work/app", lastSeen: 100 }],
}));

vi.mock("../lib/pipeline-status.js", () => ({
  readLastRunOutcome: () => ({ runId: "abcd1234", outcome: "success", timestamp: "t" }),
}));

vi.mock("../lib/apparat-paths.js", () => ({
  runsDir: (p: string) => `/fake-runs/${p}`,
}));

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    existsSync: () => true,
  };
});

import { render } from "ink-testing-library";
import { WatchApp } from "../components/WatchApp.js";

describe("WatchApp composition", () => {
  it("renders HeartbeatPane AND PipelineApp as children (not a shell-out)", () => {
    const { lastFrame } = render(React.createElement(WatchApp));
    const output = lastFrame() ?? "";
    expect(output).toContain("[HeartbeatPane stub]");
    expect(output).toContain("[PipelineApp stub:");
  });

  it("renders the apparat watch header", () => {
    const { lastFrame } = render(React.createElement(WatchApp));
    const output = lastFrame() ?? "";
    expect(output).toContain("apparat watch");
  });
});
