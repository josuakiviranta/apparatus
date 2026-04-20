import { parse as parseAST } from "@ts-graphviz/ast";
import type { Graph, Node, Edge, SourceLocation } from "../types.js";
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

function readAttrs(children: any[]): { attrs: AttrMap; locations: Record<string, SourceLocation> } {
  const attrs: AttrMap = {};
  const locations: Record<string, SourceLocation> = {};
  for (const c of children) {
    if (c.type !== "Attribute") continue;
    const key = toCamel(c.key.value);
    const raw = c.value.quoted ? unescapeDotString(c.value.value) : c.value.value;
    attrs[key] = c.value.quoted ? raw : coerceValue(raw);
    if (c.location) {
      locations[key] = {
        line: c.location.start.line,
        column: c.location.start.column,
        endLine: c.location.end?.line,
        endColumn: c.location.end?.column,
      };
    }
  }
  return { attrs, locations };
}

export function parseDotV2(src: string): Graph {
  // @ts-graphviz/ast's PEG parser rejects literal newlines inside quoted strings.
  // Pre-collapse multi-line quoted values. Regex tolerates escaped quotes (\").
  const normalized = src.replace(/(\w+)\s*=\s*"((?:\\.|[^"\\])*)"/gs, (match: string, key: string, val: string) => {
    if (!val.includes("\n")) return match;
    return key + '="' + val.replace(/\s*\n\s*/g, " ").trim() + '"';
  });
  const ast = parseAST(normalized);
  const root: any = ast.children.find((c: any) => c.type === "Graph");
  if (!root) {
    throw new Error("parseDotV2: input contains no digraph/graph root");
  }
  const name = root.id?.value ?? "unnamed";

  const nodes = new Map<string, Node>();
  const edges: Edge[] = [];
  const graphAttrs: AttrMap = {};

  // Node/edge defaults are subgraph-scoped per DOT semantics: a subgraph's
  // `node [...]` / `edge [...]` lines apply only inside that subgraph. Pass
  // defaults as arguments and fork on subgraph entry so sibling scopes stay
  // independent. Graph-level attributes (e.g. `label=…`) still propagate to
  // the outer graphAttrs map.
  function walk(container: any, nodeDefaults: AttrMap, edgeDefaults: AttrMap) {
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
          const { attrs } = readAttrs(child.children);
          if (child.kind === "Node") nodeDefaults = { ...nodeDefaults, ...attrs };
          else if (child.kind === "Edge") edgeDefaults = { ...edgeDefaults, ...attrs };
          else Object.assign(graphAttrs, attrs);
          break;
        }
        case "Node": {
          const id = child.id.value;
          const { attrs: selfAttrs, locations: selfLocs } = readAttrs(child.children);
          const merged = { ...nodeDefaults, ...selfAttrs };
          const loc = child.location;
          const sourceLocation: SourceLocation | undefined = loc
            ? {
                line: loc.start.line,
                column: loc.start.column,
                endLine: loc.end?.line,
                endColumn: loc.end?.column,
              }
            : undefined;
          nodes.set(id, {
            id,
            ...merged,
            sourceLine: loc?.start.line,
            sourceLocation,
            attrLocations: selfLocs,
          } as Node);
          break;
        }
        case "Edge": {
          const { attrs: selfAttrs, locations: edgeLocs } = readAttrs(child.children);
          const edgeAttrs = { ...edgeDefaults, ...selfAttrs };
          const targets = child.targets.map((t: any) => t.id.value);
          const edgeLoc = child.location;
          const edgeSourceLocation: SourceLocation | undefined = edgeLoc
            ? {
                line: edgeLoc.start.line,
                column: edgeLoc.start.column,
                endLine: edgeLoc.end?.line,
                endColumn: edgeLoc.end?.column,
              }
            : undefined;
          for (let i = 0; i < targets.length - 1; i++) {
            edges.push({
              from: targets[i],
              to: targets[i + 1],
              ...edgeAttrs,
              sourceLocation: edgeSourceLocation,
              attrLocations: edgeLocs,
            } as Edge);
          }
          break;
        }
        case "Subgraph":
          walk(child, { ...nodeDefaults }, { ...edgeDefaults });
          break;
      }
    }
  }
  walk(root, {}, {});

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
