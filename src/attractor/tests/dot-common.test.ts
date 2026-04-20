import { describe, it, expect } from "vitest";
import {
  toCamel,
  coerceValue,
  unescapeDotString,
  parseStylesheet,
  applyStylesheet,
  parseInputsAttr,
} from "../core/dot-common.js";

describe("dot-common helpers", () => {
  it("toCamel converts snake_case", () => {
    expect(toCamel("tool_command")).toBe("toolCommand");
    expect(toCamel("max_retries")).toBe("maxRetries");
    expect(toCamel("id")).toBe("id");
  });

  it("coerceValue infers types", () => {
    expect(coerceValue("true")).toBe(true);
    expect(coerceValue("false")).toBe(false);
    expect(coerceValue("42")).toBe(42);
    expect(coerceValue("hello")).toBe("hello");
  });

  it("unescapeDotString handles DOT escapes", () => {
    expect(unescapeDotString("a\\nb")).toBe("a\nb");
    expect(unescapeDotString('say \\"hi\\"')).toBe('say "hi"');
  });

  it("parseInputsAttr splits + dedupes", () => {
    expect(parseInputsAttr("a, b,  a , c")).toEqual(["a", "b", "c"]);
    expect(parseInputsAttr("")).toBeUndefined();
    expect(parseInputsAttr(123)).toBeUndefined();
  });

  it("parseStylesheet + applyStylesheet work round-trip", () => {
    const rules = parseStylesheet(".archived { color: gray; } * { font: mono; }");
    const node = { id: "n", class: "archived" } as any;
    const styled = applyStylesheet(node, rules);
    expect(styled.color).toBe("gray");
    expect(styled.font).toBe("mono");
  });
});

describe("applyStylesheet preserves metadata", () => {
  it("applyStylesheet preserves sourceLocation and attrLocations", () => {
    const node = { id: "x", sourceLocation: { line: 5, column: 1 }, attrLocations: { shape: { line: 5, column: 3 } } } as any;
    const result = applyStylesheet(node, [{ selector: "x", selectorType: "id", props: { extra: "hi" } }]);
    expect(result.sourceLocation).toEqual(node.sourceLocation);
    expect(result.attrLocations).toEqual(node.attrLocations);
  });
});
