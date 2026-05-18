// src/cli/lib/pipeline-jsonl-tail.ts
import { existsSync, readFileSync, watch, type FSWatcher } from "fs";
import type { NodeEvent } from "./pipelineEvents.js";
import { mapTraceLineToEvent } from "./replayTraceIntoApp.js";
import { cleanJsonlEvents, type JsonlLine } from "./trace-cleaner.js";

export interface TailHandle {
  stop(): void;
}

/**
 * Tail a pipeline.jsonl file. On mount, seeds with whatever is on disk.
 * Then watches for appends via fs.watch and emits one NodeEvent per
 * newline-terminated line. Buffered (incomplete) trailing fragments are
 * held until the next read completes them.
 *
 * onPipelineEnd fires the first time a {kind:"pipeline-end"} line appears.
 * The consumer is responsible for calling handle.stop().
 */
export function tailPipelineJsonl(
  tracePath: string,
  onEvent: (ev: NodeEvent) => void,
  onPipelineEnd?: () => void,
  opts: { full?: boolean } = {},
): TailHandle {
  let offset = 0;
  let pending = "";
  let endFired = false;
  let watcher: FSWatcher | null = null;

  function readNew(): void {
    if (!existsSync(tracePath)) return;
    let text: string;
    try { text = readFileSync(tracePath, "utf8"); }
    catch { return; }
    if (text.length < offset) {
      offset = 0;
      pending = "";
    }
    if (text.length === offset) return;
    const chunk = pending + text.slice(offset);
    offset = text.length;
    const lines = chunk.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) {
      if (!line) continue;
      let parsed: JsonlLine | null = null;
      try { parsed = JSON.parse(line) as JsonlLine; } catch { /* fall through */ }
      if (parsed) {
        if (parsed.kind === "pipeline-end" && !endFired) {
          endFired = true;
          onPipelineEnd?.();
        }
        if (!opts.full) {
          const kept = cleanJsonlEvents([parsed]);
          if (kept.length === 0) continue;
          const ev = mapTraceLineToEvent(JSON.stringify(kept[0]));
          if (ev) onEvent(ev);
          continue;
        }
      }
      const ev = mapTraceLineToEvent(line);
      if (ev) onEvent(ev);
    }
  }

  readNew();
  try {
    watcher = watch(tracePath, () => readNew());
  } catch {
    watcher = null;
  }
  return {
    stop: () => {
      try { watcher?.close(); } catch { /* ignore */ }
      watcher = null;
    },
  };
}
