import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { readLastRunOutcome } from "../lib/pipeline-status.js";

let runsRoot: string;

beforeEach(() => {
  runsRoot = mkdtempSync(join(tmpdir(), "apparat-runs-"));
});
afterEach(() => rmSync(runsRoot, { recursive: true, force: true }));

function writeJsonl(runId: string, lines: object[]): void {
  const dir = join(runsRoot, runId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "pipeline.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
}

describe("readLastRunOutcome", () => {
  it("returns null when runs root does not exist", () => {
    expect(readLastRunOutcome(join(runsRoot, "nope"))).toBeNull();
  });

  it("returns null when no runs are present", () => {
    expect(readLastRunOutcome(runsRoot)).toBeNull();
  });

  it("returns null when the latest run has no pipeline-end event", () => {
    writeJsonl("aaaaaaaa", [{ kind: "pipeline-start", runId: "aaaaaaaa", timestamp: "2026-05-09T00:00:00Z" }]);
    expect(readLastRunOutcome(runsRoot)).toBeNull();
  });

  it("returns success outcome when the latest pipeline-end has outcome=success", () => {
    writeJsonl("aaaaaaaa", [
      { kind: "pipeline-start", runId: "aaaaaaaa", timestamp: "2026-05-09T00:00:00Z" },
      { kind: "pipeline-end", runId: "aaaaaaaa", outcome: "success", timestamp: "2026-05-09T00:01:00Z" },
    ]);
    const out = readLastRunOutcome(runsRoot);
    expect(out?.outcome).toBe("success");
    expect(out?.runId).toBe("aaaaaaaa");
  });

  it("returns failure outcome when the latest pipeline-end has outcome=failure", () => {
    writeJsonl("aaaaaaaa", [
      { kind: "pipeline-end", runId: "aaaaaaaa", outcome: "failure", timestamp: "2026-05-09T00:01:00Z" },
    ]);
    const out = readLastRunOutcome(runsRoot);
    expect(out?.outcome).toBe("failure");
  });

  it("picks the most recent run by directory mtime when multiple exist", async () => {
    writeJsonl("oldoldoo", [{ kind: "pipeline-end", runId: "oldoldoo", outcome: "success", timestamp: "2026-05-09T00:01:00Z" }]);
    await new Promise((r) => setTimeout(r, 20));
    writeJsonl("newnewno", [{ kind: "pipeline-end", runId: "newnewno", outcome: "failure", timestamp: "2026-05-09T00:02:00Z" }]);
    const out = readLastRunOutcome(runsRoot);
    expect(out?.runId).toBe("newnewno");
    expect(out?.outcome).toBe("failure");
  });

  it("tolerates malformed lines (skips them)", () => {
    const dir = join(runsRoot, "aaaaaaaa");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "pipeline.jsonl"),
      "garbage line\n" + JSON.stringify({ kind: "pipeline-end", runId: "aaaaaaaa", outcome: "success", timestamp: "2026-05-09T00:01:00Z" }) + "\n",
    );
    const out = readLastRunOutcome(runsRoot);
    expect(out?.outcome).toBe("success");
  });
});
