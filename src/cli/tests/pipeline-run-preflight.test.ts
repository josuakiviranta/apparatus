import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { pipelineRunCommand } from "../commands/pipeline.js";
import { withFakeApparatHome, type FakeApparatHome } from "./_apparatHome";

describe("pipelineRunCommand — $project preflight", () => {
  let scratch: FakeApparatHome;

  beforeEach(() => {
    scratch = withFakeApparatHome("apparat-preflight-home");
  });

  afterEach(() => {
    scratch.cleanup();
  });

  it("exits with error when pipeline references $project but --project not passed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "apparat-preflight-"));
    const dot = join(dir, "p.dot");
    writeFileSync(dot, `
      digraph p {
        start [shape=Mdiamond]
        run [type="tool", cwd="$project", toolCommand="echo $project"]
        done [shape=Msquare]
        start -> run -> done
      }
    `);

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((c?: number) => {
      throw new Error("exit:" + c);
    }) as never);
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await expect(pipelineRunCommand(dot, {})).rejects.toThrow(/exit:1/);

    const errOutput = errSpy.mock.calls.map(c => String(c[0])).join("");
    expect(errOutput).toMatch(/project_binding_missing/);
    expect(errOutput).toMatch(/--project/);
    expect(errOutput).toMatch(/\brun\b/);

    exitSpy.mockRestore();
    errSpy.mockRestore();
  });

  it("does not fire preflight when --project is provided", async () => {
    const dir = mkdtempSync(join(tmpdir(), "apparat-preflight-"));
    const dot = join(dir, "p.dot");
    writeFileSync(dot, `
      digraph p {
        start [shape=Mdiamond]
        run [type="tool", cwd="$project", toolCommand="echo $project"]
        done [shape=Msquare]
        start -> run -> done
      }
    `);
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try { await pipelineRunCommand(dot, { project: dir }); } catch {}
    const out = errSpy.mock.calls.map(c => String(c[0])).join("");
    expect(out).not.toMatch(/project_binding_missing/);
    errSpy.mockRestore();
  });

  it("skips preflight when graph does not reference $project", async () => {
    const dir = mkdtempSync(join(tmpdir(), "apparat-preflight-"));
    const dot = join(dir, "p.dot");
    writeFileSync(dot, `
      digraph p {
        start [shape=Mdiamond]
        run [type="tool", cwd="/tmp", toolCommand="echo hi"]
        done [shape=Msquare]
        start -> run -> done
      }
    `);
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try { await pipelineRunCommand(dot, {}); } catch {}
    const out = errSpy.mock.calls.map(c => String(c[0])).join("");
    expect(out).not.toMatch(/project_binding_missing/);
    errSpy.mockRestore();
  });
});
