// src/cli/commands/status.ts
import { resolve } from "path";
import {
  getMissionControlState,
  type MissionZoom,
} from "../lib/mission-control.js";
import {
  renderAll, renderProject, renderPipeline, renderRun,
} from "../lib/mission-control-render.js";

export interface StatusArgs {
  project?: string;
  pipeline?: string;
  runId?: string;
}

export async function statusCommand(args: StatusArgs = {}): Promise<void> {
  const zoom = toZoom(args);
  const state = await getMissionControlState(zoom);
  if (state.level === "error") {
    process.stderr.write(state.message + "\n");
    process.exit(1);
  }
  switch (state.level) {
    case "all":      await renderAll(state); break;
    case "project":  await renderProject(state); break;
    case "pipeline": await renderPipeline(state); break;
    case "run":      await renderRun(state); break;
  }
}

function toZoom(args: StatusArgs): MissionZoom {
  if (!args.project) return { level: "all" };
  const projectPath = resolve(args.project);
  if (!args.pipeline) return { level: "project", projectPath };
  if (!args.runId)    return { level: "pipeline", projectPath, pipelineName: args.pipeline };
  return { level: "run", projectPath, pipelineName: args.pipeline, runId: args.runId };
}
