import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { createInterface } from "readline";
import { spawn } from "child_process";
import * as output from "../lib/output.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ScenarioFile {
  file: string;
  filename: string;
  name: string;
  description: string;
}

// ─── Pure utilities ───────────────────────────────────────────────────────────

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function parseScenarioHeader(
  filePath: string
): { name: string; description: string } {
  const lines = readFileSync(filePath, "utf8").split("\n").slice(0, 10);
  const nameMatch = lines.find((l) => /^[#/\-]+\s*@name:/.test(l));
  const descMatch = lines.find((l) => /^[#/\-]+\s*@description:/.test(l));
  return {
    name: nameMatch
      ? nameMatch.replace(/^[#/\-]+\s*@name:\s*/, "").trim()
      : "",
    description: descMatch
      ? descMatch.replace(/^[#/\-]+\s*@description:\s*/, "").trim()
      : "",
  };
}

export function discoverScenarios(projectFolder: string): ScenarioFile[] {
  const scenarioDir = join(projectFolder, "scenario-tests");
  if (!existsSync(scenarioDir)) return [];
  return readdirSync(scenarioDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const filename = entry.name;
      const file = join(scenarioDir, filename);
      const { name, description } = parseScenarioHeader(file);
      const baseName = filename.replace(/\.[^.]+$/, "");
      return { file, filename, name: name || baseName, description };
    });
}

export function buildScenarioPrompt(
  template: string,
  scenarioName: string,
  description: string,
  scriptPath: string,
  outputPath: string
): string {
  return template
    .replace(/\{\{SCENARIO_NAME\}\}/g, scenarioName)
    .replace(/\{\{SCENARIO_DESCRIPTION\}\}/g, description)
    .replace(/\{\{SCRIPT_PATH\}\}/g, scriptPath)
    .replace(/\{\{OUTPUT_PATH\}\}/g, outputPath);
}

// ─── Timestamp ────────────────────────────────────────────────────────────────

function formatTimestamp(): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const time = now.toTimeString().slice(0, 5).replace(":", "");
  return `${date}T${time}`;
}

// ─── Interactive selection ────────────────────────────────────────────────────

function printScenarioList(scenarios: ScenarioFile[]): void {
  console.log("\nScenario tests found in scenario-tests/:\n");
  scenarios.forEach((s, i) => {
    console.log(`  ${i + 1}. ${s.name}`);
    if (s.description) console.log(`     ${s.description}`);
    console.log(`     [${s.filename}]`);
    console.log();
  });
}

async function promptSelection(scenarios: ScenarioFile[]): Promise<ScenarioFile[]> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question("Enter numbers to run (e.g. 1 3) or 'all': ", (answer) => {
      rl.close();
      const trimmed = answer.trim();
      if (trimmed === "all") return resolve(scenarios);
      const indices = trimmed
        .split(/\s+/)
        .map(Number)
        .filter((n) => !isNaN(n) && n >= 1 && n <= scenarios.length);
      resolve(indices.map((i) => scenarios[i - 1]));
    });
  });
}

// ─── Script runner ────────────────────────────────────────────────────────────

async function runScenarioScript(
  scenario: ScenarioFile,
  outPath: string
): Promise<void> {
  return new Promise((res) => {
    let stdout = "";
    let stderr = "";
    const timestamp = new Date().toISOString();

    const child = spawn("bash", [scenario.file], {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });

    child.on("close", (code) => {
      const status = code === 0 ? "pass" : "fail";
      const rawOutput = [stdout, stderr].filter(Boolean).join("").trim();
      const report = [
        `---`,
        `date: ${timestamp}`,
        `scenario: ${scenario.name}`,
        `script: ${scenario.file}`,
        `status: ${status}`,
        `---`,
        ``,
        `# ${scenario.name}`,
        ``,
        `## What ran`,
        scenario.description || scenario.name,
        ``,
        `## Result`,
        status === "pass"
          ? `Script exited with code 0.`
          : `Script exited with code ${code}.`,
        ``,
        `<details>`,
        `<summary>Raw output</summary>`,
        ``,
        "```",
        rawOutput,
        "```",
        ``,
        `</details>`,
        ``,
      ].join("\n");

      writeFileSync(outPath, report, "utf8");
      res();
    });
  });
}

// ─── Command entry point ──────────────────────────────────────────────────────

export async function runScenariosCommand(
  projectFolder: string,
  options: { all?: boolean }
): Promise<void> {
  const absPath = resolve(projectFolder);
  if (!existsSync(absPath)) {
    await output.error(`Error: project folder not found: ${absPath}`);
    process.exit(1);
  }

  const scenarios = discoverScenarios(absPath);
  if (scenarios.length === 0) {
    await output.info(
      `No scenario-tests/ folder found in ${absPath}.\n` +
        `Run \`ralph new ${projectFolder}\` to scaffold the ralph structure, or create scenario-tests/ manually.`
    );
    process.exit(0);
  }

  printScenarioList(scenarios);

  let selected: ScenarioFile[];
  if (options.all) {
    selected = scenarios;
  } else {
    selected = await promptSelection(scenarios);
    if (selected.length === 0) {
      await output.info("No scenarios selected.");
      process.exit(0);
    }
  }

  const runsDir = join(absPath, "scenario-runs");
  mkdirSync(runsDir, { recursive: true });

  for (const scenario of selected) {
    const ts = formatTimestamp();
    const slug = slugify(scenario.name);
    const outFile = `${ts}-${slug}.md`;
    const outPath = join(runsDir, outFile);

    await output.step(`Running: ${scenario.name}...`);
    await runScenarioScript(scenario, outPath);
    await output.success(`Done: ${outPath}`);
  }
}
