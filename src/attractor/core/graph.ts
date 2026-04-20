import { existsSync } from "fs";
import { resolve as resolvePath, extname } from "path";
import type { Graph, Node, Diagnostic } from "../types.js";
import { expandVariables, extractDefaults, UndefinedVariableError } from "../transforms/variable-expansion.js";
import { validateNode } from "./schemas.js";
import { parseDotV2 } from "./graph-ast.js";
import {
  toCamel,
} from "./dot-common.js";

export function parseDot(src: string): Graph {
  return parseDotV2(src);
}

const KNOWN_TYPES = new Set([
  "codergen", "tool", "wait.human", "conditional", "parallel", "parallel.fan_in",
  "start", "exit", "store",
  "ralph.implement", "ralph.meditate", "ralph.run-scenarios",
  "agent", "stack.manager_loop",
]);

// Types that pass validation but are not yet implemented — emit errors
const UNIMPLEMENTED_TYPES = new Set([
  "parallel", "parallel.fan_in",     // fan-out execution not yet implemented
  "stack.manager_loop",              // no handler registered
]);

const SHAPE_TO_TYPE: Record<string, string> = {
  Mdiamond: "start", Msquare: "exit", box: "codergen",
  hexagon: "wait.human", diamond: "conditional", component: "parallel",
  tripleoctagon: "parallel.fan_in", parallelogram: "tool", house: "stack.manager_loop",
  circle: "ralph.implement", octagon: "ralph.meditate", square: "ralph.run-scenarios",
  cylinder: "store",
};

export function resolveHandlerType(node: Node): string {
  if (node.agent) return "agent";
  if (node.type) return node.type;
  if (node.shape && SHAPE_TO_TYPE[node.shape]) return SHAPE_TO_TYPE[node.shape];
  return "codergen";
}

const SUPPORTED_SCRIPT_EXTS = [".mjs", ".js", ".cjs", ".ts", ".mts", ".sh", ".bash", ".py"];

const INLINE_SCRIPT_PATTERNS: RegExp[] = [
  /\bnode\s+-e\b/,
  /\bpython[23]?\s+-c\b/,
  /\bbash\s+-c\b/,
  /<<\s*['"]?[A-Z]/, // heredoc marker
];

export function validateGraph(graph: Graph, dotDir?: string): Diagnostic[] {
  const diags: Diagnostic[] = [];
  for (const node of graph.nodes.values()) {
    diags.push(...validateNode(node));
  }
  const { nodes, edges } = graph;

  const isStart = (n: Node) => n.shape === "Mdiamond" || n.id === "start" || n.id === "Start";
  const isExit  = (n: Node) => n.shape === "Msquare"  || n.id === "exit"  || n.id === "end";

  const startNodes = [...nodes.values()].filter(isStart);
  const exitNodes  = [...nodes.values()].filter(isExit);

  if (startNodes.length !== 1) diags.push({ rule: "start_node", severity: "error", message: `Expected exactly 1 start node, found ${startNodes.length}` });
  if (exitNodes.length !== 1)  diags.push({ rule: "terminal_node", severity: "error", message: `Expected exactly 1 exit node, found ${exitNodes.length}` });

  // Reachability BFS from start
  if (startNodes.length === 1) {
    const reachable = new Set<string>();
    const queue = [startNodes[0].id];
    while (queue.length) {
      const cur = queue.shift()!;
      if (reachable.has(cur)) continue;
      reachable.add(cur);
      for (const e of edges.filter(e => e.from === cur)) queue.push(e.to);
    }
    for (const id of nodes.keys()) {
      if (!reachable.has(id)) diags.push({ rule: "reachability", severity: "error", message: `Node "${id}" is unreachable from start`, location: nodes.get(id)?.sourceLocation });
    }

    // start has no incoming
    if (edges.some(e => e.to === startNodes[0].id)) {
      diags.push({ rule: "start_no_incoming", severity: "error", message: "Start node must not have incoming edges", location: startNodes[0].sourceLocation });
    }
  }

  // exit has no outgoing
  if (exitNodes.length === 1 && edges.some(e => e.from === exitNodes[0].id)) {
    diags.push({ rule: "exit_no_outgoing", severity: "error", message: "Exit node must not have outgoing edges", location: exitNodes[0].sourceLocation });
  }

  // Reverse-BFS from exit: every non-exit node must be able to reach the exit.
  // Catches dead-end authoring bugs (e.g. a gate branch points at a node with
  // no outgoing edges) that forward-reachability alone cannot see.
  if (exitNodes.length === 1) {
    const exitId = exitNodes[0].id;
    const reverseAdj = new Map<string, string[]>();
    for (const id of nodes.keys()) reverseAdj.set(id, []);
    for (const e of edges) {
      if (reverseAdj.has(e.to)) reverseAdj.get(e.to)!.push(e.from);
    }
    const reachesExit = new Set<string>();
    const queue = [exitId];
    while (queue.length) {
      const cur = queue.shift()!;
      if (reachesExit.has(cur)) continue;
      reachesExit.add(cur);
      for (const pred of (reverseAdj.get(cur) ?? [])) queue.push(pred);
    }
    for (const [id, node] of nodes) {
      if (isExit(node)) continue;
      if (!reachesExit.has(id)) {
        diags.push({
          rule: "reaches_exit",
          severity: "error",
          message: `Node "${id}" has no path to the exit node`,
          location: node.sourceLocation,
        });
      }
    }
  }

  // Edge targets exist
  for (const e of edges) {
    if (!nodes.has(e.to)) diags.push({ rule: "edge_target_exists", severity: "error", message: `Edge target "${e.to}" not declared`, location: e.sourceLocation });
    if (!nodes.has(e.from)) diags.push({ rule: "edge_source_exists", severity: "error", message: `Edge source "${e.from}" not declared`, location: e.sourceLocation });
  }

  // Condition syntax (basic: only allow key=value and key!=value with &&)
  for (const e of edges) {
    if (e.condition) {
      const valid = /^[\w.'= !&\s]+$/.test(e.condition) && !/==|=>|<=/.test(e.condition);
      if (!valid) diags.push({ rule: "condition_syntax", severity: "error", message: `Invalid condition syntax: "${e.condition}"`, location: e.sourceLocation });
    }
  }

  // type_known warning + unimplemented type errors
  for (const node of nodes.values()) {
    const t = resolveHandlerType(node);
    if (!KNOWN_TYPES.has(t)) diags.push({ rule: "type_known", severity: "warning", message: `Unknown handler type "${t}" on node "${node.id}"`, location: node.sourceLocation });
    if (UNIMPLEMENTED_TYPES.has(t)) diags.push({ rule: "type_unsupported", severity: "error", message: `Node type "${t}" is declared but not yet implemented (node "${node.id}")`, location: node.sourceLocation });
  }

  // variable_coverage — warn when a $variable may not be defined on all paths
  const RESERVED_VARS = new Set(["goal", "project", "run_id"]);
  const callerInputs = new Set(graph.inputs ?? []);
  const VAR_RE = /\$([a-zA-Z_][\w.]*)/g;

  // Handler-type implicit productions
  const TYPE_PRODUCES: Record<string, string[]> = {
    "tool": ["tool.output"],
    "store": ["store.path"],
    "wait.human": ["chat.output", "choice"],
  };

  // Build adjacency list for forward BFS
  const adj = new Map<string, string[]>();
  for (const n of nodes.keys()) adj.set(n, []);
  for (const e of edges) {
    if (adj.has(e.from)) adj.get(e.from)!.push(e.to);
  }

  // Collect what each node produces
  const nodeProduces = new Map<string, Set<string>>();
  for (const [id, node] of nodes) {
    const produced = new Set<string>();
    const handlerType = resolveHandlerType(node);
    // Implicit productions from handler type
    if (TYPE_PRODUCES[handlerType]) {
      for (const v of TYPE_PRODUCES[handlerType]) produced.add(v);
    }
    // Gates write a node-specific choice key in addition to the alias (8cb4eef).
    if (handlerType === "wait.human") {
      produced.add(`${id}.choice`);
    }
    // Interactive nodes produce chat.output
    if (node.interactive) produced.add("chat.output");
    // Explicit produces attribute (comma-separated)
    if (typeof node.produces === "string") {
      for (const v of (node.produces as string).split(",").map(s => s.trim()).filter(Boolean)) {
        produced.add(v);
      }
    }
    nodeProduces.set(id, produced);
  }

  // Check if a node has a default for a given variable.
  // DOT `default_<var>` is normalized to camelCase at parse time via toCamel
  // (graph.ts:7). Route lookup through the same helper so snake_case var names
  // like $test_result resolve to defaultTestResult, not defaultTest_result.
  function hasDefault(node: Node, varName: string): boolean {
    const key = toCamel("default_" + varName);
    return node[key] !== undefined;
  }

  // BFS reachability check: can `target` be reached from `source` without visiting any node in `excluded`?
  function reachableWithout(source: string, target: string, excluded: Set<string>): boolean {
    if (source === target) return true;
    const visited = new Set<string>();
    const queue = [source];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (visited.has(cur)) continue;
      visited.add(cur);
      if (cur === target) return true;
      for (const next of (adj.get(cur) ?? [])) {
        if (!excluded.has(next)) queue.push(next);
      }
    }
    return false;
  }

  if (startNodes.length === 1) {
    const startId = startNodes[0].id;
    for (const [consumerId, consumer] of nodes) {
      // Extract variable references from prompt, toolCommand, label, and scriptArgs.
      // label is rendered by the wait-human handler (hexagon gates); scriptArgs
      // is rendered by the tool handler when script_file= is set. Both expand
      // $vars at runtime, so both must be scanned for path-wise availability.
      const fields = [
        consumer.prompt,
        consumer.toolCommand,
        consumer.label,
        consumer.scriptArgs,
      ].filter(Boolean) as string[];
      const vars = new Set<string>();
      for (const field of fields) {
        let m: RegExpExecArray | null;
        const re = new RegExp(VAR_RE.source, VAR_RE.flags);
        while ((m = re.exec(field)) !== null) {
          vars.add(m[1].replace(/\.+$/, ""));
        }
      }

      for (const varName of vars) {
        if (RESERVED_VARS.has(varName)) continue;
        if (callerInputs.has(varName)) continue;
        if (hasDefault(consumer, varName)) continue;

        // Find all producer nodes for this variable
        const producers = new Set<string>();
        for (const [nodeId, produced] of nodeProduces) {
          if (produced.has(varName)) producers.add(nodeId);
        }

        // If no producers exist at all, warn
        if (producers.size === 0) {
          diags.push({
            rule: "variable_coverage",
            severity: "warning",
            message: `Variable "$${varName}" referenced by node "${consumerId}" has no known producer`,
            location: consumer.sourceLocation,
          });
          continue;
        }

        // Check: is consumer reachable from start when all producers are removed?
        // If yes, there's a path that skips all producers → warn
        if (reachableWithout(startId, consumerId, producers)) {
          const producerList = [...producers].join(", ");
          diags.push({
            rule: "variable_coverage",
            severity: "warning",
            message: `Variable "$${varName}" referenced by node "${consumerId}" may be undefined on path(s) that skip node "${producerList}"`,
            location: consumer.sourceLocation,
          });
        }
      }
    }
  }

  // portability_heuristic — warn when node attributes embed project-specific path substrings
  const PORTABILITY_PATH_PATTERNS = ["meditations/", "docs/superpowers/"];
  for (const node of nodes.values()) {
    const fields = [node.prompt, node.toolCommand].filter((f): f is string => typeof f === "string");
    for (const field of fields) {
      for (const pat of PORTABILITY_PATH_PATTERNS) {
        if (field.includes(pat)) {
          diags.push({
            rule: "portability_heuristic",
            severity: "warning",
            message: `Node "${node.id}" hardcodes project path "${pat}" — use $variable and declare in inputs=`,
            location: node.sourceLocation,
          });
          break; // one warning per node per field is enough
        }
      }
    }
  }

  // Script-file + inline-script rules (tool-handler nodes only)
  for (const node of nodes.values()) {
    if (resolveHandlerType(node) !== "tool") continue;

    const scriptFile = typeof node.scriptFile === "string" ? node.scriptFile : undefined;
    const toolCommand = typeof node.toolCommand === "string" ? node.toolCommand : undefined;

    // script_command_conflict — mutually exclusive
    if (scriptFile && toolCommand) {
      diags.push({
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
        diags.push({
          rule: "unsupported_script_extension",
          severity: "error",
          message:
            `Unsupported script extension: ${ext}. ` +
            `Supported: ${SUPPORTED_SCRIPT_EXTS.join(", ")}.`,
          location: node.sourceLocation,
        });
      }

      // script_file_exists — only when dotDir is available
      if (dotDir) {
        const resolved = resolvePath(dotDir, scriptFile);
        if (!existsSync(resolved)) {
          diags.push({
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
        diags.push({
          rule: "inline_script_smell",
          severity: "warning",
          message:
            `Inline script in tool_command= is fragile under DOT quoting. ` +
            `Move to pipelines/scripts/<name>.<ext> and use script_file=.`,
          location: node.sourceLocation,
        });
      }
    }
  }

  return diags;
}

export function validateOrRaise(graph: Graph): void {
  const diags = validateGraph(graph);
  const errors = diags.filter(d => d.severity === "error");
  if (errors.length > 0) {
    throw new Error("Pipeline validation failed:\n" + errors.map(e => `  [${e.rule}] ${e.message}`).join("\n"));
  }
}
