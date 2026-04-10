import { describe, it, expect } from "vitest";
import { Session, buildSessionDigest } from "../lib/session.js";

describe("Session", () => {
  it("starts with empty history and configured id", () => {
    const s = new Session("abc-123");
    expect(s.id).toBe("abc-123");
    expect(s.history).toEqual([]);
    expect(s.exitReason).toBeUndefined();
  });

  it("lastAssistantText returns empty string for empty history", () => {
    const s = new Session("x");
    expect(s.lastAssistantText()).toBe("");
  });

  it("lastAssistantText returns the most recent assistant turn", () => {
    const s = new Session("x");
    s.history.push({ role: "user", text: "hi", at: 1 });
    s.history.push({ role: "assistant", text: "first", toolCalls: [], at: 2 });
    s.history.push({ role: "user", text: "more", at: 3 });
    s.history.push({ role: "assistant", text: "latest", toolCalls: [], at: 4 });
    expect(s.lastAssistantText()).toBe("latest");
  });

  it("turnsUsed counts user turns only", () => {
    const s = new Session("x");
    s.history.push({ role: "user", text: "1", at: 1 });
    s.history.push({ role: "assistant", text: "a", toolCalls: [], at: 2 });
    s.history.push({ role: "user", text: "2", at: 3 });
    s.history.push({ role: "system", text: "note", at: 4 });
    expect(s.turnsUsed()).toBe(2);
  });

  it("aggregateUsage sums across assistant turns", () => {
    const s = new Session("x");
    s.history.push({
      role: "assistant",
      text: "a",
      toolCalls: [],
      at: 1,
      usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 10 },
    });
    s.history.push({
      role: "assistant",
      text: "b",
      toolCalls: [],
      at: 2,
      usage: { inputTokens: 200, outputTokens: 75 },
    });
    const u = s.aggregateUsage();
    expect(u.inputTokens).toBe(300);
    expect(u.outputTokens).toBe(125);
    expect(u.cacheReadTokens).toBe(10);
  });

  it("aggregateUsage returns zeroes for empty history", () => {
    const s = new Session("x");
    expect(s.aggregateUsage()).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it("aggregateUsage ignores assistant turns with no usage field", () => {
    const s = new Session("x");
    s.history.push({ role: "assistant", text: "a", toolCalls: [], at: 1 });
    s.history.push({
      role: "assistant",
      text: "b",
      toolCalls: [],
      at: 2,
      usage: { inputTokens: 50, outputTokens: 25 },
    });
    const u = s.aggregateUsage();
    expect(u.inputTokens).toBe(50);
    expect(u.outputTokens).toBe(25);
  });

  it("toolCallsSummary returns empty array for history with no tool calls", () => {
    const s = new Session("x");
    s.history.push({ role: "assistant", text: "a", toolCalls: [], at: 1 });
    expect(s.toolCallsSummary()).toEqual([]);
  });

  it("toolCallsSummary groups and counts tools", () => {
    const s = new Session("x");
    s.history.push({
      role: "assistant",
      text: "",
      at: 1,
      toolCalls: [
        { id: "1", name: "Read", input: {} },
        { id: "2", name: "Read", input: {} },
        { id: "3", name: "Bash", input: {} },
      ],
    });
    s.history.push({
      role: "assistant",
      text: "",
      at: 2,
      toolCalls: [{ id: "4", name: "Read", input: {} }],
    });
    const summary = s.toolCallsSummary();
    expect(summary).toEqual(
      expect.arrayContaining([
        { name: "Read", count: 3 },
        { name: "Bash", count: 1 },
      ]),
    );
    expect(summary).toHaveLength(2);
  });
});

describe("buildSessionDigest", () => {
  it("empty session yields empty-string output with turnsUsed=0", () => {
    const s = new Session("x");
    s.exitReason = "user_end";
    const d = buildSessionDigest(s);
    expect(d.output).toBe("");
    expect(d.turnsUsed).toBe(0);
    expect(d.success).toBe(true);
    expect(d.sessionId).toBe("x");
    expect(d.exitReason).toBe("user_end");
    expect(d.transcriptPath).toBeNull();
    expect(d.digest.messageCount).toBe(0);
  });

  it("user_end → success=true", () => {
    const s = new Session("x");
    s.history.push({ role: "assistant", text: "final", toolCalls: [], at: 1 });
    s.exitReason = "user_end";
    expect(buildSessionDigest(s).success).toBe(true);
  });

  it("turn_limit → success=true (graceful)", () => {
    const s = new Session("x");
    s.exitReason = "turn_limit";
    expect(buildSessionDigest(s).success).toBe(true);
  });

  it("abort → success=false", () => {
    const s = new Session("x");
    s.exitReason = "abort";
    expect(buildSessionDigest(s).success).toBe(false);
  });

  it("child_crash → success=false", () => {
    const s = new Session("x");
    s.exitReason = "child_crash";
    expect(buildSessionDigest(s).success).toBe(false);
  });

  it("parse_error → success=false", () => {
    const s = new Session("x");
    s.exitReason = "parse_error";
    expect(buildSessionDigest(s).success).toBe(false);
  });

  it("parent_killed → success=false", () => {
    const s = new Session("x");
    s.exitReason = "parent_killed";
    expect(buildSessionDigest(s).success).toBe(false);
  });

  it("missing exitReason defaults to user_end in the digest field", () => {
    const s = new Session("x");
    expect(buildSessionDigest(s).exitReason).toBe("user_end");
  });

  it("digest.messageCount matches history length", () => {
    const s = new Session("x");
    s.history.push({ role: "user", text: "1", at: 1 });
    s.history.push({ role: "assistant", text: "a", toolCalls: [], at: 2 });
    s.history.push({ role: "user", text: "2", at: 3 });
    s.exitReason = "user_end";
    expect(buildSessionDigest(s).digest.messageCount).toBe(3);
  });
});
