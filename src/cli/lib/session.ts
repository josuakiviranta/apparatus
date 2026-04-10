export type Turn =
  | { role: "user"; text: string; at: number }
  | {
      role: "assistant";
      text: string;
      toolCalls: ToolCall[];
      usage?: Usage;
      stopReason?: "end_turn" | "turn_limit" | "abort" | "error";
      at: number;
    }
  | { role: "tool_result"; toolCallId: string; content: string; isError: boolean; at: number }
  | { role: "system"; text: string; at: number };

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export type ExitReason =
  | "user_end"
  | "abort"
  | "turn_limit"
  | "child_crash"
  | "parse_error"
  | "parent_killed";

export interface InteractiveSessionDigest {
  output: string;
  success: boolean;
  turnsUsed: number;
  sessionId: string;
  exitReason: ExitReason;
  transcriptPath: null;
  digest: {
    messageCount: number;
    usage: Usage;
    tools: Array<{ name: string; count: number }>;
  };
}

export class Session {
  readonly id: string;
  history: Turn[] = [];
  exitReason?: ExitReason;

  constructor(id: string) {
    this.id = id;
  }

  lastAssistantText(): string {
    for (let i = this.history.length - 1; i >= 0; i--) {
      const t = this.history[i];
      if (t.role === "assistant") return t.text;
    }
    return "";
  }

  turnsUsed(): number {
    return this.history.filter((t) => t.role === "user").length;
  }

  aggregateUsage(): Usage {
    const acc: Usage = { inputTokens: 0, outputTokens: 0 };
    for (const t of this.history) {
      if (t.role === "assistant" && t.usage) {
        acc.inputTokens += t.usage.inputTokens;
        acc.outputTokens += t.usage.outputTokens;
        if (t.usage.cacheReadTokens !== undefined) {
          acc.cacheReadTokens = (acc.cacheReadTokens ?? 0) + t.usage.cacheReadTokens;
        }
        if (t.usage.cacheWriteTokens !== undefined) {
          acc.cacheWriteTokens = (acc.cacheWriteTokens ?? 0) + t.usage.cacheWriteTokens;
        }
      }
    }
    return acc;
  }

  toolCallsSummary(): Array<{ name: string; count: number }> {
    const counts = new Map<string, number>();
    for (const t of this.history) {
      if (t.role === "assistant") {
        for (const tc of t.toolCalls) {
          counts.set(tc.name, (counts.get(tc.name) ?? 0) + 1);
        }
      }
    }
    return Array.from(counts, ([name, count]) => ({ name, count }));
  }
}

export function buildSessionDigest(session: Session): InteractiveSessionDigest {
  return {
    output: session.lastAssistantText(),
    success: session.exitReason === "user_end" || session.exitReason === "turn_limit",
    turnsUsed: session.turnsUsed(),
    sessionId: session.id,
    exitReason: session.exitReason ?? "user_end",
    transcriptPath: null,
    digest: {
      messageCount: session.history.length,
      usage: session.aggregateUsage(),
      tools: session.toolCallsSummary(),
    },
  };
}
