import React from "react";
import { Box, Text } from "ink";
import type { Block, BodyLine } from "../lib/pipelineEvents.js";

const HEADER_WIDTH = 80;

function roleColor(role: "you" | "claude" | "system"): string {
  switch (role) {
    case "you": return "green";
    case "claude": return "blue";
    case "system": return "gray";
  }
}

export function BodyLineView({ line }: { line: BodyLine }) {
  if (line.kind === "text") {
    return (
      <Text>
        <Text bold color={roleColor(line.role)}>{line.role}:</Text> {line.text}
      </Text>
    );
  }
  return <Text dimColor>[tool_use: {line.name}] {line.summary}</Text>;
}

function headerLine(index: number, nodeId: string, label: string): string {
  const prefix = `━━ [${index}] ${nodeId} · ${label} `;
  const pad = Math.max(0, HEADER_WIDTH - prefix.length);
  return prefix + "━".repeat(pad);
}

function formatDuration(ms: number): string {
  return (ms / 1000).toFixed(1) + "s";
}

function outcomeLine(block: Block): string {
  const glyph = block.outcome.status === "success" ? "✓" : "✗";
  const parts = [
    `${glyph} ${block.outcome.status}`,
  ];
  if (block.outcome.reason) {
    parts.push(block.outcome.reason);
  }
  parts.push(`${block.stats.turns} turns`);
  parts.push(`${block.stats.tokensIn}/${block.stats.tokensOut} tok`);
  parts.push(formatDuration(block.stats.durationMs));
  return parts.join(" · ");
}

export function BlockView({ block, index }: { block: Block; index: number }) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text>{headerLine(index, block.nodeId, block.label)}</Text>
      {block.tracePath && <Text dimColor>  trace: {block.tracePath}</Text>}
      {block.body.map((line, i) => <BodyLineView key={i} line={line} />)}
      <Text dimColor>{outcomeLine(block)}</Text>
    </Box>
  );
}
