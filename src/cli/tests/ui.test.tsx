import { describe, it, expect } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { Step, Info, Warn, Error as ErrorLine, Success, Header, StreamLine } from "../components/ui.js";
import type { StreamEvent } from "../lib/stream-formatter.js";

describe("Step", () => {
  it("renders with ❯ prefix", () => {
    const { lastFrame } = render(<Step text="Starting session..." />);
    expect(lastFrame()).toContain("❯ Starting session...");
  });
});

describe("Info", () => {
  it("renders without prefix", () => {
    const { lastFrame } = render(<Info text="Session already running" />);
    expect(lastFrame()).toContain("Session already running");
    expect(lastFrame()).not.toContain("❯");
    expect(lastFrame()).not.toContain("✔");
  });
});

describe("Warn", () => {
  it("renders with ⚠ prefix", () => {
    const { lastFrame } = render(<Warn text="claude exited with code 1" />);
    expect(lastFrame()).toContain("⚠ claude exited with code 1");
  });
});

describe("Error", () => {
  it("renders with ✖ prefix", () => {
    const { lastFrame } = render(<ErrorLine text="Folder not found" />);
    expect(lastFrame()).toContain("✖ Folder not found");
  });
});

describe("Success", () => {
  it("renders with ✔ prefix", () => {
    const { lastFrame } = render(<Success text="git push done" />);
    expect(lastFrame()).toContain("✔ git push done");
  });
});

describe("Header", () => {
  it("renders mode and project", () => {
    const { lastFrame } = render(<Header mode="implement" project="/my/project" branch="main" pid={1234} />);
    const frame = lastFrame()!;
    expect(frame).toContain("implement");
    expect(frame).toContain("/my/project");
    expect(frame).toContain("main");
    expect(frame).toContain("1234");
  });

  it("renders without branch when not provided", () => {
    const { lastFrame } = render(<Header mode="meditate" project="/my/project" pid={5678} />);
    const frame = lastFrame()!;
    expect(frame).toContain("meditate");
    expect(frame).toContain("5678");
  });
});

describe("StreamLine", () => {
  it("renders main_agent_open in bold cyan", () => {
    const { lastFrame } = render(<StreamLine event={{ type: "main_agent_open" }} />);
    expect(lastFrame()).toContain("▶▶▶ MAIN AGENT");
  });

  it("renders main_agent_close", () => {
    const { lastFrame } = render(<StreamLine event={{ type: "main_agent_close" }} />);
    expect(lastFrame()).toContain("◀◀◀ MAIN AGENT");
  });

  it("renders subagent_open with description", () => {
    const { lastFrame } = render(<StreamLine event={{ type: "subagent_open", description: "check output" }} />);
    expect(lastFrame()).toContain("▶ SUBAGENT: check output");
  });

  it("renders subagent_close", () => {
    const { lastFrame } = render(<StreamLine event={{ type: "subagent_close" }} />);
    expect(lastFrame()).toContain("◀ SUBAGENT");
  });

  it("renders text content", () => {
    const { lastFrame } = render(<StreamLine event={{ type: "text", content: "Hello world" }} />);
    expect(lastFrame()).toContain("Hello world");
  });

  it("renders indented text with 2-space indent", () => {
    const { lastFrame } = render(<StreamLine event={{ type: "text", content: "Subagent text", indented: true }} />);
    expect(lastFrame()).toContain("  Subagent text");
  });

  it("renders tool line with name and label", () => {
    const { lastFrame } = render(<StreamLine event={{ type: "tool", name: "read", label: "/src/foo.ts" }} />);
    expect(lastFrame()).toContain("→ [read] /src/foo.ts");
  });

  it("renders indented tool line", () => {
    const { lastFrame } = render(<StreamLine event={{ type: "tool", name: "bash", label: "npm test", indented: true }} />);
    expect(lastFrame()).toContain("  → [bash] npm test");
  });

  it("renders ctx with token count", () => {
    const { lastFrame } = render(<StreamLine event={{ type: "ctx", tokens: 45231 }} />);
    expect(lastFrame()).toContain("◈ ctx: 45,231 tokens");
  });
});
