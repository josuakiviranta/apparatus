import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Resolves a path to a bundled asset.
 * In production (tsup bundle): __RALPH_PROD__ is defined → __dirname is dist/cli/
 * In dev (tsx): __RALPH_PROD__ is undefined → __dirname is src/cli/lib/
 */
function isProduction(): boolean {
  return typeof __RALPH_PROD__ !== "undefined";
}

export function getAssetPath(filename: string): string {
  // prod: dist/cli/ → up one → dist/ (where loop.sh and prompts/ live)
  // dev:  src/cli/lib/ → up one → src/cli/ (where prompts/ live in dev)
  const base = join(__dirname, "..");
  return join(base, filename);
}

export function getPromptPath(type: "plan" | "build"): string {
  const filename =
    type === "plan" ? "PROMPT_plan.md" : "PROMPT_build.md";
  return getAssetPath(join("prompts", filename));
}

export function getKickoffPromptPath(): string {
  return getAssetPath(join("prompts", "PROMPT_kickoff.md"));
}

export function getMeditationPromptPath(): string {
  return getAssetPath(join("prompts", "PROMPT_meditation.md"));
}

export function getScenarioPromptPath(): string {
  return getAssetPath(join("prompts", "PROMPT_scenario.md"));
}

export function getMeditateCreatePromptPath(): string {
  return getAssetPath(join("prompts", "PROMPT_meditate_create.md"));
}

export function getMetaMeditationsDir(): string {
  // prod: dist/cli/ → up two → package root
  // dev:  src/cli/lib/ → up three → package root
  const packageRoot = isProduction()
    ? join(__dirname, "../..")
    : join(__dirname, "../../..");
  return join(packageRoot, "meditations");
}

export function getIlluminationServerPath(): string {
  if (isProduction()) {
    // prod: dist/cli/ → dist/cli/mcp/illumination-server.js
    return join(__dirname, "mcp", "illumination-server.js");
  } else {
    // dev: src/cli/lib/ → src/cli/mcp/illumination-server.ts
    return join(__dirname, "..", "mcp", "illumination-server.ts");
  }
}
