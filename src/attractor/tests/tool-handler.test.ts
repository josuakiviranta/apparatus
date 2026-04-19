import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
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

  // script_command_conflict is now caught at validate-time by zod refine
  // (see ToolNodeSchema in src/attractor/core/schemas.ts and graph.test.ts).
  // The runtime guard was removed in Chunk 4 of the validator trust upgrade.
});

describe("ToolHandler — produces_from_stdout", () => {
  let dotDir: string;
  let scriptsDir: string;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(() => {
    dotDir = mkdtempSync(join(tmpdir(), "tool-stdout-json-test-"));
    scriptsDir = join(dotDir, "scripts");
    mkdirSync(scriptsDir, { recursive: true });

    // Script prints a chatty line, then a final-line JSON object
    writeFileSync(
      join(scriptsDir, "emit-json.mjs"),
      "console.log('hello');\nconsole.log(JSON.stringify({a:1,b:2}));\n",
    );
    // Script prints only non-JSON content
    writeFileSync(
      join(scriptsDir, "emit-plain.mjs"),
      "console.log('just plain text on the last line');\n",
    );
    // Script prints nothing (empty stdout)
    writeFileSync(
      join(scriptsDir, "emit-empty.mjs"),
      "// no output at all\n",
    );
    // Script with invalid JSON but non-zero exit
    writeFileSync(
      join(scriptsDir, "emit-junk-fail.mjs"),
      "console.log('not-json');\nprocess.exit(7);\n",
    );
  });

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  afterAll(() => {
    rmSync(dotDir, { recursive: true, force: true });
  });

  it("produces_from_stdout=true + last-line JSON → flattens top-level keys + keeps tool.output", async () => {
    const h = new ToolHandler();
    const node: Node = {
      id: "t",
      shape: "parallelogram",
      scriptFile: "scripts/emit-json.mjs",
      producesFromStdout: true,
    } as Node;
    const outcome = await h.execute(node, baseCtx(), makeContext({ dotDir }));
    expect(outcome.status).toBe("success");
    expect(outcome.contextUpdates?.a).toBe(1);
    expect(outcome.contextUpdates?.b).toBe(2);
    expect(outcome.contextUpdates?.["tool.output"]).toContain("hello");
    expect(outcome.contextUpdates?.["tool.output"]).toContain('{"a":1,"b":2}');
  });

  it("produces_from_stdout as string 'true' (DOT-coerced) also triggers parsing", async () => {
    const h = new ToolHandler();
    const node: Node = {
      id: "t",
      shape: "parallelogram",
      scriptFile: "scripts/emit-json.mjs",
      producesFromStdout: "true",
    } as unknown as Node;
    const outcome = await h.execute(node, baseCtx(), makeContext({ dotDir }));
    expect(outcome.status).toBe("success");
    expect(outcome.contextUpdates?.a).toBe(1);
    expect(outcome.contextUpdates?.b).toBe(2);
  });

  it("produces_from_stdout=true + invalid JSON on last line → warn, only tool.output set, status still success", async () => {
    const h = new ToolHandler();
    const node: Node = {
      id: "t",
      shape: "parallelogram",
      scriptFile: "scripts/emit-plain.mjs",
      producesFromStdout: true,
    } as Node;
    const outcome = await h.execute(node, baseCtx(), makeContext({ dotDir }));
    expect(outcome.status).toBe("success");
    expect(outcome.contextUpdates?.["tool.output"]).toContain("just plain text");
    // No extra keys beyond tool.output
    expect(Object.keys(outcome.contextUpdates ?? {})).toEqual(["tool.output"]);
    expect(warnSpy).toHaveBeenCalled();
  });

  it("produces_from_stdout=true + empty stdout → no crash, no extra keys, status preserved", async () => {
    const h = new ToolHandler();
    const node: Node = {
      id: "t",
      shape: "parallelogram",
      scriptFile: "scripts/emit-empty.mjs",
      producesFromStdout: true,
    } as Node;
    const outcome = await h.execute(node, baseCtx(), makeContext({ dotDir }));
    expect(outcome.status).toBe("success");
    expect(Object.keys(outcome.contextUpdates ?? {})).toEqual(["tool.output"]);
    expect(outcome.contextUpdates?.["tool.output"]).toBe("");
  });

  it("produces_from_stdout=true + non-zero exit + invalid JSON → status fail, tool.output retained, no flattened keys", async () => {
    const h = new ToolHandler();
    const node: Node = {
      id: "t",
      shape: "parallelogram",
      scriptFile: "scripts/emit-junk-fail.mjs",
      producesFromStdout: true,
    } as Node;
    const outcome = await h.execute(node, baseCtx(), makeContext({ dotDir }));
    expect(outcome.status).toBe("fail");
    expect(outcome.contextUpdates?.["tool.output"]).toContain("not-json");
    expect(Object.keys(outcome.contextUpdates ?? {})).toEqual(["tool.output"]);
  });

  it("absence of produces_from_stdout → stdout never parsed (regression)", async () => {
    const h = new ToolHandler();
    const node: Node = {
      id: "t",
      shape: "parallelogram",
      scriptFile: "scripts/emit-json.mjs",
      // producesFromStdout intentionally omitted
    };
    const outcome = await h.execute(node, baseCtx(), makeContext({ dotDir }));
    expect(outcome.status).toBe("success");
    // Only tool.output — no a/b flattened
    expect(Object.keys(outcome.contextUpdates ?? {})).toEqual(["tool.output"]);
    expect(outcome.contextUpdates?.a).toBeUndefined();
    expect(outcome.contextUpdates?.b).toBeUndefined();
  });

  it("produces_from_stdout=false → stdout never parsed", async () => {
    const h = new ToolHandler();
    const node: Node = {
      id: "t",
      shape: "parallelogram",
      scriptFile: "scripts/emit-json.mjs",
      producesFromStdout: false,
    } as Node;
    const outcome = await h.execute(node, baseCtx(), makeContext({ dotDir }));
    expect(outcome.status).toBe("success");
    expect(Object.keys(outcome.contextUpdates ?? {})).toEqual(["tool.output"]);
  });

  it("produces_from_stdout=true works with tool_command branch too", async () => {
    const h = new ToolHandler();
    const node: Node = {
      id: "t",
      shape: "parallelogram",
      toolCommand: `printf '%s\\n%s\\n' 'prelude' '{"x":42,"y":"ok"}'`,
      producesFromStdout: true,
    } as Node;
    const outcome = await h.execute(node, baseCtx(), makeContext({ dotDir }));
    expect(outcome.status).toBe("success");
    expect(outcome.contextUpdates?.x).toBe(42);
    expect(outcome.contextUpdates?.y).toBe("ok");
    expect(outcome.contextUpdates?.["tool.output"]).toContain("prelude");
  });
});
