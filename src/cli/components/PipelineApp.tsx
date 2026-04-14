import React, { useEffect, useReducer, useRef, useState } from "react";
import { render as inkRender, Box, Static, Text, useApp, useInput } from "ink";
import { pipelineReducer } from "../lib/pipelineReducer.js";
import { initialPipelineState, type NodeEvent, type Block, type BodyLine } from "../lib/pipelineEvents.js";
import { BodyLineView } from "./BlockView.js";
import { LiveFooter, type LiveBlockWithInput } from "./LiveFooter.js";
import { parseSlashCommand } from "../lib/slash-commands.js";
import { claudeTracePath } from "../lib/claudeTracePath.js";

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

const HEADER_WIDTH = 80;

type StaticItem =
  | { kind: "header";     id: string; pipelineName: string; pid: number; goal?: string; nodes: string[] }
  | { kind: "block-open"; id: string; displayIndex: number; nodeId: string; label: string }
  | { kind: "trace-line"; id: string; tracePath: string }
  | { kind: "body-line";  id: string; line: BodyLine }
  | { kind: "block-close"; id: string; block: Block };

function BlockCloseView({ block }: { block: Block }) {
  const glyph = block.outcome.status === "success" ? "✓" : "✗";
  const parts = [`  ${glyph} ${block.outcome.status}`];
  if (block.outcome.reason) parts.push(block.outcome.reason);
  parts.push(`${block.stats.turns} turns`);
  parts.push(`${block.stats.tokensIn}/${block.stats.tokensOut} tok`);
  parts.push((block.stats.durationMs / 1000).toFixed(1) + "s");
  return <Text dimColor>{parts.join(" · ")}</Text>;
}

export function PipelineApp({ pipelineName, pid, goal, nodes, onReady }: Props) {
  const { exit } = useApp();
  const [state, dispatch] = useReducer(pipelineReducer, initialPipelineState);
  const [inputBuffer, setInputBuffer] = useState("");

  // Grow-only static items — append-only, never removed or mutated.
  const [staticItems, setStaticItems] = useState<StaticItem[]>(() => [
    { kind: "header", id: "__header__", pipelineName, pid, goal, nodes },
  ]);

  // Refs for constructing stable IDs in the emit wrapper (no stale closures).
  const liveBlockIdRef    = useRef<string | null>(null);
  const liveBodyCountRef  = useRef(0);
  const frozenCountRef    = useRef(0);
  const blockSeqRef       = useRef(0);  // monotonic block counter for display index
  const traceAppendedRef  = useRef(false); // emit at most one trace-line per block

  // Track which frozen blocks have had their block-close item appended.
  const staticCloseSeen = useRef<Set<string>>(new Set());

  // Tracks which frozen blocks have already had their onDone dispatched.
  const doneDispatched = useRef<Set<string>>(new Set());

  // Post-commit effect: append block-close items for newly frozen blocks
  // and dispatch onDone callbacks exactly once.
  useEffect(() => {
    const newCloseItems: StaticItem[] = [];
    for (const block of state.frozen) {
      if (!staticCloseSeen.current.has(block.id)) {
        staticCloseSeen.current.add(block.id);
        frozenCountRef.current = state.frozen.length;
        newCloseItems.push({ kind: "block-close", id: `${block.id}-close`, block });
      }
      if (block.onDone && !doneDispatched.current.has(block.id)) {
        doneDispatched.current.add(block.id);
        try { block.onDone(); } catch { /* swallow */ }
      }
    }
    if (newCloseItems.length > 0) {
      setStaticItems(prev => [...prev, ...newCloseItems]);
    }
  }, [state.frozen]);

  // Re-raise SIGINT when C-c is pressed in raw mode (Ink suppresses the signal;
  // this restores the expected abort behavior via the pipeline's onSignal handler).
  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      process.kill(process.pid, "SIGINT");
    }
  }, { isActive: !!process.stdin.isTTY });

  // Fire onReady exactly once.
  const readyOnce = useRef(false);
  useEffect(() => {
    if (readyOnce.current) return;
    readyOnce.current = true;
    onReady({
      emit: (event) => {
        // Append static items for content-producing events.
        if (event.kind === "start") {
          blockSeqRef.current++;
          const id = `${event.nodeId}-${blockSeqRef.current}`;
          liveBlockIdRef.current = id;
          liveBodyCountRef.current = 0;
          traceAppendedRef.current = false;
          const displayIndex = blockSeqRef.current;
          setStaticItems(prev => [
            ...prev,
            { kind: "block-open", id, displayIndex, nodeId: event.nodeId, label: event.label },
          ]);
        } else if (event.kind === "trace-path" && liveBlockIdRef.current && !traceAppendedRef.current) {
          traceAppendedRef.current = true;
          const tracePath = claudeTracePath(event.sessionId);
          setStaticItems(prev => [
            ...prev,
            { kind: "trace-line", id: `${liveBlockIdRef.current}-trace`, tracePath },
          ]);
        } else if (event.kind === "text" && liveBlockIdRef.current) {
          const i = liveBodyCountRef.current++;
          setStaticItems(prev => [
            ...prev,
            { kind: "body-line", id: `${liveBlockIdRef.current}-body-${i}`,
              line: { kind: "text", role: event.role, text: event.text } },
          ]);
        } else if (event.kind === "tool_use" && liveBlockIdRef.current) {
          const i = liveBodyCountRef.current++;
          setStaticItems(prev => [
            ...prev,
            { kind: "body-line", id: `${liveBlockIdRef.current}-body-${i}`,
              line: { kind: "tool_use", name: event.name, summary: event.summary } },
          ]);
        }
        dispatch(event);
      },
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
          if (item.kind === "block-open") {
            const prefix = `━━ [${item.displayIndex}] ${item.nodeId} · ${item.label} `;
            const pad = Math.max(0, HEADER_WIDTH - prefix.length);
            return <Text key={item.id}>{prefix + "━".repeat(pad)}</Text>;
          }
          if (item.kind === "trace-line") {
            return <Text key={item.id} dimColor>{`  trace: ${item.tracePath}`}</Text>;
          }
          if (item.kind === "body-line") {
            return <BodyLineView key={item.id} line={item.line} />;
          }
          if (item.kind === "block-close") {
            return (
              <Box key={item.id} flexDirection="column" marginBottom={1}>
                <BlockCloseView block={item.block} />
              </Box>
            );
          }
          return null;
        }}
      </Static>
      {liveForRender && (
        <LiveFooter block={liveForRender} index={blockSeqRef.current} />
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
