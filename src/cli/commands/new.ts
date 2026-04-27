import { mkdirSync, writeFileSync, existsSync } from "fs";
import { join, resolve } from "path";
import { spawnSync } from "child_process";
import { resolveBundledTemplate } from "../lib/assets.js";
import * as output from "../lib/output.js";
import * as self from "./pipeline.js";

export async function newCommand(projectName: string): Promise<void> {
  const targetPath = resolve(process.cwd(), projectName);

  if (existsSync(targetPath)) {
    await output.error(`Error: directory already exists: ${targetPath}`);
    process.exit(1);
  }

  await output.step(`Creating project: ${projectName}`);
  scaffoldProject(targetPath, projectName);

  await output.step("Initializing git repository...");
  const gitResult = spawnSync("git", ["init", "-b", "main"], {
    cwd: targetPath,
    stdio: "inherit",
    encoding: "utf8",
  });
  if (gitResult.status !== 0) {
    await output.error("Error: git init failed");
    process.exit(1);
  }

  const dotFile = resolveBundledTemplate("new");
  return self.pipelineRunCommand(dotFile, {
    project: targetPath,
    variables: { project_name: projectName },
  });
}

export function scaffoldProject(targetPath: string, _projectName: string): void {
  mkdirSync(targetPath, { recursive: true });
  mkdirSync(join(targetPath, "specs"), { recursive: true });
  mkdirSync(join(targetPath, "src"), { recursive: true });
  mkdirSync(join(targetPath, "meditations", "illuminations"), { recursive: true });
  mkdirSync(join(targetPath, "meditations", "archived-illuminations"), { recursive: true });
  mkdirSync(join(targetPath, "meditations", "implemented-illuminations"), { recursive: true });

  const emptyFiles = ["AGENTS.md", "IMPLEMENTATION_PLAN.md", "README.md"];
  for (const f of emptyFiles) {
    writeFileSync(join(targetPath, f), "");
  }

  writeFileSync(
    join(targetPath, ".gitignore"),
    [
      "IMPLEMENTATION_PLAN.md",
    ].join("\n") + "\n"
  );
}
