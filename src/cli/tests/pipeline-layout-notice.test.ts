import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, existsSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { maybePrintLayoutV2Notice } from "../commands/pipeline.js";

describe("maybePrintLayoutV2Notice", () => {
  let root: string;
  let written = "";

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "ralph-notice-"));
    process.env.RALPH_RUNS_ROOT = root;
    written = "";
    vi.spyOn(process.stderr, "write").mockImplementation(((c: unknown) => {
      written += typeof c === "string" ? c : String(c);
      return true;
    }) as never);
  });
  afterEach(() => {
    delete process.env.RALPH_RUNS_ROOT;
    rmSync(root, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("prints once when legacy runs/ exists and .layout-v2 is absent", () => {
    mkdirSync(join(root, "runs"));
    maybePrintLayoutV2Notice();
    expect(written).toMatch(/Layout changed/);
    expect(existsSync(join(root, ".layout-v2"))).toBe(true);

    written = "";
    maybePrintLayoutV2Notice();
    expect(written).toBe("");
  });

  it("is a no-op when legacy runs/ does not exist", () => {
    maybePrintLayoutV2Notice();
    expect(written).toBe("");
    expect(existsSync(join(root, ".layout-v2"))).toBe(false);
  });

  it("is a no-op when .layout-v2 already exists", () => {
    mkdirSync(join(root, "runs"));
    writeFileSync(join(root, ".layout-v2"), "");
    maybePrintLayoutV2Notice();
    expect(written).toBe("");
  });
});
