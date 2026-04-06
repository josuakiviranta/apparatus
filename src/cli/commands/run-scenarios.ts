import { existsSync, readdirSync, readFileSync, mkdirSync } from "fs";
import { join, resolve } from "path";
import { createInterface } from "readline";
import { spawn, spawnSync } from "child_process";
import { getScenarioPromptPath } from "../lib/assets";

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

// ─── Session runner ───────────────────────────────────────────────────────────

export function buildScenarioArgs(promptText: string): string[] {
  return [
    "-p", promptText,
    "--output-format", "stream-json",
    "--dangerously-skip-permissions",
  ];
}

async function runScenarioSession(cwd: string, promptText: string): Promise<void> {
  return new Promise((resolve) => {
    let buffer = "";
    const args = buildScenarioArgs(promptText);
    const child = spawn("claude", args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.type === "assistant") {
            for (const block of msg.message?.content ?? []) {
              if (block.type === "text") process.stdout.write(block.text);
              else if (block.type === "tool_use")
                process.stdout.write(`\n→ [tool] ${block.name}\n`);
            }
          }
        } catch {}
      }
    });

    child.stderr.on("data", (chunk: Buffer) => process.stderr.write(chunk));
    child.on("close", (code) => {
      if (code !== 0)
        process.stderr.write(`Warning: scenario session exited with code ${code}\n`);
      resolve();
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
    console.error(`Error: project folder not found: ${absPath}`);
    process.exit(1);
  }

  const which = spawnSync("which", ["claude"], { encoding: "utf8" });
  if (which.status !== 0) {
    console.error(
      "Error: claude CLI not found.\nInstall it: npm install -g @anthropic-ai/claude-code"
    );
    process.exit(1);
  }

  const scenarios = discoverScenarios(absPath);
  if (scenarios.length === 0) {
    console.log(
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
      console.log("No scenarios selected.");
      process.exit(0);
    }
  }

  const runsDir = join(absPath, "scenario-runs");
  mkdirSync(runsDir, { recursive: true });

  const promptTemplate = readFileSync(getScenarioPromptPath(), "utf8");

  for (const scenario of selected) {
    const ts = formatTimestamp();
    const slug = slugify(scenario.name);
    const outFile = `${ts}-${slug}.md`;
    const outPath = join(runsDir, outFile);
    const prompt = buildScenarioPrompt(
      promptTemplate,
      scenario.name,
      scenario.description,
      scenario.file,
      outPath
    );

    console.log(`\nRunning: ${scenario.name}...`);
    await runScenarioSession(absPath, prompt);
    console.log(`Done: scenario-runs/${outFile}`);
  }
}
