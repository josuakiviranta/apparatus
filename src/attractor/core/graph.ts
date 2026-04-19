import { existsSync } from "fs";
import { resolve as resolvePath, extname } from "path";
import type { Graph, Node, Edge, Diagnostic } from "../types.js";
import { expandVariables, extractDefaults, UndefinedVariableError } from "../transforms/variable-expansion.js";
import { validateNode } from "./schemas.js";

// Convert snake_case to camelCase
function toCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

// Convert attribute value string to typed value
function coerceValue(val: string): unknown {
  if (val === "true") return true;
  if (val === "false") return false;
  const n = Number(val);
  if (!isNaN(n) && val.trim() !== "") return n;
  return val;
}

// Strip // and /* */ comments from DOT source
function stripComments(src: string): string {
  src = src.replace(/\/\*[\s\S]*?\*\//g, "");
  src = src.replace(/\/\/.*/g, "");
  return src;
}

// Unescape DOT escape sequences inside double-quoted attribute values
function unescapeDotString(s: string): string {
  return s.replace(/\\(.)/g, (_, ch) => {
    switch (ch) {
      case "n": return "\n";
      case "t": return "\t";
      case "r": return "\r";
      case '"': return '"';
      case "\\": return "\\";
      default: return ch;
    }
  });
}

// Parse key=value attribute list from a string like: shape=box, label="foo bar", max_retries=3
function parseAttrs(attrStr: string): Record<string, unknown> {
  const attrs: Record<string, unknown> = {};
  const re = /(\w+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s,\]]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(attrStr)) !== null) {
    const key = toCamel(m[1]);
    // m[2] is the quoted value (escape sequences apply);
    // m[3] is the unquoted value (raw identifier/number/bool — no escape processing)
    const rawVal = m[2] !== undefined ? unescapeDotString(m[2]) : m[3];
    attrs[key] = coerceValue(rawVal);
  }
  return attrs;
}

// Parse the model_stylesheet block into a simple structure
function parseStylesheet(css: string): Array<{ selector: string; selectorType: "shape" | "class" | "id" | "universal"; props: Record<string, string> }> {
  const rules: Array<{ selector: string; selectorType: "shape" | "class" | "id" | "universal"; props: Record<string, string> }> = [];
  const ruleRe = /([^\{]+)\{([^\}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = ruleRe.exec(css)) !== null) {
    const selectorRaw = m[1].trim();
    const body = m[2];
    const props: Record<string, string> = {};
    const propRe = /([\w_-]+)\s*:\s*([^\s;]+)/g;
    let pm: RegExpExecArray | null;
    while ((pm = propRe.exec(body)) !== null) {
      props[toCamel(pm[1])] = pm[2].replace(/['"]/g, "");
    }
    let selectorType: "shape" | "class" | "id" | "universal";
    let selector = selectorRaw;
    if (selectorRaw === "*") { selectorType = "universal"; }
    else if (selectorRaw.startsWith(".")) { selectorType = "class"; selector = selectorRaw.slice(1); }
    else if (selectorRaw.startsWith("#")) { selectorType = "id"; selector = selectorRaw.slice(1); }
    else { selectorType = "shape"; }
    rules.push({ selector, selectorType, props });
  }
  return rules;
}

// Apply stylesheet rules to a node (lowest specificity first, explicit attrs win)
function applyStylesheet(
  node: Node,
  rules: Array<{ selector: string; selectorType: "shape" | "class" | "id" | "universal"; props: Record<string, string> }>
): Node {
  const specificity = (t: string) =>
    t === "universal" ? 0 : t === "shape" ? 1 : t === "class" ? 2 : 3;
  const sorted = [...rules].sort((a, b) => specificity(a.selectorType) - specificity(b.selectorType));
  const resolved: Record<string, string> = {};
  for (const rule of sorted) {
    const matches =
      (rule.selectorType === "universal") ||
      (rule.selectorType === "shape" && node.shape === rule.selector) ||
      (rule.selectorType === "class" && node.class === rule.selector) ||
      (rule.selectorType === "id" && node.id === rule.selector);
    if (matches) Object.assign(resolved, rule.props);
  }
  return { ...resolved, ...node };
}

function parseInputsAttr(raw: unknown): string[] | undefined {
  if (typeof raw !== "string") return undefined;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const name = part.trim();
    if (!name) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out.length > 0 ? out : undefined;
}

export function parseDot(src: string): Graph {
  src = stripComments(src);

  const nameMatch = src.match(/digraph\s+(\w+)\s*\{/);
  const name = nameMatch?.[1] ?? "unnamed";

  const inner = src.replace(/digraph\s+\w+\s*\{/, "").replace(/\}\s*$/, "");

  const nodes = new Map<string, Node>();
  const edges: Edge[] = [];
  const graphAttrs: Record<string, unknown> = {};
  let nodeDefaults: Record<string, unknown> = {};
  let edgeDefaults: Record<string, unknown> = {};

  function flattenSubgraphs(s: string): string {
    return s.replace(/subgraph\s+\w*\s*\{([^{}]*)\}/g, (_, body) => body);
  }
  let flat = flattenSubgraphs(inner);
  flat = flattenSubgraphs(flattenSubgraphs(flat));

  let normalized = flat.replace(/\[([^\]]*)\]/gs, (_, body) => {
    return "[" + body.replace(/\s*\n\s*/g, " ") + "]";
  });

  // Collapse multi-line quoted graph-attribute values (e.g., model_stylesheet="...\n...")
  normalized = normalized.replace(/(\w+)\s*=\s*"([^"]*)"/gs, (match, key, val) => {
    if (!val.includes("\n")) return match;
    return key + '="' + val.replace(/\s*\n\s*/g, " ").trim() + '"';
  });

  const lines = normalized.split("\n").map(l => l.trim()).filter(l => l.length > 0);

  for (const line of lines) {
    // Graph-level attribute
    if (!line.includes("->") && !line.startsWith("[") && !line.startsWith("node") && !line.startsWith("edge") && line.includes("=") && !line.includes("[")) {
      const m = line.match(/^(\w+)\s*=\s*"?(.*?)"?\s*;?\s*$/);
      if (m) {
        graphAttrs[toCamel(m[1])] = coerceValue(m[2]);
        continue;
      }
    }

    // Node/edge default block
    const defaultMatch = line.match(/^(node|edge)\s*\[([^\]]*)\]/);
    if (defaultMatch) {
      const attrs = parseAttrs(defaultMatch[2]);
      if (defaultMatch[1] === "node") nodeDefaults = { ...nodeDefaults, ...attrs };
      else edgeDefaults = { ...edgeDefaults, ...attrs };
      continue;
    }

    // Graph attribute block
    const graphBlockMatch = line.match(/^graph\s*\[([^\]]*)\]/);
    if (graphBlockMatch) {
      Object.assign(graphAttrs, parseAttrs(graphBlockMatch[1]));
      continue;
    }

    // Edge declaration
    if (line.includes("->")) {
      const edgeAttrMatch = line.match(/^(.*?)\s*(?:\[([^\]]*)\])?\s*;?\s*$/);
      const edgePart = edgeAttrMatch?.[1] ?? "";
      const attrPart = edgeAttrMatch?.[2] ?? "";
      const edgeAttrs = { ...edgeDefaults, ...parseAttrs(attrPart) };

      const nodeIds = edgePart.split("->").map(s => s.trim()).filter(Boolean);
      for (let i = 0; i < nodeIds.length - 1; i++) {
        edges.push({ from: nodeIds[i], to: nodeIds[i + 1], ...edgeAttrs } as Edge);
      }
      continue;
    }

    // Node declaration
    const nodeMatch = line.match(/^(\w+)\s*(?:\[([^\]]*)\])?\s*;?\s*$/);
    if (nodeMatch && nodeMatch[1] !== "graph" && nodeMatch[1] !== "node" && nodeMatch[1] !== "edge") {
      const id = nodeMatch[1];
      const attrStr = nodeMatch[2] ?? "";
      const attrs = { ...nodeDefaults, ...parseAttrs(attrStr) };
      nodes.set(id, { id, ...attrs } as Node);
      continue;
    }
  }

  const stylesheet = (graphAttrs["modelStylesheet"] as string) ?? "";
  const rules = stylesheet ? parseStylesheet(stylesheet) : [];

  if (rules.length > 0) {
    for (const [id, node] of nodes) {
      nodes.set(id, applyStylesheet(node, rules));
    }
  }

  return {
    name,
    goal: graphAttrs["goal"] as string | undefined,
    label: graphAttrs["label"] as string | undefined,
    modelStylesheet: stylesheet || undefined,
    defaultMaxRetries: graphAttrs["defaultMaxRetries"] as number | undefined,
    defaultFidelity: graphAttrs["defaultFidelity"] as string | undefined,
    maxParallel: graphAttrs["maxParallel"] as number | undefined,
    retryTarget: graphAttrs["retryTarget"] as string | undefined,
    fallbackRetryTarget: graphAttrs["fallbackRetryTarget"] as string | undefined,
    headlessSafe: graphAttrs["headlessSafe"] as boolean | undefined,
    inputs: parseInputsAttr(graphAttrs["inputs"]),
    nodes,
    edges,
  };
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
      if (!reachable.has(id)) diags.push({ rule: "reachability", severity: "error", message: `Node "${id}" is unreachable from start` });
    }

    // start has no incoming
    if (edges.some(e => e.to === startNodes[0].id)) {
      diags.push({ rule: "start_no_incoming", severity: "error", message: "Start node must not have incoming edges" });
    }
  }

  // exit has no outgoing
  if (exitNodes.length === 1 && edges.some(e => e.from === exitNodes[0].id)) {
    diags.push({ rule: "exit_no_outgoing", severity: "error", message: "Exit node must not have outgoing edges" });
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
        });
      }
    }
  }

  // Edge targets exist
  for (const e of edges) {
    if (!nodes.has(e.to)) diags.push({ rule: "edge_target_exists", severity: "error", message: `Edge target "${e.to}" not declared` });
    if (!nodes.has(e.from)) diags.push({ rule: "edge_source_exists", severity: "error", message: `Edge source "${e.from}" not declared` });
  }

  // Condition syntax (basic: only allow key=value and key!=value with &&)
  for (const e of edges) {
    if (e.condition) {
      const valid = /^[\w.'= !&\s]+$/.test(e.condition) && !/==|=>|<=/.test(e.condition);
      if (!valid) diags.push({ rule: "condition_syntax", severity: "error", message: `Invalid condition syntax: "${e.condition}"` });
    }
  }

  // type_known warning + unimplemented type errors
  for (const node of nodes.values()) {
    const t = resolveHandlerType(node);
    if (!KNOWN_TYPES.has(t)) diags.push({ rule: "type_known", severity: "warning", message: `Unknown handler type "${t}" on node "${node.id}"` });
    if (UNIMPLEMENTED_TYPES.has(t)) diags.push({ rule: "type_unsupported", severity: "error", message: `Node type "${t}" is declared but not yet implemented (node "${node.id}")` });
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
