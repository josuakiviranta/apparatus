import { describe, it, expect } from "vitest";
import { evaluateCondition } from "../core/conditions.js";
import type { Outcome } from "../types.js";

describe("evaluateCondition", () => {
  const ctx = { "context.scenarios.passed": "true", "context.count": "3" };
  const outcome: Outcome = { status: "success", preferredLabel: "Yes" };

  it("empty condition is always true", () => {
    expect(evaluateCondition("", outcome, ctx)).toBe(true);
  });

  it("outcome= matches outcome status", () => {
    expect(evaluateCondition("outcome=success", outcome, ctx)).toBe(true);
    expect(evaluateCondition("outcome=fail", outcome, ctx)).toBe(false);
  });

  it("outcome!= works", () => {
    expect(evaluateCondition("outcome!=fail", outcome, ctx)).toBe(true);
    expect(evaluateCondition("outcome!=success", outcome, ctx)).toBe(false);
  });

  it("preferred_label= matches", () => {
    expect(evaluateCondition("preferred_label=Yes", outcome, ctx)).toBe(true);
    expect(evaluateCondition("preferred_label=No", outcome, ctx)).toBe(false);
  });

  it("context.key= matches context value", () => {
    expect(evaluateCondition("context.scenarios.passed=true", outcome, ctx)).toBe(true);
    expect(evaluateCondition("context.scenarios.passed=false", outcome, ctx)).toBe(false);
  });

  it("missing context key resolves to empty string", () => {
    expect(evaluateCondition("context.missing=", outcome, ctx)).toBe(true);
    expect(evaluateCondition("context.missing=value", outcome, ctx)).toBe(false);
  });

  it("&& combines clauses with AND", () => {
    expect(evaluateCondition("outcome=success && preferred_label=Yes", outcome, ctx)).toBe(true);
    expect(evaluateCondition("outcome=success && preferred_label=No", outcome, ctx)).toBe(false);
  });
});
