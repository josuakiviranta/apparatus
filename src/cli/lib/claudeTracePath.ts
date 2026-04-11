import { homedir } from "os";
import { join } from "path";

/**
 * Builds the absolute path to a Claude Code session transcript file.
 * Claude Code stores transcripts under ~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl
 * where <encoded-cwd> is the project directory with all "/" replaced by "-".
 *
 * This path can be tailed by a secondary agent to observe the full conversation.
 */
export function claudeTracePath(
  sessionId: string,
  projectDir: string = process.cwd(),
): string {
  const encoded = projectDir.replace(/\//g, "-");
  return join(homedir(), ".claude", "projects", encoded, `${sessionId}.jsonl`);
}
