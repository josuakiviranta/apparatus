import { join, basename, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Resolves a path to a bundled asset.
 * In production (tsup bundle): __dirname → dist/cli/, assets at dist/loop.sh and dist/prompts/
 * In dev (tsx): __dirname → src/cli/lib/, assets at src/cli/prompts/ and project root loop.sh
 */
function isProduction(): boolean {
  const dir = basename(__dirname);
  // tsup now outputs to dist/cli/index.js (multiple entry points preserve structure)
  return dir === "cli" || dir === "dist";
}

export function getAssetPath(filename: string): string {
  // prod: dist/cli/ → up one → dist/ (where loop.sh and prompts/ live)
  // dev:  src/cli/lib/ → up one → src/cli/ (where prompts/ live in dev)
  const base = join(__dirname, "..");
  return join(base, filename);
}

export function getLoopShPath(): string {
  return getAssetPath("loop.sh");
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
