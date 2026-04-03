import { Command } from "commander";
import { planCommand } from "./commands/plan";
import { implementCommand } from "./commands/implement";

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

// Default: ralph <project-folder> with no subcommand → implement
program
  .argument("[project-folder]")
  .option("--max <n>", "Maximum number of loop iterations", parseInt)
  .action(async (projectFolder: string | undefined, options: { max?: number }) => {
    if (!projectFolder) {
      program.help();
      return;
    }
    await implementCommand(projectFolder, options);
  });

program.parse(process.argv);
