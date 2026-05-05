import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * In production (tsup bundle): __APPARAT_PROD__ defined → __dirname is dist/cli/
 * In dev (tsx): __APPARAT_PROD__ undefined → __dirname is src/cli/lib/
 */
function isProduction(): boolean {
  return typeof __APPARAT_PROD__ !== "undefined";
}

function getBundledRoot(): string {
  // prod: dist/cli/ → up one → dist/  (tsup copies src/cli/pipelines → dist/pipelines)
  // dev:  src/cli/lib/ → up one → src/cli/  (where pipelines/ lives in source)
  return join(__dirname, "..");
}

export function getBundledPipelinesDir(): string {
  return join(getBundledRoot(), "pipelines");
}

export function resolveBundledPipeline(name: string): string {
  const path = join(getBundledPipelinesDir(), name, "pipeline.dot");
  if (!existsSync(path)) {
    throw new Error(
      `Bundled pipeline not found: "${name}" (expected ${path}). ` +
        `Available pipelines ship under pipelines/ at the ralph-cli repo root.`,
    );
  }
  return path;
}

export function getMetaMeditationsDir(): string {
  // prod: dist/cli/ → up two → package root
  // dev:  src/cli/lib/ → up three → package root
  const packageRoot = isProduction()
    ? join(__dirname, "../..")
    : join(__dirname, "../../..");
  return join(packageRoot, ".ralph", "meditations", "stimuli");
}

export function getIlluminationServerPath(): string {
  if (isProduction()) {
    return join(__dirname, "mcp", "illumination-server.js");
  } else {
    return join(__dirname, "..", "mcp", "illumination-server.ts");
  }
}
