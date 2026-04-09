import type { Graph, Node, Edge, Diagnostic } from "../types.js";

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

// Parse key=value attribute list from a string like: shape=box, label="foo bar", max_retries=3
function parseAttrs(attrStr: string): Record<string, unknown> {
  const attrs: Record<string, unknown> = {};
  const re = /(\w+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s,\]]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(attrStr)) !== null) {
    const key = toCamel(m[1]);
    const val = m[2] !== undefined ? m[2] : m[3];
    attrs[key] = coerceValue(val);
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
    nodes,
    edges,
  };
}

const KNOWN_TYPES = new Set([
  "codergen", "tool", "wait.human", "conditional", "parallel", "parallel.fan_in",
  "start", "exit",
  "ralph.implement", "ralph.meditate", "ralph.run-scenarios",
  "agent",
]);

// Types that pass validation but are not yet implemented — emit errors
const UNIMPLEMENTED_TYPES = new Set([
  "parallel", "parallel.fan_in",  // fan-out execution not yet implemented
]);

const SHAPE_TO_TYPE: Record<string, string> = {
  Mdiamond: "start", Msquare: "exit", box: "codergen",
  hexagon: "wait.human", diamond: "conditional", component: "parallel",
  tripleoctagon: "parallel.fan_in", parallelogram: "tool", house: "stack.manager_loop",
  circle: "ralph.implement", octagon: "ralph.meditate", square: "ralph.run-scenarios",
};

export function resolveHandlerType(node: Node): string {
  if (node.agent) return "agent";
  if (node.type) return node.type;
  if (node.shape && SHAPE_TO_TYPE[node.shape]) return SHAPE_TO_TYPE[node.shape];
  return "codergen";
}

export function validateGraph(graph: Graph): Diagnostic[] {
  const diags: Diagnostic[] = [];
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

  return diags;
}

export function validateOrRaise(graph: Graph): void {
  const diags = validateGraph(graph);
  const errors = diags.filter(d => d.severity === "error");
  if (errors.length > 0) {
    throw new Error("Pipeline validation failed:\n" + errors.map(e => `  [${e.rule}] ${e.message}`).join("\n"));
  }
}
