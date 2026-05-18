// src/cli/components/PipelineTraceView.tsx
import React, { useEffect, useState } from "react";
import { Box, Static, Text } from "ink";
import type { Block, BodyLine, NodeEvent } from "../lib/pipelineEvents.js";
import { BodyLineView } from "./BlockView.js";
import { StreamLine } from "./ui.js";
import type { StreamEvent } from "../lib/stream-formatter.js";
import { replayTraceIntoApp } from "../lib/replayTraceIntoApp.js";
import { tailPipelineJsonl, type TailHandle } from "../lib/pipeline-jsonl-tail.js";

type StaticItem =
  | { kind: "block-open";  id: string; nodeId: string; label: string }
  | { kind: "body-line";   id: string; line: BodyLine }
  | { kind: "stream-event"; id: string; event: StreamEvent }
  | { kind: "block-close"; id: string; block: Block };

interface Props {
  tracePath: string;
  runId: string;
  isLive: boolean;
  full?: boolean;
  onPipelineEnd?: () => void;
}

const HEADER_WIDTH = 80;

export function PipelineTraceView({ tracePath, runId: _runId, isLive, full, onPipelineEnd }: Props) {
  const [items, setItems] = useState<StaticItem[]>([]);

  useEffect(() => {
    let seq = 0;
    let liveBlockId: string | null = null;
    let liveNodeId: string | null = null;

    const handleEvent = (ev: NodeEvent) => {
      if (ev.kind === "start") {
        seq++;
        const id = `${ev.nodeId}-${seq}`;
        liveBlockId = id;
        liveNodeId = ev.nodeId;
        setItems(prev => [
          ...prev,
          { kind: "block-open", id, nodeId: ev.nodeId, label: ev.label },
        ]);
      } else if (ev.kind === "end" && liveBlockId && liveNodeId) {
        const closedId = liveBlockId;
        const closedNodeId = liveNodeId;
        setItems(prev => [
          ...prev,
          {
            kind: "block-close",
            id: `${closedId}-close`,
            block: {
              id: closedId,
              nodeId: closedNodeId,
              label: closedId,
              kind: "agent",
              body: [],
              outcome: ev.outcome,
              stats: { turns: 0, tokensIn: 0, tokensOut: 0, durationMs: 0 },
            },
          },
        ]);
      }
    };

    if (isLive) {
      const handle: TailHandle = tailPipelineJsonl(
        tracePath,
        handleEvent,
        () => { onPipelineEnd?.(); },
        { full },
      );
      return () => handle.stop();
    } else {
      replayTraceIntoApp(tracePath, handleEvent, { full });
    }
  }, [tracePath, isLive, full]);

  return (
    <Static items={items}>
      {(item) => {
        if (item.kind === "block-open") {
          const prefix = `━━ ${item.nodeId} · ${item.label} `;
          const pad = Math.max(0, HEADER_WIDTH - prefix.length);
          return <Text key={item.id}>{prefix + "━".repeat(pad)}</Text>;
        }
        if (item.kind === "body-line") return <BodyLineView key={item.id} line={item.line} />;
        if (item.kind === "stream-event") return <StreamLine key={item.id} event={item.event} />;
        if (item.kind === "block-close") {
          const glyph = item.block.outcome.status === "success" ? "✓" : "✗";
          return (
            <Box key={item.id} flexDirection="column" marginBottom={1}>
              <Text dimColor>{`  ${glyph} ${item.block.outcome.status}${item.block.outcome.reason ? ` · ${item.block.outcome.reason}` : ""}`}</Text>
            </Box>
          );
        }
        return null;
      }}
    </Static>
  );
}
