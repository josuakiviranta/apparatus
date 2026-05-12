import type {
  PipelineState,
  NodeEvent,
  LiveBlock,
  Block,
  Stats,
} from "./pipelineEvents.js";
import { drivers } from "./interactions/drivers/index.js";
import { isInteractionKind } from "./classifyNode.js";
import { claudeTracePath } from "./claudeTracePath.js";

/**
 * Pure reducer: (state, event) => newState.
 *
 * Invariants (see spec "Reducer invariants"):
 *  1. Only `start` creates a live block.
 *  2. Only `end` moves a block from live to frozen. Each block moves exactly once.
 *  3. `trace-path`, `text`, `tool_use`, `driver-event` only mutate live.
 *  4. frozen is append-only. No existing frozen element is ever mutated.
 *  5. Exactly one new state returned per event.
 *  6. On `end` with missing stats, reducer fills from live.stats + (now - startedAt).
 *  7. The reducer NEVER calls functions stored in driver state (child, onDone,
 *     onChoose). Drivers expose them; PipelineRunView dispatches them after
 *     commit.
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

    case "driver-event": {
      if (!state.live || !isInteractionKind(state.live.kind)) return state;
      const driver = drivers[state.live.kind];
      const newLive = driver.reduce(event.payload, state.live);
      return newLive === state.live ? state : { ...state, live: newLive };
    }

    case "stream-line":
      return state;

    case "end": {
      if (!state.live) return state;
      const filled = fillStats(state.live, event.stats);
      const freezeExtras = isInteractionKind(state.live.kind)
        ? (drivers[state.live.kind].onFreeze?.(state.live, event.outcome) ?? {})
        : {};
      const frozen: Block = {
        id: state.live.id,
        nodeId: state.live.nodeId,
        label: state.live.label,
        kind: state.live.kind,
        tracePath: state.live.tracePath,
        body: state.live.body,
        outcome: event.outcome,
        stats: filled,
        ...freezeExtras,
      };
      return { frozen: [...state.frozen, frozen], live: null };
    }

    case "failure-handoff":
      return state;
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
