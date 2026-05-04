import { describe, it, expect, beforeAll } from "vitest";
import { spawnSync } from "child_process";
import { writeFileSync, mkdtempSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const CLI = join(process.cwd(), "dist/cli/index.js");

beforeAll(() => {
  const out = spawnSync("node", [CLI, "--help"], { encoding: "utf-8" });
  if (out.status !== 0) {
    throw new Error("dist/cli/index.js missing — run `npm run build` first");
  }
});

function writeTempDot(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), "ralph-preflight-"));
  const path = join(dir, "p.dot");
  writeFileSync(path, contents);
  return path;
}

describe("pipeline run pre-flight check", () => {
  it("exits 1 when a declared input is not supplied", () => {
    const dot = writeTempDot(`digraph p {
      goal="x"
      inputs="needed"
      start [shape=Mdiamond]
      use [shape=parallelogram, tool_command="echo $needed"]
      done [shape=Msquare]
      start -> use -> done
    }`);
    const r = spawnSync("node", [CLI, "pipeline", "run", dot], { encoding: "utf-8" });
    expect(r.status).toBe(1);
    const combined = (r.stdout ?? "") + (r.stderr ?? "");
    expect(combined).toContain("Missing required inputs");
    expect(combined).toContain("$needed");
    expect(combined).toContain("--var needed=");
    expect(combined).not.toContain("agent · iteration");
  });

  it("does not error in pre-flight when --var supplies the declared input", () => {
    const dot = writeTempDot(`digraph p {
      goal="x"
      inputs="needed"
      start [shape=Mdiamond]
      use [shape=parallelogram, tool_command="echo $needed"]
      done [shape=Msquare]
      start -> use -> done
    }`);
    const r = spawnSync(
      "node",
      [CLI, "pipeline", "run", dot, "--var", "needed=hello"],
      { encoding: "utf-8" },
    );
    const combined = (r.stdout ?? "") + (r.stderr ?? "");
    expect(combined).not.toContain("Missing required inputs");
  });

  it("warns but proceeds when a legacy pipeline (no inputs=) references a missing var", () => {
    const dot = writeTempDot(`digraph p {
      goal="x"
      start [shape=Mdiamond]
      use [shape=parallelogram, tool_command="echo $needed"]
      done [shape=Msquare]
      start -> use -> done
    }`);
    const r = spawnSync("node", [CLI, "pipeline", "run", dot], { encoding: "utf-8" });
    const combined = (r.stdout ?? "") + (r.stderr ?? "");
    expect(combined).toContain("PIPELINE WARNING");
    expect(combined).toContain("$needed");
    expect(combined).toContain("does not declare `inputs=`");
    expect(combined).not.toContain("Missing required inputs");
  });
});

describe("pipeline list shows requires:", () => {
  it("prints 'requires:' for pipelines with inputs=, omits it for legacy pipelines", () => {
    const project = mkdtempSync(join(tmpdir(), "ralph-list-"));
    const pipelinesDir = join(project, ".ralph", "pipelines");
    mkdirSync(pipelinesDir, { recursive: true });
    writeFileSync(join(pipelinesDir, "with-inputs.dot"), `digraph with_inputs {
      goal="declares contract"
      inputs="foo, bar"
      start [shape=Mdiamond]
      done [shape=Msquare]
      start -> done
    }`);
    writeFileSync(join(pipelinesDir, "no-inputs.dot"), `digraph no_inputs {
      goal="legacy"
      start [shape=Mdiamond]
      done [shape=Msquare]
      start -> done
    }`);

    const r = spawnSync(
      "node",
      [CLI, "pipeline", "list", "--project", project],
      { encoding: "utf-8" },
    );
    const combined = (r.stdout ?? "") + (r.stderr ?? "");
    expect(combined).toContain("with-inputs");
    expect(combined).toContain("requires: foo, bar");
    expect(combined).toContain("no-inputs");
    // Legacy pipeline must NOT have a requires: line
    const noInputsIdx = combined.indexOf("no-inputs");
    const withInputsIdx = combined.indexOf("with-inputs");
    const noInputsBlock = combined.slice(noInputsIdx, withInputsIdx);
    expect(noInputsBlock).not.toContain("requires:");
  });
});
