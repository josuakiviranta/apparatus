import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { Entry } from "../lib/sweep-fs.js";
import { formatSize } from "../lib/sweep-fs.js";

type Stage = "list" | "confirm";

export function SweepSelector({
  entries,
  onSubmit,
  onCancel,
}: {
  entries: Entry[];
  onSubmit: (selected: Entry[]) => void;
  onCancel: () => void;
}) {
  const [cursor, setCursor] = useState(0);
  const [picked, setPicked] = useState<boolean[]>(
    () => entries.map((e) => e.tag === "scratch"),
  );
  const [stage, setStage] = useState<Stage>("list");

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }

    if (stage === "list") {
      if (key.upArrow) setCursor((i) => Math.max(0, i - 1));
      if (key.downArrow) setCursor((i) => Math.min(entries.length - 1, i + 1));
      if (input === " ") {
        setPicked((prev) => {
          const next = prev.slice();
          next[cursor] = !next[cursor];
          return next;
        });
      }
      if (key.return) setStage("confirm");
      return;
    }

    if (stage === "confirm") {
      if (input === "y" || input === "Y") {
        const sel = entries.filter((_, i) => picked[i]);
        onSubmit(sel);
        return;
      }
      if (input === "n" || input === "N") {
        setStage("list");
        return;
      }
    }
  });

  const widthRel = Math.max(20, ...entries.map((e) => e.relPath.length)) + 2;

  if (stage === "confirm") {
    const sel = entries.filter((_, i) => picked[i]);
    const totalBytes = sel.reduce((a, e) => a + e.size, 0);
    return (
      <Box flexDirection="column" marginLeft={2}>
        <Text>About to delete {sel.length} entries ({formatSize(totalBytes)}):</Text>
        {sel.map((e, i) => (
          <Text key={i} color={e.tag === "curated" ? "yellow" : undefined}>
            {"  - "}
            {e.relPath}
            {e.tag === "curated" ? " [curated — warning]" : ""}
          </Text>
        ))}
        <Text dimColor>{"  "}y to confirm · n to go back · Esc to cancel</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginLeft={2}>
      {entries.map((e, i) => {
        const checked = picked[i];
        const marker = checked ? "[x]" : "[ ]";
        const warn = e.tag === "curated" ? "[!]" : "   ";
        const rel = e.relPath.padEnd(widthRel, " ");
        const size = formatSize(e.size).padStart(8, " ");
        const isCursor = i === cursor;
        return (
          <Text key={i} color={isCursor ? "green" : undefined}>
            {isCursor ? "▶ " : "  "}
            {marker} {warn} {rel} {size}  [{e.tag}]
          </Text>
        );
      })}
      <Text dimColor>
        {"  "}↑↓ navigate · Space to toggle · Enter to confirm · Esc to cancel
      </Text>
    </Box>
  );
}
