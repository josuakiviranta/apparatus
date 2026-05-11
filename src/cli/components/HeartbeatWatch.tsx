// src/cli/components/HeartbeatWatch.tsx
import React, { useState, useEffect, useRef } from "react";
import { Box, Text, useInput, useApp } from "ink";
import { stream } from "../../lib/daemon-client";
import type { Task } from "../../daemon/state";

interface LogEntry {
  taskId: string;
  ts: number;
  stream: string;
  content: string;
}

export function HeartbeatPane(): React.ReactElement {
  const { exit } = useApp();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [logs, setLogs] = useState<Record<string, LogEntry[]>>({});
  const acRef = useRef(new AbortController());

  useEffect(() => {
    const ac = acRef.current;
    stream("watch", {}, (msg) => {
      if (msg.type === "task_update") {
        setTasks((prev) => {
          const idx = prev.findIndex((t) => t.id === msg.data.id);
          if (idx === -1) return [...prev, msg.data];
          const next = [...prev];
          next[idx] = msg.data;
          return next;
        });
      } else if (msg.type === "log_line" && msg.taskId) {
        setLogs((prev) => ({
          ...prev,
          [msg.taskId]: [
            ...(prev[msg.taskId] ?? []).slice(-200),
            { taskId: msg.taskId, ts: msg.ts, stream: msg.stream, content: msg.content },
          ],
        }));
      }
    }, ac.signal).catch(() => {});
    return () => ac.abort();
  }, []);

  useInput((input, key) => {
    if (input === "q") { acRef.current.abort(); exit(); }
    if (key.upArrow) setSelectedIdx((i) => Math.max(0, i - 1));
    if (key.downArrow) setSelectedIdx((i) => Math.min(tasks.length - 1, i + 1));
  });

  const selected = tasks[selectedIdx];
  const selectedLogs = selected ? (logs[selected.id] ?? []) : [];

  return (
    <Box flexDirection="column" width={80}>
      {/* Task table */}
      <Box borderStyle="single" flexDirection="column" paddingX={1}>
        <Text bold>{"ID".padEnd(28)}{"INTERVAL".padEnd(10)}{"STATUS".padEnd(10)}LAST RUN</Text>
        {tasks.map((t, i) => {
          const lastRun = t.lastRunAt ? new Date(t.lastRunAt).toLocaleTimeString() : "never";
          const isSelected = i === selectedIdx;
          return (
            <Text key={t.id} color={isSelected ? "cyan" : undefined} bold={isSelected}>
              {(isSelected ? "▶ " : "  ") + t.id.padEnd(26)}
              {`${t.interval} min`.padEnd(10)}
              {t.status.padEnd(10)}
              {lastRun}
            </Text>
          );
        })}
        {tasks.length === 0 && <Text dimColor>No tasks registered</Text>}
      </Box>

      {/* Log pane */}
      <Box borderStyle="single" flexDirection="column" paddingX={1} height={12}>
        <Text bold dimColor>{selected?.id ?? "—"}</Text>
        {selectedLogs.slice(-10).map((l, i) => (
          <Text key={i} dimColor={l.stream === "system"}>
            [{l.stream}] {l.content}
          </Text>
        ))}
      </Box>

      <Text dimColor>↑↓ select  q quit</Text>
    </Box>
  );
}

export async function renderWatch(): Promise<void> {
  process.stderr.write("[apparat] `heartbeat watch` is deprecated; use `apparat status` instead.\n");
}
