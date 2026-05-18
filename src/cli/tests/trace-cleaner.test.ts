import { describe, it, expect } from "vitest";
import { cleanJsonlEvents, type JsonlLine } from "../lib/trace-cleaner.js";

/**
 * 11-line fixture mirroring the structure of a real raw-attempt-1.txt sample
 * (see design § 1). Lines:
 *   1-3  : system hook_started   (drop)
 *   4-6  : system hook_response  (drop; one carries additional_context)
 *   7    : rate_limit_event      (drop)
 *   8    : user   tool_result    (keep — user-side copy carries the body)
 *   9    : assistant tool_result (drop — duplicate echo)
 *   10   : assistant tool_use    (keep)
 *   11   : assistant text        (keep)
 */
function fixture(): JsonlLine[] {
  return [
    { type: "system", subtype: "hook_started",  hook_id: "h1", hook_name: "SessionStart:startup" },
    { type: "system", subtype: "hook_started",  hook_id: "h2", hook_name: "SessionStart:startup" },
    { type: "system", subtype: "hook_started",  hook_id: "h3", hook_name: "SessionStart:startup" },
    { type: "system", subtype: "hook_response", hook_id: "h1", output: '{"additional_context":"<SKILL_PRELUDE_BODY>"}' },
    { type: "system", subtype: "hook_response", hook_id: "h2", output: "{}" },
    { type: "system", subtype: "hook_response", hook_id: "h3", output: "{}" },
    { type: "rate_limit_event", model: "claude", remaining: 9_999 },
    { type: "user",      message: { role: "user",      content: [{ type: "tool_result", tool_use_id: "u1", content: "ok" }] } },
    { type: "assistant", message: { role: "assistant", content: [{ type: "tool_result", tool_use_id: "u1", content: "ok" }] } },
    { type: "assistant", message: { role: "assistant", content: [{ type: "tool_use",    id: "u2", name: "Read", input: {} }] } },
    { type: "assistant", message: { role: "assistant", content: [{ type: "text",        text: "done" }] } },
  ];
}

describe("cleanJsonlEvents", () => {
  it("drops hook_started, hook_response, rate_limit_event, assistant-side tool_result echo (rule 1+2+4)", () => {
    const out = cleanJsonlEvents(fixture());
    // Drop 3 hook_started + 3 hook_response + 1 rate_limit_event + 1 assistant tool_result echo = 8 dropped.
    expect(out).toHaveLength(11 - 8);
    expect(out.some(l => l.type === "system" && l.subtype === "hook_started")).toBe(false);
    expect(out.some(l => l.type === "system" && l.subtype === "hook_response")).toBe(false);
    expect(out.some(l => l.type === "rate_limit_event")).toBe(false);
    const assistantToolResults = out.filter(l => {
      if (l.type !== "assistant") return false;
      const content = (l.message?.content ?? []) as Array<{ type?: string }>;
      return content.some(c => c.type === "tool_result");
    });
    expect(assistantToolResults).toHaveLength(0);
  });

  it("retains the user-side tool_result (the copy that carries the body)", () => {
    const out = cleanJsonlEvents(fixture());
    const userToolResults = out.filter(l => {
      if (l.type !== "user") return false;
      const content = (l.message?.content ?? []) as Array<{ type?: string }>;
      return content.some(c => c.type === "tool_result");
    });
    expect(userToolResults).toHaveLength(1);
  });

  it("retains tool_use and text frames untouched", () => {
    const out = cleanJsonlEvents(fixture());
    const toolUse = out.find(l => {
      const content = (l.message?.content ?? []) as Array<{ type?: string }>;
      return content.some(c => c.type === "tool_use");
    });
    expect(toolUse).toBeDefined();
    const textFrame = out.find(l => {
      const content = (l.message?.content ?? []) as Array<{ type?: string }>;
      return content.some(c => c.type === "text");
    });
    expect(textFrame).toBeDefined();
  });

  it("strips additional_context from any retained non-hook system frame (rule 3 defence in depth)", () => {
    const lines: JsonlLine[] = [
      { type: "system", subtype: "init",  additional_context: "<SKILL_PRELUDE_BODY>", session_id: "s1" },
      { type: "system", subtype: "ready", session_id: "s1" },
    ];
    const out = cleanJsonlEvents(lines);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ type: "system", subtype: "init", session_id: "s1" });
    expect("additional_context" in out[0]).toBe(false);
    expect(out[1]).toEqual({ type: "system", subtype: "ready", session_id: "s1" });
  });

  it("passes unknown frame types through untouched (forward compat)", () => {
    const lines: JsonlLine[] = [
      { type: "future_frame_kind", payload: { anything: 1 } },
      { kind: "apparat-node-start", nodeId: "demo" },
    ];
    const out = cleanJsonlEvents(lines);
    expect(out).toEqual(lines);
  });

  it("returns empty for empty input", () => {
    expect(cleanJsonlEvents([])).toEqual([]);
  });

  it("is pure — input array is not mutated", () => {
    const input = fixture();
    const snapshot = JSON.parse(JSON.stringify(input));
    cleanJsonlEvents(input);
    expect(input).toEqual(snapshot);
  });
});
