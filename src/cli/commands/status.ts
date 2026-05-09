import { request } from "../../lib/daemon-client.js";
import { readProjects } from "../lib/projects-registry.js";
import { runsDir } from "../lib/apparat-paths.js";
import { readLastRunOutcome } from "../lib/pipeline-status.js";
import * as output from "../lib/output.js";
import type { Task } from "../../daemon/state.js";

interface ListTasksResponse {
  type: "tasks";
  data: Task[];
}

const DAEMON_TIMEOUT_MS = 1500;

async function listTasksWithTimeout(): Promise<Task[] | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), DAEMON_TIMEOUT_MS);
    request("list_tasks")
      .then((res) => {
        clearTimeout(timer);
        const r = res as ListTasksResponse;
        resolve(r?.data ?? []);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(null);
      });
  });
}

export async function statusCommand(): Promise<void> {
  const projects = readProjects();
  if (projects.length === 0) {
    await output.info("No projects registered yet. Run `apparat pipeline run …` in a project to register it.");
    return;
  }
  const tasks = await listTasksWithTimeout();
  await output.info(`Apparat status — ${projects.length} project(s)\n`);
  for (const p of [...projects].sort((a, b) => b.lastSeen - a.lastSeen)) {
    const projTasks = tasks === null
      ? null
      : tasks.filter((t) => t.args.includes(p.path));
    const last = readLastRunOutcome(runsDir(p.path));
    await output.info(`  ${p.path}`);
    await output.info(`    last seen: ${new Date(p.lastSeen).toLocaleString()}`);
    if (projTasks === null) {
      await output.info(`    heartbeat tasks: (daemon offline)`);
    } else {
      await output.info(`    heartbeat tasks: ${projTasks.length === 0 ? "(none)" : projTasks.map((t) => t.id).join(", ")}`);
    }
    if (last) {
      await output.info(`    last run: ${last.runId} — ${last.outcome} at ${last.timestamp}`);
    } else {
      await output.info(`    last run: (no runs yet)`);
    }
    await output.info("");
  }
}
