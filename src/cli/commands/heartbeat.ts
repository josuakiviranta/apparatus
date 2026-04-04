// src/cli/commands/heartbeat.ts
import { Command } from "commander";
import { resolve } from "path";
import { request, stream } from "../../lib/daemon-client";
import type { Task } from "../../daemon/state";

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
    .description("Manage background scheduled tasks");

  hb
    .command("meditate <folder>")
    .description("Run meditate on a project folder on a heartbeat schedule")
    .requiredOption("--every <n>", "interval in minutes", (v) => {
      const n = parseInt(v, 10);
      if (isNaN(n) || n < 1) throw new Error("--every must be a positive integer");
      return n;
    })
    .action(async (folder: string, opts: { every: number }) => {
      const absPath = resolve(folder);
      try {
        const res = await request("register_task", {
          command: "meditate",
          args: [absPath],
          interval: opts.every,
        });
        console.log(`Registered: ${res.taskId} (every ${opts.every} min)`);
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });

  hb
    .command("list")
    .description("List all registered heartbeat tasks")
    .action(async () => {
      try {
        const res = await request("list_tasks");
        formatTable(res.data);
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });

  hb
    .command("stop <id>")
    .description("Remove task and kill any running session")
    .action(async (id: string) => {
      try {
        await request("stop_task", { taskId: id });
        console.log(`Stopped and removed: ${id}`);
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });

  hb
    .command("pause <id>")
    .description("Suspend scheduling without removing the task")
    .action(async (id: string) => {
      try {
        await request("pause_task", { taskId: id });
        console.log(`Paused: ${id}`);
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });

  hb
    .command("resume <id>")
    .description("Re-enable scheduling for a paused task")
    .action(async (id: string) => {
      try {
        await request("resume_task", { taskId: id });
        console.log(`Resumed: ${id}`);
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });

  hb
    .command("kill <id>")
    .description("Kill running session only — schedule stays")
    .action(async (id: string) => {
      try {
        await request("kill_session", { taskId: id });
        console.log(`Session killed: ${id}`);
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });

  hb
    .command("logs <id>")
    .description("Print logs for a task")
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
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });

  hb
    .command("watch")
    .description("Live TUI: all tasks + streaming output")
    .action(async () => {
      const { renderWatch } = await import("../components/HeartbeatWatch");
      await renderWatch();
    });
}
