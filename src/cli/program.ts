import { Command } from "commander";
import { planCommand } from "./commands/plan";
import { implementCommand } from "./commands/implement";
import { newCommand } from "./commands/new";
import { meditateCommand } from "./commands/meditate";
import { registerHeartbeatCommand } from "./commands/heartbeat";
import { meditateCreateCommand } from "./commands/meditate-create";
import { runScenariosCommand } from "./commands/run-scenarios";
import { pipelineRunCommand, pipelineValidateCommand } from "./commands/pipeline";

export function createProgram(): Command {
  const program = new Command();

  program
    .name("ralph")
    .description("Agentic loop runner for AI-assisted project development")
    .version("0.1.0");

  program.addHelpText(
    "after",
    `
Getting started (typical workflow):
  ralph new my-app                        Scaffold a new project in ./my-app/
  ralph plan my-app                       Open an interactive planning session
  ralph implement my-app                  Run the agentic build loop (Ctrl-C to stop)
  ralph implement my-app --max 3          Run at most 3 iterations
  ralph run-scenarios my-app              Discover and run scenario tests

Background scheduling (heartbeat):
  ralph heartbeat meditate my-app --every 30        Run meditate on my-app every 30 min
  ralph heartbeat list                              Show all scheduled tasks
  ralph heartbeat logs meditate:my-app --follow     Stream live logs for a task
  ralph heartbeat watch                             Live TUI dashboard
  ralph heartbeat pause meditate:my-app             Suspend scheduling without removing
  ralph heartbeat resume meditate:my-app            Re-enable a paused task
  ralph heartbeat stop meditate:my-app              Remove task and kill any running session

Pipeline engine:
  ralph pipeline run workflow.dot         Execute a DOT pipeline
  ralph pipeline validate workflow.dot    Validate a DOT pipeline file

Meditation (restricted insight sessions):
  ralph meditate my-app                   Run a one-shot meditation session
  ralph meditate create my-app            Create a new meditation script`
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
    .description("Run the agentic build loop — Claude reads prompts, writes code, commits, and pushes")
    .addHelpText("after", "\nExamples:\n  ralph implement my-app\n  ralph implement my-app --max 5\n")
    .option("--max <n>", "Maximum number of loop iterations", parseInt)
    .action(async (projectFolder: string, options: { max?: number }) => {
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
    .action(async (projectFolder: string) => {
      await meditateCommand(projectFolder);
    });

  med
    .command("create <project-folder>")
    .description("Create a new meditation script with a guided Claude session")
    .addHelpText("after", "\nExamples:\n  ralph meditate create my-app\n")
    .action(async (projectFolder: string) => {
      await meditateCreateCommand(projectFolder);
    });

  program
    .command("run-scenarios <project-folder>")
    .description("Discover scenario-tests/*.md files, run them with Claude, and write reports to scenario-runs/")
    .addHelpText("after", "\nExamples:\n  ralph run-scenarios my-app\n  ralph run-scenarios my-app --all\n")
    .option("--all", "Run all scenarios without interactive selection")
    .action(async (projectFolder: string, options: { all?: boolean }) => {
      await runScenariosCommand(projectFolder, options);
    });

  const pipeline = program.command("pipeline").description("Pipeline engine commands");

  pipeline
    .command("run <dotfile>")
    .description("Run a .dot pipeline file")
    .option("--project <folder>", "Project folder ($project variable and cwd)")
    .option("--resume", "Resume from last checkpoint")
    .action(async (dotFile: string, opts: { project?: string; resume?: boolean }) => {
      await pipelineRunCommand(dotFile, opts);
    });

  pipeline
    .command("validate <dotfile>")
    .description("Validate a .dot pipeline file")
    .action(async (dotFile: string) => {
      const code = await pipelineValidateCommand(dotFile);
      process.exit(code);
    });

  registerHeartbeatCommand(program);

  return program;
}
