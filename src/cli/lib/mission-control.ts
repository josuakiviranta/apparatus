import { readProjects, type ProjectEntry } from "./projects-registry.js";
import {
  listAllRuns, listRunsForPipeline, summarizeRun,
  type RunSummary,
} from "./runs-index.js";
import { readLastRunOutcome, type LastRunOutcome } from "./pipeline-status.js";
import { listAllPipelines, type PipelineEntry } from "./pipeline-resolver.js";
import { runsDir } from "./apparat-paths.js";
import { request } from "../../lib/daemon-client.js";
import type { Task } from "../../daemon/state.js";
import { existsSync } from "fs";
import { join } from "path";

const DAEMON_TIMEOUT_MS = 1500;

interface ListTasksResponse { type: "tasks"; data: Task[] }

async function listTasksWithTimeout(): Promise<Task[] | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), DAEMON_TIMEOUT_MS);
    request("list_tasks")
      .then((res) => {
        clearTimeout(timer);
        const r = res as ListTasksResponse;
        resolve(r?.data ?? []);
      })
      .catch(() => { clearTimeout(timer); resolve(null); });
  });
}

export type MissionZoom =
  | { level: "all" }
  | { level: "project";  projectPath: string }
  | { level: "pipeline"; projectPath: string; pipelineName: string }
  | { level: "run";      projectPath: string; pipelineName: string; runId: string };

export interface MissionRunningNow {
  projectPath: string;
  pipelineName: string;
  runId: string;
  startedAt: string | null;
}

export interface MissionStateAll {
  level: "all";
  projects: ProjectEntry[];
  runningNow: MissionRunningNow[];
  lastRunPerProject: Record<string, LastRunOutcome | null>;
  tasks: Task[] | "daemon-offline";
  zoomHint: string;
}

export interface MissionStateProject {
  level: "project";
  project: ProjectEntry;
  pipelines: PipelineEntry[];
  recentRuns: RunSummary[];
  tasks: Task[] | "daemon-offline";
  zoomHint: string;
}

export interface MissionStatePipeline {
  level: "pipeline";
  project: ProjectEntry;
  pipeline: PipelineEntry;
  runs: RunSummary[];
  liveRun: RunSummary | null;
  zoomHint: string;
}

export interface MissionStateRun {
  level: "run";
  project: ProjectEntry;
  pipeline: PipelineEntry | null;
  run: RunSummary;
  tracePath: string;
  isLive: boolean;
  zoomHint: "";
}

export type MissionState =
  | MissionStateAll
  | MissionStateProject
  | MissionStatePipeline
  | MissionStateRun
  | { level: "error"; message: string };

export async function getMissionControlState(zoom: MissionZoom): Promise<MissionState> {
  switch (zoom.level) {
    case "all":      return projectAll();
    case "project":  return projectOne(zoom.projectPath);
    case "pipeline": return projectPipeline(zoom.projectPath, zoom.pipelineName);
    case "run":      return projectRun(zoom.projectPath, zoom.pipelineName, zoom.runId);
  }
}

async function projectAll(): Promise<MissionStateAll> {
  const projects = readProjects();
  const tasksPromise = listTasksWithTimeout();
  const runningNow: MissionRunningNow[] = [];
  const lastRunPerProject: Record<string, LastRunOutcome | null> = {};

  for (const p of projects) {
    const root = runsDir(p.path);
    for (const r of listAllRuns(root)) {
      if (r.outcome === "in-progress") {
        runningNow.push({
          projectPath: p.path,
          pipelineName: r.pipelineName ?? "(unknown)",
          runId: r.runId,
          startedAt: r.startedAt,
        });
      }
    }
    lastRunPerProject[p.path] = readLastRunOutcome(root);
  }

  const tasksRaw = await tasksPromise;
  const tasks: Task[] | "daemon-offline" = tasksRaw === null ? "daemon-offline" : tasksRaw;
  const firstProject = [...projects].sort((a, b) => b.lastSeen - a.lastSeen)[0];
  const zoomHint = firstProject ? `apparat status ${firstProject.path}` : "";

  return { level: "all", projects, runningNow, lastRunPerProject, tasks, zoomHint };
}

async function projectOne(projectPath: string): Promise<MissionState> {
  const projects = readProjects();
  const project = projects.find(p => p.path === projectPath);
  if (!project) {
    return { level: "error", message: `project not registered: ${projectPath} (apparat status to see roster)` };
  }
  const pipelines = listAllPipelines(project.path);
  const recentRuns = listAllRuns(runsDir(project.path));
  const tasksRaw = await listTasksWithTimeout();
  const tasks: Task[] | "daemon-offline" = tasksRaw === null
    ? "daemon-offline"
    : tasksRaw.filter(t => t.args.includes(project.path));
  const firstPipeline = pipelines[0];
  const zoomHint = firstPipeline
    ? `apparat status ${project.path} ${firstPipeline.name}`
    : `apparat status ${project.path}`;
  return {
    level: "project",
    project,
    pipelines,
    recentRuns,
    tasks,
    zoomHint,
  };
}

async function projectPipeline(
  projectPath: string,
  pipelineName: string,
): Promise<MissionState> {
  const projects = readProjects();
  const project = projects.find(p => p.path === projectPath);
  if (!project) {
    return { level: "error", message: `project not registered: ${projectPath} (apparat status to see roster)` };
  }
  const pipelines = listAllPipelines(project.path);
  const pipeline = pipelines.find(e => e.name === pipelineName);
  if (!pipeline) {
    return {
      level: "error",
      message: `pipeline not found: ${pipelineName} (apparat status ${projectPath} to see roster)`,
    };
  }
  const runs = listRunsForPipeline(runsDir(project.path), pipelineName);
  const liveRun = runs.find(r => r.outcome === "in-progress") ?? null;
  const newestRunId = runs[0]?.runId;
  const zoomHint = newestRunId
    ? `apparat status ${project.path} ${pipelineName} ${newestRunId}`
    : `apparat status ${project.path} ${pipelineName}`;
  return { level: "pipeline", project, pipeline, runs, liveRun, zoomHint };
}

async function projectRun(
  projectPath: string,
  pipelineName: string,
  runId: string,
): Promise<MissionState> {
  const projects = readProjects();
  const project = projects.find(p => p.path === projectPath);
  if (!project) {
    return { level: "error", message: `project not registered: ${projectPath} (apparat status to see roster)` };
  }
  const root = runsDir(project.path);
  if (!existsSync(join(root, runId))) {
    return {
      level: "error",
      message: `run not found: ${runId} (apparat status ${projectPath} ${pipelineName} to see runs)`,
    };
  }
  const run = summarizeRun(root, runId);
  const tracePath = join(root, runId, "pipeline.jsonl");
  const pipeline = listAllPipelines(project.path).find(e => e.name === pipelineName) ?? null;
  return {
    level: "run",
    project,
    pipeline,
    run,
    tracePath,
    isLive: run.outcome === "in-progress",
    zoomHint: "",
  };
}
