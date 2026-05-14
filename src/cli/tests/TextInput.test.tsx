import React, { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import { TextInput } from "../components/TextInput.js";

// Ink renders asynchronously — give it a tick to flush state updates to output.
const delay = (ms = 50) => new Promise((r) => setTimeout(r, ms));

function Harness({
  initial = "",
  disabled = false,
  placeholder = "",
  onSubmit = () => {},
}: {
  initial?: string;
  disabled?: boolean;
  placeholder?: string;
  onSubmit?: (v: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <TextInput
      value={value}
      onChange={setValue}
      onSubmit={onSubmit}
      disabled={disabled}
      placeholder={placeholder}
    />
  );
}

describe("TextInput", () => {
  it("shows placeholder when value is empty", () => {
    const { lastFrame } = render(<Harness placeholder="type here" />);
    expect(lastFrame()).toContain("type here");
  });

  it("appends printable characters and moves cursor", async () => {
    const { stdin, lastFrame } = render(<Harness />);
    stdin.write("h");
    stdin.write("i");
    await delay();
    expect(lastFrame()).toContain("hi");
  });

  it("backspace deletes the previous character", async () => {
    const { stdin, lastFrame } = render(<Harness initial="hello" />);
    stdin.write("\u0008"); // backspace
    await delay();
    expect(lastFrame()).toContain("hell");
  });

  it("Enter calls onSubmit with current value", () => {
    const onSubmit = vi.fn();
    const { stdin } = render(<Harness initial="submit me" onSubmit={onSubmit} />);
    stdin.write("\r"); // enter
    expect(onSubmit).toHaveBeenCalledWith("submit me");
  });

  it("disabled ignores keystrokes", async () => {
    const onSubmit = vi.fn();
    const { stdin } = render(<Harness disabled onSubmit={onSubmit} />);
    stdin.write("x");
    stdin.write("\r");
    await delay();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("left/right arrows move the cursor within bounds", async () => {
    const { stdin, lastFrame } = render(<Harness initial="abc" />);
    stdin.write("\u001b[D"); // left arrow
    stdin.write("X");
    await delay();
    expect(lastFrame()).toContain("abXc");
  });

  // Strip SGR escapes so `.length` reflects rendered cells, not bytes.
  // Inlined (rather than depending on `strip-ansi`) because the codebase
  // has no other use case and adding a dep for one assertion is wasteful.
  const stripAnsi = (s: string): string =>
    // eslint-disable-next-line no-control-regex
    s.replace(/\u001b\[[0-9;]*m/g, "");

  it("clips the rendered row to terminal width minus prefix", async () => {
    const cols = process.stdout.columns ?? 80;
    const prefixWidth = 4;
    const availableCols = Math.max(10, cols - prefixWidth - 1);
    const bound = availableCols + prefixWidth;

    const { lastFrame } = render(
      <TextInput
        value={"a".repeat(200)}
        prefixWidth={prefixWidth}
        onChange={() => {}}
        onSubmit={() => {}}
      />,
    );
    await delay();
    const lines = stripAnsi(lastFrame() ?? "").split("\n");
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(bound);
    }
    // Inverse-block cursor must still be visible after clipping. Under
    // FORCE_COLOR=0 (vitest.config.ts) Ink strips SGR escapes, so the
    // cursor cell renders as its raw character (" " at EOL). The cursor
    // is visible iff the rendered row ends with the EOL space cell.
    const rendered = stripAnsi(lastFrame() ?? "");
    expect(rendered).toMatch(/ ›$|a $/m);
  });

  it("shows a left indicator (‹) when the view is scrolled past the start", async () => {
    // 200-char buffer with a small prefix forces viewStart > 0 because the
    // cursor lands at EOL (length 200) and the 70%-anchor pulls the window
    // right of column 0.
    const { lastFrame } = render(
      <TextInput
        value={"b".repeat(200)}
        prefixWidth={2}
        onChange={() => {}}
        onSubmit={() => {}}
      />,
    );
    await delay();
    expect(lastFrame()).toContain("\u2039");
  });

  it("shows a right indicator (›) when content extends past the visible window", async () => {
    const { stdin, lastFrame } = render(
      <TextInput
        value={"c".repeat(200)}
        prefixWidth={2}
        onChange={() => {}}
        onSubmit={() => {}}
      />,
    );
    // Ctrl-A jumps the cursor home; the long tail must then sit past viewEnd.
    stdin.write("\u0001"); // Ctrl-A
    await delay();
    expect(lastFrame()).toContain("\u203A");
  });
});
