import { existsSync } from "fs";
import { resolve as resolvePath, extname } from "path";
import type { ValidationContext } from "./context.js";
import { expandVariables, extractDefaults, UndefinedVariableError } from "../../transforms/variable-expansion.js";
import { resolveHandlerType } from "../graph.js";

const SUPPORTED_SCRIPT_EXTS = [".mjs", ".js", ".cjs", ".ts", ".mts", ".sh", ".bash", ".py"];

const INLINE_SCRIPT_PATTERNS: RegExp[] = [
  /\bnode\s+-e\b/,
  /\bpython[23]?\s+-c\b/,
  /\bbash\s+-c\b/,
  /<<\s*['"]?[A-Z]/, // heredoc marker
];

export function run(ctx: ValidationContext): void {
  // Script-file + inline-script rules (tool-handler nodes only)
  for (const node of ctx.graph.nodes.values()) {
    if (resolveHandlerType(node) !== "tool") continue;

    const scriptFile = typeof node.scriptFile === "string" ? node.scriptFile : undefined;
    const toolCommand = typeof node.toolCommand === "string" ? node.toolCommand : undefined;

    // script_command_conflict — mutually exclusive
    if (scriptFile && toolCommand) {
      ctx.diags.push({
        rule: "script_command_conflict",
        severity: "error",
        message: `script_file= and tool_command= are mutually exclusive.`,
        location: node.sourceLocation,
      });
    }

    if (scriptFile) {
      // unsupported_script_extension
      const ext = extname(scriptFile).toLowerCase();
      if (!SUPPORTED_SCRIPT_EXTS.includes(ext)) {
        ctx.diags.push({
          rule: "unsupported_script_extension",
          severity: "error",
          message:
            `Unsupported script extension: ${ext}. ` +
            `Supported: ${SUPPORTED_SCRIPT_EXTS.join(", ")}.`,
          location: node.sourceLocation,
        });
      }

      // script_file_exists — only when dotDir is available
      if (ctx.dotDir) {
        const resolved = resolvePath(ctx.dotDir, scriptFile);
        if (!existsSync(resolved)) {
          ctx.diags.push({
            rule: "script_file_exists",
            severity: "error",
            message: `script_file= references a path that doesn't exist: ${resolved}`,
            location: node.sourceLocation,
          });
        }
      }
    }

    // inline_script_smell — heuristics on tool_command=
    if (toolCommand) {
      let flagged = false;
      for (const re of INLINE_SCRIPT_PATTERNS) {
        if (re.test(toolCommand)) { flagged = true; break; }
      }
      if (!flagged) {
        // Length check AFTER attempting variable expansion against EMPTY context
        // so $foo literals retain full length (avoids false negatives when vars
        // expand to short strings at runtime).
        let probed = toolCommand;
        try {
          probed = expandVariables(toolCommand, {}, extractDefaults(node));
        } catch (e) {
          if (!(e instanceof UndefinedVariableError)) throw e;
          // Keep `probed = toolCommand` (literal length) — matches the spec's
          // "apply AFTER attempting variable expansion" semantics.
        }
        if (probed.length > 120) flagged = true;
      }
      if (flagged) {
        ctx.diags.push({
          rule: "inline_script_smell",
          severity: "warning",
          message:
            `Inline script in tool_command= is fragile under DOT quoting. ` +
            `Move to <pipeline-folder>/<name>.<ext> and use script_file=.`,
          location: node.sourceLocation,
        });
      }
    }
  }
}
