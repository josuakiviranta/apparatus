// src/cli/commands/heartbeat.ts
import { Command } from "commander";
import { resolve, basename, dirname } from "path";
import { statSync, Stats, readFileSync } from "fs";
import { resolvePipelineArg, isNameShorthand } from "../lib/pipeline-resolver.js";
import { request, stream } from "../../lib/daemon-client";
import { parseDot } from "../../attractor/core/graph.js";
import { findVarReferences } from "../../attractor/transforms/variable-expansion.js";
import type { Task } from "../../daemon/state";
import * as output from "../lib/output.js";

/**
 * Resolves the heartbeat `pipeline` positional arg. Shorthand (e.g. `janitor`)
 * routes through the shared resolver to find bundled or project-local pipelines;
 * literal paths (containing `/` or `.dot`) resolve as-is.
 */
export function resolveHeartbeatPipelineArg(arg: string, project: string): string {
  if (isNameShorthand(arg)) {
    return resolvePipelineArg(arg, project);
  }
  return resolve(arg);
}

/**
 * Validate that an argument resolves to an existing path of the expected kind.
 * Writes a clear message to stderr and exits the process before the daemon is
 * contacted. The error deliberately shows BOTH the original arg and the
 * resolved absolute path so that the common "double-join" mistake (running
 * `apparat heartbeat meditate apparat-cli` from inside a folder already named
 * `apparat-cli`) is obvious at a glance.
 *
 * Not using output.error() here because Ink rendering is async and can be
 * truncated by an immediate process.exit(); errors also belong on stderr.
 */
function validatePathArg(
  originalArg: string,
  absPath: string,
  kind: "directory" | "file",
  label: string,
): void {
  const fail = (detail: string): never => {
    console.error(
      `${label} not found: ${absPath}\n` +
      `(argument "${originalArg}" was resolved against cwd ${process.cwd()})\n` +
      detail
    );
    process.exit(1);
  };
  let stat: Stats;
  try {
    stat = statSync(absPath);
  } catch {
    fail("The resolved path does not exist on disk.");
    return;
  }
  if (kind === "directory" && !stat.isDirectory()) {
    fail(`Expected a directory, but the resolved path is a ${stat.isFile() ? "file" : "non-directory"}.`);
    return;
  }
  if (kind === "file" && !stat.isFile()) {
    fail(`Expected a file, but the resolved path is a ${stat.isDirectory() ? "directory" : "non-file"}.`);
    return;
  }
}

function formatTable(tasks: Task[]): void {
  if (tasks.length === 0) {
    console.log("No heartbeat tasks registered.");
    return;
  }
  const border = "\u2500".repeat(72);
  console.log(border);
  console.log(
    "ID".padEnd(30) +
    "INTERVAL".padEnd(10) +
    "STATUS".padEnd(10) +
    "LAST RUN"
  );
  console.log(border);
  for (const t of tasks) {
    const lastRun = t.lastRunAt ? new Date(t.lastRunAt).toLocaleTimeString() : "never";
    console.log(
      t.id.padEnd(30) +
      `${t.interval} min`.padEnd(10) +
      t.status.padEnd(10) +
      lastRun
    );
  }
  console.log(border);
}

export function registerHeartbeatCommand(program: Command): void {
  const hb = program
    .command("heartbeat")
    .description("Manage background scheduled tasks (daemon-backed; persists across terminal sessions)")
    .addHelpText("after", `
Examples:
  apparat heartbeat list
  apparat heartbeat watch`);

  hb
    .command("implement <folder>")
    .description("Schedule the agentic build loop to run on a project folder at a fixed interval")
    .addHelpText("after", "\nExamples:\n  apparat heartbeat implement my-app --every 60\n")
    .requiredOption("--every <n>", "interval in minutes", (v) => {
      const n = parseInt(v, 10);
      if (isNaN(n) || n < 1) throw new Error("--every must be a positive integer");
      return n;
    })
    .action(async (folder: string, opts: { every: number }) => {
      const absPath = resolve(folder);
      validatePathArg(folder, absPath, "directory", "Project folder");
      try {
        const res = await request("register_task", {
          command: "implement",
          args: [absPath],
          interval: opts.every,
        });
        await output.success(`Registered: ${res.taskId} (every ${opts.every} min)`);
      } catch (err: any) {
        await output.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });

  hb
    .command("pipeline <dotfile>")
    .description("Schedule a DOT-graph pipeline to run at a fixed interval")
    .addHelpText("after", "\nExamples:\n  apparat heartbeat pipeline workflow.dot --project my-app --every 60\n  apparat heartbeat pipeline janitor      --project my-app --every 720\n")
    .option("--project <folder>", "project folder passed to the pipeline")
    .requiredOption("--every <n>", "interval in minutes", (v) => {
      const n = parseInt(v, 10);
      if (isNaN(n) || n < 1) throw new Error("--every must be a positive integer");
      return n;
    })
    .action(async (dotfile: string, opts: { project?: string; every: number }) => {
      const projectForResolver = opts.project ? resolve(opts.project) : process.cwd();
      const absDotFile = resolveHeartbeatPipelineArg(dotfile, projectForResolver);
      validatePathArg(dotfile, absDotFile, "file", "Pipeline dotfile");

      // Warn if pipeline is marked as headless-unsafe
      const dotSrc = readFileSync(absDotFile, "utf8");
      const dotGraph = parseDot(dotSrc);
      if (dotGraph.headlessSafe === false) {
        await output.warn(
          `Warning: ${basename(absDotFile)} has headless_safe=false and will be ` +
          `rejected when the daemon runs it without a TTY.`
        );
      }

      // Refuse to schedule a pipeline that references $project without a
      // --project binding — every scheduled run would otherwise fail with
      // [project_binding_missing] and never produce any output.
      if (!opts.project) {
        const refs = findVarReferences(dotGraph, "project");
        if (refs.length > 0) {
          console.error(
            `✗ Pipeline references $project but --project was not passed.\n` +
            `  Pass --project <folder> to apparat heartbeat pipeline.\n` +
            `  Nodes referencing $project: ${refs.join(", ")}`
          );
          process.exit(1);
        }
      }

      // Folder-form pipelines are all named `<folder>/pipeline.dot`; using the
      // basename alone collapses every one to `pipeline:pipeline` and they
      // collide. Fall back to the parent folder name in that case.
      let stem = basename(absDotFile).replace(/\.dot$/i, "");
      if (stem === "pipeline") {
        stem = basename(dirname(absDotFile));
      }
      const id = `pipeline:${stem}`;
      const args: string[] = ["run", absDotFile];
      if (opts.project) {
        const absProject = resolve(opts.project);
        validatePathArg(opts.project, absProject, "directory", "Project folder");
        args.push("--project", absProject);
      }
      try {
        const res = await request("register_task", {
          id,
          command: "pipeline",
          args,
          interval: opts.every,
        });
        await output.success(`Registered: ${res.taskId} (every ${opts.every} min)`);
      } catch (err: any) {
        await output.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });

  hb
    .command("list")
    .description("List all registered tasks with their status and last run time")
    .action(async () => {
      try {
        const res = await request("list_tasks");
        formatTable(res.data);
      } catch (err: any) {
        await output.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });

  hb
    .command("stop <id>")
    .description("Remove a task from the schedule and kill any running session")
    .addHelpText("after", "\nExamples:\n  apparat heartbeat stop meditate:my-app\n")
    .action(async (id: string) => {
      try {
        await request("stop_task", { taskId: id });
        await output.success(`Stopped and removed: ${id}`);
      } catch (err: any) {
        await output.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });

  hb
    .command("pause <id>")
    .description("Suspend scheduling for a task without removing it")
    .addHelpText("after", "\nExamples:\n  apparat heartbeat pause meditate:my-app\n")
    .action(async (id: string) => {
      try {
        await request("pause_task", { taskId: id });
        await output.success(`Paused: ${id}`);
      } catch (err: any) {
        await output.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });

  hb
    .command("resume <id>")
    .description("Re-enable scheduling for a paused task")
    .addHelpText("after", "\nExamples:\n  apparat heartbeat resume meditate:my-app\n")
    .action(async (id: string) => {
      try {
        await request("resume_task", { taskId: id });
        await output.success(`Resumed: ${id}`);
      } catch (err: any) {
        await output.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });

  hb
    .command("kill <id>")
    .description("Kill the currently running session for a task; schedule is preserved")
    .addHelpText("after", "\nExamples:\n  apparat heartbeat kill meditate:my-app\n")
    .action(async (id: string) => {
      try {
        await request("kill_session", { taskId: id });
        await output.success(`Session killed: ${id}`);
      } catch (err: any) {
        await output.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });

  hb
    .command("logs <id>")
    .description("Print logs for a task; use --follow to stream live output")
    .addHelpText("after", "\nExamples:\n  apparat heartbeat logs meditate:my-app\n  apparat heartbeat logs meditate:my-app --follow\n")
    .option("--follow", "stream live output")
    .action(async (id: string, opts: { follow?: boolean }) => {
      try {
        if (opts.follow) {
          const ac = new AbortController();
          process.on("SIGINT", () => ac.abort());
          await stream("stream_logs", { taskId: id, follow: true }, (msg) => {
            if (msg.type === "log_line") {
              const prefix = `[${msg.stream}]`;
              console.log(`${prefix} ${msg.content}`);
            }
          }, ac.signal);
        } else {
          const res = await request("stream_logs", { taskId: id, follow: false });
          console.log(res);
        }
      } catch (err: any) {
        await output.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });

  hb
    .command("watch")
    .description("Open a live TUI dashboard showing all tasks and streaming output")
    .action(async () => {
      const { renderWatch } = await import("../components/HeartbeatWatch");
      await renderWatch();
    });
}
