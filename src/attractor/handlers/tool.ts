import { spawnSync } from "child_process";
import { resolve, extname } from "path";
import type { NodeHandler, HandlerExecutionContext } from "./registry.js";
import type { Node, Outcome, PipelineContext } from "../types.js";
import { expandVariables, extractDefaults } from "../transforms/variable-expansion.js";

/**
 * Map of supported script extensions to their interpreter invocation prefix.
 * Values are shell-quoted command prefixes; the resolved script path is appended
 * (also shell-quoted) followed by the already-variable-expanded script_args.
 */
const SCRIPT_INTERPRETERS: Record<string, string> = {
  ".mjs": "node",
  ".js": "node",
  ".cjs": "node",
  ".ts": "node --import tsx",
  ".mts": "node --import tsx",
  ".sh": "bash",
  ".bash": "bash",
  ".py": "python3",
};

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export class ToolHandler implements NodeHandler {
  async execute(node: Node, ctx: PipelineContext, meta: HandlerExecutionContext): Promise<Outcome> {
    const nodeRecord = node as unknown as Record<string, unknown>;
    const scriptFile = typeof nodeRecord.scriptFile === "string" ? nodeRecord.scriptFile : undefined;
    const scriptArgs = typeof nodeRecord.scriptArgs === "string" ? nodeRecord.scriptArgs : undefined;
    const defaults = extractDefaults(nodeRecord);

    if (scriptFile) {
      if (node.toolCommand) {
        return {
          status: "fail",
          failureReason: "script_command_conflict: script_file= and tool_command= are mutually exclusive.",
        };
      }

      const ext = extname(scriptFile).toLowerCase();
      const interpreter = SCRIPT_INTERPRETERS[ext];
      if (!interpreter) {
        return {
          status: "fail",
          failureReason: `unsupported_script_extension: "${ext}" is not supported. Supported: ${Object.keys(SCRIPT_INTERPRETERS).join(", ")}`,
        };
      }

      const resolvedPath = resolve(meta.dotDir, scriptFile);
      const expandedArgs = scriptArgs ? expandVariables(scriptArgs, ctx.values, defaults) : "";
      const command = expandedArgs
        ? `${interpreter} ${shellQuote(resolvedPath)} ${expandedArgs}`
        : `${interpreter} ${shellQuote(resolvedPath)}`;

      const result = spawnSync("sh", ["-c", command], { encoding: "utf8" });
      const stdout = result.stdout ?? "";
      const stderr = result.stderr ?? "";
      if (result.status !== 0) {
        return {
          status: "fail",
          failureReason: `Script exited with code ${result.status}: ${stderr}`,
          contextUpdates: { "tool.output": stdout },
        };
      }
      return { status: "success", contextUpdates: { "tool.output": stdout } };
    }

    if (!node.toolCommand) {
      return { status: "fail", failureReason: "No tool_command specified on node" };
    }
    const command = expandVariables(node.toolCommand, ctx.values, defaults);
    const result = spawnSync("sh", ["-c", command], { encoding: "utf8" });
    const stdout = result.stdout ?? "";
    if (result.status !== 0) {
      return {
        status: "fail",
        failureReason: `Command exited with code ${result.status}: ${result.stderr ?? ""}`,
        contextUpdates: { "tool.output": stdout },
      };
    }
    return { status: "success", contextUpdates: { "tool.output": stdout } };
  }
}
