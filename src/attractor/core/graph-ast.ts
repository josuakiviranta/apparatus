import { parse as parseAST } from "@ts-graphviz/ast";
import type { Graph, Node, Edge } from "../types.js";
import {
  toCamel,
  coerceValue,
  unescapeDotString,
  parseStylesheet,
  applyStylesheet,
  parseInputsAttr,
} from "./dot-common.js";

// The @ts-graphviz/ast types aren't re-exported conveniently; we use `any`
// for AST nodes and rely on the shape documented in the design spec.
type AttrMap = Record<string, unknown>;

function readAttrs(children: any[]): AttrMap {
  const out: AttrMap = {};
  for (const c of children) {
    if (c.type !== "Attribute") continue;
    const key = toCamel(c.key.value);
    const raw = c.value.quoted ? unescapeDotString(c.value.value) : c.value.value;
    out[key] = c.value.quoted ? raw : coerceValue(raw);
  }
  return out;
}

export function parseDotV2(src: string): Graph {
  const ast = parseAST(src);
  const root: any = ast.children.find((c: any) => c.type === "Graph");
  if (!root) {
    return { name: "unnamed", nodes: new Map(), edges: [] };
  }
  const name = root.id?.value ?? "unnamed";

  const nodes = new Map<string, Node>();
  const edges: Edge[] = [];
  const graphAttrs: AttrMap = {};
  let nodeDefaults: AttrMap = {};
  let edgeDefaults: AttrMap = {};

  function walk(container: any) {
    for (const child of container.children ?? []) {
      switch (child.type) {
        case "Attribute": {
          const key = toCamel(child.key.value);
          const raw = child.value.quoted
            ? unescapeDotString(child.value.value)
            : child.value.value;
          graphAttrs[key] = child.value.quoted ? raw : coerceValue(raw);
          break;
        }
        case "AttributeList": {
          const attrs = readAttrs(child.children);
          if (child.kind === "Node") nodeDefaults = { ...nodeDefaults, ...attrs };
          else if (child.kind === "Edge") edgeDefaults = { ...edgeDefaults, ...attrs };
          else Object.assign(graphAttrs, attrs);
          break;
        }
        case "Node": {
          const id = child.id.value;
          const attrs = { ...nodeDefaults, ...readAttrs(child.children) };
          nodes.set(id, {
            id,
            ...attrs,
            sourceLine: child.location?.start.line,
          } as Node);
          break;
        }
        case "Edge": {
          const attrs = { ...edgeDefaults, ...readAttrs(child.children) };
          const targets = child.targets.map((t: any) => t.id.value);
          for (let i = 0; i < targets.length - 1; i++) {
            edges.push({ from: targets[i], to: targets[i + 1], ...attrs } as Edge);
          }
          break;
        }
        case "Subgraph":
          walk(child); // flatten: subgraph body contributes to outer scope
          break;
      }
    }
  }
  walk(root);

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
