import type {
  PipelineState,
  NodeEvent,
  LiveBlock,
  Block,
  Stats,
} from "./pipelineEvents.js";
import { claudeTracePath } from "./claudeTracePath.js";

/**
 * Pure reducer: (state, event) => newState.
 *
 * Invariants (see spec "Reducer invariants"):
 *  1. Only `start` creates a live block.
 *  2. Only `end` moves a block from live to frozen. Each block moves exactly once.
 *  3. `trace-path`, `text`, `tool_use`, `interactive-ready` only mutate live.
 *  4. frozen is append-only. No existing frozen element is ever mutated.
 *  5. Exactly one new state returned per event.
 *  6. On `end` with missing stats, reducer fills from live.stats + (now - startedAt).
 *  7. The reducer NEVER calls functions stored on live (child, onDone). Those are
 *     pass-through references dispatched by PipelineApp after commit.
 */
export function pipelineReducer(state: PipelineState, event: NodeEvent): PipelineState {
  switch (event.kind) {
    case "start": {
      const live: LiveBlock = {
        id: `${event.nodeId}-${state.frozen.length}`,
        nodeId: event.nodeId,
        label: event.label,
        kind: event.blockKind,
        startedAt: Date.now(),
        body: [],
        stats: { turns: 0, tokensIn: 0, tokensOut: 0 },
      };
      return { ...state, live };
    }

    case "trace-path": {
      if (!state.live) return state;
      const tracePath = claudeTracePath(event.sessionId);
      return { ...state, live: { ...state.live, tracePath } };
    }

    case "text": {
      if (!state.live) return state;
      const body = [...state.live.body, { kind: "text" as const, role: event.role, text: event.text }];
      return { ...state, live: { ...state.live, body } };
    }

    case "tool_use": {
      if (!state.live) return state;
      const body = [...state.live.body, { kind: "tool_use" as const, name: event.name, summary: event.summary }];
      return { ...state, live: { ...state.live, body } };
    }

    case "stats": {
      if (!state.live) return state;
      const prev = state.live.stats;
      return { ...state, live: { ...state.live, stats: {
        turns: prev.turns + 1,
        tokensIn: prev.tokensIn + event.tokensIn,
        tokensOut: prev.tokensOut + event.tokensOut,
      }}};
    }

    case "interactive-ready": {
      if (!state.live) return state;
      return {
        ...state,
        live: { ...state.live, child: event.child, onDone: event.onDone },
      };
    }

    case "gate-ready": {
      if (!state.live) return state;
      return {
        ...state,
        live: { ...state.live, gate: { options: event.options, onChoose: event.onChoose } },
      };
    }

    case "end": {
      if (!state.live) return state;
      const filled = fillStats(state.live, event.stats);
      const frozen: Block = {
        id: state.live.id,
        nodeId: state.live.nodeId,
        label: state.live.label,
        kind: state.live.kind,
        tracePath: state.live.tracePath,
        body: state.live.body,
        outcome: event.outcome,
        stats: filled,
        onDone: state.live.onDone,
      };
      return { frozen: [...state.frozen, frozen], live: null };
    }
  }
}

function fillStats(live: LiveBlock, partial: Partial<Stats> | undefined): Stats {
  const durationMs = partial?.durationMs ?? Date.now() - live.startedAt;
  return {
    turns: partial?.turns ?? live.stats.turns,
    tokensIn: partial?.tokensIn ?? live.stats.tokensIn,
    tokensOut: partial?.tokensOut ?? live.stats.tokensOut,
    durationMs,
  };
}
