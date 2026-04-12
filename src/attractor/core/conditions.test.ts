import { describe, it, expect } from "vitest";
import { evaluateCondition } from "./conditions.js";

const noOutcome = { status: "success" as const };

describe("evaluateCondition — unqualified context key", () => {
  it("matches when ctx[key] equals the RHS", () => {
    expect(evaluateCondition("result=pass", noOutcome, { result: "pass" })).toBe(true);
  });

  it("does not match when ctx[key] differs", () => {
    expect(evaluateCondition("result=pass", noOutcome, { result: "fail" })).toBe(false);
  });

  it("does not match when ctx[key] is absent", () => {
    expect(evaluateCondition("result=pass", noOutcome, {})).toBe(false);
  });

  it("matches != when ctx[key] differs", () => {
    expect(evaluateCondition("result!=fail", noOutcome, { result: "pass" })).toBe(true);
  });
});

describe("evaluateCondition — outcome variable (unchanged)", () => {
  it("matches outcome=success on success", () => {
    expect(evaluateCondition("outcome=success", { status: "success" }, {})).toBe(true);
  });

  it("does not match outcome=success on fail", () => {
    expect(evaluateCondition("outcome=success", { status: "fail" }, {})).toBe(false);
  });
});

describe("evaluateCondition — context. prefix (unchanged)", () => {
  it("matches context.result=pass", () => {
    expect(evaluateCondition("context.result=pass", noOutcome, { result: "pass" })).toBe(true);
  });
});

describe("evaluateCondition — empty/unconditional", () => {
  it("returns true for empty condition string", () => {
    expect(evaluateCondition("", noOutcome, {})).toBe(true);
  });
});
