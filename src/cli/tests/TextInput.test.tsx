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
});
