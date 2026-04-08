import net from "net";
import type { Task } from "./state";

export interface RequestHandlers {
  list_tasks(): Task[];
  register_task(command: string, args: string[], interval: number, id?: string): Task;
  stop_task(taskId: string): void;
  pause_task(taskId: string): void;
  resume_task(taskId: string): void;
  kill_session(taskId: string): void;
  stream_logs(taskId: string, follow: boolean, onLine: (msg: object) => void): () => void;
  watch(onEvent: (event: object) => void): () => void;
}

function send(socket: net.Socket, msg: object): void {
  if (!socket.writable) return;
  socket.write(JSON.stringify(msg) + "\n");
}

function handleRequest(socket: net.Socket, req: any, handlers: RequestHandlers): (() => void) | null {
  try {
    switch (req.action) {
      case "list_tasks":
        send(socket, { type: "tasks", data: handlers.list_tasks() });
        return null;

      case "register_task": {
        const task = handlers.register_task(req.command, req.args, req.interval, req.id);
        send(socket, { type: "ok", taskId: task.id });
        return null;
      }

      case "stop_task":
        handlers.stop_task(req.taskId);
        send(socket, { type: "ok" });
        return null;

      case "pause_task":
        handlers.pause_task(req.taskId);
        send(socket, { type: "ok" });
        return null;

      case "resume_task":
        handlers.resume_task(req.taskId);
        send(socket, { type: "ok" });
        return null;

      case "kill_session":
        handlers.kill_session(req.taskId);
        send(socket, { type: "ok" });
        return null;

      case "stream_logs": {
        const cancel = handlers.stream_logs(req.taskId, req.follow ?? false, (msg) => send(socket, msg));
        return cancel;
      }

      case "watch": {
        const cancel = handlers.watch((event) => send(socket, event));
        return cancel;
      }

      default:
        send(socket, { type: "error", message: `Unknown action: ${req.action}` });
        return null;
    }
  } catch (err: any) {
    send(socket, { type: "error", message: err.message ?? String(err) });
    return null;
  }
}

export function createSocketServer(sockPath: string, handlers: RequestHandlers): net.Server {
  const server = net.createServer((socket) => {
    let buf = "";
    let cancelStream: (() => void) | null = null;

    socket.on("data", (chunk) => {
      buf += chunk.toString();
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let req: any;
        try {
          req = JSON.parse(line);
        } catch {
          send(socket, { type: "error", message: "Invalid JSON" });
          continue;
        }
        if (cancelStream) { cancelStream(); cancelStream = null; }
        cancelStream = handleRequest(socket, req, handlers);
      }
    });

    socket.on("close", () => {
      if (cancelStream) cancelStream();
    });
  });

  return server;
}
