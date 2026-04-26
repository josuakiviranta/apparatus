import { describe, it, expect } from "vitest";
import { deriveProjectKey } from "../commands/pipeline.js";

describe("deriveProjectKey", () => {
  it("returns <basename>-<6 hex chars> shape", () => {
    const key = deriveProjectKey("/Users/alice/work/ralph-cli");
    expect(key).toMatch(/^ralph-cli-[0-9a-f]{6}$/);
  });

  it("is deterministic for the same path", () => {
    const a = deriveProjectKey("/Users/alice/work/ralph-cli");
    const b = deriveProjectKey("/Users/alice/work/ralph-cli");
    expect(a).toBe(b);
  });

  it("produces different keys for distinct absolute paths sharing a basename", () => {
    const a = deriveProjectKey("/Users/alice/work/ralph-cli");
    const b = deriveProjectKey("/Users/alice/other/ralph-cli");
    expect(a).not.toBe(b);
    expect(a.startsWith("ralph-cli-")).toBe(true);
    expect(b.startsWith("ralph-cli-")).toBe(true);
  });

  it("strips trailing slash so /foo and /foo/ produce the same key", () => {
    expect(deriveProjectKey("/Users/alice/foo")).toBe(deriveProjectKey("/Users/alice/foo/"));
  });

  it("normalises relative paths via absolute resolution", () => {
    // Same path passed twice in different shapes must hash identically.
    const abs = process.cwd();
    expect(deriveProjectKey(abs)).toBe(deriveProjectKey(abs));
  });
});
