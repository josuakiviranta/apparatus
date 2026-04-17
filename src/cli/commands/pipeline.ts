import { readFileSync, existsSync, readdirSync, mkdirSync, rmSync, statSync } from "fs";
import { resolve, join, basename, dirname } from "path";
import { homedir } from "os";
import { randomUUID } from "crypto";
import { JsonlPipelineTracer } from "../../attractor/tracer/jsonl-pipeline-tracer.js";
import type { PipelineTracer } from "../../attractor/tracer/pipeline-tracer.js";
import { parseDot, validateGraph, validateOrRaise } from "../../attractor/core/graph.js";
import type { Graph } from "../../attractor/types.js";
import { runPipeline } from "../../attractor/core/engine.js";
import { variableExpansionTransform, scanUndeclaredCallerVars } from "../../attractor/transforms/variable-expansion.js";
import {
  formatMissingInputsError,
  formatLegacyMissingWarning,
  formatUndeclaredWarning,
} from "../lib/preflight-format.js";
import { InkInterviewer } from "../../attractor/interviewer/ink.js";
import { AutoApproveInterviewer } from "../../attractor/interviewer/auto-approve.js";
import { getPipelinesDir, resolvePipelineArg, isNameShorthand } from "../lib/pipeline-resolver.js";
import { spawnSync } from "child_process";
import { PassThrough } from "stream";
import { parseStreamJsonEvents, streamEvents } from "../lib/stream-formatter.js";
import { composeCreatePrompt } from "../lib/pipeline-create-prompt.js";
import { runTwoPhaseClaudeSession } from "../lib/session.js";
import * as output from "../lib/output.js";
import { renderPipelineApp } from "../components/PipelineApp.js";
import { classifyNode } from "../lib/classifyNode.js";
import { parseClaudeEvent } from "../lib/parseClaudeEvent.js";

export interface PipelineRunOptions {
  project?: string;
  resume?: boolean;
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

  const graph = parseDot(src);
  const diags = validateGraph(graph);
  const errors   = diags.filter(d => d.severity === "error");
  const warnings = diags.filter(d => d.severity === "warning");

  for (const w of warnings) await output.warn(`[${w.rule}] ${w.message}`);
  for (const e of errors)   await output.error(`[${e.rule}] ${e.message}`);

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
  catch (err) { await output.error((err as Error).message); process.exit(1); }

  // Pre-flight: scan for missing caller-supplied variables before expansion
  const preflight = scanUndeclaredCallerVars(graph, opts.variables ?? {});

  if (graph.inputs && preflight.declared.length > 0) {
    console.error(
      formatMissingInputsError({
        pipelineName: graph.name,
        declared: graph.inputs,
        provided: opts.variables ?? {},
        missing: preflight.declared,
        invokedAs: dotFile,
      }),
    );
    process.exit(1);
  }

  if (!graph.inputs && preflight.missing.length > 0) {
    console.error(formatLegacyMissingWarning(preflight.missing));
    // continue — legacy pipelines without inputs= still run
  }

  if (graph.inputs && preflight.undeclared.length > 0) {
    console.error(formatUndeclaredWarning(preflight.undeclared));
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

  const slug = graph.name.replace(/\s+/g, "-").toLowerCase();
  const logsRoot = opts.logsRoot ?? join(homedir(), ".ralph", "runs", slug);

  // For fresh runs (not --resume), clean any previous run directory
  if (!opts.resume && existsSync(logsRoot) && !opts.logsRoot) {
    rmSync(logsRoot, { recursive: true, force: true });
  }

  const runId = randomUUID().slice(0, 8);
  const tracePath = join(homedir(), ".ralph", "runs", runId, "pipeline.jsonl");
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
      resume: opts.resume,
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
        emit({
          kind: "start",
          nodeId: node.id,
          label: node.label ?? blockKind,
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
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    await new Promise((resolve) => setImmediate(resolve));
    done();
    await waitUntilExit();
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

export interface PipelineCreateOptions {
  project?: string;
}

export const REFINE_TRACE_COUNT = 3;

/**
 * Return absolute paths to up to `limit` most recent trace files for pipeline `name`,
 * newest first. Scans `tracesRoot` (default `~/.ralph/runs`) for `<runId>/pipeline.jsonl`
 * entries whose first event is `pipeline-start` with matching `pipelineName`.
 */
export function listRecentTraces(
  name: string,
  limit: number,
  opts: { tracesRoot?: string } = {},
): string[] {
  const root = opts.tracesRoot ?? join(homedir(), ".ralph", "runs");
  if (!existsSync(root)) return [];
  const entries: { path: string; mtime: number }[] = [];
  for (const entry of readdirSync(root)) {
    const tracePath = join(root, entry, "pipeline.jsonl");
    if (!existsSync(tracePath)) continue;
    try {
      const firstLine = readFileSync(tracePath, "utf8").split("\n", 1)[0];
      if (!firstLine) continue;
      const start = JSON.parse(firstLine) as Record<string, unknown>;
      if (start.kind !== "pipeline-start") continue;
      if (start.pipelineName !== name) continue;
      entries.push({ path: tracePath, mtime: statSync(tracePath).mtimeMs });
    } catch {
      continue;
    }
  }
  return entries.sort((a, b) => b.mtime - a.mtime).slice(0, limit).map(e => e.path);
}

/** Read a pipeline trace file and return a compact, human-readable digest string. */
export function digestTraceFile(tracePath: string): string {
  let raw: string;
  try { raw = readFileSync(tracePath, "utf8"); }
  catch { return `Trace: ${tracePath}\n(unreadable)`; }
  const lines = raw.trim().split("\n").flatMap(l => {
    try { return [JSON.parse(l) as Record<string, unknown>]; } catch { return []; }
  });
  const start = lines.find(l => l.kind === "pipeline-start") ?? {};
  const end = lines.find(l => l.kind === "pipeline-end") ?? {};
  const nodeEnds = lines.filter(l => l.kind === "node-end");
  const succeeded = nodeEnds.filter(e => e.success === true).map(e => String(e.nodeId));
  const failed    = nodeEnds.filter(e => e.success === false).map(e => String(e.nodeId));
  const outcome = (end.outcome as string | undefined) ?? "in-progress";
  const startedAt = (start.timestamp as string | undefined) ?? "unknown";
  return [
    `Trace: ${tracePath}`,
    `Started: ${startedAt}`,
    `Outcome: ${outcome}`,
    `Succeeded (${succeeded.length}): ${succeeded.join(", ") || "none"}`,
    failed.length > 0 ? `Failed (${failed.length}): ${failed.join(", ")}` : "",
  ].filter(Boolean).join("\n");
}

export async function pipelineTraceCommand(
  runId: string,
  opts: { nodeReceive?: string; full?: boolean } = {}
): Promise<void> {
  const tracePath = join(homedir(), ".ralph", "runs", runId, "pipeline.jsonl");

  let raw: string;
  try {
    raw = readFileSync(tracePath, "utf-8");
  } catch {
    await output.error(`No trace found for run: ${runId}`);
    await output.error(`Expected: ${tracePath}`);
    process.exit(1);
    return; // unreachable, satisfies TS
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

export async function pipelineCreateCommand(name: string, opts: PipelineCreateOptions = {}): Promise<void> {
  const which = spawnSync("which", ["claude"], { encoding: "utf8" });
  if (which.status !== 0) {
    await output.error("Error: claude CLI not found.\nInstall it: npm install -g @anthropic-ai/claude-code");
    process.exit(1);
  }

  const project = resolve(opts.project ?? process.cwd());
  const pipelinesDir = getPipelinesDir(project);
  const dotPath = join(pipelinesDir, `${name}.dot`);

  // Validate name via resolvePipelineArg (checks alphanumeric/hyphens/underscores)
  try {
    resolvePipelineArg(name, project);
  } catch (err) {
    await output.error((err as Error).message);
    process.exit(1);
  }

  // Conflict check
  if (existsSync(dotPath)) {
    await output.error(
      `Pipeline already exists: ${dotPath}\n` +
        `Use 'ralph pipeline refine ${name}' to modify it, ` +
        `or delete the file first to start over.`,
    );
    process.exit(1);
  }

  // Create pipelines/ dir
  if (!existsSync(pipelinesDir)) {
    try {
      mkdirSync(pipelinesDir, { recursive: true });
    } catch (err) {
      await output.error(`Failed to create pipelines/ directory: ${(err as Error).message}`);
      process.exit(1);
    }
  }

  // Read prompt (with dynamically injected project agents)
  const promptContent = composeCreatePrompt(project);

  const trigger = `${promptContent}\n\n---\nCreate a new pipeline named "${name}". Write it to: ${dotPath}`;

  await output.step(`Creating pipeline: ${name}`);
  await output.step(`Target: ${dotPath}`);

  const { exitCode } = await runTwoPhaseClaudeSession({ cwd: project, trigger });

  if (exitCode !== 0) {
    process.exit(exitCode);
  }

  if (!existsSync(dotPath)) {
    await output.warn(`Session ended but ${dotPath} was not created.`);
    process.exit(1);
  }

  await output.step("Validating pipeline...");
  const validateExit = await pipelineValidateCommand(dotPath);
  process.exit(validateExit);
}


export interface PipelineRefineOptions {
  project?: string;
  /** When false, skip recent-trace injection. Default true. */
  traces?: boolean;
  /** Override the trace search root (default: `~/.ralph/runs`). */
  tracesRoot?: string;
}

export async function pipelineRefineCommand(name: string, opts: PipelineRefineOptions = {}): Promise<void> {
  const which = spawnSync("which", ["claude"], { encoding: "utf8" });
  if (which.status !== 0) {
    await output.error("Error: claude CLI not found.\nInstall it: npm install -g @anthropic-ai/claude-code");
    process.exit(1);
  }

  const project = resolve(opts.project ?? process.cwd());
  const pipelinesDir = getPipelinesDir(project);
  const dotPath = join(pipelinesDir, `${name}.dot`);

  // Validate name via resolvePipelineArg (same rules as create)
  try {
    resolvePipelineArg(name, project);
  } catch (err) {
    await output.error((err as Error).message);
    process.exit(1);
  }

  // Must exist (inverse of create's conflict check)
  if (!existsSync(dotPath)) {
    await output.error(
      `Pipeline not found: ${dotPath}\n` +
        `Use 'ralph pipeline create ${name}' to create it.`,
    );
    process.exit(1);
  }

  const existingContent = readFileSync(dotPath, "utf8");
  const relativePath = dotPath.startsWith(project + "/") ? dotPath.slice(project.length + 1) : dotPath;
  let previousGraph: Graph | undefined;
  try { previousGraph = parseDot(existingContent); } catch { /* unparsable — skip diff */ }

  const basePrompt = composeCreatePrompt(project);

  let traceBlock = "";
  if (opts.traces !== false) {
    const tracePaths = listRecentTraces(name, REFINE_TRACE_COUNT, { tracesRoot: opts.tracesRoot });
    if (tracePaths.length > 0) {
      const digests = tracePaths.map(p => digestTraceFile(p));
      traceBlock =
        `Recent run traces for ${name}:\n\n` +
        digests.join("\n\n") +
        "\n\n---\n\n";
    }
  }

  const refineFraming =
    traceBlock +
    `Here is the current pipeline workflow at ${relativePath}:\n\n` +
    "```dot\n" +
    existingContent +
    (existingContent.endsWith("\n") ? "" : "\n") +
    "```\n\n" +
    `The user wants to refine it. Discuss what they want to change, propose targeted edits ` +
    `to the existing graph (do not redesign from scratch), then write the updated version back ` +
    `to ${dotPath}. Preserve node IDs and edge labels that the user does not explicitly want ` +
    `changed — downstream tooling routes on edge labels.`;

  const trigger = `${basePrompt}\n\n---\n${refineFraming}`;

  await output.step(`Refining pipeline: ${name}`);
  await output.step(`Target: ${dotPath}`);

  const { exitCode } = await runTwoPhaseClaudeSession({ cwd: project, trigger });

  if (exitCode !== 0) {
    process.exit(exitCode);
  }

  if (!existsSync(dotPath)) {
    await output.warn(`Session ended but ${dotPath} was removed.`);
    process.exit(1);
  }

  await output.step("Validating pipeline...");
  const validateExit = await pipelineValidateCommand(dotPath, { previousGraph });
  process.exit(validateExit);
}
