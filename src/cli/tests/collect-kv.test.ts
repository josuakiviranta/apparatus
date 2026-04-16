import { describe, it, expect } from "vitest";
import { collectKV } from "../lib/collect-kv.js";

describe("collectKV", () => {
  it("accumulates a single key=value pair", () => {
    const out = collectKV("foo=bar", {});
    expect(out).toEqual({ foo: "bar" });
  });

  it("accumulates multiple invocations", () => {
    let acc: Record<string, string> = {};
    acc = collectKV("a=1", acc);
    acc = collectKV("b=2", acc);
    expect(acc).toEqual({ a: "1", b: "2" });
  });

  it("preserves '=' characters after the first", () => {
    const out = collectKV("query=a=b=c", {});
    expect(out).toEqual({ query: "a=b=c" });
  });

  it("trims surrounding whitespace on the key only", () => {
    const out = collectKV("  foo  =  bar baz  ", {});
    expect(out).toEqual({ foo: "  bar baz  " });
  });

  it("throws on missing '='", () => {
    expect(() => collectKV("invalid", {})).toThrow(/expected key=value/);
  });

  it("throws on empty key", () => {
    expect(() => collectKV("=value", {})).toThrow(/empty key/);
  });

  it("later flags overwrite earlier values for the same key", () => {
    let acc: Record<string, string> = {};
    acc = collectKV("k=first", acc);
    acc = collectKV("k=second", acc);
    expect(acc).toEqual({ k: "second" });
  });
});
