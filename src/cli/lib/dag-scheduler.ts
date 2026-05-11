// src/cli/lib/dag-scheduler.ts
import type { ChunkRecord, Dag } from "./dag-schema.js";

export interface SchedulerInput {
  planPath: string;
  planContent: string;
}

export interface SchedulerResult {
  dag: Dag;
  batches: ChunkRecord[][];
  batchCount: number;
  chunkCount: number;
  parallelWorthwhile: boolean;
  warnings: string[];
}

const CHUNK_HEADING_RE = /^##\s+Chunk\s+(\d+):\s+(.+)$/gm;
const FILES_PATH_RE = /^\s*-\s+(?:Create|Modify|Test):\s+`([^`]+)`/gm;

export function scheduleFromPlan(input: SchedulerInput): SchedulerResult {
  const { planPath, planContent } = input;
  const warnings: string[] = [];

  const headingMatches = [...planContent.matchAll(CHUNK_HEADING_RE)];
  if (headingMatches.length === 0) {
    return emptyResult(planPath);
  }

  const chunks: ChunkRecord[] = headingMatches.map((m, idx) => {
    const start = m.index! + m[0].length;
    const end = idx + 1 < headingMatches.length ? headingMatches[idx + 1].index! : planContent.length;
    const body = planContent.slice(start, end);
    const filesTouched = [...body.matchAll(FILES_PATH_RE)].map((fm) => fm[1]);
    const id = `c${idx + 1}`;
    return {
      id,
      title: m[2].trim(),
      depends_on: [],
      files_touched: filesTouched,
      branch: `parallel-impl/${id}-${kebab(m[2].trim())}`,
      worktree_path: null,
      status: "ready",
      head_sha: null,
      merge_sha: null,
      conflict_files: null,
      resolver_attempts: 0,
    };
  });

  for (let i = 0; i < chunks.length; i++) {
    if (chunks[i].files_touched.length === 0) {
      warnings.push(`chunk ${chunks[i].id} has no files_touched — falling back to depends_on=[all-previous]`);
      chunks[i].depends_on = chunks.slice(0, i).map((c) => c.id);
      continue;
    }
    const myFiles = new Set(chunks[i].files_touched);
    const rawDeps: string[] = [];
    for (let j = 0; j < i; j++) {
      const shared = chunks[j].files_touched.some((f) => myFiles.has(f));
      if (shared) rawDeps.push(chunks[j].id);
    }
    chunks[i].depends_on = transitiveReduce(rawDeps, chunks);
  }

  const batches = topoBatches(chunks);
  const dag: Dag = { plan_path: planPath, pre_sha: null, chunks };

  return {
    dag,
    batches,
    batchCount: batches.length,
    chunkCount: chunks.length,
    parallelWorthwhile: batches.length < chunks.length,
    warnings,
  };
}

function emptyResult(planPath: string): SchedulerResult {
  return {
    dag: { plan_path: planPath, pre_sha: null, chunks: [] },
    batches: [],
    batchCount: 0,
    chunkCount: 0,
    parallelWorthwhile: false,
    warnings: [],
  };
}

/** Keep only direct deps — remove any dep that is already reachable via another dep. */
function transitiveReduce(deps: string[], chunks: ChunkRecord[]): string[] {
  if (deps.length <= 1) return deps;
  const byId = new Map(chunks.map((c) => [c.id, c]));

  function reachable(from: string, exclude: string): Set<string> {
    const visited = new Set<string>();
    const queue = [from];
    while (queue.length > 0) {
      const cur = queue.pop()!;
      for (const d of byId.get(cur)?.depends_on ?? []) {
        if (!visited.has(d)) {
          visited.add(d);
          queue.push(d);
        }
      }
    }
    return visited;
  }

  return deps.filter((dep) => {
    // Keep dep only if it's NOT reachable from another dep in the set
    return !deps.some((other) => other !== dep && reachable(other, dep).has(dep));
  });
}

function topoBatches(chunks: ChunkRecord[]): ChunkRecord[][] {
  const byId = new Map(chunks.map((c) => [c.id, c]));
  const remaining = new Set(chunks.map((c) => c.id));
  const settled = new Set<string>();
  const batches: ChunkRecord[][] = [];

  while (remaining.size > 0) {
    const batch: ChunkRecord[] = [];
    for (const id of remaining) {
      const c = byId.get(id)!;
      if (c.depends_on.every((d) => settled.has(d))) batch.push(c);
    }
    if (batch.length === 0) throw new Error("dag-scheduler: topological sort stuck (cycle in depends_on?)");
    batches.push(batch);
    for (const c of batch) {
      remaining.delete(c.id);
      settled.add(c.id);
    }
  }

  return batches;
}

function kebab(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
