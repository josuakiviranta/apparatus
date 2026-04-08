import type { Graph, Node, Edge } from "../types.js";

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
