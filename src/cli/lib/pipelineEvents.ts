import type { ChildHandle } from "./agent.js";
import type { BlockKind } from "./classifyNode.js";
import type { StreamEvent } from "./stream-formatter.js";

export type BodyLine =
  | { kind: "text"; role: "you" | "claude" | "system"; text: string }
  | { kind: "tool_use"; name: string; summary: string };

export type Stats = {
  turns: number;
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
};

export type Outcome = {
  status: "success" | "fail" | "abort";
  reason?: string;
};

export type NodeEvent =
  | { kind: "start"; nodeId: string; label: string; blockKind: BlockKind; nodeReceiveId?: string; hasContext?: boolean }
  | { kind: "trace-path"; sessionId: string }
  | { kind: "text"; role: "you" | "claude" | "system"; text: string }
  | { kind: "tool_use"; name: string; summary: string }
  | { kind: "stats"; tokensIn: number; tokensOut: number }
  | { kind: "interactive-ready"; child: ChildHandle; onDone: () => void }
  | { kind: "gate-ready"; options: string[]; onChoose: (choice: string) => void }
  | { kind: "stream-line"; event: StreamEvent }
  | { kind: "end"; outcome: Outcome; stats?: Partial<Stats> };

export type Block = {
  id: string;             // stable key for <Static>, e.g. `${nodeId}-${frozenIndex}`
  nodeId: string;
  label: string;
  kind: BlockKind;
  tracePath?: string;     // absolute path to ~/.claude/projects/<cwd>/<sid>.jsonl
  body: BodyLine[];
  outcome: Outcome;
  stats: Stats;
  // Carried forward from LiveBlock at freeze time so PipelineApp's post-commit
  // effect can dispatch it deterministically. The reducer never INVOKES onDone.
  onDone?: () => void;
};

export type LiveBlock = {
  id: string;
  nodeId: string;
  label: string;
  kind: BlockKind;
  tracePath?: string;
  startedAt: number;
  body: BodyLine[];
  stats: { turns: number; tokensIn: number; tokensOut: number };
  child?: ChildHandle;
  onDone?: () => void;
  gate?: {
    options: string[];
    onChoose: (choice: string) => void;
  };
};

export type PipelineState = {
  frozen: Block[];
  live: LiveBlock | null;
};

export const initialPipelineState: PipelineState = {
  frozen: [],
  live: null,
};
