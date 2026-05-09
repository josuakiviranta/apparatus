import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

export interface LastRunOutcome {
  runId: string;
  outcome: "success" | "failure";
  timestamp: string;
}

interface PipelineEndEvent {
  kind: "pipeline-end";
  runId: string;
  outcome: "success" | "failure";
  timestamp: string;
}

export function readLastRunOutcome(runsRoot: string): LastRunOutcome | null {
  if (!existsSync(runsRoot)) return null;
  let entries: string[];
  try {
    entries = readdirSync(runsRoot);
  } catch {
    return null;
  }
  if (entries.length === 0) return null;

  const ranked = entries
    .map((name) => {
      try {
        return { name, mtime: statSync(join(runsRoot, name)).mtimeMs };
      } catch {
        return null;
      }
    })
    .filter((x): x is { name: string; mtime: number } => x !== null)
    .sort((a, b) => b.mtime - a.mtime);

  for (const { name } of ranked) {
    const tracePath = join(runsRoot, name, "pipeline.jsonl");
    if (!existsSync(tracePath)) continue;
    let content: string;
    try {
      content = readFileSync(tracePath, "utf8");
    } catch {
      continue;
    }
    const lines = content.split("\n").filter(Boolean);
    let last: PipelineEndEvent | null = null;
    for (const line of lines) {
      try {
        const ev = JSON.parse(line);
        if (ev?.kind === "pipeline-end") last = ev as PipelineEndEvent;
      } catch {
        // skip malformed lines
      }
    }
    if (last) {
      return {
        runId: name,
        outcome: last.outcome === "success" ? "success" : "failure",
        timestamp: last.timestamp,
      };
    }
  }
  return null;
}
