// src/cli/tests/trace-delta-renderer.test.ts
import { describe, it, expect } from "vitest";
import { renderContextDelta } from "../lib/trace-delta.js";

describe("renderContextDelta — additions (no prev)", () => {
  it("renders a single string value as `+ key=\"value\"`", () => {
    expect(renderContextDelta({ "verifier.summary": "ok" }))
      .toBe(`+ verifier.summary="ok"`);
  });

  it("renders boolean / number / null as raw literals", () => {
    expect(renderContextDelta({ a: true, b: 42, c: null }))
      .toBe(`+ a=true  + b=42  + c=null`);
  });

  it("renders objects / arrays as sentinels", () => {
    expect(renderContextDelta({ o: { x: 1 }, a: [1, 2, 3] }))
      .toBe(`+ o=<object>  + a=<array len=3>`);
  });

  it("truncates string values longer than 80 chars with a trailing ellipsis", () => {
    const long = "x".repeat(120);
    const out = renderContextDelta({ k: long });
    expect(out).toBe(`+ k="${"x".repeat(80)}…"`);
  });

  it("preserves Object.keys insertion order across multiple keys", () => {
    const input = { z: 1, a: 2, m: 3 };
    expect(renderContextDelta(input)).toBe(`+ z=1  + a=2  + m=3`);
  });

  it("returns the empty string when contextUpdates is empty", () => {
    expect(renderContextDelta({})).toBe("");
  });

  it("does not mutate the input dict", () => {
    const input = { a: "1", b: 2 };
    const clone = JSON.parse(JSON.stringify(input));
    renderContextDelta(input);
    expect(input).toEqual(clone);
  });

  it("JSON-escapes embedded quotes / backslashes / newlines inside string values", () => {
    // Input raw chars: a " b \ c <LF> d
    // Expected raw output: + k="a\"b\\c\nd"  (quoted, with JSON escapes inside)
    expect(renderContextDelta({ k: `a"b\\c\nd` }))
      .toBe(`+ k="a\\"b\\\\c\\nd"`);
  });
});

describe("renderContextDelta — with prev (future spec contract)", () => {
  it("renders changed values as `~ key=\"old\"→\"new\"`", () => {
    expect(renderContextDelta({ k: "new" }, { k: "old" }))
      .toBe(`~ k="old"→"new"`);
  });

  it("renders removed keys as `- key` when prev had them and updates omits them", () => {
    expect(renderContextDelta({}, { k: "v" })).toBe(`- k`);
  });

  it("renders added keys as `+ key=value` when prev lacked them", () => {
    expect(renderContextDelta({ k: "v" }, {})).toBe(`+ k="v"`);
  });

  it("renders a mixed add/change/remove block in stable order (adds, changes, removes)", () => {
    const updates = { added: 1, changed: "new" };
    const prev = { changed: "old", removed: true };
    expect(renderContextDelta(updates, prev))
      .toBe(`+ added=1  ~ changed="old"→"new"  - removed`);
  });
});
