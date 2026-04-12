import React from "react";
import { Box, Text } from "ink";
import type { LiveBlock } from "../lib/pipelineEvents.js";
import { BodyLineView } from "./BlockView.js";
import { TextInput } from "./TextInput.js";

const HEADER_WIDTH = 80;

export interface LiveBlockWithInput extends LiveBlock {
  input?: {
    value: string;
    onChange: (v: string) => void;
    onSubmit: (v: string) => void;
  };
}

function headerLine(index: number, nodeId: string, label: string): string {
  const prefix = `━━ [${index}] ${nodeId} · ${label} `;
  const pad = Math.max(0, HEADER_WIDTH - prefix.length);
  return prefix + "━".repeat(pad);
}

function formatElapsed(startedAt: number): string {
  const ms = Date.now() - startedAt;
  return (ms / 1000).toFixed(1) + "s";
}

function statusLine(block: LiveBlockWithInput): string {
  const icon = block.input ? "●" : "⠋";
  const verb = block.input ? "awaiting" : "streaming";
  const parts = [
    `  ${icon} ${verb}`,
    `${block.stats.turns} turns`,
    `${block.stats.tokensIn}/${block.stats.tokensOut} tok`,
    formatElapsed(block.startedAt),
  ];
  return parts.join(" · ");
}

export function LiveFooter({ block, index }: { block: LiveBlockWithInput; index: number }) {
  const [, tick] = React.useState(0);
  React.useEffect(() => {
    const id = setInterval(() => tick(n => n + 1), 100);
    return () => clearInterval(id);
  }, []);
  return (
    <Box flexDirection="column">
      <Text>{headerLine(index, block.nodeId, block.label)}</Text>
      {block.tracePath && <Text dimColor>  trace: {block.tracePath}</Text>}
      {block.body.map((line, i) => <BodyLineView key={i} line={line} />)}
      <Text dimColor>{statusLine(block)}</Text>
      {block.input && (
        <Box>
          <Text color="gray">{"> "}</Text>
          <TextInput
            value={block.input.value}
            onChange={block.input.onChange}
            onSubmit={block.input.onSubmit}
          />
        </Box>
      )}
    </Box>
  );
}
