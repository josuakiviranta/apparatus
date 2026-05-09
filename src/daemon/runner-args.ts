/**
 * Pure argv helpers for daemon → child plumbing.
 * Kept separate from runner.ts so runTask stays focused on lifecycle.
 */

export function resolveProjectFromArgs(args: string[]): string | null {
  const idx = args.indexOf("--project");
  if (idx === -1) return null;
  const val = args[idx + 1];
  if (val === undefined) return null;
  return val;
}

export function injectRunArgs(args: string[], runId: string, logsRoot: string): string[] {
  const out = [...args];
  if (!out.includes("--run-id")) {
    out.push("--run-id", runId);
  }
  if (!out.includes("--logs-root")) {
    out.push("--logs-root", logsRoot);
  }
  return out;
}
