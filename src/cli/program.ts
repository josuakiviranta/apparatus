import { Command } from "commander";
import { planCommand } from "./commands/plan";
import { implementCommand } from "./commands/implement";
import { newCommand } from "./commands/new";
import { meditateCommand } from "./commands/meditate";
import { registerHeartbeatCommand } from "./commands/heartbeat";
import { meditateCreateCommand } from "./commands/meditate-create";
import {
  pipelineRunCommand,
  pipelineValidateCommand,
  pipelineCreateCommand,
  pipelineRefineCommand,
  pipelineListCommand,
  pipelineTraceCommand,
  pipelineShowCommand,
} from "./commands/pipeline";
import { collectKV } from "./lib/collect-kv.js";
import { agentListAction, agentShowAction, agentCreateAction } from "./commands/agent";

export function createProgram(): Command {
  const program = new Command();

  program
    .name("ralph")
    .description("Agentic loop runner for AI-assisted project development")
    .version("0.1.1");

  program.addHelpText(
    "after",
    `
Getting started (typical workflow):
  ralph new my-app                        Scaffold a new project in ./my-app/
  ralph plan my-app                       Open an interactive planning session
  ralph implement my-app                  Run the agentic build loop (Ctrl-C to stop)
  ralph implement my-app --max 3          Run at most 3 iterations

Background scheduling (heartbeat):
  ralph heartbeat meditate my-app --every 30            Run meditate on my-app every 30 min
  ralph heartbeat implement my-app --every 60           Run implement on my-app every 60 min
  ralph heartbeat pipeline workflow.dot --project my-app --every 60   Run a pipeline every 60 min
  ralph heartbeat list                                  Show all scheduled tasks
  ralph heartbeat logs meditate:my-app --follow         Stream live logs for a task
  ralph heartbeat watch                                 Live TUI dashboard
  ralph heartbeat pause meditate:my-app                 Suspend scheduling without removing
  ralph heartbeat resume meditate:my-app                Re-enable a paused task
  ralph heartbeat stop meditate:my-app                  Remove task and kill any running session

Pipeline engine (DOT-graph workflows):
  ralph pipeline create review --project my-app    Create a new workflow with Claude
  ralph pipeline refine review --project my-app    Refine an existing workflow with Claude
  ralph pipeline list --project my-app             List workflows in a project
  ralph pipeline validate workflow.dot             Check a pipeline file for errors
  ralph pipeline validate review --project my-app  Validate by workflow name
  ralph pipeline run workflow.dot                  Execute a pipeline
  ralph pipeline run review --project my-app       Run by workflow name
  ralph pipeline run workflow.dot --resume         Continue a pipeline after Ctrl-C or node failure
                                                   (checkpoint in ~/.ralph/<projectKey>/runs/<runId>/checkpoint.json)

  DOT file anatomy:
    digraph my_pipeline {
      goal="What this pipeline achieves"

      start  [shape=Mdiamond]                              # entry point (required)
      work   [shape=box, prompt="...", max_iterations=2]   # agentic loop node
      gate   [shape=hexagon, label="Approve?"]             # human decision gate
      done   [shape=Msquare]                               # exit point (required)

      start -> gate
      gate  -> work [label="Yes"]
      gate  -> done [label="No"]
      work  -> done
    }

  Node shapes:
    Mdiamond   Start node — pipeline entry, runs automatically
    Msquare    Exit node  — pipeline complete
    box        Work node  — invokes the agentic loop (prompt= required, max_iterations= recommended)
    hexagon    Human gate — pauses and asks for a decision, routes on edge labels
    diamond    Conditional — branches without human input (condition= on edges)

Meditation (restricted insight sessions):
  ralph meditate my-app                   Run a one-shot meditation session
  ralph meditate create my-app            Create a new meditation script

Agent management:
  ralph agent list                        List all available agents
  ralph agent show <name>                 Show details of a specific agent
  ralph agent create                      Interactively create a new agent definition`
  );

  program
    .command("plan <project-folder>")
    .description("Open an interactive Claude session to write specs, README, and build prompts")
    .addHelpText("after", "\nExamples:\n  ralph plan my-app\n")
    .action(async (projectFolder: string) => {
      await planCommand(projectFolder);
    });

  program
    .command("implement <project-folder>")
    .description("Run the implement pipeline — Claude reads prompts, writes code, commits, and pushes")
    .addHelpText("after", "\nExamples:\n  ralph implement my-app\n  ralph implement my-app --max 5\n  ralph implement my-app --max 0   # unlimited iterations\n\nThe pipeline can be overridden by placing pipelines/implement.dot in your project folder.\n")
    .option("--max <n>", "Maximum iterations (0 = unlimited, default: 0)", parseInt)
    .option("--model <name>", "LLM model override (e.g. claude-opus-4-6)")
    .action(async (projectFolder: string, options: { max?: number; model?: string }) => {
      await implementCommand(projectFolder, options);
    });

  program
    .command("new <project-name>")
    .description("Create a new project folder with prompts, specs/, and a guided Claude kickoff session")
    .addHelpText("after", "\nExamples:\n  ralph new my-app\n")
    .action(async (projectName: string) => {
      await newCommand(projectName);
    });

  const med = program
    .command("meditate")
    .description("Run a restricted Claude session that writes insights to meditations/illuminations/")
    .addHelpText("after", "\nExamples:\n  ralph meditate my-app\n");

  med
    .argument("<project-folder>")
    .option("--steer <text>", "initial steering message injected as first user turn")
    .action(async (projectFolder: string, opts: { steer?: string }) => {
      await meditateCommand(projectFolder, opts);
    });

  med
    .command("create <project-folder>")
    .description("Create a new meditation script with a guided Claude session")
    .addHelpText("after", "\nExamples:\n  ralph meditate create my-app\n")
    .action(async (projectFolder: string) => {
      await meditateCreateCommand(projectFolder);
    });

  const pipeline = program.command("pipeline").description("Pipeline engine commands");

  pipeline
    .command("run <dotfile>")
    .description("Run a .dot pipeline file")
    .addHelpText("after", `
Examples:
  ralph pipeline run smoke.dot                          # smoke test — no work nodes
  ralph pipeline run workflow.dot --project ./my-app   # work nodes operate on my-app
  ralph pipeline run workflow.dot --resume             # continue after Ctrl-C or node failure
  ralph pipeline run workflow.dot --var key=value      # pass caller variables (repeatable)

Work nodes (shape=box) require --project to know which codebase to operate on.
Add max_iterations=N to cap how many agentic loop iterations a node can run.

Checkpoints: the engine writes ~/.ralph/<projectKey>/runs/<runId>/checkpoint.json
after every node advance. --resume loads that checkpoint (currentNode,
completedNodes, context, nodeRetries) and continues from the node that was about
to execute when the run stopped. Works after Ctrl-C, node failures, or process
crashes. Without --resume, a fresh run starts in a new <runId> directory; older
runs are pruned lazily (keep last 50, override with RALPH_RUNS_KEEP). Scripts
called from tool nodes should still be idempotent so --resume can safely
re-execute the node that failed.
`)
    .option("--project <folder>", "Project folder ($project variable and cwd for work nodes)")
    .option("--resume [runId]", "Resume from a checkpoint. Bare flag auto-selects the only run; pass <runId> to pick one explicitly")
    .option("--var <key=value>", "pass caller variable (repeatable)", collectKV, {} as Record<string, string>)
    .action(async (dotFile: string, opts: { project?: string; resume?: boolean | string }) => {
      await pipelineRunCommand(dotFile, {
        project: opts.project,
        resume: opts.resume,
        variables: (opts as Record<string, unknown>)["var"] as Record<string, string> | undefined,
      });
    });

  pipeline
    .command("validate <dotfile>")
    .description("Validate a .dot pipeline file (accepts name shorthand or path)")
    .addHelpText("after", `
Examples:
  ralph pipeline validate workflow.dot
  ralph pipeline validate review --project my-app

Checks for: missing start/exit nodes, unknown node shapes, edges referencing
undeclared nodes, and other structural errors. Exits 0 on success, 1 on errors.
When a plain name is given (no path separators or .dot extension), resolves to
<project>/pipelines/<name>.dot.
`)
    .option("--project <folder>", "Project folder (for name shorthand resolution, defaults to cwd)")
    .action(async (dotFile: string, opts: { project?: string }) => {
      const code = await pipelineValidateCommand(dotFile, opts);
      process.exit(code);
    });

  pipeline
    .command("create <name>")
    .description("Create a new pipeline workflow with an interactive Claude session")
    .addHelpText("after", `
Examples:
  ralph pipeline create review --project my-app
  ralph pipeline create deploy

Creates <project>/pipelines/<name>.dot via an interactive Claude session.
The attractor scheme is injected automatically. Validates the file on exit.
`)
    .option("--project <folder>", "Project folder (pipelines/ lives here, defaults to cwd)")
    .action(async (name: string, opts: { project?: string }) => {
      await pipelineCreateCommand(name, opts);
    });

  pipeline
    .command("refine <name>")
    .description("Refine an existing pipeline with an interactive Claude session")
    .addHelpText("after", `
Examples:
  ralph pipeline refine review --project my-app
  ralph pipeline refine deploy

Loads <project>/pipelines/<name>.dot, opens an agent-assisted Claude session
with the existing graph injected, then validates the edited file on exit.
Use this for every change to an existing pipeline — hand-editing the .dot file
bypasses the scheme guidance and validation loop.
`)
    .option("--project <folder>", "Project folder (pipelines/ lives here, defaults to cwd)")
    .option("--no-traces", "Skip injecting recent run trace digests into the refine trigger")
    .action(async (name: string, opts: { project?: string; traces?: boolean }) => {
      await pipelineRefineCommand(name, opts);
    });

  pipeline
    .command("list")
    .description("List pipeline workflows in a project")
    .addHelpText("after", `
Examples:
  ralph pipeline list --project my-app
  ralph pipeline list

Scans <project>/pipelines/*.dot and prints each workflow's name and goal.
`)
    .option("--project <folder>", "Project folder (defaults to cwd)")
    .action(async (opts: { project?: string }) => {
      await pipelineListCommand(opts);
    });

  pipeline
    .command("trace <runId>")
    .description("inspect a pipeline run trace")
    .option("--node-receive <nodeReceiveId>", "show context snapshot for a specific node invocation")
    .option("--full", "show full context values without truncation")
    .option("--project <folder>", "Pin trace lookup to one project (skips the cross-project scan)")
    .action(async (runId: string, opts: { nodeReceive?: string; full?: boolean; project?: string }) => {
      await pipelineTraceCommand(runId, opts);
    });

  pipeline
    .command("show <dotfile>")
    .description("Render a pipeline as SVG next to the source file")
    .addHelpText("after", `
Examples:
  ralph pipeline show pipelines/illumination-to-implementation.dot
  ralph pipeline show review --project my-app

Validates the DOT file (same gate as 'pipeline validate'). On success, writes
<basename>.svg next to the source file using the bundled WASM graphviz —
no system 'dot' install required. On any validation error, prints
file:line:col diagnostics and writes nothing.
`)
    .option("--project <folder>", "Project folder (for name shorthand resolution, defaults to cwd)")
    .action(async (dotFile: string, opts: { project?: string }) => {
      const code = await pipelineShowCommand(dotFile, opts);
      process.exit(code);
    });

  const agent = program.command("agent").description("Manage agent definitions");

  agent
    .command("list")
    .description("List all available agents")
    .action(async () => {
      await agentListAction();
    });

  agent
    .command("show <name>")
    .description("Show details of a specific agent")
    .action(async (name: string) => {
      await agentShowAction(name);
    });

  agent
    .command("create")
    .description("Interactively create a new agent definition")
    .action(async () => {
      await agentCreateAction();
    });

  registerHeartbeatCommand(program);

  return program;
}
