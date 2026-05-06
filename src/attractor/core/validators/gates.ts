import { existsSync } from "fs";
import { join } from "path";
import type { ValidationContext } from "./context.js";
import { resolveGate } from "../../../cli/lib/gate-registry.js";
import { resolveHandlerType } from "../graph.js";

export function run(ctx: ValidationContext): void {
  if (!ctx.dotDir) return;
  const { graph, dotDir, diags } = ctx;
  for (const [id, node] of graph.nodes) {
    if (resolveHandlerType(node) !== "wait.human") continue;

    const hasInlineLabel = !!node.label;
    const mdPath = join(dotDir, `${id}.md`);
    const hasMdFile = existsSync(mdPath);

    if (!hasInlineLabel && !hasMdFile) {
      diags.push({
        rule: "gate_handler_missing",
        severity: "error",
        message: `Gate "${id}" has no inline label= and no sibling ${id}.md. Add either a label= attribute OR create ${id}.md with type:gate frontmatter.`,
        location: node.sourceLocation,
      });
      continue;
    }

    if (hasInlineLabel && hasMdFile) {
      diags.push({
        rule: "gate_inline_md_conflict",
        severity: "error",
        message: `Gate "${id}" has both inline label= and sibling ${id}.md. Pick one source of truth — remove the label= or delete the .md.`,
        location: node.sourceLocation,
      });
      continue;
    }

    if (!hasMdFile) continue; // inline-only path: no further checks needed

    // .md path: parse + cross-check choices vs edges
    let gate: { choices: string[] };
    try {
      gate = resolveGate(id, { dotDir });
    } catch (err) {
      diags.push({
        rule: "gate_md_parse_error",
        severity: "error",
        message: `Gate "${id}" .md failed to parse: ${err instanceof Error ? err.message : String(err)}`,
        location: node.sourceLocation,
      });
      continue;
    }

    const outgoing = graph.edges.filter(e => e.from === id);
    const edgeLabels = outgoing.map(e => e.label).filter((l): l is string => !!l);
    const declaredSet = new Set(gate.choices);
    const edgeSet = new Set(edgeLabels);

    const declaredButNoEdge = gate.choices.filter(c => !edgeSet.has(c));
    const edgeButNotDeclared = edgeLabels.filter(l => !declaredSet.has(l));
    const unlabeledEdgeCount = outgoing.length - edgeLabels.length;

    if (declaredButNoEdge.length || edgeButNotDeclared.length || unlabeledEdgeCount > 0) {
      const parts: string[] = [];
      if (declaredButNoEdge.length) parts.push(`declared in .md but no matching edge: [${declaredButNoEdge.join(", ")}]`);
      if (edgeButNotDeclared.length) parts.push(`edge labels not in .md choices: [${edgeButNotDeclared.join(", ")}]`);
      if (unlabeledEdgeCount > 0) parts.push(`${unlabeledEdgeCount} outgoing edge(s) have no label`);
      diags.push({
        rule: "gate_choice_edge_mismatch",
        severity: "error",
        message: `Gate "${id}" choice/edge mismatch — ${parts.join("; ")}.`,
        location: node.sourceLocation,
      });
    }
  }
}
