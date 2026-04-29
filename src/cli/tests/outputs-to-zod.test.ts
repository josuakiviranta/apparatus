import { describe, it, expect } from "vitest";
import { outputsToZod } from "../lib/outputs-to-zod.js";

describe("outputsToZod", () => {
  it("shorthand string", () => {
    const schema = outputsToZod({ foo: "string" });
    expect(schema.safeParse({ foo: "x" }).success).toBe(true);
    expect(schema.safeParse({ foo: 1 }).success).toBe(false);
  });

  it("shorthand number/boolean", () => {
    const s = outputsToZod({ n: "number", b: "boolean" });
    expect(s.safeParse({ n: 1, b: true }).success).toBe(true);
    expect(s.safeParse({ n: "1", b: true }).success).toBe(false);
  });

  it("enum", () => {
    const s = outputsToZod({ label: { enum: ["true", "false", "empty"] } });
    expect(s.safeParse({ label: "true" }).success).toBe(true);
    expect(s.safeParse({ label: "maybe" }).success).toBe(false);
  });

  it("array of primitives", () => {
    const s = outputsToZod({ xs: { type: "array", items: "string" } });
    expect(s.safeParse({ xs: ["a", "b"] }).success).toBe(true);
    expect(s.safeParse({ xs: [1] }).success).toBe(false);
  });

  it("nullable form ([type, null])", () => {
    const s = outputsToZod({ p: { type: ["string", "null"] } });
    expect(s.safeParse({ p: "x" }).success).toBe(true);
    expect(s.safeParse({ p: null }).success).toBe(true);
    expect(s.safeParse({ p: 1 }).success).toBe(false);
  });

  it("string maxLength", () => {
    const s = outputsToZod({ short: { type: "string", maxLength: 5 } });
    expect(s.safeParse({ short: "abcde" }).success).toBe(true);
    expect(s.safeParse({ short: "abcdef" }).success).toBe(false);
  });

  it("description is passive (does not affect validation)", () => {
    const s = outputsToZod({ foo: { type: "string", description: "anything" } });
    expect(s.safeParse({ foo: "x" }).success).toBe(true);
  });

  it("all keys required by default (no optional support)", () => {
    const s = outputsToZod({ foo: "string", bar: "string" });
    expect(s.safeParse({ foo: "x" }).success).toBe(false);
  });

  it("rejects unsupported fragment shapes with a clear message", () => {
    expect(() => outputsToZod({ foo: { type: "object", properties: {} } as any }))
      .toThrow(/outputs\[foo\]: unsupported fragment shape/);
    expect(() => outputsToZod({ foo: { type: "number", minimum: 0 } as any }))
      .toThrow(/outputs\[foo\]: unsupported fragment shape/);
  });
});
