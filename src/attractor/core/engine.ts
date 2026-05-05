import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { randomUUID, randomBytes } from "crypto";
import type { Graph, Node, Edge, Outcome, PipelineContext } from "../types.js";
import type { Interviewer } from "../interviewer/index.js";
import { evaluateCondition } from "./conditions.js";
import { resolveHandlerType } from "./graph.js";
import { saveCheckpoint, loadCheckpoint } from "../checkpoint.js";
import { StartHandler, ExitHandler } from "../handlers/start-exit.js";
import { WaitHumanHandler } from "../handlers/wait-human.js";
import { ToolHandler } from "../handlers/tool.js";
import { RalphMeditateHandler } from "../handlers/ralph-meditate.js";
import { InteractiveAgentHandler } from "../handlers/interactive-agent-handler.js";
import { LoopingAgentHandler } from "../handlers/looping-agent-handler.js";
import { AgentHandlerDispatch } from "../handlers/agent-dispatch.js";
import { StoreHandler } from "../handlers/store.js";
import { UndefinedVariableError } from "../transforms/variable-expansion.js";
import type { NodeHandler, HandlerExecutionContext, OnInteractiveRequest } from "../handlers/registry.js";

export interface EngineOptions {
  logsRoot: string;
  /**
   * Optional caller-supplied run identifier. When present, the engine seeds
   * `context["run_id"]` with this value instead of generating its own. Used by
   * the CLI (src/cli/commands/pipeline.ts) so the `$run_id` agents observe is
   * identical to the on-disk run-dir basename. When absent, the engine falls
   * back to `randomUUID().slice(0, 8)` — same shape as the CLI's id.
   */
  runId?: string;
  cwd: string;
  interviewer: Interviewer;
  signal?: AbortSignal;
  project?: string;
  /** Caller-supplied variables from --var flags; seeded into pipeline context at start. */
  callerContext?: Record<string, unknown>;
  resume?: boolean;
  dotDir?: string;
  onNodeStart?: (node: Node, meta: { nodeReceiveId: string }) => void;
  onStdout?: (stdout: NodeJS.ReadableStream) => Promise<void>;
  onInteractiveRequest?: OnInteractiveRequest;
  onIterationStart?: (nodeId: string, iterationIndex: number) => void;
  onIterationEnd?: (nodeId: string, iterationIndex: number) => void;
  onValidationRetryStart?: (nodeId: string, attempt: number) => void;
  onNodeEnd?: (node: Node, outcome: Outcome) => void;
  traceWriter?: import("../tracer/pipeline-tracer.js").PipelineTracer;
}

export interface PipelineResult {
  status: "success" | "fail";
  completedNodes: string[];
  context: Record<string, unknown>;
  failureReason?: string;
}

function buildHandlerMap(opts: EngineOptions): Map<string, NodeHandler> {
  const m = new Map<string, NodeHandler>();
  const interactiveAgent = new InteractiveAgentHandler();
  const loopingAgent = new LoopingAgentHandler();
  const agentDispatch = new AgentHandlerDispatch(interactiveAgent, loopingAgent);
  m.set("start", new StartHandler());
  m.set("exit", new ExitHandler());
  m.set("codergen", agentDispatch);
  m.set("wait.human", new WaitHumanHandler(opts.interviewer, opts.dotDir));
  m.set("tool", new ToolHandler());
  m.set("ralph.implement", agentDispatch);
  m.set("ralph.meditate", new RalphMeditateHandler());
  m.set("store", new StoreHandler());
  m.set("agent", agentDispatch);
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

function finalize(result: PipelineResult, opts: EngineOptions, runId: string): PipelineResult {
  opts.traceWriter?.onPipelineEnd({
    runId,
    outcome: result.status === "success" ? "success" : "failure",
  });
  return result;
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
  if (opts.project) {
    // Store bare `project` so auto-inputs agents can declare it in inputs:.
    // Keep `$project` for backward-compat with any legacy ctx readers.
    context.project = opts.project;
    context["$project"] = opts.project;
  }
  if (opts.callerContext) context = { ...context, ...opts.callerContext };
  const runId = opts.runId ?? randomUUID().slice(0, 8);
  context["run_id"] = runId;
  opts.traceWriter?.onPipelineStart({ runId, graph, ctx: { values: context } });
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
      return finalize({ status: "fail", completedNodes, context, failureReason: "Aborted" }, opts, runId);
    }

    const node = nodes.get(currentNodeId);
    if (!node) {
      return finalize({ status: "fail", completedNodes, context, failureReason: `Node not found: ${currentNodeId}` }, opts, runId);
    }

    const nodeReceiveId = `${node.id}-${randomBytes(2).toString("hex")}`;
    opts.traceWriter?.onNodeStart({ nodeReceiveId, node, ctx: { values: context } });
    opts.onNodeStart?.(node, { nodeReceiveId });

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
        return finalize({
          status: "fail",
          completedNodes,
          context,
          failureReason: `Goal gate(s) not satisfied: ${gateNames}`,
        }, opts, runId);
      }

      if (!completedNodes.includes(node.id)) completedNodes = [...completedNodes, node.id];
      await saveCheckpoint(opts.logsRoot, {
        timestamp: new Date().toISOString(),
        currentNode: node.id,
        completedNodes,
        nodeRetries,
        context,
      });
      opts.traceWriter?.onNodeEnd({ nodeReceiveId, node, outcome: { status: "success" } });
      return finalize({ status: "success", completedNodes, context }, opts, runId);
    }

    const handlerType = resolveHandlerType(node);
    let handler: NodeHandler | undefined;
    if (handlerType !== "conditional") {
      handler = handlers.get(handlerType);
      if (!handler) {
        return finalize({ status: "fail", completedNodes, context, failureReason: `No handler for type "${handlerType}"` }, opts, runId);
      }
    }

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
      onValidationFailure: (args) => {
        opts.traceWriter?.onValidationFailure?.({
          nodeReceiveId,
          node,
          attempt: args.attempt,
          errors: args.errors,
          rawOutputPath: args.rawOutputPath,
        });
      },
      onValidationRetryStart: opts.onValidationRetryStart,
      projectDir: opts.project,
    };
    let outcome: Outcome;
    if (handlerType === "conditional") {
      outcome = { status: "success" };
    } else {
      try {
        outcome = await handler!.execute(node, ctx, meta);
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
          opts.traceWriter?.onNodeEnd({ nodeReceiveId, node, outcome: { status: "fail", failureReason: reason } });
          opts.onNodeEnd?.(node, { status: "fail", failureReason: reason });
          return finalize({ status: "fail", completedNodes, context, failureReason: reason }, opts, runId);
        }
        throw err;
      }
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
        opts.traceWriter?.onNodeEnd({ nodeReceiveId, node, outcome });
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
      return finalize({ status: "fail", completedNodes, context, failureReason: `Node "${node.id}" failed after ${maxRetries} retries` }, opts, runId);
    }

    if (outcome.status === "fail") {
      // Before terminating, try to route through a conditioned fail-path edge.
      const failEdge = selectFailEdge(node, outcome, context, edges);
      if (!failEdge) {
        return finalize({ status: "fail", completedNodes, context, failureReason: outcome.failureReason ?? `Node "${node.id}" failed` }, opts, runId);
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
      return finalize({ status: "fail", completedNodes, context, failureReason: `No outgoing edge from "${node.id}"` }, opts, runId);
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
