import { join, dirname } from "path";
import { JsonlPipelineTracer } from "../../../attractor/tracer/jsonl-pipeline-tracer.js";
import type { PipelineTracer } from "../../../attractor/tracer/pipeline-tracer.js";
import { validateOrRaise } from "../../../attractor/core/graph-validator.js";
import { runPipeline } from "../../../attractor/core/engine.js";
import {
  variableExpansionTransform,
  scanUndeclaredCallerVars,
  findVarReferences,
  expandVariables,
  extractDefaults,
} from "../../../attractor/transforms/variable-expansion.js";
import {
  formatMissingInputsError,
  formatLegacyMissingWarning,
  formatUndeclaredWarning,
} from "../../lib/preflight-format.js";
import { InkInterviewer } from "../../../attractor/interviewer/ink.js";
import { AutoApproveInterviewer } from "../../../attractor/interviewer/auto-approve.js";
import { newRunId, runsDir } from "../../lib/apparat-paths.js";
import { PassThrough } from "stream";
import { parseStreamJsonEvents, streamEvents } from "../../lib/stream-formatter.js";
import * as output from "../../lib/output.js";
import { loadFailureHandoff, renderFailureFooter } from "../../lib/failure-handoff.js";
import { renderPipelineApp } from "../../components/PipelineApp.js";
import { classifyNode } from "../../lib/classifyNode.js";
import { parseClaudeEvent } from "../../lib/parseClaudeEvent.js";
import { loadPipeline, PipelineLoadError, type LoadedPipeline } from "../pipeline-invocation.js";
import { gcOldRuns, resolveResumeLogsRoot } from "./runs-gc.js";

export interface PipelineRunOptions {
  project?: string;
  resume?: boolean | string;
  logsRoot?: string;
  runId?: string;
  /** Extra key=value pairs injected as $variable context for variableExpansionTransform */
  variables?: Record<string, string>;
}

export async function pipelineRunCommand(dotFile: string, opts: PipelineRunOptions = {}): Promise<void> {
  let loaded: LoadedPipeline;
  try {
    loaded = await loadPipeline(dotFile, { project: opts.project });
  } catch (err) {
    if (err instanceof PipelineLoadError) {
      if (err.kind === "not-found") {
        await output.error(`Dot file not found: ${err.absPath ?? dotFile}`);
      } else {
        await output.error(err.message);
      }
      process.exit(1);
    }
    throw err;
  }
  let graph = loaded.graph;
  const dotDir = dirname(loaded.absPath);
  const project = loaded.projectRoot;

  try { validateOrRaise(graph); }
  catch (err) {
    await output.error((err as Error).message);
    process.exit(1);
  }

  // $project preflight: if any node references $project, --project must be set.
  if (!opts.project) {
    const refs = findVarReferences(graph, "project");
    if (refs.length > 0) {
      process.stderr.write(
        `✗ [project_binding_missing] Pipeline references $project but --project flag not passed.\n` +
        `  Pass --project <folder>, not --var project=...\n` +
        `  Nodes referencing $project: ${refs.join(", ")}\n`
      );
      process.exit(1);
    }
  }

  // Pre-flight: scan for missing caller-supplied variables before expansion
  const preflight = scanUndeclaredCallerVars(graph, opts.variables ?? {});

  if (graph.inputs && preflight.declared.length > 0) {
    console.error(
      formatMissingInputsError({
        pipelineName: graph.name,
        declared: graph.inputs,
        provided: opts.variables ?? {},
        missing: preflight.declared.map((r) => r.name),
        invokedAs: dotFile,
      }),
    );
    process.exit(1);
  }

  if (!graph.inputs && preflight.missing.length > 0) {
    console.error(formatLegacyMissingWarning(preflight.missing.map((r) => r.name)));
    // continue — legacy pipelines without inputs= still run
  }

  if (graph.inputs && preflight.undeclared.length > 0) {
    console.error(formatUndeclaredWarning(preflight.undeclared.map((r) => r.name)));
    // continue — author oversight, not a caller-facing failure
  }

  graph = variableExpansionTransform(graph, {
    project: opts.project,
    context: opts.variables,
  });

  // Headless safety: refuse to run headless_safe=false pipelines without a TTY
  if (graph.headlessSafe === false && !process.stdin.isTTY) {
    await output.error(
      `This pipeline has headless_safe=false and cannot run without a TTY.\n` +
      `Run it interactively: apparat pipeline run ${dotFile}`
    );
    process.exit(1);
  }

  // Headless --project guard: cron/daemon invocations have no meaningful cwd,
  // so refuse rather than silently using process.cwd() as the project key.
  if (!process.stdin.isTTY && !opts.project) {
    process.stderr.write(
      "[apparat] Headless runs require --project; cwd is ambiguous when invoked from cron/daemon.\n",
    );
    process.exit(1);
  }

  const runId = newRunId();
  const runsRoot = runsDir(opts.project ?? process.cwd());
  if (!opts.resume) {
    const keep = Number(process.env.APPARAT_RUNS_KEEP ?? "50");
    gcOldRuns(runsRoot, Number.isFinite(keep) && keep > 0 ? keep : 50);
  }
  let logsRoot: string;
  if (opts.logsRoot) {
    logsRoot = opts.logsRoot;
  } else if (opts.resume) {
    const resolved = resolveResumeLogsRoot(runsRoot, opts.resume);
    // resolved === null means 0 prior runs; engine.ts handles "no checkpoint"
    // warning when --resume hits an empty logsRoot.
    logsRoot = resolved ?? join(runsRoot, runId);
  } else {
    logsRoot = join(runsRoot, runId);
  }
  const tracePath = join(logsRoot, "pipeline.jsonl");
  const jsonlTracer = new JsonlPipelineTracer(tracePath);
  let latestContext: Record<string, unknown> = {};

  const tracer: PipelineTracer = {
    onPipelineStart(meta) { jsonlTracer.onPipelineStart(meta); },
    onNodeStart(meta) {
      latestContext = meta.ctx.values;
      jsonlTracer.onNodeStart(meta);
    },
    onNodeEnd(meta) { jsonlTracer.onNodeEnd(meta); },
    onPipelineEnd(meta) { jsonlTracer.onPipelineEnd(meta); },
    onValidationFailure(meta) { jsonlTracer.onValidationFailure?.(meta); },
  };

  // Mount the new single-<Static> PipelineApp.
  const overviewNodeIds = [...graph.nodes.values()]
    .filter((n) => n.shape !== "Mdiamond" && n.shape !== "Msquare")
    .map((n) => n.id);

  const { callbacks, waitUntilExit } = await renderPipelineApp({
    pipelineName: graph.name,
    pid: process.pid,
    goal: graph.goal,
    nodes: overviewNodeIds,
    runId,
    tracePath,
  });
  const { emit, done } = callbacks;

  // Track whether the current node had a block emitted (so we can gate `end`
  // emission symmetrically). Marker nodes (start, exit) do NOT emit a block.
  let currentBlockNodeId: string | null = null;
  // ID of the node whose end was already synthesised by the signal handler.
  // Only that specific node is skipped in onNodeEnd; subsequent nodes are unaffected.
  let abortHandledFor: string | null = null;
  // Resolved by onSignal to unblock a hanging onInteractiveRequest promise.
  let interactiveResolve: (() => void) | null = null;
  // Stamps session.exitReason="abort" so the agent returns outcome=fail for routing.
  let markInteractiveAbort: (() => void) | null = null;
  // Immediately kills the interactive child so agent-handler doesn't wait 5s.
  let killInteractiveChild: (() => void) | null = null;

  let pipelineFailed = false;
  let lastFailedNodeId: string | null = null;
  let lastFailureReason: string | undefined;
  const ac = new AbortController();
  const onSignal = () => {
    if (currentBlockNodeId !== null) {
      emit({ kind: "end", outcome: { status: "abort", reason: "user-interrupt" } });
      abortHandledFor = currentBlockNodeId;
      currentBlockNodeId = null;
    }
    if (markInteractiveAbort !== null) markInteractiveAbort();
    if (killInteractiveChild !== null) killInteractiveChild();
    if (interactiveResolve !== null) {
      interactiveResolve();
      // Don't abort the engine — the fail-path edge (condition="outcome=fail") will
      // route to the recovery node. A second signal will abort since interactiveResolve
      // will be null by then.
    } else {
      ac.abort();
    }
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  try {
    const result = await runPipeline(graph, {
      logsRoot,
      runId,
      cwd: project,
      dotDir,
      interviewer: process.stdin.isTTY
        ? new InkInterviewer(callbacks.emit)
        : new AutoApproveInterviewer(),
      signal: ac.signal,
      project: opts.project,
      resume: Boolean(opts.resume),
      callerContext: opts.variables,
      traceWriter: tracer,

      onInteractiveRequest: ({ child, session }) =>
        new Promise<void>((resolve) => {
          interactiveResolve = resolve;
          markInteractiveAbort = () => { session.exitReason = "abort"; };
          killInteractiveChild = () => { child.kill("SIGTERM").catch(() => {}); };
          emit({ kind: "interactive-ready", child, onDone: resolve });
          if (child.sessionId) {
            emit({ kind: "trace-path", sessionId: child.sessionId });
          }
          // Pipe the child's event stream into the reducer.
          (async () => {
            try {
              let lastStopReason: string | undefined;
              for await (const raw of child.events) {
                if (raw.type === "result") {
                  lastStopReason = raw.stopReason;
                  if (raw.text) {
                    session.history.push({
                      role: "assistant",
                      text: raw.text,
                      toolCalls: [],
                      usage: raw.usage,
                      at: Date.now(),
                    });
                  }
                }
                for (const nev of parseClaudeEvent(raw)) emit(nev);
              }
              // Only set exitReason if it wasn't already set by markInteractiveAbort
              // (which sets "abort" when C-c is pressed — we must not overwrite it).
              if (session.exitReason === undefined) {
                session.exitReason = lastStopReason === "turn_limit" ? "turn_limit" : "user_end";
              }
              resolve();
            } catch (err) {
              if (abortHandledFor !== null) return;
              emit({
                kind: "end",
                outcome: { status: "fail", reason: `crash: ${(err as Error).message}` },
              });
              currentBlockNodeId = null;
            } finally {
              interactiveResolve = null;
              markInteractiveAbort = null;
            }
          })();
        }),

      onNodeStart: (node, { nodeReceiveId }) => {
        const blockKind = classifyNode(node);
        if (blockKind === "marker") return;
        currentBlockNodeId = node.id;
        const rawLabel = node.label ?? blockKind;
        let displayLabel = rawLabel;
        try {
          displayLabel = expandVariables(rawLabel, latestContext, extractDefaults(node as unknown as Record<string, unknown>));
        } catch {
          // Fall back to raw label if any $var is undefined — handler will surface the real error.
        }
        emit({
          kind: "start",
          nodeId: node.id,
          label: displayLabel,
          blockKind,
          nodeReceiveId,
          hasContext: Object.keys(latestContext).length > 0,
        });
      },

      onNodeEnd: (node, outcome) => {
        if (node.id === abortHandledFor) return;
        if (classifyNode(node) === "marker") return;
        // Engine OutcomeStatus is "success" | "retry" | "fail". Map to the
        // renderer's 3-value union (success/fail). Abort is only emitted by
        // the signal handler above, never by the engine itself.
        const status = outcome.status === "success" ? "success" as const : "fail" as const;
        emit({
          kind: "end",
          outcome: { status, reason: outcome.failureReason },
        });
        if (outcome.status !== "success" && outcome.failureReason) {
          lastFailedNodeId = node.id;
          lastFailureReason = outcome.failureReason;
        }
        currentBlockNodeId = null;
      },

      onIterationStart: (nodeId, iterationIndex) => {
        emit({
          kind: "start",
          nodeId,
          label: `agent · iteration ${iterationIndex + 1}`,
          blockKind: "agent",
        });
      },

      onIterationEnd: (_nodeId, _iterationIndex) => {
        emit({
          kind: "end",
          outcome: { status: "success" },
        });
        currentBlockNodeId = null;
      },

      onValidationRetryStart: (nodeId, attempt) => {
        emit({
          kind: "start",
          nodeId,
          label: `agent · validation retry ${attempt - 1}`,
          blockKind: "agent",
        });
      },

      onStdout: async (stdout) => {
        const statsStream = new PassThrough();
        const renderStream = new PassThrough();
        stdout.pipe(statsStream);
        stdout.pipe(renderStream);
        await Promise.all([
          (async () => {
            for await (const raw of parseStreamJsonEvents(statsStream)) {
              for (const nev of parseClaudeEvent(raw)) {
                if (nev.kind === "stats" || nev.kind === "trace-path") emit(nev);
              }
            }
          })(),
          (async () => {
            for await (const ev of streamEvents(renderStream)) {
              emit({ kind: "stream-line", event: ev });
            }
          })(),
        ]);
      },
    });

    if (result.status !== "success" && abortHandledFor === null && currentBlockNodeId !== null) {
      emit({
        kind: "end",
        outcome: { status: "fail", reason: result.failureReason ?? "pipeline failed" },
      });
      currentBlockNodeId = null;
    }
    if (result.status !== "success") {
      pipelineFailed = true;
    }
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    await new Promise((resolve) => setImmediate(resolve));

    let handoff: ReturnType<typeof loadFailureHandoff> | null = null;
    if (pipelineFailed && lastFailedNodeId) {
      handoff = loadFailureHandoff({
        tracePath,
        failedNodeId: lastFailedNodeId,
        failureReason: lastFailureReason ?? "pipeline failed",
        dotFile,
        dotDir,
        runId,
        graph,
      });
      emit({ kind: "failure-handoff", handoff });
    }

    done();
    await waitUntilExit();

    if (pipelineFailed) {
      if (handoff) {
        process.stderr.write(renderFailureFooter(handoff));
      }
      process.exit(1);
    }
  }
}
