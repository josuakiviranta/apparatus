import React, { useEffect, useReducer, useRef, useState } from "react";
import { render as inkRender, Box, Static, Text, useApp, useInput } from "ink";
import { pipelineReducer } from "../lib/pipelineReducer.js";
import { initialPipelineState, type NodeEvent, type Block, type BodyLine } from "../lib/pipelineEvents.js";
import { BodyLineView } from "./BlockView.js";
import { LiveFooter } from "./LiveFooter.js";
import { parseSlashCommand } from "../lib/slash-commands.js";
import { drivers } from "../lib/interactions/drivers/index.js";
import { claudeTracePath } from "../lib/claudeTracePath.js";
import type { StreamEvent } from "../lib/stream-formatter.js";
import type { FailureHandoff } from "../lib/failure-handoff.js";
import { inspectCommand } from "../lib/node-receive-inspector.js";
import { StreamLine } from "./ui.js";
import { __agentStatesForTest } from "../lib/interactions/drivers/agent.js";

export interface PipelineRunViewCallbacks {
  emit: (event: NodeEvent) => void;
  done: () => void;
}

interface Props {
  pipelineName: string;
  pid: number;
  goal?: string;
  nodes: string[];
  runId: string;
  tracePath: string;
  onReady: (cbs: PipelineRunViewCallbacks) => void;
}

const HEADER_WIDTH = 80;

type StaticItem =
  | { kind: "header";           id: string; pipelineName: string; pid: number; goal?: string; nodes: string[]; tracePath: string }
  | { kind: "block-open";       id: string; displayIndex: number; nodeId: string; label: string }
  | { kind: "received-context"; id: string; nodeReceiveId: string; runId: string; hasContext: boolean }
  | { kind: "trace-line";       id: string; tracePath: string }
  | { kind: "body-line";        id: string; line: BodyLine }
  | { kind: "stream-event";     id: string; event: StreamEvent }
  | { kind: "block-close";      id: string; block: Block }
  | { kind: "failure-handoff";  id: string; handoff: FailureHandoff };

function BlockCloseView({ block }: { block: Block }) {
  const glyph = block.outcome.status === "success" ? "✓" : "✗";
  const parts = [`  ${glyph} ${block.outcome.status}`];
  if (block.outcome.reason) parts.push(block.outcome.reason);
  parts.push(`${block.stats.turns} turns`);
  parts.push(`${block.stats.tokensIn}/${block.stats.tokensOut} tok`);
  parts.push((block.stats.durationMs / 1000).toFixed(1) + "s");
  return <Text dimColor>{parts.join(" · ")}</Text>;
}

export function PipelineRunView({ pipelineName, pid, goal, nodes, runId, tracePath, onReady }: Props) {
  const { exit } = useApp();
  const [state, dispatch] = useReducer(pipelineReducer, initialPipelineState);
  const [inputBuffer, setInputBuffer] = useState("");

  // Grow-only static items — append-only, never removed or mutated.
  const [staticItems, setStaticItems] = useState<StaticItem[]>(() => [
    { kind: "header", id: "__header__", pipelineName, pid, goal, nodes, tracePath },
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

  // Ctrl-C re-raises SIGINT; Esc delegates to the active block's driver keymap.
  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      process.kill(process.pid, "SIGINT");
      return;
    }
    if (key.escape && state.live) {
      drivers[state.live.kind].keymap.escape(state.live);
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
          const newItems: StaticItem[] = [
            { kind: "block-open", id, displayIndex, nodeId: event.nodeId, label: event.label },
          ];
          if (event.nodeReceiveId !== undefined) {
            newItems.push({
              kind: "received-context",
              id: `${id}-ctx`,
              nodeReceiveId: event.nodeReceiveId,
              runId,
              hasContext: event.hasContext ?? false,
            });
          }
          setStaticItems(prev => [...prev, ...newItems]);
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
        } else if (event.kind === "stream-line" && liveBlockIdRef.current) {
          const i = liveBodyCountRef.current++;
          setStaticItems(prev => [
            ...prev,
            { kind: "stream-event", id: `${liveBlockIdRef.current}-body-${i}`, event: event.event },
          ]);
        } else if (event.kind === "failure-handoff") {
          setStaticItems(prev => [
            ...prev,
            { kind: "failure-handoff", id: `failure-handoff-${event.handoff.nodeId}`, handoff: event.handoff },
          ]);
        }
        dispatch(event);
      },
      done: () => exit(),
    });
  }, []);

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
                <Text dimColor>{` run:   `}<Text dimColor={false}>{item.tracePath}</Text></Text>
              </Box>
            );
          }
          if (item.kind === "block-open") {
            const prefix = `━━ [${item.displayIndex}] ${item.nodeId} · ${item.label} `;
            const pad = Math.max(0, HEADER_WIDTH - prefix.length);
            return <Text key={item.id}>{prefix + "━".repeat(pad)}</Text>;
          }
          if (item.kind === "received-context") {
            const cmd = inspectCommand(item.runId, item.nodeReceiveId);
            const suffix = item.hasContext ? "" : "  (empty)";
            return (
              <Text key={item.id} dimColor>
                {"  received context: "}
                <Text dimColor={false}>{cmd}</Text>
                {suffix}
              </Text>
            );
          }
          if (item.kind === "trace-line") {
            return <Text key={item.id} dimColor>{`  trace: ${item.tracePath}`}</Text>;
          }
          if (item.kind === "body-line") {
            return <BodyLineView key={item.id} line={item.line} />;
          }
          if (item.kind === "stream-event") {
            return <StreamLine key={item.id} event={item.event} />;
          }
          if (item.kind === "block-close") {
            return (
              <Box key={item.id} flexDirection="column" marginBottom={1}>
                <BlockCloseView block={item.block} />
              </Box>
            );
          }
          if (item.kind === "failure-handoff") {
            const h = item.handoff;
            return (
              <Box key={item.id} flexDirection="column" marginBottom={1}>
                <Text>
                  {"✗ failed at "}{h.nodeId}
                  {h.agentRelPath ? ` (agent: ${h.agentRelPath})` : ""}
                  {": "}{h.reason}
                </Text>
                <Text>{`trace: ${h.tracePath}`}</Text>
                {h.rawOutputPath && <Text>{`raw output: ${h.rawOutputPath}`}</Text>}
                {h.nodeReceiveId && (
                  <Text>{`inspect: ${inspectCommand(h.runId, h.nodeReceiveId, { full: true })}`}</Text>
                )}
                <Text> </Text>
                <Text>{`resume: ${h.resumeCommand}`}</Text>
              </Box>
            );
          }
          return null;
        }}
      </Static>
      {state.live && (
        <LiveFooter
          block={state.live}
          inputBuffer={inputBuffer}
          onInputChange={setInputBuffer}
          onInputSubmit={async (raw: string) => {
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
            const id = liveBlockIdRef.current;
            const childEntry = id ? __agentStatesForTest.get(id) : undefined;
            const child = childEntry?.child;
            if (!child) return;
            if (parsed.kind === "end") {
              try { await child.end(); } catch { /* ignore */ }
              return;
            }
            if (parsed.kind === "abort") {
              try { await child.kill("SIGTERM"); } catch { /* ignore */ }
              return;
            }
            if (parsed.text.trim().length === 0) return;
            const msgIndex = liveBodyCountRef.current++;
            setStaticItems(prev => [
              ...prev,
              {
                kind: "body-line",
                id: `${id}-body-${msgIndex}`,
                line: { kind: "text", role: "you", text: parsed.text },
              },
            ]);
            dispatch({ kind: "text", role: "you", text: parsed.text });
            try { await child.submit(parsed.text); } catch (err) {
              dispatch({
                kind: "text",
                role: "system",
                text: `Failed to send: ${(err as Error).message}`,
              });
            }
          }}
        />
      )}
    </>
  );
}

// -------------------- Mount factory --------------------

export async function renderPipelineRunView(props: Omit<Props, "onReady">): Promise<{
  callbacks: PipelineRunViewCallbacks;
  waitUntilExit: () => Promise<void>;
}> {
  let resolve!: (cbs: PipelineRunViewCallbacks) => void;
  const ready = new Promise<PipelineRunViewCallbacks>((r) => { resolve = r; });

  const instance = inkRender(
    React.createElement(PipelineRunView, { ...props, onReady: (cbs) => resolve(cbs) }),
    { patchConsole: false, exitOnCtrlC: false },
  );

  const callbacks = await ready;
  return {
    callbacks,
    waitUntilExit: () => instance.waitUntilExit() as Promise<void>,
  };
}
