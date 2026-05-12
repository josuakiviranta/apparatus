import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import { GateSelector } from "../components/GateSelector.js";

// Ink renders asynchronously — give it a tick to flush state updates to output.
const delay = (ms = 50) => new Promise((r) => setTimeout(r, ms));

describe("GateSelector", () => {
  it("renders all options with ▶ on the first by default", () => {
    const { lastFrame } = render(
      <GateSelector options={["Approve", "Decline"]} onChoose={vi.fn()} />
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("▶ 1. Approve");
    expect(frame).toContain("  2. Decline");
  });

  it("renders the hint line", () => {
    const { lastFrame } = render(
      <GateSelector options={["Yes", "No"]} onChoose={vi.fn()} />
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("↑↓ navigate");
    expect(frame).toContain("1-2 to choose");
  });

  it("moves ▶ down on down-arrow keypress", async () => {
    const { lastFrame, stdin } = render(
      <GateSelector options={["Approve", "Decline"]} onChoose={vi.fn()} />
    );
    stdin.write("\u001B[B"); // down arrow ANSI
    await delay();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("  1. Approve");
    expect(frame).toContain("▶ 2. Decline");
  });

  it("clamps at the last option on repeated down-arrow", async () => {
    const { lastFrame, stdin } = render(
      <GateSelector options={["A", "B"]} onChoose={vi.fn()} />
    );
    stdin.write("\u001B[B");
    await delay();
    stdin.write("\u001B[B"); // past end
    await delay();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("▶ 2. B");
  });

  it("moves ▶ back up on up-arrow keypress", async () => {
    const { lastFrame, stdin } = render(
      <GateSelector options={["Approve", "Decline"]} onChoose={vi.fn()} />
    );
    stdin.write("\u001B[B"); // down
    await delay();
    stdin.write("\u001B[A"); // up
    await delay();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("▶ 1. Approve");
  });

  it("calls onChoose with the selected option on Enter", () => {
    const onChoose = vi.fn();
    const { stdin } = render(
      <GateSelector options={["Approve", "Decline"]} onChoose={onChoose} />
    );
    stdin.write("\r"); // Enter
    expect(onChoose).toHaveBeenCalledWith("Approve");
  });

  it("calls onChoose immediately on digit keypress", () => {
    const onChoose = vi.fn();
    const { stdin } = render(
      <GateSelector options={["Approve", "Decline"]} onChoose={onChoose} />
    );
    stdin.write("2");
    expect(onChoose).toHaveBeenCalledWith("Decline");
  });

  it("ignores out-of-range digit", () => {
    const onChoose = vi.fn();
    const { stdin } = render(
      <GateSelector options={["Approve", "Decline"]} onChoose={onChoose} />
    );
    stdin.write("9");
    expect(onChoose).not.toHaveBeenCalled();
  });

  it("Esc invokes onChoose(ABORT_CHOICE)", async () => {
    const { ABORT_CHOICE } = await import("../lib/interactions/drivers/gate.js");
    const onChoose = vi.fn();
    const { stdin } = render(
      <GateSelector options={["Approve", "Decline"]} onChoose={onChoose} />,
    );
    stdin.write("\u001b"); // ESC
    await delay();
    expect(onChoose).toHaveBeenCalledWith(ABORT_CHOICE);
  });

  it("hint text includes Esc to abort", () => {
    const { lastFrame } = render(
      <GateSelector options={["A", "B"]} onChoose={() => {}} />,
    );
    expect(lastFrame() ?? "").toMatch(/Esc to abort/);
  });
});
