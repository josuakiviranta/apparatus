import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, chmodSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { ToolHandler } from "../handlers/tool.js";
import type { HandlerExecutionContext } from "../handlers/registry.js";
import type { Node, PipelineContext } from "../types.js";

const baseCtx = (values: Record<string, unknown> = {}): PipelineContext => ({ values });

function makeContext(overrides: Partial<HandlerExecutionContext> = {}): HandlerExecutionContext {
  return {
    logsRoot: "/tmp",
    cwd: "/tmp",
    dotDir: "/tmp",
    outgoingLabels: [],
    completedNodes: [],
    nodeRetries: {},
    ...overrides,
  };
}

describe("ToolHandler — script_file dispatch", () => {
  let dotDir: string;
  let scriptsDir: string;

  beforeAll(() => {
    dotDir = mkdtempSync(join(tmpdir(), "tool-script-test-"));
    scriptsDir = join(dotDir, "scripts");
    mkdirSync(scriptsDir, { recursive: true });

    writeFileSync(
      join(scriptsDir, "echo.mjs"),
      "const args = process.argv.slice(2);\nconsole.log('mjs:' + args.join(','));\n",
    );
    writeFileSync(
      join(scriptsDir, "echo.ts"),
      "const args = process.argv.slice(2);\nconsole.log('ts:' + args.join(','));\n",
    );
    writeFileSync(
      join(scriptsDir, "echo.sh"),
      "#!/usr/bin/env bash\necho \"sh:$*\"\n",
    );
    chmodSync(join(scriptsDir, "echo.sh"), 0o755);
    writeFileSync(
      join(scriptsDir, "echo.py"),
      "import sys\nprint('py:' + ','.join(sys.argv[1:]))\n",
    );
    writeFileSync(
      join(scriptsDir, "fail.mjs"),
      "console.log('before-fail');\nconsole.error('boom');\nprocess.exit(3);\n",
    );
    writeFileSync(
      join(scriptsDir, "unknown.rb"),
      "puts 'ruby'\n",
    );
  });

  afterAll(() => {
    rmSync(dotDir, { recursive: true, force: true });
  });

  it(".mjs path dispatched through node", async () => {
    const h = new ToolHandler();
    const node: Node = {
      id: "t",
      shape: "parallelogram",
      scriptFile: "scripts/echo.mjs",
      scriptArgs: "alpha beta",
    };
    const outcome = await h.execute(node, baseCtx(), makeContext({ dotDir }));
    expect(outcome.status).toBe("success");
    expect(outcome.contextUpdates?.["tool.output"]).toContain("mjs:alpha,beta");
  });

  it(".ts path dispatched through node --import tsx", async () => {
    const h = new ToolHandler();
    const node: Node = {
      id: "t",
      shape: "parallelogram",
      scriptFile: "scripts/echo.ts",
      scriptArgs: "gamma",
    };
    const outcome = await h.execute(node, baseCtx(), makeContext({ dotDir }));
    expect(outcome.status).toBe("success");
    expect(outcome.contextUpdates?.["tool.output"]).toContain("ts:gamma");
  });

  it(".sh path dispatched through bash", async () => {
    const h = new ToolHandler();
    const node: Node = {
      id: "t",
      shape: "parallelogram",
      scriptFile: "scripts/echo.sh",
      scriptArgs: "one two",
    };
    const outcome = await h.execute(node, baseCtx(), makeContext({ dotDir }));
    expect(outcome.status).toBe("success");
    expect(outcome.contextUpdates?.["tool.output"]).toContain("sh:one two");
  });

  it(".py path dispatched through python3", async () => {
    const h = new ToolHandler();
    const node: Node = {
      id: "t",
      shape: "parallelogram",
      scriptFile: "scripts/echo.py",
      scriptArgs: "x y",
    };
    const outcome = await h.execute(node, baseCtx(), makeContext({ dotDir }));
    expect(outcome.status).toBe("success");
    expect(outcome.contextUpdates?.["tool.output"]).toContain("py:x,y");
  });

  it("unsupported extension returns failure with unsupported_script_extension", async () => {
    const h = new ToolHandler();
    const node: Node = {
      id: "t",
      shape: "parallelogram",
      scriptFile: "scripts/unknown.rb",
    };
    const outcome = await h.execute(node, baseCtx(), makeContext({ dotDir }));
    expect(outcome.status).toBe("fail");
    expect(outcome.failureReason).toMatch(/unsupported_script_extension/);
  });

  it("script_args undergo expandVariables with context values", async () => {
    const h = new ToolHandler();
    const node: Node = {
      id: "t",
      shape: "parallelogram",
      scriptFile: "scripts/echo.mjs",
      scriptArgs: "$foo $bar",
    };
    const outcome = await h.execute(
      node,
      baseCtx({ foo: "hello", bar: "world" }),
      makeContext({ dotDir }),
    );
    expect(outcome.status).toBe("success");
    expect(outcome.contextUpdates?.["tool.output"]).toContain("mjs:hello,world");
  });

  it("relative script_file resolves against meta.dotDir, not cwd", async () => {
    const h = new ToolHandler();
    const node: Node = {
      id: "t",
      shape: "parallelogram",
      scriptFile: "scripts/echo.mjs",
      scriptArgs: "resolved",
    };
    // cwd intentionally different from dotDir — resolution must still succeed
    const outcome = await h.execute(
      node,
      baseCtx(),
      makeContext({ dotDir, cwd: "/" }),
    );
    expect(outcome.status).toBe("success");
    expect(outcome.contextUpdates?.["tool.output"]).toContain("mjs:resolved");
  });

  it("exit 0 → status success, stdout in contextUpdates", async () => {
    const h = new ToolHandler();
    const node: Node = {
      id: "t",
      shape: "parallelogram",
      scriptFile: "scripts/echo.mjs",
      scriptArgs: "ok",
    };
    const outcome = await h.execute(node, baseCtx(), makeContext({ dotDir }));
    expect(outcome.status).toBe("success");
    expect(outcome.contextUpdates?.["tool.output"]).toContain("mjs:ok");
  });

  it("exit non-zero → status fail, stdout and stderr populated", async () => {
    const h = new ToolHandler();
    const node: Node = {
      id: "t",
      shape: "parallelogram",
      scriptFile: "scripts/fail.mjs",
    };
    const outcome = await h.execute(node, baseCtx(), makeContext({ dotDir }));
    expect(outcome.status).toBe("fail");
    expect(outcome.contextUpdates?.["tool.output"]).toContain("before-fail");
    expect(outcome.failureReason).toContain("boom");
  });

  it("both script_file and tool_command → fail with script_command_conflict", async () => {
    const h = new ToolHandler();
    const node: Node = {
      id: "t",
      shape: "parallelogram",
      scriptFile: "scripts/echo.mjs",
      toolCommand: "echo collision",
    };
    const outcome = await h.execute(node, baseCtx(), makeContext({ dotDir }));
    expect(outcome.status).toBe("fail");
    expect(outcome.failureReason).toMatch(/script_command_conflict/);
  });
});
