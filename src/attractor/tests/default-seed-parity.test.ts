import { describe, it, expect } from "vitest";
import { isDefaultSeedKey } from "../core/schemas.js";
import { extractDefaults } from "../transforms/variable-expansion.js";

const FIXTURE: Array<[string, boolean]> = [
  ["defaultRefinements", true],
  ["defaultScopeChanged", true],
  ["defaulted", false],
  ["default", false],
  ["defaultX", true],
  ["defualtTypo", false],
];

describe("default-seed parity (validator vs runtime)", () => {
  it.each(FIXTURE)("validator isDefaultSeedKey(%s) === %s", (key, expected) => {
    expect(isDefaultSeedKey(key)).toBe(expected);
  });

  it.each(FIXTURE)("runtime extractDefaults({ %s: 'v' }) seeds iff %s", (key, expected) => {
    const result = extractDefaults({ [key]: "v" });
    const seeded = Object.keys(result).length === 1;
    expect(seeded).toBe(expected);
  });
});
