// src/cli/components/WatchApp.tsx
import React, { useState } from "react";
import { render, Box, Text, useInput, useApp } from "ink";
import { HeartbeatPane } from "./HeartbeatWatch.js";
import { PipelineApp, type PipelineAppCallbacks } from "./PipelineApp.js";
import { readProjects } from "../lib/projects-registry.js";
import { runsDir } from "../lib/apparat-paths.js";
import { readLastRunOutcome } from "../lib/pipeline-status.js";
import { replayTraceIntoApp } from "../lib/replayTraceIntoApp.js";
import { existsSync } from "fs";
import { join } from "path";

export function WatchApp(): React.ReactElement {
  const { exit } = useApp();
  const projects = readProjects();
  const [selectedIdx, setSelectedIdx] = useState(0);
  const selectedProject = projects[selectedIdx];

  // Resolve the latest completed run for the selected project, if any.
  let tracePath: string | null = null;
  let lastRunId: string | null = null;
  if (selectedProject) {
    const runsRoot = runsDir(selectedProject.path);
    const outcome = readLastRunOutcome(runsRoot);
    if (outcome) {
      lastRunId = outcome.runId;
      const candidate = join(runsRoot, outcome.runId, "pipeline.jsonl");
      if (existsSync(candidate)) {
        tracePath = candidate;
      }
    }
  }

  useInput((input, key) => {
    if (input === "q") { exit(); }
    if (key.tab) setSelectedIdx((i) => (i + 1) % Math.max(1, projects.length));
    if (key.upArrow) setSelectedIdx((i) => Math.max(0, i - 1));
    if (key.downArrow) setSelectedIdx((i) => Math.min(projects.length - 1, i + 1));
  });

  return (
    <Box flexDirection="column">
      <Text bold>apparat watch — {projects.length} project(s)</Text>
      <Text dimColor>
        tab: switch project ({selectedProject?.path ?? "—"})  •  q: quit
      </Text>
      <Box marginTop={1}>
        <HeartbeatPane />
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text bold>Latest run for {selectedProject?.path ?? "(no projects)"}</Text>
        {tracePath && lastRunId ? (
          <PipelineApp
            pipelineName="(replayed)"
            pid={process.pid}
            nodes={[]}
            runId={lastRunId}
            tracePath={tracePath}
            onReady={(cbs: PipelineAppCallbacks) =>
              replayTraceIntoApp(tracePath!, cbs.emit)
            }
          />
        ) : (
          <Text dimColor>(no completed runs)</Text>
        )}
      </Box>
    </Box>
  );
}

export async function renderWatchApp(): Promise<void> {
  const { waitUntilExit } = render(<WatchApp />);
  await waitUntilExit();
}
