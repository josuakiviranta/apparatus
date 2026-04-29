import { describe, it, expect } from "vitest";
import { resolveInputDecl, type ResolvedInput } from "../transforms/inputs-resolver.js";

describe("resolveInputDecl", () => {
  it("splits qualified input into source + local", () => {
    const r = resolveInputDecl("verifier.summary");
    expect(r).toEqual<ResolvedInput>({
      name: "verifier.summary",
      qualified: true,
      sourceNode: "verifier",
      localKey: "summary",
      lookupKey: "verifier.summary",
      renderedTag: "verifier_summary",
      fallbackAttr: "default_summary",
    });
  });

  it("treats bare name as caller/system input", () => {
    const r = resolveInputDecl("project");
    expect(r).toEqual<ResolvedInput>({
      name: "project",
      qualified: false,
      sourceNode: undefined,
      localKey: "project",
      lookupKey: "project",
      renderedTag: "project",
      fallbackAttr: "default_project",
    });
  });

  it("rejects multi-dot keys (no nested namespacing)", () => {
    expect(() => resolveInputDecl("a.b.c")).toThrow(/multi-segment/);
  });

  it("rejects empty / whitespace", () => {
    expect(() => resolveInputDecl("")).toThrow(/empty/);
    expect(() => resolveInputDecl("  ")).toThrow(/empty/);
  });
});
