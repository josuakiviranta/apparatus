import { spawnSync } from "child_process";
import { resolve, extname } from "path";
import type { NodeHandler, HandlerExecutionContext } from "./registry.js";
import type { Node, Outcome, PipelineContext } from "../types.js";
import { expandVariables, extractDefaults } from "../transforms/variable-expansion.js";
import { shellQuote } from "../../cli/lib/shell-quote.js";

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

// Parse the last non-empty line of stdout as JSON. On success, returns the
// parsed top-level object as a string-keyed record. On failure, emits a warning
// via console.warn and returns undefined. Empty stdout returns undefined with
// no warning.
function parseLastLineJson(stdout: string, nodeId: string): Record<string, unknown> | undefined {
  const lines = stdout.split("\n").filter((l) => l.trim() !== "");
  if (lines.length === 0) return undefined;
  const last = lines[lines.length - 1];
  try {
    const parsed = JSON.parse(last);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      console.warn(
        `[tool:${nodeId}] produces_from_stdout: last line parsed but is not a JSON object — skipping flatten`,
      );
      return undefined;
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    console.warn(
      `[tool:${nodeId}] produces_from_stdout: failed to parse last line as JSON — ${(err as Error).message}`,
    );
    return undefined;
  }
}

export class ToolHandler implements NodeHandler {
  async execute(node: Node, ctx: PipelineContext, meta: HandlerExecutionContext): Promise<Outcome> {
    const nodeRecord = node as unknown as {
      scriptFile?: string;
      scriptArgs?: string;
      producesFromStdout?: boolean | "true";
      cwd: string;
    };
    const { scriptFile, scriptArgs, cwd } = nodeRecord;
    const producesFromStdout = nodeRecord.producesFromStdout === true
      || nodeRecord.producesFromStdout === "true";
    const defaults = extractDefaults(node as unknown as Record<string, unknown>);

    // Build stdout-derived context updates. tool.output is always present;
    // when produces_from_stdout=true we additionally flatten the last-line JSON
    // object's top-level keys, qualifying each as `${nodeId}.${key}` to match
    // agent-handler's namespacing convention. Native types are preserved (unlike
    // agent-handler which String()-coerces) so downstream conditions can compare
    // numbers/booleans directly.
    const buildUpdates = (stdout: string): Record<string, unknown> => {
      const updates: Record<string, unknown> = { "tool.output": stdout };
      if (producesFromStdout) {
        const parsed = parseLastLineJson(stdout, node.id);
        if (parsed) {
          for (const [k, v] of Object.entries(parsed)) {
            updates[`${node.id}.${k}`] = v;
          }
        }
      }
      return updates;
    };

    if (scriptFile) {
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

      const result = spawnSync("sh", ["-c", command], { encoding: "utf8", cwd });
      const stdout = result.stdout ?? "";
      const stderr = result.stderr ?? "";
      if (result.status !== 0) {
        return {
          status: "fail",
          failureReason: `Script exited with code ${result.status}: ${stderr}`,
          contextUpdates: buildUpdates(stdout),
        };
      }
      return { status: "success", contextUpdates: buildUpdates(stdout) };
    }

    const command = expandVariables(node.toolCommand!, ctx.values, defaults);
    const result = spawnSync("sh", ["-c", command], { encoding: "utf8", cwd });
    const stdout = result.stdout ?? "";
    if (result.status !== 0) {
      return {
        status: "fail",
        failureReason: `Command exited with code ${result.status}: ${result.stderr ?? ""}`,
        contextUpdates: buildUpdates(stdout),
      };
    }
    return { status: "success", contextUpdates: buildUpdates(stdout) };
  }
}
