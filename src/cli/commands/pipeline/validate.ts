import { dirname, relative } from "path";
import {
  loadPipeline,
  PipelineLoadError,
  type LoadedPipeline,
} from "../pipeline-invocation.js";
import { formatPipelineDiag } from "../../lib/pipeline-diag-format.js";
import * as output from "../../lib/output.js";
import type { Diagnostic, Graph } from "../../../attractor/types.js";

export interface PipelineValidateOptions {
  project?: string;
  /** When supplied, diff edge labels against this previous graph and emit
   *  a warning (or error if the renamed label is still referenced). */
  previousGraph?: Graph;
}

interface EdgeDiagnostic { severity: "warning" | "error"; message: string }

export function diffEdgeLabels(prev: Graph, curr: Graph): EdgeDiagnostic[] {
  const out: EdgeDiagnostic[] = [];
  const prevEdges = new Map(prev.edges.map(e => [`${e.from}->${e.to}`, e]));
  const currEdges = new Map(curr.edges.map(e => [`${e.from}->${e.to}`, e]));
  for (const [key, prevEdge] of prevEdges) {
    const currEdge = currEdges.get(key);
    if (!currEdge) continue;
    const prevLabel = prevEdge.label ?? "";
    const currLabel = currEdge.label ?? "";
    if (prevLabel === currLabel) continue;
    const referenced = labelIsReferenced(prev, prevLabel);
    out.push({
      severity: referenced ? "error" : "warning",
      message:
        `Edge ${prevEdge.from} → ${prevEdge.to} label renamed: ` +
        `"${prevLabel}" → "${currLabel}". ` +
        `Edge labels are routing keys; silent renames break downstream handlers.`,
    });
  }
  return out;
}

function labelIsReferenced(g: Graph, label: string): boolean {
  if (!label) return false;
  const needle = `"${label}"`;
  for (const node of g.nodes.values()) {
    if (JSON.stringify(node).includes(needle)) return true;
  }
  return false;
}

export async function pipelineValidateCommand(
  dotFile: string,
  opts: PipelineValidateOptions = {},
): Promise<number> {
  let loaded: LoadedPipeline;
  try {
    loaded = await loadPipeline(dotFile, { project: opts.project });
  } catch (err) {
    if (err instanceof PipelineLoadError) {
      if (err.diagnostic) {
        await output.error(formatPipelineDiag(err.diagnostic, "", err.message));
      } else {
        await output.error(err.message);
      }
      return 1;
    }
    throw err;
  }

  const { graph, src, absPath, diagnostics: diags } = loaded;
  const relPath = relative(process.cwd(), absPath) || absPath;
  const formatDiag = (d: Diagnostic) => formatPipelineDiag(d, src, relPath);

  const infos    = diags.filter(d => d.severity === "info");
  const errors   = diags.filter(d => d.severity === "error");
  const warnings = diags.filter(d => d.severity === "warning");

  for (const i of infos)    await output.info(formatDiag(i));
  for (const w of warnings) await output.warn(formatDiag(w));
  for (const e of errors)   await output.error(formatDiag(e));

  let diffHasError = false;
  if (opts.previousGraph) {
    const diagnostics = diffEdgeLabels(opts.previousGraph, graph);
    for (const d of diagnostics) {
      if (d.severity === "error") { await output.error(d.message); diffHasError = true; }
      else                         await output.warn(d.message);
    }
  }

  if (errors.length === 0 && !diffHasError) {
    await output.success(`Pipeline valid (${graph.nodes.size} nodes, ${graph.edges.length} edges)`);
    return 0;
  }
  return 1;
}
