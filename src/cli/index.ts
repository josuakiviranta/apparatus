import { Command } from "commander";
import { planCommand } from "./commands/plan";
import { implementCommand } from "./commands/implement";
import { newCommand } from "./commands/new";
import { meditateCommand, meditateStop, meditateStatus } from "./commands/meditate";
import { meditateCreateCommand } from "./commands/meditate-create";

const program = new Command();

program
  .name("ralph")
  .description("Agentic loop runner for AI-assisted project development")
  .version("0.1.0");

program
  .command("plan <project-folder>")
  .description("Open an interactive Claude planning session")
  .action(async (projectFolder: string) => {
    await planCommand(projectFolder);
  });

program
  .command("implement <project-folder>")
  .description("Run the agentic implementation loop")
  .option("--max <n>", "Maximum number of loop iterations", parseInt)
  .action(async (projectFolder: string, options: { max?: number }) => {
    await implementCommand(projectFolder, options);
  });

program
  .command("new <project-name>")
  .description("Scaffold a new project and launch a kickoff session")
  .action(async (projectName: string) => {
    await newCommand(projectName);
  });

program
  .command("meditate <project-folder>")
  .description("Run a meditation cycle")
  .option("--every <n>", "Schedule interval in minutes (registers cron job)", parseInt)
  .option("--until <datetime>", "Stop scheduling after this ISO 8601 datetime")
  .action(async (projectFolder: string, options: { every?: number; until?: string }) => {
    await meditateCommand(projectFolder, options);
  });

program
  .command("meditate-create <project-folder>")
  .description("Create a new meditation script")
  .action(async (projectFolder: string) => {
    await meditateCreateCommand(projectFolder);
  });

program
  .command("meditate-stop <project-folder>")
  .description("Stop schedule and any running session")
  .action(async (projectFolder: string) => {
    await meditateStop(projectFolder);
  });

program
  .command("meditate-status <project-folder>")
  .description("Show meditation schedule and session status")
  .action(async (projectFolder: string) => {
    await meditateStatus(projectFolder);
  });

program.parse(process.argv);
