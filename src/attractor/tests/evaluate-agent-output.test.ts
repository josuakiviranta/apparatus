import { describe, it, expect } from "vitest";
import { z } from "zod";
import { evaluateAgentOutput } from "../handlers/evaluate-agent-output.js";

const zodSchema = z.object({ foo: z.string() }).strict();

describe("evaluateAgentOutput", () => {
  it("empty output → fail with 'no text content' error", () => {
    const r = evaluateAgentOutput("", zodSchema);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toMatchObject({ path: "(root)" });
    expect(r.errors[0].message).toMatch(/no text content/i);
  });

  it("stream-json with valid result → ok", () => {
    const stream =
      '{"type":"system","subtype":"init","session_id":"s"}\n' +
      '{"type":"result","subtype":"success","result":"{\\"foo\\":\\"bar\\"}"}';
    const r = evaluateAgentOutput(stream, zodSchema);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.parsed).toEqual({ foo: "bar" });
  });

  it("stream-json with structured_output payload → ok", () => {
    const stream =
      '{"type":"system","subtype":"init","session_id":"s"}\n' +
      '{"type":"result","subtype":"success","structured_output":{"foo":"x"}}';
    const r = evaluateAgentOutput(stream, zodSchema);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.parsed).toEqual({ foo: "x" });
  });

  it("schema mismatch → fail with zod path/message", () => {
    const stream =
      '{"type":"result","subtype":"success","result":"{\\"foo\\":1}"}';
    const r = evaluateAgentOutput(stream, zodSchema);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0].path).toBe("foo");
    expect(r.errors[0].message).toMatch(/string/i);
  });

  it("unparseable JSON → fail", () => {
    const r = evaluateAgentOutput("not json at all", zodSchema);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0].message).toMatch(/JSON/i);
  });

  it("no zodSchema → ok when JSON parseable, no validation", () => {
    const stream =
      '{"type":"result","subtype":"success","result":"{\\"any\\":1}"}';
    const r = evaluateAgentOutput(stream, null);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.parsed).toEqual({ any: 1 });
  });
});
