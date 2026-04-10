import React, { useEffect, useState, useCallback, useRef } from "react";
import { Box, Static, Text } from "ink";
import type { Session, Turn, Usage, ExitReason, ToolCall } from "../lib/session.js";
import type { ChildHandle } from "../lib/agent.js";
import { parseSlashCommand, HELP_TEXT } from "../lib/slash-commands.js";
import { TextInput } from "./TextInput.js";

type Status = "streaming" | "awaiting" | "ended";

interface Props {
  session: Session;
  child: ChildHandle;
  onExit: (reason: ExitReason) => void;
}

export function ChatUI({ session, child, onExit }: Props) {
  const [history, setHistory] = useState<Turn[]>(() => [...session.history]);
  const [streamingText, setStreamingText] = useState("");
  const [inputBuffer, setInputBuffer] = useState("");
  // Start in "awaiting": Claude Code in stream-json mode waits for the first
  // user turn before producing any response, so the initial state must allow
  // TextInput to capture input immediately.
  const [status, setStatus] = useState<Status>("awaiting");
  const [lastUsage, setLastUsage] = useState<Usage | undefined>();

  // Accumulate per-turn deltas and tool calls for the in-flight assistant turn
  const pendingText = useRef<string>("");
  const pendingToolCalls = useRef<ToolCall[]>([]);

  // Consume child events
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        for await (const ev of child.events) {
          if (cancelled) break;

          if (ev.type === "assistant_delta") {
            pendingText.current += ev.textDelta;
            setStreamingText(pendingText.current);
          } else if (ev.type === "tool_use") {
            pendingToolCalls.current.push(ev.toolCall);
          } else if (ev.type === "result") {
            const stop: "end_turn" | "turn_limit" | "abort" | "error" =
              ev.stopReason === "turn_limit" ? "turn_limit"
              : ev.stopReason === "abort" ? "abort"
              : ev.stopReason === "error" ? "error"
              : "end_turn";
            const assistantTurn: Turn = {
              role: "assistant",
              text: pendingText.current || ev.text,
              toolCalls: pendingToolCalls.current.slice(),
              usage: ev.usage,
              stopReason: stop,
              at: Date.now(),
            };
            session.history.push(assistantTurn);
            setHistory([...session.history]);
            setStreamingText("");
            setLastUsage(ev.usage);
            pendingText.current = "";
            pendingToolCalls.current.length = 0;

            if (ev.stopReason === "turn_limit") {
              setStatus("ended");
              session.exitReason = "turn_limit";
              onExit("turn_limit");
            } else {
              setStatus("awaiting");
            }
          } else if (ev.type === "parse_error") {
            session.history.push({
              role: "system",
              text: `stream-json parse error: ${ev.error} (line: ${ev.rawLine.slice(0, 80)})`,
              at: Date.now(),
            });
            setHistory([...session.history]);
          } else if (ev.type === "tool_result") {
            session.history.push({
              role: "tool_result",
              toolCallId: ev.toolCallId,
              content: ev.content,
              isError: ev.isError,
              at: Date.now(),
            });
            setHistory([...session.history]);
          }
        }
      } catch (err) {
        session.history.push({
          role: "system",
          text: `event stream error: ${(err as Error).message}`,
          at: Date.now(),
        });
        setHistory([...session.history]);
      }
    })();
    return () => { cancelled = true; };
  }, [child, session, onExit]);

  // Detect child crash
  useEffect(() => {
    let cancelled = false;
    child.exited.then((res) => {
      if (cancelled) return;
      if (session.exitReason !== undefined) return;
      if (res.code !== 0 && res.code !== null) {
        session.exitReason = "child_crash";
        setStatus("ended");
        const stderrMsg = res.stderrTail.trim();
        const text = stderrMsg
          ? `Child process exited with code ${res.code}:\n${stderrMsg}`
          : `Child process exited with code ${res.code}`;
        session.history.push({
          role: "system",
          text,
          at: Date.now(),
        });
        setHistory([...session.history]);
        onExit("child_crash");
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [child, session, onExit]);

  // SIGINT handler
  useEffect(() => {
    const handler = () => {
      if (session.exitReason !== undefined) return;
      session.exitReason = "abort";
      setStatus("ended");
      child.kill("SIGTERM").finally(() => onExit("abort"));
    };
    process.once("SIGINT", handler);
    return () => {
      process.removeListener("SIGINT", handler);
    };
  }, [child, session, onExit]);

  const handleSubmit = useCallback(
    async (raw: string) => {
      setInputBuffer("");
      const parsed = parseSlashCommand(raw);

      if (parsed.kind === "help") {
        session.history.push({ role: "system", text: HELP_TEXT, at: Date.now() });
        setHistory([...session.history]);
        return;
      }
      if (parsed.kind === "unknown") {
        session.history.push({
          role: "system",
          text: `Unknown command: ${parsed.raw}. Type /help.`,
          at: Date.now(),
        });
        setHistory([...session.history]);
        return;
      }
      if (parsed.kind === "end") {
        setStatus("ended");
        session.exitReason = "user_end";
        try { await child.end(); } catch {}
        onExit("user_end");
        return;
      }
      if (parsed.kind === "abort") {
        setStatus("ended");
        session.exitReason = "abort";
        try { await child.kill("SIGTERM"); } catch {}
        onExit("abort");
        return;
      }
      // regular message
      if (parsed.text.trim().length === 0) return;
      session.history.push({ role: "user", text: parsed.text, at: Date.now() });
      setHistory([...session.history]);
      setStatus("streaming");
      try {
        await child.submit(parsed.text);
      } catch (err) {
        session.history.push({
          role: "system",
          text: `Failed to send: ${(err as Error).message}`,
          at: Date.now(),
        });
        setHistory([...session.history]);
        setStatus("awaiting");
      }
    },
    [child, session, onExit],
  );

  return (
    <Box flexDirection="column">
      <Static items={history.map((turn, i) => ({ turn, key: `${turn.at}-${i}` }))}>
        {(item) => <TurnView key={item.key} turn={item.turn} />}
      </Static>
      {status === "streaming" && streamingText ? (
        <Box marginTop={1}>
          <Text color="cyan">{streamingText}</Text>
        </Box>
      ) : null}
      <Box marginTop={1}>
        <Text color="gray">{"> "}</Text>
        <TextInput
          value={inputBuffer}
          onChange={setInputBuffer}
          onSubmit={handleSubmit}
          disabled={status !== "awaiting"}
          placeholder="Type a message, /help, or /end"
        />
      </Box>
      <StatusBar status={status} turnsUsed={session.turnsUsed()} usage={lastUsage} />
    </Box>
  );
}

function TurnView({ turn }: { turn: Turn }) {
  if (turn.role === "user") {
    return (
      <Box marginTop={1}>
        <Text color="green">you: </Text>
        <Text>{turn.text}</Text>
      </Box>
    );
  }
  if (turn.role === "assistant") {
    return (
      <Box marginTop={1}>
        <Text color="cyan">claude: </Text>
        <Text>{turn.text}</Text>
      </Box>
    );
  }
  if (turn.role === "system") {
    return (
      <Box marginTop={1}>
        <Text dimColor>{turn.text}</Text>
      </Box>
    );
  }
  if (turn.role === "tool_result") {
    return (
      <Box marginTop={1}>
        <Text color={turn.isError ? "red" : "yellow"} dimColor>
          [tool result {turn.isError ? "(error) " : ""}{turn.toolCallId}]
        </Text>
      </Box>
    );
  }
  return null;
}

function StatusBar({
  status,
  turnsUsed,
  usage,
}: {
  status: Status;
  turnsUsed: number;
  usage?: Usage;
}) {
  const parts = [`status: ${status}`, `turns: ${turnsUsed}`];
  if (usage) parts.push(`in/out: ${usage.inputTokens}/${usage.outputTokens}`);
  return (
    <Box marginTop={1}>
      <Text dimColor>{parts.join("  |  ")}</Text>
    </Box>
  );
}
