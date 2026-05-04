import { readFileSync, writeFileSync, existsSync, readdirSync, rmSync, lstatSync } from "fs";
import { resolve, join, basename, dirname, relative } from "path";
import { randomUUID } from "crypto";
import { JsonlPipelineTracer } from "../../attractor/tracer/jsonl-pipeline-tracer.js";
import type { PipelineTracer } from "../../attractor/tracer/pipeline-tracer.js";
import { parseDot, validateGraph, validateOrRaise } from "../../attractor/core/graph.js";
import type { Graph } from "../../attractor/types.js";
import { runPipeline } from "../../attractor/core/engine.js";
import { variableExpansionTransform, scanUndeclaredCallerVars, findVarReferences, expandVariables, extractDefaults } from "../../attractor/transforms/variable-expansion.js";
import {
  formatMissingInputsError,
  formatLegacyMissingWarning,
  formatUndeclaredWarning,
} from "../lib/preflight-format.js";
import { InkInterviewer } from "../../attractor/interviewer/ink.js";
import { AutoApproveInterviewer } from "../../attractor/interviewer/auto-approve.js";
import { getPipelinesDir, resolvePipelineArg, isNameShorthand } from "../lib/pipeline-resolver.js";
import { runDir, runsDir } from "../lib/ralph-paths.js";
import { PassThrough } from "stream";
import { parseStreamJsonEvents, streamEvents } from "../lib/stream-formatter.js";
import * as output from "../lib/output.js";
import { formatPipelineDiag } from "../lib/pipeline-diag-format.js";
import type { Diagnostic } from "../../attractor/types.js";
import { DotSyntaxError } from "../../attractor/core/dot-syntax.js";
import { renderPipelineApp } from "../components/PipelineApp.js";
import { classifyNode } from "../lib/classifyNode.js";
import { parseClaudeEvent } from "../lib/parseClaudeEvent.js";
import { annotateDotForShow } from "../lib/annotate-show.js";

export interface PipelineRunOptions {
  project?: string;
  resume?: boolean | string;
  logsRoot?: string;
  /** Extra key=value pairs injected as $variable context for variableExpansionTransform */
  variables?: Record<string, string>;
}

export interface PipelineValidateOptions {
  project?: string;
  /** When supplied, diff edge labels against this previous graph and emit
   *  a warning (or error if the renamed label is still referenced). */
  previousGraph?: Graph;
}

interface EdgeDiagnostic { severity: "warning" | "error"; message: string }


/**
 * Resolve the target logsRoot for a `--resume` invocation.
 *  - resume === string: that exact runId. Error if dir is missing.
 *  - resume === true:
 *      0 runs → return null and let the engine warn-and-start-fresh path run.
 *      1 run  → auto-select.
 *      N>1    → print list + exit 1.
 */
export function resolveResumeLogsRoot(
  runsRoot: string,
  resume: true | string,
): string | null {
  if (typeof resume === "string") {
    const dir = join(runsRoot, resume);
    if (!existsSync(dir)) {
      process.stderr.write(`[ralph] --resume ${resume}: run dir not found: ${dir}\n`);
      process.exit(1);
    }
    return dir;
  }
  if (!existsSync(runsRoot)) return null;
  const entries: { name: string; path: string; mtime: number }[] = [];
  for (const name of readdirSync(runsRoot)) {
    const path = join(runsRoot, name);
    try {
      const st = lstatSync(path);
      if (!st.isDirectory()) continue;
      entries.push({ name, path, mtime: st.mtimeMs });
    } catch { continue; }
  }
  if (entries.length === 0) return null;
  if (entries.length === 1) return entries[0].path;
  entries.sort((a, b) => b.mtime - a.mtime);
  const list = entries
    .map(e => `  ${e.name}  (${new Date(e.mtime).toISOString()})`)
    .join("\n");
  process.stderr.write(
    "[ralph] multiple runs exist for this project; pass --resume <runId> to disambiguate:\n" + list + "\n",
  );
  process.exit(1);
  return null;
}

/**
 * Garbage-collect a project's runs directory: keep the `keep` newest entries
 * by mtime, recursively remove the rest. Silently ignores non-existent roots
 * and non-directory children. Pure I/O — exported for tests.
 */
export function gcOldRuns(runsRoot: string, keep: number): void {
  if (!existsSync(runsRoot)) return;
  const entries: { path: string; mtime: number }[] = [];
  for (const name of readdirSync(runsRoot)) {
    const path = join(runsRoot, name);
    try {
      const st = lstatSync(path);
      if (!st.isDirectory()) continue;
      entries.push({ path, mtime: st.mtimeMs });
    } catch { continue; }
  }
  entries.sort((a, b) => b.mtime - a.mtime);
  for (const e of entries.slice(keep)) {
    rmSync(e.path, { recursive: true, force: true });
  }
}


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

export async function pipelineValidateCommand(dotFile: string, opts: PipelineValidateOptions = {}): Promise<number> {
  const project = resolve(opts.project ?? process.cwd());
  const absPath = isNameShorthand(dotFile)
    ? resolvePipelineArg(dotFile, project)
    : resolve(dotFile);
  if (!existsSync(absPath)) {
    await output.error(`Dot file not found: ${absPath}`);
    return 1;
  }
  let src: string;
  try { src = readFileSync(absPath, "utf8"); }
  catch { await output.error(`Cannot read file: ${absPath}`); return 1; }

  const relPath = relative(process.cwd(), absPath) || absPath;
  const formatDiag = (d: Diagnostic) => formatPipelineDiag(d, src, relPath);

  let graph: Graph;
  try { graph = parseDot(src); }
  catch (e) {
    if (e instanceof DotSyntaxError) {
      const diag: Diagnostic = {
        rule: "syntax",
        severity: "error",
        message: e.message,
        location: e.location,
      };
      await output.error(formatDiag(diag));
      return 1;
    }
    throw e;
  }
  const diags = validateGraph(graph, dirname(absPath));
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


export async function pipelineRunCommand(dotFile: string, opts: PipelineRunOptions = {}): Promise<void> {
  const project = opts.project ? resolve(opts.project) : process.cwd();
  const absPath = isNameShorthand(dotFile)
    ? resolvePipelineArg(dotFile, project)
    : resolve(dotFile);
  if (!existsSync(absPath)) {
    await output.error(`Dot file not found: ${absPath}`);
    process.exit(1);
  }

  const src = readFileSync(absPath, "utf8");
  const dotDir = dirname(absPath);
  let graph = parseDot(src);

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
      `Run it interactively: ralph pipeline run ${dotFile}`
    );
    process.exit(1);
  }

  // Headless --project guard: cron/daemon invocations have no meaningful cwd,
  // so refuse rather than silently using process.cwd() as the project key.
  if (!process.stdin.isTTY && !opts.project) {
    process.stderr.write(
      "[ralph] Headless runs require --project; cwd is ambiguous when invoked from cron/daemon.\n",
    );
    process.exit(1);
  }

  const runId = randomUUID().slice(0, 8);
  const runsRoot = runsDir(opts.project ?? process.cwd());
  if (!opts.resume) {
    const keep = Number(process.env.RALPH_RUNS_KEEP ?? "50");
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
        // Engine OutcomeStatus is "success"|"retry"|"fail"|"partial_success".
        // Map to the renderer's 3-value union. Abort is only emitted by
        // the signal handler above, never by the engine itself.
        const status = outcome.status === "success" ? "success" as const : "fail" as const;
        emit({
          kind: "end",
          outcome: {
            status,
            reason: outcome.failureReason ?? (outcome.status === "partial_success" ? "partial success" : undefined),
          },
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
    done();
    await waitUntilExit();
    if (pipelineFailed) {
      if (lastFailedNodeId) {
        const firstLine = (lastFailureReason ?? "pipeline failed").split("\n")[0].slice(0, 500);
        process.stderr.write(`✗ pipeline failed at node ${lastFailedNodeId}: ${firstLine}\n`);
        process.stderr.write(`  trace: ${tracePath}\n`);
      }
      process.exit(1);
    }
  }
}

export interface PipelineListOptions {
  project?: string;
}

export async function pipelineListCommand(opts: PipelineListOptions = {}): Promise<void> {
  const project = resolve(opts.project ?? process.cwd());
  const pipelinesDir = getPipelinesDir(project);

  if (!existsSync(pipelinesDir)) {
    await output.info(`No pipelines/ folder found in ${project}.\nCreate one with: ralph pipeline create <name> --project ${project}`);
    return;
  }

  const dotFiles = readdirSync(pipelinesDir).filter(f => f.endsWith(".dot"));

  if (dotFiles.length === 0) {
    await output.info(`No workflows found in ${pipelinesDir}.\nCreate one with: ralph pipeline create <name> --project ${project}`);
    return;
  }

  await output.info(`Pipelines in ${pipelinesDir}/`);
  for (const file of dotFiles.sort()) {
    const name = basename(file, ".dot");
    const absFile = join(pipelinesDir, file);
    let goal = "(no goal defined)";
    let requires: string[] | undefined;
    try {
      const src = readFileSync(absFile, "utf8");
      const graph = parseDot(src);
      if (graph.goal) goal = `"${graph.goal}"`;
      if (graph.inputs && graph.inputs.length > 0) requires = graph.inputs;
    } catch {
      goal = "(unreadable)";
    }
    await output.info(`  ${name.padEnd(20)} ${goal}`);
    if (requires) await output.info(`  ${"".padEnd(20)} requires: ${requires.join(", ")}`);
  }
}

export async function pipelineTraceCommand(
  runId: string,
  opts: { nodeReceive?: string; full?: boolean; project?: string } = {}
): Promise<void> {
  const project = resolve(opts.project ?? process.cwd());
  const tracePath = join(runDir(project, runId), "pipeline.jsonl");
  if (!existsSync(tracePath)) {
    await output.error(`No trace found for run: ${runId}`);
    await output.error(`Expected: ${tracePath}`);
    process.exit(1);
    return;
  }

  let raw: string;
  try {
    raw = readFileSync(tracePath, "utf-8");
  } catch {
    await output.error(`No trace found for run: ${runId}`);
    await output.error(`Expected: ${tracePath}`);
    process.exit(1);
    return;
  }

  const lines = raw.trim().split("\n").map(l => JSON.parse(l) as Record<string, unknown>);

  if (opts.nodeReceive) {
    const event = lines.find(
      l => l.kind === "node-start" && l.nodeReceiveId === opts.nodeReceive
    );
    if (!event) {
      await output.error(`No node-start event found for: ${opts.nodeReceive}`);
      process.exit(1);
      return;
    }
    const snapshot = (event.contextSnapshot as Record<string, unknown>) ?? {};
    const keys = Object.keys(snapshot);

    const thisIdx = lines.indexOf(event);
    const completedStages = lines
      .slice(0, thisIdx)
      .filter(l => l.kind === "node-end" && l.success === true)
      .map(l => String(l.nodeId));

    console.log(`\nnode:     ${event.nodeId}`);
    console.log(`kind:     ${event.nodeKind}`);
    console.log(`received: ${event.timestamp}`);
    console.log(`\ncontext snapshot (${keys.length} key${keys.length === 1 ? "" : "s"}):`);
    if (keys.length === 0) {
      console.log("  (empty — first node)");
    } else {
      const maxLen = Math.max(...keys.map(k => k.length));
      for (const key of keys) {
        const val = JSON.stringify(snapshot[key]);
        if (opts.full || val.length <= 80) {
          console.log(`  ${key.padEnd(maxLen + 2)}${val}`);
        } else {
          console.log(`  ${key}`);
          console.log(`    ${val}`);
        }
      }
    }
    const failures = lines.filter(l =>
      l.kind === "validation-failure" && l.nodeReceiveId === opts.nodeReceive,
    );
    if (failures.length > 0) {
      console.log(`\nvalidation attempts:`);
      for (const f of failures as Array<Record<string, unknown>>) {
        const errs = (f.errors as Array<{ path: string; message: string }>)
          .map(e => `${e.path}: ${e.message}`)
          .join(", ");
        console.log(`  [${f.attempt}] ✗ failed — ${errs}`);
        console.log(`      raw: ${f.rawOutputPath}`);
      }
    }
    console.log(`\ncompleted stages: ${completedStages.length > 0 ? completedStages.join(" · ") : "(none)"}`);
    console.log();
    return;
  }

  // List all node invocations
  const pipelineEnd = lines.find(l => l.kind === "pipeline-end");
  const nodeStarts = lines.filter(l => l.kind === "node-start");
  const nodeEnds = lines.filter(l => l.kind === "node-end") as Array<Record<string, unknown>>;

  console.log(`\nrun:     ${runId}`);
  console.log(`outcome: ${pipelineEnd?.outcome ?? "in-progress"}`);
  console.log("nodes:");

  for (const ns of nodeStarts) {
    const ne = nodeEnds.find(e => e.nodeReceiveId === ns.nodeReceiveId);
    const snapshot = (ns.contextSnapshot as Record<string, unknown>) ?? {};
    const ctxKeys = Object.keys(snapshot);
    const ctxDisplay = ctxKeys.length === 0
      ? "{}"
      : `{${ctxKeys.slice(0, 3).join(", ")}${ctxKeys.length > 3 ? ", ..." : ""}}`;
    const status = ne ? (ne.success ? "✓" : "✗") : "…";
    console.log(`  ${String(ns.nodeReceiveId).padEnd(20)} ${String(ns.nodeId).padEnd(12)} ${String(ns.nodeKind).padEnd(18)} ${status}  ctx: ${ctxDisplay}`);
  }
  console.log();
}

export interface PipelineShowOptions {
  /** Project folder used for name-shorthand resolution (mirrors validate/run). */
  project?: string;
}

async function renderDotToSvg(dotSrc: string): Promise<string> {
  const { Graphviz } = await import("@hpcc-js/wasm-graphviz");
  const gv = await Graphviz.load();
  return gv.dot(dotSrc);
}

export async function pipelineShowCommand(
  dotFile: string,
  opts: PipelineShowOptions = {},
): Promise<number> {
  const project = resolve(opts.project ?? process.cwd());
  const absPath = isNameShorthand(dotFile)
    ? resolvePipelineArg(dotFile, project)
    : resolve(dotFile);

  if (!existsSync(absPath)) {
    await output.error(`Dot file not found: ${absPath}`);
    return 1;
  }

  let src: string;
  try { src = readFileSync(absPath, "utf8"); }
  catch { await output.error(`Cannot read file: ${absPath}`); return 1; }

  const relPath = relative(process.cwd(), absPath) || absPath;
  const formatDiag = (d: Diagnostic) => formatPipelineDiag(d, src, relPath);

  let graph: Graph;
  try { graph = parseDot(src); }
  catch (e) {
    if (e instanceof DotSyntaxError) {
      const diag: Diagnostic = {
        rule: "syntax",
        severity: "error",
        message: e.message,
        location: e.location,
      };
      await output.error(formatDiag(diag));
      return 1;
    }
    throw e;
  }

  const diags = validateGraph(graph, dirname(absPath));
  const errors = diags.filter(d => d.severity === "error");
  for (const w of diags.filter(d => d.severity === "warning")) await output.warn(formatDiag(w));
  for (const e of errors) await output.error(formatDiag(e));
  if (errors.length > 0) return 1;

  const annotated = annotateDotForShow(src, dirname(absPath));
  let svg: string;
  try {
    svg = await renderDotToSvg(annotated);
  } catch (err) {
    await output.error(`graphviz render failed: ${(err as Error).message}`);
    return 1;
  }

  const svgPath = join(dirname(absPath), basename(absPath, ".dot") + ".svg");
  try {
    writeFileSync(svgPath, svg);
  } catch (err) {
    await output.error(`Failed to write ${svgPath}: ${(err as Error).message}`);
    return 1;
  }

  await output.success(
    `Wrote ${relative(process.cwd(), svgPath) || svgPath} ` +
    `(${graph.nodes.size} nodes, ${graph.edges.length} edges)`,
  );
  return 0;
}
