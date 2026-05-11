import React from "react";
import { render as inkRender } from "ink";
import { PipelineTraceView } from "../components/PipelineTraceView.js";

export async function renderTraceView(args: {
  tracePath: string;
  runId: string;
  isLive: boolean;
}): Promise<void> {
  let resolve!: () => void;
  const done = new Promise<void>((r) => { resolve = r; });

  const instance = inkRender(
    React.createElement(PipelineTraceView, {
      tracePath: args.tracePath,
      runId: args.runId,
      isLive: args.isLive,
      onPipelineEnd: () => resolve(),
    }),
    { patchConsole: false, exitOnCtrlC: true },
  );

  if (!args.isLive) {
    await new Promise(r => setTimeout(r, 10));
    resolve();
  }
  await done;
  instance.unmount();
}
