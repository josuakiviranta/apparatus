import { join, basename } from "path";

/**
 * Resolves a path to a bundled asset.
 * In production (tsup bundle): __dirname → dist/, assets at dist/loop.sh and dist/prompts/
 * In dev (tsx): __dirname → src/cli/lib/, assets at src/cli/prompts/ and project root loop.sh
 */
export function getAssetPath(filename: string): string {
  const dir = basename(__dirname);
  // In production, tsup compiles to dist/index.js so __dirname ends with "dist"
  // In dev, tsx runs from src/cli/lib/ so __dirname ends with "lib"
  const base = dir === "dist" ? __dirname : join(__dirname, "..");
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
  const dir = basename(__dirname);
  // In production (dist/): package root is one level up
  // In dev (src/cli/lib/): package root is three levels up
  const packageRoot = dir === "dist"
    ? join(__dirname, "..")
    : join(__dirname, "../../..");
  return join(packageRoot, "meditations");
}

export function getIlluminationServerPath(): string {
  const dir = basename(__dirname);
  if (dir === "dist") {
    return join(__dirname, "mcp", "illumination-server.js");
  } else {
    return join(__dirname, "..", "mcp", "illumination-server.ts");
  }
}
