import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "../../..");
const MEMORY_WRITER_MD = join(
  REPO_ROOT,
  ".apparat",
  "pipelines",
  "illumination-to-implementation",
  "memory-writer.md",
);

describe(".apparat/pipelines/illumination-to-implementation/memory-writer.md — Warnings cross-check", () => {
  const md = readFileSync(MEMORY_WRITER_MD, "utf-8");

  it("declares Step 4a between Step 4 and Step 5", () => {
    expect(md).toMatch(/4a\./);
    const idx4 = md.indexOf("4. **Write the memory file");
    const idx4a = md.indexOf("4a.");
    const idx5 = md.indexOf("5. **Commit any pending work");
    expect(idx4).toBeGreaterThan(-1);
    expect(idx4a).toBeGreaterThan(idx4);
    expect(idx5).toBeGreaterThan(idx4a);
  });

  it("Step 4a defines the four no-op substrings to scan", () => {
    expect(md).toContain("no in-scope diff");
    expect(md).toContain("nothing to verify");
    expect(md).toContain("implement node committed only");
    expect(md).toContain("no_diff_produced");
  });

  it("Step 4a scans tmux_tester.test_summary case-insensitively and prepends ## Warnings", () => {
    expect(md).toMatch(/\$tmux_tester\.test_summary/);
    expect(md).toMatch(/case-insensitive/i);
    expect(md).toMatch(/##\s*Warnings/);
  });

  it("Warnings section is prepended BEFORE ## What was implemented", () => {
    expect(md).toMatch(/before\s+`?##\s*What was implemented`?/i);
  });

  it("Step 7 pre-check on tmux_tester.test_result=fail is unchanged", () => {
    expect(md).toMatch(/tmux_tester_test_result.*"fail"/);
    expect(md).toMatch(/skip both 7a and 7b entirely/);
  });
});
