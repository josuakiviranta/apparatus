import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { ABORT_CHOICE } from "../lib/interactions/drivers/gate.js";

export function GateSelector({
  options,
  onChoose,
}: {
  options: string[];
  onChoose: (choice: string) => void;
}) {
  const [selected, setSelected] = useState(0);

  useInput((input, key) => {
    if (key.escape) { onChoose(ABORT_CHOICE); return; }
    if (key.upArrow) setSelected((i) => Math.max(0, i - 1));
    if (key.downArrow) setSelected((i) => Math.min(options.length - 1, i + 1));
    if (key.return) onChoose(options[selected]);
    const digit = parseInt(input);
    if (!isNaN(digit) && digit >= 1 && digit <= options.length) {
      onChoose(options[digit - 1]);
    }
  });

  return (
    <Box flexDirection="column" marginLeft={2}>
      {options.map((opt, i) => (
        <Text key={i} color={i === selected ? "green" : undefined}>
          {i === selected ? "▶ " : "  "}
          {i + 1}. {opt}
        </Text>
      ))}
      <Text dimColor>{"  "}↑↓ navigate · Enter or 1-{options.length} to choose · Esc to abort</Text>
    </Box>
  );
}
