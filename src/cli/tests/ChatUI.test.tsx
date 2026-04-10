import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render } from "ink-testing-library";
import { ChatUI } from "../components/ChatUI.js";
import { Session } from "../lib/session.js";
import { createFakeChildHandle } from "./helpers/fake-child-handle.js";

function waitForFrames(ms = 50) {
  return new Promise((r) => setTimeout(r, ms));
}

describe("ChatUI", () => {
  afterEach(() => {
    process.removeAllListeners("SIGINT");
  });

  it("starts in streaming status and shows placeholder for empty history", async () => {
    const session = new Session("s1");
    const ctrl = createFakeChildHandle("s1");
    const onExit = vi.fn();

    const { lastFrame, unmount } = render(
      <ChatUI session={session} child={ctrl.handle} onExit={onExit} />,
    );
    await waitForFrames();
    expect(lastFrame()).toMatch(/Type a message|\/end|\/help/);
    unmount();
  });

  it("transitions to awaiting after first result event", async () => {
    const session = new Session("s1");
    const ctrl = createFakeChildHandle("s1");
    const onExit = vi.fn();

    const { unmount } = render(
      <ChatUI session={session} child={ctrl.handle} onExit={onExit} />,
    );

    ctrl.emit({ type: "assistant_delta", textDelta: "Hi there" });
    ctrl.emit({
      type: "result",
      stopReason: "end_turn",
      text: "Hi there",
      usage: { inputTokens: 10, outputTokens: 5 },
      raw: {},
    });
    await waitForFrames();
    expect(session.history.some((t) => t.role === "assistant")).toBe(true);
    unmount();
  });

  it("dispatches /help locally and does not call submit", async () => {
    const session = new Session("s1");
    const ctrl = createFakeChildHandle("s1");
    const onExit = vi.fn();

    const { stdin, unmount } = render(
      <ChatUI session={session} child={ctrl.handle} onExit={onExit} />,
    );
    // Move to awaiting
    ctrl.emit({
      type: "result", stopReason: "end_turn", text: "", usage: { inputTokens: 0, outputTokens: 0 }, raw: {},
    });
    await waitForFrames();

    "/help".split("").forEach((ch) => stdin.write(ch));
    stdin.write("\r");
    await waitForFrames();

    expect(ctrl.submitted).toHaveLength(0);
    expect(session.history.some((t) => t.role === "system" && t.text.includes("/end"))).toBe(true);
    unmount();
  });

  it("dispatches /end by calling child.end and onExit('user_end')", async () => {
    const session = new Session("s1");
    const ctrl = createFakeChildHandle("s1");
    const onExit = vi.fn();

    const { stdin, unmount } = render(
      <ChatUI session={session} child={ctrl.handle} onExit={onExit} />,
    );
    ctrl.emit({
      type: "result", stopReason: "end_turn", text: "", usage: { inputTokens: 0, outputTokens: 0 }, raw: {},
    });
    await waitForFrames();

    "/end".split("").forEach((ch) => stdin.write(ch));
    stdin.write("\r");
    await waitForFrames();

    expect(ctrl.endCalled).toBe(true);
    expect(onExit).toHaveBeenCalledWith("user_end");
    expect(session.exitReason).toBe("user_end");
    unmount();
  });

  it("dispatches /abort by calling child.kill and onExit('abort')", async () => {
    const session = new Session("s1");
    const ctrl = createFakeChildHandle("s1");
    const onExit = vi.fn();

    const { stdin, unmount } = render(
      <ChatUI session={session} child={ctrl.handle} onExit={onExit} />,
    );
    ctrl.emit({
      type: "result", stopReason: "end_turn", text: "", usage: { inputTokens: 0, outputTokens: 0 }, raw: {},
    });
    await waitForFrames();

    "/abort".split("").forEach((ch) => stdin.write(ch));
    stdin.write("\r");
    await waitForFrames();

    expect(ctrl.killSignal).toBe("SIGTERM");
    expect(onExit).toHaveBeenCalledWith("abort");
    expect(session.exitReason).toBe("abort");
    unmount();
  });

  it("unknown slash command adds a system notice without calling submit", async () => {
    const session = new Session("s1");
    const ctrl = createFakeChildHandle("s1");
    const { stdin, unmount } = render(
      <ChatUI session={session} child={ctrl.handle} onExit={() => {}} />,
    );
    ctrl.emit({
      type: "result", stopReason: "end_turn", text: "", usage: { inputTokens: 0, outputTokens: 0 }, raw: {},
    });
    await waitForFrames();

    "/foo".split("").forEach((ch) => stdin.write(ch));
    stdin.write("\r");
    await waitForFrames();

    expect(ctrl.submitted).toHaveLength(0);
    expect(session.history.some((t) => t.role === "system" && t.text.includes("Unknown command"))).toBe(true);
    unmount();
  });

  it("regular message pushes user turn, calls submit, transitions back to streaming", async () => {
    const session = new Session("s1");
    const ctrl = createFakeChildHandle("s1");
    const { stdin, unmount } = render(
      <ChatUI session={session} child={ctrl.handle} onExit={() => {}} />,
    );
    ctrl.emit({
      type: "result", stopReason: "end_turn", text: "hi", usage: { inputTokens: 0, outputTokens: 0 }, raw: {},
    });
    await waitForFrames();

    "hello".split("").forEach((ch) => stdin.write(ch));
    stdin.write("\r");
    await waitForFrames();

    expect(ctrl.submitted).toEqual(["hello"]);
    expect(session.history.filter((t) => t.role === "user")).toHaveLength(1);
    unmount();
  });

  it("empty submit (whitespace) is a no-op", async () => {
    const session = new Session("s1");
    const ctrl = createFakeChildHandle("s1");
    const { stdin, unmount } = render(
      <ChatUI session={session} child={ctrl.handle} onExit={() => {}} />,
    );
    ctrl.emit({
      type: "result", stopReason: "end_turn", text: "", usage: { inputTokens: 0, outputTokens: 0 }, raw: {},
    });
    await waitForFrames();

    "   ".split("").forEach((ch) => stdin.write(ch));
    stdin.write("\r");
    await waitForFrames();

    expect(ctrl.submitted).toHaveLength(0);
    expect(session.history.filter((t) => t.role === "user")).toHaveLength(0);
    unmount();
  });

  it("turn_limit result transitions to ended with exitReason=turn_limit", async () => {
    const session = new Session("s1");
    const ctrl = createFakeChildHandle("s1");
    const onExit = vi.fn();
    const { unmount } = render(
      <ChatUI session={session} child={ctrl.handle} onExit={onExit} />,
    );
    ctrl.emit({
      type: "result",
      stopReason: "turn_limit",
      text: "capped",
      usage: { inputTokens: 0, outputTokens: 0 },
      raw: {},
    });
    await waitForFrames();
    expect(session.exitReason).toBe("turn_limit");
    expect(onExit).toHaveBeenCalledWith("turn_limit");
    unmount();
  });

  it("parse_error adds system notice but keeps session alive", async () => {
    const session = new Session("s1");
    const ctrl = createFakeChildHandle("s1");
    const { unmount } = render(
      <ChatUI session={session} child={ctrl.handle} onExit={() => {}} />,
    );
    ctrl.emit({ type: "parse_error", rawLine: "not json", error: "Unexpected token" });
    await waitForFrames();
    expect(session.history.some((t) => t.role === "system" && t.text.includes("parse"))).toBe(true);
    expect(session.exitReason).toBeUndefined();
    unmount();
  });

  it("child_crash (non-zero exit) sets exitReason and calls onExit('child_crash')", async () => {
    const session = new Session("s1");
    const ctrl = createFakeChildHandle("s1");
    const onExit = vi.fn();
    const { unmount } = render(
      <ChatUI session={session} child={ctrl.handle} onExit={onExit} />,
    );
    ctrl.exitWith(1);
    await waitForFrames();
    expect(session.exitReason).toBe("child_crash");
    expect(onExit).toHaveBeenCalledWith("child_crash");
    expect(session.history.some((t) => t.role === "system" && t.text.includes("exited with code 1"))).toBe(true);
    unmount();
  });

  it("events iterator termination (endStream) is handled without crashing", async () => {
    const session = new Session("s1");
    const ctrl = createFakeChildHandle("s1");
    const { unmount } = render(
      <ChatUI session={session} child={ctrl.handle} onExit={() => {}} />,
    );
    ctrl.emit({
      type: "result", stopReason: "end_turn", text: "hi",
      usage: { inputTokens: 0, outputTokens: 0 }, raw: {},
    });
    await waitForFrames();
    ctrl.endStream();
    await waitForFrames();
    expect(session.exitReason).toBeUndefined();
    unmount();
  });
});
