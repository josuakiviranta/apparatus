// src/cli/lib/mission-control-render.ts
import * as output from "./output.js";
import type {
  MissionStateAll, MissionStateProject, MissionStatePipeline, MissionStateRun,
} from "./mission-control.js";
import type { RunSummary } from "./runs-index.js";
import { renderTraceView } from "./render-trace-view.js";

function glyph(o: RunSummary["outcome"]): string {
  return o === "success" ? "✓" : o === "failure" ? "✗" : o === "in-progress" ? "…" : "·";
}

async function emitZoomHint(hint: string): Promise<void> {
  if (hint) await output.info(`zoom in: ${hint}`);
}

export async function renderAll(s: MissionStateAll): Promise<void> {
  if (s.projects.length === 0) {
    await output.info("No projects registered yet. Run `apparat pipeline run …` in a project to register it.");
    return;
  }
  await output.info(`Apparat status — ${s.projects.length} project(s)\n`);
  if (s.runningNow.length > 0) {
    await output.info("running now:");
    for (const r of s.runningNow) {
      await output.info(`  ${r.projectPath}  ${r.pipelineName}  ${r.runId}${r.startedAt ? `  started ${r.startedAt}` : ""}`);
    }
    await output.info("");
  }
  for (const p of [...s.projects].sort((a, b) => b.lastSeen - a.lastSeen)) {
    await output.info(`  ${p.path}`);
    await output.info(`    last seen: ${new Date(p.lastSeen).toLocaleString()}`);
    if (s.tasks === "daemon-offline") {
      await output.info(`    heartbeat tasks: (daemon offline)`);
    } else {
      const projTasks = s.tasks.filter(t => t.args.includes(p.path));
      await output.info(`    heartbeat tasks: ${projTasks.length === 0 ? "(none)" : projTasks.map(t => t.id).join(", ")}`);
    }
    const last = s.lastRunPerProject[p.path];
    if (last) {
      await output.info(`    last run: ${last.runId} — ${last.outcome} at ${last.timestamp}`);
    } else {
      await output.info(`    last run: (no runs yet)`);
    }
    await output.info("");
  }
  await emitZoomHint(s.zoomHint);
}

export async function renderProject(s: MissionStateProject): Promise<void> {
  await output.info(`${s.project.path} — pipelines\n`);
  if (s.pipelines.length === 0) {
    await output.info("  (no pipelines)");
  } else {
    for (const e of s.pipelines) await output.info(`  ${e.name}`);
  }
  await output.info("");
  await output.info("recent runs:");
  if (s.recentRuns.length === 0) {
    await output.info("  (none)");
  } else {
    for (const r of s.recentRuns) {
      const ts = r.startedAt ?? "(unknown start)";
      const dur = r.durationMs !== null ? `${(r.durationMs / 1000).toFixed(1)}s` : "—";
      await output.info(`  ${glyph(r.outcome)}  ${r.runId}  ${r.pipelineName ?? "(unknown)"}  ${ts}  ${dur}`);
    }
  }
  await output.info("");
  await emitZoomHint(s.zoomHint);
}

export async function renderPipeline(s: MissionStatePipeline): Promise<void> {
  await output.info(`${s.project.path} / ${s.pipeline.name}\n`);
  await output.info("recent runs:");
  if (s.runs.length === 0) {
    await output.info("  (none)");
  } else {
    for (const r of s.runs) {
      const ts = r.startedAt ?? "(unknown start)";
      const dur = r.durationMs !== null ? `${(r.durationMs / 1000).toFixed(1)}s` : "—";
      const tail = r.outcome === "failure" && r.failedNodeId ? `   failed at: ${r.failedNodeId}` : "";
      await output.info(`  ${glyph(r.outcome)}  ${r.runId}  ${ts}  ${dur}${tail}`);
    }
  }
  await output.info("");
  await emitZoomHint(s.zoomHint);
}

export async function renderRun(s: MissionStateRun): Promise<void> {
  await output.info(`${s.project.path} / ${s.run.pipelineName ?? "(unknown)"} / ${s.run.runId}\n`);
  await renderTraceView({
    tracePath: s.tracePath,
    runId: s.run.runId,
    isLive: s.isLive,
  });
}
