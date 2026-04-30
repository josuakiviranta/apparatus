import { parse, stringify } from "@ts-graphviz/ast";
import { loadAgent } from "./agent-loader.js";

interface AgentMeta {
  inputs: string[];
  outputs: string[];
}

function normalizeMultilineQuoted(src: string): string {
  return src.replace(/(\w+)\s*=\s*"((?:\\.|[^"\\])*)"/gs, (m, key, val) => {
    if (!val.includes("\n")) return m;
    return key + '="' + val.replace(/\s*\n\s*/g, " ").trim() + '"';
  });
}

function literal(value: string, quoted: boolean): any {
  return { type: "Literal", quoted, value, children: [] };
}

function attrAst(name: string, value: string): any {
  return {
    type: "Attribute",
    children: [],
    key: literal(name, false),
    value: literal(value, true),
  };
}

function findAttr(children: any[], name: string): number {
  return children.findIndex(
    (c: any) => c.type === "Attribute" && c.key?.value === name,
  );
}

/**
 * Annotate a DOT source for `ralph pipeline show`: inject `label` attributes on
 * agent nodes with their declared `inputs:` / `outputs:` keys, and on agent→agent
 * data-flow edges with the intersection of upstream outputs ∩ downstream inputs.
 *
 * Why: SVG output of `ralph pipeline show` previously rendered only node ids,
 * giving no visibility into the typed contract between nodes. Surfacing
 * inputs/outputs on the diagram makes pipelines self-documenting.
 */
export function annotateDotForShow(src: string, dotDir: string): string {
  const normalized = normalizeMultilineQuoted(src);
  let ast: any;
  try {
    ast = parse(normalized);
  } catch {
    return src;
  }
  const root: any = ast.children.find((c: any) => c.type === "Graph");
  if (!root) return src;

  const agentMeta = new Map<string, AgentMeta>();
  for (const child of root.children) {
    if (child.type !== "Node") continue;
    const agentAttr = (child.children ?? []).find(
      (c: any) => c.type === "Attribute" && c.key?.value === "agent",
    );
    if (!agentAttr) continue;
    const agentName = agentAttr.value?.value;
    if (!agentName) continue;
    try {
      const cfg = loadAgent(agentName, dotDir);
      const inputs = Array.isArray(cfg.inputs) ? cfg.inputs : [];
      const outputs = cfg.outputs ? Object.keys(cfg.outputs) : [];
      agentMeta.set(child.id.value, { inputs, outputs });
    } catch {
      // Validation step already errors for unresolvable agents; skip silently.
    }
  }

  for (const child of root.children) {
    if (child.type !== "Node") continue;
    const meta = agentMeta.get(child.id?.value);
    if (!meta) continue;
    const lines = [child.id.value];
    if (meta.inputs.length) lines.push(`in: ${meta.inputs.join(", ")}`);
    if (meta.outputs.length) lines.push(`out: ${meta.outputs.join(", ")}`);
    if (lines.length === 1) continue;
    const existing = findAttr(child.children, "label");
    if (existing >= 0) child.children.splice(existing, 1);
    child.children.push(attrAst("label", lines.join("\n")));
  }

  const splitChildren: any[] = [];
  for (const child of root.children) {
    if (child.type !== "Edge" || !Array.isArray(child.targets) || child.targets.length < 2) {
      splitChildren.push(child);
      continue;
    }
    for (let i = 0; i < child.targets.length - 1; i++) {
      const fromId = child.targets[i]?.id?.value;
      const toId = child.targets[i + 1]?.id?.value;
      const newEdge: any = {
        ...child,
        targets: [child.targets[i], child.targets[i + 1]],
        children: (child.children ?? []).map((c: any) => ({ ...c })),
      };
      const fromMeta = agentMeta.get(fromId);
      const toMeta = agentMeta.get(toId);
      if (fromMeta && toMeta) {
        const intersection = fromMeta.outputs.filter((o) => toMeta.inputs.includes(o));
        if (intersection.length) {
          const idx = findAttr(newEdge.children, "label");
          if (idx >= 0) newEdge.children.splice(idx, 1);
          newEdge.children.push(attrAst("label", intersection.join(", ")));
        }
      }
      splitChildren.push(newEdge);
    }
  }
  root.children = splitChildren;

  return stringify(ast);
}
