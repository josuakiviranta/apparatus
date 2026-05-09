import { resolve, dirname } from "path";
import { loadPipeline, PipelineLoadError } from "../pipeline-invocation.js";
import { buildAgentPrompt } from "../../../attractor/handlers/agent-prep.js";
import {
  computeVarsInScope,
  computeVarsInAnyScope,
} from "../../../attractor/core/flow-analyzer.js";
import { resolveInputDecl } from "../../../attractor/transforms/inputs-resolver.js";
import { classifyNode, type NodeKind } from "../../../attractor/core/schemas.js";
import { loadAgent } from "../../lib/agent-loader.js";
import { resolveGate } from "../../lib/gate-registry.js";
import { formatPipelineDiag } from "../../lib/pipeline-diag-format.js";
import * as output from "../../lib/output.js";
import type { Graph, Node, PipelineContext } from "../../../attractor/types.js";
import type { HandlerExecutionContext } from "../../../attractor/handlers/registry.js";
import type { AgentConfig } from "../../lib/agent.js";

export interface PipelineExplainOptions {
  project?: string;
}

export async function pipelineExplainCommand(
  pipelineArg: string,
  nodeId: string | undefined,
  opts: PipelineExplainOptions = {},
): Promise<number> {
  const projectRoot = resolve(opts.project ?? process.cwd());

  let loaded;
  try {
    loaded = await loadPipeline(pipelineArg, { project: projectRoot });
  } catch (err) {
    if (err instanceof PipelineLoadError) {
      if (err.diagnostic) {
        await output.error(
          formatPipelineDiag(err.diagnostic, err.src ?? "", err.relPath ?? ""),
        );
      } else if (err.kind === "not-found") {
        await output.error(`Pipeline file not found: ${pipelineArg}`);
      } else {
        await output.error(err.message);
      }
      return 1;
    }
    throw err;
  }

  const errors = loaded.diagnostics.filter(d => d.severity === "error");
  if (errors.length > 0) {
    for (const d of errors) {
      await output.error(formatPipelineDiag(d, loaded.src, loaded.relPath));
    }
    return 1;
  }

  if (nodeId === undefined) {
    return renderTopology(loaded.graph, loaded.absPath);
  }
  return renderNodeZoom(loaded.graph, loaded.absPath, nodeId, projectRoot);
}

// ──────────────────────────────────────────────────────────
// Topology mode — §3.2.1
// ──────────────────────────────────────────────────────────

function renderTopology(graph: Graph, absPath: string): number {
  const dotDir = dirname(absPath);
  const goal = graph.goal ?? "(no goal=)";
  console.log(`\nPipeline: ${graph.name}`);
  console.log(`  goal: ${goal}\n`);
  console.log("Nodes:\n");

  const produces = collectProduces(graph, dotDir);
  const order = topologicalOrder(graph);

  for (const id of order) {
    const node = graph.nodes.get(id);
    if (!node) continue;
    const kind = classifyNode(node);
    const kindLabel = kind ?? "unknown";
    const sibling = (kind === "agent" && node.agent)
      ? ` (agent: ${node.agent})`
      : (kind === "gate") ? ` (sibling: ${id}.md)` : "";
    console.log(`  ${id}${pad(id, 24)}kind=${kindLabel}${sibling}`);

    const consumers = collectConsumers(node, kind, dotDir);
    if (consumers.length > 0) console.log(`    consumes: ${consumers.join(", ")}`);

    const myProduces = produces.get(id);
    if (myProduces && myProduces.size > 0) {
      console.log(`    produces: ${[...myProduces].sort().join(", ")}`);
    }

    const outgoing = graph.edges.filter(e => e.from === id);
    const labelled = outgoing.filter(e => e.label || e.condition);
    if (labelled.length > 0) {
      const branches = labelled
        .map(e => `${e.label ?? e.condition} -> ${e.to}`)
        .join(" · ");
      console.log(`    branches: ${branches}`);
    }
    const next = outgoing.map(e => e.to).join(", ");
    if (next) console.log(`    next: ${next}`);
    console.log("");
  }

  // Loops — back-edges (target appears earlier or equal in topo order than source).
  const idx = new Map(order.map((id, i) => [id, i]));
  const backEdges = graph.edges.filter(e => {
    const fi = idx.get(e.from);
    const ti = idx.get(e.to);
    return fi !== undefined && ti !== undefined && ti <= fi;
  });
  if (backEdges.length > 0) {
    console.log("Loops:");
    for (const e of backEdges) {
      const label = e.label || e.condition || "";
      console.log(`  - ${e.from} -> ${e.to}${label ? ` (on ${label})` : ""}`);
    }
    console.log("");
  }

  // Reachability + branch warnings.
  const inScope = computeVarsInScope(graph, produces);
  const inAny = computeVarsInAnyScope(graph, produces);
  const branchWarnings: string[] = [];
  for (const id of order) {
    const node = graph.nodes.get(id);
    if (!node) continue;
    const kind = classifyNode(node);
    if (kind !== "agent") continue;
    const consumers = collectConsumers(node, kind, dotDir);
    for (const c of consumers) {
      let r;
      try { r = resolveInputDecl(c); } catch { continue; }
      const everywhere = inScope.get(id)?.has(r.lookupKey) ?? false;
      const somewhere = inAny.get(id)?.has(r.lookupKey) ?? false;
      if (!everywhere && somewhere) {
        branchWarnings.push(`  - ${id} consumes "${c}" but only some predecessors produce it`);
      }
    }
  }

  console.log("Reachability:");
  const reachableMark = order.length === graph.nodes.size ? "✓" : "✗";
  console.log(`  - all nodes reachable from start ${reachableMark}`);
  if (branchWarnings.length > 0) {
    console.log("\nBranch warnings:");
    for (const w of branchWarnings) console.log(w);
  }
  console.log("");
  return 0;
}

// ──────────────────────────────────────────────────────────
// Node-zoom mode — §3.2.2
// ──────────────────────────────────────────────────────────

async function renderNodeZoom(
  graph: Graph,
  absPath: string,
  nodeId: string,
  projectRoot: string,
): Promise<number> {
  const dotDir = dirname(absPath);
  const node = graph.nodes.get(nodeId);
  if (!node) {
    const available = [...graph.nodes.keys()].join(", ");
    await output.error(
      `node "${nodeId}" not found in ${graph.name}; available: ${available}`,
    );
    return 1;
  }
  const kind = classifyNode(node);
  if (kind !== "agent") {
    await output.error(
      `node "${nodeId}" is kind=${kind ?? "unknown"}; explain <node> only renders agent nodes ` +
      `(use bare "apparat pipeline explain ${graph.name}" for the topology view).`,
    );
    return 1;
  }

  // Synthesise placeholder ctx.values from the agent's declared inputs.
  let agentConfig: AgentConfig;
  try {
    agentConfig = loadAgent(node.agent as string, dotDir);
  } catch (err) {
    await output.error(
      `Failed to load agent "${node.agent}": ${(err as Error).message}`,
    );
    return 1;
  }
  const declaredInputs = (agentConfig.inputs as string[] | undefined) ?? [];
  const values: Record<string, unknown> = {};
  for (const decl of declaredInputs) {
    let r;
    try { r = resolveInputDecl(decl); } catch { continue; }
    values[r.lookupKey] = `<placeholder:${decl}>`;
  }
  const ctx: PipelineContext = { values };

  const meta: HandlerExecutionContext = {
    cwd: projectRoot,
    dotDir,
    logsRoot: "/dev/null",
    completedNodes: [],
    nodeRetries: {},
    outgoingLabels: [],
    projectDir: projectRoot,
  };

  const built = buildAgentPrompt(node, ctx, meta, loadAgent);
  if ("fail" in built) {
    await output.error(built.fail);
    return 1;
  }
  console.log(built.prompt.replace(/\n+$/, ""));
  return 0;
}

// ──────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────

function pad(id: string, width: number): string {
  return id.length >= width ? " " : " ".repeat(width - id.length);
}

function collectProduces(graph: Graph, dotDir: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const [id, node] of graph.nodes) {
    const set = new Set<string>();
    const kind = classifyNode(node);
    if (kind === "agent" && node.agent) {
      try {
        const cfg = loadAgent(node.agent as string, dotDir);
        if (cfg.outputs && typeof cfg.outputs === "object") {
          for (const key of Object.keys(cfg.outputs)) set.add(`${id}.${key}`);
        }
      } catch { /* missing agent file → validator already errored */ }
    } else if (kind === "gate") {
      set.add(`${id}.choice`);
    }
    out.set(id, set);
  }
  return out;
}

function collectConsumers(node: Node, kind: NodeKind | null, dotDir: string): string[] {
  if (kind === "agent" && node.agent) {
    try {
      const cfg = loadAgent(node.agent as string, dotDir);
      return (cfg.inputs as string[] | undefined) ?? [];
    } catch { return []; }
  }
  if (kind === "gate") {
    try {
      const gate = resolveGate(node.id, { dotDir });
      return gate.inputs ?? [];
    } catch { return []; }
  }
  return [];
}

function topologicalOrder(graph: Graph): string[] {
  const fwd = new Map<string, string[]>();
  for (const id of graph.nodes.keys()) fwd.set(id, []);
  const inDeg = new Map<string, number>();
  for (const id of graph.nodes.keys()) inDeg.set(id, 0);
  for (const e of graph.edges) {
    if (!fwd.has(e.from) || !fwd.has(e.to)) continue;
    fwd.get(e.from)!.push(e.to);
    inDeg.set(e.to, (inDeg.get(e.to) ?? 0) + 1);
  }
  const startId = [...graph.nodes.values()].find(
    n => n.shape === "Mdiamond" || n.id === "start",
  )?.id;
  const queue: string[] = startId ? [startId] : [];
  const seen = new Set<string>();
  if (startId) { inDeg.set(startId, 0); seen.add(startId); }
  const order: string[] = [];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    order.push(cur);
    for (const nxt of fwd.get(cur) ?? []) {
      if (seen.has(nxt)) continue;
      const d = (inDeg.get(nxt) ?? 0) - 1;
      inDeg.set(nxt, d);
      if (d <= 0) { queue.push(nxt); seen.add(nxt); }
    }
  }
  for (const id of graph.nodes.keys()) if (!order.includes(id)) order.push(id);
  return order;
}
