import React, { useEffect, useState } from "react";
import { render, Box, Text, useApp, Static } from "ink";
import { StreamLine } from "./ui.js";
import type { StreamEvent } from "../lib/stream-formatter.js";
import type { Session, ExitReason } from "../lib/session.js";
import type { ChildHandle } from "../lib/agent.js";

export type DisplayLine =
  | { kind: "stream"; event: StreamEvent }
  | { kind: "step"; text: string }
  | { kind: "info"; text: string }
  | { kind: "warn"; text: string }
  | { kind: "success"; text: string };

export interface ChatProps {
  session: Session;
  child: ChildHandle;
  tracePath: string;
  onExit: (reason: ExitReason) => void;
}

export interface PipelineDisplayCallbacks {
  push: (line: DisplayLine) => void;
  setStatus: (nodeLabel: string) => void;
  setChat: (props: ChatProps | null) => void;
  done: () => void;
}

interface Props {
  pipelineName: string;
  pid: number;
  goal?: string;
  onReady: (cbs: PipelineDisplayCallbacks) => void;
}

function DisplayLineComponent({ line }: { line: DisplayLine }) {
  switch (line.kind) {
    case "stream":
      return <StreamLine event={line.event} />;
    case "step":
      return <Text color="cyan">❯ {line.text}</Text>;
    case "info":
      return <Text dimColor>  {line.text}</Text>;
    case "warn":
      return <Text color="yellow">⚠ {line.text}</Text>;
    case "success":
      return <Text color="green">✔ {line.text}</Text>;
  }
}

export function PipelineDisplay({ pipelineName, pid, onReady }: Props) {
  const { exit } = useApp();
  const [lines, setLines] = useState<DisplayLine[]>([]);
  const [currentNode, setCurrentNode] = useState<string>("");
  const [_chat, setChat] = useState<ChatProps | null>(null);

  useEffect(() => {
    onReady({
      push: (line) => setLines((prev) => [...prev, line]),
      setStatus: (label) => setCurrentNode(label),
      setChat,
      done: () => exit(),
    });
  }, []);

  return (
    <>
      <Static items={lines}>
        {(line, i) => <Box key={i}><DisplayLineComponent line={line} /></Box>}
      </Static>
      <Box borderStyle="single" borderColor="cyan">
        <Text>
          <Text color="cyan">◆ {pipelineName}</Text>
          {currentNode ? <Text dimColor> · </Text> : null}
          {currentNode ? <Text color="yellow">{currentNode}</Text> : null}
          <Text dimColor>  ·  PID {pid}  ·  Ctrl+C to stop</Text>
        </Text>
      </Box>
    </>
  );
}

export async function renderPipelineDisplay(props: Omit<Props, "onReady">): Promise<{
  callbacks: PipelineDisplayCallbacks;
  waitUntilExit: () => Promise<void>;
}> {
  let resolve: (cbs: PipelineDisplayCallbacks) => void;
  const ready = new Promise<PipelineDisplayCallbacks>((r) => { resolve = r; });

  const instance = render(
    React.createElement(PipelineDisplay, {
      ...props,
      onReady: (cbs) => resolve!(cbs),
    })
  );

  const callbacks = await ready;
  return { callbacks, waitUntilExit: () => instance.waitUntilExit() as Promise<void> };
}
