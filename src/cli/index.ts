import { Command } from "commander";
import { planCommand } from "./commands/plan";
import { implementCommand } from "./commands/implement";
import { newCommand } from "./commands/new";
import { meditateCommand, meditateStop, meditateStatus } from "./commands/meditate";

const program = new Command();

program
  .name("ralph")
  .description("Agentic loop runner for AI-assisted project development")
  .version("0.1.0");

program
  .command("plan <project-folder>")
  .description(
    "Open an interactive Claude planning session in the project folder"
  )
  .action(async (projectFolder: string) => {
    await planCommand(projectFolder);
  });

program
  .command("implement <project-folder>")
  .description("Run the agentic implementation loop in the project folder")
  .option("--max <n>", "Maximum number of loop iterations", parseInt)
  .action(async (projectFolder: string, options: { max?: number }) => {
    await implementCommand(projectFolder, options);
  });

program
  .command("new <project-name>")
  .description("Scaffold a new project folder and launch a Claude kickoff session")
  .action(async (projectName: string) => {
    await newCommand(projectName);
  });

program
  .command("meditate <action-or-folder>")
  .argument("[project-folder]")
  .description("Run a meditation cycle (reflection only, no implementation)")
  .option("--every <n>", "Schedule interval in minutes (registers cron job)", parseInt)
  .option("--until <datetime>", "Stop scheduling after this ISO 8601 datetime")
  .action(async (actionOrFolder: string, projectFolderArg: string | undefined, options: { every?: number; until?: string }) => {
    if ((actionOrFolder === "stop" || actionOrFolder === "status") && !projectFolderArg) {
      console.error(`Usage: ralph meditate ${actionOrFolder} <project-folder>`);
      process.exit(1);
    } else if (actionOrFolder === "stop" && projectFolderArg) {
      await meditateStop(projectFolderArg);
    } else if (actionOrFolder === "status" && projectFolderArg) {
      await meditateStatus(projectFolderArg);
    } else {
      await meditateCommand(actionOrFolder, options);
    }
  });

// Default: ralph <project-folder> [plan|implement] — supports both arg orderings
program
  .argument("[project-folder]")
  .argument("[subcommand]", "plan or implement (default: implement)")
  .option("--max <n>", "Maximum number of loop iterations", parseInt)
  .action(async (projectFolder: string | undefined, subcommand: string | undefined, options: { max?: number }) => {
    if (!projectFolder) {
      program.help();
      return;
    }
    if (subcommand === "plan") {
      await planCommand(projectFolder);
    } else {
      await implementCommand(projectFolder, options);
    }
  });

program.parse(process.argv);
