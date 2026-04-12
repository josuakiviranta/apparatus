import React, { useEffect, useReducer, useRef, useState } from "react";
import { render as inkRender, Box, Static, Text, useApp, useInput } from "ink";
import { pipelineReducer } from "../lib/pipelineReducer.js";
import { initialPipelineState, type NodeEvent, type Block } from "../lib/pipelineEvents.js";
import { BlockView } from "./BlockView.js";
import { LiveFooter, type LiveBlockWithInput } from "./LiveFooter.js";
import { parseSlashCommand } from "../lib/slash-commands.js";

export interface PipelineAppCallbacks {
  emit: (event: NodeEvent) => void;
  done: () => void;
}

interface Props {
  pipelineName: string;
  pid: number;
  goal?: string;
  nodes: string[];
  onReady: (cbs: PipelineAppCallbacks) => void;
}

type StaticItem =
  | { kind: "header"; id: string; pipelineName: string; pid: number; goal?: string; nodes: string[] }
  | { kind: "block"; id: string; block: Block };

export function PipelineApp({ pipelineName, pid, goal, nodes, onReady }: Props) {
  const { exit } = useApp();
  const [state, dispatch] = useReducer(pipelineReducer, initialPipelineState);
  const [inputBuffer, setInputBuffer] = useState("");

  // Tracks which frozen blocks have already had their onDone dispatched.
  const doneDispatched = useRef<Set<string>>(new Set());

  // Post-commit effect: scan frozen for any block with an undispatched onDone
  // and call it exactly once.
  useEffect(() => {
    for (const block of state.frozen) {
      if (block.onDone && !doneDispatched.current.has(block.id)) {
        doneDispatched.current.add(block.id);
        try { block.onDone(); } catch { /* swallow */ }
      }
    }
  }, [state.frozen]);

  // Re-raise SIGINT when C-c is pressed in raw mode (Ink suppresses the signal;
  // this restores the expected abort behavior via the pipeline's onSignal handler).
  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      process.kill(process.pid, "SIGINT");
    }
  });

  // Fire onReady exactly once.
  const readyOnce = useRef(false);
  useEffect(() => {
    if (readyOnce.current) return;
    readyOnce.current = true;
    onReady({
      emit: (event) => dispatch(event),
      done: () => exit(),
    });
  }, []);

  // Build the render-layer LiveBlockWithInput from the reducer state + local
  // input buffer + slash-command dispatch.
  const liveForRender: LiveBlockWithInput | null = (() => {
    if (!state.live) return null;
    if (state.live.kind !== "interactive-agent" || !state.live.child) {
      return state.live;
    }
    const child = state.live.child;
    return {
      ...state.live,
      input: {
        value: inputBuffer,
        onChange: setInputBuffer,
        onSubmit: async (raw: string) => {
          setInputBuffer("");
          const parsed = parseSlashCommand(raw);
          if (parsed.kind === "help") {
            dispatch({ kind: "text", role: "system", text: "commands: /end /abort /help" });
            return;
          }
          if (parsed.kind === "unknown") {
            dispatch({ kind: "text", role: "system", text: `unknown command: ${parsed.raw}` });
            return;
          }
          if (parsed.kind === "end") {
            try { await child.end(); } catch { /* ignore */ }
            return;
          }
          if (parsed.kind === "abort") {
            try { await child.kill("SIGTERM"); } catch { /* ignore */ }
            return;
          }
          // Plain message
          if (parsed.text.trim().length === 0) return;
          dispatch({ kind: "text", role: "you", text: parsed.text });
          try { await child.submit(parsed.text); } catch (err) {
            dispatch({
              kind: "text", role: "system",
              text: `Failed to send: ${(err as Error).message}`,
            });
          }
        },
      },
    };
  })();

  // Assemble static items: header is always item 0, followed by frozen blocks.
  const staticItems: StaticItem[] = [
    { kind: "header", id: "__header__", pipelineName, pid, goal, nodes },
    ...state.frozen.map((b) => ({ kind: "block" as const, id: b.id, block: b })),
  ];

  return (
    <>
      <Static items={staticItems}>
        {(item) => {
          if (item.kind === "header") {
            return (
              <Box key={item.id} flexDirection="column" marginBottom={1}>
                <Text dimColor>
                  {` ${item.pipelineName}  ·  PID ${item.pid}${item.goal ? `  ·  goal: ${item.goal}` : ""}`}
                </Text>
                {item.nodes.length > 0 && (
                  <Text dimColor>{` nodes: ${item.nodes.join(" → ")}`}</Text>
                )}
              </Box>
            );
          }
          const blockIndex = staticItems.findIndex((it) => it.id === item.id);
          return <BlockView key={item.id} block={item.block} index={blockIndex} />;
        }}
      </Static>
      {liveForRender && (
        <LiveFooter block={liveForRender} index={state.frozen.length + 1} />
      )}
    </>
  );
}

// -------------------- Mount factory --------------------

export async function renderPipelineApp(props: Omit<Props, "onReady">): Promise<{
  callbacks: PipelineAppCallbacks;
  waitUntilExit: () => Promise<void>;
}> {
  let resolve!: (cbs: PipelineAppCallbacks) => void;
  const ready = new Promise<PipelineAppCallbacks>((r) => { resolve = r; });

  const instance = inkRender(
    React.createElement(PipelineApp, { ...props, onReady: (cbs) => resolve(cbs) }),
    { patchConsole: false, exitOnCtrlC: false },
  );

  const callbacks = await ready;
  return {
    callbacks,
    waitUntilExit: () => instance.waitUntilExit() as Promise<void>,
  };
}
