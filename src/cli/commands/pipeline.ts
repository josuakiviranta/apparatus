import { readFileSync, existsSync, readdirSync, mkdirSync, rmSync } from "fs";
import { resolve, join, basename } from "path";
import { homedir } from "os";
import { parseDot, validateGraph, validateOrRaise } from "../../attractor/core/graph.js";
import { runPipeline } from "../../attractor/core/engine.js";
import { variableExpansionTransform } from "../../attractor/transforms/variable-expansion.js";
import { ConsoleInterviewer } from "../../attractor/interviewer/console.js";
import { AutoApproveInterviewer } from "../../attractor/interviewer/auto-approve.js";
import { getPipelinesDir, resolvePipelineArg, isNameShorthand } from "../lib/pipeline-resolver.js";
import { spawn, spawnSync } from "child_process";
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
  let graph = parseDot(src);

  try { validateOrRaise(graph); }
  catch (err) { await output.error((err as Error).message); process.exit(1); }

  graph = variableExpansionTransform(graph, { project: opts.project });

  const slug = graph.name.replace(/\s+/g, "-").toLowerCase();
  const logsRoot = opts.logsRoot ?? join(homedir(), ".ralph", "runs", slug);

  // For fresh runs (not --resume), clean any previous run directory
  if (!opts.resume && existsSync(logsRoot) && !opts.logsRoot) {
    rmSync(logsRoot, { recursive: true, force: true });
  }

  // Mount the new single-<Static> PipelineApp.
  const overviewNodeIds = [...graph.nodes.values()]
    .filter((n) => n.shape !== "Mdiamond" && n.shape !== "Msquare")
    .map((n) => n.id);

  const { callbacks, waitUntilExit } = await renderPipelineApp({
    pipelineName: graph.name,
    pid: process.pid,
    goal: graph.goal,
    nodes: overviewNodeIds,
  });
  const { emit, done } = callbacks;

  // Track whether the current node had a block emitted (so we can gate `end`
  // emission symmetrically). Marker nodes (start, exit) do NOT emit a block.
  let currentBlockNodeId: string | null = null;
  // One-shot flag: once we synthesize an abort end from the signal handler,
  // ignore any late `onNodeEnd` for the same node.
  let abortHandled = false;

  const ac = new AbortController();
  const onSignal = () => {
    if (currentBlockNodeId !== null) {
      emit({ kind: "end", outcome: { status: "abort", reason: "user-interrupt" } });
      currentBlockNodeId = null;
      abortHandled = true;
    }
    ac.abort();
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  try {
    const result = await runPipeline(graph, {
      logsRoot,
      cwd: project,
      interviewer: process.stdin.isTTY ? new ConsoleInterviewer() : new AutoApproveInterviewer(),
      signal: ac.signal,
      project: opts.project,
      resume: opts.resume,

      onInteractiveRequest: ({ child }) =>
        new Promise<void>((resolve) => {
          emit({ kind: "interactive-ready", child, onDone: resolve });
          if (child.sessionId) {
            emit({ kind: "trace-path", sessionId: child.sessionId });
          }
          // Pipe the child's event stream into the reducer.
          (async () => {
            try {
              for await (const raw of child.events) {
                for (const nev of parseClaudeEvent(raw)) emit(nev);
              }
              resolve();
            } catch (err) {
              if (abortHandled) return;
              emit({
                kind: "end",
                outcome: { status: "fail", reason: `crash: ${(err as Error).message}` },
              });
              currentBlockNodeId = null;
            }
          })();
        }),

      onNodeStart: (node) => {
        const blockKind = classifyNode(node);
        if (blockKind === "marker") return;
        currentBlockNodeId = node.id;
        emit({
          kind: "start",
          nodeId: node.id,
          label: node.label ?? blockKind,
          blockKind,
        });
      },

      onNodeEnd: (node, outcome) => {
        if (abortHandled) return;
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

      onStdout: async (stdout) => {
        for await (const raw of parseStreamJsonEvents(stdout)) {
          for (const nev of parseClaudeEvent(raw)) emit(nev);
        }
      },
    });

    if (result.status !== "success" && !abortHandled && currentBlockNodeId !== null) {
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
