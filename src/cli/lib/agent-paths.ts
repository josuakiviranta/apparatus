import { existsSync } from "fs";
import { join, relative } from "path";
import type { Node } from "../../attractor/types.js";
import { resolveHandlerType } from "../../attractor/core/graph.js";

/**
 * Resolve the on-disk `.md` sibling for an agent or gate node.
 * Returns the path relative to cwd when the file exists, null otherwise.
 * Tool / start / exit / conditional / store nodes always return null
 * (no `.md` sibling expected).
 *
 * Why a relative path: the value lands in user-facing failure footers; an
 * absolute path inside `/var/folders/.../` is hostile to copy-paste. When the
 * file lies outside cwd, `relative()` returns the absolute form via the
 * empty-string fallback.
 */
export function resolveAgentFileForNode(
  node: Node,
  dotDir: string,
): string | null {
  const kind = resolveHandlerType(node);
  if (kind !== "agent" && kind !== "wait.human") return null;
  const abs = join(dotDir, `${node.id}.md`);
  if (!existsSync(abs)) return null;
  return relative(process.cwd(), abs) || abs;
}
