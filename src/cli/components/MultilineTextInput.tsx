import React, { useEffect, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
  focus?: boolean;
  prefixWidth?: number;
}

export function MultilineTextInput({
  value,
  onChange,
  onSubmit,
  disabled = false,
  placeholder = "",
  focus = true,
  prefixWidth = 0,
}: Props) {
  const [internal, setInternal] = useState(value);
  const [cursor, setCursor] = useState(value.length);

  // Gated on `internalRef.current` so parent echoes of this component's own
  // `onChange` calls are ignored — only genuine external diffs reset cursor.
  useEffect(() => {
    if (value !== internalRef.current) {
      setInternal(value);
      setCursor(value.length);
    }
  }, [value]);

  const internalRef = useRef(internal);
  internalRef.current = internal;
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;

  useInput(
    (input, key) => {
      if (disabled) return;
      const v = internalRef.current;
      const c = cursorRef.current;

      if (key.return) {
        onSubmit(v);
        return;
      }
      if (key.backspace || key.delete) {
        if (c > 0) {
          const next = v.slice(0, c - 1) + v.slice(c);
          internalRef.current = next;
          cursorRef.current = c - 1;
          setInternal(next);
          setCursor(c - 1);
          onChange(next);
        }
        return;
      }
      if (key.leftArrow) {
        const nc = Math.max(0, c - 1);
        cursorRef.current = nc;
        setCursor(nc);
        return;
      }
      if (key.rightArrow) {
        const nc = Math.min(v.length, c + 1);
        cursorRef.current = nc;
        setCursor(nc);
        return;
      }
      if (key.ctrl && input === "a") {
        cursorRef.current = 0;
        setCursor(0);
        return;
      }
      if (key.ctrl && input === "e") {
        cursorRef.current = v.length;
        setCursor(v.length);
        return;
      }

      if (input && !key.ctrl && !key.meta) {
        const next = v.slice(0, c) + input + v.slice(c);
        const nc = c + input.length;
        internalRef.current = next;
        cursorRef.current = nc;
        setInternal(next);
        setCursor(nc);
        onChange(next);
      }
    },
    { isActive: focus && !disabled },
  );

  if (internal.length === 0 && placeholder) {
    return (
      <Box>
        <Text dimColor>{placeholder}</Text>
      </Box>
    );
  }

  const N = internal.length;
  const columns = process.stdout.columns ?? 80;
  const wrapWidth = Math.max(10, columns - prefixWidth);

  const rowCount = Math.max(1, Math.ceil((N + 1) / wrapWidth));
  const rows: string[] = [];
  for (let i = 0; i < rowCount; i++) {
    rows.push(internal.slice(i * wrapWidth, (i + 1) * wrapWidth));
  }
  const cursorRow = Math.min(rowCount - 1, Math.floor(cursor / wrapWidth));
  const cursorCol = cursor - cursorRow * wrapWidth;

  return (
    <Box flexDirection="column">
      {rows.map((row, i) => {
        if (i !== cursorRow) {
          return <Text key={i}>{row}</Text>;
        }
        const before = row.slice(0, cursorCol);
        const cursorChar = row.slice(cursorCol, cursorCol + 1) || " ";
        const after = row.slice(cursorCol + 1);
        return (
          <Text key={i}>
            {before}
            <Text inverse>{cursorChar}</Text>
            {after}
          </Text>
        );
      })}
    </Box>
  );
}
