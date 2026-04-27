import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";

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
  // prod: dist/cli/ → up one → dist/ (where prompts/ live)
  // dev:  src/cli/lib/ → up one → src/cli/ (where prompts/ live in dev)
  const base = join(__dirname, "..");
  return join(base, filename);
}

export function getMeditationPromptPath(): string {
  return getAssetPath(join("prompts", "PROMPT_meditation.md"));
}

export function getMeditateCreatePromptPath(): string {
  return getAssetPath(join("prompts", "PROMPT_meditate_create.md"));
}

export function getPipelineCreatePromptPath(): string {
  return getAssetPath(join("prompts", "PROMPT_pipeline_create.md"));
}

export function getBundledAgentsDir(): string {
  return getAssetPath("agents");
}

export function getBundledTemplatesDir(): string {
  return getAssetPath("templates");
}

export function resolveBundledTemplate(name: string): string {
  const dir = getBundledTemplatesDir();
  const path = join(dir, name, "pipeline.dot");
  if (!existsSync(path)) {
    throw new Error(
      `Bundled template not found: "${name}" (expected ${path}). ` +
        `Available templates ship under src/cli/templates/.`,
    );
  }
  return path;
}

export function getBundledPipelinePath(name: string): string {
  return getAssetPath(join("pipelines", `${name}.dot`));
}

export function getMetaMeditationsDir(): string {
  // prod: dist/cli/ → up two → package root
  // dev:  src/cli/lib/ → up three → package root
  const packageRoot = isProduction()
    ? join(__dirname, "../..")
    : join(__dirname, "../../..");
  return join(packageRoot, "meditations", "stimuli");
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
