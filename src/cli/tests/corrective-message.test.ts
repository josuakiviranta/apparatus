import { describe, it, expect } from "vitest";
import { buildCorrectiveMessage } from "../lib/corrective-message.js";

describe("buildCorrectiveMessage", () => {
  const schema = '{"type":"object","properties":{"foo":{"type":"string"}},"required":["foo"]}';

  it("empty output → no-text-content phrasing + thinking-block warning", () => {
    const msg = buildCorrectiveMessage(
      "",
      [{ path: "(root)", message: "no text content in response" }],
      schema,
    );
    expect(msg).toMatch(/no text content/i);
    expect(msg).toMatch(/thinking block/i);
    expect(msg).toContain(schema);
  });

  it("invalid output → lists errors + truncates raw to 500 chars", () => {
    const raw = "x".repeat(1000);
    const msg = buildCorrectiveMessage(
      raw,
      [{ path: "foo", message: "Expected string, received number" }],
      schema,
    );
    expect(msg).toMatch(/foo/);
    expect(msg).toMatch(/Expected string/);
    expect(msg).not.toContain("x".repeat(1000));
    expect(msg).toContain("x".repeat(500));
  });
});
