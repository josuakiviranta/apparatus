import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";
import type { Graph, Node, Edge, Outcome, PipelineContext } from "../types.js";
import type { Interviewer } from "../interviewer/index.js";
import { evaluateCondition } from "./conditions.js";
import { resolveHandlerType } from "./graph.js";
import { saveCheckpoint, loadCheckpoint } from "../checkpoint.js";
import { ConditionalHandler } from "../handlers/conditional.js";
import { StartHandler, ExitHandler } from "../handlers/start-exit.js";
import { WaitHumanHandler } from "../handlers/wait-human.js";
import { ToolHandler } from "../handlers/tool.js";
import { RalphMeditateHandler } from "../handlers/ralph-meditate.js";
import { RalphScenariosHandler } from "../handlers/ralph-scenarios.js";
import { ParallelHandler, FanInHandler } from "../handlers/parallel.js";
import { AgentHandler } from "../handlers/agent-handler.js";
import { StoreHandler } from "../handlers/store.js";
import { UndefinedVariableError } from "../transforms/variable-expansion.js";
import type { NodeHandler, HandlerExecutionContext, OnInteractiveRequest } from "../handlers/registry.js";

export interface EngineOptions {
  logsRoot: string;
  cwd: string;
  interviewer: Interviewer;
  signal?: AbortSignal;
  project?: string;
  resume?: boolean;
  dotDir?: string;
  onNodeStart?: (node: Node) => void;
  onStdout?: (stdout: NodeJS.ReadableStream) => Promise<void>;
  onInteractiveRequest?: OnInteractiveRequest;
  onIterationStart?: (nodeId: string, iterationIndex: number) => void;
  onIterationEnd?: (nodeId: string, iterationIndex: number) => void;
  onNodeEnd?: (node: Node, outcome: Outcome) => void;
}

export interface PipelineResult {
  status: "success" | "fail";
  completedNodes: string[];
  context: Record<string, unknown>;
  failureReason?: string;
}

function buildHandlerMap(opts: EngineOptions): Map<string, NodeHandler> {
  const m = new Map<string, NodeHandler>();
  const agentHandler = new AgentHandler();
  m.set("start", new StartHandler());
  m.set("exit", new ExitHandler());
  m.set("codergen", agentHandler);
  m.set("conditional", new ConditionalHandler());
  m.set("wait.human", new WaitHumanHandler(opts.interviewer));
  m.set("tool", new ToolHandler());
  m.set("ralph.implement", agentHandler);
  m.set("ralph.meditate", new RalphMeditateHandler());
  m.set("ralph.run-scenarios", new RalphScenariosHandler());
  m.set("parallel", new ParallelHandler());
  m.set("parallel.fan_in", new FanInHandler());
  m.set("store", new StoreHandler());
  m.set("agent", agentHandler);
  return m;
}

// Selects a recovery edge on failure: only considers explicitly conditioned edges
// so that unconditional success-path edges are never mistaken for fail-path edges.
function selectFailEdge(
  node: Node,
  outcome: Outcome,
  ctx: Record<string, unknown>,
  edges: Edge[]
): Edge | null {
  const outgoing = edges.filter(e => e.from === node.id);
  const condMatch = outgoing.filter(e => e.condition && evaluateCondition(e.condition, outcome, ctx));
  return condMatch.length > 0 ? condMatch[0] : null;
}

function selectNextEdge(
  node: Node,
  outcome: Outcome,
  ctx: Record<string, unknown>,
  edges: Edge[]
): Edge | null {
  const outgoing = edges.filter(e => e.from === node.id);
  if (outgoing.length === 0) return null;

  // Step 1: condition-matching edges
  const condMatch = outgoing.filter(e => e.condition && evaluateCondition(e.condition, outcome, ctx));
  if (condMatch.length > 0) return condMatch[0];

  // Step 2: preferred_label match
  if (outcome.preferredLabel) {
    const normalize = (s: string) => s.toLowerCase().trim();
    const label = normalize(outcome.preferredLabel);
    const labelMatch = outgoing.find(e => !e.condition && e.label && normalize(e.label) === label);
    if (labelMatch) return labelMatch;
  }

  // Step 3: suggested next IDs
  if (outcome.suggestedNextIds?.length) {
    const suggested = outgoing.find(e => !e.condition && outcome.suggestedNextIds!.includes(e.to));
    if (suggested) return suggested;
  }

  // Step 4: highest weight among unconditional
  const unconditional = outgoing.filter(e => !e.condition);
  if (unconditional.length === 0) return null;
  unconditional.sort((a, b) => {
    const wa = a.weight ?? 0;
    const wb = b.weight ?? 0;
    if (wb !== wa) return wb - wa;
    return a.to.localeCompare(b.to);
  });
  return unconditional[0];
}

export async function runPipeline(graph: Graph, opts: EngineOptions): Promise<PipelineResult> {
  const handlers = buildHandlerMap(opts);
  const { nodes, edges } = graph;

  // Find start node
  const startNode = [...nodes.values()].find(n => n.shape === "Mdiamond" || n.id === "start" || n.id === "Start");
  if (!startNode) return { status: "fail", completedNodes: [], context: {}, failureReason: "No start node" };

  let currentNodeId = startNode.id;
  let completedNodes: string[] = [];
  let context: Record<string, unknown> = { "$goal": graph.goal ?? "" };
  if (opts.project) context["$project"] = opts.project;
  context["run_id"] = randomUUID();
  let nodeRetries: Record<string, number> = {};

  // Resume from checkpoint if requested
  if (opts.resume) {
    const cp = await loadCheckpoint(opts.logsRoot);
    if (cp) {
      currentNodeId = cp.currentNode;
      completedNodes = cp.completedNodes;
      context = { ...context, ...cp.context };
      nodeRetries = cp.nodeRetries;
    } else {
      console.warn("[ralph] --resume: no checkpoint found, starting from beginning");
    }
  }

  await mkdir(opts.logsRoot, { recursive: true });

  const isExitNode = (n: Node) => n.shape === "Msquare" || n.id === "exit" || n.id === "end";

  while (true) {
    if (opts.signal?.aborted) {
      return { status: "fail", completedNodes, context, failureReason: "Aborted" };
    }

    const node = nodes.get(currentNodeId);
    if (!node) {
      return { status: "fail", completedNodes, context, failureReason: `Node not found: ${currentNodeId}` };
    }

    if (isExitNode(node)) {
      // Goal gate enforcement: before allowing exit, verify all goal_gate=true nodes succeeded
      const goalGateNodes = [...nodes.values()].filter(n => n.goalGate === true);
      const unsatisfiedGates = goalGateNodes.filter(n => !completedNodes.includes(n.id));

      if (unsatisfiedGates.length > 0) {
        // Cascade through retry targets: node → node fallback → graph → graph fallback
        const firstUnsatisfied = unsatisfiedGates[0];
        const retryTarget = firstUnsatisfied.retryTarget
          ?? firstUnsatisfied.fallbackRetryTarget
          ?? graph.retryTarget
          ?? graph.fallbackRetryTarget;

        if (retryTarget && nodes.has(retryTarget)) {
          currentNodeId = retryTarget;
          continue;
        }

        const gateNames = unsatisfiedGates.map(n => n.id).join(", ");
        return {
          status: "fail",
          completedNodes,
          context,
          failureReason: `Goal gate(s) not satisfied: ${gateNames}`,
        };
      }

      if (!completedNodes.includes(node.id)) completedNodes = [...completedNodes, node.id];
      await saveCheckpoint(opts.logsRoot, {
        timestamp: new Date().toISOString(),
        currentNode: node.id,
        completedNodes,
        nodeRetries,
        context,
      });
      return { status: "success", completedNodes, context };
    }

    const handlerType = resolveHandlerType(node);
    const handler = handlers.get(handlerType);
    if (!handler) {
      return { status: "fail", completedNodes, context, failureReason: `No handler for type "${handlerType}"` };
    }

    opts.onNodeStart?.(node);

    // Gather outgoing labels for wait.human
    const outgoingLabels = edges.filter(e => e.from === node.id).map(e => e.label ?? e.to).filter(Boolean);

    const ctx: PipelineContext = { values: context };
    const meta: HandlerExecutionContext = {
      logsRoot: opts.logsRoot,
      cwd: opts.cwd,
      dotDir: opts.dotDir ?? opts.cwd,
      signal: opts.signal,
      outgoingLabels,
      completedNodes,
      nodeRetries,
      onStdout: opts.onStdout,
      onInteractiveRequest: opts.onInteractiveRequest,
      onIterationStart: opts.onIterationStart,
      onIterationEnd: opts.onIterationEnd,
      projectDir: opts.project,
    };
    let outcome: Outcome;
    try {
      outcome = await handler.execute(node, ctx, meta);
    } catch (err) {
      if (err instanceof UndefinedVariableError) {
        const pathTaken = [...completedNodes, node.id].join(" → ");
        const varDump = Object.entries(context)
          .map(([k, v]) => `  ${k} = ${v === undefined ? "<UNDEFINED>" : JSON.stringify(v)}`)
          .join("\n");
        const reason = [
          `Undefined variable $${err.variableName}`,
          `Node: ${node.id}`,
          `Path: ${pathTaken}`,
          `Variable context at failure:`,
          varDump,
        ].join("\n");
        opts.onNodeEnd?.(node, { status: "fail", failureReason: reason });
        return { status: "fail", completedNodes, context, failureReason: reason };
      }
      throw err; // re-throw non-variable errors
    }

    // Merge context updates
    if (outcome.contextUpdates) {
      context = { ...context, ...outcome.contextUpdates };
    }

    // Notify observers of the resolved outcome — but ONLY for terminal outcomes.
    // Intermediate retries `continue` the main loop below without re-firing
    // onNodeStart, so firing onNodeEnd here on a retry would leave the reducer
    // with an unbalanced end event.
    {
      const _maxRetries = node.maxRetries ?? graph.defaultMaxRetries ?? 0;
      const _retryCount = nodeRetries[node.id] ?? 0;
      const _willRetry =
        (outcome.status === "retry" ||
          (outcome.status === "fail" && _maxRetries > 0)) &&
        _retryCount < _maxRetries;
      if (!_willRetry) {
        opts.onNodeEnd?.(node, outcome);
      }
    }

    // Write status artifact
    const nodeDir = join(opts.logsRoot, node.id);
    await mkdir(nodeDir, { recursive: true });
    await writeFile(join(nodeDir, "status.json"), JSON.stringify(outcome, null, 2), "utf8");

    // Handle retry
    const maxRetries = node.maxRetries ?? graph.defaultMaxRetries ?? 0;
    if (outcome.status === "retry" || (outcome.status === "fail" && maxRetries > 0)) {
      const retryCount = nodeRetries[node.id] ?? 0;
      if (retryCount < maxRetries) {
        nodeRetries[node.id] = retryCount + 1;
        await saveCheckpoint(opts.logsRoot, { timestamp: new Date().toISOString(), currentNode: node.id, completedNodes, nodeRetries, context });
        continue;
      }
      // exhausted retries — check fallback
      const fallback = node.retryTarget ?? node.fallbackRetryTarget ?? graph.retryTarget ?? graph.fallbackRetryTarget;
      if (fallback && nodes.has(fallback)) {
        currentNodeId = fallback;
        continue;
      }
      return { status: "fail", completedNodes, context, failureReason: `Node "${node.id}" failed after ${maxRetries} retries` };
    }

    if (outcome.status === "fail") {
      // Before terminating, try to route through a conditioned fail-path edge.
      const failEdge = selectFailEdge(node, outcome, context, edges);
      if (!failEdge) {
        return { status: "fail", completedNodes, context, failureReason: outcome.failureReason ?? `Node "${node.id}" failed` };
      }
      if (!completedNodes.includes(node.id)) completedNodes = [...completedNodes, node.id];
      await saveCheckpoint(opts.logsRoot, { timestamp: new Date().toISOString(), currentNode: failEdge.to, completedNodes, nodeRetries, context });
      currentNodeId = failEdge.to;
      continue;
    }

    // Advance — deduplicate completedNodes (set semantics, not bag)
    if (!completedNodes.includes(node.id)) completedNodes = [...completedNodes, node.id];

    const nextEdge = selectNextEdge(node, outcome, context, edges);
    if (!nextEdge) {
      return { status: "fail", completedNodes, context, failureReason: `No outgoing edge from "${node.id}"` };
    }

    // loop_restart: reset traversal state but preserve accumulated context
    if (nextEdge.loopRestart) {
      completedNodes = [];
      nodeRetries = {};
      context["loop.iteration"] = String(Number(context["loop.iteration"] ?? "0") + 1);
      // Checkpoint the post-reset state so resume starts from the loop beginning
      await saveCheckpoint(opts.logsRoot, { timestamp: new Date().toISOString(), currentNode: startNode.id, completedNodes, nodeRetries, context });
      currentNodeId = startNode.id;
      continue;
    }

    // Normal advance — checkpoint records the NEXT node to execute
    await saveCheckpoint(opts.logsRoot, { timestamp: new Date().toISOString(), currentNode: nextEdge.to, completedNodes, nodeRetries, context });
    currentNodeId = nextEdge.to;
  }
}
