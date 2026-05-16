import React, { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import { MultilineTextInput } from "../components/MultilineTextInput.js";

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
    <MultilineTextInput
      value={value}
      onChange={setValue}
      onSubmit={onSubmit}
      disabled={disabled}
      placeholder={placeholder}
    />
  );
}

const stripAnsi = (s: string): string =>
  // eslint-disable-next-line no-control-regex
  s.replace(/\u001b\[[0-9;]*m/g, "");

describe("MultilineTextInput", () => {
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
    stdin.write("\u0008");
    await delay();
    expect(lastFrame()).toContain("hell");
  });

  it("Enter calls onSubmit with current value", () => {
    const onSubmit = vi.fn();
    const { stdin } = render(<Harness initial="submit me" onSubmit={onSubmit} />);
    stdin.write("\r");
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
    stdin.write("\u001b[D");
    stdin.write("X");
    await delay();
    expect(lastFrame()).toContain("abXc");
  });

  it("wraps long input into multiple rows, each within wrapWidth", async () => {
    const prefixWidth = 2;
    const cols = process.stdout.columns ?? 80;
    const wrapWidth = Math.max(10, cols - prefixWidth);

    const { lastFrame } = render(
      <MultilineTextInput
        value={"a".repeat(wrapWidth + 5)}
        prefixWidth={prefixWidth}
        onChange={() => {}}
        onSubmit={() => {}}
      />,
    );
    await delay();
    const lines = stripAnsi(lastFrame() ?? "").split("\n").filter((l) => l.length > 0);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(wrapWidth);
    }
  });

  it("mid-text edit does not shift non-cursor row content", async () => {
    const prefixWidth = 2;
    const cols = process.stdout.columns ?? 80;
    const wrapWidth = Math.max(10, cols - prefixWidth);
    const value = "x".repeat(wrapWidth) + "yyyy";

    const { stdin, lastFrame } = render(
      <Harness initial={value} />,
    );
    await delay();
    const frame0 = stripAnsi(lastFrame() ?? "");
    const row0Before = frame0.split("\n")[0];

    for (let i = 0; i < wrapWidth + 2; i++) {
      stdin.write("\u001b[D");
    }
    await delay();
    const frame1 = stripAnsi(lastFrame() ?? "");
    const row0After = frame1.split("\n")[0];

    expect(row0After.length).toBe(row0Before.length);
    expect(row0After.replace(/\s+$/, "")).toBe(row0Before.replace(/\s+$/, ""));
  });

  it("cursor preserved when parent echoes value prop", async () => {
    const { stdin, lastFrame } = render(<Harness initial="change" />);
    // Cursor starts at EOL (position 6). Move left once so it sits between
    // 'g' and 'e' (position 5).
    stdin.write("\u001b[D"); // left arrow
    await delay();
    // Type 'b' at the cursor → buffer becomes "changbe", cursor at 6
    // (between 'b' and 'e'). This call triggers onChange, which the parent
    // echoes back as a "new" value prop.
    stdin.write("b");
    await delay();
    // Type 'X' next. If the value-sync effect re-fires on the parent's
    // echo, the cursor was slammed to EOL (position 7) and 'X' is appended
    // → "changbeX". With the gate in place, the cursor stayed at 6 and
    // 'X' is inserted between 'b' and 'e' → "changbXe".
    stdin.write("X");
    await delay();
    expect(lastFrame()).toContain("changbXe");
  });
});
