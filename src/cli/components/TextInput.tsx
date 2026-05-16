import React, { useEffect, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
  focus?: boolean;
  // Columns already consumed on the same row by adjacent siblings (e.g. a
  // "> " prefix renders at width 2). TextInput subtracts this from
  // process.stdout.columns when computing its sliding view window.
  prefixWidth?: number;
}

export function TextInput({
  value,
  onChange,
  onSubmit,
  disabled = false,
  placeholder = "",
  focus = true,
  prefixWidth = 0,
}: Props) {
  // Internal state drives rendering; external `value` prop syncs in via useEffect.
  // This avoids stale-closure issues when multiple keystrokes arrive in one React
  // render cycle (ink-testing-library delivers stdin synchronously).
  const [internal, setInternal] = useState(value);
  const [cursor, setCursor] = useState(value.length);

  // Sync external value changes (e.g. parent clearing the input after submit).
  // Gated on `internalRef.current` so parent echoes of this component's own
  // `onChange` calls are ignored — only genuine external diffs reset cursor.
  useEffect(() => {
    if (value !== internalRef.current) {
      setInternal(value);
      setCursor(value.length);
    }
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

  const N = internal.length;
  // Treat the cursor's resting position past EOL as index N: the inverse
  // block occupies one cell even when there's no character there.
  const logicalLen = N + 1;

  const columns = process.stdout.columns ?? 80;
  const reserve = 1; // block cursor at EOL
  const budgetGross = Math.max(10, columns - prefixWidth - reserve);

  // Anchor the window so the cursor sits ~70% across the visible width:
  // typing past the right edge feels like the line scrolls under the cursor
  // (address-bar UX from the approved explainer).
  const VIEW_CURSOR_RATIO = 0.7;
  let viewStart = Math.max(0, cursor - Math.floor(budgetGross * VIEW_CURSOR_RATIO));
  viewStart = Math.min(viewStart, Math.max(0, logicalLen - budgetGross));
  let viewEnd = Math.min(logicalLen, viewStart + budgetGross);

  // Provisional indicator decision against the gross window.
  let leftMarker = viewStart > 0;
  let rightMarker = viewEnd < logicalLen;

  // Indicators steal one column each. Re-anchor so the cursor stays in view
  // when the window was right-pinned.
  const budgetNet =
    budgetGross - (leftMarker ? 1 : 0) - (rightMarker ? 1 : 0);
  viewStart = Math.min(viewStart, Math.max(0, logicalLen - budgetNet));
  viewEnd = Math.min(logicalLen, viewStart + budgetNet);

  // Markers can flip after the re-anchor — recompute against the net window.
  leftMarker = viewStart > 0;
  rightMarker = viewEnd < logicalLen;

  // Slice the three segments against the net view window.
  const beforeStart = Math.max(viewStart, 0);
  const beforeEnd = Math.min(cursor, viewEnd);
  const beforeSlice = internal.slice(beforeStart, beforeEnd);

  const cursorChar = internal.slice(cursor, cursor + 1) || " ";
  const cursorVisible = cursor >= viewStart && cursor < viewEnd;
  const atSlice = cursorVisible ? cursorChar : "";

  const afterStart = Math.max(cursor + 1, viewStart);
  const afterEnd = Math.min(N, viewEnd);
  const afterSlice = afterStart < afterEnd ? internal.slice(afterStart, afterEnd) : "";

  return (
    <Box>
      {leftMarker ? <Text dimColor>{"\u2039"}</Text> : null}
      <Text>{beforeSlice}</Text>
      <Text inverse>{atSlice || " "}</Text>
      <Text>{afterSlice}</Text>
      {rightMarker ? <Text dimColor>{"\u203A"}</Text> : null}
    </Box>
  );
}
