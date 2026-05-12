import React from "react";
import { Box, Text } from "ink";
import type { LiveBlock } from "../lib/pipelineEvents.js";
import { drivers } from "../lib/interactions/drivers/index.js";

function formatElapsed(startedAt: number): string {
  const ms = Date.now() - startedAt;
  return (ms / 1000).toFixed(1) + "s";
}

function statusLine(block: LiveBlock): string {
  if (block.kind === "wait-human") {
    return `  ◆ awaiting choice · ${formatElapsed(block.startedAt)}`;
  }
  const verb = block.kind === "interactive-agent" ? "awaiting" : "streaming";
  const icon = block.kind === "interactive-agent" ? "●" : "⠋";
  const parts = [
    `  ${icon} ${verb}`,
    `${block.stats.turns} turns`,
    `${block.stats.tokensIn}/${block.stats.tokensOut} tok`,
    formatElapsed(block.startedAt),
  ];
  return parts.join(" · ");
}

export function LiveFooter({
  block,
  inputBuffer,
  onInputChange,
  onInputSubmit,
}: {
  block: LiveBlock;
  inputBuffer: string;
  onInputChange: (v: string) => void;
  onInputSubmit: (v: string) => Promise<void>;
}) {
  const [, tick] = React.useState(0);
  React.useEffect(() => {
    const id = setInterval(() => tick(n => n + 1), 100);
    return () => clearInterval(id);
  }, []);
  const footer = drivers[block.kind].renderFooter(block, {
    inputBuffer,
    onInputChange,
    onInputSubmit,
  });
  return (
    <Box flexDirection="column">
      {footer}
      <Text dimColor>{statusLine(block)}</Text>
    </Box>
  );
}
