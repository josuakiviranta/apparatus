import { readFileSync, existsSync, readdirSync, mkdirSync, rmSync } from "fs";
import { resolve, join, basename, dirname } from "path";
import { homedir } from "os";
import { randomUUID } from "crypto";
import { JsonlPipelineTracer } from "../../attractor/tracer/jsonl-pipeline-tracer.js";
import type { PipelineTracer } from "../../attractor/tracer/pipeline-tracer.js";
import { parseDot, validateGraph, validateOrRaise } from "../../attractor/core/graph.js";
import { runPipeline } from "../../attractor/core/engine.js";
import { variableExpansionTransform } from "../../attractor/transforms/variable-expansion.js";
import { InkInterviewer } from "../../attractor/interviewer/ink.js";
import { AutoApproveInterviewer } from "../../attractor/interviewer/auto-approve.js";
import { getPipelinesDir, resolvePipelineArg, isNameShorthand } from "../lib/pipeline-resolver.js";
import { spawn, spawnSync } from "child_process";
import { PassThrough } from "stream";
import { streamEvents, parseStreamJsonEvents } from "../lib/stream-formatter.js";
import { getPipelineCreatePromptPath } from "../lib/assets.js";
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

  if (errors.length === 0) {
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
    try {
      const src = readFileSync(absFile, "utf8");
      const graph = parseDot(src);
      if (graph.goal) goal = `"${graph.goal}"`;
    } catch {
      goal = "(unreadable)";
    }
    await output.info(`  ${name.padEnd(20)} ${goal}`);
  }
}

export interface PipelineCreateOptions {
  project?: string;
}

export async function pipelineTraceCommand(
  runId: string,
  opts: { nodeReceive?: string } = {}
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
        const truncated = val.length > 80 ? val.slice(0, 77) + "..." : val;
        console.log(`  ${key.padEnd(maxLen + 2)}${truncated}`);
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
    await output.error(`Pipeline already exists: ${dotPath}\nDelete or rename it before running create.`);
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

  // Read prompt
  const promptPath = getPipelineCreatePromptPath();
  const promptContent = readFileSync(promptPath, "utf8");

  const trigger = `${promptContent}\n\n---\nCreate a new pipeline named "${name}". Write it to: ${dotPath}`;

  await output.step(`Creating pipeline: ${name}`);
  await output.step(`Target: ${dotPath}`);

  // Phase 1: non-interactive kickoff to get session ID
  let sessionId: string | null = null;
  const child = spawn(
    "claude",
    ["-p", trigger, "--output-format", "stream-json", "--dangerously-skip-permissions"],
    { cwd: project, env: process.env, stdio: ["ignore", "pipe", "pipe"] }
  );
  const exitPromise = new Promise<void>(res => child.on("close", () => res()));
  await output.stream(
    streamEvents(child.stdout as NodeJS.ReadableStream, {
      onSessionId: id => { sessionId = id; },
    })
  );
  await exitPromise;

  // Phase 2: interactive resume
  await output.step("━━━ Launching interactive session ━━━");
  const resumeArgs = [
    "--dangerously-skip-permissions",
    ...(sessionId ? ["--resume", sessionId] : []),
  ];
  const result = spawnSync("claude", resumeArgs, {
    cwd: project,
    stdio: "inherit",
    env: process.env,
  });

  // Post-session: validate
  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }

  if (!existsSync(dotPath)) {
    await output.warn(`Session ended but ${dotPath} was not created.`);
    process.exit(1);
  }

  await output.step("Validating pipeline...");
  const exitCode = await pipelineValidateCommand(dotPath);
  process.exit(exitCode);
}
