import React, { useEffect, useState } from "react";
import { Box, Text, useApp, Static } from "ink";
import InkSpinner from "ink-spinner";
import type { StreamEvent } from "../lib/stream-formatter.js";

export function Step({ text }: { text: string }) {
  return <Text color="cyan">❯ {text}</Text>;
}

export function Info({ text }: { text: string }) {
  return <Text dimColor>{text}</Text>;
}

export function Warn({ text }: { text: string }) {
  return <Text color="yellow">⚠ {text}</Text>;
}

export function Error({ text }: { text: string }) {
  return <Text color="red">✖ {text}</Text>;
}

export function Success({ text }: { text: string }) {
  return <Text color="green">✔ {text}</Text>;
}

export function Header({ mode, project, branch, pid }: {
  mode: string;
  project: string;
  branch?: string;
  pid?: number;
}) {
  const line1 = [mode, branch, project].filter(Boolean).join("  ·  ");
  const line2 = pid !== undefined ? `PID ${pid}   ·  Ctrl+C or: kill ${pid}` : undefined;
  return (
    <Box borderStyle="single" flexDirection="column" paddingX={1}>
      <Text>{line1}</Text>
      {line2 && <Text dimColor>{line2}</Text>}
    </Box>
  );
}

export function StreamLine({ event }: { event: StreamEvent }) {
  switch (event.type) {
    case "main_agent_open":
      return <Text bold color="cyan">▶▶▶ MAIN AGENT</Text>;
    case "main_agent_close":
      return <Text color="cyan">◀◀◀ MAIN AGENT</Text>;
    case "subagent_open":
      return <Text bold color="yellow">▶ SUBAGENT: <Text bold={false} color="yellow">{event.description}</Text></Text>;
    case "subagent_close":
      return <Text color="yellow">◀ SUBAGENT</Text>;
    case "text":
      return <Text>{event.indented ? "  " : ""}{event.content}</Text>;
    case "tool":
      return <Text dimColor>{event.indented ? "  " : ""}→ [{event.name}] {event.label}</Text>;
    case "ctx":
      return <Text dimColor color="magenta">◈ ctx: {event.tokens.toLocaleString("en-US")} tokens</Text>;
  }
}

export function StreamOutput({ iter }: { iter: AsyncIterable<StreamEvent> }) {
  const { exit } = useApp();
  const [events, setEvents] = useState<StreamEvent[]>([]);

  useEffect(() => {
    (async () => {
      for await (const event of iter) {
        setEvents(prev => [...prev, event]);
      }
      exit();
    })();
  }, []);

  return (
    <Static items={events}>
      {(event, i) => <StreamLine key={i} event={event} />}
    </Static>
  );
}

export function SpinnerLine({ label, fn }: {
  label: string;
  fn: () => Promise<void>;
}) {
  const { exit } = useApp();
  const [state, setState] = useState<"running" | "done" | "failed">("running");
  const [msg, setMsg] = useState(label);

  useEffect(() => {
    fn()
      .then(() => { setMsg(`${label} done`); setState("done"); exit(); })
      .catch((err) => {
        const e = err as Error | undefined;
        setMsg(e?.message ?? String(err)); setState("failed"); exit();
      });
  }, []);

  if (state === "done")   return <Text color="green">✔ {msg}</Text>;
  if (state === "failed") return <Text color="yellow">⚠ {msg}</Text>;
  return <Text color="cyan"><InkSpinner type="dots" /> {label}</Text>;
}
