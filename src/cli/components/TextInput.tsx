import React, { useEffect, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
  focus?: boolean;
}

export function TextInput({
  value,
  onChange,
  onSubmit,
  disabled = false,
  placeholder = "",
  focus = true,
}: Props) {
  // Internal state drives rendering; external `value` prop syncs in via useEffect.
  // This avoids stale-closure issues when multiple keystrokes arrive in one React
  // render cycle (ink-testing-library delivers stdin synchronously).
  const [internal, setInternal] = useState(value);
  const [cursor, setCursor] = useState(value.length);

  // Sync external value changes (e.g. parent clearing the input after submit)
  useEffect(() => {
    setInternal(value);
    setCursor(value.length);
  }, [value]);

  // Refs so the useInput closure always sees the latest values
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

  const before = internal.slice(0, cursor);
  const at = internal.slice(cursor, cursor + 1) || " ";
  const after = internal.slice(cursor + 1);

  return (
    <Box>
      <Text>{before}</Text>
      <Text inverse>{at}</Text>
      <Text>{after}</Text>
    </Box>
  );
}
