import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "../../..");
const README = join(REPO_ROOT, "README.md");

describe("README.md — deep-loop section documents pre_sha and no-op refusal", () => {
  const md = readFileSync(README, "utf-8");

  it("mentions pre_sha as captured by an upstream capture_pre_sha tool node", () => {
    expect(md).toMatch(/pre_sha/);
    expect(md).toMatch(/capture_pre_sha/);
  });

  it("mentions no_diff_produced as the no-op refusal reason", () => {
    expect(md).toContain("no_diff_produced");
  });

  it("clarifies the diff guard is agent-driven, not handler-side", () => {
    expect(md).toMatch(/agent-driven/i);
  });
});
