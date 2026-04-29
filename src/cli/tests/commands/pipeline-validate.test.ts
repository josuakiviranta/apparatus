import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const REPO_ROOT = resolve(__dirname, "../../../..");
const CLI = join(REPO_ROOT, "dist/cli/index.js");

function setupTempProjectWith(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "ralph-validate-test-"));
  for (const [relPath, content] of Object.entries(files)) {
    const abs = join(root, relPath);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

function runCli(args: string[], opts: { cwd: string }): { exitCode: number; stdout: string; stderr: string } {
  const r = spawnSync("node", [CLI, ...args], {
    cwd: opts.cwd,
    encoding: "utf8",
    env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
  });
  return { exitCode: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

describe("pipeline validate — source frames", () => {
  it("prints relpath:line:col and a code frame for schema errors", () => {
    const project = setupTempProjectWith({
      "bad.dot": [
        `digraph g {`,
        `  start [shape="Mdiamond"];`,
        `  done [shape="Msquare"];`,
        `  worker [type="tool",`,
        `          cwd="$project",`,
        `          bad_key="oops",`,
        `          tool_command="echo"];`,
        `  start -> worker -> done;`,
        `}`,
      ].join("\n"),
    });
    const { exitCode, stdout, stderr } = runCli(["pipeline", "validate", "bad.dot"], { cwd: project });
    const out = stderr + stdout;
    expect(exitCode).not.toBe(0);
    expect(out).toMatch(/bad\.dot:\d+:\d+/);
    expect(out).toContain("bad_key");
    expect(out).toContain("^");
  }, 30000);
});

describe("pipeline validate — syntax errors", () => {
  it("prints a [syntax] diagnostic with code frame for malformed DOT", () => {
    const project = setupTempProjectWith({
      "broken.dot": `digraph g {\n  start [shape="Mdiamond"\n  done\n}`,
    });
    const { exitCode, stdout, stderr } = runCli(["pipeline", "validate", "broken.dot"], { cwd: project });
    const out = stderr + stdout;
    expect(exitCode).not.toBe(0);
    expect(out).toMatch(/broken\.dot:\d+:\d+/);
    expect(out).toContain("[syntax]");
  }, 30000);
});
